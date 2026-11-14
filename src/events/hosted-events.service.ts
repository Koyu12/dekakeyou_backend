import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../auth/auth';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  canCreateHosted,
  canEditHosted,
  capacityError,
  deleteHostedError,
  HOSTED_EVENTS_PER_DAY,
  makeSlug,
  onlineLinkError,
} from './events.rules';
import type {
  CreateHostedEventDto,
  OrganizerEvent,
  UpdateHostedEventDto,
} from './events.schemas';
import {
  assertPlaceAndTime,
  assertRefsAvailable,
  invalid,
  mergePlace,
  normalizePlace,
  notFound,
  statusError,
  toOrganizerView,
  withRefs,
} from './events.shared';

const DAY_MS = 24 * 60 * 60 * 1000;

// Organizers' own Hosted Events. Any verified user becomes an Organizer by creating one.
@Injectable()
export class HostedEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: SessionUser,
    input: CreateHostedEventDto,
  ): Promise<OrganizerEvent> {
    if (!user.emailVerified) {
      throw new AppError(
        'FORBIDDEN',
        403,
        'Verify your email before creating Events',
      );
    }
    const data = {
      ...normalizePlace(input),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    };
    assertPlaceAndTime(data);
    const linkProblem = onlineLinkError(data);
    if (linkProblem) throw invalid(linkProblem);
    await assertRefsAvailable(this.prisma, input.categoryId, data.cityId);

    return this.prisma.$transaction(async (tx) => {
      // One user's creates run one at a time, so parallel requests can't slip past the daily limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      // shortcut: deleted Events no longer count toward the limit; track creations separately if abused.
      const recent = await tx.event.count({
        where: {
          organizerId: user.id,
          kind: 'HOSTED',
          createdAt: { gte: new Date(Date.now() - DAY_MS) },
        },
      });
      if (!canCreateHosted(recent)) {
        throw new AppError(
          'RATE_LIMITED',
          429,
          `You can create at most ${HOSTED_EVENTS_PER_DAY} Events per day`,
        );
      }

      const event = await tx.event.create({
        data: {
          slug: makeSlug(input.title),
          kind: 'HOSTED',
          status: 'PUBLISHED', // the automatic content check (#11) will slot in before this
          organizerId: user.id,
          title: input.title,
          description: input.description ?? '',
          categoryId: input.categoryId,
          timeZone: input.timeZone,
          capacity: input.capacity ?? null,
          ...data,
        },
        include: withRefs,
      });
      return toOrganizerView(event);
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdateHostedEventDto,
  ): Promise<OrganizerEvent> {
    const current = await this.findOwn(user, id);
    if (!canEditHosted(current.status)) {
      throw statusError(`A ${current.status} Event can't be edited`);
    }

    const place = mergePlace(input, current);
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    assertPlaceAndTime({ ...place, startsAt, endsAt });
    const linkProblem = onlineLinkError(place);
    if (linkProblem) throw invalid(linkProblem);

    await assertRefsAvailable(
      this.prisma,
      input.categoryId !== current.categoryId ? input.categoryId : undefined,
      place.cityId !== current.cityId ? place.cityId : undefined,
    );

    const capacity =
      input.capacity !== undefined ? input.capacity : current.capacity;

    return this.prisma.$transaction(async (tx) => {
      // Same row lock joins take (ADR-0003): no one can join between this check and the write.
      const [locked] = await tx.$queryRaw<{ reservedCount: number }[]>`
        SELECT "reservedCount" FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
      const capacityProblem = capacityError(capacity, locked.reservedCount);
      if (capacityProblem) {
        throw new AppError('CAPACITY_BELOW_RESERVED', 409, capacityProblem);
      }

      const event = await tx.event.update({
        where: { id },
        data: {
          // slug is deliberately never changed, so shared links keep working
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          timeZone: input.timeZone,
          capacity,
          ...place,
          startsAt,
          endsAt,
        },
        include: withRefs,
      });
      return toOrganizerView(event);
    });
  }

  async delete(user: SessionUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Same row lock joins will take (ADR-0003), so nobody can join while this decides.
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM "Event"
        WHERE id = ${id}::uuid AND kind = 'HOSTED' AND "organizerId" = ${user.id}
        FOR UPDATE`;
      if (!locked) throw notFound();

      const active = await tx.reservation.count({
        where: { eventId: id, status: 'ACTIVE' },
      });
      const problem = deleteHostedError(
        locked.status as Parameters<typeof deleteHostedError>[0],
        active,
      );
      if (problem) throw statusError(problem);

      await tx.event.delete({ where: { id } });
    });
  }

  async listOwn(user: SessionUser): Promise<OrganizerEvent[]> {
    const events = await this.prisma.event.findMany({
      where: { organizerId: user.id, kind: 'HOSTED' },
      include: withRefs,
      orderBy: { startsAt: 'desc' },
    });
    return events.map(toOrganizerView);
  }

  async getOwn(user: SessionUser, id: string): Promise<OrganizerEvent> {
    return toOrganizerView(await this.findOwn(user, id));
  }

  /** Someone else's Event looks the same as a missing one, so ids can't be probed. */
  private async findOwn(user: SessionUser, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, kind: 'HOSTED', organizerId: user.id },
      include: withRefs,
    });
    if (!event) throw notFound();
    return event;
  }
}

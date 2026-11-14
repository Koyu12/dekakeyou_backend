import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../auth/auth';
import { CatalogService } from '../catalog/catalog.service';
import { ContentCheckService } from '../content-check/content-check.service';
import type { Prisma } from '../generated/prisma/client';
import type { EventStatus, ReviewReason } from '../generated/prisma/enums';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import {
  canCancelHosted,
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
  checkContent,
  invalid,
  mergePlace,
  normalizePlace,
  notFound,
  statusError,
  tagsOrThrow,
  toOrganizerView,
  withRefs,
} from './events.shared';

const DAY_MS = 24 * 60 * 60 * 1000;

// Organizers' own Hosted Events. Any verified user becomes an Organizer by creating one.
@Injectable()
export class HostedEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
    private readonly catalog: CatalogService,
    private readonly contentCheck: ContentCheckService,
  ) {}

  /**
   * Hides a Published Event until the Admin decides (moderation calls this; events owns status).
   * Runs in the caller's transaction, which should hold the Event-row lock. Existing
   * Reservations stay Active; joining is blocked because the Event is no longer Published.
   */
  async holdForReview(
    tx: Prisma.TransactionClient,
    eventId: string,
    reason: ReviewReason,
  ) {
    await tx.event.updateMany({
      where: { id: eventId, status: 'PUBLISHED' },
      data: { status: 'UNDER_REVIEW', reviewReason: reason },
    });
  }

  /**
   * Account deletion: cancels the Organizer's live Hosted Events that haven't ended, voiding
   * their Reservations. Runs in the caller's transaction; locks rows in id order as joins do.
   * Returns how many were cancelled.
   */
  async cancelAllUpcoming(
    tx: Prisma.TransactionClient,
    organizerId: string,
  ): Promise<number> {
    const live = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Event"
      WHERE "organizerId" = ${organizerId} AND kind = 'HOSTED'
        AND status IN ('PUBLISHED', 'UNDER_REVIEW') AND "endsAt" > now()
      ORDER BY id
      FOR UPDATE`;
    for (const { id } of live) await this.callOff(tx, id);
    return live.length;
  }

  private async callOff(tx: Prisma.TransactionClient, id: string) {
    await tx.event.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.reservations.voidAllForEvent(tx, id);
  }

  /** Calls the Event off: it stays visible as Cancelled and every Active Reservation becomes Void. */
  async cancel(user: SessionUser, id: string): Promise<OrganizerEvent> {
    return this.prisma.$transaction(async (tx) => {
      // The lock joins take (ADR-0003): nobody can join while the Event is being called off.
      const [locked] = await tx.$queryRaw<{ status: EventStatus }[]>`
        SELECT status FROM "Event"
        WHERE id = ${id}::uuid AND kind = 'HOSTED' AND "organizerId" = ${user.id}
        FOR UPDATE`;
      if (!locked) throw notFound();
      if (!canCancelHosted(locked.status)) {
        throw statusError(`A ${locked.status} Event can't be cancelled`);
      }

      await this.callOff(tx, id);

      const event = await tx.event.findUniqueOrThrow({
        where: { id },
        include: withRefs,
      });
      return toOrganizerView(event);
    });
  }

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
    const tags = tagsOrThrow(input.tags) ?? [];
    await assertRefsAvailable(this.prisma, input.categoryId, data.cityId);
    const verdict = await checkContent(
      this.contentCheck,
      { title: input.title, description: input.description ?? '', tags },
      { ai: true },
    );

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

      const { id } = await tx.event.create({
        data: {
          slug: makeSlug(input.title),
          kind: 'HOSTED',
          ...(verdict === 'BORDERLINE'
            ? { status: 'UNDER_REVIEW', reviewReason: 'AUTO_CHECK' }
            : { status: 'PUBLISHED' }),
          organizerId: user.id,
          title: input.title,
          description: input.description ?? '',
          categoryId: input.categoryId,
          timeZone: input.timeZone,
          capacity: input.capacity ?? null,
          ...data,
        },
      });
      await this.catalog.setEventTags(tx, id, tags);
      return toOrganizerView(
        await tx.event.findUniqueOrThrow({ where: { id }, include: withRefs }),
      );
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
    const tags = tagsOrThrow(input.tags);

    await assertRefsAvailable(
      this.prisma,
      input.categoryId !== current.categoryId ? input.categoryId : undefined,
      place.cityId !== current.cityId ? place.cityId : undefined,
    );

    const capacity =
      input.capacity !== undefined ? input.capacity : current.capacity;

    // Checked on every text edit: publishing something clean and then editing it must not slip by.
    const touchesText =
      input.title !== undefined ||
      input.description !== undefined ||
      tags !== undefined;
    const verdict = touchesText
      ? await checkContent(
          this.contentCheck,
          {
            title: input.title ?? current.title,
            description: input.description ?? current.description,
            tags: tags ?? current.tags.map((t) => t.tag.name),
          },
          { ai: true },
        )
      : 'PASS';

    return this.prisma.$transaction(async (tx) => {
      // Same row lock joins take (ADR-0003): no one can join between this check and the write.
      const [locked] = await tx.$queryRaw<
        { reservedCount: number; status: EventStatus }[]
      >`
        SELECT "reservedCount", status FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
      const capacityProblem = capacityError(capacity, locked.reservedCount);
      if (capacityProblem) {
        throw new AppError('CAPACITY_BELOW_RESERVED', 409, capacityProblem);
      }
      // A borderline edit hides a public Event; a clean edit never lifts an existing review.
      const hold = verdict === 'BORDERLINE' && locked.status === 'PUBLISHED';

      await tx.event.update({
        where: { id },
        data: {
          ...(hold
            ? { status: 'UNDER_REVIEW', reviewReason: 'AUTO_CHECK' }
            : {}),
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
      });
      if (tags) await this.catalog.setEventTags(tx, id, tags);
      return toOrganizerView(
        await tx.event.findUniqueOrThrow({ where: { id }, include: withRefs }),
      );
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

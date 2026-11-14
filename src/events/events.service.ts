import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { EventStatus } from '../generated/prisma/enums';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  canCancelListed,
  canEditListed,
  canPublishListed,
  makeSlug,
  placeAndTimeError,
  PUBLIC_STATUSES,
} from './events.rules';
import type {
  CreateListedEventDto,
  EventDetail,
  UpdateListedEventDto,
} from './events.schemas';

const withRefs = {
  category: { select: { id: true, name: true } },
  city: { select: { id: true, name: true, province: true } },
} satisfies Prisma.EventInclude;

type EventWithRefs = Prisma.EventGetPayload<{ include: typeof withRefs }>;

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public ───────────────────────────────────────────────────────

  async findPublicBySlug(slug: string): Promise<EventDetail> {
    const event = await this.prisma.event.findFirst({
      where: { slug, status: { in: PUBLIC_STATUSES } },
      include: withRefs,
    });
    if (!event) throw notFound();
    return toDetail(event);
  }

  // ─── Admin: Listed Events (ADR-0001: no owner, source MANUAL) ─────

  async listListedForAdmin(): Promise<EventDetail[]> {
    // shortcut: newest 200, no filters or paging; add them when the Admin's list outgrows this.
    const events = await this.prisma.event.findMany({
      where: { kind: 'LISTED' },
      include: withRefs,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return events.map(toDetail);
  }

  async getListedForAdmin(id: string): Promise<EventDetail> {
    return toDetail(await this.findListed(id));
  }

  async createListed(input: CreateListedEventDto): Promise<EventDetail> {
    const data = {
      ...normalizePlace(input),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    };
    this.assertPlaceAndTime(data);
    await this.assertRefsAvailable(input.categoryId, data.cityId);

    const event = await this.prisma.event.create({
      data: {
        slug: makeSlug(input.title),
        kind: 'LISTED',
        status: 'DRAFT',
        source: 'MANUAL',
        title: input.title,
        description: input.description ?? '',
        categoryId: input.categoryId,
        timeZone: input.timeZone,
        presenterName: input.presenterName ?? null,
        officialUrl: input.officialUrl ?? null,
        ...data,
      },
      include: withRefs,
    });
    return toDetail(event);
  }

  async updateListed(
    id: string,
    input: UpdateListedEventDto,
  ): Promise<EventDetail> {
    const current = await this.findListed(id);
    if (!canEditListed(current.status)) {
      throw statusError(`A ${current.status} Event can't be edited`);
    }

    const merged = normalizePlace({
      isOnline: input.isOnline ?? current.isOnline,
      cityId: input.cityId !== undefined ? input.cityId : current.cityId,
      venueName:
        input.venueName !== undefined ? input.venueName : current.venueName,
      venueAddress:
        input.venueAddress !== undefined
          ? input.venueAddress
          : current.venueAddress,
    });
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    this.assertPlaceAndTime({ ...merged, startsAt, endsAt });

    // Only newly chosen references must be active; an Event may keep a since-archived one.
    await this.assertRefsAvailable(
      input.categoryId !== undefined && input.categoryId !== current.categoryId
        ? input.categoryId
        : undefined,
      merged.cityId !== current.cityId ? merged.cityId : undefined,
    );

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        // slug is deliberately never changed, so shared links keep working
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        timeZone: input.timeZone,
        presenterName: input.presenterName,
        officialUrl: input.officialUrl,
        ...merged,
        startsAt,
        endsAt,
      },
      include: withRefs,
    });
    return toDetail(event);
  }

  async publishListed(id: string): Promise<EventDetail> {
    const current = await this.findListed(id);
    if (!canPublishListed(current.status)) {
      throw statusError(
        `Only a Draft can be published (this one is ${current.status})`,
      );
    }
    return this.setStatus(id, current.status, { status: 'PUBLISHED' });
  }

  async cancelListed(id: string): Promise<EventDetail> {
    const current = await this.findListed(id);
    if (!canCancelListed(current.status)) {
      throw statusError(
        `Only a Published Event can be cancelled (this one is ${current.status})`,
      );
    }
    return this.setStatus(id, current.status, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async findListed(id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, kind: 'LISTED' },
      include: withRefs,
    });
    if (!event) throw notFound();
    return event;
  }

  /** Updates only if the status is still what was checked, so two clicks can't both succeed. */
  private async setStatus(
    id: string,
    expected: EventStatus,
    data: Prisma.EventUpdateManyMutationInput,
  ) {
    const { count } = await this.prisma.event.updateMany({
      where: { id, status: expected },
      data,
    });
    if (count === 0)
      throw statusError('The Event changed meanwhile; reload and retry');
    return this.getListedForAdmin(id);
  }

  private assertPlaceAndTime(event: Parameters<typeof placeAndTimeError>[0]) {
    const problem = placeAndTimeError(event);
    if (problem) throw new AppError('VALIDATION_FAILED', 400, problem);
  }

  private async assertRefsAvailable(
    categoryId?: string,
    cityId?: string | null,
  ) {
    if (categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, archivedAt: null },
      });
      if (!category) {
        throw new AppError(
          'CATEGORY_NOT_AVAILABLE',
          400,
          'Unknown or archived Category',
        );
      }
    }
    if (cityId) {
      const city = await this.prisma.city.findFirst({
        where: { id: cityId, archivedAt: null },
      });
      if (!city)
        throw new AppError(
          'CITY_NOT_AVAILABLE',
          400,
          'Unknown or archived City',
        );
    }
  }
}

/** Online Events have no physical place, so City and venue are cleared. */
function normalizePlace(p: {
  isOnline: boolean;
  cityId?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
}) {
  return p.isOnline
    ? { isOnline: true, cityId: null, venueName: null, venueAddress: null }
    : {
        isOnline: false,
        cityId: p.cityId ?? null,
        venueName: p.venueName ?? null,
        venueAddress: p.venueAddress ?? null,
      };
}

function toDetail(e: EventWithRefs): EventDetail {
  return {
    id: e.id,
    slug: e.slug,
    kind: e.kind,
    status: e.status,
    title: e.title,
    description: e.description,
    category: e.category,
    isOnline: e.isOnline,
    city: e.city,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timeZone: e.timeZone,
    presenterName: e.presenterName,
    officialUrl: e.officialUrl,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
  };
}

const notFound = () => new AppError('EVENT_NOT_FOUND', 404, 'Event not found');
const statusError = (message: string) =>
  new AppError('INVALID_STATUS_CHANGE', 409, message);

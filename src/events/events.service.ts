import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { ContentCheckService } from '../content-check/content-check.service';
import type { Prisma } from '../generated/prisma/client';
import type { EventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { normalizeTag } from '../catalog/catalog.rules';
import {
  canCancelListed,
  canEditListed,
  canPublishListed,
  canRemove,
  restoredStatus,
  decodeCursor,
  encodeCursor,
  makeSlug,
} from './events.rules';
import type {
  BrowseEventsQuery,
  CreateListedEventDto,
  EventDetail,
  EventPage,
  UpdateListedEventDto,
} from './events.schemas';
import {
  assertPlaceAndTime,
  assertRefsAvailable,
  checkContent,
  invalid,
  mergePlace,
  normalizePlace,
  notFound,
  publicEventWhere,
  statusError,
  tagsOrThrow,
  toCard,
  toDetail,
  withRefs,
} from './events.shared';

// Public reads, plus the Admin's Listed Events (ADR-0001: no owner, source MANUAL).
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly contentCheck: ContentCheckService,
    private readonly reservations: ReservationsService,
  ) {}

  // ─── Admin moderation (called by moderation inside its transaction; events owns status) ───

  /**
   * Locks the Event row for a moderation decision and returns what the decision depends on.
   * The same lock joins and Reports take (ADR-0003).
   */
  async lockForModeration(tx: Prisma.TransactionClient, id: string) {
    const [event] = await tx.$queryRaw<
      { status: EventStatus; reviewReason: string | null }[]
    >`SELECT status, "reviewReason" FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!event) throw notFound();
    return event;
  }

  /** Lifts a review: Under Review → Published, and the review flag clears (so it's public again). */
  async restoreFromReview(tx: Prisma.TransactionClient, id: string) {
    const event = await this.lockForModeration(tx, id);
    const status = restoredStatus(event.status, event.reviewReason);
    if (!status) {
      throw statusError(`A ${event.status} Event has nothing to restore`);
    }
    await tx.event.update({
      where: { id },
      data: { status, reviewReason: null },
    });
  }

  /**
   * Takes an Event down for breaking the rules: hidden for good but kept as evidence, and
   * every Active Reservation becomes Void. Returns the affected Attendees (for emails in #17).
   */
  async remove(
    tx: Prisma.TransactionClient,
    id: string,
    reason: string,
  ): Promise<string[]> {
    const event = await this.lockForModeration(tx, id);
    if (!canRemove(event.status)) {
      throw statusError(`A ${event.status} Event can't be removed`);
    }
    await tx.event.update({
      where: { id },
      data: { status: 'REMOVED', removedReason: reason, removedAt: new Date() },
    });
    return this.reservations.voidAllForEvent(tx, id);
  }

  async findPublicBySlug(slug: string): Promise<EventDetail> {
    const event = await this.prisma.event.findFirst({
      where: { slug, ...publicEventWhere },
      include: withRefs,
    });
    if (!event) throw notFound();
    return toDetail(event);
  }

  /** Public browsing: filters combine with AND; pages follow (startsAt, id) so none are skipped. */
  async browse(query: BrowseEventsQuery): Promise<EventPage> {
    const and: Prisma.EventWhereInput[] = [publicEventWhere];

    if (!query.includePast) and.push({ endsAt: { gt: new Date() } });
    if (query.category) and.push({ categoryId: query.category });
    if (query.city)
      and.push({ OR: [{ cityId: query.city }, { isOnline: true }] });
    if (query.from) and.push({ endsAt: { gte: new Date(query.from) } });
    if (query.to) and.push({ startsAt: { lte: new Date(query.to) } });
    // shortcut: ILIKE without an index; add pg_trgm (or full-text search) once Event counts grow.
    if (query.q)
      and.push({ title: { contains: query.q, mode: 'insensitive' } });
    if (query.tag !== undefined) {
      const tag = normalizeTag(query.tag);
      if (!tag) return { items: [], nextCursor: null };
      and.push({ tags: { some: { tag: { name: tag } } } });
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) throw invalid('Invalid cursor');
      and.push({
        OR: [
          { startsAt: { gt: cursor.startsAt } },
          { startsAt: cursor.startsAt, id: { gt: cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.event.findMany({
      where: { AND: and },
      include: withRefs,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1, // one extra tells us whether another page exists
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toCard),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ startsAt: last.startsAt, id: last.id })
          : null,
    };
  }

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
    assertPlaceAndTime(data);
    const tags = tagsOrThrow(input.tags) ?? [];
    await assertRefsAvailable(this.prisma, input.categoryId, data.cityId);
    // The Admin's own posts skip the AI call but still go through the banned-word list.
    await checkContent(
      this.contentCheck,
      { title: input.title, description: input.description ?? '', tags },
      { ai: false },
    );

    return this.prisma.$transaction(async (tx) => {
      const { id } = await tx.event.create({
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
      });
      await this.catalog.setEventTags(tx, id, tags);
      return toDetail(
        await tx.event.findUniqueOrThrow({ where: { id }, include: withRefs }),
      );
    });
  }

  async updateListed(
    id: string,
    input: UpdateListedEventDto,
  ): Promise<EventDetail> {
    const current = await this.findListed(id);
    if (!canEditListed(current.status)) {
      throw statusError(`A ${current.status} Event can't be edited`);
    }

    const place = mergePlace(input, current);
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    assertPlaceAndTime({ ...place, startsAt, endsAt });
    const tags = tagsOrThrow(input.tags);

    // Only newly chosen references must be active; an Event may keep a since-archived one.
    await assertRefsAvailable(
      this.prisma,
      input.categoryId !== current.categoryId ? input.categoryId : undefined,
      place.cityId !== current.cityId ? place.cityId : undefined,
    );
    await checkContent(
      this.contentCheck,
      {
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        tags: tags ?? current.tags.map((t) => t.tag.name),
      },
      { ai: false },
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id },
        data: {
          // slug is deliberately never changed, so shared links keep working
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          timeZone: input.timeZone,
          presenterName: input.presenterName,
          officialUrl: input.officialUrl,
          ...place,
          startsAt,
          endsAt,
        },
      });
      if (tags) await this.catalog.setEventTags(tx, id, tags);
      return toDetail(
        await tx.event.findUniqueOrThrow({ where: { id }, include: withRefs }),
      );
    });
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
}

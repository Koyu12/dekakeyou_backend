import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import type { Prisma } from '../generated/prisma/client';
import type { EventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  canCancelListed,
  canEditListed,
  canPublishListed,
  makeSlug,
} from './events.rules';
import type {
  CreateListedEventDto,
  EventDetail,
  UpdateListedEventDto,
} from './events.schemas';
import {
  assertPlaceAndTime,
  assertRefsAvailable,
  mergePlace,
  normalizePlace,
  notFound,
  publicEventWhere,
  statusError,
  tagsOrThrow,
  toDetail,
  withRefs,
} from './events.shared';

// Public reads, plus the Admin's Listed Events (ADR-0001: no owner, source MANUAL).
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async findPublicBySlug(slug: string): Promise<EventDetail> {
    const event = await this.prisma.event.findFirst({
      where: { slug, ...publicEventWhere },
      include: withRefs,
    });
    if (!event) throw notFound();
    return toDetail(event);
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

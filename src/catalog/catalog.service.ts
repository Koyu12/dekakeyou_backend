import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_SUGGESTIONS = 10;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories() {
    return this.prisma.category.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  }

  listCities() {
    return this.prisma.city.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, province: true },
    });
  }

  /** Existing Tags starting with an (already normalized) prefix, most used first. */
  async suggestTags(prefix: string) {
    // shortcut: LIKE 'prefix%' scans the Tag table; add a text_pattern_ops index when it grows large.
    const tags = await this.prisma.tag.findMany({
      where: { name: { startsWith: prefix } },
      orderBy: [{ events: { _count: 'desc' } }, { name: 'asc' }],
      take: MAX_SUGGESTIONS,
      select: { name: true },
    });
    return tags.map((t) => t.name);
  }

  /**
   * Replaces an Event's Tags with these (already normalized) names, creating missing Tags.
   * Runs in the caller's transaction; the Event module owns the Event, catalog owns Tags (ADR-0003).
   */
  async setEventTags(
    tx: Prisma.TransactionClient,
    eventId: string,
    names: string[],
  ) {
    await tx.eventTag.deleteMany({ where: { eventId } });
    if (names.length === 0) return;
    // skipDuplicates makes two Events adding the same new Tag at once both succeed.
    await tx.tag.createMany({
      data: names.map((name) => ({ name })),
      skipDuplicates: true,
    });
    const tags = await tx.tag.findMany({
      where: { name: { in: names } },
      select: { id: true },
    });
    await tx.eventTag.createMany({
      data: tags.map((t) => ({ eventId, tagId: t.id })),
    });
  }
}

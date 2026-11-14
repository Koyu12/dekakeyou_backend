import { Injectable } from '@nestjs/common';
import { EventsService } from '../events/events.service';
import type { Prisma } from '../generated/prisma/client';
import type { ReportStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { ModerationResult, QueueItem } from './moderation.schemas';

const QUEUE_LIMIT = 100;

// The Admin's decisions. Each one is a single transaction across moderation (Reports),
// events (status) and reservations (Void), in the direction ADR-0003 allows.
@Injectable()
export class AdminModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Everything waiting for a decision: Events Under Review, Events still carrying a review flag
   * (cancelled while Under Review), and any Event with Open Reports (incl. Listed Events).
   * Under Review first, then oldest first.
   */
  async queue(): Promise<QueueItem[]> {
    // shortcut: first 100 items, no paging; add paging if the queue ever gets that long.
    const events = await this.prisma.event.findMany({
      where: {
        status: { not: 'REMOVED' },
        OR: [
          { status: 'UNDER_REVIEW' },
          { reviewReason: { not: null } },
          { reports: { some: { status: 'OPEN' } } },
        ],
      },
      include: {
        organizer: { select: { id: true, name: true } },
        tags: { select: { tag: { select: { name: true } } } },
        reports: {
          where: { status: 'OPEN' },
          orderBy: { createdAt: 'asc' },
          include: { reporter: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: QUEUE_LIMIT,
    });

    const items = events.map((e) => ({
      event: {
        id: e.id,
        slug: e.slug,
        kind: e.kind,
        status: e.status,
        reviewReason: e.reviewReason,
        title: e.title,
        description: e.description,
        tags: e.tags.map((t) => t.tag.name).sort(),
        organizer: e.organizer,
        startsAt: e.startsAt.toISOString(),
      },
      openReports: e.reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        reporter: r.reporter,
      })),
    }));
    const hidden = (i: QueueItem) => (i.event.reviewReason ? 0 : 1);
    return items.sort((a, b) => hidden(a) - hidden(b)); // stable: keeps oldest-first within groups
  }

  /** Nothing wrong after all: the Event is public again and its Open Reports are Dismissed. */
  restore(eventId: string): Promise<ModerationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.events.restoreFromReview(tx, eventId);
      const resolved = await resolveOpenReports(tx, eventId, 'DISMISSED');
      return result(tx, eventId, resolved);
    });
  }

  /** Takes the Event down: Removed with a reason, Reports Actioned, Reservations Void. */
  remove(eventId: string, reason: string): Promise<ModerationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.events.remove(tx, eventId, reason);
      const resolved = await resolveOpenReports(tx, eventId, 'ACTIONED');
      return result(tx, eventId, resolved);
    });
  }

  /**
   * Closes the Open Reports on an Event without changing it here, e.g. a Listed Event with
   * wrong info that the Admin has since edited (ACTIONED) or that was fine (DISMISSED).
   */
  resolveReports(
    eventId: string,
    outcome: 'DISMISSED' | 'ACTIONED',
  ): Promise<ModerationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.events.lockForModeration(tx, eventId);
      const resolved = await resolveOpenReports(tx, eventId, outcome);
      return result(tx, eventId, resolved);
    });
  }
}

async function resolveOpenReports(
  tx: Prisma.TransactionClient,
  eventId: string,
  outcome: ReportStatus,
) {
  const { count } = await tx.report.updateMany({
    where: { eventId, status: 'OPEN' },
    data: { status: outcome, resolvedAt: new Date() },
  });
  return count;
}

async function result(
  tx: Prisma.TransactionClient,
  eventId: string,
  resolvedReports: number,
): Promise<ModerationResult> {
  const { status } = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true },
  });
  return { eventId, status, resolvedReports };
}

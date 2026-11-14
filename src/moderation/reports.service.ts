import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../auth/auth';
import { AppError } from '../common/errors/app-error';
import { HostedEventsService } from '../events/hosted-events.service';
import { Prisma } from '../generated/prisma/client';
import type { EventKind, EventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { canReport, shouldHideForReports } from './moderation.rules';
import type { CreateReportDto, ReportView } from './moderation.schemas';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostedEvents: HostedEventsService,
  ) {}

  /** Files a Report; the threshold-th Open Report hides a Published Hosted Event. */
  async report(
    user: SessionUser,
    eventId: string,
    input: CreateReportDto,
  ): Promise<ReportView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serializes Reports (and joins) per Event, so the count below is exact.
        const [event] = await tx.$queryRaw<
          { kind: EventKind; status: EventStatus }[]
        >`SELECT kind, status FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
        if (!event || !canReport(event.status)) {
          throw new AppError('EVENT_NOT_FOUND', 404, 'Event not found');
        }

        const report = await tx.report.create({
          data: {
            eventId,
            reporterId: user.id,
            reason: input.reason,
            comment: input.comment || null,
          },
        });

        const openReports = await tx.report.count({
          where: { eventId, status: 'OPEN' },
        });
        if (shouldHideForReports(event, openReports)) {
          await this.hostedEvents.holdForReview(tx, eventId, 'REPORTED');
        }

        return {
          id: report.id,
          eventId: report.eventId,
          reason: report.reason,
          comment: report.comment,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
        };
      });
    } catch (err) {
      // The unique (event, reporter) index decides, even for a double-click.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new AppError(
          'ALREADY_REPORTED',
          409,
          'You already reported this Event',
        );
      }
      throw err;
    }
  }
}

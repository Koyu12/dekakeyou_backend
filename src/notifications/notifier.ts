import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSender } from './email-sender';
import {
  detailsChanged,
  EventDetails,
  eventDetails,
  Notice,
  renderNotice,
} from './notices';

export const EMAIL_QUEUE = 'email';
/** One waiting job per Event: edits within the delay merge into it (pg-boss 'short' policy). */
export const CHANGE_QUEUE = 'event-details-changed';
export const CHANGE_DELAY_SECONDS = 5 * 60;

type DetailsChange = { eventId: string; before: EventDetails };

/**
 * Background email (pg-boss, stored in the same Postgres). Jobs are inserted inside the
 * caller's transaction, so they only exist once it commits and vanish if it rolls back.
 */
@Injectable()
export class Notifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Notifier');
  readonly boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  workerId?: string;
  changeWorkerId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSender,
  ) {
    this.boss.on('error', (e) => this.logger.error(e));
  }

  async onModuleInit() {
    await this.boss.start();
    await this.boss.createQueue(EMAIL_QUEUE, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
    });
    await this.boss.createQueue(CHANGE_QUEUE, { policy: 'short' });
    this.workerId = await this.boss.work<Notice>(EMAIL_QUEUE, (jobs) =>
      this.sendAll(jobs.map((j) => j.data)),
    );
    this.changeWorkerId = await this.boss.work<DetailsChange>(
      CHANGE_QUEUE,
      (jobs) => this.fanOutChanges(jobs.map((j) => j.data)),
    );
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** Queues the emails in the caller's transaction. */
  async queue(tx: Prisma.TransactionClient, notices: Notice[]) {
    if (notices.length === 0) return;
    await this.boss.insert(
      EMAIL_QUEUE,
      notices.map((data) => ({ data })),
      { db: inTx(tx) },
    );
  }

  /**
   * An Event's time or place changed. Attendees get one email after the delay, with the final
   * values; `before` is kept from the first edit, so changing it back sends nothing.
   */
  async queueDetailsChange(
    tx: Prisma.TransactionClient,
    eventId: string,
    before: EventDetails,
  ) {
    await this.boss.insert(
      CHANGE_QUEUE,
      [
        {
          data: { eventId, before } satisfies DetailsChange,
          singletonKey: eventId,
          startAfter: CHANGE_DELAY_SECONDS,
        },
      ],
      { db: inTx(tx) },
    );
  }

  private async fanOutChanges(changes: DetailsChange[]) {
    for (const { eventId, before } of changes) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: { reservations: { where: { status: 'ACTIVE' } } },
      });
      if (!event || !detailsChanged(before, eventDetails(event))) continue;
      const notices: Notice[] = event.reservations.map((r) => ({
        type: 'EVENT_CHANGED',
        eventId,
        userId: r.attendeeId,
      }));
      if (notices.length > 0) {
        await this.boss.insert(
          EMAIL_QUEUE,
          notices.map((data) => ({ data })),
        );
      }
    }
  }

  // A throw fails the job and pg-boss retries it with backoff.
  private async sendAll(notices: Notice[]) {
    for (const n of notices) {
      const [event, user] = await Promise.all([
        this.prisma.event.findUnique({
          where: { id: n.eventId },
          include: { city: true },
        }),
        this.prisma.user.findUnique({ where: { id: n.userId } }),
      ]);
      if (!event || !user || user.deletedAt) continue; // nobody left to tell
      await this.sender.send(renderNotice(n.type, event, user.email));
    }
  }
}

// Runs pg-boss's SQL through a Prisma transaction.
function inTx(tx: Prisma.TransactionClient) {
  return {
    executeSql: async (text: string, values: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
    }),
  };
}

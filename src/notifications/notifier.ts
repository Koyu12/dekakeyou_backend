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
import { Notice, renderNotice } from './notices';

export const EMAIL_QUEUE = 'email';

/**
 * Background email (pg-boss, stored in the same Postgres). Jobs are inserted inside the
 * caller's transaction, so they only exist once it commits and vanish if it rolls back.
 */
@Injectable()
export class Notifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Notifier');
  readonly boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  workerId?: string;

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
    this.workerId = await this.boss.work<Notice>(EMAIL_QUEUE, (jobs) =>
      this.sendAll(jobs.map((j) => j.data)),
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
      {
        db: {
          executeSql: async (text, values = []) => ({
            rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
          }),
        },
      },
    );
  }

  // A throw fails the job and pg-boss retries it with backoff.
  private async sendAll(notices: Notice[]) {
    for (const n of notices) {
      const [event, user] = await Promise.all([
        this.prisma.event.findUnique({ where: { id: n.eventId } }),
        this.prisma.user.findUnique({ where: { id: n.userId } }),
      ]);
      if (!event || !user || user.deletedAt) continue; // nobody left to tell
      await this.sender.send(renderNotice(n.type, event, user.email));
    }
  }
}

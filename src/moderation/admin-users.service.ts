import { Injectable } from '@nestjs/common';
import { AccountsService } from '../auth/accounts.service';
import { AppError } from '../common/errors/app-error';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import type { Account, BanResult } from './moderation.schemas';

type AccountRow = Awaited<ReturnType<AccountsService['view']>>;

// Bans span auth (account + sessions), events (Removed) and reservations (places freed):
// one transaction, coordinated here (ADR-0003).
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly events: EventsService,
    private readonly reservations: ReservationsService,
  ) {}

  async findByEmail(email: string): Promise<Account> {
    return toAccount(await this.accounts.findByEmail(email));
  }

  async ban(
    adminId: string,
    userId: string,
    input: { reason: string; expiresAt?: string },
  ): Promise<BanResult> {
    if (userId === adminId) {
      throw new AppError('FORBIDDEN', 403, "You can't ban yourself");
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        'A ban must expire in the future',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        await this.accounts.ban(tx, userId, {
          reason: input.reason,
          expiresAt,
        });

        // Their live Hosted Events come down, in id order (consistent lock order).
        const live = await tx.event.findMany({
          where: {
            organizerId: userId,
            kind: 'HOSTED',
            status: { in: ['PUBLISHED', 'UNDER_REVIEW'] },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const { id } of live) {
          await this.events.remove(tx, id, input.reason);
          await tx.report.updateMany({
            where: { eventId: id, status: 'OPEN' },
            data: { status: 'ACTIONED', resolvedAt: new Date() },
          });
        }

        const withdrawn = await this.reservations.withdrawAllForAttendee(
          tx,
          userId,
        );

        return {
          account: toAccount(await this.accounts.view(userId, tx)),
          removedEvents: live.length,
          withdrawnReservations: withdrawn,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /** Lifts the ban. Removed Events and freed places are not restored. */
  async unban(userId: string): Promise<Account> {
    return toAccount(await this.accounts.unban(userId));
  }
}

function toAccount(u: AccountRow): Account {
  return { ...u, banExpires: u.banExpires?.toISOString() ?? null };
}

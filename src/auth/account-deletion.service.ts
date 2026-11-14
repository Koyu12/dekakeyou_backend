import { Injectable } from '@nestjs/common';
import { HostedEventsService } from '../events/hosted-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { AccountsService } from './accounts.service';

// Deleting an account spans auth (the row), events (Cancelled) and reservations (places freed):
// one transaction, coordinated here (ADR-0003: auth → events → reservations).
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly hostedEvents: HostedEventsService,
    private readonly reservations: ReservationsService,
  ) {}

  async delete(userId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.accounts.anonymize(tx, userId);
        await this.hostedEvents.cancelAllUpcoming(tx, userId);
        await this.reservations.withdrawAllForAttendee(tx, userId);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }
}

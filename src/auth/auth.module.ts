import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventsModule } from '../events/events.module';
import { EmailSender } from '../notifications/email-sender';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsModule } from '../reservations/reservations.module';
import { AccountDeletionService } from './account-deletion.service';
import { AccountsService } from './accounts.service';
import { AUTH, createAuth } from './auth';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';

@Module({
  imports: [EventsModule, ReservationsModule],
  controllers: [MeController],
  providers: [
    {
      provide: AUTH,
      useFactory: createAuth,
      inject: [PrismaService, EmailSender],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    AccountsService,
    AccountDeletionService,
  ],
  exports: [AUTH, AccountsService],
})
export class AuthModule {}

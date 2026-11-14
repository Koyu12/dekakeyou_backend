import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EmailSender } from '../notifications/email-sender';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { AUTH, createAuth } from './auth';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';

@Module({
  controllers: [MeController],
  providers: [
    {
      provide: AUTH,
      useFactory: createAuth,
      inject: [PrismaService, EmailSender],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    AccountsService,
  ],
  exports: [AUTH, AccountsService],
})
export class AuthModule {}

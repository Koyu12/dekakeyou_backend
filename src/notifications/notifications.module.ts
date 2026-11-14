import { Global, Module } from '@nestjs/common';
import { EmailSender, emailSenderFromEnv } from './email-sender';
import { Notifier } from './notifier';

// Leaf module (ADR-0003): every module may send email, notifications calls nobody.
@Global()
@Module({
  providers: [
    { provide: EmailSender, useFactory: () => emailSenderFromEnv(process.env) },
    Notifier,
  ],
  exports: [EmailSender, Notifier],
})
export class NotificationsModule {}

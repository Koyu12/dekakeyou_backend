import { Global, Module } from '@nestjs/common';
import { ConsoleEmailSender, EmailSender } from './email-sender';

// Leaf module (ADR-0003): every module may send email, notifications calls nobody.
@Global()
@Module({
  providers: [{ provide: EmailSender, useClass: ConsoleEmailSender }],
  exports: [EmailSender],
})
export class NotificationsModule {}

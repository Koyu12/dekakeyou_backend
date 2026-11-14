import { Injectable, Logger } from '@nestjs/common';

export type Email = { to: string; subject: string; text: string };

// Swap the implementation per environment; e2e tests override it with a capturing fake.
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}

// shortcut: logs emails instead of sending them; replace with a real provider once #20 picks one.
@Injectable()
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  send({ to, subject, text }: Email) {
    this.logger.log(`to=${to} subject="${subject}"\n${text}`);
    return Promise.resolve();
  }
}

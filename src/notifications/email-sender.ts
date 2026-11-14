import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

export type Email = { to: string; subject: string; text: string };

// Swap the implementation per environment; e2e tests override it with a capturing fake.
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}

/** Local development without SMTP settings: emails (and login codes) go to the server log. */
@Injectable()
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  send({ to, subject, text }: Email) {
    this.logger.log(`to=${to} subject="${subject}"\n${text}`);
    return Promise.resolve();
  }
}

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
};

/** Any provider with SMTP credentials (Gmail app password, Brevo, Resend, SES, Mailpit, …). */
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    super();
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  async send(email: Email) {
    try {
      await this.transport.sendMail({ from: this.config.from, ...email });
    } catch (e) {
      // Nodemailer's message carries the SMTP reply, never the password.
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.error(`Sending "${email.subject}" failed: ${reason}`);
      throw new Error('Email could not be sent');
    }
  }
}

const SMTP_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
] as const;

/**
 * SMTP when SMTP_HOST is set, the console otherwise. A partial config throws, so a
 * misconfigured deploy fails at startup instead of on the first login attempt.
 */
export function emailSenderFromEnv(env: NodeJS.ProcessEnv): EmailSender {
  const set = SMTP_VARS.filter((k) => env[k]?.trim());
  if (set.length === 0) return new ConsoleEmailSender();

  const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'].filter(
    (k) => !env[k]?.trim(),
  );
  if (!!env.SMTP_USER?.trim() !== !!env.SMTP_PASSWORD?.trim()) {
    missing.push(env.SMTP_USER?.trim() ? 'SMTP_PASSWORD' : 'SMTP_USER');
  }
  if (missing.length > 0) {
    throw new Error(
      `SMTP is partly configured (${set.join(', ')} set); also set ${missing.join(', ')}, or unset them all to log emails to the console`,
    );
  }
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a port number, got "${env.SMTP_PORT}"`);
  }
  const secure = (env.SMTP_SECURE ?? '').trim().toLowerCase();
  if (secure && !['true', 'false'].includes(secure)) {
    throw new Error(`SMTP_SECURE must be true or false, got "${secure}"`);
  }

  return new SmtpEmailSender({
    host: env.SMTP_HOST!.trim(),
    port,
    // Implicit TLS (465) vs STARTTLS (587/25); defaults to TLS on 465.
    secure: secure ? secure === 'true' : port === 465,
    auth: env.SMTP_USER?.trim()
      ? { user: env.SMTP_USER.trim(), pass: env.SMTP_PASSWORD! }
      : undefined,
    from: env.SMTP_FROM!.trim(),
  });
}

import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp, setupSwagger } from '../../src/app.setup';
import type { Verdict } from '../../src/content-check/content-check.rules';
import { TextModerator } from '../../src/content-check/text-moderator';
import { Email, EmailSender } from '../../src/notifications/email-sender';
import { Notifier } from '../../src/notifications/notifier';
import { PrismaService } from '../../src/prisma/prisma.service';

// Captures outgoing email instead of sending it, so tests can read login codes.
export class CapturingEmailSender extends EmailSender {
  readonly sent: Email[] = [];
  /** Sends that throw before succeeding (to exercise job retries). */
  failNext = 0;
  send(email: Email) {
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new Error('SMTP is down'));
    }
    this.sent.push(email);
    return Promise.resolve();
  }
  lastTo(to: string) {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}

// Stands in for the AI moderation API; tests set the next verdict (default: pass).
export class FakeTextModerator extends TextModerator {
  verdict: Verdict = { result: 'PASS' };
  readonly checked: string[] = [];
  check(text: string) {
    this.checked.push(text);
    return Promise.resolve(this.verdict);
  }
}

export type TestApp = {
  app: INestApplication<App>;
  prisma: PrismaService;
  emails: CapturingEmailSender;
  moderator: FakeTextModerator;
  notifier: Notifier;
};

// Boots the real app (same setup as main.ts) against the test database.
export async function createTestApp(
  options: { controllers?: Type[] } = {},
): Promise<TestApp> {
  const emails = new CapturingEmailSender();
  const moderator = new FakeTextModerator();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(EmailSender)
    .useValue(emails)
    .overrideProvider(TextModerator)
    .useValue(moderator)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  setupSwagger(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    emails,
    moderator,
    notifier: app.get(Notifier),
  };
}

// Empties every table except Prisma's migration history, and drops queued jobs.
export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('DELETE FROM pgboss.job');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

// Better Auth checks the Origin of state-changing requests, like a browser would send.
export const ORIGIN = process.env.BETTER_AUTH_URL!;

export function requestOtp(t: TestApp, email: string) {
  return request(t.app.getHttpServer())
    .post('/api/auth/email-otp/send-verification-otp')
    .set('Origin', ORIGIN)
    .send({ email, type: 'sign-in' });
}

export function signInWithOtp(t: TestApp, email: string, otp: string) {
  return request(t.app.getHttpServer())
    .post('/api/auth/sign-in/email-otp')
    .set('Origin', ORIGIN)
    .send({ email, otp });
}

export function otpFromEmail(t: TestApp, email: string) {
  const otp = t.emails.lastTo(email)?.text.match(/\b(\d{6})\b/)?.[1];
  if (!otp) throw new Error(`No login code emailed to ${email}`);
  return otp;
}

/** Logs in through the real email-OTP flow and returns the session cookie header. */
export async function login(
  t: TestApp,
  email: string,
  options: { role?: 'admin' } = {},
) {
  await requestOtp(t, email).expect(200);
  const res = await signInWithOtp(t, email, otpFromEmail(t, email)).expect(200);
  if (options.role) {
    await t.prisma.user.update({
      where: { email },
      data: { role: options.role },
    });
  }
  const cookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!cookie?.length) throw new Error('Sign-in returned no session cookie');
  return cookie.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Waits until every queued job has run, so tests can assert on the captured emails.
 * Retries normally wait with backoff; here they're made due at once.
 */
export async function settleJobs(t: TestApp, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await t.prisma.$executeRawUnsafe(
      `UPDATE pgboss.job SET start_after = now() WHERE state IN ('created', 'retry') AND start_after > now()`,
    );
    const [{ pending }] = await t.prisma.$queryRawUnsafe<{ pending: number }[]>(
      `SELECT count(*)::int AS pending FROM pgboss.job WHERE state IN ('created', 'retry', 'active')`,
    );
    if (pending === 0) return;
    if (Date.now() > deadline) throw new Error(`${pending} jobs still pending`);
    for (const id of [t.notifier.workerId, t.notifier.changeWorkerId]) {
      if (id) t.notifier.boss.notifyWorker(id);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

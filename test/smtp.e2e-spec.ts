import { Logger } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import {
  createTestApp,
  requestOtp,
  resetDb,
  TestApp,
} from './support/test-app';

type Received = { from: string; to: string[]; raw: string };

// An in-process SMTP catcher: the real app sends real SMTP to it.
describe('SMTP email sender (e2e)', () => {
  let t: TestApp;
  let smtp: SMTPServer;
  const received: Received[] = [];
  let reject = false;

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      allowInsecureAuth: true,
      disabledCommands: ['STARTTLS'],
      onAuth(auth, _session, cb) {
        cb(null, { user: auth.username });
      },
      onRcptTo(_address, _session, cb) {
        cb(reject ? new Error('550 Mailbox unavailable') : null);
      },
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (c: Buffer) => (raw += c.toString()));
        stream.on('end', () => {
          received.push({
            from: session.envelope.mailFrom
              ? session.envelope.mailFrom.address
              : '',
            to: session.envelope.rcptTo.map((r) => r.address),
            raw,
          });
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
    const { port } = smtp.server.address() as AddressInfo;
    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: 'false',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'super-secret-pass',
      SMTP_FROM: 'Dekakeyou <no-reply@dekakeyou.test>',
    });
    t = await createTestApp({ realEmailSender: true });
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    received.length = 0;
    reject = false;
  });
  afterAll(async () => {
    await t.app.close();
    await new Promise<void>((r) => smtp.close(r));
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('SMTP_')) delete process.env[k];
    }
  });

  it('a requested login code arrives as a real SMTP message', async () => {
    await requestOtp(t, 'aya@example.com').expect(200);

    expect(received).toHaveLength(1);
    const [msg] = received;
    expect(msg.from).toBe('no-reply@dekakeyou.test');
    expect(msg.to).toEqual(['aya@example.com']);
    expect(msg.raw).toMatch(/^From: Dekakeyou <no-reply@dekakeyou\.test>/m);
    expect(msg.raw).toMatch(/^To: aya@example\.com/m);
    expect(msg.raw).toMatch(/^Subject: Your Dekakeyou login code/m);
    expect(msg.raw).toMatch(/Your login code is \d{6}\./);
  });

  it('a failed send is logged with the SMTP error, without credentials', async () => {
    reject = true;
    const logged: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((m: unknown) => void logged.push(String(m)));

    // Better Auth sends login codes in the background and answers 200 either way,
    // so the response never reveals whether mail went out.
    const res = await requestOtp(t, 'aya@example.com').expect(200);
    for (let i = 0; i < 40 && !logged.join().includes('550'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    spy.mockRestore();

    expect(received).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
    const log = logged.join('\n');
    expect(log).toContain('550 Mailbox unavailable');
    expect(log).not.toContain('super-secret-pass');
  });
});

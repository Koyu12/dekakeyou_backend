import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { Roles } from '../src/common/auth/auth.decorators';
import {
  createTestApp,
  login,
  ORIGIN,
  otpFromEmail,
  requestOtp,
  resetDb,
  signInWithOtp,
  TestApp,
} from './support/test-app';

// Test-only endpoints: one needing just a login (the default), one admin-only.
@Controller('__test/auth')
class GuardProbeController {
  @Get('member')
  member() {
    return { ok: true };
  }

  @Roles('admin')
  @Get('admin')
  adminOnly() {
    return { ok: true };
  }
}

describe('Auth (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp({ controllers: [GuardProbeController] });
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.emails.sent.length = 0;
  });
  afterAll(() => t.app.close());

  describe('email OTP login', () => {
    it('emails a 6-digit code and signs up on first login, setting a session cookie', async () => {
      await requestOtp(t, 'aya@example.com').expect(200);
      const mail = t.emails.lastTo('aya@example.com');
      expect(mail?.subject).toBe('Your Dekakeyou login code');

      const res = await signInWithOtp(
        t,
        'aya@example.com',
        otpFromEmail(t, 'aya@example.com'),
      ).expect(200);

      expect(res.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('session_token')]),
      );
      expect(
        await t.prisma.user.count({ where: { email: 'aya@example.com' } }),
      ).toBe(1);
    });

    it('rejects a wrong code', async () => {
      await requestOtp(t, 'aya@example.com').expect(200);
      const res = await signInWithOtp(t, 'aya@example.com', '000000');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('logging in again reuses the same account', async () => {
      await login(t, 'aya@example.com');
      await login(t, 'aya@example.com');
      expect(
        await t.prisma.user.count({ where: { email: 'aya@example.com' } }),
      ).toBe(1);
    });

    it('logout ends the session', async () => {
      const cookie = await login(t, 'aya@example.com');
      await http()
        .post('/api/auth/sign-out')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .expect(200);
      await http().get('/api/v1/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('current user', () => {
    it('returns the logged-in user, uncached', async () => {
      const cookie = await login(t, 'aya@example.com');
      const res = await http()
        .get('/api/v1/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        email: 'aya@example.com',
        image: null,
        role: 'user',
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns 401 UNAUTHENTICATED without a session', async () => {
      const res = await http().get('/api/v1/me').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('global guard', () => {
    it('rejects anonymous requests to endpoints without @Public()', async () => {
      const res = await http().get('/api/v1/__test/auth/member').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('allows anonymous requests to @Public() endpoints', async () => {
      await http().get('/api/v1/categories').expect(200);
    });

    it('admin-only endpoint: 403 FORBIDDEN for a normal user', async () => {
      const cookie = await login(t, 'aya@example.com');
      const res = await http()
        .get('/api/v1/__test/auth/admin')
        .set('Cookie', cookie)
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('admin-only endpoint: allowed for an admin', async () => {
      const cookie = await login(t, 'boss@example.com', { role: 'admin' });
      await http()
        .get('/api/v1/__test/auth/admin')
        .set('Cookie', cookie)
        .expect(200);
    });
  });

  describe('bans', () => {
    it('a banned user cannot log in', async () => {
      await login(t, 'bad@example.com');
      await t.prisma.user.update({
        where: { email: 'bad@example.com' },
        data: { banned: true, banReason: 'spam' },
      });

      await requestOtp(t, 'bad@example.com');
      const otp = t.emails.lastTo('bad@example.com')?.text.match(/\d{6}/)?.[0];
      const res = await signInWithOtp(t, 'bad@example.com', otp ?? '000000');

      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('an existing session stops working once the user is banned', async () => {
      const cookie = await login(t, 'bad@example.com');
      await t.prisma.user.update({
        where: { email: 'bad@example.com' },
        data: { banned: true },
      });
      const res = await http()
        .get('/api/v1/me')
        .set('Cookie', cookie)
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('an expired temporary ban no longer blocks requests', async () => {
      const cookie = await login(t, 'bad@example.com');
      await t.prisma.user.update({
        where: { email: 'bad@example.com' },
        data: { banned: true, banExpires: new Date(Date.now() - 1000) },
      });
      await http().get('/api/v1/me').set('Cookie', cookie).expect(200);
    });
  });

  describe('Google', () => {
    it('is enabled by env and redirects to Google', async () => {
      const res = await http()
        .post('/api/auth/sign-in/social')
        .set('Origin', ORIGIN)
        .send({ provider: 'google', callbackURL: '/' })
        .expect(200);
      expect(res.body.url).toContain('accounts.google.com');
      expect(res.body.url).toContain('test-google-client-id');
    });
  });
});

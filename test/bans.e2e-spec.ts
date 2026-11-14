import request from 'supertest';
import {
  createTestApp,
  login,
  otpFromEmail,
  requestOtp,
  resetDb,
  signInWithOtp,
  TestApp,
} from './support/test-app';

describe('Admin bans (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let bad: string; // the user who gets banned
  let badId: string;
  let org: string;
  let aya: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  const hostEvent = async (cookie: string, title: string) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', cookie)
      .send({
        title,
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        capacity: 5,
      })
      .expect(201);
    return res.body as { id: string; slug: string };
  };
  const join = (cookie: string, eventId: string) =>
    http()
      .post(`/api/v1/events/${eventId}/reservation`)
      .set('Cookie', cookie)
      .expect(201);
  const ban = (body: object, userId = badId, cookie = admin) =>
    http()
      .post(`/api/v1/admin/users/${userId}/ban`)
      .set('Cookie', cookie)
      .send(body);
  const event = (id: string) =>
    t.prisma.event.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    bad = await login(t, 'bad@example.com');
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    badId = (
      await t.prisma.user.findUniqueOrThrow({
        where: { email: 'bad@example.com' },
      })
    ).id;
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('the Admin finds a user by email', async () => {
    const res = await http()
      .get('/api/v1/admin/users?email=BAD@example.com')
      .set('Cookie', admin)
      .expect(200);
    expect(res.body).toMatchObject({
      id: badId,
      email: 'bad@example.com',
      banned: false,
    });
  });

  it('a ban logs the user out immediately and blocks logging in again', async () => {
    const res = await ban({ reason: 'Posting spam' }).expect(200);
    expect(res.body.account).toMatchObject({
      banned: true,
      banReason: 'Posting spam',
      banExpires: null,
    });

    expect(await t.prisma.session.count({ where: { userId: badId } })).toBe(0);
    await http().get('/api/v1/me').set('Cookie', bad).expect(401);

    await requestOtp(t, 'bad@example.com');
    const otp =
      t.emails.lastTo('bad@example.com')?.text.match(/\d{6}/)?.[0] ?? '000000';
    expect((await signInWithOtp(t, 'bad@example.com', otp)).status).toBe(403);
  });

  it("removes the user's live Hosted Events with the ban reason, voiding their Attendees' places", async () => {
    const live = await hostEvent(bad, 'Spam meetup');
    const flagged = await hostEvent(bad, 'Flagged meetup');
    const cancelled = await hostEvent(bad, 'Old meetup');
    await join(aya, live.id);
    await t.prisma.event.update({
      where: { id: flagged.id },
      data: { status: 'UNDER_REVIEW', reviewReason: 'REPORTED' },
    });
    await t.prisma.report.create({
      data: {
        eventId: flagged.id,
        reporterId: (
          await t.prisma.user.findUniqueOrThrow({
            where: { email: 'aya@example.com' },
          })
        ).id,
        reason: 'SPAM',
      },
    });
    await http()
      .post(`/api/v1/events/${cancelled.id}/cancel`)
      .set('Cookie', bad)
      .expect(200);

    const res = await ban({ reason: 'Posting spam' }).expect(200);
    expect(res.body.removedEvents).toBe(2);

    expect(await event(live.id)).toMatchObject({
      status: 'REMOVED',
      removedReason: 'Posting spam',
      reservedCount: 0,
    });
    expect(await event(flagged.id)).toMatchObject({ status: 'REMOVED' });
    expect((await event(cancelled.id)).status).toBe('CANCELLED'); // already off; left as is
    const ayaPlace = await t.prisma.reservation.findFirstOrThrow({
      where: { eventId: live.id },
    });
    expect(ayaPlace.status).toBe('VOID');
    expect(
      (
        await t.prisma.report.findFirstOrThrow({
          where: { eventId: flagged.id },
        })
      ).status,
    ).toBe('ACTIONED');
    await http().get(`/api/v1/events/${live.slug}`).expect(404);
  });

  it("withdraws the user's Active places on upcoming Events, freeing them; past attendance is kept", async () => {
    const upcoming = await hostEvent(org, 'Upcoming party');
    const past = await hostEvent(org, 'Past party');
    await join(bad, upcoming.id);
    await join(bad, past.id);
    await t.prisma.event.update({
      where: { id: past.id },
      data: {
        startsAt: new Date('2026-01-01T10:00:00Z'),
        endsAt: new Date('2026-01-01T12:00:00Z'),
      },
    });

    const res = await ban({ reason: 'Harassment' }).expect(200);
    expect(res.body.withdrawnReservations).toBe(1);

    expect((await event(upcoming.id)).reservedCount).toBe(0);
    const places = await t.prisma.reservation.findMany({
      where: { attendeeId: badId },
      include: { event: true },
    });
    expect(
      Object.fromEntries(places.map((p) => [p.event.title, p.status])),
    ).toEqual({
      'Upcoming party': 'WITHDRAWN',
      'Past party': 'ACTIVE',
    });
    await join(aya, upcoming.id); // the freed place is usable
  });

  describe('temporary bans and unbanning', () => {
    it('an expired temporary ban allows logging in again', async () => {
      const soon = new Date(Date.now() + 60_000).toISOString();
      await ban({ reason: 'Cool off', expiresAt: soon }).expect(200);
      await t.prisma.user.update({
        where: { id: badId },
        data: { banExpires: new Date(Date.now() - 1000) },
      });

      await requestOtp(t, 'bad@example.com').expect(200);
      const res = await signInWithOtp(
        t,
        'bad@example.com',
        otpFromEmail(t, 'bad@example.com'),
      );
      expect(res.status).toBe(200);
    });

    it('a ban must expire in the future', async () => {
      const res = await ban({
        reason: 'Oops',
        expiresAt: '2020-01-01T00:00:00Z',
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('unban lifts it, but does not bring back Removed Events', async () => {
      const live = await hostEvent(bad, 'Spam meetup');
      await ban({ reason: 'Posting spam' }).expect(200);

      const res = await http()
        .post(`/api/v1/admin/users/${badId}/unban`)
        .set('Cookie', admin)
        .expect(200);
      expect(res.body).toMatchObject({
        banned: false,
        banReason: null,
        banExpires: null,
      });

      const again = await login(t, 'bad@example.com');
      await http().get('/api/v1/me').set('Cookie', again).expect(200);
      expect((await event(live.id)).status).toBe('REMOVED');
    });
  });

  describe('guards', () => {
    it("the Admin can't ban themselves", async () => {
      const adminId = (
        await t.prisma.user.findUniqueOrThrow({
          where: { email: 'admin@example.com' },
        })
      ).id;
      const res = await ban({ reason: 'Testing' }, adminId).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('Admin-only; unknown user → 404', async () => {
      await ban({ reason: 'Nope' }, badId, aya).expect(403);
      await http()
        .post(`/api/v1/admin/users/${badId}/ban`)
        .send({ reason: 'Nope' })
        .expect(401);
      await ban({ reason: 'Nope' }, 'no-such-user').expect(404);
    });

    it("Better Auth's own admin endpoints are switched off (they'd skip the cleanup)", async () => {
      for (const path of [
        'ban-user',
        'unban-user',
        'remove-user',
        'set-role',
        'impersonate-user',
      ]) {
        const res = await http()
          .post(`/api/auth/admin/${path}`)
          .set('Origin', process.env.BETTER_AUTH_URL!)
          .set('Cookie', admin)
          .send({ userId: badId });
        expect(res.status).toBe(404);
      }
      expect(
        (await t.prisma.user.findUniqueOrThrow({ where: { id: badId } }))
          .banned,
      ).toBe(false);
    });
  });
});

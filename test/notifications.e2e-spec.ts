import request from 'supertest';
import { EMAIL_QUEUE } from '../src/notifications/notifier';
import {
  createTestApp,
  login,
  resetDb,
  settleJobs,
  TestApp,
} from './support/test-app';

describe('Cancelled/Removed emails via background jobs (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let org: string;
  let aya: string;
  let ben: string;
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
  const userId = async (email: string) =>
    (await t.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  /** Event emails only (login codes are sent directly, not as jobs). */
  const eventEmails = () =>
    t.emails.sent
      .filter((e) => !/\b\d{6}\b/.test(e.text))
      .map((e) => ({ to: e.to, subject: e.subject }))
      .sort((a, b) => a.to.localeCompare(b.to));

  /** An Event by org@ with aya@ and ben@ holding places; ben withdraws, so only aya is Active. */
  const eventWithAttendees = async () => {
    const e = await hostEvent(org, 'Cosplay picnic');
    await join(aya, e.id);
    await join(ben, e.id);
    await http()
      .delete(`/api/v1/events/${e.id}/reservation`)
      .set('Cookie', ben)
      .expect(200);
    t.emails.sent.length = 0;
    return e;
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    ben = await login(t, 'ben@example.com');
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('Organizer cancels → each Active Attendee is emailed once', async () => {
    const e = await eventWithAttendees();
    await http()
      .post(`/api/v1/events/${e.id}/cancel`)
      .set('Cookie', org)
      .expect(200);
    await settleJobs(t);

    expect(eventEmails()).toEqual([
      { to: 'aya@example.com', subject: 'Cancelled: Cosplay picnic' },
    ]);
    expect(t.emails.lastTo('aya@example.com')?.text).toContain(
      'Reservation is void',
    );
  });

  it('Admin removes → Attendees are emailed, and the Organizer gets the reason', async () => {
    const e = await eventWithAttendees();
    await http()
      .post(`/api/v1/admin/moderation/events/${e.id}/remove`)
      .set('Cookie', admin)
      .send({ reason: 'Selling counterfeit goods' })
      .expect(200);
    await settleJobs(t);

    expect(eventEmails()).toEqual([
      { to: 'aya@example.com', subject: 'Removed: Cosplay picnic' },
      {
        to: 'org@example.com',
        subject: 'Your Event was removed: Cosplay picnic',
      },
    ]);
    expect(t.emails.lastTo('org@example.com')?.text).toContain(
      'Reason: Selling counterfeit goods',
    );
    expect(t.emails.lastTo('aya@example.com')?.text).not.toContain(
      'counterfeit',
    );
  });

  it('a ban removes the Organizer’s Events → same emails as an Admin removal', async () => {
    await eventWithAttendees();
    await http()
      .post(`/api/v1/admin/users/${await userId('org@example.com')}/ban`)
      .set('Cookie', admin)
      .send({ reason: 'Repeated scams' })
      .expect(200);
    await settleJobs(t);

    expect(eventEmails().map((e) => e.to)).toEqual([
      'aya@example.com',
      'org@example.com',
    ]);
    expect(t.emails.lastTo('org@example.com')?.text).toContain(
      'Reason: Repeated scams',
    );
  });

  it('account deletion cancels the Organizer’s Events → Attendees are emailed', async () => {
    await eventWithAttendees();
    await http().delete('/api/v1/me').set('Cookie', org).expect(204);
    await settleJobs(t);

    expect(eventEmails()).toEqual([
      { to: 'aya@example.com', subject: 'Cancelled: Cosplay picnic' },
    ]);
  });

  it('a transaction that rolls back queues no emails', async () => {
    const e = await eventWithAttendees();
    await expect(
      t.prisma.$transaction(async (tx) => {
        await t.notifier.queue(tx, [
          {
            type: 'EVENT_CANCELLED',
            eventId: e.id,
            userId: await userId('aya@example.com'),
          },
        ]);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(
      await t.prisma.$queryRawUnsafe(
        `SELECT id FROM pgboss.job WHERE name = '${EMAIL_QUEUE}'`,
      ),
    ).toEqual([]);
  });

  it('a failing send is retried', async () => {
    const e = await eventWithAttendees();
    t.emails.failNext = 2;
    await http()
      .post(`/api/v1/events/${e.id}/cancel`)
      .set('Cookie', org)
      .expect(200);
    await settleJobs(t);

    expect(eventEmails()).toEqual([
      { to: 'aya@example.com', subject: 'Cancelled: Cosplay picnic' },
    ]);
  });

  it('queued jobs survive an app restart', async () => {
    const e = await eventWithAttendees();
    await t.notifier.boss.offWork(EMAIL_QUEUE); // nothing gets sent before the restart
    await http()
      .post(`/api/v1/events/${e.id}/cancel`)
      .set('Cookie', org)
      .expect(200);
    await t.app.close();
    expect(t.emails.sent).toEqual([]);

    t = await createTestApp();
    await settleJobs(t);
    expect(eventEmails()).toEqual([
      { to: 'aya@example.com', subject: 'Cancelled: Cosplay picnic' },
    ]);
  });
});

import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Account deletion (e2e)', () => {
  let t: TestApp;
  let leaver: string; // the user who deletes their account
  let leaverId: string;
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
  const deleteAccount = (cookie = leaver) =>
    http().delete('/api/v1/me').set('Cookie', cookie);
  const event = (id: string) =>
    t.prisma.event.findUniqueOrThrow({ where: { id } });
  const makePast = (id: string) =>
    t.prisma.event.update({
      where: { id },
      data: {
        startsAt: new Date('2026-01-01T10:00:00Z'),
        endsAt: new Date('2026-01-01T12:00:00Z'),
      },
    });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    leaver = await login(t, 'leaver@example.com');
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    leaverId = (
      await t.prisma.user.findUniqueOrThrow({
        where: { email: 'leaver@example.com' },
      })
    ).id;
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('wipes personal data and logs the user out everywhere', async () => {
    await t.prisma.user.update({
      where: { id: leaverId },
      data: { image: 'https://cdn.example/me.png' },
    });
    await t.prisma.account.create({
      data: {
        id: 'google-link',
        accountId: 'g-123',
        providerId: 'google',
        userId: leaverId,
      },
    });

    await deleteAccount().expect(204);

    const row = await t.prisma.user.findUniqueOrThrow({
      where: { id: leaverId },
    });
    expect(row).toMatchObject({
      name: 'Deleted user',
      image: null,
      emailVerified: false,
    });
    expect(row.email).not.toContain('leaver');
    expect(row.deletedAt).not.toBeNull();
    expect(await t.prisma.session.count({ where: { userId: leaverId } })).toBe(
      0,
    );
    expect(await t.prisma.account.count({ where: { userId: leaverId } })).toBe(
      0,
    );
    await http().get('/api/v1/me').set('Cookie', leaver).expect(401);
  });

  it("cancels the user's upcoming Hosted Events and voids their Attendees' places", async () => {
    const upcoming = await hostEvent(leaver, 'Upcoming meetup');
    const flagged = await hostEvent(leaver, 'Flagged meetup');
    const past = await hostEvent(leaver, 'Past meetup');
    await join(aya, upcoming.id);
    await join(aya, past.id);
    await t.prisma.event.update({
      where: { id: flagged.id },
      data: { status: 'UNDER_REVIEW', reviewReason: 'REPORTED' },
    });
    await makePast(past.id);

    await deleteAccount().expect(204);

    expect(await event(upcoming.id)).toMatchObject({
      status: 'CANCELLED',
      reservedCount: 0,
    });
    expect((await event(flagged.id)).status).toBe('CANCELLED');
    expect((await event(past.id)).status).toBe('PUBLISHED'); // history stays
    const places = await t.prisma.reservation.findMany({
      include: { event: true },
    });
    expect(
      Object.fromEntries(places.map((p) => [p.event.title, p.status])),
    ).toEqual({ 'Upcoming meetup': 'VOID', 'Past meetup': 'ACTIVE' });

    // The Cancelled Event is still public, shown under the anonymized Organizer.
    const res = await http().get(`/api/v1/events/${upcoming.slug}`).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(JSON.stringify(res.body)).not.toContain('leaver');
  });

  it("withdraws the user's Active places on upcoming Events; past attendance is kept", async () => {
    const upcoming = await hostEvent(org, 'Upcoming party');
    const past = await hostEvent(org, 'Past party');
    await join(leaver, upcoming.id);
    await join(leaver, past.id);
    await makePast(past.id);

    await deleteAccount().expect(204);

    expect((await event(upcoming.id)).reservedCount).toBe(0);
    const places = await t.prisma.reservation.findMany({
      where: { attendeeId: leaverId },
      include: { event: true },
    });
    expect(
      Object.fromEntries(places.map((p) => [p.event.title, p.status])),
    ).toEqual({ 'Upcoming party': 'WITHDRAWN', 'Past party': 'ACTIVE' });
    await join(aya, upcoming.id); // the freed place is usable
  });

  it('Reports stay attached to the anonymized user', async () => {
    const e = await hostEvent(org, 'Some event');
    await http()
      .post(`/api/v1/events/${e.id}/reports`)
      .set('Cookie', leaver)
      .send({ reason: 'SPAM' })
      .expect(201);

    await deleteAccount().expect(204);

    const report = await t.prisma.report.findFirstOrThrow({
      include: { reporter: true },
    });
    expect(report.reporter.name).toBe('Deleted user');
  });

  it('signing up again with the same email creates a fresh account', async () => {
    await deleteAccount().expect(204);

    const again = await login(t, 'leaver@example.com');
    const me = await http().get('/api/v1/me').set('Cookie', again).expect(200);
    expect(me.body.id).not.toBe(leaverId);
    expect(me.body.email).toBe('leaver@example.com');
  });

  it('requires login', async () => {
    await http().delete('/api/v1/me').expect(401);
  });
});

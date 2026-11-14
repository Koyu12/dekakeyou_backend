import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Reservations (e2e)', () => {
  let t: TestApp;
  let org: string; // the Organizer
  let aya: string;
  let ben: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const hostEvent = async (over: object = {}) => {
    const startsAt = inAWeek();
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title: 'Anime watch party',
        categoryId,
        isOnline: true,
        onlineUrl: 'https://discord.gg/secret-room',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3 * 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        capacity: 2,
        ...over,
      })
      .expect(201);
    return res.body as { id: string; slug: string };
  };
  const join = (cookie: string, eventId: string) =>
    http().post(`/api/v1/events/${eventId}/reservation`).set('Cookie', cookie);
  const withdraw = (cookie: string, eventId: string) =>
    http()
      .delete(`/api/v1/events/${eventId}/reservation`)
      .set('Cookie', cookie);
  const counts = async (eventId: string) => {
    const event = await t.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    const active = await t.prisma.reservation.count({
      where: { eventId, status: 'ACTIVE' },
    });
    return { reservedCount: event.reservedCount, active };
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    [org, aya, ben] = [
      await login(t, 'org@example.com'),
      await login(t, 'aya@example.com'),
      await login(t, 'ben@example.com'),
    ];
    categoryId = (await t.prisma.category.create({ data: { name: 'Anime' } }))
      .id;
  });
  afterAll(() => t.app.close());

  describe('join', () => {
    it('takes a place and returns the Reservation with the online link, uncached', async () => {
      const event = await hostEvent();
      const res = await join(aya, event.id).expect(201);

      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        event: { id: event.id, title: 'Anime watch party' },
        onlineUrl: 'https://discord.gg/secret-room',
      });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(await counts(event.id)).toEqual({ reservedCount: 1, active: 1 });
    });

    it('rejects a full Event with EVENT_FULL', async () => {
      const event = await hostEvent({ capacity: 1 });
      await join(aya, event.id).expect(201);
      const res = await join(ben, event.id).expect(409);
      expect(res.body.code).toBe('EVENT_FULL');
    });

    it("rejects the Organizer's own Event with OWN_EVENT", async () => {
      const event = await hostEvent();
      const res = await join(org, event.id).expect(409);
      expect(res.body.code).toBe('OWN_EVENT');
    });

    it('rejects a second join with ALREADY_RESERVED', async () => {
      const event = await hostEvent();
      await join(aya, event.id).expect(201);
      const res = await join(aya, event.id).expect(409);
      expect(res.body.code).toBe('ALREADY_RESERVED');
      expect(await counts(event.id)).toEqual({ reservedCount: 1, active: 1 });
    });

    it('rejects after the start time with JOIN_CLOSED', async () => {
      const event = await hostEvent();
      await t.prisma.event.update({
        where: { id: event.id },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });
      const res = await join(aya, event.id).expect(409);
      expect(res.body.code).toBe('JOIN_CLOSED');
    });

    it('rejects Listed and Under Review Events with EVENT_NOT_JOINABLE', async () => {
      const event = await hostEvent();
      await t.prisma.event.update({
        where: { id: event.id },
        data: { status: 'UNDER_REVIEW' },
      });
      const res = await join(aya, event.id).expect(409);
      expect(res.body.code).toBe('EVENT_NOT_JOINABLE');
    });

    it('unknown Event → 404; anonymous → 401', async () => {
      await join(aya, '01900000-0000-7000-8000-000000000000').expect(404);
      const event = await hostEvent();
      await http().post(`/api/v1/events/${event.id}/reservation`).expect(401);
    });
  });

  describe('withdraw and re-join', () => {
    it('withdrawing frees the place; re-joining reactivates the same row', async () => {
      const event = await hostEvent({ capacity: 1 });
      const first = await join(aya, event.id).expect(201);

      const out = await withdraw(aya, event.id).expect(200);
      expect(out.body).toMatchObject({
        id: first.body.id,
        status: 'WITHDRAWN',
        onlineUrl: null,
      });
      expect(await counts(event.id)).toEqual({ reservedCount: 0, active: 0 });

      await join(ben, event.id).expect(201); // the freed place is usable
      await withdraw(ben, event.id).expect(200);

      const again = await join(aya, event.id).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(
        await t.prisma.reservation.count({ where: { eventId: event.id } }),
      ).toBe(2); // one row per Attendee
    });

    it('rejects withdrawing without a place (NOT_RESERVED) or after the start (WITHDRAW_CLOSED)', async () => {
      const event = await hostEvent();
      expect((await withdraw(aya, event.id).expect(409)).body.code).toBe(
        'NOT_RESERVED',
      );

      await join(aya, event.id).expect(201);
      await t.prisma.event.update({
        where: { id: event.id },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });
      expect((await withdraw(aya, event.id).expect(409)).body.code).toBe(
        'WITHDRAW_CLOSED',
      );
    });
  });

  describe('concurrency', () => {
    it('N simultaneous joins never exceed Capacity C', async () => {
      const N = 12;
      const C = 5;
      const event = await hostEvent({ capacity: C });
      const cookies: string[] = [];
      for (let i = 0; i < N; i++)
        cookies.push(await login(t, `fan${i}@example.com`));

      const results = await Promise.all(cookies.map((c) => join(c, event.id)));

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(C);
      expect(statuses.filter((s) => s === 409)).toHaveLength(N - C);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => r.body.code === 'EVENT_FULL'),
      ).toBe(true);
      expect(await counts(event.id)).toEqual({ reservedCount: C, active: C });
    });

    it('a Withdrawn Attendee double-clicking Join ends with one place and count +1', async () => {
      const event = await hostEvent();
      await join(aya, event.id).expect(201);
      await withdraw(aya, event.id).expect(200);

      const [a, b] = await Promise.all([
        join(aya, event.id),
        join(aya, event.id),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((r) => r.status === 409)?.body.code).toBe(
        'ALREADY_RESERVED',
      );
      expect(await counts(event.id)).toEqual({ reservedCount: 1, active: 1 });
    });
  });

  describe('Capacity changes', () => {
    it("the Organizer can't lower Capacity below the places taken", async () => {
      const event = await hostEvent({ capacity: 2 });
      await join(aya, event.id).expect(201);
      await join(ben, event.id).expect(201);

      const res = await http()
        .patch(`/api/v1/events/${event.id}`)
        .set('Cookie', org)
        .send({ capacity: 1 })
        .expect(409);
      expect(res.body.code).toBe('CAPACITY_BELOW_RESERVED');
    });

    it('delete is refused while Active Reservations exist, allowed after they withdraw', async () => {
      const event = await hostEvent();
      await join(aya, event.id).expect(201);
      await http()
        .delete(`/api/v1/events/${event.id}`)
        .set('Cookie', org)
        .expect(409);

      await withdraw(aya, event.id).expect(200);
      await http()
        .delete(`/api/v1/events/${event.id}`)
        .set('Cookie', org)
        .expect(204);
    });
  });

  describe('My Reservations', () => {
    it('lists upcoming and past places with status; the link only while Active', async () => {
      const upcoming = await hostEvent({ title: 'Upcoming party' });
      const past = await hostEvent({ title: 'Past party' });
      const left = await hostEvent({ title: 'Left party' });
      await join(aya, upcoming.id).expect(201);
      await join(aya, past.id).expect(201);
      await join(aya, left.id).expect(201);
      await withdraw(aya, left.id).expect(200);
      await t.prisma.event.update({
        where: { id: past.id },
        data: {
          startsAt: new Date('2026-01-01T10:00:00Z'),
          endsAt: new Date('2026-01-01T12:00:00Z'),
        },
      });
      // Void arrives with cancellation (#10); set it directly to show it is listed.
      // Age the first 3 Events so the Organizer's 3-per-day limit allows a 4th.
      await t.prisma.event.updateMany({
        data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
      });
      const voided = await hostEvent({ title: 'Called off party' });
      await join(aya, voided.id).expect(201);
      await t.prisma.reservation.updateMany({
        where: { eventId: voided.id },
        data: { status: 'VOID' },
      });

      const res = await http()
        .get('/api/v1/me/reservations')
        .set('Cookie', aya)
        .expect(200);
      const byTitle = Object.fromEntries(
        res.body.map((r: { event: { title: string } }) => [r.event.title, r]),
      );

      expect(res.body).toHaveLength(4);
      expect(byTitle['Upcoming party']).toMatchObject({
        status: 'ACTIVE',
        onlineUrl: expect.any(String),
      });
      expect(byTitle['Past party'].status).toBe('ACTIVE');
      expect(byTitle['Left party']).toMatchObject({
        status: 'WITHDRAWN',
        onlineUrl: null,
      });
      expect(byTitle['Called off party']).toMatchObject({
        status: 'VOID',
        onlineUrl: null,
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe("Organizer's Attendee list", () => {
    it('shows display name and avatar of Active Attendees only, never email', async () => {
      const event = await hostEvent();
      await t.prisma.user.update({
        where: { email: 'aya@example.com' },
        data: { name: 'Aya' },
      });
      await join(aya, event.id).expect(201);
      await join(ben, event.id).expect(201);
      await withdraw(ben, event.id).expect(200);

      const res = await http()
        .get(`/api/v1/me/events/${event.id}/attendees`)
        .set('Cookie', org)
        .expect(200);

      expect(res.body).toEqual([
        {
          id: expect.any(String),
          name: 'Aya',
          image: null,
          joinedAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('@example.com');
    });

    it("someone else's Event → 404", async () => {
      const event = await hostEvent();
      await http()
        .get(`/api/v1/me/events/${event.id}/attendees`)
        .set('Cookie', aya)
        .expect(404);
    });
  });

  it('the public Event detail never includes the online link', async () => {
    const event = await hostEvent();
    await join(aya, event.id).expect(201);
    const pub = await http()
      .get(`/api/v1/events/${event.slug}`)
      .set('Cookie', aya)
      .expect(200);
    expect(JSON.stringify(pub.body)).not.toContain('secret-room');
    expect(pub.body.reservedCount).toBe(1);
  });
});

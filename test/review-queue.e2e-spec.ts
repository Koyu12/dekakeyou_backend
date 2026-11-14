import request from 'supertest';
import { ReservationsService } from '../src/reservations/reservations.service';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Admin review queue (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let org: string;
  let fans: string[];
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());
  const base = '/api/v1/admin/moderation';

  const hostEvent = async (title = 'Cosplay photo walk') => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title,
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
      })
      .expect(201);
    return res.body as { id: string; slug: string };
  };
  const report = (cookie: string, eventId: string, reason = 'INDECENT') =>
    http()
      .post(`/api/v1/events/${eventId}/reports`)
      .set('Cookie', cookie)
      .send({ reason })
      .expect(201);
  const hideByReports = async (eventId: string) => {
    for (const f of fans.slice(0, 3)) await report(f, eventId);
  };
  const join = (cookie: string, eventId: string) =>
    http()
      .post(`/api/v1/events/${eventId}/reservation`)
      .set('Cookie', cookie)
      .expect(201);
  const row = (id: string) =>
    t.prisma.event.findUniqueOrThrow({ where: { id } });
  const reportStatuses = async (eventId: string) =>
    (await t.prisma.report.findMany({ where: { eventId } }))
      .map((r) => r.status)
      .sort();

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    org = await login(t, 'org@example.com');
    fans = [];
    for (let i = 0; i < 4; i++)
      fans.push(await login(t, `fan${i}@example.com`));
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  describe('queue', () => {
    it('lists Under Review Events with their reason and Open Reports, first', async () => {
      const listed = await t.prisma.event.create({
        data: {
          slug: 'comifuro',
          kind: 'LISTED',
          status: 'PUBLISHED',
          title: 'COMIFURO 21',
          description: '',
          categoryId,
          isOnline: true,
          startsAt: new Date('2027-01-10T03:00:00Z'),
          endsAt: new Date('2027-01-11T11:00:00Z'),
          timeZone: 'Asia/Jakarta',
        },
      });
      await report(fans[0], listed.id, 'WRONG_INFO');
      const hidden = await hostEvent();
      await hideByReports(hidden.id);
      await hostEvent('Clean event'); // nothing to review: not listed

      const res = await http()
        .get(`${base}/queue`)
        .set('Cookie', admin)
        .expect(200);

      expect(
        res.body.map((i: { event: { title: string } }) => i.event.title),
      ).toEqual(['Cosplay photo walk', 'COMIFURO 21']);
      expect(res.body[0].event).toMatchObject({
        status: 'UNDER_REVIEW',
        reviewReason: 'REPORTED',
      });
      expect(res.body[0].openReports).toHaveLength(3);
      expect(res.body[0].openReports[0]).toMatchObject({
        reason: 'INDECENT',
        reporter: { name: expect.any(String) },
      });
      expect(res.body[1]).toMatchObject({
        event: { kind: 'LISTED', status: 'PUBLISHED', reviewReason: null },
        openReports: [expect.objectContaining({ reason: 'WRONG_INFO' })],
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('includes Events held by the automatic check', async () => {
      t.moderator.verdict = { result: 'BORDERLINE', reason: 'Possibly sexual' };
      await hostEvent();
      t.moderator.verdict = { result: 'PASS' };
      const res = await http()
        .get(`${base}/queue`)
        .set('Cookie', admin)
        .expect(200);
      expect(res.body[0].event.reviewReason).toBe('AUTO_CHECK');
      expect(res.body[0].openReports).toEqual([]);
    });
  });

  describe('restore', () => {
    it('makes the Event public again and Dismisses its Open Reports', async () => {
      const event = await hostEvent();
      await hideByReports(event.id);
      await http().get(`/api/v1/events/${event.slug}`).expect(404);

      const res = await http()
        .post(`${base}/events/${event.id}/restore`)
        .set('Cookie', admin)
        .expect(200);

      expect(res.body).toEqual({
        eventId: event.id,
        status: 'PUBLISHED',
        resolvedReports: 3,
      });
      expect(await row(event.id)).toMatchObject({
        status: 'PUBLISHED',
        reviewReason: null,
      });
      await http().get(`/api/v1/events/${event.slug}`).expect(200);
      expect(await reportStatuses(event.id)).toEqual([
        'DISMISSED',
        'DISMISSED',
        'DISMISSED',
      ]);
    });

    it("the same old Reports don't hide it again; 3 new ones would", async () => {
      const event = await hostEvent();
      await hideByReports(event.id);
      await http()
        .post(`${base}/events/${event.id}/restore`)
        .set('Cookie', admin)
        .expect(200);

      await report(fans[3], event.id); // 1 new Open Report
      expect((await row(event.id)).status).toBe('PUBLISHED');
    });

    it('a flagged Cancelled Event stays Cancelled but becomes visible', async () => {
      const event = await hostEvent();
      await hideByReports(event.id);
      await http()
        .post(`/api/v1/events/${event.id}/cancel`)
        .set('Cookie', org)
        .expect(200);
      await http().get(`/api/v1/events/${event.slug}`).expect(404);

      await http()
        .post(`${base}/events/${event.id}/restore`)
        .set('Cookie', admin)
        .expect(200);

      expect(await row(event.id)).toMatchObject({
        status: 'CANCELLED',
        reviewReason: null,
      });
      await http().get(`/api/v1/events/${event.slug}`).expect(200);
    });

    it('nothing to restore → 409 INVALID_STATUS_CHANGE', async () => {
      const event = await hostEvent();
      const res = await http()
        .post(`${base}/events/${event.id}/restore`)
        .set('Cookie', admin)
        .expect(409);
      expect(res.body.code).toBe('INVALID_STATUS_CHANGE');
    });
  });

  describe('remove', () => {
    it('Removed with reason, Reports Actioned, Reservations Void; hidden but kept', async () => {
      const event = await hostEvent();
      await join(fans[3], event.id);
      await hideByReports(event.id);

      const res = await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({ reason: 'Indecent images' })
        .expect(200);

      expect(res.body).toEqual({
        eventId: event.id,
        status: 'REMOVED',
        resolvedReports: 3,
      });
      const e = await row(event.id); // kept in the database as evidence
      expect(e).toMatchObject({
        status: 'REMOVED',
        removedReason: 'Indecent images',
        reservedCount: 0,
      });
      expect(e.removedAt).toBeInstanceOf(Date);
      expect(await reportStatuses(event.id)).toEqual([
        'ACTIONED',
        'ACTIONED',
        'ACTIONED',
      ]);
      const r = await t.prisma.reservation.findFirstOrThrow({
        where: { eventId: event.id },
      });
      expect(r.status).toBe('VOID');

      await http().get(`/api/v1/events/${event.slug}`).expect(404);
      expect(
        (await http().get('/api/v1/events').expect(200)).body.items,
      ).toEqual([]);
      const queue = await http()
        .get(`${base}/queue`)
        .set('Cookie', admin)
        .expect(200);
      expect(queue.body).toEqual([]);
    });

    it('works directly on a Published Event', async () => {
      const event = await hostEvent();
      await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({ reason: 'Scam' })
        .expect(200);
      expect((await row(event.id)).status).toBe('REMOVED');
    });

    it('a forced failure midway rolls everything back', async () => {
      const event = await hostEvent();
      await join(fans[3], event.id);
      await hideByReports(event.id);
      const spy = jest
        .spyOn(t.app.get(ReservationsService), 'voidAllForEvent')
        .mockRejectedValueOnce(new Error('database hiccup'));

      await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({ reason: 'Indecent images' })
        .expect(500);
      spy.mockRestore();

      const e = await row(event.id);
      expect(e).toMatchObject({
        status: 'UNDER_REVIEW',
        removedReason: null,
        reservedCount: 1,
      });
      expect(await reportStatuses(event.id)).toEqual(['OPEN', 'OPEN', 'OPEN']);
      const r = await t.prisma.reservation.findFirstOrThrow({
        where: { eventId: event.id },
      });
      expect(r.status).toBe('ACTIVE');
    });

    it('needs a reason; removing twice → 409', async () => {
      const event = await hostEvent();
      await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({})
        .expect(400);
      await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({ reason: 'Scam' })
        .expect(200);
      await http()
        .post(`${base}/events/${event.id}/remove`)
        .set('Cookie', admin)
        .send({ reason: 'Scam' })
        .expect(409);
    });
  });

  describe('Reports on Listed Events', () => {
    it('the Admin resolves them without hiding the Event', async () => {
      const listed = await t.prisma.event.create({
        data: {
          slug: 'afa',
          kind: 'LISTED',
          status: 'PUBLISHED',
          title: 'AFA',
          description: '',
          categoryId,
          isOnline: true,
          startsAt: new Date('2027-05-10T03:00:00Z'),
          endsAt: new Date('2027-05-11T11:00:00Z'),
          timeZone: 'Asia/Jakarta',
        },
      });
      await report(fans[0], listed.id, 'WRONG_INFO');
      await report(fans[1], listed.id, 'WRONG_INFO');

      const res = await http()
        .post(`${base}/events/${listed.id}/reports/resolve`)
        .set('Cookie', admin)
        .send({ outcome: 'ACTIONED' })
        .expect(200);

      expect(res.body).toEqual({
        eventId: listed.id,
        status: 'PUBLISHED',
        resolvedReports: 2,
      });
      expect(await reportStatuses(listed.id)).toEqual(['ACTIONED', 'ACTIONED']);
      const queue = await http()
        .get(`${base}/queue`)
        .set('Cookie', admin)
        .expect(200);
      expect(queue.body).toEqual([]);
    });
  });

  it('is Admin-only', async () => {
    const event = await hostEvent();
    await http().get(`${base}/queue`).set('Cookie', fans[0]).expect(403);
    await http()
      .post(`${base}/events/${event.id}/restore`)
      .set('Cookie', org)
      .expect(403);
    await http()
      .post(`${base}/events/${event.id}/remove`)
      .set('Cookie', org)
      .send({ reason: 'Nope' })
      .expect(403);
    await http().get(`${base}/queue`).expect(401);
  });
});

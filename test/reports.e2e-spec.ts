import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Reports (e2e)', () => {
  let t: TestApp;
  let org: string;
  let fans: string[];
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  const hostEvent = async () => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title: 'Cosplay photo walk',
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
  const listEvent = () =>
    t.prisma.event.create({
      data: {
        slug: 'comifuro-21-abc',
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
  const report = (
    cookie: string,
    eventId: string,
    body: object = { reason: 'INDECENT' },
  ) =>
    http()
      .post(`/api/v1/events/${eventId}/reports`)
      .set('Cookie', cookie)
      .send(body);
  const status = async (id: string) =>
    (await t.prisma.event.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    org = await login(t, 'org@example.com');
    fans = [];
    for (let i = 0; i < 4; i++)
      fans.push(await login(t, `fan${i}@example.com`));
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('files a Report with reason and optional comment', async () => {
    const event = await hostEvent();
    const res = await report(fans[0], event.id, {
      reason: 'SPAM',
      comment: 'Selling fake tickets',
    }).expect(201);
    expect(res.body).toMatchObject({
      eventId: event.id,
      reason: 'SPAM',
      comment: 'Selling fake tickets',
      status: 'OPEN',
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a second Report by the same user → 409 ALREADY_REPORTED', async () => {
    const event = await hostEvent();
    await report(fans[0], event.id).expect(201);
    const res = await report(fans[0], event.id, { reason: 'OTHER' }).expect(
      409,
    );
    expect(res.body.code).toBe('ALREADY_REPORTED');
  });

  it('a double-click files one Report', async () => {
    const event = await hostEvent();
    const results = await Promise.all([
      report(fans[0], event.id),
      report(fans[0], event.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await t.prisma.report.count()).toBe(1);
  });

  it('the 3rd distinct Open Report hides a Published Hosted Event (Under Review, REPORTED)', async () => {
    const event = await hostEvent();
    await report(fans[0], event.id).expect(201);
    await report(fans[1], event.id).expect(201);
    expect(await status(event.id)).toBe('PUBLISHED');
    await http().get(`/api/v1/events/${event.slug}`).expect(200);

    await report(fans[2], event.id).expect(201);

    const row = await t.prisma.event.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(row).toMatchObject({
      status: 'UNDER_REVIEW',
      reviewReason: 'REPORTED',
    });
    await http().get(`/api/v1/events/${event.slug}`).expect(404);
  });

  it('hides exactly once when several users report at the same moment', async () => {
    const event = await hostEvent();
    const results = await Promise.all(fans.map((f) => report(f, event.id)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await status(event.id)).toBe('UNDER_REVIEW');
    expect(await t.prisma.report.count({ where: { eventId: event.id } })).toBe(
      4,
    );
  });

  it('only Open Reports count toward the threshold', async () => {
    const event = await hostEvent();
    await report(fans[0], event.id).expect(201);
    await report(fans[1], event.id).expect(201);
    // The Admin dismisses one (that action arrives in #14; set it directly here).
    await t.prisma.report.updateMany({
      where: { eventId: event.id, reporter: { email: 'fan0@example.com' } },
      data: { status: 'DISMISSED' },
    });

    await report(fans[2], event.id).expect(201);
    expect(await status(event.id)).toBe('PUBLISHED'); // 2 Open

    await report(fans[3], event.id).expect(201);
    expect(await status(event.id)).toBe('UNDER_REVIEW'); // 3 Open
  });

  it('Listed Events can be Reported but are never hidden automatically', async () => {
    const event = await listEvent();
    for (const f of fans) {
      await report(f, event.id, { reason: 'WRONG_INFO' }).expect(201);
    }
    expect(await status(event.id)).toBe('PUBLISHED');
  });

  it('existing Reservations stay Active when Reports hide an Event', async () => {
    const event = await hostEvent();
    await http()
      .post(`/api/v1/events/${event.id}/reservation`)
      .set('Cookie', fans[3])
      .expect(201);
    for (const f of fans.slice(0, 3)) await report(f, event.id).expect(201);

    const r = await t.prisma.reservation.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(r.status).toBe('ACTIVE');
  });

  it('Drafts and unknown Events → 404; anonymous → 401; bad reason → 400', async () => {
    const draft = await t.prisma.event.create({
      data: {
        slug: 'draft-1',
        kind: 'LISTED',
        status: 'DRAFT',
        title: 'Secret draft',
        description: '',
        categoryId,
        isOnline: true,
        startsAt: new Date('2027-01-10T03:00:00Z'),
        endsAt: new Date('2027-01-11T11:00:00Z'),
        timeZone: 'Asia/Jakarta',
      },
    });
    expect((await report(fans[0], draft.id).expect(404)).body.code).toBe(
      'EVENT_NOT_FOUND',
    );
    await report(fans[0], '01900000-0000-7000-8000-000000000000').expect(404);

    const event = await hostEvent();
    await http()
      .post(`/api/v1/events/${event.id}/reports`)
      .send({ reason: 'SPAM' })
      .expect(401);
    expect(
      (await report(fans[0], event.id, { reason: 'BORING' }).expect(400)).body
        .code,
    ).toBe('VALIDATION_FAILED');
  });
});

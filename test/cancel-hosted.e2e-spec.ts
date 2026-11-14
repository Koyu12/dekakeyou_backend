import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReservationsService } from '../src/reservations/reservations.service';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Organizer cancels a Hosted Event (e2e)', () => {
  let t: TestApp;
  let org: string;
  let aya: string;
  let ben: string;
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
        onlineUrl: 'https://meet.example/room',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        capacity: 10,
      })
      .expect(201);
    return res.body as { id: string; slug: string };
  };
  const join = (cookie: string, id: string) =>
    http().post(`/api/v1/events/${id}/reservation`).set('Cookie', cookie);
  const cancel = (cookie: string, id: string) =>
    http().post(`/api/v1/events/${id}/cancel`).set('Cookie', cookie);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    ben = await login(t, 'ben@example.com');
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('becomes Cancelled, stays public, and every Active Reservation becomes Void', async () => {
    const event = await hostEvent();
    await join(aya, event.id).expect(201);
    await join(ben, event.id).expect(201);
    await http()
      .delete(`/api/v1/events/${event.id}/reservation`)
      .set('Cookie', ben)
      .expect(200); // Ben had withdrawn; he stays Withdrawn

    const res = await cancel(org, event.id).expect(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: expect.any(String),
      reservedCount: 0,
    });

    const pub = await http().get(`/api/v1/events/${event.slug}`).expect(200);
    expect(pub.body.status).toBe('CANCELLED');

    const statuses = await t.prisma.reservation.findMany({
      where: { eventId: event.id },
      include: { attendee: true },
    });
    expect(
      Object.fromEntries(statuses.map((r) => [r.attendee.email, r.status])),
    ).toEqual({ 'aya@example.com': 'VOID', 'ben@example.com': 'WITHDRAWN' });
  });

  it('Attendees see Void in My Reservations, without the online link', async () => {
    const event = await hostEvent();
    await join(aya, event.id).expect(201);
    await cancel(org, event.id).expect(200);

    const mine = await http()
      .get('/api/v1/me/reservations')
      .set('Cookie', aya)
      .expect(200);
    expect(mine.body).toEqual([
      expect.objectContaining({
        status: 'VOID',
        onlineUrl: null,
        event: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    ]);
  });

  it('joining is no longer possible', async () => {
    const event = await hostEvent();
    await cancel(org, event.id).expect(200);
    const res = await join(aya, event.id).expect(409);
    expect(res.body.code).toBe('EVENT_NOT_JOINABLE');
  });

  it('only the Organizer can cancel (others get 404)', async () => {
    const event = await hostEvent();
    await cancel(aya, event.id).expect(404);
    await http().post(`/api/v1/events/${event.id}/cancel`).expect(401);
  });

  it('cancelling twice → 409 INVALID_STATUS_CHANGE', async () => {
    const event = await hostEvent();
    await cancel(org, event.id).expect(200);
    const res = await cancel(org, event.id).expect(409);
    expect(res.body.code).toBe('INVALID_STATUS_CHANGE');
  });

  it('an Event Under Review can be cancelled, but stays hidden from the public', async () => {
    const event = await hostEvent();
    await join(aya, event.id).expect(201);
    await t.prisma.event.update({
      where: { id: event.id },
      data: { status: 'UNDER_REVIEW', reviewReason: 'REPORTED' },
    });

    await cancel(org, event.id).expect(200);

    await http().get(`/api/v1/events/${event.slug}`).expect(404);
    const reservation = await t.prisma.reservation.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(reservation.status).toBe('VOID');
  });

  it('"void all" runs inside a caller\'s transaction and rolls back with it', async () => {
    const event = await hostEvent();
    await join(aya, event.id).expect(201);
    const reservations = t.app.get(ReservationsService);
    const prisma = t.app.get(PrismaService);

    await expect(
      prisma.$transaction(async (tx) => {
        const voided = await reservations.voidAllForEvent(tx, event.id);
        expect(voided).toHaveLength(1);
        throw new Error('caller fails after voiding');
      }),
    ).rejects.toThrow('caller fails after voiding');

    const r = await prisma.reservation.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(r.status).toBe('ACTIVE');
    const e = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(e.reservedCount).toBe(1);
  });
});

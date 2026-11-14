import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Hosted Events (e2e)', () => {
  let t: TestApp;
  let aya: string; // an Organizer
  let ben: string; // someone else
  let categoryId: string;
  let cityId: string;
  const http = () => request(t.app.getHttpServer());

  const meetup = (over: object = {}) => ({
    title: 'Cosplay photo walk',
    description: 'Meet at the fountain',
    categoryId,
    isOnline: false,
    cityId,
    venueName: 'Taman Suropati',
    startsAt: '2027-02-06T09:00:00+07:00',
    endsAt: '2027-02-06T12:00:00+07:00',
    timeZone: 'Asia/Jakarta',
    capacity: 20,
    ...over,
  });
  const watchParty = (over: object = {}) =>
    meetup({
      title: 'Anime watch party',
      isOnline: true,
      cityId: null,
      venueName: null,
      onlineUrl: 'https://discord.gg/secret-room',
      capacity: null,
      ...over,
    });

  const create = (cookie: string, body: object = meetup()) =>
    http().post('/api/v1/events').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    aya = await login(t, 'aya@example.com');
    ben = await login(t, 'ben@example.com');
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
    cityId = (
      await t.prisma.city.create({
        data: { name: 'Jakarta', province: 'DKI Jakarta' },
      })
    ).id;
  });
  afterAll(() => t.app.close());

  it('creating a Hosted Event publishes it immediately, owned by the caller', async () => {
    const res = await create(aya).expect(201);
    const ayaUser = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'aya@example.com' },
    });

    expect(res.body).toMatchObject({
      kind: 'HOSTED',
      status: 'PUBLISHED',
      organizer: { id: ayaUser.id },
      capacity: 20,
      reservedCount: 0,
      onlineUrl: null,
    });
    expect(res.headers['cache-control']).toBe('no-store');

    const pub = await http().get(`/api/v1/events/${res.body.slug}`).expect(200);
    expect(pub.body).toMatchObject({ kind: 'HOSTED', capacity: 20 });
  });

  it('requires login to create', async () => {
    await http().post('/api/v1/events').send(meetup()).expect(401);
  });

  describe('online link privacy', () => {
    it('never appears in the public, cacheable detail', async () => {
      const { body } = await create(aya, watchParty()).expect(201);
      expect(body.onlineUrl).toBe('https://discord.gg/secret-room'); // Organizer sees it

      const pub = await http().get(`/api/v1/events/${body.slug}`).expect(200);
      expect(pub.headers['cache-control']).toBe('public, max-age=60');
      expect(pub.body).not.toHaveProperty('onlineUrl');
      expect(JSON.stringify(pub.body)).not.toContain('secret-room');
    });
  });

  describe('Online / Offline validity', () => {
    it('an Online Event needs a link', async () => {
      const res = await create(aya, watchParty({ onlineUrl: null })).expect(
        400,
      );
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('an Offline Event needs a City', async () => {
      const res = await create(aya, meetup({ cityId: null })).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('switching to Offline drops the link; switching to Online drops the venue', async () => {
      const { body } = await create(aya, watchParty()).expect(201);
      const offline = await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .send({ isOnline: false, cityId, venueName: 'Blok M' })
        .expect(200);
      expect(offline.body).toMatchObject({
        onlineUrl: null,
        venueName: 'Blok M',
      });

      const online = await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .send({ isOnline: true, onlineUrl: 'https://meet.example/x' })
        .expect(200);
      expect(online.body).toMatchObject({
        city: null,
        venueName: null,
        onlineUrl: 'https://meet.example/x',
      });
    });
  });

  describe('ownership', () => {
    it('the Organizer can edit; anyone else gets 404', async () => {
      const { body } = await create(aya).expect(201);

      await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .send({ title: 'Cosplay photo walk (rain or shine)' })
        .expect(200);

      const other = await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', ben)
        .send({ title: 'Hijacked' })
        .expect(404);
      expect(other.body.code).toBe('EVENT_NOT_FOUND');
      await http()
        .delete(`/api/v1/events/${body.id}`)
        .set('Cookie', ben)
        .expect(404);
    });

    it('"My Events" lists only the caller\'s Hosted Events, with status', async () => {
      await create(aya).expect(201);
      await create(aya, watchParty()).expect(201);
      await create(ben).expect(201);

      const res = await http()
        .get('/api/v1/me/events')
        .set('Cookie', aya)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((e: { status: string }) => e.status)).toEqual([
        'PUBLISHED',
        'PUBLISHED',
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('delete', () => {
    it('removes a Published Event nobody has joined', async () => {
      const { body } = await create(aya).expect(201);
      await http()
        .delete(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .expect(204);
      await http().get(`/api/v1/events/${body.slug}`).expect(404);
    });

    it('is refused once someone has an Active Reservation', async () => {
      const { body } = await create(aya).expect(201);
      const benUser = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'ben@example.com' },
      });
      // Reservations arrive with #9; insert one directly to prove the rule is enforced.
      await t.prisma.reservation.create({
        data: { eventId: body.id, attendeeId: benUser.id },
      });

      const res = await http()
        .delete(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .expect(409);
      expect(res.body.code).toBe('INVALID_STATUS_CHANGE');
      expect(res.body.message).toMatch(/cancel the Event/);
    });
  });

  describe('Capacity', () => {
    it("can't be lowered below the places already taken", async () => {
      const { body } = await create(aya).expect(201);
      await t.prisma.event.update({
        where: { id: body.id },
        data: { reservedCount: 18 },
      });

      const res = await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .send({ capacity: 10 })
        .expect(409);
      expect(res.body.code).toBe('CAPACITY_BELOW_RESERVED');

      await http()
        .patch(`/api/v1/events/${body.id}`)
        .set('Cookie', aya)
        .send({ capacity: 18 })
        .expect(200);
    });
  });

  describe('daily limit', () => {
    it('rejects a 4th Hosted Event within 24h with 429 RATE_LIMITED', async () => {
      for (let i = 0; i < 3; i++) await create(aya).expect(201);
      const res = await create(aya).expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');

      await create(ben).expect(201); // other users are unaffected
    });

    it('holds under parallel requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(aya)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 429, 429, 429]);
    });

    it('older Events no longer count', async () => {
      for (let i = 0; i < 3; i++) await create(aya).expect(201);
      await t.prisma.event.updateMany({
        data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });
      await create(aya).expect(201);
    });
  });

  it('an unverified user cannot create', async () => {
    await t.prisma.user.update({
      where: { email: 'aya@example.com' },
      data: { emailVerified: false },
    });
    const res = await create(aya).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

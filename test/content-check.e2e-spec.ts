import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Automatic content check (e2e)', () => {
  let t: TestApp;
  let org: string;
  let aya: string;
  let admin: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  const body = (over: object = {}) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    return {
      title: 'Cosplay photo walk',
      description: 'Bring your best costume',
      categoryId,
      isOnline: true,
      onlineUrl: 'https://meet.example/x',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
      timeZone: 'Asia/Jakarta',
      ...over,
    };
  };
  const create = (over: object = {}) =>
    http().post('/api/v1/events').set('Cookie', org).send(body(over));
  const edit = (id: string, patch: object) =>
    http().patch(`/api/v1/events/${id}`).set('Cookie', org).send(patch);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.moderator.verdict = { result: 'PASS' };
    t.moderator.checked.length = 0;
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('clean content is published, after checking title, description and Tags', async () => {
    const res = await create({ tags: ['cosplay'] }).expect(201);
    expect(res.body.status).toBe('PUBLISHED');
    expect(t.moderator.checked[0]).toContain('Cosplay photo walk');
    expect(t.moderator.checked[0]).toContain('Bring your best costume');
    expect(t.moderator.checked[0]).toContain('cosplay');
  });

  describe('a clear fail', () => {
    it('from the AI check rejects with 422 CONTENT_REJECTED and a reason; nothing is saved', async () => {
      t.moderator.verdict = {
        result: 'FAIL',
        reason: 'Content flagged as sexual',
      };
      const res = await create().expect(422);
      expect(res.body).toMatchObject({
        code: 'CONTENT_REJECTED',
        message: 'Content flagged as sexual',
      });
      expect(await t.prisma.event.count()).toBe(0);
    });

    it('from the banned-word list rejects without needing the AI', async () => {
      const res = await create({ title: 'Nonton B O K E P bareng' }).expect(
        422,
      );
      expect(res.body.code).toBe('CONTENT_REJECTED');
      expect(res.body.message).toContain('bokep');
      expect(t.moderator.checked).toHaveLength(0);
      expect(await t.prisma.event.count()).toBe(0);
    });

    it('catches banned words in Tags too', async () => {
      await create({ tags: ['judol'] }).expect(422);
    });
  });

  describe('borderline content', () => {
    it('saves the Event Under Review (AUTO_CHECK), hidden publicly, visible to the Organizer', async () => {
      t.moderator.verdict = { result: 'BORDERLINE', reason: 'Possibly sexual' };
      const res = await create().expect(201);
      expect(res.body.status).toBe('UNDER_REVIEW');

      const row = await t.prisma.event.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.reviewReason).toBe('AUTO_CHECK');

      await http().get(`/api/v1/events/${res.body.slug}`).expect(404);
      expect(
        (await http().get('/api/v1/events').expect(200)).body.items,
      ).toEqual([]);

      const mine = await http()
        .get('/api/v1/me/events')
        .set('Cookie', org)
        .expect(200);
      expect(mine.body[0].status).toBe('UNDER_REVIEW');
    });
  });

  describe('editing a Published Event', () => {
    it('into banned content is rejected and the Event is unchanged', async () => {
      const { body: event } = await create().expect(201);
      await edit(event.id, { description: 'free porn link inside' }).expect(
        422,
      );
      const pub = await http().get(`/api/v1/events/${event.slug}`).expect(200);
      expect(pub.body.description).toBe('Bring your best costume');
    });

    it('into borderline content hides it Under Review; existing Reservations stay, new joins blocked', async () => {
      const { body: event } = await create().expect(201);
      await http()
        .post(`/api/v1/events/${event.id}/reservation`)
        .set('Cookie', aya)
        .expect(201);

      t.moderator.verdict = {
        result: 'BORDERLINE',
        reason: 'Possibly violence',
      };
      const res = await edit(event.id, { title: 'Cosplay fight club' }).expect(
        200,
      );
      expect(res.body.status).toBe('UNDER_REVIEW');

      await http().get(`/api/v1/events/${event.slug}`).expect(404);
      const reservation = await t.prisma.reservation.findFirstOrThrow({
        where: { eventId: event.id },
      });
      expect(reservation.status).toBe('ACTIVE');

      const ben = await login(t, 'ben@example.com');
      const join = await http()
        .post(`/api/v1/events/${event.id}/reservation`)
        .set('Cookie', ben)
        .expect(409);
      expect(join.body.code).toBe('EVENT_NOT_JOINABLE');
    });

    it('a later clean edit does not lift the review on its own', async () => {
      t.moderator.verdict = { result: 'BORDERLINE', reason: 'Possibly sexual' };
      const { body: event } = await create().expect(201);

      t.moderator.verdict = { result: 'PASS' };
      const res = await edit(event.id, {
        title: 'Totally innocent now',
      }).expect(200);
      expect(res.body.status).toBe('UNDER_REVIEW');
    });

    it('edits that do not touch text skip the check', async () => {
      const { body: event } = await create().expect(201);
      t.moderator.checked.length = 0;
      await edit(event.id, { capacity: 50 }).expect(200);
      expect(t.moderator.checked).toHaveLength(0);
    });

    it('the check sees the merged text, not just the changed field', async () => {
      const { body: event } = await create({ tags: ['anime'] }).expect(201);
      t.moderator.checked.length = 0;
      await edit(event.id, { title: 'New title' }).expect(200);
      expect(t.moderator.checked[0]).toContain('New title');
      expect(t.moderator.checked[0]).toContain('Bring your best costume');
      expect(t.moderator.checked[0]).toContain('anime');
    });
  });

  describe("the Admin's Listed Events", () => {
    const listed = (over: object = {}) =>
      http()
        .post('/api/v1/admin/events/listed')
        .set('Cookie', admin)
        .send({
          title: 'COMIFURO 21',
          categoryId,
          isOnline: true,
          startsAt: '2027-01-10T10:00:00+07:00',
          endsAt: '2027-01-11T18:00:00+07:00',
          timeZone: 'Asia/Jakarta',
          ...over,
        });

    it('skip the AI call', async () => {
      t.moderator.verdict = { result: 'FAIL', reason: 'would fail' };
      await listed().expect(201);
      expect(t.moderator.checked).toHaveLength(0);
    });

    it('still run the banned-word list, on create and edit', async () => {
      await listed({ description: 'xxx content' }).expect(422);
      const { body: event } = await listed().expect(201);
      await http()
        .patch(`/api/v1/admin/events/listed/${event.id}`)
        .set('Cookie', admin)
        .send({ tags: ['bokep'] })
        .expect(422);
    });
  });
});

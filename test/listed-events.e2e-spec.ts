import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Listed Events (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let categoryId: string;
  let cityId: string;
  const http = () => request(t.app.getHttpServer());
  const base = '/api/v1/admin/events/listed';

  const comifuro = () => ({
    title: 'COMIFURO 21',
    description: '**Big** creative market',
    categoryId,
    isOnline: false,
    cityId,
    venueName: 'JIExpo',
    venueAddress: 'Kemayoran, Jakarta',
    startsAt: '2027-01-10T10:00:00+07:00',
    endsAt: '2027-01-11T18:00:00+07:00',
    timeZone: 'Asia/Jakarta',
    presenterName: 'Comifuro Committee',
    officialUrl: 'https://comifuro.net',
  });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    categoryId = (
      await t.prisma.category.create({ data: { name: 'Anime & Manga' } })
    ).id;
    cityId = (
      await t.prisma.city.create({
        data: { name: 'Jakarta', province: 'DKI Jakarta' },
      })
    ).id;
  });
  afterAll(() => t.app.close());

  const create = (body: object = comifuro()) =>
    http().post(base).set('Cookie', admin).send(body);
  const publish = (id: string) =>
    http().post(`${base}/${id}/publish`).set('Cookie', admin);

  it('Admin creates a Listed Event as a Draft with no owner and source MANUAL', async () => {
    const res = await create().expect(201);

    expect(res.body).toMatchObject({
      kind: 'LISTED',
      status: 'DRAFT',
      title: 'COMIFURO 21',
      slug: expect.stringMatching(/^comifuro-21-[0-9a-z]{8}$/),
      category: { id: categoryId, name: 'Anime & Manga' },
      city: { id: cityId, name: 'Jakarta', province: 'DKI Jakarta' },
      startsAt: '2027-01-10T03:00:00.000Z', // stored as UTC
      timeZone: 'Asia/Jakarta',
      presenterName: 'Comifuro Committee',
      cancelledAt: null,
    });
    const row = await t.prisma.event.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.organizerId).toBeNull();
    expect(row.source).toBe('MANUAL');
  });

  it('a Draft is never public; publishing makes it visible by slug, cacheable', async () => {
    const { body: draft } = await create().expect(201);
    const missing = await http()
      .get(`/api/v1/events/${draft.slug}`)
      .expect(404);
    expect(missing.body.code).toBe('EVENT_NOT_FOUND');

    await publish(draft.id).expect(200);

    const res = await http().get(`/api/v1/events/${draft.slug}`).expect(200);
    expect(res.body).toMatchObject({ id: draft.id, status: 'PUBLISHED' });
    expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
  });

  it('editing the title keeps the slug, so old links still work', async () => {
    const { body: draft } = await create().expect(201);
    await publish(draft.id).expect(200);

    const res = await http()
      .patch(`${base}/${draft.id}`)
      .set('Cookie', admin)
      .send({ title: 'COMIFURO 21 (Day 1 & 2)' })
      .expect(200);
    expect(res.body.slug).toBe(draft.slug);

    const pub = await http().get(`/api/v1/events/${draft.slug}`).expect(200);
    expect(pub.body.title).toBe('COMIFURO 21 (Day 1 & 2)');
    expect(pub.body.venueName).toBe('JIExpo'); // untouched fields stay
  });

  it('a Cancelled Listed Event stays public with its status', async () => {
    const { body: draft } = await create().expect(201);
    await publish(draft.id).expect(200);

    const res = await http()
      .post(`${base}/${draft.id}/cancel`)
      .set('Cookie', admin)
      .expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelledAt).toEqual(expect.any(String));

    const pub = await http().get(`/api/v1/events/${draft.slug}`).expect(200);
    expect(pub.body.status).toBe('CANCELLED');
  });

  it('rejects invalid status changes with 409 INVALID_STATUS_CHANGE', async () => {
    const { body: draft } = await create().expect(201);
    const cancelDraft = await http()
      .post(`${base}/${draft.id}/cancel`)
      .set('Cookie', admin)
      .expect(409);
    expect(cancelDraft.body.code).toBe('INVALID_STATUS_CHANGE');

    await publish(draft.id).expect(200);
    const again = await publish(draft.id).expect(409);
    expect(again.body.code).toBe('INVALID_STATUS_CHANGE');
  });

  it('switching to online clears City and venue', async () => {
    const { body: draft } = await create().expect(201);
    const res = await http()
      .patch(`${base}/${draft.id}`)
      .set('Cookie', admin)
      .send({ isOnline: true })
      .expect(200);
    expect(res.body).toMatchObject({
      isOnline: true,
      city: null,
      venueName: null,
      venueAddress: null,
    });
  });

  describe('validation', () => {
    it.each([
      ['end before start', { endsAt: '2027-01-10T09:00:00+07:00' }],
      ['unknown time zone', { timeZone: 'WIB' }],
      ['offline without City', { cityId: null }],
      ['non-http official link', { officialUrl: 'javascript:alert(1)' }],
      ['title too short', { title: 'Hi' }],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_name, override) => {
      const res = await create({ ...comifuro(), ...override }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('an edit is checked against the merged result', async () => {
      const { body: draft } = await create().expect(201);
      const res = await http()
        .patch(`${base}/${draft.id}`)
        .set('Cookie', admin)
        .send({ endsAt: '2027-01-01T00:00:00+07:00' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('only active Categories and Cities can be chosen', async () => {
      const archivedCategory = await t.prisma.category.create({
        data: { name: 'Old', archivedAt: new Date() },
      });
      const archivedCity = await t.prisma.city.create({
        data: { name: 'Gone', province: 'Nowhere', archivedAt: new Date() },
      });

      const badCategory = await create({
        ...comifuro(),
        categoryId: archivedCategory.id,
      }).expect(400);
      expect(badCategory.body.code).toBe('CATEGORY_NOT_AVAILABLE');

      const badCity = await create({
        ...comifuro(),
        cityId: archivedCity.id,
      }).expect(400);
      expect(badCity.body.code).toBe('CITY_NOT_AVAILABLE');
    });
  });

  describe('access', () => {
    it('non-admins cannot create, edit or publish (403); anonymous gets 401', async () => {
      const { body: draft } = await create().expect(201);
      const user = await login(t, 'aya@example.com');

      await http().post(base).set('Cookie', user).send(comifuro()).expect(403);
      await http()
        .patch(`${base}/${draft.id}`)
        .set('Cookie', user)
        .send({ title: 'Hacked' })
        .expect(403);
      await http()
        .post(`${base}/${draft.id}/publish`)
        .set('Cookie', user)
        .expect(403);
      await http().post(base).send(comifuro()).expect(401);
    });

    it('the Admin list includes Drafts', async () => {
      await create().expect(201);
      const res = await http().get(base).set('Cookie', admin).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('DRAFT');
    });
  });
});

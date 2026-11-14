import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Admin manages Categories and Cities (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let org: string;
  const http = () => request(t.app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object) =>
      http().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set('Cookie', cookie).send(body),
    delete: (url: string) => http().delete(url).set('Cookie', cookie),
  });
  const names = async (url: string) =>
    ((await http().get(url).expect(200)).body as { name: string }[]).map(
      (x) => x.name,
    );
  const hostEvent = (categoryId: string, cityId: string, status = 201) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    return as(org)
      .post('/api/v1/events', {
        title: 'Cosplay picnic',
        categoryId,
        cityId,
        isOnline: false,
        venueName: 'Taman Menteng',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
      })
      .expect(status);
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    org = await login(t, 'org@example.com');
  });
  afterAll(() => t.app.close());

  it('Categories: create, rename, reorder, archive and unarchive', async () => {
    const a = as(admin);
    const cosplay = (
      await a
        .post('/api/v1/admin/categories', { name: ' Cosplay ', sortOrder: 2 })
        .expect(201)
    ).body as { id: string };
    expect(cosplay).toEqual({
      id: expect.any(String),
      name: 'Cosplay',
      sortOrder: 2,
      archived: false,
    });
    const gaming = (
      await a.post('/api/v1/admin/categories', { name: 'Gaming' }).expect(201)
    ).body as { id: string };
    expect(await names('/api/v1/categories')).toEqual(['Gaming', 'Cosplay']);

    await a
      .patch(`/api/v1/admin/categories/${cosplay.id}`, {
        name: 'Cosplay & Costume',
        sortOrder: 0,
      })
      .expect(200);
    await a
      .patch(`/api/v1/admin/categories/${gaming.id}`, { sortOrder: 1 })
      .expect(200);
    expect(await names('/api/v1/categories')).toEqual([
      'Cosplay & Costume',
      'Gaming',
    ]);

    const archived = await a
      .patch(`/api/v1/admin/categories/${gaming.id}`, { archived: true })
      .expect(200);
    expect(archived.body.archived).toBe(true);
    expect(await names('/api/v1/categories')).toEqual(['Cosplay & Costume']);
    // The Admin still sees it, so it can come back.
    const all = await a.get('/api/v1/admin/categories').expect(200);
    expect(all.body).toHaveLength(2);

    await a
      .patch(`/api/v1/admin/categories/${gaming.id}`, { archived: false })
      .expect(200);
    expect(await names('/api/v1/categories')).toHaveLength(2);
  });

  it('Cities: create, rename and archive; name + province unique together', async () => {
    const a = as(admin);
    const city = (
      await a
        .post('/api/v1/admin/cities', {
          name: 'Bandung',
          province: 'Jawa Barat',
        })
        .expect(201)
    ).body as { id: string };
    await a
      .post('/api/v1/admin/cities', { name: 'Bandung', province: 'Jawa Timur' })
      .expect(201); // same name, other province: fine
    const dup = await a
      .post('/api/v1/admin/cities', { name: 'Bandung', province: 'Jawa Barat' })
      .expect(409);
    expect(dup.body.code).toBe('CATALOG_NAME_TAKEN');

    const renamed = await a
      .patch(`/api/v1/admin/cities/${city.id}`, { name: 'Kota Bandung' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Kota Bandung',
      province: 'Jawa Barat',
    });
    await a
      .patch(`/api/v1/admin/cities/${city.id}`, { archived: true })
      .expect(200);
    expect(await names('/api/v1/cities')).toEqual(['Bandung']);
  });

  it('duplicate Category names → 409; unknown id → 404', async () => {
    const a = as(admin);
    await a.post('/api/v1/admin/categories', { name: 'Cosplay' }).expect(201);
    const dup = await a
      .post('/api/v1/admin/categories', { name: 'Cosplay' })
      .expect(409);
    expect(dup.body.code).toBe('CATALOG_NAME_TAKEN');
    const missing = '0190a000-0000-7000-8000-000000000000';
    await a
      .patch(`/api/v1/admin/categories/${missing}`, { name: 'X' })
      .expect(404);
    await a.delete(`/api/v1/admin/cities/${missing}`).expect(404);
  });

  it('deletes only unused entries; used ones must be archived, and Events keep them', async () => {
    const a = as(admin);
    const used = (
      await a.post('/api/v1/admin/categories', { name: 'Cosplay' }).expect(201)
    ).body as { id: string };
    const unused = (
      await a.post('/api/v1/admin/categories', { name: 'Gaming' }).expect(201)
    ).body as { id: string };
    const city = (
      await a
        .post('/api/v1/admin/cities', {
          name: 'Bandung',
          province: 'Jawa Barat',
        })
        .expect(201)
    ).body as { id: string };
    const event = (await hostEvent(used.id, city.id)).body as { slug: string };

    await a.delete(`/api/v1/admin/categories/${unused.id}`).expect(204);
    for (const url of [
      `/api/v1/admin/categories/${used.id}`,
      `/api/v1/admin/cities/${city.id}`,
    ]) {
      const res = await a.delete(url).expect(409);
      expect(res.body).toMatchObject({
        code: 'CATALOG_ENTRY_IN_USE',
        message: 'Used by 1 Event; archive it instead',
      });
    }

    await a
      .patch(`/api/v1/admin/categories/${used.id}`, { archived: true })
      .expect(200);
    const page = await http().get(`/api/v1/events/${event.slug}`).expect(200);
    expect(page.body.category.name).toBe('Cosplay'); // existing Events keep it
    const refused = await hostEvent(used.id, city.id, 400); // new Events can't pick it
    expect(refused.body.code).toBe('CATEGORY_NOT_AVAILABLE');
  });

  it('non-admins get 403, anonymous 401', async () => {
    await as(org).get('/api/v1/admin/categories').expect(403);
    await as(org)
      .post('/api/v1/admin/cities', { name: 'X', province: 'Y' })
      .expect(403);
    await http().get('/api/v1/admin/cities').expect(401);
  });
});

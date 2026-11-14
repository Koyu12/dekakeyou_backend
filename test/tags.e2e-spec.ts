import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

describe('Tags (e2e)', () => {
  let t: TestApp;
  let org: string;
  let admin: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  const hosted = (tags?: string[]) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    return http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title: 'Genshin meetup',
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        ...(tags ? { tags } : {}),
      });
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    org = await login(t, 'org@example.com');
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    categoryId = (await t.prisma.category.create({ data: { name: 'Gaming' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('stores Tags normalized and de-duplicated, and shows them publicly', async () => {
    const res = await hosted([
      'Cosplay ',
      'cosplay',
      'COSPLAY',
      '#Genshin Impact',
    ]).expect(201);
    expect(res.body.tags).toEqual(['cosplay', 'genshin-impact']);

    const pub = await http().get(`/api/v1/events/${res.body.slug}`).expect(200);
    expect(pub.body.tags).toEqual(['cosplay', 'genshin-impact']);
    expect(await t.prisma.tag.count()).toBe(2);
  });

  it('reuses an existing Tag instead of creating a near-duplicate', async () => {
    await hosted(['cosplay']).expect(201);
    await hosted(['  COSPLAY']).expect(201);
    expect(await t.prisma.tag.count()).toBe(1);
    expect(await t.prisma.eventTag.count()).toBe(2);
  });

  it('accepts up to 5 Tags and rejects more with 400 VALIDATION_FAILED', async () => {
    await hosted(['a', 'b', 'c', 'd', 'e']).expect(201);
    const res = await hosted(['a', 'b', 'c', 'd', 'e', 'f']).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toMatch(/at most 5/);
  });

  it('rejects an invalid Tag', async () => {
    const res = await hosted(['<script>']).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('an Event without Tags has an empty list', async () => {
    const res = await hosted().expect(201);
    expect(res.body.tags).toEqual([]);
  });

  it('editing replaces the Tags; an edit without tags leaves them alone', async () => {
    const { body } = await hosted(['cosplay', 'anime']).expect(201);

    const kept = await http()
      .patch(`/api/v1/events/${body.id}`)
      .set('Cookie', org)
      .send({ title: 'Genshin meetup (renamed)' })
      .expect(200);
    expect(kept.body.tags).toEqual(['anime', 'cosplay']);

    const replaced = await http()
      .patch(`/api/v1/events/${body.id}`)
      .set('Cookie', org)
      .send({ tags: ['Genshin'] })
      .expect(200);
    expect(replaced.body.tags).toEqual(['genshin']);

    const cleared = await http()
      .patch(`/api/v1/events/${body.id}`)
      .set('Cookie', org)
      .send({ tags: [] })
      .expect(200);
    expect(cleared.body.tags).toEqual([]);
  });

  it('a rejected edit leaves the old Tags in place', async () => {
    const { body } = await hosted(['cosplay']).expect(201);
    await http()
      .patch(`/api/v1/events/${body.id}`)
      .set('Cookie', org)
      .send({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
      .expect(400);
    const mine = await http()
      .get(`/api/v1/me/events/${body.id}`)
      .set('Cookie', org)
      .expect(200);
    expect(mine.body.tags).toEqual(['cosplay']);
  });

  it('Listed Events take Tags too', async () => {
    const res = await http()
      .post('/api/v1/admin/events/listed')
      .set('Cookie', admin)
      .send({
        title: 'COMIFURO 21',
        categoryId,
        isOnline: true,
        startsAt: '2027-01-10T10:00:00+07:00',
        endsAt: '2027-01-11T18:00:00+07:00',
        timeZone: 'Asia/Jakarta',
        tags: ['Doujin', 'Comic Market'],
      })
      .expect(201);
    expect(res.body.tags).toEqual(['comic-market', 'doujin']);
  });

  describe('suggestions', () => {
    beforeEach(async () => {
      await hosted(['genshin-impact', 'cosplay']).expect(201);
      await hosted(['genshin-impact']).expect(201);
      await hosted(['genshin-fanart']).expect(201);
    });

    it('returns existing Tags by prefix, most used first, publicly and cacheable', async () => {
      const res = await http().get('/api/v1/tags?prefix=gen').expect(200);
      expect(res.body).toEqual({ tags: ['genshin-impact', 'genshin-fanart'] });
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('normalizes the prefix the same way as Tags', async () => {
      const res = await http()
        .get('/api/v1/tags?prefix=%23GENSHIN%20I')
        .expect(200);
      expect(res.body).toEqual({ tags: ['genshin-impact'] });
    });

    it('returns nothing for an unusable prefix, and 400 without one', async () => {
      expect(
        (await http().get('/api/v1/tags?prefix=%2B%2B').expect(200)).body,
      ).toEqual({
        tags: [],
      });
      await http().get('/api/v1/tags').expect(400);
    });
  });
});

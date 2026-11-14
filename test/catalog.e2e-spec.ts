import request from 'supertest';
import { createTestApp, resetDb, TestApp } from './support/test-app';

describe('Catalog (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDb(t.prisma));
  afterAll(() => t.app.close());

  it('lists non-archived Categories in sort order, cacheable', async () => {
    await t.prisma.category.createMany({
      data: [
        { name: 'Gaming', sortOrder: 2 },
        { name: 'Cosplay', sortOrder: 0 },
        { name: 'J-Music', sortOrder: 1 },
        { name: 'Old stuff', sortOrder: 3, archivedAt: new Date() },
      ],
    });

    const res = await request(t.app.getHttpServer())
      .get('/api/v1/categories')
      .expect(200);

    expect(res.body.map((c: { name: string }) => c.name)).toEqual([
      'Cosplay',
      'J-Music',
      'Gaming',
    ]);
    expect(res.body[0]).toEqual({ id: expect.any(String), name: 'Cosplay' });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('lists non-archived Cities by name, with province', async () => {
    await t.prisma.city.createMany({
      data: [
        { name: 'Surabaya', province: 'Jawa Timur' },
        { name: 'Bandung', province: 'Jawa Barat' },
        { name: 'Ghost Town', province: 'Nowhere', archivedAt: new Date() },
      ],
    });

    const res = await request(t.app.getHttpServer())
      .get('/api/v1/cities')
      .expect(200);

    expect(res.body).toEqual([
      { id: expect.any(String), name: 'Bandung', province: 'Jawa Barat' },
      { id: expect.any(String), name: 'Surabaya', province: 'Jawa Timur' },
    ]);
  });
});

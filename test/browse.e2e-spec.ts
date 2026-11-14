import request from 'supertest';
import type { EventStatus } from '../src/generated/prisma/enums';
import { createTestApp, resetDb, TestApp } from './support/test-app';

describe('Browse Events (e2e)', () => {
  let t: TestApp;
  let cosplay: string;
  let music: string;
  let jakarta: string;
  let bandung: string;
  const http = () => request(t.app.getHttpServer());
  const DAY = 24 * 3600_000;

  type Seed = {
    title: string;
    inDays: number; // start, relative to now
    hours?: number; // duration
    categoryId?: string;
    cityId?: string | null;
    isOnline?: boolean;
    status?: EventStatus;
    reviewReason?: 'REPORTED' | null;
    tags?: string[];
  };
  let n = 0;
  const seed = async (s: Seed) => {
    const startsAt = new Date(Date.now() + s.inDays * DAY);
    const isOnline = s.isOnline ?? false;
    const event = await t.prisma.event.create({
      data: {
        slug: `e-${n++}`,
        kind: 'LISTED',
        status: s.status ?? 'PUBLISHED',
        reviewReason: s.reviewReason ?? null,
        title: s.title,
        description: 'long text '.repeat(50),
        categoryId: s.categoryId ?? cosplay,
        isOnline,
        cityId: isOnline ? null : s.cityId === undefined ? jakarta : s.cityId,
        onlineUrl: isOnline ? 'https://secret.example/room' : null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (s.hours ?? 3) * 3600_000),
        timeZone: 'Asia/Jakarta',
      },
    });
    for (const name of s.tags ?? []) {
      const tag = await t.prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await t.prisma.eventTag.create({
        data: { eventId: event.id, tagId: tag.id },
      });
    }
    return event;
  };
  const titles = (body: { items: { title: string }[] }) =>
    body.items.map((e) => e.title);
  const browse = (qs = '') => http().get(`/api/v1/events${qs}`);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    cosplay = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
    music = (await t.prisma.category.create({ data: { name: 'J-Music' } })).id;
    jakarta = (
      await t.prisma.city.create({ data: { name: 'Jakarta', province: 'DKI' } })
    ).id;
    bandung = (
      await t.prisma.city.create({
        data: { name: 'Bandung', province: 'Jabar' },
      })
    ).id;
  });
  afterAll(() => t.app.close());

  it('by default lists upcoming Events by start time, publicly and cacheable', async () => {
    await seed({ title: 'Later', inDays: 10 });
    await seed({ title: 'Sooner', inDays: 2 });
    await seed({ title: 'Running now', inDays: -0.05, hours: 5 }); // started, not ended
    await seed({ title: 'Over', inDays: -3 });

    const res = await browse().expect(200);

    expect(titles(res.body)).toEqual(['Running now', 'Sooner', 'Later']);
    expect(res.body.nextCursor).toBeNull();
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('never shows Draft, Under Review, Removed, or still-flagged Cancelled Events; shows Cancelled', async () => {
    await seed({ title: 'Published', inDays: 1 });
    await seed({ title: 'Cancelled', inDays: 2, status: 'CANCELLED' });
    await seed({ title: 'Draft', inDays: 3, status: 'DRAFT' });
    await seed({
      title: 'Under review',
      inDays: 4,
      status: 'UNDER_REVIEW',
      reviewReason: 'REPORTED',
    });
    await seed({ title: 'Removed', inDays: 5, status: 'REMOVED' });
    await seed({
      title: 'Cancelled while flagged',
      inDays: 6,
      status: 'CANCELLED',
      reviewReason: 'REPORTED',
    });

    expect(titles((await browse().expect(200)).body)).toEqual([
      'Published',
      'Cancelled',
    ]);
  });

  it('never contains online links or descriptions', async () => {
    await seed({ title: 'Watch party', inDays: 1, isOnline: true });
    const res = await browse().expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret.example');
    expect(res.body.items[0]).not.toHaveProperty('onlineUrl');
    expect(res.body.items[0]).not.toHaveProperty('description');
  });

  describe('filters', () => {
    beforeEach(async () => {
      await seed({ title: 'Jakarta cosplay', inDays: 1, tags: ['cosplay'] });
      await seed({
        title: 'Bandung cosplay',
        inDays: 2,
        cityId: bandung,
        tags: ['cosplay', 'genshin-impact'],
      });
      await seed({
        title: 'Online idol stream',
        inDays: 3,
        isOnline: true,
        categoryId: music,
        tags: ['idol'],
      });
      await seed({
        title: 'Jakarta J-Music night',
        inDays: 20,
        categoryId: music,
      });
    });

    it('by Category', async () => {
      expect(
        titles((await browse(`?category=${music}`).expect(200)).body),
      ).toEqual(['Online idol stream', 'Jakarta J-Music night']);
    });

    it('by City, with Online Events included in every City', async () => {
      expect(
        titles((await browse(`?city=${bandung}`).expect(200)).body),
      ).toEqual(['Bandung cosplay', 'Online idol stream']);
    });

    it('by Tag, normalized like Tags are', async () => {
      expect(
        titles((await browse('?tag=%23Genshin%20Impact').expect(200)).body),
      ).toEqual(['Bandung cosplay']);
      expect((await browse('?tag=%2B%2B').expect(200)).body.items).toEqual([]);
    });

    it('by title search, case-insensitive', async () => {
      expect(titles((await browse('?q=COSPLAY').expect(200)).body)).toEqual([
        'Jakarta cosplay',
        'Bandung cosplay',
      ]);
    });

    it('by date range (Events overlapping it)', async () => {
      const from = new Date(Date.now() + 1.5 * DAY).toISOString();
      const to = new Date(Date.now() + 5 * DAY).toISOString();
      expect(
        titles(
          (
            await browse(
              `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            ).expect(200)
          ).body,
        ),
      ).toEqual(['Bandung cosplay', 'Online idol stream']);
    });

    it('combined: Category + City + search', async () => {
      expect(
        titles(
          (
            await browse(`?category=${music}&city=${jakarta}&q=night`).expect(
              200,
            )
          ).body,
        ),
      ).toEqual(['Jakarta J-Music night']);
    });
  });

  it('"includePast" adds finished Events', async () => {
    await seed({ title: 'Over', inDays: -3 });
    await seed({ title: 'Upcoming', inDays: 1 });
    expect(
      titles((await browse('?includePast=true').expect(200)).body),
    ).toEqual(['Over', 'Upcoming']);
    expect(
      titles((await browse('?includePast=false').expect(200)).body),
    ).toEqual(['Upcoming']);
  });

  describe('cursor pagination', () => {
    it('walks all pages with no duplicates or gaps, even when Events are added between pages', async () => {
      for (let i = 0; i < 7; i++) await seed({ title: `E${i}`, inDays: 1 + i });
      // Same start time for two Events: the id tie-breaker keeps the order stable.
      await seed({ title: 'E2-twin', inDays: 3 });

      const first = await browse('?limit=3').expect(200);
      expect(first.body.items).toHaveLength(3);
      expect(first.body.nextCursor).toEqual(expect.any(String));

      // New Events appear before and after the cursor while the user is scrolling.
      await seed({ title: 'Inserted early', inDays: 0.5 });
      await seed({ title: 'Inserted late', inDays: 30 });

      const seen = [...titles(first.body)];
      let cursor: string | null = first.body.nextCursor;
      while (cursor) {
        const page = await browse(`?limit=3&cursor=${cursor}`).expect(200);
        seen.push(...titles(page.body));
        cursor = page.body.nextCursor;
      }

      expect(new Set(seen).size).toBe(seen.length); // no duplicates
      for (const title of [
        'E0',
        'E1',
        'E2',
        'E2-twin',
        'E3',
        'E4',
        'E5',
        'E6',
      ]) {
        expect(seen).toContain(title); // no gaps among the original Events
      }
      expect(seen).toContain('Inserted late'); // later additions still reachable
    });

    it('rejects a tampered cursor with 400 VALIDATION_FAILED', async () => {
      const res = await browse('?cursor=not-a-cursor').expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('validates limit (1–50)', async () => {
      await browse('?limit=0').expect(400);
      await browse('?limit=51').expect(400);
    });
  });
});

import request from 'supertest';
import {
  CLEANUP_QUEUE,
  StorageCleanupService,
} from '../src/events/storage-cleanup.service';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const DAY_MS = 24 * 3600_000;

describe('Storage cleanup (e2e)', () => {
  let t: TestApp;
  let cleanup: StorageCleanupService;
  let org: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  /** Requests an Upload, optionally PUTs the file and verifies it. Returns id and key. */
  const upload = async (opts: { verify?: boolean } = { verify: true }) => {
    const ticket = (
      await http()
        .post('/api/v1/uploads')
        .set('Cookie', org)
        .send({ contentType: 'image/png', size: PNG.length })
        .expect(201)
    ).body as { id: string; uploadUrl: string };
    t.storage.put(ticket.uploadUrl, PNG);
    if (opts.verify) {
      await http()
        .post(`/api/v1/uploads/${ticket.id}/verify`)
        .set('Cookie', org)
        .expect(200);
    }
    const row = await t.prisma.upload.findUniqueOrThrow({
      where: { id: ticket.id },
    });
    return { id: row.id, key: row.storageKey };
  };
  const ageUpload = (id: string, days: number) =>
    t.prisma.upload.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - days * DAY_MS) },
    });
  const hostEvent = async (coverUploadId: string) => {
    const startsAt = new Date(Date.now() + 7 * DAY_MS);
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title: 'Cosplay picnic',
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        coverUploadId,
      })
      .expect(201);
    return res.body as { id: string };
  };
  const uploadExists = async (id: string) =>
    (await t.prisma.upload.count({ where: { id } })) > 0;

  beforeAll(async () => {
    t = await createTestApp();
    cleanup = t.app.get(StorageCleanupService);
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.imageModerator.verdict = { result: 'PASS' };
    t.storage.objects.clear();
    org = await login(t, 'org@example.com');
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  it('runs daily on a pg-boss schedule', async () => {
    const [s] = await t.notifier.boss.getSchedules(CLEANUP_QUEUE);
    expect(s).toMatchObject({ name: CLEANUP_QUEUE, cron: '15 3 * * *' });
  });

  it('deletes old Uploads no Event uses, keeps attached and recent ones; a second run is harmless', async () => {
    const pending = await upload({ verify: false });
    t.imageModerator.verdict = { result: 'FAIL', reason: 'Gore' };
    const rejected = await upload();
    t.imageModerator.verdict = { result: 'PASS' };
    const replaced = await upload();
    const attached = await upload();
    const fresh = await upload();

    const e = await hostEvent(replaced.id);
    await http()
      .patch(`/api/v1/events/${e.id}`)
      .set('Cookie', org)
      .send({ coverUploadId: attached.id })
      .expect(200);
    for (const u of [pending, rejected, replaced, attached]) {
      await ageUpload(u.id, 2);
    }

    expect(await cleanup.run()).toEqual({ covers: 0, uploads: 3 });
    for (const u of [pending, rejected, replaced]) {
      expect(await uploadExists(u.id)).toBe(false);
      expect(t.storage.objects.has(u.key)).toBe(false);
    }
    for (const u of [attached, fresh]) {
      expect(await uploadExists(u.id)).toBe(true);
      expect(t.storage.objects.has(u.key)).toBe(true);
    }

    expect(await cleanup.run()).toEqual({ covers: 0, uploads: 0 });
  });

  it('a Removed Event’s Cover Image goes after 30 days; the Event stays', async () => {
    const old = await upload();
    const recent = await upload();
    const oldEvent = await hostEvent(old.id);
    const recentEvent = await hostEvent(recent.id);
    await ageUpload(old.id, 40);
    await ageUpload(recent.id, 40);
    const remove = (id: string, days: number) =>
      t.prisma.event.update({
        where: { id },
        data: {
          status: 'REMOVED',
          removedReason: 'spam',
          removedAt: new Date(Date.now() - days * DAY_MS),
        },
      });
    await remove(oldEvent.id, 31);
    await remove(recentEvent.id, 29);

    expect(await cleanup.run()).toEqual({ covers: 1, uploads: 1 });
    const gone = await t.prisma.event.findUniqueOrThrow({
      where: { id: oldEvent.id },
    });
    expect(gone).toMatchObject({ status: 'REMOVED', coverImageKey: null });
    expect(t.storage.objects.has(old.key)).toBe(false);
    expect(await uploadExists(old.id)).toBe(false);

    const kept = await t.prisma.event.findUniqueOrThrow({
      where: { id: recentEvent.id },
    });
    expect(kept.coverImageKey).toBe(recent.key);
    expect(t.storage.objects.has(recent.key)).toBe(true);

    expect(await cleanup.run()).toEqual({ covers: 0, uploads: 0 });
  });
});

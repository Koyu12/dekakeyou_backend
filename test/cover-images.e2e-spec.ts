import request from 'supertest';
import { createTestApp, login, resetDb, TestApp } from './support/test-app';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const NOT_AN_IMAGE = new TextEncoder().encode('<svg onload="alert(1)">');

describe('Cover Images (e2e)', () => {
  let t: TestApp;
  let org: string;
  let aya: string;
  let admin: string;
  let categoryId: string;
  const http = () => request(t.app.getHttpServer());

  type Ticket = { id: string; uploadUrl: string; headers: object };
  const requestUpload = (
    cookie: string,
    bytes = PNG,
    contentType = 'image/png',
  ) =>
    http()
      .post('/api/v1/uploads')
      .set('Cookie', cookie)
      .send({ contentType, size: bytes.length });
  const verify = (cookie: string, id: string) =>
    http().post(`/api/v1/uploads/${id}/verify`).set('Cookie', cookie);
  /** request → PUT to the signed URL → verify; returns the verified Upload. */
  const upload = async (cookie: string, bytes = PNG) => {
    const ticket = (await requestUpload(cookie, bytes).expect(201))
      .body as Ticket;
    t.storage.put(ticket.uploadUrl, bytes);
    const res = await verify(cookie, ticket.id).expect(200);
    return res.body as {
      id: string;
      status: string;
      rejectedReason: string | null;
      url: string | null;
    };
  };
  const hostEvent = (cookie: string, extra: object = {}) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
    return http()
      .post('/api/v1/events')
      .set('Cookie', cookie)
      .send({
        title: 'Cosplay picnic',
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        timeZone: 'Asia/Jakarta',
        ...extra,
      });
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    t.imageModerator.verdict = { result: 'PASS' };
    t.imageModerator.checked = 0;
    t.storage.objects.clear();
    t.storage.signed.clear();
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    admin = await login(t, 'admin@example.com', { role: 'admin' });
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
  });
  afterAll(() => t.app.close());

  describe('uploading', () => {
    it('requesting an upload creates a Pending Upload and a signed URL for that exact type and size', async () => {
      const res = await requestUpload(org).expect(201);
      expect(res.body).toMatchObject({
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '12' },
      });
      const row = await t.prisma.upload.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row).toMatchObject({
        status: 'PENDING',
        storageKey: `covers/${row.id}.png`,
      });
      expect(t.storage.signed.get(row.storageKey)).toEqual({
        contentType: 'image/png',
        size: 12,
      });
    });

    it('limits type and size', async () => {
      await http()
        .post('/api/v1/uploads')
        .set('Cookie', org)
        .send({ contentType: 'image/gif', size: 10 })
        .expect(400);
      await http()
        .post('/api/v1/uploads')
        .set('Cookie', org)
        .send({ contentType: 'image/png', size: 5 * 1024 * 1024 + 1 })
        .expect(400);
      await http()
        .post('/api/v1/uploads')
        .send({ contentType: 'image/png', size: 10 })
        .expect(401);
    });

    it('verify before uploading → 409; someone else’s Upload → 404', async () => {
      const { id } = (await requestUpload(org).expect(201)).body as Ticket;
      expect((await verify(org, id).expect(409)).body.code).toBe(
        'UPLOAD_NOT_READY',
      );
      expect((await verify(aya, id).expect(404)).body.code).toBe(
        'UPLOAD_NOT_FOUND',
      );
    });

    it('a clean image is Approved and gets a public URL', async () => {
      const u = await upload(org);
      expect(u).toMatchObject({ status: 'APPROVED', rejectedReason: null });
      expect(u.url).toMatch(/^https:\/\/cdn\.test\/covers\/[\w-]+\.png$/);
      expect(t.imageModerator.checked).toBe(1);
    });

    it('an image the check fails is Rejected with the reason, and the file deleted', async () => {
      t.imageModerator.verdict = { result: 'FAIL', reason: 'Sexual content' };
      const u = await upload(org);
      expect(u).toMatchObject({
        status: 'REJECTED',
        rejectedReason: 'Sexual content',
        url: null,
      });
      expect(t.storage.objects.size).toBe(0);
    });

    it('a file that isn’t really an image is Rejected without calling the image check', async () => {
      const u = await upload(org, NOT_AN_IMAGE);
      expect(u.status).toBe('REJECTED');
      expect(u.rejectedReason).toMatch(/not a JPEG, PNG or WebP/);
      expect(t.imageModerator.checked).toBe(0);
    });
  });

  describe('attaching', () => {
    it('an Approved Upload becomes the Cover Image; the public page shows its URL', async () => {
      const u = await upload(org);
      const res = await hostEvent(org, { coverUploadId: u.id }).expect(201);
      expect(res.body.coverImageUrl).toBe(u.url);

      const pub = await http()
        .get(`/api/v1/events/${res.body.slug}`)
        .expect(200);
      expect(pub.body.coverImageUrl).toBe(u.url);
      const row = await t.prisma.event.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.coverImageKey).toMatch(/^covers\//); // only the key is stored
    });

    it('Pending, Rejected and other people’s Uploads are refused', async () => {
      const pending = (await requestUpload(org).expect(201)).body as Ticket;
      t.imageModerator.verdict = { result: 'FAIL', reason: 'Gore' };
      const rejected = await upload(org);
      t.imageModerator.verdict = { result: 'PASS' };
      const ayas = await upload(aya);

      for (const [id, message] of [
        [pending.id, /Verify the upload/],
        [rejected.id, /rejected: Gore/],
        [ayas.id, /your own uploads/],
      ] as const) {
        const res = await hostEvent(org, { coverUploadId: id }).expect(422);
        expect(res.body.code).toBe('UPLOAD_NOT_USABLE');
        expect(res.body.message).toMatch(message);
      }
      expect(await t.prisma.event.count()).toBe(0);
    });

    it('one Upload can’t be the Cover Image of two Events', async () => {
      const u = await upload(org);
      await hostEvent(org, { coverUploadId: u.id }).expect(201);
      const res = await hostEvent(org, { coverUploadId: u.id }).expect(422);
      expect(res.body.message).toMatch(/already the Cover Image/);
    });

    it('a borderline image is attached, but holds the Event Under Review', async () => {
      t.imageModerator.verdict = { result: 'BORDERLINE', reason: 'unsure' };
      const u = await upload(org);
      expect(u.status).toBe('APPROVED');

      const created = await hostEvent(org, { coverUploadId: u.id }).expect(201);
      expect(created.body.status).toBe('UNDER_REVIEW');

      // Same on edit: a clean Event becomes Under Review when given a borderline image.
      const clean = await hostEvent(org).expect(201);
      t.imageModerator.verdict = { result: 'BORDERLINE', reason: 'unsure' };
      const u2 = await upload(org);
      const edited = await http()
        .patch(`/api/v1/events/${clean.body.id}`)
        .set('Cookie', org)
        .send({ coverUploadId: u2.id })
        .expect(200);
      expect(edited.body.status).toBe('UNDER_REVIEW');
    });

    it('editing can replace or remove the Cover Image', async () => {
      const first = await upload(org);
      const second = await upload(org);
      const e = (await hostEvent(org, { coverUploadId: first.id }).expect(201))
        .body as { id: string };
      const patch = (body: object) =>
        http()
          .patch(`/api/v1/events/${e.id}`)
          .set('Cookie', org)
          .send(body)
          .expect(200);

      expect(
        (await patch({ coverUploadId: second.id })).body.coverImageUrl,
      ).toBe(second.url);
      expect(
        (await patch({ title: 'Renamed picnic' })).body.coverImageUrl,
      ).toBe(second.url); // untouched when not sent
      expect(
        (await patch({ coverUploadId: null })).body.coverImageUrl,
      ).toBeNull();
    });

    it('the Admin attaches their own Upload to a Listed Event', async () => {
      const u = await upload(admin);
      const startsAt = new Date(Date.now() + 30 * 24 * 3600_000);
      const res = await http()
        .post('/api/v1/admin/events/listed')
        .set('Cookie', admin)
        .send({
          title: 'COMIFURO 20',
          categoryId,
          isOnline: true,
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 8 * 3600_000).toISOString(),
          timeZone: 'Asia/Jakarta',
          coverUploadId: u.id,
        })
        .expect(201);
      expect(res.body.coverImageUrl).toBe(u.url);
    });
  });
});

import request from 'supertest';
import {
  createTestApp,
  login,
  resetDb,
  settleJobs,
  TestApp,
} from './support/test-app';

describe('Merged emails for time and place changes (e2e)', () => {
  let t: TestApp;
  let org: string;
  let aya: string;
  let ben: string;
  let cid: string;
  let categoryId: string;
  let eventId: string;
  const http = () => request(t.app.getHttpServer());
  const startsAt = new Date(Date.now() + 7 * 24 * 3600_000);
  const later = (h: number) =>
    new Date(startsAt.getTime() + h * 3600_000).toISOString();

  const edit = (body: object) =>
    http()
      .patch(`/api/v1/events/${eventId}`)
      .set('Cookie', org)
      .send(body)
      .expect(200);
  const changeEmails = () =>
    t.emails.sent.filter((e) => e.subject.startsWith('Updated:'));

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    org = await login(t, 'org@example.com');
    aya = await login(t, 'aya@example.com');
    ben = await login(t, 'ben@example.com');
    cid = await login(t, 'cid@example.com');
    categoryId = (await t.prisma.category.create({ data: { name: 'Cosplay' } }))
      .id;
    const res = await http()
      .post('/api/v1/events')
      .set('Cookie', org)
      .send({
        title: 'Cosplay picnic',
        categoryId,
        isOnline: true,
        onlineUrl: 'https://meet.example/x',
        startsAt: startsAt.toISOString(),
        endsAt: later(2),
        timeZone: 'Asia/Jakarta',
        capacity: 5,
      })
      .expect(201);
    eventId = (res.body as { id: string }).id;
    for (const cookie of [aya, ben, cid]) {
      await http()
        .post(`/api/v1/events/${eventId}/reservation`)
        .set('Cookie', cookie)
        .expect(201);
    }
    // ben withdraws; cid's place is made Void (e.g. by an earlier cancellation)
    await http()
      .delete(`/api/v1/events/${eventId}/reservation`)
      .set('Cookie', ben)
      .expect(200);
    await t.prisma.reservation.updateMany({
      where: { attendee: { email: 'cid@example.com' } },
      data: { status: 'VOID' },
    });
    t.emails.sent.length = 0;
  });
  afterAll(() => t.app.close());

  it('several edits in the window → one email per Active Attendee, with the final values', async () => {
    await edit({ endsAt: later(3) });
    await edit({ startsAt: later(1), endsAt: later(4) });
    await settleJobs(t);

    const emails = changeEmails();
    expect(emails.map((e) => e.to)).toEqual(['aya@example.com']); // not Withdrawn ben, not Void cid
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString('en-GB', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    expect(emails[0].text).toContain(`${fmt(later(1))} – ${fmt(later(4))}`);
  });

  it('switching to Offline is a change worth an email', async () => {
    const city = await t.prisma.city.create({
      data: { name: 'Bandung', province: 'Jawa Barat' },
    });
    await edit({
      isOnline: false,
      cityId: city.id,
      venueName: 'Gedung Sate',
      venueAddress: 'Jl. Diponegoro 22',
    });
    await settleJobs(t);

    expect(changeEmails()).toHaveLength(1);
    expect(changeEmails()[0].text).toContain(
      'Gedung Sate, Jl. Diponegoro 22, Bandung',
    );
  });

  it('title, description and Tags edits send nothing', async () => {
    await edit({
      title: 'Cosplay picnic 2',
      description: 'Bring snacks',
      tags: ['picnic'],
    });
    await settleJobs(t);
    expect(changeEmails()).toEqual([]);
  });

  it('changing back to the original values within the window sends nothing', async () => {
    await edit({ timeZone: 'Asia/Makassar' });
    await edit({ timeZone: 'Asia/Jakarta' });
    await settleJobs(t);
    expect(changeEmails()).toEqual([]);
  });
});

import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { createOpenApiDocument } from '../src/app.setup';
import { AppError } from '../src/common/errors/app-error';
import { createTestApp, resetDb, TestApp } from './support/test-app';

// Test-only endpoints to exercise validation and error handling before real features exist.
class EchoQuery extends createZodDto(
  z.object({ count: z.coerce.number().int() }),
) {}

@Controller('__test')
class ProbeController {
  @Get('echo')
  echo(@Query() query: EchoQuery) {
    return query;
  }

  @Get('app-error')
  appError() {
    throw new AppError('CONFLICT', 409, 'Something conflicts', { hint: 'x' });
  }

  @Get('crash')
  crash() {
    throw new Error('secret internal detail');
  }
}

describe('Foundation (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController] });
  });
  afterAll(() => t.app.close());

  describe('error responses', () => {
    it('invalid input → 400 VALIDATION_FAILED', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/__test/echo?count=abc')
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
      });
      expect(res.body.details).toBeDefined();
    });

    it('valid input passes through the Zod pipe', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/__test/echo?count=3')
        .expect(200);
      expect(res.body).toEqual({ count: 3 });
    });

    it('AppError → its status and { code, message, details }', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/__test/app-error')
        .expect(409);
      expect(res.body).toEqual({
        code: 'CONFLICT',
        message: 'Something conflicts',
        details: { hint: 'x' },
      });
    });

    it('unknown route → 404 NOT_FOUND', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/nope')
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('unexpected error → 500 INTERNAL_ERROR without leaking details', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/v1/__test/crash')
        .expect(500);
      expect(res.body).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });
  });

  describe('API docs', () => {
    it('serves Swagger UI at /api/docs', async () => {
      const res = await request(t.app.getHttpServer())
        .get('/api/docs')
        .expect(200);
      expect(res.text).toContain('swagger');
    });

    it('OpenAPI document declares the catalog endpoints with 200 responses', () => {
      const doc = createOpenApiDocument(t.app);
      expect(
        doc.paths['/api/v1/categories']?.get?.responses['200'],
      ).toBeDefined();
      expect(doc.paths['/api/v1/cities']?.get?.responses['200']).toBeDefined();
    });
  });

  describe('Event CHECK constraints', () => {
    let categoryId: string;
    let cityId: string;
    const start = new Date('2027-01-10T03:00:00Z');
    const end = new Date('2027-01-10T09:00:00Z');

    beforeEach(async () => {
      await resetDb(t.prisma);
      categoryId = (
        await t.prisma.category.create({ data: { name: 'Cosplay' } })
      ).id;
      cityId = (
        await t.prisma.city.create({
          data: { name: 'Jakarta', province: 'DKI Jakarta' },
        })
      ).id;
      await t.prisma.user.create({
        data: { id: 'org-1', name: 'Org', email: 'org@example.com' },
      });
    });

    const listed = () => ({
      slug: `e-${Math.random()}`,
      kind: 'LISTED' as const,
      status: 'PUBLISHED' as const,
      title: 'COMIFURO',
      description: '',
      categoryId,
      isOnline: false,
      cityId,
      startsAt: start,
      endsAt: end,
      timeZone: 'Asia/Jakarta',
    });
    const hosted = () => ({
      ...listed(),
      kind: 'HOSTED' as const,
      organizerId: 'org-1',
    });

    it('accepts valid Listed and Hosted Events', async () => {
      await expect(
        t.prisma.event.create({ data: listed() }),
      ).resolves.toBeDefined();
      await expect(
        t.prisma.event.create({
          data: { ...hosted(), capacity: 2, reservedCount: 2 },
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      [
        'Hosted without an Organizer',
        () => ({ ...hosted(), organizerId: null }),
      ],
      [
        'Listed with an Organizer',
        () => ({ ...listed(), organizerId: 'org-1' }),
      ],
      ['offline without a City', () => ({ ...listed(), cityId: null })],
      ['end not after start', () => ({ ...listed(), endsAt: start })],
      [
        'reservedCount above capacity',
        () => ({ ...hosted(), capacity: 1, reservedCount: 2 }),
      ],
      ['negative reservedCount', () => ({ ...hosted(), reservedCount: -1 })],
    ])('rejects %s', async (_name, data) => {
      await expect(t.prisma.event.create({ data: data() })).rejects.toThrow();
    });
  });
});

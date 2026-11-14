import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import type { Express } from 'express';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AUTH, type Auth } from './auth/auth';

// Shared by main.ts, the e2e tests and the openapi.json export, so all three see the same app.
// Must run before app.init()/listen(): Better Auth's handler has to come before Nest's body parser.
export function configureApp(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.all('/api/auth/*splat', toNodeHandler(app.get<Auth>(AUTH)));
  app.setGlobalPrefix('api/v1');
}

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Dekakeyou API')
    .setVersion('1')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

export function setupSwagger(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));
}

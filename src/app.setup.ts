import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

// Shared by main.ts, the e2e tests and the openapi.json export, so all three see the same app.
export function configureApp(app: INestApplication) {
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

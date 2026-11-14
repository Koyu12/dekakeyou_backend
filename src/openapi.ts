import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, createOpenApiDocument } from './app.setup';

// Writes openapi.json for the frontend's type generation. Needs no database connection.
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  writeFileSync(
    'openapi.json',
    JSON.stringify(createOpenApiDocument(app), null, 2) + '\n',
  );
  await app.close();
}
void main();

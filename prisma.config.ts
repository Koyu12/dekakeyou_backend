import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // not required for `prisma generate` (Docker build, CI install), only for migrate/seed
    url: process.env.DATABASE_URL ?? '',
  },
});

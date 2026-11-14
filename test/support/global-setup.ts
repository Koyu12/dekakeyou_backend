import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

// Creates the test database if missing and applies all migrations, once per e2e run.
export default async function globalSetup() {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const testUrl = new URL(process.env.TEST_DATABASE_URL);
  const dbName = testUrl.pathname.slice(1);

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName],
  );
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'inherit',
  });
}

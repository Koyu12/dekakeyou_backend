import 'dotenv/config';

// Every e2e test file talks to the test database, never the dev one.
if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Fixed auth config so tests don't depend on a developer's local values.
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-characters-long!!';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

// Cover Image URLs are built from the bucket's public address.
process.env.R2_PUBLIC_URL = 'https://cdn.test';

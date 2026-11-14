import 'dotenv/config';

// Every e2e test file talks to the test database, never the dev one.
if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

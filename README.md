# Dekakeyou backend

NestJS API for Dekakeyou: discover interest-based events and join community-hosted ones. Domain language is in `GLOSSARY.md`, and decisions are in `docs/adr/`.

## Local development

```bash
cp .env.example .env          # if port 5432 is taken, set POSTGRES_PORT and the URLs to another port
npm install                   # also generates the Prisma client
docker compose up -d db       # Postgres 17
npx prisma migrate dev        # apply migrations
npx prisma db seed            # placeholder Categories and Cities
npm run start:dev             # http://localhost:4000/api/v1, docs at http://localhost:4000/api/docs
```

## Tests

```bash
npm test            # unit tests (pure *.rules.ts functions)
npm run test:e2e    # HTTP e2e tests against a real Postgres; creates and migrates TEST_DATABASE_URL
```

## API spec for the frontend

```bash
npm run openapi     # writes openapi.json (git-ignored), used by the frontend's type generation
```

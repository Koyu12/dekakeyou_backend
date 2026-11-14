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

## Login

Better Auth serves `/api/auth/*` (email OTP, Google, sign-out, update-user). Every `/api/v1` endpoint requires login unless it is marked `@Public()`, and `@Roles('admin')` restricts it to admins.

- **Email:** with `SMTP_HOST` empty, emails and login codes are printed in the server log (`[Email] to=… subject="Your Dekakeyou login code"`). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` (plus `SMTP_USER`/`SMTP_PASSWORD` if the server needs them, and `SMTP_SECURE`) to send real email through any SMTP provider; a partial setting stops the app at startup. To read real SMTP mail locally, run `docker compose --profile mail up -d mailpit`, set `SMTP_HOST=localhost` and `SMTP_PORT=1025`, and open http://localhost:8025.
- **Google:** enabled only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- **Making someone the Admin:** log in once with that email, then:

  ```bash
  docker compose exec db psql -U postgres -d dekakeyou -c "UPDATE \"User\" SET role = 'admin' WHERE email = 'you@example.com';"
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

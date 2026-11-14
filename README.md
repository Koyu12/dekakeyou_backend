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

## Cover Images (Supabase Storage)

The browser uploads straight to storage; the API only signs and checks:

1. `POST /api/v1/uploads` with `{ contentType, size }` (JPEG, PNG or WebP, at most 5 MB) returns a Pending Upload and a signed URL, valid for 10 minutes.
2. The browser `PUT`s the file to `uploadUrl` with exactly the returned `headers`.
3. `POST /api/v1/uploads/:id/verify` checks the real file type and runs the image check. The Upload becomes Approved or Rejected (with `rejectedReason`).
4. Send the Approved Upload's id as `coverUploadId` when creating or editing an Event (`null` removes the Cover Image). Events return `coverImageUrl`.

Storage is any S3-compatible service, set by `STORAGE_*` env vars. Without them, uploads answer 503; a partial set stops the app at startup.

**Supabase setup** (free, no card):

1. Create a project; pick the region nearest your users (e.g. Southeast Asia, Singapore).
2. Storage → New bucket `covers`, **Public bucket** on. Optional but good: file size limit 5 MB, allowed MIME types `image/jpeg, image/png, image/webp`.
3. Project Settings → Storage → **S3 Connection**: enable it, copy the endpoint and region, and create an access key.
4. Fill in `.env`:

```env
STORAGE_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
STORAGE_REGION=<region shown there, e.g. ap-southeast-1>
STORAGE_ACCESS_KEY_ID=<access key id>
STORAGE_SECRET_ACCESS_KEY=<secret>
STORAGE_BUCKET=covers
STORAGE_PUBLIC_URL=https://<project-ref>.supabase.co/storage/v1/object/public/covers
```

The S3 keys can write every bucket: keep them on the server only. Free Supabase projects pause after about a week without activity; resume them in the dashboard.

**Other S3 services** work with the same variables. Cloudflare R2, for example: endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`, plus a CORS rule on the bucket allowing `PUT` with `content-type` from the site.

## Tests

```bash
npm test            # unit tests (pure *.rules.ts functions)
npm run test:e2e    # HTTP e2e tests against a real Postgres; creates and migrates TEST_DATABASE_URL
```

## API spec for the frontend

```bash
npm run openapi     # writes openapi.json (git-ignored), used by the frontend's type generation
```

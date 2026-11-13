# The backend owns all data and rules; Next.js never touches the database

`dekakeyou_backend` (NestJS) is the only app that imports Prisma, runs Better Auth's server, and enforces business rules (Capacity, moderation, bans). `dekakeyou_frontend` (Next.js) is UI only. It reaches the API through a `/api/*` rewrite, which keeps cookies same-site and avoids CORS. Next.js can run server code (Route Handlers, Server Actions), so "just one query with Prisma" there is tempting. We rejected that, because the rules would end up split across two codebases that both write to the same database.

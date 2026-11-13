# Module layering and table ownership

Each module follows Controller → Service → Prisma, with business decisions in pure `*.rules.ts` functions. There are no repository classes and no hexagonal ports: Prisma is already the typed data layer, and the rules are unit-tested without a database. Each module writes only its own tables. A change that spans modules runs in one transaction opened by the coordinating service, which passes `tx` down. Emails are queued after commit.

Calls only go one way: `auth`/`moderation` → `events` → `reservations`, `events` → `catalog`/`uploads`, and every module → `notifications`. The one exception to table ownership is `Event.reservedCount`, which `reservations` owns. It locks the Event row (`SELECT … FOR UPDATE`) to join or withdraw, so Capacity can't be exceeded even with concurrent requests or a double-click after a withdrawal. It never calls `events`, which would create a cycle.

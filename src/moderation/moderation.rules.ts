import type { EventKind, EventStatus } from '../generated/prisma/enums';

// Pure decisions about Reports (ADR-0003): no Prisma, no Nest.

/** Open Reports from different users that hide a Published Hosted Event. */
export const REPORT_THRESHOLD = 3;

/**
 * Events people can see somewhere (public, or in their own Reservations) can be Reported.
 * Drafts and Removed Events aren't visible to anyone but the Admin.
 */
export function canReport(status: EventStatus) {
  return (
    status === 'PUBLISHED' ||
    status === 'CANCELLED' ||
    status === 'UNDER_REVIEW'
  );
}

/**
 * Whether Reports should now hide the Event. Only Published Hosted Events are hidden
 * automatically; Listed Events (e.g. COMIFURO) only ever go to the Admin, so a few false
 * Reports can't take down a major convention.
 */
export function shouldHideForReports(
  event: { kind: EventKind; status: EventStatus },
  openReports: number,
) {
  return (
    event.kind === 'HOSTED' &&
    event.status === 'PUBLISHED' &&
    openReports >= REPORT_THRESHOLD
  );
}

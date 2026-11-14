import { randomBytes } from 'node:crypto';
import type { EventStatus } from '../generated/prisma/enums';

// Pure decisions about Events (ADR-0003): no Prisma, no Nest.

/** URL-safe slug from a title, plus a random suffix so it's unique and never needs to change. */
export function makeSlug(title: string, suffix = randomSuffix()) {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "Café" → "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'event'}-${suffix}`;
}

function randomSuffix() {
  // 8 base36 chars ≈ 41 bits; the unique index on slug catches the rare collision.
  return BigInt(`0x${randomBytes(6).toString('hex')}`)
    .toString(36)
    .padStart(8, '0')
    .slice(-8);
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Statuses the public may see. Drafts, Under Review and Removed Events are hidden. */
export const PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'CANCELLED'];

export function canPublishListed(status: EventStatus) {
  return status === 'DRAFT';
}

export function canCancelListed(status: EventStatus) {
  return status === 'PUBLISHED';
}

export function canEditListed(status: EventStatus) {
  return status !== 'REMOVED';
}

export type Place = {
  isOnline: boolean;
  cityId: string | null;
  startsAt: Date;
  endsAt: Date;
};

/** Checks an Event's final time and place (after merging an edit). Returns the problem, or null. */
export function placeAndTimeError(event: Place) {
  if (event.endsAt <= event.startsAt)
    return 'End time must be after start time';
  if (!event.isOnline && !event.cityId) return 'An offline Event needs a City';
  return null;
}

// ─── Hosted Events ──────────────────────────────────────────────────

export const HOSTED_EVENTS_PER_DAY = 3;

/** How many Hosted Events a user may still create, given how many they created in the last 24h. */
export function canCreateHosted(createdInLast24h: number) {
  return createdInLast24h < HOSTED_EVENTS_PER_DAY;
}

/** Hosted Events are joined over a link when online; Attendees need it. */
export function onlineLinkError(event: {
  isOnline: boolean;
  onlineUrl: string | null;
}) {
  return event.isOnline && !event.onlineUrl
    ? 'An Online Event needs a link'
    : null;
}

export function canEditHosted(status: EventStatus) {
  return status === 'PUBLISHED' || status === 'UNDER_REVIEW';
}

/**
 * A real delete is for mistakes nobody has acted on yet. Cancelled Events stay visible to their
 * Attendees, and Events Under Review or Removed are kept as moderation evidence.
 */
export function deleteHostedError(
  status: EventStatus,
  activeReservations: number,
) {
  if (status !== 'PUBLISHED') return `A ${status} Event can't be deleted`;
  if (activeReservations > 0)
    return 'People have already joined; cancel the Event instead';
  return null;
}

/** Capacity can never drop below the places already taken. */
export function capacityError(capacity: number | null, reservedCount: number) {
  return capacity !== null && capacity < reservedCount
    ? `Capacity can't be lower than the ${reservedCount} places already taken`
    : null;
}

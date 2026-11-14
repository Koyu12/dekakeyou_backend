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

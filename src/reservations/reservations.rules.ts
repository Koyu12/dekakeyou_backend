import type {
  EventKind,
  EventStatus,
  ReservationStatus,
} from '../generated/prisma/enums';

// Pure decisions about Reservations (ADR-0003): no Prisma, no Nest.

/** The Event row as read under its lock, the only facts joining and withdrawing depend on. */
export type LockedEvent = {
  kind: EventKind;
  status: EventStatus;
  startsAt: Date;
  organizerId: string | null;
  capacity: number | null;
  reservedCount: number;
};

export type JoinError =
  | 'EVENT_NOT_JOINABLE'
  | 'JOIN_CLOSED'
  | 'OWN_EVENT'
  | 'ALREADY_RESERVED'
  | 'EVENT_FULL';

export function joinError(
  event: LockedEvent,
  existing: ReservationStatus | null,
  userId: string,
  now: Date,
): JoinError | null {
  if (event.kind !== 'HOSTED' || event.status !== 'PUBLISHED')
    return 'EVENT_NOT_JOINABLE';
  if (now >= event.startsAt) return 'JOIN_CLOSED';
  if (event.organizerId === userId) return 'OWN_EVENT';
  if (existing === 'ACTIVE') return 'ALREADY_RESERVED';
  if (event.capacity !== null && event.reservedCount >= event.capacity)
    return 'EVENT_FULL';
  return null;
}

export type WithdrawError = 'NOT_RESERVED' | 'WITHDRAW_CLOSED';

export function withdrawError(
  event: LockedEvent,
  existing: ReservationStatus | null,
  now: Date,
): WithdrawError | null {
  if (existing !== 'ACTIVE') return 'NOT_RESERVED';
  if (now >= event.startsAt) return 'WITHDRAW_CLOSED';
  return null;
}

export const RESERVATION_ERROR_MESSAGES: Record<
  JoinError | WithdrawError,
  string
> = {
  EVENT_NOT_JOINABLE: 'This Event cannot be joined',
  JOIN_CLOSED: 'Joining closed when the Event started',
  OWN_EVENT: "You can't join your own Event",
  ALREADY_RESERVED: 'You already have a place',
  EVENT_FULL: 'This Event is full',
  NOT_RESERVED: "You don't have a place to withdraw",
  WITHDRAW_CLOSED: 'Withdrawing closed when the Event started',
};

/** Attendees get the online link only while their place is active on a live Event. */
export function canSeeOnlineLink(
  reservation: ReservationStatus,
  event: EventStatus,
) {
  return (
    reservation === 'ACTIVE' &&
    (event === 'PUBLISHED' || event === 'UNDER_REVIEW')
  );
}

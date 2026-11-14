import {
  canSeeOnlineLink,
  joinError,
  LockedEvent,
  withdrawError,
} from './reservations.rules';

const now = new Date('2027-02-01T00:00:00Z');
const event: LockedEvent = {
  kind: 'HOSTED',
  status: 'PUBLISHED',
  startsAt: new Date('2027-02-06T02:00:00Z'),
  organizerId: 'org',
  capacity: 2,
  reservedCount: 1,
};

describe('joinError', () => {
  it('allows joining a Published Hosted Event with a place left', () => {
    expect(joinError(event, null, 'u1', now)).toBeNull();
  });

  it('allows re-joining after withdrawing', () => {
    expect(joinError(event, 'WITHDRAWN', 'u1', now)).toBeNull();
  });

  it('allows unlimited Events regardless of count', () => {
    expect(
      joinError(
        { ...event, capacity: null, reservedCount: 999 },
        null,
        'u1',
        now,
      ),
    ).toBeNull();
  });

  it.each([
    ['a Listed Event', { kind: 'LISTED' as const }],
    ['a Draft', { status: 'DRAFT' as const }],
    ['an Event Under Review', { status: 'UNDER_REVIEW' as const }],
    ['a Cancelled Event', { status: 'CANCELLED' as const }],
    ['a Removed Event', { status: 'REMOVED' as const }],
  ])('rejects %s as EVENT_NOT_JOINABLE', (_name, over) => {
    expect(joinError({ ...event, ...over }, null, 'u1', now)).toBe(
      'EVENT_NOT_JOINABLE',
    );
  });

  it('closes at the start time', () => {
    expect(joinError(event, null, 'u1', event.startsAt)).toBe('JOIN_CLOSED');
  });

  it("rejects the Organizer's own Event", () => {
    expect(joinError(event, null, 'org', now)).toBe('OWN_EVENT');
  });

  it('rejects a second Active Reservation', () => {
    expect(joinError(event, 'ACTIVE', 'u1', now)).toBe('ALREADY_RESERVED');
  });

  it('rejects when full', () => {
    expect(joinError({ ...event, reservedCount: 2 }, null, 'u1', now)).toBe(
      'EVENT_FULL',
    );
  });

  it('a Void Reservation (Event was cancelled) cannot be revived by joining', () => {
    expect(
      joinError({ ...event, status: 'CANCELLED' }, 'VOID', 'u1', now),
    ).toBe('EVENT_NOT_JOINABLE');
  });
});

describe('withdrawError', () => {
  it('allows withdrawing an Active Reservation before the start', () => {
    expect(withdrawError(event, 'ACTIVE', now)).toBeNull();
  });

  it('allows withdrawing while the Event is Under Review', () => {
    expect(
      withdrawError({ ...event, status: 'UNDER_REVIEW' }, 'ACTIVE', now),
    ).toBeNull();
  });

  it.each([null, 'WITHDRAWN', 'VOID'] as const)(
    'rejects without an Active Reservation (%p)',
    (existing) => {
      expect(withdrawError(event, existing, now)).toBe('NOT_RESERVED');
    },
  );

  it('closes at the start time', () => {
    expect(withdrawError(event, 'ACTIVE', event.startsAt)).toBe(
      'WITHDRAW_CLOSED',
    );
  });
});

describe('canSeeOnlineLink', () => {
  it('only for an Active Reservation on a Published or Under Review Event', () => {
    expect(canSeeOnlineLink('ACTIVE', 'PUBLISHED')).toBe(true);
    expect(canSeeOnlineLink('ACTIVE', 'UNDER_REVIEW')).toBe(true);
    expect(canSeeOnlineLink('ACTIVE', 'CANCELLED')).toBe(false);
    expect(canSeeOnlineLink('WITHDRAWN', 'PUBLISHED')).toBe(false);
    expect(canSeeOnlineLink('VOID', 'PUBLISHED')).toBe(false);
  });
});

import {
  canCancelListed,
  canCreateHosted,
  canEditHosted,
  capacityError,
  deleteHostedError,
  onlineLinkError,
  canEditListed,
  canPublishListed,
  isValidTimeZone,
  makeSlug,
  placeAndTimeError,
} from './events.rules';

describe('makeSlug', () => {
  it('lowercases, joins words with dashes and appends the suffix', () => {
    expect(makeSlug('COMIFURO 21: Jakarta!', 'ab12cd34')).toBe(
      'comifuro-21-jakarta-ab12cd34',
    );
  });

  it('strips accents', () => {
    expect(makeSlug('Café Cosplay Meetup', 'x')).toBe('cafe-cosplay-meetup-x');
  });

  it('falls back to "event" when nothing URL-safe is left (e.g. Japanese titles)', () => {
    expect(makeSlug('コミフロ', 'x')).toBe('event-x');
  });

  it('caps the readable part at 60 chars without a trailing dash', () => {
    const slug = makeSlug(`${'a'.repeat(59)} b`, 'x');
    expect(slug).toBe(`${'a'.repeat(59)}-x`);
  });

  it('generates an 8-char random suffix by default', () => {
    expect(makeSlug('Hello')).toMatch(/^hello-[0-9a-z]{8}$/);
    expect(makeSlug('Hello')).not.toBe(makeSlug('Hello'));
  });
});

describe('isValidTimeZone', () => {
  it.each([
    'Asia/Jakarta',
    'Asia/Makassar',
    'Asia/Jayapura',
    'Asia/Tokyo',
    'UTC',
  ])('accepts %s', (tz) => expect(isValidTimeZone(tz)).toBe(true));
  it.each(['WIB', 'Asia/Atlantis', ''])('rejects %p', (tz) =>
    expect(isValidTimeZone(tz)).toBe(false),
  );
});

describe('Listed Event status changes', () => {
  it('publishes only Drafts', () => {
    expect(canPublishListed('DRAFT')).toBe(true);
    expect(canPublishListed('PUBLISHED')).toBe(false);
    expect(canPublishListed('CANCELLED')).toBe(false);
  });

  it('cancels only Published Events', () => {
    expect(canCancelListed('PUBLISHED')).toBe(true);
    expect(canCancelListed('DRAFT')).toBe(false);
    expect(canCancelListed('CANCELLED')).toBe(false);
  });

  it('allows edits unless Removed', () => {
    expect(canEditListed('DRAFT')).toBe(true);
    expect(canEditListed('CANCELLED')).toBe(true);
    expect(canEditListed('REMOVED')).toBe(false);
  });
});

describe('placeAndTimeError', () => {
  const ok = {
    isOnline: false,
    cityId: 'c1',
    startsAt: new Date('2027-01-10T03:00:00Z'),
    endsAt: new Date('2027-01-10T09:00:00Z'),
  };

  it('accepts a valid offline Event and an online Event without City', () => {
    expect(placeAndTimeError(ok)).toBeNull();
    expect(
      placeAndTimeError({ ...ok, isOnline: true, cityId: null }),
    ).toBeNull();
  });

  it('rejects an end time not after the start', () => {
    expect(placeAndTimeError({ ...ok, endsAt: ok.startsAt })).toMatch(
      /after start/,
    );
  });

  it('rejects an offline Event without City', () => {
    expect(placeAndTimeError({ ...ok, cityId: null })).toMatch(/City/);
  });
});

describe('Hosted Event rules', () => {
  it('allows 3 Hosted Events per 24h, not a 4th', () => {
    expect(canCreateHosted(0)).toBe(true);
    expect(canCreateHosted(2)).toBe(true);
    expect(canCreateHosted(3)).toBe(false);
  });

  it('requires a link for Online Events only', () => {
    expect(onlineLinkError({ isOnline: true, onlineUrl: null })).toMatch(
      /link/,
    );
    expect(
      onlineLinkError({ isOnline: true, onlineUrl: 'https://meet.example' }),
    ).toBeNull();
    expect(onlineLinkError({ isOnline: false, onlineUrl: null })).toBeNull();
  });

  it('allows edits while Published or Under Review', () => {
    expect(canEditHosted('PUBLISHED')).toBe(true);
    expect(canEditHosted('UNDER_REVIEW')).toBe(true);
    expect(canEditHosted('CANCELLED')).toBe(false);
    expect(canEditHosted('REMOVED')).toBe(false);
  });

  it('deletes only a Published Event nobody has joined', () => {
    expect(deleteHostedError('PUBLISHED', 0)).toBeNull();
    expect(deleteHostedError('PUBLISHED', 1)).toMatch(/cancel the Event/);
    expect(deleteHostedError('CANCELLED', 0)).not.toBeNull();
    expect(deleteHostedError('UNDER_REVIEW', 0)).not.toBeNull();
    expect(deleteHostedError('REMOVED', 0)).not.toBeNull();
  });

  it('keeps Capacity at or above the places taken', () => {
    expect(capacityError(null, 50)).toBeNull();
    expect(capacityError(20, 20)).toBeNull();
    expect(capacityError(10, 18)).toMatch(/18 places/);
  });
});

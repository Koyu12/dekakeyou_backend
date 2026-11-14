import { detailsChanged, eventDetails, renderNotice } from './notices';

const event = {
  title: 'Cosplay picnic',
  startsAt: new Date('2026-12-05T03:00:00Z'),
  endsAt: new Date('2026-12-05T06:00:00Z'),
  timeZone: 'Asia/Jakarta',
  isOnline: false,
  cityId: 'city-1',
  venueName: 'Taman Suropati',
  venueAddress: 'Jl. Taman Suropati',
  city: { name: 'Jakarta' },
  removedReason: 'Selling counterfeit goods',
};

describe('renderNotice', () => {
  it('shows the start time in the Event’s own time zone', () => {
    const email = renderNotice('EVENT_CANCELLED', event, 'a@example.com');
    expect(email.to).toBe('a@example.com');
    expect(email.text).toContain('5 Dec 2026, 10:00');
  });

  it('gives the reason only to the Organizer', () => {
    expect(
      renderNotice('EVENT_REMOVED', event, 'a@example.com').text,
    ).not.toContain('counterfeit');
    expect(
      renderNotice('EVENT_REMOVED_ORGANIZER', event, 'o@example.com').text,
    ).toContain('Reason: Selling counterfeit goods');
  });

  it('a change email lists the new time and place', () => {
    const { text } = renderNotice('EVENT_CHANGED', event, 'a@example.com');
    expect(text).toContain('5 Dec 2026, 10:00 – 5 Dec 2026, 13:00');
    expect(text).toContain('Taman Suropati, Jl. Taman Suropati, Jakarta');
    expect(
      renderNotice('EVENT_CHANGED', { ...event, isOnline: true }, 'a').text,
    ).toContain('Where: Online');
  });
});

describe('detailsChanged: which edits Attendees are told about', () => {
  const base = eventDetails(event);

  it.each([
    ['start time', { startsAt: new Date('2026-12-06T03:00:00Z') }],
    ['end time', { endsAt: new Date('2026-12-05T07:00:00Z') }],
    ['time zone', { timeZone: 'Asia/Makassar' }],
    ['City', { cityId: 'city-2' }],
    ['venue name', { venueName: 'GBK' }],
    ['address', { venueAddress: 'Jl. Sudirman' }],
    ['Online/Offline', { isOnline: true }],
  ])('%s → yes', (_, patch) => {
    expect(detailsChanged(base, eventDetails({ ...event, ...patch }))).toBe(
      true,
    );
  });

  it('title, description, Tags and everything else → no', () => {
    const other = { ...event, title: 'New title', description: 'x', tags: [] };
    expect(detailsChanged(base, eventDetails(other))).toBe(false);
  });
});

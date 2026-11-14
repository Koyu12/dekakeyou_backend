import { renderNotice } from './notices';

describe('renderNotice', () => {
  const event = {
    title: 'Cosplay picnic',
    startsAt: new Date('2026-12-05T03:00:00Z'),
    timeZone: 'Asia/Jakarta',
    removedReason: 'Selling counterfeit goods',
  };

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
});

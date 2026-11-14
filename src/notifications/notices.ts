import type { Email } from './email-sender';

/** One email to one user about one Event. Rendered when the job runs, from current data. */
export type Notice = {
  type: 'EVENT_CANCELLED' | 'EVENT_REMOVED' | 'EVENT_REMOVED_ORGANIZER';
  eventId: string;
  userId: string;
};

export type NoticeEvent = {
  title: string;
  startsAt: Date;
  timeZone: string;
  removedReason: string | null;
};

export function renderNotice(
  type: Notice['type'],
  event: NoticeEvent,
  to: string,
): Email {
  const when = event.startsAt.toLocaleString('en-GB', {
    timeZone: event.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const name = `"${event.title}" (${when})`;
  switch (type) {
    case 'EVENT_CANCELLED':
      return {
        to,
        subject: `Cancelled: ${event.title}`,
        text: `The Organizer cancelled ${name}. Your Reservation is void; there's nothing more you need to do.`,
      };
    case 'EVENT_REMOVED':
      return {
        to,
        subject: `Removed: ${event.title}`,
        text: `${name} was removed by Dekakeyou's moderators. Your Reservation is void; there's nothing more you need to do.`,
      };
    case 'EVENT_REMOVED_ORGANIZER':
      return {
        to,
        subject: `Your Event was removed: ${event.title}`,
        text: `Your Event ${name} was removed by Dekakeyou's moderators.\n\nReason: ${event.removedReason ?? '(none given)'}\n\nIts Attendees have been told and their Reservations are void.`,
      };
  }
}

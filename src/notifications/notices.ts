import type { Email } from './email-sender';

/** One email to one user about one Event. Rendered when the job runs, from current data. */
export type Notice = {
  type:
    | 'EVENT_CANCELLED'
    | 'EVENT_REMOVED'
    | 'EVENT_REMOVED_ORGANIZER'
    | 'EVENT_CHANGED';
  eventId: string;
  userId: string;
};

export type NoticeEvent = EventDetailsSource & {
  title: string;
  removedReason: string | null;
  city: { name: string } | null;
};

type EventDetailsSource = {
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  isOnline: boolean;
  cityId: string | null;
  venueName: string | null;
  venueAddress: string | null;
};

/** The details Attendees are told about when they change: when and where. Nothing else. */
export type EventDetails = ReturnType<typeof eventDetails>;

export function eventDetails(e: EventDetailsSource) {
  return {
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timeZone: e.timeZone,
    isOnline: e.isOnline,
    cityId: e.cityId,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
  };
}

export function detailsChanged(a: EventDetails, b: EventDetails) {
  return (Object.keys(a) as (keyof EventDetails)[]).some((k) => a[k] !== b[k]);
}

export function renderNotice(
  type: Notice['type'],
  event: NoticeEvent,
  to: string,
): Email {
  const fmt = (d: Date) =>
    d.toLocaleString('en-GB', {
      timeZone: event.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  const name = `"${event.title}" (${fmt(event.startsAt)})`;
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
    case 'EVENT_CHANGED': {
      const where = event.isOnline
        ? 'Online (the link is on the Event page)'
        : [event.venueName, event.venueAddress, event.city?.name]
            .filter(Boolean)
            .join(', ');
      return {
        to,
        subject: `Updated: ${event.title}`,
        text: `The Organizer changed the time or place of "${event.title}". Your Reservation still stands.\n\nWhen: ${fmt(event.startsAt)} – ${fmt(event.endsAt)} (${event.timeZone})\nWhere: ${where}`,
      };
    }
  }
}

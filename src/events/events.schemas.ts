import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CategorySchema, CitySchema } from '../catalog/catalog.schemas';
import { isValidTimeZone } from './events.rules';

const dateTimeInput = z.iso.datetime({ offset: true });
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const optionalHttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .nullable()
  .optional();

const BaseEventFields = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(5000).optional(), // Markdown, rendered with raw HTML disabled
  categoryId: z.uuid(),
  isOnline: z.boolean(),
  cityId: z.uuid().nullable().optional(),
  venueName: optionalText(200),
  venueAddress: optionalText(300),
  startsAt: dateTimeInput,
  endsAt: dateTimeInput,
  timeZone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone'),
  tags: z.array(z.string().max(60)).max(20).optional(), // normalized + capped at 5 by the catalog rules
});

const ListedEventFields = BaseEventFields.extend({
  presenterName: optionalText(120),
  officialUrl: optionalHttpUrl,
});
export class CreateListedEventDto extends createZodDto(ListedEventFields) {}
export class UpdateListedEventDto extends createZodDto(
  ListedEventFields.partial(),
) {}

const HostedEventFields = BaseEventFields.extend({
  onlineUrl: optionalHttpUrl, // required when online; only ever shown to the Organizer and Attendees
  capacity: z.number().int().min(1).max(100_000).nullable().optional(), // null = unlimited
});
export class CreateHostedEventDto extends createZodDto(HostedEventFields) {}
export class UpdateHostedEventDto extends createZodDto(
  HostedEventFields.partial(),
) {}

// Public: safe to cache, so it never contains the online link.
export const EventDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: z.enum(['LISTED', 'HOSTED']),
  status: z.enum([
    'DRAFT',
    'PUBLISHED',
    'UNDER_REVIEW',
    'CANCELLED',
    'REMOVED',
  ]),
  title: z.string(),
  description: z.string(),
  category: CategorySchema,
  isOnline: z.boolean(),
  city: CitySchema.nullable(),
  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.string(),
  presenterName: z.string().nullable(), // Listed Events
  officialUrl: z.string().nullable(), // Listed Events
  organizer: z // Hosted Events
    .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
    .nullable(),
  capacity: z.number().int().nullable(),
  reservedCount: z.number().int(),
  tags: z.array(z.string()),
  cancelledAt: z.iso.datetime().nullable(),
});
export class EventDetailDto extends createZodDto(EventDetailSchema) {}
export type EventDetail = z.infer<typeof EventDetailSchema>;

// The Organizer's own view of a Hosted Event: never cached, includes the online link.
export const OrganizerEventSchema = EventDetailSchema.extend({
  onlineUrl: z.string().nullable(),
});
export class OrganizerEventDto extends createZodDto(OrganizerEventSchema) {}
export type OrganizerEvent = z.infer<typeof OrganizerEventSchema>;

// ─── Browsing ───────────────────────────────────────────────────────

export class BrowseEventsQuery extends createZodDto(
  z.object({
    category: z.uuid().optional(),
    city: z.uuid().optional(), // Online Events match every City
    tag: z.string().max(60).optional(),
    q: z.string().trim().min(1).max(100).optional(), // title search
    from: dateTimeInput.optional(), // Events still running at or after this moment
    to: dateTimeInput.optional(), // Events starting at or before this moment
    includePast: z.stringbool().default(false),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
) {}

// A list item: the public detail without the long description.
export const EventCardSchema = EventDetailSchema.omit({ description: true });
export type EventCard = z.infer<typeof EventCardSchema>;

export const EventPageSchema = z.object({
  items: z.array(EventCardSchema),
  nextCursor: z.string().nullable(), // pass back as ?cursor= for the next page
});
export class EventPageDto extends createZodDto(EventPageSchema) {}
export type EventPage = z.infer<typeof EventPageSchema>;

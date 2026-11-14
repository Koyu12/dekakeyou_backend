import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CategorySchema, CitySchema } from '../catalog/catalog.schemas';
import { isValidTimeZone } from './events.rules';

const dateTimeInput = z.iso.datetime({ offset: true });
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const ListedEventFields = z.object({
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
  presenterName: optionalText(120),
  officialUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullable()
    .optional(),
});

export class CreateListedEventDto extends createZodDto(ListedEventFields) {}
export class UpdateListedEventDto extends createZodDto(
  ListedEventFields.partial(),
) {}

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
  presenterName: z.string().nullable(),
  officialUrl: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
});
export class EventDetailDto extends createZodDto(EventDetailSchema) {}
export type EventDetail = z.infer<typeof EventDetailSchema>;

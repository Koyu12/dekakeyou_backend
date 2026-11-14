import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CitySchema } from '../catalog/catalog.schemas';

const EventSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  status: z.enum([
    'DRAFT',
    'PUBLISHED',
    'UNDER_REVIEW',
    'CANCELLED',
    'REMOVED',
  ]),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.string(),
  isOnline: z.boolean(),
  city: CitySchema.nullable(),
  venueName: z.string().nullable(),
});

// The Attendee's own view: never cached, includes the online link while their place is active.
export const MyReservationSchema = z.object({
  id: z.uuid(),
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'VOID']),
  event: EventSummarySchema,
  onlineUrl: z.string().nullable(),
});
export class MyReservationDto extends createZodDto(MyReservationSchema) {}
export type MyReservation = z.infer<typeof MyReservationSchema>;

// What an Organizer sees about who joined: display name and avatar, never email.
export const AttendeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  joinedAt: z.iso.datetime(),
});
export class AttendeeDto extends createZodDto(AttendeeSchema) {}

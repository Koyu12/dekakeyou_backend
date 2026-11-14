import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ReportReason = z.enum(['INDECENT', 'SPAM', 'WRONG_INFO', 'OTHER']);

export class CreateReportDto extends createZodDto(
  z.object({
    reason: ReportReason,
    comment: z.string().trim().max(500).optional(),
  }),
) {}

export const ReportSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  reason: ReportReason,
  comment: z.string().nullable(),
  status: z.enum(['OPEN', 'DISMISSED', 'ACTIONED']),
  createdAt: z.iso.datetime(),
});
export class ReportDto extends createZodDto(ReportSchema) {}
export type ReportView = z.infer<typeof ReportSchema>;

// ─── Admin review queue ─────────────────────────────────────────────

const QueueReportSchema = z.object({
  id: z.uuid(),
  reason: ReportReason,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reporter: z.object({ id: z.string(), name: z.string() }),
});

export const QueueItemSchema = z.object({
  event: z.object({
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
    reviewReason: z.enum(['AUTO_CHECK', 'REPORTED']).nullable(),
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    organizer: z.object({ id: z.string(), name: z.string() }).nullable(),
    startsAt: z.iso.datetime(),
  }),
  openReports: z.array(QueueReportSchema),
});
export class QueueItemDto extends createZodDto(QueueItemSchema) {}
export type QueueItem = z.infer<typeof QueueItemSchema>;

export class RemoveEventDto extends createZodDto(
  z.object({ reason: z.string().trim().min(3).max(500) }), // shown to the Organizer
) {}

export class ResolveReportsDto extends createZodDto(
  z.object({
    // DISMISSED: nothing wrong. ACTIONED: the Admin fixed it (e.g. edited or cancelled the Event).
    outcome: z.enum(['DISMISSED', 'ACTIONED']),
  }),
) {}

export const ModerationResultSchema = z.object({
  eventId: z.uuid(),
  status: z.enum([
    'DRAFT',
    'PUBLISHED',
    'UNDER_REVIEW',
    'CANCELLED',
    'REMOVED',
  ]),
  resolvedReports: z.number().int(),
});
export class ModerationResultDto extends createZodDto(ModerationResultSchema) {}
export type ModerationResult = z.infer<typeof ModerationResultSchema>;

// ─── Admin: users and bans ──────────────────────────────────────────

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  banned: z.boolean().nullable(),
  banReason: z.string().nullable(),
  banExpires: z.iso.datetime().nullable(),
});
export class AccountDto extends createZodDto(AccountSchema) {}
export type Account = z.infer<typeof AccountSchema>;

export class FindAccountQuery extends createZodDto(
  z.object({ email: z.email() }),
) {}

export class BanUserDto extends createZodDto(
  z.object({
    reason: z.string().trim().min(3).max(500), // also the reason on the user's Removed Events
    expiresAt: z.iso.datetime({ offset: true }).optional(), // omit for a permanent ban
  }),
) {}

export const BanResultSchema = z.object({
  account: AccountSchema,
  removedEvents: z.number().int(),
  withdrawnReservations: z.number().int(),
});
export class BanResultDto extends createZodDto(BanResultSchema) {}
export type BanResult = z.infer<typeof BanResultSchema>;

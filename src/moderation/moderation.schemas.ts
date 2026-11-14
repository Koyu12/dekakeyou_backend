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

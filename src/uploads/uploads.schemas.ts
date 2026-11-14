import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { COVER_MAX_BYTES, COVER_TYPES } from './uploads.rules';

export class RequestUploadDto extends createZodDto(
  z.object({
    contentType: z.enum(COVER_TYPES),
    size: z.number().int().min(1).max(COVER_MAX_BYTES), // bytes; the signed URL accepts exactly this
  }),
) {}

export const UploadTicketSchema = z.object({
  id: z.uuid(),
  uploadUrl: z.string(), // PUT the file here with exactly these headers
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export class UploadTicketDto extends createZodDto(UploadTicketSchema) {}
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

export const UploadSchema = z.object({
  id: z.uuid(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  rejectedReason: z.string().nullable(),
  url: z.string().nullable(), // public Cover Image URL, once Approved
});
export class UploadDto extends createZodDto(UploadSchema) {}
export type UploadView = z.infer<typeof UploadSchema>;

// Stable codes the frontend can switch on. Add new ones here as features land.
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  // Events
  | 'EVENT_NOT_FOUND'
  | 'INVALID_STATUS_CHANGE'
  | 'CATEGORY_NOT_AVAILABLE'
  | 'CITY_NOT_AVAILABLE'
  | 'CAPACITY_BELOW_RESERVED'
  | 'CONTENT_REJECTED'
  // Reservations
  | 'EVENT_NOT_JOINABLE'
  | 'JOIN_CLOSED'
  | 'OWN_EVENT'
  | 'ALREADY_RESERVED'
  | 'EVENT_FULL'
  | 'NOT_RESERVED'
  | 'WITHDRAW_CLOSED'
  // Moderation
  | 'ALREADY_REPORTED';

export type ErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

// Services throw this; the global filter turns it into { code, message, details? }.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

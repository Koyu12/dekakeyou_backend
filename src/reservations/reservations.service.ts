import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../auth/auth';
import { AppError } from '../common/errors/app-error';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canSeeOnlineLink,
  joinError,
  LockedEvent,
  RESERVATION_ERROR_MESSAGES,
  withdrawError,
} from './reservations.rules';
import type { MyReservation } from './reservations.schemas';

type Tx = Prisma.TransactionClient;

const withEvent = {
  event: {
    include: { city: { select: { id: true, name: true, province: true } } },
  },
} satisfies Prisma.ReservationInclude;
type ReservationWithEvent = Prisma.ReservationGetPayload<{
  include: typeof withEvent;
}>;

// Joins for one Event queue on its row lock; give them room to wait instead of failing fast.
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

// Owns Reservations and, as the one exception (ADR-0003), Event.reservedCount.
@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  join(user: SessionUser, eventId: string): Promise<MyReservation> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const existing = await findOwn(tx, eventId, user.id);

      const error = joinError(
        event,
        existing?.status ?? null,
        user.id,
        new Date(),
      );
      if (error)
        throw new AppError(error, 409, RESERVATION_ERROR_MESSAGES[error]);

      await tx.event.update({
        where: { id: eventId },
        data: { reservedCount: { increment: 1 } },
      });
      const reservation = await tx.reservation.upsert({
        where: { eventId_attendeeId: { eventId, attendeeId: user.id } },
        create: { eventId, attendeeId: user.id },
        update: { status: 'ACTIVE' }, // re-joining reactivates the same row
        include: withEvent,
      });
      return toMine(reservation);
    }, TX_OPTIONS);
  }

  withdraw(user: SessionUser, eventId: string): Promise<MyReservation> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockEvent(tx, eventId);
      const existing = await findOwn(tx, eventId, user.id);

      const error = withdrawError(event, existing?.status ?? null, new Date());
      if (error)
        throw new AppError(error, 409, RESERVATION_ERROR_MESSAGES[error]);

      await tx.event.update({
        where: { id: eventId },
        data: { reservedCount: { decrement: 1 } },
      });
      const reservation = await tx.reservation.update({
        where: { eventId_attendeeId: { eventId, attendeeId: user.id } },
        data: { status: 'WITHDRAWN' },
        include: withEvent,
      });
      return toMine(reservation);
    }, TX_OPTIONS);
  }

  async listMine(user: SessionUser): Promise<MyReservation[]> {
    const reservations = await this.prisma.reservation.findMany({
      where: { attendeeId: user.id },
      include: withEvent,
      orderBy: { event: { startsAt: 'desc' } },
    });
    return reservations.map(toMine);
  }

  /** The Organizer's list of who is coming. Someone else's Event looks missing. */
  async listAttendees(user: SessionUser, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, kind: 'HOSTED', organizerId: user.id },
      select: { id: true },
    });
    if (!event) throw new AppError('EVENT_NOT_FOUND', 404, 'Event not found');

    const reservations = await this.prisma.reservation.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { attendee: { select: { id: true, name: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return reservations.map((r) => ({
      ...r.attendee,
      joinedAt: r.createdAt.toISOString(),
    }));
  }
}

/** Locks the Event row so joins and withdrawals for it run one at a time (ADR-0003). */
async function lockEvent(tx: Tx, eventId: string): Promise<LockedEvent> {
  const [event] = await tx.$queryRaw<LockedEvent[]>`
    SELECT kind, status, "startsAt", "organizerId", capacity, "reservedCount"
    FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
  if (!event) throw new AppError('EVENT_NOT_FOUND', 404, 'Event not found');
  return event;
}

function findOwn(tx: Tx, eventId: string, attendeeId: string) {
  return tx.reservation.findUnique({
    where: { eventId_attendeeId: { eventId, attendeeId } },
    select: { status: true },
  });
}

function toMine(r: ReservationWithEvent): MyReservation {
  const e = r.event;
  return {
    id: r.id,
    status: r.status,
    event: {
      id: e.id,
      slug: e.slug,
      title: e.title,
      status: e.status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      timeZone: e.timeZone,
      isOnline: e.isOnline,
      city: e.city,
      venueName: e.venueName,
    },
    onlineUrl: canSeeOnlineLink(r.status, e.status) ? e.onlineUrl : null,
  };
}

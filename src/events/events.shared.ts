import { AppError } from '../common/errors/app-error';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { placeAndTimeError } from './events.rules';
import type { EventDetail, OrganizerEvent } from './events.schemas';

// Shared by the Listed and Hosted Event services.

export const withRefs = {
  category: { select: { id: true, name: true } },
  city: { select: { id: true, name: true, province: true } },
  organizer: { select: { id: true, name: true, image: true } },
} satisfies Prisma.EventInclude;

export type EventWithRefs = Prisma.EventGetPayload<{
  include: typeof withRefs;
}>;

export type PlaceInput = {
  isOnline: boolean;
  cityId?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  onlineUrl?: string | null;
};

/** Online Events have no physical place; offline Events have no link. */
export function normalizePlace(p: PlaceInput) {
  return p.isOnline
    ? {
        isOnline: true,
        cityId: null,
        venueName: null,
        venueAddress: null,
        onlineUrl: p.onlineUrl ?? null,
      }
    : {
        isOnline: false,
        cityId: p.cityId ?? null,
        venueName: p.venueName ?? null,
        venueAddress: p.venueAddress ?? null,
        onlineUrl: null,
      };
}

/** Merges a partial edit's place fields over the current Event (undefined = unchanged). */
export function mergePlace(input: Partial<PlaceInput>, current: PlaceInput) {
  const pick = <K extends keyof PlaceInput>(k: K) =>
    input[k] !== undefined ? input[k] : current[k];
  return normalizePlace({
    isOnline: input.isOnline ?? current.isOnline,
    cityId: pick('cityId'),
    venueName: pick('venueName'),
    venueAddress: pick('venueAddress'),
    onlineUrl: pick('onlineUrl'),
  });
}

export function assertPlaceAndTime(
  event: Parameters<typeof placeAndTimeError>[0],
) {
  const problem = placeAndTimeError(event);
  if (problem) throw invalid(problem);
}

/** Newly chosen Category/City must exist and not be archived. */
export async function assertRefsAvailable(
  prisma: Pick<PrismaClient, 'category' | 'city'>,
  categoryId?: string,
  cityId?: string | null,
) {
  if (categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, archivedAt: null },
    });
    if (!category) {
      throw new AppError(
        'CATEGORY_NOT_AVAILABLE',
        400,
        'Unknown or archived Category',
      );
    }
  }
  if (cityId) {
    const city = await prisma.city.findFirst({
      where: { id: cityId, archivedAt: null },
    });
    if (!city) {
      throw new AppError('CITY_NOT_AVAILABLE', 400, 'Unknown or archived City');
    }
  }
}

export function toDetail(e: EventWithRefs): EventDetail {
  return {
    id: e.id,
    slug: e.slug,
    kind: e.kind,
    status: e.status,
    title: e.title,
    description: e.description,
    category: e.category,
    isOnline: e.isOnline,
    city: e.city,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timeZone: e.timeZone,
    presenterName: e.presenterName,
    officialUrl: e.officialUrl,
    organizer: e.organizer,
    capacity: e.capacity,
    reservedCount: e.reservedCount,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
  };
}

export function toOrganizerView(e: EventWithRefs): OrganizerEvent {
  return { ...toDetail(e), onlineUrl: e.onlineUrl };
}

export const notFound = () =>
  new AppError('EVENT_NOT_FOUND', 404, 'Event not found');
export const statusError = (message: string) =>
  new AppError('INVALID_STATUS_CHANGE', 409, message);
export const invalid = (message: string) =>
  new AppError('VALIDATION_FAILED', 400, message);

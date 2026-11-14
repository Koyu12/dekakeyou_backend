import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { SessionUser } from '../auth/auth';
import { CurrentUser } from '../common/auth/auth.decorators';
import { AttendeeDto, MyReservationDto } from './reservations.schemas';
import { ReservationsService } from './reservations.service';

// All responses are personal (and may include an online link): never cache.
@ApiTags('reservations')
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** Join: take a place in a Hosted Event. */
  @Post('events/:eventId/reservation')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 201, type: MyReservationDto })
  join(
    @CurrentUser() user: SessionUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.reservations.join(user, eventId);
  }

  /** Withdraw: give the place back before the Event starts. */
  @Delete('events/:eventId/reservation')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: MyReservationDto })
  withdraw(
    @CurrentUser() user: SessionUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.reservations.withdraw(user, eventId);
  }

  @Get('me/reservations')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: [MyReservationDto] })
  listMine(@CurrentUser() user: SessionUser) {
    return this.reservations.listMine(user);
  }

  /** The Organizer's Attendee list: display names and avatars only. */
  @Get('me/events/:eventId/attendees')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: [AttendeeDto] })
  listAttendees(
    @CurrentUser() user: SessionUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.reservations.listAttendees(user, eventId);
  }
}

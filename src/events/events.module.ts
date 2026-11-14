import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { AdminListedEventsController } from './admin-listed-events.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HostedEventsController } from './hosted-events.controller';
import { HostedEventsService } from './hosted-events.service';

// events → reservations is the allowed direction (ADR-0003): calling an Event off voids its Reservations.
@Module({
  imports: [ReservationsModule],
  controllers: [
    EventsController,
    HostedEventsController,
    AdminListedEventsController,
  ],
  providers: [EventsService, HostedEventsService],
  exports: [EventsService, HostedEventsService],
})
export class EventsModule {}

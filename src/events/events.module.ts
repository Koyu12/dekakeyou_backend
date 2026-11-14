import { Module } from '@nestjs/common';
import { AdminListedEventsController } from './admin-listed-events.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HostedEventsController } from './hosted-events.controller';
import { HostedEventsService } from './hosted-events.service';

@Module({
  controllers: [
    EventsController,
    HostedEventsController,
    AdminListedEventsController,
  ],
  providers: [EventsService, HostedEventsService],
  exports: [EventsService, HostedEventsService],
})
export class EventsModule {}

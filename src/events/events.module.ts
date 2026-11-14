import { Module } from '@nestjs/common';
import { AdminListedEventsController } from './admin-listed-events.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [EventsController, AdminListedEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}

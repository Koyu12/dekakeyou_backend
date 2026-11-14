import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminListedEventsController } from './admin-listed-events.controller';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HostedEventsController } from './hosted-events.controller';
import { HostedEventsService } from './hosted-events.service';
import { StorageCleanupService } from './storage-cleanup.service';

// events → catalog/reservations are allowed directions (ADR-0003): Tags live in catalog, and
// calling an Event off voids its Reservations.
@Module({
  imports: [CatalogModule, ReservationsModule, UploadsModule],
  controllers: [
    EventsController,
    HostedEventsController,
    AdminListedEventsController,
  ],
  providers: [EventsService, HostedEventsService, StorageCleanupService],
  exports: [EventsService, HostedEventsService],
})
export class EventsModule {}

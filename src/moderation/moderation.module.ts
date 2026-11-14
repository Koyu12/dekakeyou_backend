import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// moderation → events is the allowed direction (ADR-0003): status changes go through events.
@Module({
  imports: [EventsModule],
  controllers: [ReportsController, AdminModerationController],
  providers: [ReportsService, AdminModerationService],
})
export class ModerationModule {}

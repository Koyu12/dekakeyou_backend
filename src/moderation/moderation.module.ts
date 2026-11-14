import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// moderation → events is the allowed direction (ADR-0003): hiding an Event goes through events.
@Module({
  imports: [EventsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ModerationModule {}

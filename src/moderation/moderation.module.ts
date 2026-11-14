import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// moderation → auth/events/reservations are allowed directions (ADR-0003): it coordinates
// Admin decisions; each of those modules keeps writing only its own tables.
@Module({
  imports: [AuthModule, EventsModule, ReservationsModule],
  controllers: [
    ReportsController,
    AdminModerationController,
    AdminUsersController,
  ],
  providers: [ReportsService, AdminModerationService, AdminUsersService],
})
export class ModerationModule {}

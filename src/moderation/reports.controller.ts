import {
  Body,
  Controller,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { SessionUser } from '../auth/auth';
import { CurrentUser } from '../common/auth/auth.decorators';
import { NO_STORE } from '../common/http/cache';
import { CreateReportDto, ReportDto } from './moderation.schemas';
import { ReportsService } from './reports.service';

@ApiTags('moderation')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Report an Event as inappropriate. One Report per user per Event. */
  @Post('events/:eventId/reports')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 201, type: ReportDto })
  report(
    @CurrentUser() user: SessionUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: CreateReportDto,
  ) {
    return this.reports.report(user, eventId, body);
  }
}

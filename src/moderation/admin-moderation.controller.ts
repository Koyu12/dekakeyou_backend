import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Roles } from '../common/auth/auth.decorators';
import { NO_STORE } from '../common/http/cache';
import { AdminModerationService } from './admin-moderation.service';
import {
  ModerationResultDto,
  QueueItemDto,
  RemoveEventDto,
  ResolveReportsDto,
} from './moderation.schemas';

@ApiTags('admin: moderation')
@Roles('admin')
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get('queue')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: [QueueItemDto] })
  queue() {
    return this.moderation.queue();
  }

  @Post('events/:eventId/restore')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: ModerationResultDto })
  restore(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.moderation.restore(eventId);
  }

  @Post('events/:eventId/remove')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: ModerationResultDto })
  remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: RemoveEventDto,
  ) {
    return this.moderation.remove(eventId, body.reason);
  }

  @Post('events/:eventId/reports/resolve')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: ModerationResultDto })
  resolveReports(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() body: ResolveReportsDto,
  ) {
    return this.moderation.resolveReports(eventId, body.outcome);
  }
}

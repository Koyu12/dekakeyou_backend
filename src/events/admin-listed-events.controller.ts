import type { SessionUser } from '../auth/auth';
import { NO_STORE } from '../common/http/cache';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../common/auth/auth.decorators';
import {
  CreateListedEventDto,
  EventDetailDto,
  UpdateListedEventDto,
} from './events.schemas';
import { EventsService } from './events.service';

// The Admin manages Listed Events (e.g. COMIFURO): Draft → Published → Cancelled.
@ApiTags('admin: listed events')
@Roles('admin')
@Controller('admin/events/listed')
export class AdminListedEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: [EventDetailDto] })
  list() {
    return this.events.listListedForAdmin();
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: EventDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.getListedForAdmin(id);
  }

  @Post()
  @ZodResponse({ status: 201, type: EventDetailDto })
  create(
    @CurrentUser() admin: SessionUser,
    @Body() body: CreateListedEventDto,
  ) {
    return this.events.createListed(admin.id, body);
  }

  @Patch(':id')
  @ZodResponse({ status: 200, type: EventDetailDto })
  update(
    @CurrentUser() admin: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateListedEventDto,
  ) {
    return this.events.updateListed(admin.id, id, body);
  }

  @Post(':id/publish')
  @ZodResponse({ status: 200, type: EventDetailDto })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.publishListed(id);
  }

  @Post(':id/cancel')
  @ZodResponse({ status: 200, type: EventDetailDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.cancelListed(id);
  }
}

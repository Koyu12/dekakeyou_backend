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
import { Roles } from '../common/auth/auth.decorators';
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
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: [EventDetailDto] })
  list() {
    return this.events.listListedForAdmin();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: EventDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.events.getListedForAdmin(id);
  }

  @Post()
  @ZodResponse({ status: 201, type: EventDetailDto })
  create(@Body() body: CreateListedEventDto) {
    return this.events.createListed(body);
  }

  @Patch(':id')
  @ZodResponse({ status: 200, type: EventDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateListedEventDto,
  ) {
    return this.events.updateListed(id, body);
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

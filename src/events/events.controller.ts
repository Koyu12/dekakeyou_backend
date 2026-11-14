import { PUBLIC_CACHE } from '../common/http/cache';
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/auth/auth.decorators';
import {
  BrowseEventsQuery,
  EventDetailDto,
  EventPageDto,
} from './events.schemas';
import { EventsService } from './events.service';

@ApiTags('events')
@Public()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @ZodResponse({ status: 200, type: EventPageDto })
  browse(@Query() query: BrowseEventsQuery) {
    return this.events.browse(query);
  }

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ZodResponse({ status: 200, type: EventDetailDto })
  findBySlug(@Param('slug') slug: string) {
    return this.events.findPublicBySlug(slug);
  }
}

import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/auth/auth.decorators';
import { EventDetailDto } from './events.schemas';
import { EventsService } from './events.service';

@ApiTags('events')
@Public()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60')
  @ZodResponse({ status: 200, type: EventDetailDto })
  findBySlug(@Param('slug') slug: string) {
    return this.events.findPublicBySlug(slug);
  }
}

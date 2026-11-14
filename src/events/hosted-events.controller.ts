import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { SessionUser } from '../auth/auth';
import { CurrentUser } from '../common/auth/auth.decorators';
import {
  CreateHostedEventDto,
  OrganizerEventDto,
  UpdateHostedEventDto,
} from './events.schemas';
import { HostedEventsService } from './hosted-events.service';

// Logged-in users managing their own Hosted Events. Responses include the online link: never cache.
@ApiTags('hosted events')
@Controller()
export class HostedEventsController {
  constructor(private readonly hosted: HostedEventsService) {}

  @Post('events')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 201, type: OrganizerEventDto })
  create(@CurrentUser() user: SessionUser, @Body() body: CreateHostedEventDto) {
    return this.hosted.create(user, body);
  }

  @Patch('events/:id')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: OrganizerEventDto })
  update(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateHostedEventDto,
  ) {
    return this.hosted.update(user, id, body);
  }

  /** Calls the Event off: it stays visible as Cancelled and its Reservations become Void. */
  @Post('events/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: OrganizerEventDto })
  cancel(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hosted.cancel(user, id);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hosted.delete(user, id);
  }

  @Get('me/events')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: [OrganizerEventDto] })
  listMine(@CurrentUser() user: SessionUser) {
    return this.hosted.listOwn(user);
  }

  @Get('me/events/:id')
  @Header('Cache-Control', 'no-store')
  @ZodResponse({ status: 200, type: OrganizerEventDto })
  getMine(
    @CurrentUser() user: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hosted.getOwn(user, id);
  }
}

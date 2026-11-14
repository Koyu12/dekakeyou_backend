import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { SessionUser } from '../auth/auth';
import { CurrentUser } from '../common/auth/auth.decorators';
import { NO_STORE } from '../common/http/cache';
import {
  RequestUploadDto,
  UploadDto,
  UploadTicketDto,
} from './uploads.schemas';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Step 1: get a signed URL. Then PUT the file to it with the returned headers. */
  @Post()
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 201, type: UploadTicketDto })
  request(@CurrentUser() user: SessionUser, @Body() body: RequestUploadDto) {
    return this.uploads.request(user.id, body);
  }

  /** Step 2: after uploading, run the image check. Approved uploads can be a coverUploadId. */
  @Post(':id/verify')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: UploadDto })
  verify(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.uploads.verify(user.id, id);
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: UploadDto })
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.uploads.get(user.id, id);
  }
}

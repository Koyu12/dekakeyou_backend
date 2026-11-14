import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { SessionUser } from '../auth/auth';
import { CurrentUser, Roles } from '../common/auth/auth.decorators';
import { NO_STORE } from '../common/http/cache';
import { AdminUsersService } from './admin-users.service';
import {
  AccountDto,
  BanResultDto,
  BanUserDto,
  FindAccountQuery,
} from './moderation.schemas';

@ApiTags('admin: users')
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** Look up an account by email (to find whom to ban). */
  @Get()
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: AccountDto })
  find(@Query() { email }: FindAccountQuery) {
    return this.users.findByEmail(email);
  }

  /** Ban (temporary with expiresAt, or permanent): logs them out, removes their live Events, frees their places. */
  @Post(':userId/ban')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: BanResultDto })
  ban(
    @CurrentUser() admin: SessionUser,
    @Param('userId') userId: string,
    @Body() body: BanUserDto,
  ) {
    return this.users.ban(admin.id, userId, body);
  }

  @Post(':userId/unban')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: AccountDto })
  unban(@Param('userId') userId: string) {
    return this.users.unban(userId);
  }
}

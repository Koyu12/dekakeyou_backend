import { NO_STORE } from '../common/http/cache';
import { Controller, Delete, Get, Header, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser } from '../common/auth/auth.decorators';
import { AccountDeletionService } from './account-deletion.service';
import type { SessionUser } from './auth';

const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string(),
});
class MeDto extends createZodDto(MeSchema) {}

@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @ZodResponse({ status: 200, type: MeDto })
  me(@CurrentUser() user: SessionUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      role: user.role ?? 'user',
    };
  }

  /**
   * Deletes the account: personal data wiped, logged out everywhere, upcoming Hosted Events
   * Cancelled, places on upcoming Events freed. Signing up again makes a fresh account.
   */
  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', NO_STORE)
  async delete(@CurrentUser() user: SessionUser): Promise<void> {
    await this.deletion.delete(user.id);
  }
}

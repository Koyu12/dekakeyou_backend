import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser } from '../common/auth/auth.decorators';
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
  @Get()
  @Header('Cache-Control', 'no-store')
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
}

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { CatalogModule } from './catalog/catalog.module';
import { AppExceptionFilter } from './common/errors/app-exception.filter';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, CatalogModule],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}

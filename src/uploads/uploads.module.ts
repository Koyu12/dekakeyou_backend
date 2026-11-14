import { Module } from '@nestjs/common';
import { ObjectStorage, storageFromEnv } from './object-storage';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

// events → uploads (ADR-0003): events attach Cover Images; uploads never calls events.
@Module({
  controllers: [UploadsController],
  providers: [
    { provide: ObjectStorage, useFactory: () => storageFromEnv(process.env) },
    UploadsService,
  ],
  exports: [UploadsService],
})
export class UploadsModule {}

import { Global, Module } from '@nestjs/common';
import { ContentCheckService } from './content-check.service';
import {
  ImageModerator,
  NoImageModerator,
  NoTextModerator,
  OpenAiImageModerator,
  OpenAiTextModerator,
  TextModerator,
} from './text-moderator';

// Leaf module like notifications: events call it, it calls nobody (keeps ADR-0003's graph acyclic).
@Global()
@Module({
  providers: [
    {
      provide: TextModerator,
      useFactory: () =>
        process.env.OPENAI_API_KEY
          ? new OpenAiTextModerator(process.env.OPENAI_API_KEY)
          : new NoTextModerator(),
    },
    {
      provide: ImageModerator,
      useFactory: () =>
        process.env.OPENAI_API_KEY
          ? new OpenAiImageModerator(process.env.OPENAI_API_KEY)
          : new NoImageModerator(),
    },
    ContentCheckService,
  ],
  exports: [ContentCheckService],
})
export class ContentCheckModule {}

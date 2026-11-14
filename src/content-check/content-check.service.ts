import { Injectable } from '@nestjs/common';
import { BANNED_WORDS } from './banned-words';
import { findBannedWord, type Verdict } from './content-check.rules';
import { ImageModerator, TextModerator } from './text-moderator';

export type CheckableText = {
  title: string;
  description: string;
  tags: string[];
};

/** Layer 2 of moderation: every Event create and edit passes through here before it is saved. */
@Injectable()
export class ContentCheckService {
  constructor(
    private readonly moderator: TextModerator,
    private readonly imageModerator: ImageModerator,
  ) {}

  /** A Cover Image, checked once when it's uploaded (before it can be attached). */
  checkImage(image: { bytes: Buffer; contentType: string }): Promise<Verdict> {
    return this.imageModerator.check(image);
  }

  /**
   * Banned words always run; the AI check runs unless `ai` is false (the Admin's Listed Events).
   */
  async checkText(
    content: CheckableText,
    options: { ai: boolean },
  ): Promise<Verdict> {
    const text = [content.title, content.description, ...content.tags].join(
      '\n',
    );
    const banned = findBannedWord(text, BANNED_WORDS);
    if (banned) {
      return { result: 'FAIL', reason: `Contains a banned word ("${banned}")` };
    }
    return options.ai ? this.moderator.check(text) : { result: 'PASS' };
  }
}

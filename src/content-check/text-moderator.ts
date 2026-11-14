import { Injectable, Logger } from '@nestjs/common';
import { type Verdict, verdictFromScores } from './content-check.rules';

/** An AI text-moderation provider. Tests override it with a fake. */
export abstract class TextModerator {
  abstract check(text: string): Promise<Verdict>;
}

/** Used when no provider is configured: the banned-word list is the only check. */
@Injectable()
export class NoTextModerator extends TextModerator {
  check(): Promise<Verdict> {
    return Promise.resolve({ result: 'PASS' });
  }
}

type ModerationResponse = {
  results?: { category_scores?: Record<string, number> }[];
};

/** OpenAI's moderation endpoint (omni-moderation). Enabled by OPENAI_API_KEY. */
@Injectable()
export class OpenAiTextModerator extends TextModerator {
  private readonly logger = new Logger(OpenAiTextModerator.name);

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
  }

  async check(text: string): Promise<Verdict> {
    try {
      const res = await this.fetchFn('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`moderation API returned ${res.status}`);
      const body = (await res.json()) as ModerationResponse;
      const scores = body.results?.[0]?.category_scores;
      if (!scores) throw new Error('moderation API returned no scores');
      return verdictFromScores(scores);
    } catch (err) {
      // Fail safe, not open: if the check can't run, a human looks at it.
      this.logger.warn(
        `Text moderation unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        result: 'BORDERLINE',
        reason: 'Automatic check unavailable; held for review',
      };
    }
  }
}

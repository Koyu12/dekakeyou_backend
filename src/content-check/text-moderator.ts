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
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
  }

  check(text: string): Promise<Verdict> {
    return openAiModeration(this.apiKey, this.fetchFn, text);
  }
}

/** An image-safety provider, checked when a Cover Image is uploaded. Tests override it. */
export abstract class ImageModerator {
  abstract check(image: {
    bytes: Buffer;
    contentType: string;
  }): Promise<Verdict>;
}

/** No provider configured: images aren't checked automatically (Reports still apply). */
@Injectable()
export class NoImageModerator extends ImageModerator {
  check(): Promise<Verdict> {
    return Promise.resolve({ result: 'PASS' });
  }
}

/** The same omni-moderation model, which also scores images. */
@Injectable()
export class OpenAiImageModerator extends ImageModerator {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
  }

  check({ bytes, contentType }: { bytes: Buffer; contentType: string }) {
    const url = `data:${contentType};base64,${bytes.toString('base64')}`;
    return openAiModeration(this.apiKey, this.fetchFn, [
      { type: 'image_url', image_url: { url } },
    ]);
  }
}

const logger = new Logger('ContentCheck');

async function openAiModeration(
  apiKey: string,
  fetchFn: typeof fetch,
  input: unknown,
): Promise<Verdict> {
  try {
    const res = await fetchFn('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`moderation API returned ${res.status}`);
    const body = (await res.json()) as ModerationResponse;
    const scores = body.results?.[0]?.category_scores;
    if (!scores) throw new Error('moderation API returned no scores');
    return verdictFromScores(scores);
  } catch (err) {
    // Fail safe, not open: if the check can't run, a human looks at it.
    logger.warn(
      `Moderation unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      result: 'BORDERLINE',
      reason: 'Automatic check unavailable; held for review',
    };
  }
}

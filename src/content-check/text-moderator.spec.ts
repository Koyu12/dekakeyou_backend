import { OpenAiTextModerator } from './text-moderator';

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('OpenAiTextModerator', () => {
  it('sends the text with the API key and maps scores to a Verdict', async () => {
    const fetchFn = jest.fn(() =>
      reply(200, {
        results: [{ category_scores: { sexual: 0.9, hate: 0.01 } }],
      }),
    );
    const moderator = new OpenAiTextModerator(
      'sk-test',
      fetchFn as typeof fetch,
    );

    await expect(moderator.check('some text')).resolves.toEqual({
      result: 'FAIL',
      reason: 'Content flagged as sexual',
    });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.openai.com/v1/moderations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'omni-moderation-latest',
      input: 'some text',
    });
  });

  it.each([
    ['an error status', () => reply(500, {})],
    ['a body without scores', () => reply(200, { results: [] })],
    ['a network failure', () => Promise.reject(new Error('ECONNRESET'))],
  ])('holds content for review on %s (fails safe)', async (_name, impl) => {
    const moderator = new OpenAiTextModerator('sk-test', jest.fn(impl));
    await expect(moderator.check('x')).resolves.toMatchObject({
      result: 'BORDERLINE',
    });
  });
});

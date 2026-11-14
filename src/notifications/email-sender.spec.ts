import {
  ConsoleEmailSender,
  emailSenderFromEnv,
  SmtpEmailSender,
} from './email-sender';

describe('emailSenderFromEnv', () => {
  const full = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'apikey',
    SMTP_PASSWORD: 'secret',
    SMTP_FROM: 'Dekakeyou <no-reply@example.com>',
  };

  it('no SMTP settings → console', () => {
    expect(emailSenderFromEnv({})).toBeInstanceOf(ConsoleEmailSender);
    expect(emailSenderFromEnv({ SMTP_HOST: '  ' })).toBeInstanceOf(
      ConsoleEmailSender,
    );
  });

  it('full settings → SMTP; user/password are optional together', () => {
    expect(emailSenderFromEnv(full)).toBeInstanceOf(SmtpEmailSender);
    expect(
      emailSenderFromEnv({ ...full, SMTP_USER: '', SMTP_PASSWORD: '' }),
    ).toBeInstanceOf(SmtpEmailSender);
  });

  it.each([
    [{ SMTP_HOST: 'smtp.example.com' }, /SMTP_PORT, SMTP_FROM/],
    [{ ...full, SMTP_FROM: '' }, /also set SMTP_FROM/],
    [{ ...full, SMTP_PASSWORD: '' }, /also set SMTP_PASSWORD/],
    [{ ...full, SMTP_PORT: 'abc' }, /SMTP_PORT must be a port number/],
    [{ ...full, SMTP_SECURE: 'yes' }, /SMTP_SECURE must be true or false/],
  ])('partial or invalid config fails clearly: %o', (env, message) => {
    expect(() => emailSenderFromEnv(env)).toThrow(message);
  });

  it('never puts the password in the error', () => {
    expect(() =>
      emailSenderFromEnv({ ...full, SMTP_HOST: '', SMTP_FROM: '' }),
    ).toThrow(/^(?!.*secret)/s);
  });
});

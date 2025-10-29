import { ENV_LABEL } from './env';

function makeSigninText(email: string, origin: string): string {
  const prefix = ENV_LABEL ? `[${ENV_LABEL}] ` : '';
  return `${prefix}Google sign-in: ${email} (${origin})`;
}

export { makeSigninText };

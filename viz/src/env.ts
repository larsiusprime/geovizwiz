const env = (import.meta as any).env ?? {};

function normalizeBase(base: string | undefined | null): string {
  const trimmed = typeof base === 'string' ? base.trim() : '';
  if (!trimmed) return '/api';
  return trimmed.replace(/\/$/, '') || '/api';
}

const API_BASE = normalizeBase(env.VITE_API_BASE);
const SLACK_ENDPOINT = `${API_BASE}/slack`;

const SIGNIN_WEBHOOK_URL = typeof env.VITE_SIGNIN_WEBHOOK_URL === 'string'
  ? env.VITE_SIGNIN_WEBHOOK_URL
  : '';

const HAS_DIRECT_SLACK_WEBHOOK = typeof env.VITE_SLACK_WEBHOOK_URL === 'string'
  ? Boolean(env.VITE_SLACK_WEBHOOK_URL.trim())
  : false;

function deriveEnvLabel(): string {
  const explicit = [env.VITE_ENV_LABEL, env.VITE_DEPLOY_ENV]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value);
  if (explicit) return explicit;
  if (env.PROD) return 'Prod';
  if (env.DEV) return 'Dev';
  if (typeof env.MODE === 'string' && env.MODE.trim()) return env.MODE.trim();
  return 'Local';
}

const ENV_LABEL = deriveEnvLabel();

export { API_BASE, SLACK_ENDPOINT, SIGNIN_WEBHOOK_URL, ENV_LABEL, HAS_DIRECT_SLACK_WEBHOOK };

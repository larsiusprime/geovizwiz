import { SIGNIN_WEBHOOK_URL, SLACK_ENDPOINT, HAS_DIRECT_SLACK_WEBHOOK } from './env';
import { makeSigninText } from './slack-signin';

type CredentialResponse = {
  credential?: string;
};

declare global {
  interface Window {
    google?: any;
  }
}

const CLIENT_ID =
  document.querySelector<HTMLMetaElement>('meta[name="google-signin-client_id"]')?.content || '';

function whenReady(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      if (predicate()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('GSI not loaded'));
      setTimeout(tick, 50);
    })();
  });
}

function decodeJwt(token: string | undefined | null): unknown {
  try {
    if (!token) return null;
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function recordSignin(cred: CredentialResponse | null | undefined): void {
  try {
    const now = new Date().toISOString();
    const payload = decodeJwt(cred?.credential ?? '') as { email?: string } | null;
    const entry = { at: now, payload };

    try { sessionStorage.setItem('gvw_session_authed', '1'); } catch {}

    try {
      const email = payload?.email ?? null;
      if (email) {
        const pending = { at: now, email };
        try {
          sessionStorage.setItem('gvw_pending_slack', JSON.stringify(pending));
          sessionStorage.setItem('gvw_session_email', email);
          sessionStorage.removeItem('gvw_session_slack_sent');
        } catch {}
        localStorage.setItem('gvw_signin_debug', JSON.stringify({
          savedAt: now,
          emailFound: true,
          email,
          slackWebhookExists: HAS_DIRECT_SLACK_WEBHOOK
        }));
      } else {
        localStorage.setItem('gvw_signin_debug', JSON.stringify({
          savedAt: now,
          emailFound: false,
          slackWebhookExists: HAS_DIRECT_SLACK_WEBHOOK
        }));
      }
    } catch {}

    if (SIGNIN_WEBHOOK_URL) {
      fetch(SIGNIN_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }).catch(() => {});
    }

    const email = (payload as { email?: string } | null)?.email;
    if (email) {
      const text = makeSigninText(email, 'login');
      fetch(SLACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      }).catch(() => {});
    }
  } catch {}
}

async function init(): Promise<void> {
  const mount = document.getElementById('googleSignIn');
  if (!mount) return;
  mount.textContent = 'Loading sign-in…';

  console.log('Google login client:', CLIENT_ID);

  try { localStorage.removeItem('gvw_signins'); } catch {}

  await whenReady(() => Boolean(window.google?.accounts?.id));
  const g = window.google;

  if (!CLIENT_ID) {
    throw new Error('Missing Google client ID');
  }

  g.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (resp: CredentialResponse) => {
      recordSignin(resp);
      window.location.href = '/';
    }
  });

  try { g.accounts.id.disableAutoSelect(); } catch {}

  mount.textContent = '';
  g.accounts.id.renderButton(mount, { theme: 'outline', size: 'large' });
}

init().catch((err) => {
  console.error(err);
  const mount = document.getElementById('googleSignIn');
  if (mount) {
    mount.innerHTML = `<div style="font:14px system-ui">Couldn’t load sign-in: ${String(err)}</div>`;
  }
});

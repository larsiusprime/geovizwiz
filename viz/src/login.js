
const env = import.meta.env || {};
const CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID ||
  document.querySelector('meta[name="google-signin-client_id"]')?.content || '';
const SIGNIN_WEBHOOK = env.VITE_SIGNIN_WEBHOOK_URL;


function whenReady(predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      if (predicate()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('GSI not loaded'));
      setTimeout(tick, 50);
    })();
  });
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function recordSignin(cred) {
  try {
    const now = new Date().toISOString();
    const existing = JSON.parse(localStorage.getItem('gvw_signins') || '[]');
    const entry = { at: now, credential: cred?.credential ?? null, payload: decodeJwt(cred?.credential || '') };
    existing.push(entry);
    localStorage.setItem('gvw_signins', JSON.stringify(existing));
    if (SIGNIN_WEBHOOK) {
      fetch(SIGNIN_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
    }
    if (entry.payload?.email) {
      fetch('/api/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Google sign-in: ${entry.payload.email}` })
      }).catch(() => {});
    }
  } catch {}
}

async function init() {
  const mount = document.getElementById('googleSignIn');
  mount.textContent = 'Loading sign-in…';

  console.log('Google VITE login client:', CLIENT_ID);

  await whenReady(() => window.google?.accounts?.id);
  const g = window.google;

  if (!CLIENT_ID) {
    throw new Error('Missing Google client ID');
  }

  g.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (resp) => {
      recordSignin(resp);
      window.location.href = '/';
    }
  });

  mount.textContent = '';
  g.accounts.id.renderButton(mount, { theme: 'outline', size: 'large' });
}

init().catch(err => {
  console.error(err);
  const m = document.getElementById('googleSignIn');
  m.innerHTML = `<div style="font:14px system-ui">Couldn’t load sign-in: ${String(err)}</div>`;
});

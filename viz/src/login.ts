const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SIGNIN_WEBHOOK = import.meta.env.VITE_SIGNIN_WEBHOOK_URL as string | undefined;

function whenReady(predicate: () => any, timeoutMs = 8000) {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      if (predicate()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('GSI not loaded'));
      setTimeout(tick, 50);
    })();
  });
}

function decodeJwt(token: string): any {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function recordSignin(cred: any) {
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
  const mount = document.getElementById('googleSignIn')!;
  mount.textContent = 'Loading sign-in…';

  await whenReady(() => (window as any).google?.accounts?.id);
  const g = (window as any).google;

  g.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (resp: any) => {
      recordSignin(resp);
      window.location.href = '/';
    }
  });

  mount.textContent = '';
  g.accounts.id.renderButton(mount, { theme: 'outline', size: 'large' });
}

init().catch(err => {
  console.error(err);
  const m = document.getElementById('googleSignIn')!;
  m.innerHTML = `<div style="font:14px system-ui">Couldn’t load sign-in: ${String(err)}</div>`;
});

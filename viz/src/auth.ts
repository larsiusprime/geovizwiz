// Google authentication helper
// toggle via VITE_ENABLE_GOOGLE_AUTH env var

const ENABLE_GOOGLE_AUTH = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

// declare global google obj
declare const google: any;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('failed to load script'));
    document.head.appendChild(el);
  });
}

export async function initGoogleAuth(onSignIn?: (cred: any) => void) {
  if (!ENABLE_GOOGLE_AUTH) return; // skip in dev
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.warn('Google auth enabled but VITE_GOOGLE_CLIENT_ID is missing');
    return;
  }
  await loadScript('https://accounts.google.com/gsi/client');
  const webhook = import.meta.env.VITE_SIGNIN_WEBHOOK_URL as string | undefined;
  const slackWebhook = import.meta.env.VITE_SLACK_WEBHOOK_URL as string | undefined;
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
      if (webhook) {
        fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
      }
      if (slackWebhook && entry.payload?.email) {
        fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `Google sign-in: ${entry.payload.email}` })
        }).catch(() => {});
      }
    } catch {}
  }
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (resp: any) => {
      recordSignin(resp);
      onSignIn?.(resp);
      console.log('Google credential', resp);
    }
  });
  const btn = document.getElementById('googleSignIn');
  if (btn) {
    google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large' });
  }
}

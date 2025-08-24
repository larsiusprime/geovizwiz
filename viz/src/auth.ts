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

export async function initGoogleAuth() {
  if (!ENABLE_GOOGLE_AUTH) return; // skip in dev
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.warn('Google auth enabled but VITE_GOOGLE_CLIENT_ID is missing');
    return;
  }
  await loadScript('https://accounts.google.com/gsi/client');
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (resp: any) => {
      console.log('Google credential', resp);
    }
  });
  const btn = document.getElementById('googleSignIn');
  if (btn) {
    google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large' });
  }
}

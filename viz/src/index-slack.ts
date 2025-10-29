import { SLACK_ENDPOINT } from './env';
import { makeSigninText } from './slack-signin';

(function ensureSlackFromIndex() {
  try {
    const authed = sessionStorage.getItem('gvw_session_authed') === '1';
    const email = sessionStorage.getItem('gvw_session_email');
    const sent = sessionStorage.getItem('gvw_session_slack_sent') === '1';
    if (!authed || !email || sent) return;

    let attempt = 0;
    const maxAttempts = 4;
    const text = makeSigninText(email, 'index');

    const trySend = () => {
      if (attempt >= maxAttempts) return;
      attempt++;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 6000);
      fetch(SLACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ctrl.signal
      })
        .then((response) => {
          clearTimeout(timeout);
          if (response.ok) {
            sessionStorage.setItem('gvw_session_slack_sent', '1');
          } else if (attempt < maxAttempts) {
            scheduleRetry();
          }
        })
        .catch(() => {
          clearTimeout(timeout);
          if (attempt < maxAttempts) {
            scheduleRetry();
          }
        });
    };

    const scheduleRetry = () => {
      const delay = Math.min(10000, 400 * Math.pow(2, attempt - 1));
      setTimeout(() => {
        if (attempt < maxAttempts && sessionStorage.getItem('gvw_session_slack_sent') !== '1') {
          trySend();
        }
      }, delay);
    };

    window.addEventListener(
      'online',
      () => {
        if (attempt > 0 && attempt < maxAttempts && sessionStorage.getItem('gvw_session_slack_sent') !== '1') {
          trySend();
        }
      },
      { passive: true }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible' && attempt > 0 && attempt < maxAttempts && sessionStorage.getItem('gvw_session_slack_sent') !== '1') {
          trySend();
        }
      },
      { passive: true } as any
    );

    window.addEventListener(
      'pagehide',
      () => {
        if (sessionStorage.getItem('gvw_session_slack_sent') === '1') return;
        if (typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([JSON.stringify({ text })], { type: 'application/json' });
          navigator.sendBeacon(SLACK_ENDPOINT, blob);
        }
      },
      { once: true }
    );

    trySend();
  } catch {
    // no-op
  }
})();

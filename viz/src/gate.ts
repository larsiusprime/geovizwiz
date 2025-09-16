// Require Google Auth per session: check a sessionStorage flag only.
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

try {
  const hasSession = !!sessionStorage.getItem('gvw_session_authed');
  if (enableGoogleAuth && !hasSession) {
    window.location.href = 'login.html';
  }
} catch {
  // If storage is unavailable (e.g., privacy mode), allow the app to load.
}

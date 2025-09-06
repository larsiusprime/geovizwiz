// Redirect to login only if Google auth is enabled and there is no prior sign-in record
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

try {
  const hasSignin = !!localStorage.getItem('gvw_signins');
  if (enableGoogleAuth && !hasSignin) {
    window.location.href = 'login.html';
  }
} catch {
  // If localStorage is unavailable (e.g., privacy mode), still try to load the app
} 
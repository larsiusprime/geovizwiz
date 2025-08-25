import { initGoogleAuth } from './auth';

initGoogleAuth(() => {
  window.location.href = 'index.html';
});

import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const slackWebhook = env.VITE_SLACK_WEBHOOK_URL;
  return {
    // Serve from domain root in production deployments (Azure SWA)
    // If you later host under a subpath, set base accordingly
    base: '/',
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'login.html')
        }
      }
    },
    server: slackWebhook
      ? {
          proxy: {
            '/api/slack': {
              target: slackWebhook,
              changeOrigin: true,
              secure: true,
              rewrite: () => ''
            }
          }
        }
      : undefined
  };
});

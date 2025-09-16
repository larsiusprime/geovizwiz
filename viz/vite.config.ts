import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const slackWebhook = env.VITE_SLACK_WEBHOOK_URL;
  return {
    // Serve from domain root in production deployments (Azure SWA)
    // If you later host under a subpath, set base accordingly
    base: '/',
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          app: resolve(__dirname, 'app.html'),
          login: resolve(__dirname, 'login.html')
        }
      }
    },
    // Dev server proxies
    server: {
      proxy: {
        // Optional: post dev logs to Slack via local endpoint
        ...(slackWebhook
          ? {
              '/api/slack': {
                target: slackWebhook,
                changeOrigin: true,
                secure: true,
                rewrite: () => ''
              }
            }
          : {}),

        // Proxy remote GeoParquet to avoid browser CORS (dev only)
        '/data': {
          target: 'https://landeconomics.blob.core.windows.net/public-sharing-cle',
          changeOrigin: true,
          secure: true,
          rewrite: (p: string) => p.replace(/^\/data/, '')
        }
      }
    }
  };
});

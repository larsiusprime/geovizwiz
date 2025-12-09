import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(() => {
  return {
    // Serve from domain root in production deployments (Azure SWA)
    // If you later host under a subpath, set base accordingly
    base: '/',
    // Point env loading at a sandbox-safe folder to avoid .env permission issues
    envDir: resolve(__dirname, 'env'),
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
        // Proxy API requests to local API server on port 8080
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false
        },

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

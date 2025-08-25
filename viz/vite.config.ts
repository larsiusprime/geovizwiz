import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/viz/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html')
      }
    }
  }
});
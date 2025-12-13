import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = '/earth/cesium';

export default defineConfig({
  base: '',
  define: {
    CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl)
  },
  resolve: {
    alias: {
      cesium: resolve(__dirname, 'node_modules/cesium')
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumSource}/*`,
          dest: 'cesium'
        }
      ]
    })
  ],
  server: {
    fs: {
      allow: ['..']
    }
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});

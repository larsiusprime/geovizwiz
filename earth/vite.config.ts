import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
// Serve Cesium static assets from the root-level copied folder so dev and build
// both resolve correctly. Using an absolute "/cesium" avoids index.html being
// returned (and parsed as JSON) when Cesium requests its asset JSON files.
const cesiumBaseUrl = '/cesium';

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

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VIZ_BUILD_MODE?: 'browser' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VIZ_BUILD_MODE?: 'browser' | 'desktop' | 'hosted';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

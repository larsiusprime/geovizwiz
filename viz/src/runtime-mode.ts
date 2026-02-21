export type RuntimeMode = 'browser' | 'desktop' | 'hosted';

const FALLBACK_MODE: RuntimeMode = 'browser';
const ALLOWED_MODES = new Set<RuntimeMode>(['browser', 'desktop', 'hosted']);

function readBuildMode(): string | undefined {
  return (import.meta.env.VITE_VIZ_BUILD_MODE as string | undefined)?.trim().toLowerCase();
}

export function getRuntimeMode(): RuntimeMode {
  const mode = readBuildMode();
  if (!mode) return FALLBACK_MODE;
  if (ALLOWED_MODES.has(mode as RuntimeMode)) return mode as RuntimeMode;
  console.warn(`[runtime-mode] Invalid VITE_VIZ_BUILD_MODE="${mode}". Falling back to "${FALLBACK_MODE}".`);
  return FALLBACK_MODE;
}

export function isBrowserMode(): boolean {
  return getRuntimeMode() === 'browser';
}

export function isDesktopMode(): boolean {
  return getRuntimeMode() === 'desktop';
}

export function isHostedMode(): boolean {
  return getRuntimeMode() === 'hosted';
}

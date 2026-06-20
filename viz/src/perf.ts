/**
 * Lightweight performance instrumentation — DESKTOP ONLY.
 *
 * All logging is gated behind `perfEnabled()`, which requires desktop runtime
 * mode, so the browser build is entirely unaffected (calls become no-ops). In
 * desktop mode it's ON by default during the profiling phase; disable at runtime
 * with `localStorage.VIZ_PERF = '0'` (and re-enable with '1').
 *
 * Usage:
 *   const t = perfNow(); ...work...; perfLog('label', perfNow() - t, { rows });
 *   await perfSpan('label', () => doAsyncWork(), { extra });
 *   perfTime('label', () => doSyncWork());
 */

import { isDesktopMode } from './runtime-mode.js';

export function perfNow(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export function perfEnabled(): boolean {
  if (!isDesktopMode()) return false;
  try {
    // Opt-in: enable with `localStorage.VIZ_PERF = '1'` in the renderer console.
    return localStorage.getItem('VIZ_PERF') === '1';
  } catch {
    return false;
  }
}

/** Emit a perf line to the devtools console AND the main-process terminal. */
function emit(line: string): void {
  // eslint-disable-next-line no-console
  console.debug(line);
  try {
    window.vizDesktop?.perf?.(line);
  } catch {
    /* no bridge (browser) — console.debug already covered it */
  }
}

export function perfLog(label: string, ms: number, extra?: Record<string, unknown>): void {
  if (!perfEnabled()) return;
  const detail = extra ? ' ' + JSON.stringify(extra) : '';
  emit(`[perf] ${label}: ${ms.toFixed(1)}ms${detail}`);
}

/** Free-form line (e.g. an EXPLAIN plan), only when perf is enabled. */
export function perfNote(label: string, value: unknown): void {
  if (!perfEnabled()) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  emit(`[perf] ${label}: ${text}`);
}

/** Time an async span; returns the wrapped result. */
export async function perfSpan<T>(
  label: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>
): Promise<T> {
  if (!perfEnabled()) return fn();
  const t0 = perfNow();
  try {
    return await fn();
  } finally {
    perfLog(label, perfNow() - t0, extra);
  }
}

/** Time a synchronous span; returns the wrapped result. */
export function perfTime<T>(label: string, fn: () => T, extra?: Record<string, unknown>): T {
  if (!perfEnabled()) return fn();
  const t0 = perfNow();
  try {
    return fn();
  } finally {
    perfLog(label, perfNow() - t0, extra);
  }
}

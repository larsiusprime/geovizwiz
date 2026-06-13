#!/usr/bin/env node
/**
 * Type-check regression gate.
 *
 * `vite build` uses esbuild and does NOT type-check. This gate runs
 * `tsc --noEmit` and fails if the error count EXCEEDS the baseline. The
 * historical pre-existing backlog (see REFACTOR.md "G2") has been fully burned
 * down, so BASELINE is now 0: any type error is a regression and fails CI.
 *
 * If a genuinely-intentional error is ever introduced, raise BASELINE to match
 * — but the intent is to keep this at 0.
 */
const { execSync } = require('child_process');

const BASELINE = 0;

let output = '';
try {
  output = execSync('npx tsc --noEmit', { encoding: 'utf8' });
} catch (err) {
  // tsc exits non-zero when there are errors; its diagnostics go to stdout.
  output = `${err.stdout || ''}${err.stderr || ''}`;
}

const count = (output.match(/error TS\d+/g) || []).length;
console.log(`tsc errors: ${count} (baseline ${BASELINE})`);

if (count > BASELINE) {
  console.error(
    `❌ Type errors increased to ${count} (baseline ${BASELINE}).\n` +
    `Fix the new type error(s), or — if intentional — update BASELINE in scripts/typecheck-gate.cjs.`
  );
  process.exit(1);
}

console.log('✓ within type-error baseline');

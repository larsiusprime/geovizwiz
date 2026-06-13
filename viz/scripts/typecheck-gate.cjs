#!/usr/bin/env node
/**
 * Type-check regression gate.
 *
 * `vite build` uses esbuild and does NOT type-check, and the repo carries a
 * known pre-existing `tsc` error baseline. This gate runs `tsc --noEmit` and
 * fails only if the error count EXCEEDS the baseline — so it blocks newly
 * introduced type errors without requiring the whole backlog to be fixed first.
 *
 * As errors are burned down (see REFACTOR.md "G2"), lower BASELINE to match so
 * the gate ratchets downward and can't regress.
 */
const { execSync } = require('child_process');

const BASELINE = 39;

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

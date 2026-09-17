'use strict';
/*
 * The pricing rules must be identical in the main process (which writes the
 * deck) and in the browser preview (which shows the total before it is
 * written). Two hand-maintained copies would drift, and the first sign of it
 * would be a client seeing one number on screen and another in the file.
 *
 * So there is one source — electron/lib/pricing.js — and this generates the
 * ES module wrapper from it. `--check` fails if the generated file is stale,
 * which is what runs in the build.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'electron', 'lib', 'pricing.js');
const TARGET = path.join(__dirname, '..', 'src', 'lib', 'pricing-shared.js');
const EXPORTS = 'export { calculate, validate, money, toCents, fromCents, DEFAULTS };';

function generate() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const body = src
    .replace(/^'use strict';\n/, '')
    .replace(/^module\.exports\s*=\s*\{[^}]*\};?\s*$/m, '');
  return [
    '/* GENERATED from electron/lib/pricing.js by scripts/build-shared.js.',
    '   Do not edit — edit the source and run `npm run build:shared`. */',
    body.trim(),
    '',
    EXPORTS,
    '',
  ].join('\n');
}

const generated = generate();

if (process.argv.includes('--check')) {
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (current !== generated) {
    console.error([
      '',
      '  src/lib/pricing-shared.js is out of date with electron/lib/pricing.js.',
      '  The preview would show different totals from the exported deck.',
      '',
      '  Run: npm run build:shared',
      '',
    ].join('\n'));
    process.exit(1);
  }
  console.log('  Shared pricing rules are in step with the source.');
} else {
  fs.writeFileSync(TARGET, generated);
  console.log(`  Wrote ${path.relative(path.join(__dirname, '..'), TARGET)}`);
}

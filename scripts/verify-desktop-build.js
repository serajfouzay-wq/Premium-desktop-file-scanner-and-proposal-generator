'use strict';
/*
 * Guards the one mistake that silently ships a dead application.
 *
 * Electron loads dist/index.html over file://. An absolute asset path such as
 * /assets/index.js resolves to the root of the drive rather than the app
 * folder, so no script loads, no error is shown, and the window is simply
 * blank. Nothing crashes, so a build with this defect looks entirely healthy
 * until somebody opens it.
 *
 * Build 1 shipped exactly this. Packaging now fails loudly instead.
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('\n  dist/index.html is missing — run `npm run build` first.\n');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);

if (absolute.length) {
  console.error([
    '',
    '  This build cannot run inside Electron.',
    '',
    `  dist/index.html references ${absolute.length} asset(s) by absolute path:`,
    ...absolute.map((a) => `      ${a}`),
    '',
    '  Over file:// those resolve to the root of the drive, so the window',
    '  opens blank with no error.',
    '',
    '  `npm run build` produces the desktop build. `npm run build:web` is for',
    '  a web host only — its output must never be packaged.',
    '',
  ].join('\n'));
  process.exit(1);
}

const relative = [...html.matchAll(/(?:src|href)="(\.\/[^"]*)"/g)].map((m) => m[1]);
if (!relative.length) {
  console.error('\n  dist/index.html references no assets at all — the build looks broken.\n');
  process.exit(1);
}

console.log(`  Desktop build verified — ${relative.length} asset(s), all relative.`);

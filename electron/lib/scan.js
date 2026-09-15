'use strict';
const fs = require('fs');
const path = require('path');

/* Phase 1 — discovery. Metadata only: no file is opened, so a folder with
   thousands of documents still reports progress within a second. */

const READABLE = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.doc', '.txt', '.md']);
const EXTRACTABLE = new Set(['.pdf', '.docx', '.xlsx', '.txt', '.md']);

const SKIP_DIR = new Set([
  'node_modules', '.git', '.svn', '.cache', '.Trash', '$RECYCLE.BIN',
  'AppData', 'Library', 'System Volume Information', 'Windows', 'Program Files',
  'Program Files (x86)', 'venv', '.venv', '__pycache__', 'dist', 'build',
]);

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_DEPTH = 12;

/**
 * Walk `roots` recursively and return every readable document.
 * `onProgress` is called as directories are entered so the UI can move.
 */
function discover(roots, onProgress = () => {}) {
  const found = [];
  const skipped = { system: 0, unsupported: 0, empty: 0, oversized: 0 };
  let dirs = 0;

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }                                  // unreadable folder, keep going
    dirs++;
    if (dirs % 10 === 0) onProgress({ dirs, found: found.length, current: dir });

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;                // never follow links out of the tree
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) { skipped.system++; continue; }
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.startsWith('~$') || e.name.startsWith('.')) { skipped.system++; continue; }

      const ext = path.extname(e.name).toLowerCase();
      if (!READABLE.has(ext)) { skipped.unsupported++; continue; }

      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.size === 0) { skipped.empty++; continue; }
      if (st.size > MAX_BYTES) { skipped.oversized++; continue; }

      found.push({
        path: full,
        name: e.name,
        ext: ext.slice(1),
        bytes: st.size,
        modified: st.mtime.toISOString(),
        extractable: EXTRACTABLE.has(ext),
      });
    }
  };

  for (const r of roots) {
    try { fs.statSync(r).isDirectory() ? walk(r, 0) : found.push(describeFile(r)); }
    catch { /* gone between picking and scanning */ }
  }
  onProgress({ dirs, found: found.length, current: 'done' });
  return { files: found, skipped, dirs };
}

function describeFile(p) {
  const st = fs.statSync(p);
  const ext = path.extname(p).toLowerCase();
  return {
    path: p, name: path.basename(p), ext: ext.slice(1), bytes: st.size,
    modified: st.mtime.toISOString(), extractable: EXTRACTABLE.has(ext),
  };
}

module.exports = { discover, READABLE, EXTRACTABLE };

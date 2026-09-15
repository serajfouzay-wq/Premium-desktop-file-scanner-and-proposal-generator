'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/* Physically file a document into
     <library root>/<Company Name>/<Document Type>/<Cleaned_Name.ext>

   Two rules make this safe to run on somebody's Desktop:
     - copy by default, so the original is never lost if a guess was wrong;
     - never overwrite — a collision gets a numeric suffix. */

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const ILLEGAL = new RegExp('[<>:"/\\\\|?*' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');

function safeSegment(value, fallback = 'Unfiled') {
  let s = String(value || '').trim()
    .replace(ILLEGAL, ' ')                             // illegal on Windows
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')                             // trailing dots/spaces break Explorer
    .slice(0, 64)
    .trim();
  if (!s || RESERVED.test(s)) s = fallback;
  return s;
}

function cleanFileName(company, typeLabel, date, ext) {
  const parts = [
    safeSegment(company, 'Unfiled').replace(/\s+/g, '_'),
    safeSegment(typeLabel, 'Document').replace(/\s+/g, '_'),
    date || new Date().toISOString().slice(0, 10),
  ];
  return parts.join('_') + '.' + ext;
}

/** Where a document *would* go — used for the preview tree before anything moves. */
function plan(root, doc) {
  const company = safeSegment(doc.company, 'Unfiled');
  const folder = safeSegment(doc.folder, 'Unsorted');
  const name = cleanFileName(doc.company, doc.typeLabel, doc.date, doc.ext);
  return {
    company, folder, name,
    dir: path.join(root, company, folder),
    full: path.join(root, company, folder, name),
    relative: path.join(company, folder, name),
  };
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  for (let i = 2; i < 500; i++) {
    const candidate = path.join(dir, stem + '_' + i + ext);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, stem + '_' + Date.now() + ext);
}

/**
 * @param {string} root   library root folder
 * @param {object} doc    { source, company, folder, typeLabel, date, ext }
 * @param {'copy'|'move'} mode
 */
async function file(root, doc, mode = 'copy') {
  const target = plan(root, doc);
  await fsp.mkdir(target.dir, { recursive: true });

  const resolved = uniquePath(target.full);
  if (path.resolve(resolved) === path.resolve(doc.source)) {
    return { ...target, full: resolved, action: 'already filed' };
  }

  if (mode === 'move') {
    try {
      await fsp.rename(doc.source, resolved);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;             // across drives rename fails; fall back
      await fsp.copyFile(doc.source, resolved);
      await fsp.unlink(doc.source);
    }
  } else {
    await fsp.copyFile(doc.source, resolved);
  }

  return {
    ...target,
    full: resolved,
    name: path.basename(resolved),
    relative: path.relative(root, resolved),
    action: mode === 'move' ? 'moved' : 'copied',
  };
}

const dirs = (p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch { return []; }
};

/** Read the library back off disk, so the tree reflects reality and not our record of it. */
function readTree(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  for (const company of dirs(root)) {
    const categories = [];
    for (const folder of dirs(path.join(root, company))) {
      const files = fs.readdirSync(path.join(root, company, folder), { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => {
          const full = path.join(root, company, folder, e.name);
          const st = fs.statSync(full);
          return { name: e.name, path: full, bytes: st.size, modified: st.mtime.toISOString() };
        });
      if (files.length) categories.push({ folder, files });
    }
    const total = categories.reduce((a, c) => a + c.files.length, 0);
    if (total) out.push({ company, categories, total });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

module.exports = { file, plan, readTree, safeSegment, cleanFileName };

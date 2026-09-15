'use strict';
const fs = require('fs');
const path = require('path');

/* Brand identity + the location of the filing cabinet on disk.
   Plain JSON: small, human-readable, and trivially portable. */

const DEFAULTS = {
  brand: {
    name: '', tagline: '', address: '', phone: '', email: '', website: '',
    logo: null,                 // data URI
    accent: '#1F6E62',
    currency: '$',
    paymentDays: 30,
    defaultTerms: '',
  },
  library: { root: null },      // master database folder
  filing: { mode: 'copy' },     // 'copy' keeps the original where it is; 'move' relocates it
  model: { apiKey: '', model: 'claude-sonnet-5', enabled: false },
};

let file = null;
let cache = null;

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
  }
  return out;
};

function init(userDataDir, defaultRoot) {
  file = path.join(userDataDir, 'settings.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  cache = merge(DEFAULTS, stored);
  if (!cache.library.root) cache.library.root = defaultRoot;
  flush();
  return cache;
}

function flush() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
}

const get = () => cache;

function update(patch) {
  cache = merge(cache, patch || {});
  flush();
  return cache;
}

module.exports = { init, get, update, DEFAULTS };

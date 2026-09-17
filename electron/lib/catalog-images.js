'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/*
 * First-run catalog photography.
 *
 * A fresh install has vendor records but no pictures, and a deck of empty
 * frames looks broken rather than unfinished. These are generated once into
 * the user's data folder, clearly watermarked, and every one of them is a
 * plain PNG on disk — replacing a placeholder with a real photograph is a file
 * swap, not a database migration.
 */

const W = 800;
const H = 450;

const PALETTE = [
  ['#1F6E62', '#0E3D36'], ['#7E5B13', '#4A340A'], ['#2C5A78', '#163243'],
  ['#6B3F5B', '#3A2131'], ['#3C6B2E', '#1F3A17'], ['#9E3B2E', '#5A1F17'],
  ['#4B3E8E', '#271F4D'], ['#8A6A2F', '#4A3818'],
];

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const card = (title, subtitle, kind, i) => {
  const [a, b] = PALETTE[i % PALETTE.length];
  return `<div class="c" style="--a:${a};--b:${b}">
    <div class="tex"></div>
    <div class="body">
      <div class="kind">${esc(kind)}</div>
      <div class="title">${esc(title)}</div>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
    </div>
    <div class="mark">PLACEHOLDER</div>
  </div>`;
};

const SHELL = `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Segoe UI',Inter,system-ui,sans-serif}
  .c{width:${W}px;height:${H}px;position:relative;overflow:hidden;
     background:linear-gradient(135deg,var(--a) 0%,var(--b) 100%);color:#fff}
  .tex{position:absolute;inset:0;opacity:.14;
    background:
      radial-gradient(circle at 78% 22%, rgba(255,255,255,.9) 0 2px, transparent 3px) 0 0/70px 70px,
      repeating-linear-gradient(115deg, rgba(255,255,255,.5) 0 1px, transparent 1px 34px);}
  .body{position:absolute;left:52px;bottom:56px;right:52px}
  .kind{font-size:15px;letter-spacing:.32em;opacity:.72;margin-bottom:14px;font-weight:600}
  .title{font-size:42px;line-height:1.1;font-weight:700;letter-spacing:-.02em;text-shadow:0 2px 24px rgba(0,0,0,.35)}
  .sub{font-size:20px;opacity:.78;margin-top:10px}
  .mark{position:absolute;top:34px;right:44px;font-size:12px;letter-spacing:.3em;opacity:.45;font-weight:600}
</style>
<div id="slot"></div>`;

/** Every catalog record a slide can show a picture of. */
function subjectsFrom(catalog) {
  const out = [];
  for (const h of catalog.listHotels()) {
    out.push({ type: 'hotel', id: h.id, title: h.name, sub: 'Exterior', kind: 'HOTEL' });
    for (const r of h.rooms.slice(0, 2)) {
      out.push({ type: 'hotel', id: h.id, title: h.name, sub: r.tier, kind: 'ROOM' });
    }
  }
  for (const m of catalog.listMcs()) out.push({ type: 'mc', id: m.id, title: m.name, sub: m.headline, kind: 'HOST' });
  for (const a of catalog.listActivities()) out.push({ type: 'activity', id: a.id, title: a.name, sub: a.category, kind: 'ACTIVITY' });
  for (const l of catalog.listLocations()) out.push({ type: 'location', id: l.id, title: l.name, sub: l.region, kind: 'DESTINATION' });
  return out;
}

/**
 * @param {object} catalog  the catalog module
 * @param {string} dir      where to write the images
 * @param {(done, total) => void} onProgress
 */
async function generate(catalog, dir, onProgress = () => {}) {
  const { BrowserWindow } = require('electron');
  fs.mkdirSync(dir, { recursive: true });

  const subjects = subjectsFrom(catalog);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabinet-img-'));
  const page = path.join(tmp, 'card.html');
  fs.writeFileSync(page, SHELL);

  const win = new BrowserWindow({
    show: false, width: W, height: H, useContentSize: true,
    webPreferences: { offscreen: true },
  });

  try {
    await win.loadFile(page);
    catalog.clearImages();
    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      await win.webContents.executeJavaScript(
        `document.getElementById('slot').innerHTML = ${JSON.stringify(card(s.title, s.sub, s.kind, i))}; true`,
      );
      await new Promise((r) => setTimeout(r, 90));
      const img = await win.webContents.capturePage();
      const file = path.join(dir, `${s.type}_${s.id}_${i}.png`);
      fs.writeFileSync(file, img.toPNG());
      catalog.addImage(s.type, s.id, file, s.sub, i);
      onProgress(i + 1, subjects.length);
    }
    return { written: subjects.length, dir };
  } finally {
    win.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { generate, subjectsFrom };

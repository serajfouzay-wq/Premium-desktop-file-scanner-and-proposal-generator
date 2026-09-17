'use strict';
/*
 * Generates the catalog's placeholder photography.
 *
 * The deck injects real image files, so the pipeline can only be trusted if
 * there are real image files to inject. These are generated rather than
 * shipped as binaries: they stay out of the repository, they regenerate on any
 * machine, and replacing one with an actual photograph is a file swap.
 *
 *   npx electron scripts/seed-catalog-images.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('../electron/lib/db');
const catalog = require('../electron/lib/catalog');

const W = 800;
const H = 450;

// Distinct hues per subject so a deck's images are visibly different from
// each other rather than twenty copies of the same grey box.
const PALETTE = [
  ['#1F6E62', '#0E3D36'], ['#7E5B13', '#4A340A'], ['#2C5A78', '#16324333'.slice(0, 7)],
  ['#6B3F5B', '#3A2131'], ['#3C6B2E', '#1F3A17'], ['#9E3B2E', '#5A1F17'],
  ['#4B3E8E', '#271F4D'], ['#8A6A2F', '#4A3818'],
];

const card = (title, subtitle, kind, i) => {
  const [a, b] = PALETTE[i % PALETTE.length];
  return `<div class="c" style="--a:${a};--b:${b}">
    <div class="tex"></div>
    <div class="body">
      <div class="kind">${kind}</div>
      <div class="title">${title}</div>
      ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
    </div>
    <div class="mark">PLACEHOLDER</div>
  </div>`;
};

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const dir = process.env.CATALOG_IMAGE_DIR
    || path.join(app.getPath('userData'), 'catalog-images');
  fs.mkdirSync(dir, { recursive: true });

  db.init(app.getPath('userData'));
  catalog.init();

  // Every subject that a slide can show a picture of.
  const subjects = [];
  for (const h of catalog.listHotels()) {
    subjects.push({ type: 'hotel', id: h.id, title: h.name, sub: 'Exterior', kind: 'HOTEL' });
    for (const r of h.rooms.slice(0, 2)) {
      subjects.push({ type: 'hotel', id: h.id, title: h.name, sub: r.tier, kind: 'ROOM' });
    }
  }
  for (const m of catalog.listMcs()) subjects.push({ type: 'mc', id: m.id, title: m.name, sub: m.headline, kind: 'HOST' });
  for (const a of catalog.listActivities()) subjects.push({ type: 'activity', id: a.id, title: a.name, sub: a.category, kind: 'ACTIVITY' });
  for (const l of catalog.listLocations()) subjects.push({ type: 'location', id: l.id, title: l.name, sub: l.region, kind: 'DESTINATION' });

  /* One small window, re-dressed for each subject. A single grid surface big
     enough for every card at once is slow enough to look hung. */
  const html = `<!doctype html><meta charset="utf-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${W}px;height:${H}px;overflow:hidden;
      font-family:Inter,'Segoe UI',system-ui,sans-serif}
    .c{width:${W}px;height:${H}px;position:relative;overflow:hidden;
       background:linear-gradient(135deg,var(--a) 0%,var(--b) 100%);color:#fff}
    .tex{position:absolute;inset:0;opacity:.14;
      background:
        radial-gradient(circle at 78% 22%, rgba(255,255,255,.9) 0 2px, transparent 3px) 0 0/70px 70px,
        repeating-linear-gradient(115deg, rgba(255,255,255,.5) 0 1px, transparent 1px 34px);}
    .body{position:absolute;left:52px;bottom:56px;right:52px}
    .kind{font-size:15px;letter-spacing:.32em;opacity:.72;margin-bottom:14px;font-weight:600}
    .title{font-size:42px;line-height:1.1;font-weight:700;letter-spacing:-.02em;
           text-shadow:0 2px 24px rgba(0,0,0,.35)}
    .sub{font-size:20px;opacity:.78;margin-top:10px}
    .mark{position:absolute;top:34px;right:44px;font-size:12px;letter-spacing:.3em;opacity:.45;font-weight:600}
  </style>
  <div id="slot"></div>`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-img-'));
  const page = path.join(tmp, 'card.html');
  fs.writeFileSync(page, html);

  const win = new BrowserWindow({
    show: false, width: W, height: H, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(page);

  catalog.clearImages();
  let written = 0;
  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i];
    const markup = card(s.title, s.sub, s.kind, i);
    await win.webContents.executeJavaScript(
      `document.getElementById('slot').innerHTML = ${JSON.stringify(markup)}; true`,
    );
    await new Promise((r) => setTimeout(r, 120));
    const img = await win.webContents.capturePage();
    const file = path.join(dir, `${s.type}_${s.id}_${i}.png`);
    fs.writeFileSync(file, img.toPNG());
    catalog.addImage(s.type, s.id, file, s.sub, i);
    written++;
  }

  win.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Wrote ${written} catalog images to ${dir}`);
  app.exit(0);
});

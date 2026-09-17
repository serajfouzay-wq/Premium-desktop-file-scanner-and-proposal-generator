'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const db = require('./lib/db');
const settings = require('./lib/settings');
const { discover } = require('./lib/scan');
const { extractText } = require('./lib/extract');
const { classify, extractCandidates, detectSenders, reasonFor, FOLDER, TYPE_LABEL } = require('./lib/classify');
const organize = require('./lib/organize');
const { chunkDocument } = require('./lib/chunk');
const ocr = require('./lib/ocr');
const { generate } = require('./lib/generate');
const catalog = require('./lib/catalog');
const catalogImages = require('./lib/catalog-images');
const pricing = require('./lib/pricing');
const deck = require('./lib/deck');
const { renderDocument } = require('./lib/document-template');
const exporters = require('./lib/exporters');

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5273';

let win = null;
let engineInfo = null;
let cancelScan = false;

/* ------------------------------------------------------------------ window */

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#F6F5F1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,                       // the preload needs require()
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Anything that wants a new window opens in the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // A renderer that fails to load leaves an empty window and says nothing,
  // which is indistinguishable from the app being broken. Say what happened.
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    showStartupError(win, `The interface failed to load (${description}).`, url);
  });

  // Same for a build whose assets never arrive: the page loads, but nothing
  // mounts. Checking the root element is the only reliable signal.
  win.webContents.on('did-finish-load', async () => {
    // did-finish-load can beat React's first paint, and a false alarm here
    // would be worse than the bug it guards. Give the tree a moment, then
    // re-check before declaring anything wrong.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      if (win.isDestroyed()) return;
      const mounted = await win.webContents.executeJavaScript(
        "!!document.getElementById('root') && document.getElementById('root').children.length > 0",
      );
      if (!mounted) {
        showStartupError(win, 'The interface loaded but rendered nothing.', win.webContents.getURL());
      }
    } catch { /* the window went away; nothing to report */ }
  });
}

/* A visible, explainable failure beats a blank window every time. */
function showStartupError(target, headline, url) {
  const detail = isDev
    ? 'The development server may not be running. Try `npm run dev`.'
    : 'This usually means the interface was built for the web rather than the '
      + 'desktop. Rebuild with `npm run build`, which runs the same check that '
      + 'packaging does.';
  const page = `<!doctype html><meta charset="utf-8">
    <style>
      body{margin:0;display:grid;place-items:center;min-height:100vh;
        background:#F6F5F1;color:#12191C;
        font:14px/1.6 Inter,"Segoe UI",system-ui,sans-serif}
      main{max-width:56ch;padding:40px}
      h1{font-size:19px;margin:0 0 10px}
      p{margin:0 0 12px;color:#4A565B}
      code{background:#EDEBE4;border-radius:4px;padding:1px 5px;font-size:12.5px}
      .u{font-size:11.5px;color:#8A959A;word-break:break-all;margin-top:18px}
    </style>
    <main>
      <h1>${headline}</h1>
      <p>${detail}</p>
      <p>If you downloaded this as an installer, please report it — the build
         was packaged incorrectly, not installed incorrectly.</p>
      <div class="u">${url || ''}</div>
    </main>`;
  target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  const userData = app.getPath('userData');
  engineInfo = db.init(userData);
  catalog.init();

  /* A fresh install has vendor records but no photographs, and a deck of empty
     frames reads as broken. Generated once, in the background, so the window
     opens immediately. */
  if (catalog.count('catalog_images') === 0) {
    const dir = path.join(userData, 'catalog-images');
    catalogImages.generate(catalog, dir, (done, total) => {
      send('catalog:seeding', { done, total });
    }).then((r) => send('catalog:seeding', { done: r.written, total: r.written, finished: true }))
      .catch((err) => console.error('Catalog images could not be generated:', err.message));
  }
  // Named after the running app, so version 1 and version 2 file into
  // separate folders and can be compared side by side rather than shuffled
  // into one pile. An existing install keeps whatever it was already set to.
  settings.init(userData, path.join(app.getPath('documents'), `${app.getName()} Library`));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* -------------------------------------------------------------------- misc */

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, payload) => {
  try { return { ok: true, data: await fn(payload) }; }
  catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) }; }
});

handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  storage: engineInfo,
  userData: app.getPath('userData'),
}));

handle('app:openPath', (p) => shell.openPath(p));
handle('app:revealPath', (p) => { shell.showItemInFolder(p); return true; });

/* ---------------------------------------------------------------- settings */

handle('settings:get', () => settings.get());
handle('settings:update', (patch) => settings.update(patch));

handle('settings:chooseLibraryRoot', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose where Cabinet keeps its library',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  await fsp.mkdir(r.filePaths[0], { recursive: true });
  return settings.update({ library: { root: r.filePaths[0] } });
});

handle('settings:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const file = r.filePaths[0];
  const st = await fsp.stat(file);
  if (st.size > 6 * 1024 * 1024) throw new Error('That image is larger than 6 MB — please use a smaller one.');
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const data = await fsp.readFile(file);
  return { dataUri: `data:${mime};base64,${data.toString('base64')}`, name: path.basename(file) };
});

/* -------------------------------------------------------------------- scan */

// path -> extracted text, held between the scan and the filing step
const pending = new Map();

handle('scan:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a folder to scan',
    properties: ['openDirectory', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

handle('scan:chooseFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose documents to scan',
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'txt', 'md'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

handle('scan:cancel', () => { cancelScan = true; return true; });

/**
 * Phase 1 lists everything (fast, metadata only) and Phase 2 opens each file.
 * Progress is streamed so a folder of two thousand documents still feels alive.
 */
handle('scan:start', async (roots) => {
  if (!roots || !roots.length) throw new Error('Nothing was selected.');
  cancelScan = false;

  send('scan:progress', { phase: 'discovering', found: 0, current: 'Looking through folders…' });
  const { files, skipped } = discover(roots, (p) => {
    send('scan:progress', { phase: 'discovering', found: p.found, current: p.current });
  });

  const readable = files.filter((f) => f.extractable);
  send('scan:progress', {
    phase: 'reading', found: files.length, total: readable.length, done: 0, skipped,
  });

  const known = db.listCompanies().map((c) => c.name);
  const ownCompany = (settings.get().brand || {}).name || null;
  const deepMode = ((settings.get().scanner || {}).mode || 'fast') === 'deep';
  const results = [];

  /* Pass one: open every file and take its text and its company candidates.
     Nothing is decided yet — who the sender is only becomes obvious once the
     whole batch has been seen. */
  const candidateSets = [];
  for (let i = 0; i < readable.length; i++) {
    if (cancelScan) break;
    const f = readable[i];
    send('scan:progress', { phase: 'reading', total: readable.length, done: i, current: f.name });

    const record = {
      ...f,
      status: 'read',
      company: null, type: 'other', typeLabel: 'Other', folder: 'Unsorted',
      confidence: 0, date: null, docNumber: null, reason: '', text: '',
    };

    try {
      const { text, method } = await extractText(f);
      record.text = text;
      record.method = method;
      candidateSets.push(extractCandidates(text, f.name).candidates);
    } catch (err) {
      if (err.code === 'no_text') {
        /* A photograph of paper. In deep mode the recognition engine gets a
           go at it; in fast mode — and whenever the engine cannot start — it
           goes to the tagging queue with a picture of itself, which is enough
           for a person to place it in one click. */
        record.imageOnly = true;
        let read = null;
        if (deepMode) {
          send('scan:progress', { phase: 'reading', total: readable.length, done: i, current: `Reading ${f.name} with OCR` });
          read = await ocr.recognise(f.path, f.ext, (p) => send('scan:progress', {
            phase: 'reading', total: readable.length, done: i,
            current: `OCR ${f.name}${p.progress ? ` — ${Math.round(p.progress * 100)}%` : ''}`,
          }));
        }
        if (read && read.ok && read.text && read.text.replace(/\s/g, '').length > 40) {
          record.text = read.text;
          record.method = 'ocr';
          record.ocrConfidence = read.confidence;
          candidateSets.push(extractCandidates(read.text, f.name).candidates);
        } else {
          record.failed = 'This is a scan with no readable text';
          record.ocrNote = read && read.hint ? read.hint : null;
          record.thumbnail = await ocr.thumbnail(f.path, f.ext);
        }
      } else {
        record.failed = err.code === 'encrypted' ? 'Password protected'
          : err.message || 'Could not be read';
      }
    }

    // Hold the extracted text here rather than shipping it to the renderer;
    // filing then needs no second read of the file.
    if (record.text) pending.set(f.path, record.text);
    results.push(record);
    // Yield so progress actually paints between documents.
    await new Promise((r) => setImmediate(r));
  }

  /* A name that heads several documents in one batch is a sender, not a
     client — this is what stops a folder of your own invoices filing itself
     under your own name when Settings is still blank. */
  const senderNames = detectSenders(candidateSets);
  send('scan:progress', { phase: 'sorting', total: readable.length, done: readable.length });

  /* Pass two: decide, now that the senders are known. */
  for (const record of results) {
    if (record.failed) {
      record.status = record.imageOnly ? 'tagging' : 'review';
      record.reason = record.failed;
      delete record.failed;
      continue;
    }
    const verdict = classify(record.text, record.name, { known, ownCompany, senderNames });
    Object.assign(record, verdict);
    record.status = verdict.confidence >= 0.62 ? 'ready' : 'review';
    if (record.status === 'review') record.reason = reasonFor(verdict);
    if (verdict.company && !known.includes(verdict.company)) known.push(verdict.company);
  }

  send('scan:progress', { phase: 'done', total: readable.length, done: results.length });

  return {
    files: results.map(stripText),
    skipped,
    unsupported: files.filter((f) => !f.extractable).map((f) => f.name),
    cancelled: cancelScan,
  };
});

// The full text stays in the main process; the UI gets a preview of it.
const stripText = (r) => ({ ...r, text: undefined, preview: (r.text || '').slice(0, 600) });

/* ------------------------------------------------------------------- filing */

handle('scan:fileOne', async ({ file }) => fileDocument(file));
handle('scan:fileAll', async ({ files }) => {
  const done = [];
  for (const f of files) done.push(await fileDocument(f));
  return done;
});

async function fileDocument(file) {
  const cfg = settings.get();
  const root = cfg.library.root;
  if (!root) throw new Error('Choose a library folder in Settings first.');

  const type = file.type || 'other';
  const placed = await organize.file(root, {
    source: file.path,
    company: file.company || 'Unfiled',
    folder: FOLDER[type] || 'Unsorted',
    typeLabel: TYPE_LABEL[type] || 'Document',
    date: file.date,
    docNumber: file.docNumber,
    ext: file.ext,
  }, cfg.filing.mode);

  // Re-read the text for indexing. Cheap next to the scan, and it means the
  // renderer never had to hold the document body.
  let body = pending.get(file.path) || '';
  if (!body) {
    try { body = (await extractText({ path: placed.full, ext: file.ext })).text; } catch { body = ''; }
  }

  const doc = db.insertDocument({
    company: file.company || 'Unfiled',
    doc_type: type,
    title: placed.name,
    source_path: file.path,
    filed_path: placed.full,
    doc_date: file.date,
    confidence: file.confidence || 0,
    origin: 'scanned',
    confidentiality: 'internal',
    body,
    bytes: file.bytes || 0,
  });

  db.insertChunks(chunkDocument({
    id: doc.id, company: doc.company, doc_type: doc.doc_type,
    title: doc.title, doc_date: doc.doc_date, body,
  }));

  pending.delete(file.path);
  return { ...placed, id: doc.id, company: doc.company };
}

/* ----------------------------------------------------------------- library */

handle('library:companies', () => db.listCompanies());
handle('library:documents', (company) => db.listDocuments(company).map((d) => ({ ...d, body: undefined, preview: (d.body || '').slice(0, 800) })));
handle('library:document', (id) => {
  const d = db.getDocument(id);
  if (!d) throw new Error('That document is no longer in the library.');
  return { ...d, body: (d.body || '').slice(0, 20000) };
});
handle('library:tree', () => organize.readTree(settings.get().library.root));
handle('library:stats', () => ({ ...db.stats(), root: settings.get().library.root }));
handle('library:setConfidentiality', ({ id, level }) => {
  if (!['internal', 'shareable'].includes(level)) throw new Error('Unknown confidentiality level.');
  const d = db.setConfidentiality(id, level);
  return { ...d, body: undefined };
});
handle('library:remove', (id) => { db.deleteDocument(id); return true; });

/* ------------------------------------------------------------------ studio */

handle('studio:generate', async (prompt) => {
  const cfg = settings.get();
  const chunks = db.allChunks().map((c) => {
    const doc = db.getDocument(c.doc_id);
    return { ...c, confidentiality: doc ? doc.confidentiality : 'internal' };
  });
  const companies = db.listCompanies().map((c) => c.name);

  return generate({
    prompt,
    chunks,
    companies,
    brand: cfg.brand,
    modelConfig: cfg.model,
    onStage: (stage, state) => send('studio:stage', { stage, state }),
  });
});

const buildHtml = (payload) => {
  const cfg = settings.get();
  const { draft, lineItems, assets } = payload;
  return renderDocument(
    {
      ...draft,
      kicker: draft.kicker || 'Proposal',
      date: draft.date || new Date().toISOString(),
      sections: (draft.sections || []).map((s) => ({
        heading: s.heading,
        body: s.body,
        citations: s.citations || [],
      })),
    },
    cfg.brand,
    lineItems || [],
    assets || {},
  );
};

handle('studio:preview', (payload) => buildHtml(payload));

handle('studio:exportAs', async ({ format, payload }) => {
  const html = buildHtml(payload);
  const ext = format === 'pdf' ? 'pdf' : format === 'word' ? 'doc' : 'html';
  const r = await dialog.showSaveDialog(win, {
    title: `Export as ${format.toUpperCase()}`,
    defaultPath: path.join(app.getPath('documents'), exporters.suggestedName(payload.draft.title, ext)),
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;

  const out = format === 'pdf'
    ? await exporters.exportPDF(html, r.filePath, {
      title: payload.draft.title, company: payload.draft.company,
    })
    : format === 'word' ? await exporters.exportWord(html, r.filePath)
      : await exporters.exportHTML(html, r.filePath);
  return out;
});

handle('studio:saveToLibrary', async ({ draft, lineItems, assets }) => {
  const cfg = settings.get();
  const root = cfg.library.root;
  if (!root) throw new Error('Choose a library folder in Settings first.');

  const html = buildHtml({ draft, lineItems, assets });
  const target = organize.plan(root, {
    company: draft.company, folder: 'Proposals',
    typeLabel: 'Proposal', date: new Date().toISOString().slice(0, 10), ext: 'html',
  });
  await fsp.mkdir(target.dir, { recursive: true });
  const dest = fs.existsSync(target.full)
    ? target.full.replace(/\.html$/, `_${Date.now().toString(36)}.html`)
    : target.full;
  await fsp.writeFile(dest, html, 'utf8');

  const plainText = [
    draft.title,
    ...(draft.sections || []).flatMap((s) => [s.heading, s.body]),
    'Terms', draft.terms || '',
  ].join('\n');

  const doc = db.insertDocument({
    company: draft.company, doc_type: 'proposal', title: path.basename(dest),
    filed_path: dest, doc_date: new Date().toISOString().slice(0, 10),
    confidence: 1, origin: 'generated', confidentiality: 'internal',
    body: plainText,
  });
  db.insertChunks(chunkDocument({
    id: doc.id, company: doc.company, doc_type: 'proposal',
    title: doc.title, doc_date: doc.doc_date, body: plainText,
  }));
  db.saveProposal({ company: draft.company, title: draft.title, draft, lineItems });

  return { path: dest, id: doc.id };
});

/* ------------------------------------------------------------- catalog v3 */

handle('catalog:templates', () => catalog.listTemplates().map((t) => ({ ...t, slide_plan: JSON.parse(t.slide_plan) })));
handle('catalog:locations', () => catalog.listLocations().map((l) => ({ ...l, images: catalog.imagesFor('location', l.id) })));
handle('catalog:hotels', (locationId) => catalog.listHotels(locationId));
handle('catalog:mcs', () => catalog.listMcs());
handle('catalog:activities', (category) => catalog.listActivities(category));
handle('catalog:logistics', () => catalog.listLogistics());
handle('catalog:decks', () => catalog.listDecks());

/* Pricing is recalculated in the main process rather than trusted from the
   renderer, so the number in the deck is always the number this engine
   produced from catalog rates. */
const resolveSelections = (sel) => ({
  pax: sel.pax,
  nights: sel.nights,
  days: sel.days,
  roomsOverride: sel.roomsOverride,
  hotel: sel.hotelId ? catalog.getHotel(sel.hotelId) : null,
  room: sel.roomId ? catalog.getRoom(sel.roomId) : null,
  mc: sel.mcId ? catalog.getMc(sel.mcId) : null,
  venue: sel.venueId ? catalog.getVenue(sel.venueId) : null,
  activities: (sel.activityIds || []).map(catalog.getActivity).filter(Boolean),
  logistics: (sel.logisticsIds || []).map(catalog.getLogistics).filter(Boolean),
  custom: sel.custom || [],
});

handle('catalog:quote', (sel) => {
  const resolved = resolveSelections(sel);
  return {
    quote: pricing.calculate(resolved, sel.rates || {}),
    warnings: pricing.validate(resolved),
  };
});

const buildProposal = (sel) => {
  const resolved = resolveSelections(sel);
  const template = sel.templateId ? catalog.getTemplate(sel.templateId) : null;
  const location = sel.locationId ? catalog.getLocation(sel.locationId) : null;
  const quote = pricing.calculate(resolved, sel.rates || {});
  const occupancy = resolved.room ? Math.max(1, resolved.room.occupancy || 2) : 2;

  return {
    title: sel.title || 'Event Proposal',
    client: sel.client || '[Client name]',
    dates: sel.dates || '',
    templateId: sel.templateId,
    templateName: template ? template.name : 'Proposal',
    accent: (template && template.accent) || null,
    pax: resolved.pax,
    nights: resolved.nights,
    location,
    locationImages: location ? { images: catalog.imagesFor('location', location.id) } : null,
    venue: resolved.venue,
    hotel: resolved.hotel,
    room: resolved.room,
    roomCount: Number(sel.roomsOverride) > 0
      ? Math.floor(Number(sel.roomsOverride)) : Math.ceil((resolved.pax || 0) / occupancy),
    mc: resolved.mc,
    activities: resolved.activities,
    logistics: resolved.logistics,
    terms: sel.terms || null,
    quote,
    slidePlan: template ? JSON.parse(template.slide_plan) : null,
  };
};

handle('catalog:preview', (sel) => buildProposal(sel));

handle('catalog:export', async (sel) => {
  const built = buildProposal(sel);
  const cfg = settings.get();
  const root = cfg.library.root;
  const safe = String(built.client).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'Client';
  const stamp = new Date().toISOString().slice(0, 10);
  const suggested = `${safe}_${String(built.title).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50)}_${stamp}.pptx`;

  const r = await dialog.showSaveDialog(win, {
    title: 'Save the proposal deck',
    defaultPath: path.join(root || app.getPath('documents'), suggested),
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });
  if (r.canceled || !r.filePath) return null;

  const brand = cfg.brand || {};
  const result = await deck.build(built, {
    name: brand.name, phone: brand.phone, email: brand.email,
    website: brand.website, accent: brand.accent, blurb: brand.tagline,
    logoPath: null,
  }, r.filePath);

  catalog.saveDeck({ ...built, total: built.quote.total, filePath: result.path });
  return result;
});

handle('ocr:status', () => ({ ...ocr.status(), mode: (settings.get().scanner || {}).mode || 'fast' }));
handle('ocr:warmUp', async () => {
  const r = await ocr.ensureEngine((p) => send('scan:progress', { phase: 'ocr', ...p }));
  return r;
});

/* ------------------------------------------------ catalog administration */

const CATALOG_TABLES = ['hotels', 'hotel_rooms', 'mcs', 'activities', 'logistics', 'venues', 'locations'];
const assertTable = (t) => {
  if (!CATALOG_TABLES.includes(t)) throw new Error(`${t} is not a catalog table.`);
  return t;
};

handle('catalog:venues', (locationId) => catalog.listVenues(locationId));

handle('catalog:create', ({ table, values }) => catalog.createItem(assertTable(table), values || {}));
handle('catalog:update', ({ table, id, values }) => catalog.updateItem(assertTable(table), id, values || {}));
handle('catalog:delete', ({ table, id }) => {
  const item = assertTable(table);
  /* The row goes; the picture files stay. Deleting a vendor should not silently
     destroy photographs that may be the only copy. */
  return catalog.deleteItem(item, id);
});

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/* Pictures are copied into the app's own folder rather than referenced where
   they sit. A catalog pointing at someone's Desktop breaks the first time a
   file is tidied away, and the deck would silently lose its photographs. */
handle('catalog:importImages', async ({ ownerType, ownerId, caption }) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose photographs',
    filters: [{ name: 'Images', extensions: IMAGE_EXT }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return [];

  const dir = path.join(app.getPath('userData'), 'catalog-images');
  await fsp.mkdir(dir, { recursive: true });

  const added = [];
  for (const source of r.filePaths) {
    const ext = path.extname(source).slice(1).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) continue;
    const st = await fsp.stat(source);
    if (st.size > 12 * 1024 * 1024) throw new Error(`${path.basename(source)} is larger than 12 MB.`);

    const safe = path.basename(source, path.extname(source))
      .replace(/[^\w-]+/g, '_').slice(0, 40) || 'image';
    const target = path.join(dir, `${ownerType}_${ownerId}_${Date.now().toString(36)}_${safe}.${ext}`);
    await fsp.copyFile(source, target);

    const existing = catalog.imagesFor(ownerType, ownerId).length;
    const id = catalog.addImage(ownerType, ownerId, target, caption || null, existing);
    added.push({ id, path: target });
  }
  return added;
});

handle('catalog:removeImage', ({ id, deleteFile }) => {
  const img = catalog.getImage(id);
  if (!img) return false;
  catalog.removeImage(id);
  // Only files this app copied in are ever deleted from disk.
  if (deleteFile && img.path.startsWith(path.join(app.getPath('userData'), 'catalog-images'))) {
    try { fs.unlinkSync(img.path); } catch { /* already gone */ }
  }
  return true;
});

/* The renderer cannot read file:// paths under a strict page, so pictures are
   handed over as data URIs for preview purposes only. */
handle('catalog:imageData', (imagePath) => {
  if (!imagePath || !fs.existsSync(imagePath)) return null;
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const buf = fs.readFileSync(imagePath);
  if (buf.length > 8 * 1024 * 1024) return null;
  const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
});

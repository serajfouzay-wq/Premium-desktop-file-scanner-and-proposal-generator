'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const db = require('./lib/db');
const settings = require('./lib/settings');
const { discover } = require('./lib/scan');
const { extractText } = require('./lib/extract');
const { classify, reasonFor, FOLDER, TYPE_LABEL } = require('./lib/classify');
const organize = require('./lib/organize');
const { chunkDocument } = require('./lib/chunk');
const { generate } = require('./lib/generate');
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
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  const userData = app.getPath('userData');
  engineInfo = db.init(userData);
  settings.init(userData, path.join(app.getPath('documents'), 'Cabinet Library'));
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
  const results = [];

  for (let i = 0; i < readable.length; i++) {
    if (cancelScan) break;
    const f = readable[i];
    send('scan:progress', { phase: 'reading', total: readable.length, done: i, current: f.name });

    const record = {
      ...f,
      status: 'read',
      company: null, type: 'other', typeLabel: 'Other', folder: 'Unsorted',
      confidence: 0, date: null, reason: '', text: '',
    };

    try {
      const { text, method } = await extractText(f);
      record.text = text;
      record.method = method;
      const verdict = classify(text, f.name, known);
      Object.assign(record, verdict);
      record.status = verdict.confidence >= 0.70 ? 'ready' : 'review';
      if (record.status === 'review') record.reason = reasonFor(verdict);
      if (verdict.company && !known.includes(verdict.company)) known.push(verdict.company);
    } catch (err) {
      record.status = 'review';
      record.reason = err.code === 'encrypted' ? 'Password protected'
        : err.code === 'no_text' ? 'Looks like a scan with no selectable text'
          : err.message || 'Could not be read';
    }

    // Hold the extracted text here rather than shipping it to the renderer;
    // filing then needs no second read of the file.
    if (record.text) pending.set(f.path, record.text);
    results.push(record);
    // Yield so progress actually paints between documents.
    await new Promise((r) => setImmediate(r));
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

  const out = format === 'pdf' ? await exporters.exportPDF(html, r.filePath)
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

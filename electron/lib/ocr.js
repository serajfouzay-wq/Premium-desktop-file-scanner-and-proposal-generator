'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

/*
 * Optical character recognition, kept behind an adapter.
 *
 * A scanned document is a photograph of paper: it has no text layer, so
 * extraction returns nothing and the document lands in the tagging queue. Two
 * modes answer that:
 *
 *   fast  — the default. No OCR at all. Image-only documents get a thumbnail
 *           so a person can recognise them and tag them in one click. Nothing
 *           is downloaded and nothing slows down.
 *   deep  — loads the recognition engine the first time it is needed. The
 *           engine fetches its language model on first use, so this mode
 *           needs a connection once and then works offline.
 *
 * The engine is required lazily and every failure is reported rather than
 * thrown, so an app with no OCR available still scans normally.
 */

const DPI_SCALE = 2;              // render at twice size; OCR accuracy follows resolution
const MAX_OCR_PAGES = 3;
const STARTUP_TIMEOUT_MS = Number(process.env.OCR_STARTUP_TIMEOUT_MS) || 90_000;   // first run downloads a language model
const PAGE_TIMEOUT_MS = 120_000;

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => {
    const e = new Error(`Timed out after ${Math.round(ms / 1000)}s — ${what}.`);
    e.code = 'timeout';
    reject(e);
  }, ms).unref?.()),
]);

let worker = null;
let workerState = 'idle';         // idle | starting | ready | unavailable
let workerError = null;

/**
 * Render the first page of a PDF to a PNG.
 *
 * Chromium renders PDFs natively, so an offscreen window is both the
 * thumbnail source and the OCR input — no image library, no rasteriser,
 * nothing extra in the bundle.
 */
async function renderPdfPage(pdfPath, { width = 900 } = {}) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    show: false,
    width: Math.round(width),
    height: Math.round(width * 1.414),        // A4 portrait
    webPreferences: { offscreen: true, plugins: true, sandbox: true },
  });
  try {
    await win.loadURL(`file://${encodeURI(pdfPath).replace(/#/g, '%23')}`);
    await new Promise((r) => setTimeout(r, 900));   // let the viewer paint
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } finally {
    win.destroy();
  }
}

/** A small preview for the tagging queue. Data URI so nothing touches disk. */
async function thumbnail(filePath, ext) {
  try {
    if (ext === 'pdf') {
      const png = await renderPdfPage(filePath, { width: 420 });
      return `data:image/png;base64,${png.toString('base64')}`;
    }
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const buf = await fsp.readFile(filePath);
      if (buf.length > 4 * 1024 * 1024) return null;
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    }
  } catch { /* a thumbnail is a convenience, never a reason to fail a scan */ }
  return null;
}

/** Bring the recognition engine up. Returns a report rather than throwing. */
async function ensureEngine(onProgress = () => {}) {
  if (workerState === 'ready') return { ok: true, state: 'ready' };
  if (workerState === 'starting') return { ok: false, state: 'starting' };

  workerState = 'starting';
  try {
    // Required here rather than at the top of the file: an installation
    // without it must still scan, just without deep mode.
    const { createWorker } = require('tesseract.js');
    onProgress({ stage: 'loading', detail: 'Preparing the recognition engine' });

    /* The model is fetched on first use, and the library waits on that fetch
       indefinitely. Behind a blocked connection that is an app that never
       comes back, so the wait is bounded here. */
    worker = await withTimeout(
      createWorker('eng', 1, {
        logger: (m) => onProgress({ stage: m.status, progress: m.progress }),
        errorHandler: (e) => { workerError = String(e && e.message ? e.message : e); },
      }),
      STARTUP_TIMEOUT_MS,
      'the recognition engine did not finish starting',
    );
    workerState = 'ready';
    return { ok: true, state: 'ready' };
  } catch (err) {
    workerState = 'unavailable';
    workerError = String(err && err.message ? err.message : err);
    return {
      ok: false,
      state: 'unavailable',
      error: workerError,
      hint: /timed out/i.test(workerError)
        ? 'The language model could not be downloaded in time. Deep mode needs a working connection the first time it runs; Fast mode keeps working either way.'
        : /fetch|network|ENOTFOUND|EAI_AGAIN|download/i.test(workerError)
        ? 'The language model could not be downloaded. Deep mode needs a connection the first time it runs.'
        : 'The recognition engine could not start on this machine.',
    };
  }
}

async function shutdown() {
  if (worker) { try { await worker.terminate(); } catch { /* already gone */ } }
  worker = null;
  workerState = 'idle';
}

/**
 * Read an image-only document.
 * @returns {{ text, confidence, pages }} or null when OCR is not available.
 */
async function recognise(filePath, ext, onProgress = () => {}) {
  const ready = await ensureEngine(onProgress);
  if (!ready.ok) return { ok: false, ...ready };

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cabinet-ocr-'));
  try {
    const pages = [];
    if (ext === 'pdf') {
      // One page is usually enough to identify a document; the whole point of
      // this pass is filing it, not archiving its full text.
      const png = await renderPdfPage(filePath, { width: 1240 * DPI_SCALE / 2 });
      const p = path.join(tmp, 'page1.png');
      await fsp.writeFile(p, png);
      pages.push(p);
    } else {
      pages.push(filePath);
    }

    let text = '';
    let confidenceTotal = 0;
    for (const p of pages.slice(0, MAX_OCR_PAGES)) {
      const { data } = await withTimeout(worker.recognize(p), PAGE_TIMEOUT_MS, 'reading the page took too long');
      text += `${data.text}\n`;
      confidenceTotal += data.confidence || 0;
    }
    return {
      ok: true,
      text: text.trim(),
      confidence: pages.length ? confidenceTotal / pages.length / 100 : 0,
      pages: pages.length,
    };
  } catch (err) {
    return { ok: false, state: 'failed', error: String(err && err.message ? err.message : err) };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

const status = () => ({
  state: workerState,
  error: workerError,
  installed: (() => { try { require.resolve('tesseract.js'); return true; } catch { return false; } })(),
});

module.exports = { thumbnail, recognise, ensureEngine, shutdown, status, renderPdfPage };

'use strict';
const fs = require('fs/promises');
const path = require('path');

/* Phase 2 — open each document and pull its text out.
   Everything happens in the main process: no file content crosses to the
   renderer except the excerpt the user actually looks at. */

let pdfjs = null;
async function getPdfjs() {
  if (!pdfjs) {
    // The legacy build is the one that runs outside a browser worker.
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  return pdfjs;
}

const MAX_PDF_PAGES = 30;
const MAX_SHEETS = 6;

class ExtractError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function extractText(file) {
  const ext = (file.ext || path.extname(file.path).slice(1)).toLowerCase();

  if (ext === 'pdf') return extractPdf(file.path);
  if (ext === 'docx') return extractDocx(file.path);
  if (ext === 'xlsx') return extractXlsx(file.path);
  if (ext === 'txt' || ext === 'md') {
    const text = await fs.readFile(file.path, 'utf8');
    return { text, method: 'plain' };
  }
  // .doc / .xls are legacy binary formats we deliberately don't guess at.
  throw new ExtractError('unsupported', `${ext.toUpperCase()} is a legacy binary format — re-save it as ${ext === 'doc' ? 'DOCX' : 'XLSX'}`);
}

async function extractPdf(p) {
  const lib = await getPdfjs();
  const data = new Uint8Array(await fs.readFile(p));
  let pdf;
  try {
    pdf = await lib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  } catch (err) {
    if (/password/i.test(err.message || '')) throw new ExtractError('encrypted', 'Password protected');
    throw new ExtractError('unreadable', 'Could not be opened');
  }
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  let out = '';
  try {
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      out += lineify(content.items) + '\n';
      page.cleanup();                                  // release the page, not the document
    }
  } finally {
    await pdf.destroy();
  }
  if (out.replace(/\s/g, '').length < 40) {
    throw new ExtractError('no_text', 'Looks like a scan with no selectable text');
  }
  return { text: out, method: 'pdf', pages: pdf.numPages };
}

/* pdf.js hands back positioned fragments, not lines. Rebuilding the line
   breaks matters: headings are how the chunker finds section boundaries. */
function lineify(items) {
  const lines = [];
  let current = [];
  let lastY = null;
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform ? Math.round(it.transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      lines.push(current.join('').trim());
      current = [];
    }
    current.push(it.str + (it.hasEOL ? '\n' : ''));
    lastY = y;
  }
  if (current.length) lines.push(current.join('').trim());
  return lines.filter(Boolean).join('\n');
}

async function extractDocx(p) {
  const mammoth = require('mammoth');
  const buffer = await fs.readFile(p);
  const { value } = await mammoth.extractRawText({ buffer });
  if (!value || !value.trim()) throw new ExtractError('no_text', 'The document is empty');
  return { text: value, method: 'docx' };
}

async function extractXlsx(p) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(await fs.readFile(p), { type: 'buffer' });
  const text = wb.SheetNames.slice(0, MAX_SHEETS)
    .map((n) => `${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
    .join('\n\n');
  if (!text.replace(/[\s,]/g, '')) throw new ExtractError('no_text', 'The workbook has no data');
  return { text, method: 'xlsx', sheets: wb.SheetNames.length };
}

module.exports = { extractText, ExtractError };

'use strict';
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { BrowserWindow } = require('electron');

/*
 * PDF is produced by Chromium's own print engine on the exact HTML the preview
 * shows — same layout engine, same fonts, no second rendering path to drift.
 */
async function exportPDF(html, destination) {
  const win = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  });

  // Chromium refuses top-level data: navigations and caps URL length, so the
  // page is staged as a real file and loaded from disk.
  const staged = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'cabinet-print-')),
    'document.html',
  );

  try {
    await fs.writeFile(staged, html, 'utf8');
    await win.loadFile(staged);
    // Give webfonts and images a moment to settle before the snapshot.
    await new Promise((r) => setTimeout(r, 350));

    const buffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-family:Inter,system-ui,sans-serif;font-size:7pt;
        color:#8B949A;padding:0 16mm 8mm;display:flex;justify-content:flex-end;">
        <span class="pageNumber"></span></div>`,
    });

    await fs.writeFile(destination, buffer);
    return { path: destination, bytes: buffer.length };
  } finally {
    win.destroy();
    await fs.rm(path.dirname(staged), { recursive: true, force: true });
  }
}

/*
 * Word: an HTML document carrying the Office namespace declarations. Word opens
 * it as a fully editable .doc, keeping headings, tables and images, which is
 * what people actually want — an editable file, not a locked one.
 */
async function exportWord(html, destination) {
  const wordHtml = html.replace(
    '<html lang="en">',
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
    + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
    + 'xmlns="http://www.w3.org/TR/REC-html40" lang="en">',
  ).replace('</head>', `<!--[if gte mso 9]><xml>
  <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
</xml><![endif]--></head>`);

  await fs.writeFile(destination, `﻿${wordHtml}`, 'utf8');
  const st = await fs.stat(destination);
  return { path: destination, bytes: st.size };
}

async function exportHTML(html, destination) {
  await fs.writeFile(destination, html, 'utf8');
  const st = await fs.stat(destination);
  return { path: destination, bytes: st.size };
}

const suggestedName = (title, ext) => `${String(title || 'Document')
  .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Document'}.${ext}`;

module.exports = { exportPDF, exportWord, exportHTML, suggestedName, join: path.join };

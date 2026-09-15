'use strict';
/*
 * End-to-end check, run inside a real Electron process:
 *   fixtures on disk -> discover -> extract -> classify -> file -> index
 *   -> retrieve -> draft -> render -> PDF.
 *
 *   npm run test:e2e
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

app.disableHardwareAcceleration();
// The PDF exporter opens and closes an offscreen window; without this the
// default "quit when the last window closes" behaviour would end the run.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabinet-e2e-'));
  const desktop = path.join(tmp, 'Desktop');
  const library = path.join(tmp, 'Library');
  fs.mkdirSync(desktop, { recursive: true });

  try {
    const db = require('../electron/lib/db');
    const settings = require('../electron/lib/settings');
    const { discover } = require('../electron/lib/scan');
    const { extractText } = require('../electron/lib/extract');
    const { classify, FOLDER, TYPE_LABEL } = require('../electron/lib/classify');
    const organize = require('../electron/lib/organize');
    const { chunkDocument } = require('../electron/lib/chunk');
    const { generate } = require('../electron/lib/generate');
    const { renderDocument } = require('../electron/lib/document-template');
    const exporters = require('../electron/lib/exporters');
    const fixtures = require('./fixtures');

    console.log('\nStorage');
    const engine = db.init(path.join(tmp, 'userData'));
    settings.init(path.join(tmp, 'userData'), library);
    check('database opens', !!engine.engine, engine.engine);

    console.log('\nFixtures');
    await fixtures.build(desktop, (html, dest) => exporters.exportPDF(html, dest));
    check('sample documents created', fs.readdirSync(desktop).length >= 6);

    console.log('\nPhase 1 — discovery');
    const { files, skipped } = discover([desktop]);
    const names = files.map((f) => f.name);
    check('finds documents recursively', files.length === 5, `${files.length}: ${names.join(', ')}`);
    check('skips node_modules', !names.includes('ignore-me.pdf'));
    check('skips Office lock files', !names.some((n) => n.startsWith('~$')));
    check('skips empty files', !names.includes('empty.pdf'), `${skipped.empty} empty skipped`);
    check('skips unsupported types', !names.includes('photo.png'));

    console.log('\nPhase 2 — extraction and classification');
    const known = [];
    const records = [];
    for (const f of files) {
      const rec = { ...f };
      try {
        const { text } = await extractText(f);
        rec.text = text;
        Object.assign(rec, classify(text, f.name, known));
        if (rec.company && !known.includes(rec.company)) known.push(rec.company);
      } catch (err) { rec.error = err.message; }
      records.push(rec);
    }
    const byName = (n) => records.find((r) => r.name === n);

    check('reads PDF text', (byName('INV-2291.pdf').text || '').includes('Meridian'));
    check('reads DOCX text',
      (byName('Northwind Studios - retainer proposal.docx').text || '').includes('retainer'));
    check('reads XLSX text', (byName('Halden_PO_8841.xlsx').text || '').includes('Halden'));
    check('reads plain text', (byName('Northwind Studios - MSA.txt').text || '').includes('AGREEMENT'));

    check('classifies the invoice', byName('INV-2291.pdf').type === 'invoice', byName('INV-2291.pdf').type);
    check('classifies the proposal', byName('meridian proposal.pdf').type === 'proposal', byName('meridian proposal.pdf').type);
    check('classifies the agreement', byName('Northwind Studios - MSA.txt').type === 'contract', byName('Northwind Studios - MSA.txt').type);
    check('extracts the company', byName('INV-2291.pdf').company === 'Meridian Logistics Sdn Bhd', String(byName('INV-2291.pdf').company));
    check('merges company variants',
      new Set(records.map((r) => r.company).filter((c) => c && c.includes('Meridian'))).size === 1,
      records.map((r) => r.company).join(' | '));
    check('extracts a date', byName('INV-2291.pdf').date === '2025-03-14', String(byName('INV-2291.pdf').date));

    console.log('\nFiling');
    for (const r of records) {
      if (!r.company) continue;
      const placed = await organize.file(library, {
        source: r.path, company: r.company, folder: FOLDER[r.type],
        typeLabel: TYPE_LABEL[r.type], date: r.date, ext: r.ext,
      }, 'copy');
      const doc = db.insertDocument({
        company: r.company, doc_type: r.type, title: placed.name,
        source_path: r.path, filed_path: placed.full, doc_date: r.date,
        confidence: r.confidence, body: r.text || '', bytes: r.bytes,
      });
      db.insertChunks(chunkDocument({
        id: doc.id, company: doc.company, doc_type: doc.doc_type,
        title: doc.title, doc_date: doc.doc_date, body: r.text || '',
      }));
    }

    const invoicePath = path.join(library, 'Meridian Logistics Sdn Bhd', 'Invoices');
    check('builds Company/Type/File structure', fs.existsSync(invoicePath), invoicePath.replace(library, '…'));
    check('cleans the file name',
      fs.readdirSync(invoicePath)[0] === 'Meridian_Logistics_Sdn_Bhd_Invoice_2025-03-14.pdf',
      fs.readdirSync(invoicePath)[0]);
    check('leaves the original in place', fs.existsSync(path.join(desktop, 'INV-2291.pdf')));

    const dupe = await organize.file(library, {
      source: path.join(desktop, 'INV-2291.pdf'), company: 'Meridian Logistics Sdn Bhd',
      folder: 'Invoices', typeLabel: 'Invoice', date: '2025-03-14', ext: 'pdf',
    }, 'copy');
    check('never overwrites on collision', dupe.name.endsWith('_2.pdf'), dupe.name);

    const stats = db.stats();
    check('indexes documents', stats.documents === 5, String(stats.documents));
    check('indexes passages', stats.chunks > 8, String(stats.chunks));

    console.log('\nRetrieval and drafting');
    const chunks = db.allChunks().map((c) => ({
      ...c, confidentiality: db.getDocument(c.doc_id).confidentiality,
    }));
    const out = await generate({
      prompt: 'Write a fixed-price proposal for Meridian Logistics covering a 12 week warehouse automation rollout',
      chunks,
      companies: db.listCompanies().map((c) => c.name),
      brand: { name: 'Northwind', currency: '$', paymentDays: 30 },
      modelConfig: { enabled: false },
    });

    check('resolves the client from plain words',
      out.draft.company === 'Meridian Logistics Sdn Bhd', out.draft.company);
    check('retrieves relevant passages', out.trace.hits.length > 0, `${out.trace.hits.length} hits`);
    check('only this client and reusable material',
      out.trace.hits.every((h) => h.company === out.draft.company), 
      out.trace.hits.map((h) => h.company).join(' | '));
    check('excludes other clients pricing', out.trace.excluded.length > 0, out.trace.excluded.join('; '));
    const headings = out.draft.sections.map((s) => s.heading);
    check('produces a structured draft', headings.length >= 4, headings.join(', '));
    check('draft carries a scope', headings.includes('Scope of work'), headings.join(', '));
    check('draft carries a timeline', headings.includes('Timeline'), headings.join(', '));

    const moneyLeft = out.draft.sections.some((s) => /(?:[$£€]|RM)\s?[\d,]+\.\d{2}/.test(s.body))
      || /(?:[$£€]|RM)\s?[\d,]+\.\d{2}/.test(out.draft.terms || '');
    check('NUMERIC FIREWALL: no money in the prose', !moneyLeft);
    check('NUMERIC FIREWALL: every price is blank',
      out.lineItems.every((i) => i.unitPrice == null), JSON.stringify(out.lineItems.map((i) => i.unitPrice)));
    check('citations point at real passages',
      out.draft.sections.every((s) => (s.source_ids || []).every((id) => chunks.some((c) => c.id === id))));

    console.log('\nRendering and export');
    const html = renderDocument(
      { ...out.draft, date: new Date().toISOString() },
      { name: 'Northwind Studios', currency: '$', accent: '#1F6E62', email: 'studio@northwind.test' },
      out.lineItems.map((i, n) => ({ ...i, unitPrice: 1000 * (n + 1) })),
      {},
    );
    check('renders a document', html.includes('<h1>') && html.includes('Investment'));
    check('shows photo placeholders', html.includes('plate-empty'));
    check('totals are computed, not written', html.includes('class="total"'));

    const pdf = path.join(tmp, 'out.pdf');
    await exporters.exportPDF(html, pdf);
    const head = fs.readFileSync(pdf).subarray(0, 5).toString();
    check('exports a real PDF', head === '%PDF-', `${(fs.statSync(pdf).size / 1024).toFixed(0)} KB`);

    const docFile = path.join(tmp, 'out.doc');
    await exporters.exportWord(html, docFile);
    check('exports for Word', fs.readFileSync(docFile, 'utf8').includes('urn:schemas-microsoft-com:office:word'));
  } catch (err) {
    check('unexpected failure', false, err.stack || String(err));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(failed.map((f) => `  · ${f.name}`).join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed.length ? 1 : 0);
});

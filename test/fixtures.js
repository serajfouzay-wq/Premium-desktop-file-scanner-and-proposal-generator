'use strict';
/* Builds a realistic mess of documents in a temp folder, the way a user's
   Desktop actually looks. Used by the end-to-end test. */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');

const INVOICE_HTML = `<!doctype html><meta charset="utf-8">
<body style="font:12pt Georgia;padding:40px">
<h1>TAX INVOICE</h1>
<p>Invoice No: INV-2291<br>Date: 2025-03-14</p>
<p>Bill To: Meridian Logistics Sdn Bhd<br>14 Jalan Perindustrian, Shah Alam</p>
<h3>Description</h3>
<p>Warehouse racking survey and layout plan</p>
<h3>Amount</h3>
<p>Subtotal 8,400.00<br>Amount Due 8,904.00</p>
<p>Payment terms: net 30 days from invoice date.</p>
</body>`;

const PROPOSAL_HTML = `<!doctype html><meta charset="utf-8">
<body style="font:12pt Georgia;padding:40px">
<h1>PROPOSAL</h1>
<p>Prepared for: Meridian Logistics Sdn Bhd<br>Date: 12 January 2025</p>
<h2>OVERVIEW</h2>
<p>Meridian operates three distribution centres and asked us to review how goods move
through them. This proposal sets out a phased programme to automate inbound handling
and to rebuild the pick paths around the new racking.</p>
<h2>SCOPE OF WORK</h2>
<p>We will survey each site, model the current flow, and specify the conveyor and scanning
equipment needed. The work covers mechanical layout, control wiring schedules, and the
integration points with the existing warehouse management system. Commissioning and
operator training are included at each site.</p>
<h2>DELIVERABLES</h2>
<p>A layout pack per site, an equipment schedule, an integration specification, and a
commissioning report signed off by the site manager.</p>
<h2>TIMELINE</h2>
<p>Phase 1 survey runs four weeks from kickoff. Phase 2 installation runs a further eight
weeks per site, scheduled to avoid the peak season.</p>
<h2>PRICING</h2>
<p>Survey phase 24,000.00. Installation phase 186,500.00 per site. Total 597,500.00.</p>
<h2>TERMS</h2>
<p>Payment due within 30 days of invoice date. Liability is limited to the value of this
contract. Governing law is that of Malaysia.</p>
</body>`;

const CONTRACT_TEXT = [
  'MASTER SERVICES AGREEMENT',
  '',
  'This Agreement is made between Northwind Studios Ltd and the Client.',
  '',
  'SCOPE',
  'Northwind Studios Ltd will provide brand identity and web design services on a retainer',
  'basis. The retainer covers design direction, production of assets, and a standing',
  'allocation of studio time each month agreed in advance with the client team.',
  '',
  'DELIVERABLES',
  'A brand guideline document, a component library, and monthly design output logged',
  'against the retainer allocation.',
  '',
  'TERMS',
  'Either party may terminate on 60 days notice. Governing law is that of England and Wales.',
  'Both parties agree that liability is capped at fees paid in the preceding twelve months.',
].join('\n');

async function buildDocx(dest) {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'PROPOSAL', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('Prepared for: Northwind Studios Ltd'),
        new Paragraph({ text: 'SCOPE OF WORK', heading: HeadingLevel.HEADING_2 }),
        new Paragraph('A six month retainer covering brand direction, web design and production. '
          + 'The studio allocates a fixed block of time each month, drawn down against agreed '
          + 'workstreams and reviewed at the end of every sprint.'),
        new Paragraph({ text: 'TIMELINE', heading: HeadingLevel.HEADING_2 }),
        new Paragraph('Six months from commencement, reviewed at month three.'),
      ],
    }],
  });
  fs.writeFileSync(dest, await Packer.toBuffer(doc));
}

function buildXlsx(dest) {
  const rows = [
    ['Purchase Order', 'PO-8841'],
    ['Client', 'Halden Group Pte Ltd'],
    ['Date', '2025-02-08'],
    [],
    ['Item', 'Qty', 'Unit price', 'Amount'],
    ['Site survey', 1, 4200, 4200],
    ['Equipment schedule', 1, 3100, 3100],
    ['Total', '', '', 7300],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'PO');
  XLSX.writeFile(wb, dest);
}

/** @param {(html:string,dest:string)=>Promise<any>} htmlToPdf */
async function build(dir, htmlToPdf) {
  fs.mkdirSync(path.join(dir, 'Old jobs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules', 'junk'), { recursive: true });

  await htmlToPdf(INVOICE_HTML, path.join(dir, 'INV-2291.pdf'));
  await htmlToPdf(PROPOSAL_HTML, path.join(dir, 'Old jobs', 'meridian proposal.pdf'));
  await buildDocx(path.join(dir, 'Northwind Studios - retainer proposal.docx'));
  buildXlsx(path.join(dir, 'Old jobs', 'Halden_PO_8841.xlsx'));
  fs.writeFileSync(path.join(dir, 'Northwind Studios - MSA.txt'), CONTRACT_TEXT);

  // Noise that must be skipped, not filed.
  fs.writeFileSync(path.join(dir, 'node_modules', 'junk', 'ignore-me.pdf'), 'x');
  fs.writeFileSync(path.join(dir, '~$draft.docx'), 'x');
  fs.writeFileSync(path.join(dir, 'empty.pdf'), '');
  fs.writeFileSync(path.join(dir, 'photo.png'), 'x');

  return dir;
}

module.exports = { build };

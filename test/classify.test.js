'use strict';
/*
 * The classifier measured against document shapes that actually occur.
 * Run with: npm run test:classify
 */
const { classify, extractCandidates, detectSenders } = require('../electron/lib/classify');

const OWN = 'Northwind Industrial Pte Ltd';
const L = (...lines) => lines.join('\n');

const CASES = [
  {
    name: 'invoice with title-case letterhead',
    text: L('Northwind Industrial Pte Ltd', '11 Dockside Way, Singapore', '', 'TAX INVOICE',
      'Invoice No: INV-2291', 'Invoice Date: 14/03/2025', '', 'Bill To:', 'Meridian Logistics Sdn Bhd',
      '14 Jalan Perindustrian', '', 'Amount Due 8,904.00'),
    file: 'INV-2291.pdf',
    expect: { company: 'Meridian Logistics Sdn Bhd', type: 'invoice', date: '2025-03-14', docNumber: 'INV-2291' },
  },
  {
    name: 'label on its own line, no colon',
    text: L('Northwind Industrial Pte Ltd', '', 'PROPOSAL', '', 'Prepared for', 'Halden Group Pte Ltd', '',
      'SCOPE OF WORK', 'We will deliver the works described below.'),
    file: 'proposal.pdf',
    expect: { company: 'Halden Group Pte Ltd', type: 'proposal' },
  },
  {
    name: 'uppercase letterhead still not the client',
    text: L('NORTHWIND INDUSTRIAL PTE LTD', 'Singapore', '', 'QUOTATION', 'Quote No: QT-4417', '',
      'Client: Bayfront Development Sdn Bhd', '', 'Valid for 30 days', 'Unit price applies per site.'),
    file: 'QT-4417.pdf',
    expect: { company: 'Bayfront Development Sdn Bhd', type: 'quotation', docNumber: 'QT-4417' },
  },
  {
    name: 'purchase order addressed to us',
    text: L('Halden Group Pte Ltd', '9 Tuas Link', '', 'PURCHASE ORDER', 'P.O. Number: PO-8841',
      'Order Date: 8 February 2025', '', 'Supplier:', 'Northwind Industrial Pte Ltd', '',
      'Ship To: Halden Group Warehouse 3'),
    file: 'Halden_PO_8841.pdf',
    expect: { company: 'Halden Group Pte Ltd', type: 'purchase_order', docNumber: 'PO-8841', date: '2025-02-08' },
  },
  {
    name: 'contract naming both parties',
    text: L('MASTER SERVICES AGREEMENT', '',
      'This Agreement is made between Northwind Industrial Pte Ltd and Corveth Marine Sdn Bhd.', '',
      'GOVERNING LAW', 'Both parties agree that the governing law is that of Singapore.'),
    file: 'MSA-corveth.pdf',
    expect: { company: 'Corveth Marine Sdn Bhd', type: 'contract' },
  },
  {
    name: 'day-first date is not read as month-first',
    text: L('TAX INVOICE', 'Invoice Date: 13/04/2025', 'Bill To: Aldwych Rail Ltd', 'Amount Due 400.00'),
    file: 'inv.pdf',
    expect: { company: 'Aldwych Rail Ltd', date: '2025-04-13' },
  },
  {
    name: 'issue date preferred over due date',
    text: L('TAX INVOICE', 'Invoice Date: 2025-01-05', 'Due Date: 2025-02-04',
      'Bill To: Aldwych Rail Ltd', 'Amount Due 400.00'),
    file: 'inv.pdf',
    expect: { date: '2025-01-05' },
  },
  {
    name: 'no company anywhere goes to review',
    text: L('Meeting notes', 'Discussed the schedule and agreed to reconvene.'),
    file: 'scan_0042.pdf',
    expect: { company: null },
  },
  {
    name: 'an email address is not a company',
    text: L('PROPOSAL', 'Prepared for', 'accounts@bayfront.example.com', '', 'SCOPE OF WORK', 'Works as described.'),
    file: 'p.pdf',
    expectNot: { company: 'accounts@bayfront.example.com' },
  },
  {
    name: 'merges a variant onto a company already filed',
    text: L('TAX INVOICE', 'Bill To: Meridian Logistics', 'Amount Due 120.00'),
    file: 'inv.pdf',
    known: ['Meridian Logistics Sdn Bhd'],
    expect: { company: 'Meridian Logistics Sdn Bhd' },
  },
];

let pass = 0; let fail = 0;
const results = [];

for (const c of CASES) {
  const got = classify(c.text, c.file, { known: c.known || [], ownCompany: OWN });
  const problems = [];
  for (const [key, want] of Object.entries(c.expect || {})) {
    if (got[key] !== want) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got[key])}`);
  }
  for (const [key, notWant] of Object.entries(c.expectNot || {})) {
    if (got[key] === notWant) problems.push(`${key}: should not be ${JSON.stringify(notWant)}`);
  }
  if (problems.length) { fail++; results.push(`  FAIL  ${c.name}\n          ${problems.join('\n          ')}`); }
  else { pass++; results.push(`  PASS  ${c.name}`); }
}

// The cross-document sender heuristic, for users who never filled in Settings.
const sets = [
  extractCandidates(L('Corveth Marine Sdn Bhd', 'INVOICE', 'Bill To: Client A Ltd'), 'a.pdf').candidates,
  extractCandidates(L('Corveth Marine Sdn Bhd', 'INVOICE', 'Bill To: Client B Ltd'), 'b.pdf').candidates,
  extractCandidates(L('Corveth Marine Sdn Bhd', 'INVOICE', 'Bill To: Client C Ltd'), 'c.pdf').candidates,
];
const senders = detectSenders(sets);
const detected = senders.includes('corveth marine sdn bhd');
if (detected) { pass++; results.push('  PASS  detects a repeated letterhead as the sender'); }
else { fail++; results.push(`  FAIL  detects a repeated letterhead as the sender — got ${JSON.stringify(senders)}`); }

const withSender = classify(
  L('Corveth Marine Sdn Bhd', 'INVOICE', 'Bill To: Client A Ltd', 'Amount Due 90.00'),
  'a.pdf', { senderNames: ['Corveth Marine Sdn Bhd'] },
);
if (withSender.company === 'Client A Ltd') { pass++; results.push('  PASS  the detected sender is not filed as the client'); }
else { fail++; results.push(`  FAIL  the detected sender is not filed as the client — got ${JSON.stringify(withSender.company)}`); }

console.log(`\n${results.join('\n')}`);
console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

'use strict';

/* Work out who a document belongs to and what kind of document it is,
   with an honest confidence score. Anything below the threshold goes to the
   review queue instead of being filed on a guess. */

const TYPE_RULES = {
  invoice: [/\btax\s+invoice\b/i, /\binvoice\s*(?:no|#|number)/i, /\bamount\s+due\b/i, /\bbill\s+to\b/i, /\bremittance\b/i, /\bdue\s+date\b/i],
  proposal: [/\bproposal\b/i, /\bquotation\b/i, /\bscope\s+of\s+work\b/i, /\bstatement\s+of\s+work\b/i, /\bwe\s+are\s+pleased\s+to\b/i, /\bsubmitted\s+for\s+your\s+consideration\b/i],
  contract: [/\bthis\s+agreement\b/i, /\bwitnesseth\b/i, /\bgoverning\s+law\b/i, /\bboth\s+parties\b/i, /\bin\s+witness\s+whereof\b/i, /\bmaster\s+services\s+agreement\b/i],
  receipt: [/\breceipt\b/i, /\bpaid\s+in\s+full\b/i, /\bchange\s+due\b/i, /\bpayment\s+received\b/i],
  report: [/\bquarterly\s+report\b/i, /\bannual\s+report\b/i, /\bfindings\b/i, /\bexecutive\s+summary\b/i],
  purchase_order: [/\bpurchase\s+order\b/i, /\bP\.?O\.?\s*(?:no|#|number)/i],
};

const FOLDER = {
  invoice: 'Invoices',
  proposal: 'Proposals',
  contract: 'Contracts',
  receipt: 'Receipts',
  report: 'Reports',
  purchase_order: 'Purchase Orders',
  other: 'Unsorted',
};

const TYPE_LABEL = {
  invoice: 'Invoice', proposal: 'Proposal', contract: 'Contract', receipt: 'Receipt',
  report: 'Report', purchase_order: 'Purchase Order', other: 'Other',
};

// A trading-name suffix is the single strongest signal that a string is a company.
const SUFFIX = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'()-]*){0,4}\s+(?:Sdn\.?\s*Bhd|Berhad|Bhd|Pte\.?\s*Ltd|Pvt\.?\s*Ltd|Limited|Ltd|L\.?L\.?C|Inc|Incorporated|Corp(?:oration)?|GmbH|B\.?V|N\.?V|S\.?A|PLC|LLP|Group|Holdings|Partners|Studio|Studios|Agency)\.?)\b/;
const LABELLED = /(?:bill(?:ed)?\s*to|invoice\s*to|sold\s*to|client|customer|prepared\s+for|issued\s+to|attention)\s*[:\-–]\s*([^\n,|]{3,60})/i;

const STOP_WORDS = /^(?:the|invoice|proposal|final|draft|copy|scan|document|report|new|old|untitled|image|file|doc|attachment)$/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function detectDate(text) {
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4})\b/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
    /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const t = Date.parse(m[1].replace(/\//g, '-'));
      if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    }
  }
  return null;
}

function candidateFromFilename(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const head = stem.split(/[_\-–]/)[0].trim();
  if (head.length < 3 || head.length > 48) return null;
  if (STOP_WORDS.test(head) || /^\d+$/.test(head)) return null;
  return head.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * @param {string} text     extracted document text
 * @param {string} filename original file name
 * @param {string[]} known  company names already in the cabinet, for fuzzy merging
 */
function classify(text, filename, known = []) {
  const head = text.slice(0, 4000);
  const haystack = `${head} ${filename}`;

  let type = 'other';
  let hits = 0;
  for (const [candidate, rules] of Object.entries(TYPE_RULES)) {
    const n = rules.reduce((a, r) => a + (r.test(haystack) ? 1 : 0), 0);
    if (n > hits) { hits = n; type = candidate; }
  }

  let company = null;
  let via = null;
  const labelled = head.match(LABELLED);
  if (labelled && labelled[1].trim().length > 2) { company = labelled[1].trim(); via = 'labelled'; }
  if (!company) {
    const m = head.match(SUFFIX);
    if (m) { company = m[1].trim(); via = 'trading name'; }
  }
  if (!company) {
    const fromName = candidateFromFilename(filename);
    if (fromName) { company = fromName; via = 'file name'; }
  }
  if (company) company = company.replace(/\s{2,}/g, ' ').replace(/[,;.]+$/, '').slice(0, 60);

  const resolved = resolveCompany(company, known);

  let confidence = 0.15;
  confidence += Math.min(hits * 0.13, 0.36);
  if (resolved.name) confidence += 0.20;
  if (via === 'labelled') confidence += 0.15;
  if (via === 'trading name') confidence += 0.10;
  if (resolved.merged) confidence += 0.08;            // matches a company we already know
  if (via === 'file name') confidence -= 0.10;        // weakest evidence there is

  return {
    type,
    typeLabel: TYPE_LABEL[type],
    folder: FOLDER[type],
    company: resolved.name,
    companyVia: via,
    merged: resolved.merged,
    confidence: Math.max(0, Math.min(confidence, 0.98)),
    date: detectDate(head),
  };
}

/* "Meridian Logistics" and "Meridian Logistics Sdn Bhd" must not become two
   folders. Prefer the longer, more specific name once they're recognised
   as the same company. */
function resolveCompany(name, known) {
  if (!name) return { name: null, merged: false };
  const n = norm(name);
  if (!n) return { name: null, merged: false };
  for (const k of known) {
    const kn = norm(k);
    if (!kn) continue;
    if (kn === n || kn.startsWith(`${n} `) || n.startsWith(`${kn} `) || kn === n) {
      return { name: k.length >= name.length ? k : name, merged: true };
    }
  }
  return { name, merged: false };
}

const reasonFor = (result) => {
  if (!result.company) return "Couldn't find a company name";
  if (result.type === 'other') return 'Unclear what kind of document this is';
  return 'Low confidence in the match';
};

module.exports = { classify, FOLDER, TYPE_LABEL, TYPE_RULES, reasonFor, norm };

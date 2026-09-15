'use strict';

/*
 * Who does this document belong to, and what kind of document is it?
 *
 * Version 1 took the first company-looking string in the text. On a real
 * document that string is the letterhead — the SENDER — so a folder of your
 * own invoices filed itself under your own name. Every candidate is now
 * extracted with its evidence and scored, and the sender is actively pushed
 * down rather than picked first.
 */

const TYPE_RULES = {
  invoice: {
    strong: [/\btax\s+invoice\b/i, /\binvoice\s*(?:number|num|no|#)\b\b/i, /\bamount\s+due\b/i, /\bremittance\b/i],
    weak: [/\bbill\s+to\b/i, /\bdue\s+date\b/i, /\bsubtotal\b/i, /\bvat\b/i, /\bgst\b/i],
    against: [/\bproforma\b/i, /\bquotation\b/i, /\bthis\s+agreement\b/i],
    file: /invoice|\binv[-_ ]?\d/i,
  },
  proposal: {
    strong: [/\bproposal\b/i, /\bscope\s+of\s+work\b/i, /\bstatement\s+of\s+work\b/i, /\bwe\s+are\s+pleased\s+to\b/i],
    weak: [/\bprepared\s+for\b/i, /\bdeliverables\b/i, /\bour\s+approach\b/i, /\bexecutive\s+summary\b/i],
    against: [/\btax\s+invoice\b/i, /\bamount\s+due\b/i],
    file: /proposal|\bsow\b|scope/i,
  },
  quotation: {
    strong: [/\bquotation\b/i, /\bquote\s*(?:number|num|no|#)\b\b/i, /\bproforma\s+invoice\b/i],
    weak: [/\bvalid\s+(?:for|until)\b/i, /\bunit\s+price\b/i, /\blead\s+time\b/i],
    against: [/\btax\s+invoice\b/i, /\bthis\s+agreement\b/i],
    file: /quot|\bqt[-_ ]?\d/i,
  },
  contract: {
    strong: [/\bthis\s+agreement\b/i, /\bwitnesseth\b/i, /\bin\s+witness\s+whereof\b/i, /\bmaster\s+services\s+agreement\b/i],
    weak: [/\bgoverning\s+law\b/i, /\bboth\s+parties\b/i, /\bindemnif/i, /\btermination\b/i, /\bhereinafter\b/i],
    against: [/\btax\s+invoice\b/i],
    file: /contract|agreement|\bmsa\b|\bnda\b/i,
  },
  receipt: {
    strong: [/\bofficial\s+receipt\b/i, /\bpaid\s+in\s+full\b/i, /\bpayment\s+received\b/i],
    weak: [/\breceipt\b/i, /\bchange\s+due\b/i, /\bthank\s+you\s+for\s+your\s+payment\b/i],
    against: [/\bamount\s+due\b/i],
    file: /receipt|\brcpt\b/i,
  },
  purchase_order: {
    strong: [/\bpurchase\s+order\b/i, /\bP\.?O\.?\s*(?:number|num|no|#)\b\b/i],
    weak: [/\bship\s+to\b/i, /\bdeliver\s+to\b/i, /\border\s+date\b/i],
    against: [],
    file: /purchase[-_ ]?order|\bpo[-_ ]?\d/i,
  },
  report: {
    strong: [/\b(?:quarterly|annual|monthly)\s+report\b/i, /\bsite\s+report\b/i, /\binspection\s+report\b/i],
    weak: [/\bfindings\b/i, /\bmethodology\b/i, /\brecommendations\b/i, /\bconclusion\b/i],
    against: [/\bamount\s+due\b/i],
    file: /report/i,
  },
};

const FOLDER = {
  invoice: 'Invoices', proposal: 'Proposals', quotation: 'Quotations',
  contract: 'Contracts', receipt: 'Receipts', purchase_order: 'Purchase Orders',
  report: 'Reports', other: 'Unsorted',
};

const TYPE_LABEL = {
  invoice: 'Invoice', proposal: 'Proposal', quotation: 'Quotation',
  contract: 'Contract', receipt: 'Receipt', purchase_order: 'Purchase Order',
  report: 'Report', other: 'Other',
};

/* Legal and trading suffixes. Case-insensitive, unlike v1 — a title-case
   letterhead used to slip past this entirely. */
/* Only suffixes that actually mark a legal or trading entity. Words like
   "Services" and "Solutions" appear in document titles — "MASTER SERVICES
   AGREEMENT" was being read as a company called "Master Services". */
const SUFFIX_WORDS = String.raw`Sdn\.?\s*Bhd|Berhad|Bhd|Pte\.?\s*Ltd|Pvt\.?\s*Ltd|Limited|Ltd|L\.?L\.?C|LLC|Incorporated|Inc|Corporation|Corp|GmbH|B\.?V|N\.?V|S\.?A\.?R\.?L|PLC|LLP|PLLC|Co\.?\s*,?\s*Ltd|Group|Holdings|Partners|Studios?`;
const SUFFIX_RE = new RegExp(String.raw`\b([A-Z][\w&.'’-]*(?:\s+[A-Za-z][\w&.'’()-]*){0,4}\s+(?:${SUFFIX_WORDS})\.?)\b`, 'i');

/* Labels that introduce the RECIPIENT. The value may sit after a separator on
   the same line, or on the following line — which is how most documents are
   actually laid out, and which v1 could not read. */
const RECIPIENT_LABELS = [
  'bill to', 'billed to', 'invoice to', 'sold to', 'ship to', 'deliver to',
  'prepared for', 'submitted to', 'issued to', 'client', 'customer',
  'attention', 'attn', 'to',
];
const RECIPIENT_RE = new RegExp(
  String.raw`(?:^|\n)\s*(?:${RECIPIENT_LABELS.join('|')})\s*[:\-–]?\s*(?:\n\s*)?([^\n]{3,70})`,
  'i',
);

/* Labels that introduce the SENDER — a candidate found here is the wrong one. */
const SENDER_RE = new RegExp(
  String.raw`(?:^|\n)\s*(?:from|prepared\s+by|submitted\s+by|issued\s+by|supplier|vendor|remit\s+to)\s*[:\-–]?\s*(?:\n\s*)?([^\n]{3,70})`,
  'i',
);

const NOT_A_COMPANY = /^(?:the|invoice|proposal|quotation|contract|agreement|receipt|report|final|draft|copy|scan|document|page|date|total|amount|subject|re|dear|sir|madam|attn|attention|address|phone|email|tel|fax|no|number|new|old|untitled|image|file|doc|attachment|confidential|private)\b/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const cleanName = (raw) => String(raw || '')
  .replace(/^[\s:,\-–|]+/, '')
  .replace(/[\s:,;.|]+$/, '')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, 70);

const plausible = (name) => {
  const n = cleanName(name);
  if (n.length < 3 || n.length > 70) return false;
  if (NOT_A_COMPANY.test(n)) return false;
  if (/^\d+$/.test(n)) return false;
  if (!/[A-Za-z]{2}/.test(n)) return false;
  if (/@|https?:\/\//i.test(n)) return false;          // an email or URL, not a name
  if (/^\+?\d[\d\s()-]{6,}$/.test(n)) return false;    // a phone number
  return true;
};

/**
 * Pull out every plausible company name with the evidence that produced it.
 * Position matters: the first few lines of a document are the letterhead.
 */
function extractCandidates(text, filename) {
  const head = String(text || '').slice(0, 6000);
  const lines = head.split(/\r?\n/);
  const out = [];
  const add = (name, source, lineIndex) => {
    const clean = cleanName(name);
    if (!plausible(clean)) return;
    out.push({ name: clean, source, lineIndex });
  };

  // Where the recipient is named, that is the strongest evidence there is.
  const recipient = head.match(RECIPIENT_RE);
  if (recipient) {
    const line = recipient[1];
    const inner = line.match(SUFFIX_RE);
    // "Ship To: Halden Group Warehouse 3" — file it under the company, not the shed.
    add(inner ? inner[1] : line, 'recipient-label', head.slice(0, recipient.index).split('\n').length);
    // The label may name a person, with the company on the line after.
    const after = head.slice(recipient.index + recipient[0].length).split('\n')[1];
    if (after && SUFFIX_RE.test(after)) add(after.match(SUFFIX_RE)[1], 'recipient-label', 0);
  }

  const sender = head.match(SENDER_RE);
  const senderName = sender ? cleanName(sender[1]) : null;

  // "This Agreement is made between A and B" — B is the counterparty.
  const between = head.match(/\bbetween\s+(.{3,70}?)\s+and\s+(.{3,70}?)\s*(?:[.,;]|\n|$)/i);
  if (between) {
    for (const part of [between[2], between[1]]) {
      const m = part.match(SUFFIX_RE);
      if (m) add(m[1], 'party', 0);
    }
  }

  // Every trading name in the document, with the line it appeared on.
  lines.forEach((line, i) => {
    const m = line.match(SUFFIX_RE);
    if (m) add(m[1], i <= 4 ? 'letterhead' : 'trading-name', i);
  });

  const stem = String(filename || '').replace(/\.[^.]+$/, '');
  const fromFile = stem.split(/[_\-–]/)[0].trim().replace(/([a-z])([A-Z])/g, '$1 $2');
  if (fromFile) add(fromFile, 'filename', -1);

  return { candidates: out, senderName };
}

const SOURCE_SCORE = {
  'recipient-label': 0.62,
  party: 0.52,
  'trading-name': 0.34,
  letterhead: 0.30,
  filename: 0.16,
};

/**
 * @param {string} text
 * @param {string} filename
 * @param {object} opts
 *   known        company names already in the cabinet, for fuzzy merging
 *   ownCompany   the user's own company, from Settings — never the client
 *   senderNames  names detected as letterheads across the whole scan
 */
function classify(text, filename, opts = {}) {
  const known = opts.known || [];
  const ownCompany = opts.ownCompany || null;
  const senderNames = (opts.senderNames || []).map(norm).filter(Boolean);

  const { candidates, senderName } = extractCandidates(text, filename);
  const ownNorm = ownCompany ? norm(ownCompany) : null;

  const scored = [];
  for (const c of candidates) {
    const n = norm(c.name);
    if (!n) continue;

    // Your own company is never the client, however it was found.
    if (ownNorm && (n === ownNorm || n.startsWith(`${ownNorm} `) || ownNorm.startsWith(`${n} `))) continue;
    // Nor is a name the document itself introduced as the sender.
    if (senderName && norm(senderName) === n && c.source !== 'recipient-label') continue;

    let score = SOURCE_SCORE[c.source] || 0.1;

    if (SUFFIX_RE.test(c.name)) score += 0.14;             // carries a legal suffix
    if (c.name.split(/\s+/).length >= 2) score += 0.05;    // two words beats one

    // A name that appears as a letterhead across this whole scan is the
    // sender — yours, or a supplier's — not the client of this document.
    if (senderNames.includes(n) && c.source !== 'recipient-label') score -= 0.34;

    const merged = mergeWithKnown(c.name, known);
    if (merged.merged) score += 0.10;

    const mn = norm(merged.name);
    const existing = scored.find((s) => {
      const sn = norm(s.name);
      return sn === mn || sn.startsWith(`${mn} `) || mn.startsWith(`${sn} `);
    });
    if (existing) {
      // Keep the fuller name, and let the agreement raise the score.
      if (merged.name.length > existing.name.length) existing.name = merged.name;
      existing.score = Math.max(existing.score, score) + 0.06;
    } else {
      scored.push({ name: merged.name, score, source: c.source, merged: merged.merged });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] || null;

  const type = classifyType(text, filename);
  const docNumber = findDocumentNumber(text, type.type);
  const date = findDate(text);

  let confidence = 0;
  if (best) {
    confidence = Math.min(best.score, 0.72);
    // A clear winner is worth more than a coin toss between two names.
    if (scored.length > 1 && best.score - scored[1].score < 0.08) confidence -= 0.10;
  }
  confidence += type.confidence * 0.26;
  if (date) confidence += 0.04;
  if (docNumber) confidence += 0.04;

  return {
    company: best ? best.name : null,
    companyVia: best ? best.source : null,
    merged: best ? best.merged : false,
    alternatives: scored.slice(1, 4).map((s) => s.name),
    type: type.type,
    typeLabel: TYPE_LABEL[type.type],
    folder: FOLDER[type.type],
    typeConfidence: type.confidence,
    docNumber,
    date,
    confidence: Math.max(0, Math.min(confidence, 0.98)),
  };
}

function classifyType(text, filename) {
  const body = String(text || '').slice(0, 6000);
  const name = String(filename || '');
  let best = { type: 'other', score: 0 };

  for (const [type, rules] of Object.entries(TYPE_RULES)) {
    let score = 0;
    score += rules.strong.filter((r) => r.test(body)).length * 1.0;
    score += rules.weak.filter((r) => r.test(body)).length * 0.35;
    score -= rules.against.filter((r) => r.test(body)).length * 1.2;
    if (rules.file.test(name)) score += 0.8;             // the file name is evidence too
    if (score > best.score) best = { type, score };
  }

  if (best.score < 0.8) return { type: 'other', confidence: 0 };
  return { type: best.type, confidence: Math.min(best.score / 2.6, 1) };
}

const NUMBER_PATTERNS = {
  invoice: /\binvoice\s*(?:number|num|no|#)\b\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/i,
  quotation: /\bquot(?:e|ation)\s*(?:number|num|no|#)\b\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/i,
  purchase_order: /\b(?:purchase\s+order|P\.?O\.?)\s*(?:number|num|no|#)\b\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/i,
  receipt: /\breceipt\s*(?:number|num|no|#)\b\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/i,
};

/* A document number makes the filed name unique and searchable, which matters
   when a company sends you twelve invoices in a month. */
function findDocumentNumber(text, type) {
  const head = String(text || '').slice(0, 4000);
  const pattern = NUMBER_PATTERNS[type];
  if (pattern) {
    const m = head.match(pattern);
    if (m) return m[1].replace(/[^\w/-]/g, '').slice(0, 20);
  }
  const generic = head.match(/\b(?:ref|reference|doc(?:ument)?)\s*(?:(?:number|num|no|#)\b)?\s*[:.#-]\s*([A-Z0-9][A-Z0-9/-]{2,19})/i);
  return generic ? generic[1].slice(0, 20) : null;
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const DATE_FORMS = [
  String.raw`(\d{4}-\d{2}-\d{2})`,
  String.raw`(\d{1,2}\s+(?:${MONTHS})[a-z]*\.?,?\s+\d{4})`,
  String.raw`((?:${MONTHS})[a-z]*\.?\s+\d{1,2},?\s+\d{4})`,
  String.raw`(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})`,
];

/* Prefer the date the document says is its own. A bare first-date-wins scan
   picks up due dates, print dates and page footers. */
function findDate(text) {
  const head = String(text || '').slice(0, 5000);

  for (const form of DATE_FORMS) {
    const labelled = head.match(new RegExp(
      String.raw`\b(?:invoice\s+date|date\s+of\s+issue|issue\s+date|dated|date)\s*[:.\-–]?\s*${form}`, 'i',
    ));
    if (labelled) {
      const iso = toISO(labelled[1]);
      if (iso) return iso;
    }
  }
  for (const form of DATE_FORMS) {
    const any = head.match(new RegExp(form, 'i'));
    if (any) {
      const iso = toISO(any[1]);
      if (iso) return iso;
    }
  }
  return null;
}

function toISO(raw) {
  let s = String(raw).trim();
  // A d/m/Y string is ambiguous to Date.parse, which assumes m/d/Y. Where the
  // first number cannot be a month, read it as day-first.
  const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (dmy && Number(dmy[1]) > 12) s = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const year = d.getFullYear();
  if (year < 1990 || year > new Date().getFullYear() + 2) return null;   // page numbers, not dates
  return d.toISOString().slice(0, 10);
}

function mergeWithKnown(name, known) {
  const n = norm(name);
  for (const k of known) {
    const kn = norm(k);
    if (!kn) continue;
    if (kn === n || kn.startsWith(`${n} `) || n.startsWith(`${kn} `)) {
      return { name: k.length >= name.length ? k : name, merged: true };
    }
  }
  return { name, merged: false };
}

/* Names that sit in the letterhead of several documents in one scan belong to
   a sender, not to the clients those documents are addressed to. */
function detectSenders(perDocumentCandidates, threshold = 2) {
  const counts = new Map();
  for (const set of perDocumentCandidates) {
    const seen = new Set();
    for (const c of set) {
      if (c.source !== 'letterhead') continue;
      const n = norm(c.name);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= threshold).map(([name]) => name);
}

const reasonFor = (result) => {
  if (!result.company) return "Couldn't work out which company this belongs to";
  if (result.type === 'other') return "Couldn't tell what kind of document this is";
  if (result.alternatives && result.alternatives.length) {
    return `Could be ${result.company} or ${result.alternatives[0]}`;
  }
  return 'Not confident enough to file this automatically';
};

module.exports = {
  classify, extractCandidates, detectSenders, classifyType,
  findDate, findDocumentNumber, mergeWithKnown,
  FOLDER, TYPE_LABEL, TYPE_RULES, reasonFor, norm,
};

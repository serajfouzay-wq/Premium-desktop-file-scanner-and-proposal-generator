'use strict';

/* Split a document into labelled passages.

   The section label is the whole point: it is what lets retrieval say
   "reuse the scope wording, never another client's pricing" as a filter
   rather than as a hope. */

const SECTION_RULES = [
  [/^(?:scope|scope of work|services|works|description of works|what we will do)\b/i, 'scope'],
  [/^(?:deliverab|milestone|outputs|what you receive)/i, 'deliverables'],
  [/^(?:pricing|price|fees|charges|cost|rates|amount|investment|total|schedule of rates)/i, 'pricing'],
  [/^(?:terms|payment terms|terms and conditions|conditions|warranty|liabilit)/i, 'terms'],
  [/^(?:timeline|schedule|duration|programme|program|phasing)/i, 'timeline'],
  [/^(?:introduction|overview|summary|executive|background|about)/i, 'intro'],
  [/^(?:assumption|exclusion|out of scope)/i, 'assumptions'],
];

const MONEYISH = /(?:[$£€¥]|RM|USD|MYR|EUR|GBP)\s?[\d,]+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/;

function labelFor(heading, body) {
  for (const [re, label] of SECTION_RULES) if (re.test(heading.trim())) return label;
  if (/\b(?:due|amount|total|rate|per unit|subtotal|unit price)\b/i.test(body) && MONEYISH.test(body)) return 'pricing';
  if (/\b(?:warranty|liability|governing law|indemnif|notice period|terminat)/i.test(body)) return 'terms';
  if (/\b(?:week|month|phase|milestone|commenc|delivery date)\b/i.test(body) && /\d/.test(body)) return 'timeline';
  return 'other';
}

const isHeading = (line) => {
  const t = line.trim();
  if (t.length < 3 || t.length > 70) return false;
  if (/[.;,]$/.test(t)) return false;
  return /^[A-Z][A-Za-z0-9 /&'()-]+:?$/.test(t)
      || /^\d+[.)]\s+[A-Z]/.test(t)
      || (t === t.toUpperCase() && /[A-Z]{3}/.test(t));
};

const MAX_CHUNK = 1400;
const MIN_CHUNK = 60;

function chunkDocument(doc) {
  const lines = String(doc.body || '').split(/\r?\n/);
  const out = [];
  let heading = '';
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim().replace(/\n{3,}/g, '\n\n');
    if (body.length >= MIN_CHUNK) {
      out.push({
        doc_id: doc.id,
        company: doc.company,
        doc_type: doc.doc_type,
        doc_title: doc.title,
        doc_date: doc.doc_date,
        heading: heading || '(untitled)',
        section: labelFor(heading, body),
        content: body.slice(0, MAX_CHUNK),
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      heading = line.trim().replace(/:$/, '');
    } else {
      buffer.push(line);
      if (buffer.join('\n').length > MAX_CHUNK) flush();   // never let a passage run away
    }
  }
  flush();
  return out;
}

module.exports = { chunkDocument, labelFor };

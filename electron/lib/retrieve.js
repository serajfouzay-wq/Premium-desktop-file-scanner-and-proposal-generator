'use strict';
const { norm } = require('./classify');

/* Retrieval over the cabinet.

   Scoring is lexical (BM25-flavoured TF weighting). The part that matters for
   a business is not the scorer but the filter: the tenancy rules are applied
   inside the query, so a passage that must not be reused cannot reach the
   drafter even if it scores highest. */

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'our', 'their', 'them', 'you', 'your', 'have', 'has', 'will', 'can', 'all', 'any', 'new', 'please', 'need', 'want', 'make', 'write', 'draft', 'create']);

/* Company matching wants punctuation dropped ("Acme, Inc." === "Acme Inc"),
   but a query wants it split: deleting the hyphen in "fixed-price" produces
   "fixedprice", a token that matches nothing. Different jobs, different rules. */
const tokenize = (s) => [...new Set(
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w)),
)];

function scoreChunk(queryTokens, chunk) {
  const words = norm(`${chunk.heading} ${chunk.content}`).split(' ');
  if (!words.length) return 0;
  const tf = Object.create(null);
  for (const w of words) tf[w] = (tf[w] || 0) + 1;
  let score = 0;
  for (const q of queryTokens) if (tf[q]) score += 1 + Math.log(tf[q]);
  return score / Math.sqrt(words.length);
}

const REUSABLE_SECTIONS = ['scope', 'deliverables', 'timeline', 'intro', 'assumptions'];

/**
 * @param {object} intent  parsed request
 * @param {string} company resolved client name
 * @param {Array}  chunks  every chunk in the cabinet
 */
function retrieve(intent, company, chunks) {
  const q = tokenize([intent.summary, intent.type, intent.billing, intent.duration].filter(Boolean).join(' '));
  const excluded = [];

  // A — this client's own history. Everything is fair game, including pricing:
  //     it is their own file.
  const own = chunks
    .filter((c) => c.company === company)
    .map((c) => ({ chunk: c, score: scoreChunk(q, c), via: 'this client' }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // B — comparable work for other clients. Marked reusable only, and never
  //     a pricing passage, whatever its label says.
  const comparable = chunks
    .filter((c) => c.company !== company
      && c.confidentiality === 'shareable'
      && REUSABLE_SECTIONS.includes(c.section))
    .map((c) => ({ chunk: c, score: scoreChunk(q, c) * 0.85, via: 'comparable work' }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const blockedPricing = chunks.filter((c) => c.company !== company && c.section === 'pricing').length;
  if (blockedPricing) excluded.push(`${blockedPricing} pricing passage${blockedPricing === 1 ? '' : 's'} belonging to other clients`);
  const notShareable = chunks.filter((c) => c.company !== company && c.confidentiality !== 'shareable').length;
  if (notShareable) excluded.push(`${notShareable} passage${notShareable === 1 ? '' : 's'} not marked reusable`);

  // C — a wider keyword sweep under the same tenancy rules, to catch wording
  //     the two passes above ranked just out of reach.
  const keyword = chunks
    .filter((c) => c.company === company || c.confidentiality === 'shareable')
    .map((c) => ({ chunk: c, score: scoreChunk(q, c) * 0.7, via: 'keyword match' }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const seen = new Set();
  const hits = [];
  for (const r of [...own, ...comparable, ...keyword]) {
    if (r.score > 0.02 && !seen.has(r.chunk.id)) { seen.add(r.chunk.id); hits.push(r); }
  }

  /* Section coverage. A proposal needs a scope and a timeline whether or not
     those passages happen to share vocabulary with the request, so the client's
     own best passage in each structural section is pulled in even when lexical
     scoring ranked it out. Tenancy still applies: own work only. */
  for (const section of REUSABLE_SECTIONS) {
    if (hits.some((h) => h.chunk.section === section)) continue;
    const best = chunks
      .filter((c) => c.company === company && c.section === section && !seen.has(c.id))
      .map((c) => ({ chunk: c, score: scoreChunk(q, c), via: 'section coverage' }))
      .sort((a, b) => b.score - a.score)[0];
    if (best) { seen.add(best.chunk.id); hits.push(best); }
  }

  hits.sort((a, b) => b.score - a.score);

  return {
    hits: hits.slice(0, 12),
    excluded,
    searched: chunks.length,
    counts: { own: own.length, comparable: comparable.length, keyword: keyword.length },
  };
}

/* Read a plain-language request and pull out what we need to act on it. */
const DOC_TYPES = [
  [/\bproposal\b/i, 'proposal'], [/\bquot(?:e|ation)\b/i, 'quotation'],
  [/\bcontract\b|\bagreement\b/i, 'contract'], [/\binvoice\b/i, 'invoice'],
  [/\bstatement of work\b|\bsow\b/i, 'statement of work'], [/\bscope\b/i, 'proposal'],
];

function parseIntent(prompt) {
  const text = String(prompt || '').trim();
  let type = 'proposal';
  for (const [re, t] of DOC_TYPES) if (re.test(text)) { type = t; break; }

  const client = (text.match(/\bfor\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'()-]*){0,4})/) || [])[1]
    || (text.match(/\b(?:client|customer)\s*[:\-]?\s*([A-Z][\w&.' -]{2,40})/) || [])[1]
    || null;

  const duration = (text.match(/\b(\d+\s*(?:day|week|month|year)s?)\b/i) || [])[1] || null;
  const billing = (text.match(/\b(fixed[ -]price|retainer|monthly|time and materials|milestone[ -]based|hourly)\b/i) || [])[1] || null;

  const missing = [];
  if (!client) missing.push('client name');
  if (!duration) missing.push('duration');
  if (!billing) missing.push('billing arrangement');

  return { summary: text, type, client: client ? client.trim() : null, duration, billing, missing };
}

/** Match the name in the request against companies we already hold. */
function resolveEntity(raw, companies) {
  if (!raw) return { company: null, status: 'unknown' };
  const n = norm(raw);
  const exact = companies.find((c) => norm(c) === n);
  if (exact) return { company: exact, status: 'exact' };
  const partial = companies.filter((c) => norm(c).includes(n) || n.includes(norm(c)));
  if (partial.length === 1) return { company: partial[0], status: 'matched' };
  if (partial.length > 1) return { company: partial[0], status: 'ambiguous', options: partial };
  return { company: raw, status: 'new' };
}

module.exports = { retrieve, parseIntent, resolveEntity, tokenize, scoreChunk };

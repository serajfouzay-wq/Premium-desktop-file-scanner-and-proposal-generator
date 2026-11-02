'use strict';
/* The whole chain: a typed sentence becomes a filled proposal.
   The crop-free half runs anywhere. Filling the client's 12-page template
   additionally needs that file, which is not in the repository:
     TEMPLATE="Teambuilding Proposal template.pptx" node test/proposal.test.js */
const fs = require('fs');
const path = require('path');
const os = require('os');
const tf = require('../electron/lib/template-fill');
const jt = require('../electron/lib/job-types');
const { resolve } = require('../electron/lib/resolve');
const { compose, reference, abbreviate } = require('../electron/lib/compose');
const { writePng } = require('./helpers/png');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

const CATALOG = {
  jobTypes: [{ id: 'job_tb', name: 'Team Building' }],
  locations: [{ id: 'l1', name: 'Port Dickson' }],
  hotels: [{ id: 'h1', name: 'Lexis Hibiscus Port Dickson', location_id: 'l1' }],
  mcs: [{ id: 'm1', name: 'Sera Fouzay' }],
  activities: [{ id: 'a1', name: 'Amazing Race' }, { id: 'a2', name: 'Beach Olympics' }],
  venues: [],
};

const SENTENCE = 'team building for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, '
  + '14 - 15 March 2026, 2D1N at Lexis Hibiscus Port Dickson, MC Sera Fouzay, '
  + 'amazing race and beach olympics, RM 285 per pax, hotel package RM 180 per pax, '
  + 'depart 8:30am back 6pm';

console.log('\n── reference numbers ──');
check('follows the client\'s scheme',
  reference({ company: 'ABC Sdn Bhd', date: new Date('2026-03-01'), sequence: 7 })
    === 'SSL/ABC/03/2026/007',
  reference({ company: 'ABC Sdn Bhd', date: new Date('2026-03-01'), sequence: 7 }));
check('a revision does not overwrite the original',
  reference({ company: 'ABC Sdn Bhd', date: new Date('2026-03-01'), sequence: 7, revision: 2 })
    === 'SSL/ABC/03/2026/007-R2');
check('uses an acronym already in the name',
  abbreviate('DHL Supply Chain Malaysia Sdn Bhd') === 'DHL');
check('builds one when there is none',
  abbreviate('Smart Solutions Learning Sdn Bhd') === 'SMARSOLU',
  abbreviate('Smart Solutions Learning Sdn Bhd'));
check('never returns nothing', abbreviate('') === 'CLIENT' && abbreviate(null) === 'CLIENT');

console.log('\n── the arithmetic the template prints ──');
const c = compose(resolve(SENTENCE, CATALOG), {
  preparedBy: 'Joanne Teoh', now: new Date('2026-03-01'), sequence: 7,
});
check('programme fee is the rate times the head count',
  c.values.programTotal === '12,825.00', c.values.programTotal);
check('sales tax is 8% of it', c.values.salesTax === '1,026.00', c.values.salesTax);
check('total for A + B adds the tax', c.values.totalAB === '13,851.00', c.values.totalAB);
check('the hotel is costed separately', c.values.venueTotal === '8,100.00', c.values.venueTotal);
check('the GRAND total really does include the hotel',
  c.values.grandTotal === '21,951.00', c.values.grandTotal);
check('every figure it worked out is shown as working',
  c.computed.length >= 5 && c.computed.some((x) => /grand total/.test(x)));

const noPrice = compose(resolve('team building for ABC Sdn Bhd, 45 pax', CATALOG), {});
check('with no price typed, no price is invented',
  noPrice.values.programTotal == null && noPrice.values.grandTotal == null
  && noPrice.values.salesTax == null);
check('and it says so plainly',
  noPrice.notes.some((n) => /does not invent/.test(n)), noPrice.notes.join(' / '));

const statedOnly = compose(resolve('team building for ABC Sdn Bhd, 45 pax, total RM 20,000', CATALOG), {});
check('a stated total is used as given', statedOnly.values.totalAB === '20,000.00',
  statedOnly.values.totalAB);

const conflict = compose(resolve('team building for ABC Sdn Bhd, 45 pax, RM 285 per pax, '
  + 'total RM 99,000', CATALOG), {});
check('a stated total that disagrees with the rate is flagged, not silently preferred',
  conflict.notes.some((n) => /differs/.test(n)), conflict.notes.join(' / '));

console.log('\n── the mapping ──');
const mapping = jt.mappingFor('team_building');
check('every entry addresses exactly one kind of target',
  mapping.every((m) => [m.slot, m.table, m.pic, m.find, m.after]
    .filter((x) => x != null).length === 1),
  `${mapping.length} entries`);
check('every entry names a field or a replacement',
  mapping.every((m) => m.field != null || m.replace != null));
check('no two entries address the same slot twice',
  new Set(mapping.filter((m) => m.slot != null).map((m) => `${m.slide}:${m.slot}`)).size
  === mapping.filter((m) => m.slot != null).length);
check('no two entries address the same cell twice',
  new Set(mapping.filter((m) => m.table != null)
    .map((m) => `${m.slide}:${m.table}:${m.row}:${m.col}`)).size
  === mapping.filter((m) => m.table != null).length);
check('the pages with no placeholders are never opened',
  jt.TEAM_BUILDING.untouched.every((n) => !mapping.some((m) => m.slide === n)),
  `pages ${jt.TEAM_BUILDING.untouched.join(', ')}`);
check('a request with nothing in it reports what it needs',
  jt.missingFor('team_building', {}).join(',') === 'company,groupSize,programDate');

const TEMPLATE = process.env.TEMPLATE;
if (!TEMPLATE || !fs.existsSync(TEMPLATE)) {
  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed`);
  console.log('(set TEMPLATE to the 12-page .pptx to also fill it)\n');
  process.exit(fail ? 1 : 0);
}

(async () => {
  console.log('\n── filling the real 12-page template ──');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-'));
  const cover = writePng(path.join(dir, 'cover.png'), 2400, 1350, [28, 64, 112]);
  const resolved = resolve(SENTENCE, CATALOG);
  const built = compose(resolved, {
    preparedBy: 'Joanne Teoh',
    preparedByEmail: 'joanne@example.com',
    preparedByMobile: '+60 12-345 6789',
    now: new Date('2026-03-01'),
    sequence: 7,
    coverPhoto: cover,
  });

  const dest = path.join(dir, 'proposal.pptx');
  const res = await tf.fill(TEMPLATE, dest, mapping, built.values);

  check('the mapping still matches the template', res.problems.length === 0,
    res.problems.join('; '));
  check('nothing was left unplaced for want of a value', res.skipped.length === 0,
    res.skipped.join(', '));
  check('the cover photograph went in', res.photos.length === 1);

  const slides = await tf.readText(dest);
  const text = (n) => slides.find((s) => s.slide === n).runs.join(' ');
  const all = slides.flatMap((s) => s.runs).join(' ');

  check('page 1 carries the client and the reference',
    /ABC Sdn Bhd/.test(text(1)) && /SSL\/ABC\/03\/2026\/007/.test(text(1)));
  check('page 1 carries the person it is addressed to', /Ms Joanne Teoh/.test(text(1)));
  check('page 4 carries the company, dates and head count',
    /ABC Sdn Bhd/.test(text(4)) && /14 - 15 March 2026/.test(text(4)) && /45 pax/.test(text(4)));
  check('page 8 carries the rate and the A+B total',
    /285\.00/.test(text(8)) && /13,851\.00/.test(text(8)));
  check('page 9 carries the hotel cost and the grand total',
    /8,100\.00/.test(text(9)) && /21,951\.00/.test(text(9)));
  check('page 12 repeats the reference, company and grand total',
    /SSL\/ABC\/03\/2026\/007/.test(text(12)) && /ABC Sdn Bhd/.test(text(12))
    && /21,951\.00/.test(text(12)));
  check('page 12 carries the consultant\'s own details',
    /Joanne Teoh/.test(text(12)) && /joanne@example\.com/.test(text(12))
    && /\+60 12-345 6789/.test(text(12)));

  /* The template's instructions to its own user must never reach a client. */
  check('not one "link from page" note survives', !/link from page/.test(all));

  /* Anything still a placeholder is named rather than shipped quietly. */
  check('what is still a placeholder is reported', Array.isArray(res.remaining));
  check('only the one unexplained slot is left',
    res.remaining.length === 1 && res.remaining[0].slide === 12,
    res.remaining.map((r) => `p${r.slide} ${JSON.stringify(r.text)}`).join(', '));

  /* The pages the engine never opens must be untouched, to the character. */
  const before = await tf.readText(TEMPLATE);
  let untouchedOk = true;
  for (const n of jt.TEAM_BUILDING.untouched) {
    const a = before.find((s) => s.slide === n);
    const b = slides.find((s) => s.slide === n);
    if (!a || !b || a.runs.join('\u0001') !== b.runs.join('\u0001')) untouchedOk = false;
  }
  check('the programme write-up, methodology and terms are untouched', untouchedOk,
    `pages ${jt.TEAM_BUILDING.untouched.join(', ')}`);
  check('the deck still has all 12 pages', slides.length === 12, `${slides.length} pages`);

  /* Running it twice must give the same deck, or nobody can trust a re-issue. */
  const again = path.join(dir, 'again.pptx');
  const res2 = await tf.fill(TEMPLATE, again, mapping, built.values);
  const t2 = await tf.readText(again);
  check('filling the same request twice gives the same text',
    JSON.stringify(slides) === JSON.stringify(t2));
  check('and reports the same result', res.written.length === res2.written.length);

  /* A mapping that no longer matches must stop rather than write anywhere. */
  let threw = null;
  try {
    await tf.fill(TEMPLATE, path.join(dir, 'never.pptx'),
      [{ slide: 1, slot: 0, field: 'company', expect: 'THIS IS NOT THERE' }],
      { company: 'ABC' });
  } catch (e) { threw = e; }
  check('a template that has changed stops the fill', threw != null
    && /has changed/.test(threw.message), threw ? threw.message.split('\n')[1] : 'did not throw');
  check('and writes no file at all', !fs.existsSync(path.join(dir, 'never.pptx')));

  console.log(`\n   ${(res.bytes / 1024 / 1024).toFixed(2)} MB, `
    + `${res.written.length} targets placed`);
  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

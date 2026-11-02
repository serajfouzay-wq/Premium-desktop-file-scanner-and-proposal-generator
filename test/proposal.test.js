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

console.log('\n── prices come from the database ──');
/* Catalog records carrying the rates that are actually stored against them. */
const MC = { id: 'm1', name: 'Sera Fouzay', headline: 'Lead facilitator', day_rate: 1800, cost_price: 1200 };
const ACTS = [
  { id: 'a1', name: 'Amazing Race', rate_type: 'per_head', rate: 95, cost_price: 60 },
  { id: 'a2', name: 'Beach Olympics', rate_type: 'per_head', rate: 70, cost_price: 45 },
];
const HOTEL = { id: 'h1', name: 'Lexis Hibiscus Port Dickson' };
const ROOM = { tier: 'Deluxe', occupancy: 2, nightly_rate: 420, cost_price: 300 };
const COACH = [{ id: 'g1', name: 'Executive coach 44 seats', category: 'transport',
  rate_type: 'flat', rate: 1600, cost_price: 1200, spec: 'Return' }];
const SELECTIONS = {
  programme: { mc: MC, activities: ACTS },
  venue: { hotel: HOTEL, room: ROOM },
  transport: { logistics: COACH },
};
const PLAIN = 'team building for ABC Sdn Bhd, 45 pax, 14 - 15 March 2026, 2D1N at '
  + 'Lexis Hibiscus Port Dickson, MC Sera Fouzay, amazing race and beach olympics';

const fromDb = compose(resolve(PLAIN, CATALOG), { selections: SELECTIONS });
/* 1800 x 2 days + 95 x 45 + 70 x 45 = 3,600 + 4,275 + 3,150 */
check('the programme is priced from the stored rates',
  fromDb.values.programTotal === '11,025.00', fromDb.values.programTotal);
check('and divided out per head for the UNIT PRICE column',
  fromDb.values.programUnitPrice === '245.00', fromDb.values.programUnitPrice);
check('tax is 8% of it', fromDb.values.salesTax === '882.00', fromDb.values.salesTax);
/* 45 pax at 2 per room is 23 rooms, one night at 420 */
check('the hotel is priced by rooms and nights, not head count',
  fromDb.values.venueTotal === '9,660.00', fromDb.values.venueTotal);
check('the coach is priced at its flat rate',
  fromDb.values.transportTotal === '1,600.00', fromDb.values.transportTotal);
check('the grand total adds all four items',
  fromDb.values.grandTotal === '23,167.00', fromDb.values.grandTotal);
check('nobody had to type a single price',
  !/\d/.test(PLAIN.split('45 pax')[1].replace(/14 - 15 March 2026|2D1N|44/g, '')) === false
  || fromDb.values.grandTotal === '23,167.00');
check('it says which figures came from the database',
  fromDb.computed.some((x) => /from the catalog/.test(x)),
  fromDb.computed.filter((x) => /catalog/.test(x)).length + ' line(s)');

console.log('\n── a typed price overrides the database ──');
const override = compose(
  resolve(`${PLAIN}, RM 285 per pax`, CATALOG), { selections: SELECTIONS });
check('the typed rate is used, not the stored one',
  override.values.programTotal === '12,825.00', override.values.programTotal);
check('and the difference is pointed out rather than hidden',
  override.notes.some((n) => /typed rate/.test(n) && /catalog/.test(n)),
  override.notes.find((n) => /catalog/.test(n)) || '(nothing said)');
check('the hotel still comes from the database',
  override.values.venueTotal === '9,660.00', override.values.venueTotal);
check('the working says the rate was typed',
  override.computed.some((x) => /typed into the request/.test(x)));

const venueOverride = compose(
  resolve(`${PLAIN}, hotel package RM 180 per pax`, CATALOG), { selections: SELECTIONS });
check('a typed hotel rate overrides only the hotel',
  venueOverride.values.venueTotal === '8,100.00'
  && venueOverride.values.programTotal === '11,025.00',
  `hotel ${venueOverride.values.venueTotal}, programme ${venueOverride.values.programTotal}`);

console.log('\n── what the client is shown never includes what it costs us ──');
const COSTS = ['1,200.00', '300.00', '60.00', '45.00', '1200.00'];
const shown = Object.entries(fromDb.values);
const leaked = shown.filter(([, v]) => COSTS.includes(String(v)));
check('no value on a slide equals a cost price', leaked.length === 0,
  leaked.map(([k, v]) => `${k}=${v}`).join(', ') || 'none');
check('the cost of the job is not in the values at all',
  !Object.keys(fromDb.values).some((k) => /cost|margin|internal/i.test(k)),
  Object.keys(fromDb.values).join(', '));

const noCatalog = compose(resolve(PLAIN, CATALOG), {});
check('with no catalog selections and no typed price, no price is produced',
  noCatalog.values.programTotal == null && noCatalog.values.grandTotal == null);
check('and it says why', noCatalog.notes.some((n) => /does not invent/.test(n)),
  noCatalog.notes.join(' / '));

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

  /* A leftover must be addressable, or the person ends up in PowerPoint
     retyping it — the work this is supposed to remove. */
  console.log('\n── a leftover placeholder can be filled by what the report says ──');
  const sparse = compose(resolve('team building for ABC Sdn Bhd, 45 pax, 14 - 15 March 2026',
    CATALOG), { preparedBy: 'Joanne Teoh' });
  const first = await tf.fill(TEMPLATE, path.join(dir, 'sparse.pptx'),
    mapping, sparse.values, { strict: false });
  check('leftovers are reported with an address', first.remaining.length > 0
    && first.remaining.every((r) => r.address && r.address.slide),
    `${first.remaining.length} leftover(s)`);

  const pick = first.remaining.find((r) => r.slide === 12 && r.slot != null);
  check('a page 12 leftover carries a slot number', pick != null,
    pick ? `slot ${pick.slot}` : 'none found');
  if (pick) {
    const filledIn = await tf.fill(TEMPLATE, path.join(dir, 'filled-in.pptx'),
      [...mapping, { ...pick.address, field: 'typedByHand' }],
      { ...sparse.values, typedByHand: 'Sera Fouzay' }, { strict: false });
    check('filling it removes exactly that leftover',
      filledIn.remaining.length === first.remaining.length - 1,
      `${first.remaining.length} -> ${filledIn.remaining.length}`);
    const t12 = (await tf.readText(path.join(dir, 'filled-in.pptx')))
      .find((x) => x.slide === 12).runs.join(' ');
    check('the typed value is on the page', /Sera Fouzay/.test(t12));
    check('and nothing else on that page was overwritten',
      /ABC Sdn Bhd/.test(t12) && /SSL\/ABC/.test(t12));
  }

  /* An address taken from a filled deck rather than the template would point
     at the wrong run, so the numbers must be template-relative. */
  const twice = await tf.fill(TEMPLATE, path.join(dir, 'twice.pptx'),
    mapping, sparse.values, { strict: false });
  check('the same fill reports the same addresses every time',
    JSON.stringify(first.remaining.map((r) => r.address))
    === JSON.stringify(twice.remaining.map((r) => r.address)));

  console.log('\n── a mapping that addresses one run twice is refused ──');
  let clash = null;
  try {
    await tf.fill(TEMPLATE, path.join(dir, 'clash.pptx'),
      [{ slide: 1, slot: 0, field: 'one' }, { slide: 1, slot: 0, field: 'two' }],
      { one: 'a', two: 'b' }, { strict: false });
  } catch (e) { clash = e; }
  check('it throws even with strict off, because the file would be broken',
    clash != null && /same place twice/.test(clash.message),
    clash ? clash.message.split('\n')[0] : 'did not throw');
  check('it names both entries', clash != null && /\(one and two\)/.test(clash.message));
  check('and writes nothing', !fs.existsSync(path.join(dir, 'clash.pptx')));

  console.log(`\n   ${(res.bytes / 1024 / 1024).toFixed(2)} MB, `
    + `${res.written.length} targets placed`);
  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

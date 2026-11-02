#!/usr/bin/env node
'use strict';
/* Builds one proposal from one typed sentence, so the whole chain can be seen
   working on a real file rather than described.
 *
 * Usage:
 *   node scripts/demo-proposal.js --template <12-page .pptx> [options]
 *
 *   --template <path>   the proposal template to fill            (required)
 *   --out <path>        where to write it   (default ./Proposal-demo.pptx)
 *   --say "<sentence>"  the request to read  (default: the example below)
 *   --cover <image>     a cover photograph, PNG or JPEG
 *
 * The template is the client's own file and is deliberately not in the
 * repository, so the path has to be given.  */
const path = require('path');
const fs = require('fs');
const tf = require('../electron/lib/template-fill');
const jt = require('../electron/lib/job-types');
const { resolve, describe } = require('../electron/lib/resolve');
const { compose } = require('../electron/lib/compose');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/* Stands in for the catalog until the demo is pointed at a real database. */
const CATALOG = {
  jobTypes: [{ id: 'job_tb', name: 'Team Building' }],
  locations: [{ id: 'l1', name: 'Port Dickson' }, { id: 'l2', name: 'Melaka' }],
  hotels: [
    { id: 'h1', name: 'Lexis Hibiscus Port Dickson', location_id: 'l1' },
    { id: 'h2', name: 'Grand Lexis Port Dickson', location_id: 'l1' },
    { id: 'h3', name: 'Courtyard by Marriott Melaka', location_id: 'l2' },
  ],
  mcs: [{ id: 'm1', name: 'Sera Fouzay' }, { id: 'm2', name: 'Farah Nordin' }],
  activities: [
    { id: 'a1', name: 'Amazing Race' }, { id: 'a2', name: 'Beach Olympics' },
    { id: 'a3', name: 'Culinary Face-Off' },
  ],
  venues: [],
};

const DEFAULT_SENTENCE = 'team building for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, '
  + '14 - 15 March 2026, 2D1N at Lexis Hibiscus Port Dickson, MC Sera Fouzay, '
  + 'amazing race and beach olympics, RM 285 per pax, hotel package RM 180 per pax, '
  + 'depart 8:30am back 6pm';

async function main() {
  const template = arg('template');
  if (!template || !fs.existsSync(template)) {
    console.error('Give me the template to fill:\n'
      + '  node scripts/demo-proposal.js --template "Teambuilding Proposal template.pptx"');
    process.exit(2);
  }
  const sentence = arg('say', DEFAULT_SENTENCE);
  const out = path.resolve(arg('out', 'Proposal-demo.pptx'));
  const cover = arg('cover');

  console.log(`\nTYPED\n  "${sentence}"\n`);

  const resolved = resolve(sentence, CATALOG);
  console.log('UNDERSTOOD');
  describe(resolved).forEach((l) => console.log(`  ${l}`));
  if (resolved.ambiguous.length) {
    console.log('\nNEEDS A DECISION — two catalog entries fit equally well:');
    for (const a of resolved.ambiguous) {
      console.log(`  ${a.field}: ${a.options.map((o) => o.name).join('  or  ')}`);
    }
  }
  if (resolved.unrecognised.length) {
    console.log(`\nNOT IN THE CATALOG: ${resolved.unrecognised.join(', ')}`);
  }

  const built = compose(resolved, {
    preparedBy: arg('by', 'Joanne Teoh'),
    preparedByEmail: arg('email', 'joanne@example.com'),
    preparedByMobile: arg('mobile', '+60 12-345 6789'),
    sequence: Number(arg('seq', '1')),
    revision: Number(arg('rev', '0')),
    coverPhoto: cover && fs.existsSync(cover) ? cover : null,
  });

  if (built.computed.length) {
    console.log('\nWORKED OUT (everything else was typed)');
    built.computed.forEach((l) => console.log(`  ${l}`));
  }
  if (built.notes.length) {
    console.log('\nWORTH KNOWING');
    built.notes.forEach((l) => console.log(`  ${l}`));
  }

  const missing = jt.missingFor('team_building', built.values);
  if (missing.length) console.log(`\nSTILL NEEDED: ${missing.join(', ')}`);

  const res = await tf.fill(template, out, jt.mappingFor('team_building'),
    built.values, { strict: false });

  console.log(`\nWROTE  ${out}`);
  console.log(`  ${res.written.length} targets placed, ${res.photos.length} photograph(s), `
    + `${(res.bytes / 1024 / 1024).toFixed(2)} MB`);
  for (const p of res.photos) {
    const side = p.crop.l ? 'the sides' : 'top and bottom';
    const amount = Math.max(p.crop.l, p.crop.t) / 1000;
    console.log(`  cover: ${p.image.width}x${p.image.height} into `
      + `${p.frame.w.toFixed(2)}x${p.frame.h.toFixed(2)}", `
      + (amount ? `${amount.toFixed(1)}% trimmed off ${side}` : 'no trim needed'));
  }
  if (res.problems.length) {
    console.log('\nPROBLEMS');
    res.problems.forEach((l) => console.log(`  ${l}`));
  }
  if (res.skipped.length) {
    console.log(`\nLEFT AS THE TEMPLATE HAD THEM: ${[...new Set(res.skipped)].join(', ')}`);
  }
  if (res.remaining.length) {
    console.log('\nSTILL A PLACEHOLDER — check these before sending:');
    for (const r of res.remaining) {
      console.log(`  page ${r.slide}  ${JSON.stringify(r.text)}`
        + (r.after ? `  after "${r.after}"` : ''));
    }
  } else {
    console.log('\nNo placeholder left anywhere in the deck.');
  }
  console.log('');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

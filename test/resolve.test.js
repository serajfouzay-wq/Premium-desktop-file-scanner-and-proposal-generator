'use strict';
/* Reading a typed request against the catalog, with no model involved.
   Run with: npm run test:resolve */
const { resolve, describe: explain } = require('../electron/lib/resolve');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

/* A catalog shaped like the client's real one, including the names that are
   genuinely hard: hotels whose names contain their own town, and two Villeas. */
const CATALOG = {
  jobTypes: [
    { id: 'job_tb', name: 'Team Building' },
    { id: 'job_gala', name: 'Annual Dinner' },
    { id: 'job_conf', name: 'Corporate Conference' },
  ],
  locations: [
    { id: 'loc_pd', name: 'Port Dickson' },
    { id: 'loc_mel', name: 'Melaka' },
    { id: 'loc_perak', name: 'Perak' },
    { id: 'loc_jb', name: 'Janda Baik' },
  ],
  hotels: [
    { id: 'h1', name: 'Lexis Hibiscus Port Dickson', location_id: 'loc_pd' },
    { id: 'h2', name: 'Grand Lexis Port Dickson', location_id: 'loc_pd' },
    { id: 'h3', name: 'Thistle Port Dickson Resort', location_id: 'loc_pd' },
    { id: 'h4', name: 'Villea Port Dickson', location_id: 'loc_pd' },
    { id: 'h5', name: 'Courtyard by Marriott Melaka', location_id: 'loc_mel' },
    { id: 'h6', name: 'Weil Hotel Perak', location_id: 'loc_perak' },
    { id: 'h7', name: 'Tiarasa Escapes Glamping Resort Janda Baik', location_id: 'loc_jb' },
  ],
  mcs: [
    { id: 'mc1', name: 'Sera Fouzay' },
    { id: 'mc2', name: 'Farah Nordin' },
    { id: 'mc3', name: 'Hafiz Rahman' },
  ],
  activities: [
    { id: 'a1', name: 'Amazing Race' },
    { id: 'a2', name: 'Culinary Face-Off' },
    { id: 'a3', name: 'Dragon Boat Challenge' },
    { id: 'a4', name: 'Beach Olympics' },
  ],
  venues: [],
};

console.log('\n── the sentence a salesperson would actually type ──');
const r = resolve(
  'Team Building proposal for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, '
  + '14 - 15 March 2026, 2D1N at Lexis Hibiscus Port Dickson, MC Sera Fouzay, '
  + 'activities amazing race and culinary face-off', CATALOG);

explain(r).forEach((l) => console.log('      ' + l));

check('reads the job type', r.jobType && r.jobType.id === 'job_tb', r.jobType && r.jobType.name);
check('reads the client', r.company === 'ABC Sdn Bhd', r.company);
check('reads the person in charge', /Joanne Teoh/.test(r.pic || ''), r.pic);
check('reads the head count', r.pax === 45, String(r.pax));
check('reads the dates', /14 - 15 March 2026/.test(r.dates || ''), r.dates);
check('reads the duration', r.days === 2 && r.nights === 1, `${r.days}D${r.nights}N`);
check('finds the host', r.mc && r.mc.id === 'mc1', r.mc && r.mc.name);
check('finds the hotel', r.hotels.some((h) => h.id === 'h1'), r.hotels.map((h) => h.name).join(', '));
check('does not also claim the other Port Dickson hotels',
  r.hotels.length === 1, r.hotels.map((h) => h.name).join(', '));
check('infers the location from the hotel', r.location && r.location.id === 'loc_pd', r.location && r.location.name);
check('finds both activities',
  r.activities.length === 2 && r.activities.some((a) => a.id === 'a1') && r.activities.some((a) => a.id === 'a2'),
  r.activities.map((a) => a.name).join(', '));
check('does not invent a third activity', !r.activities.some((a) => a.id === 'a3' || a.id === 'a4'));

console.log('\n── the traps ──');

// A town named on its own is a location, not the hotel that shares its name.
const t1 = resolve('team building in Port Dickson for 30 pax', CATALOG);
check('a bare town name is the location, not a hotel',
  t1.location && t1.location.id === 'loc_pd' && t1.hotels.length === 0,
  `location ${t1.location && t1.location.name}, hotels ${t1.hotels.length}`);

// Two hotels sharing most of their name must not be confused.
const t2 = resolve('annual dinner at Grand Lexis Port Dickson, 60 pax', CATALOG);
check('picks the right one of two similar hotels',
  t2.hotels.length === 1 && t2.hotels[0].id === 'h2', t2.hotels.map((h) => h.name).join(', '));

// Several hotels on purpose — the client asked to compare options.
const t3 = resolve('team building, compare Lexis Hibiscus Port Dickson and Villea Port Dickson and Thistle Port Dickson Resort, 40 pax', CATALOG);
check('takes several hotels when several are named', t3.hotels.length === 3,
  t3.hotels.map((h) => h.name).join(', '));

// A first name alone, where only one host has it.
const t4 = resolve('team building 25 pax with MC Hafiz', CATALOG);
check('a first name is enough when only one host has it',
  t4.mc && t4.mc.id === 'mc3', t4.mc && t4.mc.name);

// Something not in the catalog must be reported, not dropped.
const t5 = resolve('team building 30 pax with kayaking and abseiling', CATALOG);
check('an activity that is not in the catalog is reported',
  t5.activities.length === 0 && t5.unrecognised.includes('kayaking'),
  `unrecognised: ${t5.unrecognised.join(', ')}`);

// Nothing recognised at all.
const t6 = resolve('something for next month', CATALOG);
check('an unreadable request resolves to nothing rather than a guess',
  !t6.jobType && !t6.mc && t6.hotels.length === 0 && !t6.company);

console.log('\n── it must refuse to guess ──');
const twins = {
  ...CATALOG,
  mcs: [{ id: 'x1', name: 'Sarah Lim' }, { id: 'x2', name: 'Sarah Tan' }],
};
const t7 = resolve('team building 40 pax with MC Sarah', twins);
check('two hosts matching equally well are reported as ambiguous',
  !t7.mc && t7.ambiguous.some((a) => a.field === 'host' && a.options.length === 2),
  JSON.stringify(t7.ambiguous.map((a) => a.options.map((o) => o.name))));

console.log('\n── number and date forms ──');
for (const [text, want] of [
  ['45 pax', 45], ['group size: 120', 120], ['for 8 participants', 8],
  ['we have 250 people', 250], ['pax 33', 33],
]) {
  const got = resolve(text, CATALOG).pax;
  check(`"${text}" reads as ${want}`, got === want, String(got));
}
for (const [text, d, n] of [
  ['2D1N', 2, 1], ['3D2N programme', 3, 2], ['2 nights', 3, 2], ['1 day event', 1, 0],
]) {
  const got = resolve(text, CATALOG);
  check(`"${text}" reads as ${d}D${n}N`, got.days === d && got.nights === n, `${got.days}D${got.nights}N`);
}
for (const [text, want] of [
  ['14 - 15 March 2026', '14 - 15 March 2026'],
  ['on 9 May', '9 May'],
  ['3rd - 4th December 2026', '3 - 4 December 2026'],
]) {
  const got = resolve(text, CATALOG).dates;
  check(`"${text}" reads the date`, got === want, String(got));
}

console.log('\n── where the company name starts and stops ──');
for (const [text, want] of [
  ['Team Building proposal for ABC Sdn Bhd, 40 pax', 'ABC Sdn Bhd'],
  ['proposal for Petronas Dagangan Berhad', 'Petronas Dagangan Berhad'],
  ['team building at Villea Port Dickson for Maybank Berhad', 'Maybank Berhad'],
  ['quote to Smart Solutions Learning Sdn Bhd please', 'Smart Solutions Learning Sdn Bhd'],
  ['enquiry from Lee & Sons Trading Sdn. Bhd.', 'Lee & Sons Trading Sdn. Bhd.'],
  ['for DHL Supply Chain Malaysia Sdn Bhd, 2D1N', 'DHL Supply Chain Malaysia Sdn Bhd'],
  ['annual dinner for Nestle (Malaysia) Berhad', 'Nestle (Malaysia) Berhad'],
  ['client is Tech Pte Ltd', 'Tech Pte Ltd'],
]) {
  const got = resolve(text, CATALOG).company;
  check(`reads "${want}"`, got === want, String(got));
}
check('no trading suffix means no company claimed',
  resolve('team building for the sales team, 30 pax', CATALOG).company === null);

console.log('\n── the same sentence twice gives the same answer ──');
const sentence = 'Team Building for ABC Sdn Bhd, 45 pax, 2D1N at Grand Lexis Port Dickson, '
  + 'MC Farah Nordin, amazing race and beach olympics';
const runA = JSON.stringify(resolve(sentence, CATALOG));
const runB = JSON.stringify(resolve(sentence, CATALOG));
check('reading is deterministic', runA === runB);

console.log('\n── prices and times the person types ──');
const m1 = resolve('team building for ABC Sdn Bhd, 40 pax at RM 285 per pax, '
  + 'total RM 11,400, deposit RM 3,000', CATALOG);
check('reads the per-pax price',
  m1.money.some((m) => m.amount === 285 && m.currency === 'RM' && m.basis === 'per pax'),
  JSON.stringify(m1.money.map((m) => `${m.text}=${m.basis}`)));
check('reads the total', m1.money.some((m) => m.amount === 11400 && m.basis === 'total'));
check('reads the deposit', m1.money.some((m) => m.amount === 3000 && m.basis === 'deposit'));
check('keeps the figure exactly as typed',
  m1.money.some((m) => m.text === 'RM 11,400'), m1.money.map((m) => m.text).join(' | '));
check('keeps money in cents so arithmetic cannot drift',
  m1.money.every((m) => m.cents === Math.round(m.amount * 100)));

for (const [text, amount, cur] of [
  ['RM1200', 1200, 'RM'], ['RM 1,250.50', 1250.5, 'RM'], ['SGD 500', 500, 'SGD'],
  ['USD 80 per pax', 80, 'USD'], ['1200 ringgit', 1200, 'RM'], ['$95', 95, '$'],
]) {
  const got = resolve(`team building ${text}`, CATALOG).money[0];
  check(`"${text}" reads as ${cur} ${amount}`,
    got && got.amount === amount && got.currency === cur,
    got ? `${got.currency} ${got.amount}` : 'nothing');
}
check('no price typed means no price claimed',
  resolve('team building 40 pax at Villea Port Dickson', CATALOG).money.length === 0);

const t8 = resolve('team building, depart 8:30am, programme 9:00am - 5:30pm, back by 6pm', CATALOG);
check('reads the departure time',
  t8.times.some((x) => x.value === '08:30'), t8.times.map((x) => x.value).join(', '));
check('reads a time window as a range',
  t8.times.some((x) => x.value === '09:00' && x.rangeWith === '17:30'),
  JSON.stringify(t8.times.find((x) => x.value === '09:00')));
check('reads an afternoon hour correctly', t8.times.some((x) => x.value === '18:00'));
for (const [text, want] of [
  ['9.30am', '09:30'], ['0930 hrs', '09:30'], ['12pm', '12:00'],
  ['12am', '00:00'], ['7pm', '19:00'], ['14:45', '14:45'],
]) {
  const got = resolve(`event at ${text}`, CATALOG).times[0];
  check(`"${text}" reads as ${want}`, got && got.value === want, got ? got.value : 'nothing');
}

console.log('\n── two companies in one sentence ──');
const two = resolve('proposal from Smart Solutions Learning Sdn Bhd to Maybank Berhad, 50 pax',
  { ...CATALOG, ownCompany: 'Smart Solutions Learning Sdn Bhd' });
check('the client is the other company, not our own',
  two.company === 'Maybank Berhad', String(two.company));
check('both companies are still reported', two.companies.length === 2, two.companies.join(' | '));
check('it says why it chose that one',
  two.notes.some((n) => /sender/i.test(n)), two.notes.join(' / '));
const two2 = resolve('proposal to Maybank Berhad and CIMB Group Holdings Berhad', CATALOG);
check('two client companies are flagged rather than silently dropped',
  two2.notes.some((n) => /more than one/i.test(n)), two2.notes.join(' / '));

console.log('\n── the whole sentence, the way you described it ──');
const full = resolve(
  'this job is a team building for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, '
  + '14 - 15 March 2026, 2D1N at Lexis Hibiscus Port Dickson, MC is Sera Fouzay, '
  + 'activities amazing race, culinary face-off and dragon boat challenge, '
  + 'price RM 285 per pax, total RM 12,825, depart 8:30am back 6pm',
  { ...CATALOG, ownCompany: 'Smart Solutions Learning Sdn Bhd' });
explain(full).forEach((l) => console.log('      ' + l));
check('every piece of that sentence was understood',
  full.jobType && full.company === 'ABC Sdn Bhd' && /Joanne/.test(full.pic)
  && full.pax === 45 && full.days === 2 && full.nights === 1 && full.dates
  && full.hotels.length === 1 && full.location && full.mc
  && full.activities.length === 3 && full.money.length === 2 && full.times.length === 2);
check('and nothing was left unexplained', full.ambiguous.length === 0,
  JSON.stringify(full.ambiguous));

console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

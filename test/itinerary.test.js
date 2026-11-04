'use strict';
/* The programme timetable: built from the request, measured against the
   client's own four state decks. Run with: npm run test:itinerary */
const it = require('../electron/lib/itinerary');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

const ACTS = ['Amazing Race', 'Beach Olympics', 'Culinary Face-Off',
  'Dragon Boat', 'Treasure Hunt'].map((name) => ({ name }));
const two = (journey, activities = ACTS) =>
  it.build({ days: 2, nights: 1, activities }, { journeyMinutes: journey });

console.log('\n── the clock, written the way their decks write it ──');
for (const [m, want] of [[0, '12.00am'], [570, '9.30am'], [720, '12.00pm'],
  [810, '1.30pm'], [1290, '9.30pm'], [450, '7.30am']]) {
  check(`${m} minutes is ${want}`, it.clock(m) === want, it.clock(m));
}

console.log('\n── the two travel times, against the four real decks ──');
/* From the decks: arrival is always 9.30am and departure always 1.30pm, so
   both variable times follow from the journey alone. */
for (const [state, journey, depart, back] of [
  ['Janda Baik', 120, '7.30am', '3.30pm'],
  ['Melaka', 150, '7.00am', '4.00pm'],
  ['Perak', 150, '7.00am', '4.00pm'],
  ['Port Dickson', 120, '7.30am', '3.30pm'],
]) {
  const r = two(journey);
  check(`${state}: leaves ${depart}, back ${back}`,
    r.departOffice === depart && r.arriveBack === back,
    `${r.departOffice} / ${r.arriveBack}`);
}

console.log('\n── one number per city is the whole difference ──');
const pd = it.asRows(two(120));
const mel = it.asRows(two(150));
const same = pd.filter((r, i) => JSON.stringify(r) === JSON.stringify(mel[i])).length;
check('only the two travel rows differ between cities', same === pd.length - 2,
  `${same} of ${pd.length} rows identical`);
check('arrival at the hotel is 9.30am in both',
  pd.some((r) => r[0] === '9.30am') && mel.some((r) => r[0] === '9.30am'));

console.log('\n── the shape of the thing ──');
const r2 = two(120);
check('a 2D1N programme has two days', r2.days.length === 2);
check('day one has a header and twelve rows', r2.days[0].rows.length === 12,
  `${r2.days[0].rows.length}`);
check('day two has nine', r2.days[1].rows.length === 9, `${r2.days[1].rows.length}`);
check('the table is two columns throughout',
  it.asRows(r2).every((row) => row.length === 2));
check('each day is headed TIME and a day number',
  it.asRows(r2).filter((row) => row[0] === 'TIME').length === 2);
check('times run forward within every day',
  r2.days.every((d) => d.rows.every((row, i) => i === 0
    || row.minutes >= d.rows[i - 1].minutes)));
check('no row is repeated within a day',
  r2.days.every((d) => new Set(d.rows.map((x) => x.text)).size === d.rows.length));

console.log('\n── the activities, in the order they were asked for ──');
const named = it.asRows(two(120)).map((r) => r[1]);
check('all five slots carry the named activities',
  ['AMAZING RACE', 'BEACH OLYMPICS', 'CULINARY FACE-OFF', 'DRAGON BOAT', 'TREASURE HUNT']
    .every((a) => named.some((x) => x.startsWith(a))));
const order = named.filter((x) => /^(AMAZING|BEACH|CULINARY|DRAGON|TREASURE)/.test(x))
  .map((x) => x.split('\n')[0]);
check('and in that order', order.join(' | ')
  === 'AMAZING RACE | BEACH OLYMPICS | CULINARY FACE-OFF | DRAGON BOAT | TREASURE HUNT',
  order.join(' | '));
check('the day-two slot keeps its reflection line',
  named.some((x) => /DRAGON BOAT\nReflection on Day 1 Learning/.test(x)));

console.log('\n── fewer activities than slots ──');
const three = two(120, ACTS.slice(0, 3));
const threeRows = it.asRows(three).map((r) => r[1]);
check('no slot is left reading "ACTIVITY 4"',
  !threeRows.some((x) => /ACTIVITY \d/.test(x)),
  threeRows.filter((x) => /ACTIVITY/.test(x)).join(', ') || 'none');
check('and it says how many slots were filled',
  three.notes.some((n) => /3 of 5 activity slots/.test(n)),
  three.notes.join(' / '));
const many = two(120, [...ACTS, { name: 'Extra One' }, { name: 'Extra Two' }]);
check('more activities than slots is reported, not silently dropped',
  many.notes.some((n) => /not in the itinerary/.test(n)), many.notes.join(' / '));

console.log('\n── a single day ──');
const one = it.build({ days: 1, nights: 0, activities: ACTS.slice(0, 2) },
  { journeyMinutes: 120 });
check('has one day', one.days.length === 1);
check('nobody checks in', !it.asRows(one).some((r) => /Check in/.test(r[1])));
check('and nobody has dinner at the hotel',
  !it.asRows(one).some((r) => /Buffet Dinner/.test(r[1])));
check('the bus home leaves after the programme ends, not before',
  one.days[0].rows.every((row, i) => i === 0 || row.minutes >= one.days[0].rows[i - 1].minutes),
  it.asRows(one).slice(-3).map((r) => r[0]).join(' -> '));
const back = one.days[0].rows[one.days[0].rows.length - 1];
const leave = one.days[0].rows[one.days[0].rows.length - 2];
check('and arrives two hours after it leaves', back.minutes - leave.minutes === 120,
  `${leave.time} -> ${back.time}`);

console.log('\n── no journey time stored ──');
const guessed = it.build({ days: 2, nights: 1, activities: ACTS }, {});
check('two hours is assumed', guessed.journeyMinutes === it.DEFAULT_JOURNEY);
check('and the deck says so rather than passing it off as known',
  guessed.notes.some((n) => /No journey time is stored/.test(n)),
  guessed.notes[0]);

console.log('\n── it is the same every time ──');
check('the same request gives the same itinerary',
  JSON.stringify(two(120)) === JSON.stringify(two(120)));

console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

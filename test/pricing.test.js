'use strict';
/* Money has to be exactly right, so the arithmetic is checked on its own.
   Run with: npm run test:pricing */
const { calculate, validate } = require('../electron/lib/pricing');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};
const close = (a, b) => Math.abs(a - b) < 0.005;

const sel = {
  pax: 50, nights: 2, days: 3,
  hotel: { name: 'The Grand Bintang' },
  room: { tier: 'Deluxe King', occupancy: 2, nightly_rate: 420 },
  mc: { name: 'Farah Nordin', headline: 'Host', day_rate: 4800 },
  activities: [
    { name: 'Amazing Race', rate_type: 'per_head', rate: 185, pax_min: 20, pax_max: 200 },
    { name: 'Awards Night', rate_type: 'flat', rate: 18500, pax_min: 50, pax_max: 600 },
  ],
  logistics: [{ name: 'Line Array', spec: '12kW', rate_type: 'per_day', rate: 6800 }],
};

const q = calculate(sel, { serviceChargePct: 10, taxPct: 8, marginPct: 0 });

// 50 pax at 2 per room = 25 rooms, 2 nights = 50 room-nights at 420
check('rooms follow occupancy, not head count',
  q.lines.find((l) => l.group === 'Accommodation').qty === 50,
  String(q.lines.find((l) => l.group === 'Accommodation').qty));
check('accommodation total', close(q.lines.find((l) => l.group === 'Accommodation').amount, 21000));
check('host is charged per day', close(q.lines.find((l) => l.group === 'Host').amount, 14400));
check('per-head activity scales with pax', close(q.lines.find((l) => l.description === 'Amazing Race').amount, 9250));
check('flat activity does not scale', close(q.lines.find((l) => l.description === 'Awards Night').amount, 18500));
check('per-day logistics scales with days', close(q.lines.find((l) => l.group === 'Production').amount, 20400));

const expectedSub = 21000 + 14400 + 9250 + 18500 + 20400;
check('subtotal is the sum of the lines', close(q.subtotal, expectedSub), `${q.subtotal} vs ${expectedSub}`);

const expectedService = expectedSub * 0.10;
const expectedTax = (expectedSub + expectedService) * 0.08;
check('service charge applies to the subtotal', close(q.serviceCharge, expectedService));
check('tax applies after service charge', close(q.tax, expectedTax));
check('total is subtotal plus service plus tax',
  close(q.total, expectedSub + expectedService + expectedTax), String(q.total));

// The displayed lines must add up to the displayed total, to the cent.
const lineSum = q.lines.reduce((a, l) => a + l.amount, 0);
check('no cent drifts between the lines and the subtotal', close(lineSum, q.subtotal),
  `${lineSum.toFixed(2)} vs ${q.subtotal.toFixed(2)}`);

const groupSum = q.groups.reduce((a, g) => a + g.subtotal, 0);
check('group subtotals reconcile to the subtotal', close(groupSum, q.subtotal));

check('per-pax figure divides the total', close(q.perPax * q.pax, q.total, 0.5) || Math.abs(q.perPax * q.pax - q.total) < 1,
  `${q.perPax} x ${q.pax} = ${(q.perPax * q.pax).toFixed(2)} vs ${q.total.toFixed(2)}`);

// Margin goes in before service charge and tax, or the agency is taxed on it twice.
const withMargin = calculate(sel, { serviceChargePct: 10, taxPct: 8, marginPct: 15 });
check('margin lifts the subtotal before service and tax',
  close(withMargin.margin, expectedSub * 0.15)
  && withMargin.total > q.total, `${withMargin.margin} / ${withMargin.total}`);

// Repeatability is the whole premise of a deterministic engine.
const again = calculate(sel, { serviceChargePct: 10, taxPct: 8, marginPct: 0 });
check('the same selections always give the same total', again.total === q.total);

const zero = calculate({ pax: 0, nights: 0, days: 1, activities: [], logistics: [] }, {});
check('an empty selection totals zero, not NaN', zero.total === 0 && zero.lines.length === 0);

const warn = validate({ pax: 8, activities: [{ name: 'Dragon Boat', pax_min: 24, pax_max: 120 }], nights: 0 });
check('warns when a group is under an activity minimum', warn.some((w) => /at least 24/.test(w)), warn.join(' | '));

console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

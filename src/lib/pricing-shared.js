/* GENERATED from electron/lib/pricing.js by scripts/build-shared.js.
   Do not edit — edit the source and run `npm run build:shared`. */
/*
 * Deterministic pricing.
 *
 * Every figure in the deck comes from here, and nothing here is generated or
 * estimated: each line is a catalog rate multiplied by a quantity the user
 * chose. The same selections always produce the same total, which is what
 * makes the output a quotation rather than a draft.
 *
 * Money is handled in cents throughout. Accumulating 0.1 + 0.2 in floats and
 * rounding at the end is how a total ends up a cent away from the sum of its
 * own lines on the page.
 */

const toCents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents) => cents / 100;

const DEFAULTS = {
  serviceChargePct: 10,   // Malaysian hospitality standard
  taxPct: 8,              // SST on services
  marginPct: 0,           // agency margin, applied before service and tax
  rounding: 'none',       // none | nearest_10 | nearest_100
};

/**
 * @param {object} sel   the wizard's selections
 * @param {object} rates { serviceChargePct, taxPct, marginPct, rounding }
 * @returns a fully itemised quotation
 */
function calculate(sel, rates = {}) {
  const cfg = { ...DEFAULTS, ...rates };
  const pax = Math.max(0, Math.floor(Number(sel.pax) || 0));
  const nights = Math.max(0, Math.floor(Number(sel.nights) || 0));
  const days = Math.max(1, Math.floor(Number(sel.days) || 1));

  const lines = [];
  /* Two prices travel together: what the item costs us and what the client is
     shown. Only the client price is ever rendered into a deck — the cost and
     the margin exist so the person quoting can see the shape of the job before
     they send it. */
  const push = (group, description, detail, qty, unit, unitCents, costCents = 0) => {
    if (!qty || !unitCents) return;
    lines.push({
      group, description, detail, qty, unit,
      unitPrice: fromCents(unitCents),
      amount: fromCents(unitCents * qty),
      amountCents: unitCents * qty,
      unitCost: fromCents(costCents),
      costAmount: fromCents(costCents * qty),
      costCents: costCents * qty,
    });
  };

  /* Accommodation — rooms are sold by the night, and a room sleeps more than
     one person, so the count follows occupancy rather than head count. */
  if (sel.hotel && sel.room && nights > 0 && pax > 0) {
    const occupancy = Math.max(1, Number(sel.room.occupancy) || 2);
    const rooms = Number(sel.roomsOverride) > 0
      ? Math.floor(Number(sel.roomsOverride))
      : Math.ceil(pax / occupancy);
    push('Accommodation', `${sel.hotel.name} — ${sel.room.tier}`,
      `${rooms} room${rooms === 1 ? '' : 's'} at ${occupancy} per room, ${nights} night${nights === 1 ? '' : 's'}`,
      rooms * nights, 'room-night', toCents(sel.room.nightly_rate), toCents(sel.room.cost_price));
  }

  if (sel.mc) {
    push('Host', sel.mc.name, sel.mc.headline, days, 'day', toCents(sel.mc.day_rate), toCents(sel.mc.cost_price));
  }

  for (const a of sel.activities || []) {
    const perHead = a.rate_type === 'per_head';
    push('Activities', a.name,
      perHead ? `${pax} pax at ${money(a.rate)} per person` : 'Flat rate for the group',
      perHead ? pax : 1, perHead ? 'pax' : 'package', toCents(a.rate), toCents(a.cost_price));
  }

  for (const l of sel.logistics || []) {
    const qty = l.rate_type === 'per_day' ? days : l.rate_type === 'per_head' ? pax : 1;
    const unit = l.rate_type === 'per_day' ? 'day' : l.rate_type === 'per_head' ? 'pax' : 'package';
    push('Production', l.name, l.spec, qty, unit, toCents(l.rate), toCents(l.cost_price));
  }

  if (sel.venue) {
    const qty = sel.venue.rate_type === 'per_day' ? days : 1;
    push('Venue', sel.venue.name, sel.venue.description, qty,
      sel.venue.rate_type === 'per_day' ? 'day' : 'package',
      toCents(sel.venue.client_price), toCents(sel.venue.cost_price));
  }

  for (const c of sel.custom || []) {
    push('Additional', c.description, c.detail || '', Number(c.qty) || 1, c.unit || 'item',
      toCents(c.unitPrice), toCents(c.unitCost));
  }

  const subtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  const marginCents = Math.round(subtotalCents * (cfg.marginPct / 100));
  const netCents = subtotalCents + marginCents;
  const serviceCents = Math.round(netCents * (cfg.serviceChargePct / 100));
  const taxableCents = netCents + serviceCents;
  const taxCents = Math.round(taxableCents * (cfg.taxPct / 100));
  let totalCents = taxableCents + taxCents;

  if (cfg.rounding === 'nearest_10') totalCents = Math.round(totalCents / 1000) * 1000;
  if (cfg.rounding === 'nearest_100') totalCents = Math.round(totalCents / 10000) * 10000;

  const groups = [];
  for (const l of lines) {
    let g = groups.find((x) => x.name === l.group);
    if (!g) { g = { name: l.group, lines: [], subtotal: 0, subtotalCents: 0, costCents: 0, cost: 0 }; groups.push(g); }
    g.lines.push(l);
    g.subtotalCents += l.amountCents;
    g.subtotal = fromCents(g.subtotalCents);
    g.costCents += l.costCents;
    g.cost = fromCents(g.costCents);
  }

  /* The internal view. Kept in its own object so that handing the client-facing
     quote to the deck builder cannot carry cost with it by accident. */
  const totalCostCents = lines.reduce((a, l) => a + l.costCents, 0);
  const grossMarginCents = subtotalCents - totalCostCents;
  const internal = {
    totalCost: fromCents(totalCostCents),
    grossMargin: fromCents(grossMarginCents),
    grossMarginPct: subtotalCents > 0 ? Math.round((grossMarginCents / subtotalCents) * 1000) / 10 : 0,
    costedLines: lines.filter((l) => l.costCents > 0).length,
    uncostedLines: lines.filter((l) => !l.costCents).length,
  };

  return {
    pax, nights, days,
    lines, groups,
    subtotal: fromCents(subtotalCents),
    margin: fromCents(marginCents),
    marginPct: cfg.marginPct,
    serviceCharge: fromCents(serviceCents),
    serviceChargePct: cfg.serviceChargePct,
    tax: fromCents(taxCents),
    taxPct: cfg.taxPct,
    total: fromCents(totalCents),
    internal,
    perPax: pax > 0 ? fromCents(Math.round(totalCents / pax)) : 0,
    rounding: cfg.rounding,
  };
}

const money = (n, currency = 'RM ') => currency + (Number(n) || 0)
  .toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* A selection can be arithmetically valid and still be wrong — an activity
   with a minimum of twenty people booked for eight. These are warnings for the
   user, not errors: they may know something the catalog does not. */
function validate(sel) {
  const warnings = [];
  const pax = Number(sel.pax) || 0;

  if (!pax) warnings.push('No head count set, so per-person lines cannot be priced.');
  for (const a of sel.activities || []) {
    if (a.pax_min && pax && pax < a.pax_min) {
      warnings.push(`${a.name} normally needs at least ${a.pax_min} people — ${pax} selected.`);
    }
    if (a.pax_max && pax > a.pax_max) {
      warnings.push(`${a.name} caps at ${a.pax_max} people — ${pax} selected. It may need two runs.`);
    }
  }
  if (sel.hotel && sel.room && !Number(sel.nights)) {
    warnings.push('A hotel is selected but the number of nights is zero, so no accommodation is priced.');
  }
  return warnings;
}

/* The deck renders from this and nothing else. Stripping cost here rather than
   trusting every call site means a new slide cannot leak a buy price onto a
   page the client reads. */
function clientFacing(quote) {
  const strip = (l) => {
    const { unitCost, costAmount, costCents, ...rest } = l;
    return rest;
  };
  const { internal, ...rest } = quote;
  return {
    ...rest,
    lines: quote.lines.map(strip),
    groups: quote.groups.map((g) => {
      const { cost, costCents, ...gr } = g;
      return { ...gr, lines: g.lines.map(strip) };
    }),
  };
}

export { calculate, validate, money, toCents, fromCents, DEFAULTS };

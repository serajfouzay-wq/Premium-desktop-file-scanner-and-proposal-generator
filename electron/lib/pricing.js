'use strict';

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
  const push = (group, description, detail, qty, unit, unitCents) => {
    if (!qty || !unitCents) return;
    lines.push({
      group, description, detail, qty, unit,
      unitPrice: fromCents(unitCents),
      amount: fromCents(unitCents * qty),
      amountCents: unitCents * qty,
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
      rooms * nights, 'room-night', toCents(sel.room.nightly_rate));
  }

  if (sel.mc) {
    push('Host', sel.mc.name, sel.mc.headline, days, 'day', toCents(sel.mc.day_rate));
  }

  for (const a of sel.activities || []) {
    const perHead = a.rate_type === 'per_head';
    push('Activities', a.name,
      perHead ? `${pax} pax at ${money(a.rate)} per person` : 'Flat rate for the group',
      perHead ? pax : 1, perHead ? 'pax' : 'package', toCents(a.rate));
  }

  for (const l of sel.logistics || []) {
    const qty = l.rate_type === 'per_day' ? days : l.rate_type === 'per_head' ? pax : 1;
    const unit = l.rate_type === 'per_day' ? 'day' : l.rate_type === 'per_head' ? 'pax' : 'package';
    push('Production', l.name, l.spec, qty, unit, toCents(l.rate));
  }

  for (const c of sel.custom || []) {
    push('Additional', c.description, c.detail || '', Number(c.qty) || 1, c.unit || 'item', toCents(c.unitPrice));
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
    if (!g) { g = { name: l.group, lines: [], subtotal: 0, subtotalCents: 0 }; groups.push(g); }
    g.lines.push(l);
    g.subtotalCents += l.amountCents;
    g.subtotal = fromCents(g.subtotalCents);
  }

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

module.exports = { calculate, validate, money, toCents, fromCents, DEFAULTS };

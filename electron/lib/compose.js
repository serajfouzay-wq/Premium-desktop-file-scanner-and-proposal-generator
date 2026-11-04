'use strict';
/* ───────────────────────── compose ─────────────────────────
   Turns what a person typed, plus what the catalog holds, into the field
   values a template mapping expects. This is the only place where a fact
   becomes a string destined for a slide, so the rules live here:

     - A figure is never invented. Money reaches a slide only because somebody
       typed it or the catalog holds it. Where the template itself defines an
       arithmetic step ("+ 8% SALES & SERVICE TAX"), that step is applied to a
       figure we were given and recorded in `computed`, so the person can see
       which numbers are theirs and which the engine worked out.
     - A field we cannot fill is left out rather than filled with something
       plausible. The template then keeps its own placeholder, and the field
       is named in `missing`, which is far easier to spot than a wrong number.
     - Nothing is rounded on the way through: money is held in cents. */

const pricing = require('./pricing');
const itinerary = require('./itinerary');

const pad2 = (n) => String(n).padStart(2, '0');

/* ── where a price comes from ──
   The catalog is the normal source: the rates are already stored against the
   hotel, the host and each activity, so nobody should have to retype them. A
   figure typed into the request overrides the catalog for that one item, which
   is how a one-off discount or a rate the client negotiated gets in.

   Costs never reach this function's output. pricing.calculate carries what an
   item costs us alongside what the client is shown, and only the client side
   is ever read here; the cost lives on in the quote for the person quoting. */

/** The client-facing total of one group of catalog selections, in cents. */
function itemCents(selection, resolved, rates = {}) {
  if (!selection) return null;
  const quote = pricing.calculate(
    {
      ...selection,
      pax: resolved.pax,
      nights: resolved.nights,
      days: resolved.days,
    },
    /* Service charge and tax are applied by the template, not per item, and
       rounding here would make the parts disagree with the total. */
    { ...rates, serviceChargePct: 0, taxPct: 0, rounding: 'none' },
  );
  if (!quote.lines.length) return null;
  return { cents: pricing.toCents(quote.total), quote };
}

/** 2 significant words of a company name, for a reference number. */
function abbreviate(company) {
  if (!company) return 'CLIENT';
  const skip = new Set(['sdn', 'bhd', 'berhad', 'pte', 'ltd', 'limited', 'llc', 'inc',
    'corp', 'corporation', 'gmbh', 'plc', 'llp', 'the', 'and', 'of']);
  const words = String(company).replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()));
  if (!words.length) return 'CLIENT';
  /* An acronym already in the name is the best abbreviation there is. */
  const acronym = words.find((w) => w.length >= 2 && w === w.toUpperCase());
  if (acronym) return acronym.slice(0, 8).toUpperCase();
  return words.slice(0, 2).map((w) => w.slice(0, 4)).join('').toUpperCase();
}

/**
 * The client's reference scheme: SSL / company / month / year / running number.
 * The running number is the caller's to supply, because only the store knows
 * how many proposals this client has already had; a revision is suffixed
 * rather than overwriting, so an earlier version stays findable.
 */
function reference({ company, date = new Date(), sequence = 1, revision = 0, prefix = 'SSL' }) {
  const d = date instanceof Date ? date : new Date(date);
  const base = [
    prefix,
    abbreviate(company),
    pad2(d.getMonth() + 1),
    d.getFullYear(),
    String(sequence).padStart(3, '0'),
  ].join('/');
  return revision > 0 ? `${base}-R${revision}` : base;
}

const money = (cents, currency = 'RM') => {
  const n = (cents / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return currency === 'RM' ? n : `${currency} ${n}`;
};

/** "2D1N" and "14 - 15 March 2026" joined the way the template reads. */
function programLine(resolved) {
  const parts = [];
  if (resolved.dates) parts.push(resolved.dates);
  if (resolved.days) parts.push(`${resolved.days}D${resolved.nights || 0}N`);
  return parts.join('  |  ') || null;
}


/* ───────── photographs ─────────
   Every record in the catalog can carry pictures, so a request that names a
   hotel, an event hall, a host and three activities already knows which
   pictures belong in the deck. Gathering them is a lookup, not a judgement:
   the caller supplies `lookup(type, id)` returning the stored paths for that
   record, in the order somebody put them in, and they are used in the order
   the request named the records.

   Page 5 is "Program Venue & Photo" and page 7 is "Activity Detail", so the
   venue and the hall go on 5 and the activities on 7. The host no longer
   joins them: the engine now creates a page of their own after the venue, so
   putting their photograph among the venue's would show it twice. */

const MAX_PER_PAGE = 6;

/**
 * @param {object}   resolved  from resolve()
 * @param {function} lookup    (type, id) => string[]  paths held for a record
 * @param {object}   opts      { perActivity = 2, max = 6, includeHost = false }
 */
function gatherPhotos(resolved, lookup, opts = {}) {
  const max = opts.max || MAX_PER_PAGE;
  const perActivity = opts.perActivity != null ? opts.perActivity : 2;
  const get = (type, id) => {
    try {
      const got = lookup ? lookup(type, id) : null;
      return Array.isArray(got) ? got.filter(Boolean) : (got ? [got] : []);
    } catch {
      return [];
    }
  };

  const missing = [];
  const note = (kind, name) => missing.push(`${kind}: ${name}`);

  /* Page 5 — the venue, then the hall, then the host. */
  const venue = [];
  for (const h of resolved.hotels || []) {
    const got = get('hotel', h.id);
    if (!got.length) note('hotel', h.name);
    venue.push(...got);
  }
  for (const v of resolved.venues || []) {
    const got = get('venue', v.id);
    if (!got.length) note('event hall', v.name);
    venue.push(...got);
  }
  /* The host has their own page now, so they are only added here if a caller
     explicitly asks for it. */
  if (opts.includeHost === true && resolved.mc) {
    const got = get('mc', resolved.mc.id);
    if (!got.length) note('host', resolved.mc.name);
    venue.push(...got.slice(0, 1));
  }

  /* Page 7 — the activities, in the order they were asked for, so the page
     reads in the same order as the itinerary. */
  const activity = [];
  for (const a of resolved.activities || []) {
    const got = get('activity', a.id);
    if (!got.length) note('activity', a.name);
    activity.push(...got.slice(0, perActivity));
  }

  const trim = (list) => [...new Set(list)].slice(0, max);
  return {
    venuePhotos: trim(venue),
    activityPhotos: trim(activity),
    /* The cover takes the venue's own first picture, which is the photograph
       the client is being sold on. */
    coverPhoto: venue[0] || activity[0] || null,
    missing,
  };
}

/**
 * @param {object} resolved  from resolve()
 * @param {object} opts      { sequence, revision, preparedBy, preparedByEmail,
 *                             preparedByMobile, taxPct, coverPhoto, now,
 *                             transportIncluded, selections, rates,
 *                             photoLookup, photoOptions }
 *
 * `selections` groups catalog records the way the template groups money:
 *   { programme: { mc, activities, logistics },
 *     venue:     { hotel, room, venue },
 *     transport: { logistics: [...] } }
 * Anything left out is simply not priced, and the template keeps its own
 * placeholder there rather than being given a number nobody chose.
 */
function compose(resolved, opts = {}) {
  const values = {};
  const computed = [];
  const notes = [];

  const taxPct = opts.taxPct != null ? opts.taxPct : 8;

  if (resolved.company) values.company = resolved.company;
  if (resolved.pic) values.attention = resolved.pic;
  if (resolved.pax != null) values.groupSize = `${resolved.pax} pax`;
  if (resolved.days != null) values.days = String(resolved.days);
  if (opts.preparedBy) values.preparedBy = opts.preparedBy;
  if (opts.preparedByEmail) values.preparedByEmail = opts.preparedByEmail;
  if (opts.preparedByMobile) values.preparedByMobile = opts.preparedByMobile;

  const line = programLine(resolved);
  if (line) { values.programDate = line; values.programDateDuration = line; }

  values.reference = reference({
    company: resolved.company,
    date: opts.now || new Date(),
    sequence: opts.sequence || 1,
    revision: opts.revision || 0,
  });

  /* ── money ──
     The template's own arithmetic, printed on its pages:
         (A)+(B) programme     the host, the activities, coordination
         + 8% sales and service tax
         = TOTAL FOR ITEM A + B                                  page 8
         (C) hotel, meals, meeting room                          page 9
         (D) transportation                                      page 9
         = GRAND TOTAL A + B + C + D                      pages 9 and 12

     Each item is priced from the catalog, because the rates are already
     stored there. A figure in the typed request overrides the catalog for that
     item and the override is recorded, so it is obvious later which numbers
     came from the database and which somebody set by hand. */
  const typed = resolved.money || [];
  const notVenue = (m) => m.subject !== 'hotel' && m.subject !== 'transport';
  const typedPerPax = typed.find((m) => m.basis === 'per pax' && notVenue(m));
  const typedTotal = typed.find((m) => m.basis === 'total' && notVenue(m));
  const typedVenue = typed.find((m) => m.subject === 'hotel');
  const typedTransport = typed.find((m) => m.subject === 'transport');
  const currency = (typedPerPax || typedTotal || typedVenue || {}).currency || 'RM';

  const sel = opts.selections || {};
  const rates = opts.rates || {};
  const fromCatalog = {
    programme: itemCents(sel.programme, resolved, rates),
    venue: itemCents(sel.venue, resolved, rates),
    transport: itemCents(sel.transport, resolved, rates),
  };

  /* (A)+(B), before tax. */
  let feeCents = null;
  if (typedPerPax && resolved.pax) {
    feeCents = typedPerPax.cents * resolved.pax;
    values.programUnit = `${resolved.pax} pax`;
    values.programUnitPrice = money(typedPerPax.cents, currency);
    values.rateNote = `RM ${money(typedPerPax.cents, 'RM')}`;
    computed.push(`programme fee = ${money(typedPerPax.cents, currency)} x ${resolved.pax} pax `
      + `= ${money(feeCents, currency)}  (rate typed into the request)`);
    if (fromCatalog.programme && fromCatalog.programme.cents !== feeCents) {
      notes.push(`The typed rate gives ${money(feeCents, currency)} for the programme, where `
        + `the catalog gives ${money(fromCatalog.programme.cents, currency)}. The typed rate `
        + 'is used.');
    }
  } else if (typedPerPax && !resolved.pax) {
    notes.push('A per-pax rate was given but no head count, so no line total was worked out.');
  } else if (fromCatalog.programme) {
    feeCents = fromCatalog.programme.cents;
    if (resolved.pax) {
      const per = Math.round(feeCents / resolved.pax);
      values.programUnit = `${resolved.pax} pax`;
      values.programUnitPrice = money(per, currency);
      values.rateNote = `RM ${money(per, 'RM')}`;
      computed.push(`programme fee ${money(feeCents, currency)} from the catalog `
        + `(${fromCatalog.programme.quote.lines.length} item(s)), which is `
        + `${money(per, currency)} per pax across ${resolved.pax}`);
    } else {
      values.programUnit = '1';
      values.programUnitPrice = money(feeCents, currency);
      computed.push(`programme fee ${money(feeCents, currency)} from the catalog`);
    }
  }
  if (feeCents != null) values.programTotal = money(feeCents, currency);

  /* Tax, then the page 8 total. */
  let abCents = null;
  if (feeCents != null) {
    const tax = Math.round(feeCents * (taxPct / 100));
    values.salesTax = money(tax, currency);
    abCents = feeCents + tax;
    computed.push(`sales tax = ${taxPct}% of ${money(feeCents, currency)} = ${money(tax, currency)}`);
    computed.push(`total for item A + B = ${money(abCents, currency)}`);
  }
  if (typedTotal) {
    if (abCents != null && typedTotal.cents !== abCents) {
      notes.push(`The stated total (${money(typedTotal.cents, currency)}) differs from the figure `
        + `worked out with tax (${money(abCents, currency)}). The stated total is used.`);
    }
    abCents = typedTotal.cents;
    computed.push(`total for item A + B = ${money(abCents, currency)}  (stated in the request)`);
  }
  if (abCents != null) values.totalAB = money(abCents, currency);

  /* (C) the hotel. */
  let venueCents = null;
  if (typedVenue) {
    if (typedVenue.basis === 'per pax' && resolved.pax) {
      venueCents = typedVenue.cents * resolved.pax;
      values.venueUnit = `${resolved.pax} pax`;
      values.venueUnitPrice = money(typedVenue.cents, currency);
      computed.push(`hotel = ${money(typedVenue.cents, currency)} x ${resolved.pax} pax `
        + `= ${money(venueCents, currency)}  (rate typed into the request)`);
    } else {
      venueCents = typedVenue.cents;
      values.venueUnit = '1';
      values.venueUnitPrice = money(venueCents, currency);
      computed.push(`hotel = ${money(venueCents, currency)}  (typed into the request)`);
    }
  } else if (fromCatalog.venue) {
    venueCents = fromCatalog.venue.cents;
    const per = resolved.pax ? Math.round(venueCents / resolved.pax) : venueCents;
    values.venueUnit = resolved.pax ? `${resolved.pax} pax` : '1';
    values.venueUnitPrice = money(per, currency);
    computed.push(`hotel ${money(venueCents, currency)} from the catalog `
      + `(${fromCatalog.venue.quote.lines.length} item(s))`);
  }
  if (venueCents != null) values.venueTotal = money(venueCents, currency);

  /* (D) the coach. The template prints "FREE" against it, so unless a figure
     is given its line total is the zero the template itself states. */
  let transportCents = null;
  if (typedTransport) {
    transportCents = typedTransport.basis === 'per pax' && resolved.pax
      ? typedTransport.cents * resolved.pax : typedTransport.cents;
    computed.push(`transport = ${money(transportCents, currency)}  (typed into the request)`);
  } else if (fromCatalog.transport) {
    transportCents = fromCatalog.transport.cents;
    computed.push(`transport ${money(transportCents, currency)} from the catalog`);
  } else if (opts.transportIncluded !== false) {
    transportCents = 0;
  }
  if (transportCents != null) values.transportTotal = money(transportCents, currency);

  if (abCents != null || venueCents != null) {
    const grand = (abCents || 0) + (venueCents || 0) + (transportCents || 0);
    values.grandTotal = money(grand, currency);
    computed.push('grand total A + B + C + D = '
      + [abCents != null ? `${money(abCents, currency)} (A+B)` : null,
        venueCents != null ? `${money(venueCents, currency)} (C)` : null,
        transportCents ? `${money(transportCents, currency)} (D)` : 'nil (D, the coach is free)',
      ].filter(Boolean).join(' + ')
      + ` = ${money(grand, currency)}`);
    if (venueCents == null) {
      notes.push('No hotel price was given and none is in the catalog for this request, so the '
        + 'grand total covers the programme only. Page 9 keeps its own placeholders.');
    }
  }

  if (resolved.pax != null) values.capacityNote = `${resolved.pax} participants`;

  if (!typed.length && !fromCatalog.programme && !fromCatalog.venue) {
    notes.push('No price was typed and none was found in the catalog, so every price on pages '
      + '8, 9 and 12 is left as the template has it. The engine does not invent a figure.');
  }

  /* Photographs, either handed in directly or gathered from the catalog. */
  if (opts.photoLookup) {
    const got = gatherPhotos(resolved, opts.photoLookup, opts.photoOptions);
    if (got.venuePhotos.length) values.venuePhotos = got.venuePhotos;
    if (got.activityPhotos.length) values.activityPhotos = got.activityPhotos;
    if (got.coverPhoto && !opts.coverPhoto) values.coverPhoto = got.coverPhoto;
    for (const m of got.missing) {
      notes.push(`No picture is stored for ${m}, so nothing was placed for it.`);
    }
    if (!got.venuePhotos.length && (resolved.hotels || []).length) {
      notes.push('Page 5 has no photographs because none of the venues named have '
        + 'pictures in the catalog yet.');
    }
  }
  if (opts.venuePhotos) values.venuePhotos = opts.venuePhotos;
  if (opts.activityPhotos) values.activityPhotos = opts.activityPhotos;
  /* ── the itinerary ──
     Built from the request rather than stored per city: the journey time is
     the only figure that varies, and both bus times follow from it. */
  if (opts.itinerary !== false) {
    const plan = itinerary.build(resolved, { journeyMinutes: opts.journeyMinutes });
    values.itineraryRows = itinerary.asRows(plan);
    values.departOffice = plan.departOffice;
    values.arriveBack = plan.arriveBack;
    computed.push(`bus leaves the office at ${plan.departOffice} and is back at `
      + `${plan.arriveBack} (9.30am arrival, 1.30pm departure, `
      + `${(plan.journeyMinutes / 60).toFixed(1)}h each way)`);
    plan.notes.forEach((n) => notes.push(n));
  }

  /* ── the trainer's own page ──
     The template has no page for the host, so one is created. What goes on it
     is the host's record: nothing is written about them that the catalog does
     not already say. */
  if (resolved.mc) {
    const mc = resolved.mc;
    const lines = [{ text: mc.name, bold: true, size: 2000 }];
    if (mc.headline) lines.push({ text: mc.headline, size: 1300 });
    if (mc.years) lines.push({ text: `${mc.years} years hosting corporate programmes`, size: 1200 });
    if (mc.languages) lines.push({ text: `Languages: ${mc.languages}`, size: 1200 });
    if (mc.bio) lines.push({ text: mc.bio, size: 1100 });
    values.trainerLines = lines;
    if (opts.photoLookup) {
      try {
        const pics = opts.photoLookup('mc', mc.id);
        if (Array.isArray(pics) && pics.length) values.trainerPhotos = pics.slice(0, 2);
      } catch { /* no picture stored; the page still carries who they are */ }
    }
    if (!values.trainerPhotos) {
      notes.push(`No picture is stored for ${mc.name}, so the trainer page carries `
        + 'their details without a photograph.');
    }
  }

  if (opts.coverPhoto) values.coverPhoto = opts.coverPhoto;

  return { values, computed, notes: [...notes, ...(resolved.notes || [])] };
}

module.exports = { compose, reference, abbreviate, money, programLine, gatherPhotos };

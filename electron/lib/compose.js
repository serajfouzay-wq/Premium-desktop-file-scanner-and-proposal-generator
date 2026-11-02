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

const pad2 = (n) => String(n).padStart(2, '0');

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

/**
 * @param {object} resolved  from resolve()
 * @param {object} opts      { sequence, revision, preparedBy, preparedByEmail,
 *                             preparedByMobile, taxPct, coverPhoto, now,
 *                             transportIncluded }
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
  if (resolved.pax != null) values.capacityNote = `${resolved.pax} participants`;

  const line = programLine(resolved);
  if (line) { values.programDate = line; values.programDateDuration = line; }

  values.reference = reference({
    company: resolved.company,
    date: opts.now || new Date(),
    sequence: opts.sequence || 1,
    revision: opts.revision || 0,
  });

  /* ── money ──
     The template's own arithmetic, which is printed on the pages:
         (A)+(B) programme fee      page 8, from a rate somebody typed
         + 8% sales and service tax page 8
         = TOTAL FOR ITEM A + B     page 8
         (C) hotel                  page 9
         (D) transport              page 9
         = GRAND TOTAL A+B+C+D      page 9, repeated on page 12
     Only the rates are read from what was typed; every line above is that
     arithmetic and is listed in `computed`. The grand total has to include
     (C) and (D), which is the whole point of its wording — a grand total that
     silently omits the hotel is the kind of mistake a client notices. */
  const typed = resolved.money || [];
  /* A figure for the hotel belongs on page 9, not page 8, so the programme
     rate is the per-pax figure that is NOT about the venue or the coach. */
  const notVenue = (m) => m.subject !== 'hotel' && m.subject !== 'transport';
  const perPax = typed.find((m) => m.basis === 'per pax' && notVenue(m));
  const stated = typed.find((m) => m.basis === 'total' && notVenue(m));
  const venue = typed.find((m) => m.subject === 'hotel');
  const currency = (perPax || stated || venue || {}).currency || 'RM';

  let abCents = null;      // (A)+(B) including tax — the page 8 total
  let venueCents = null;   // (C)
  let transportCents = null; // (D)

  if (perPax) {
    values.programUnitPrice = money(perPax.cents, currency);
    values.rateNote = `RM ${money(perPax.cents, 'RM')}`;
    if (resolved.pax) {
      values.programUnit = `${resolved.pax} pax`;
      const feeCents = perPax.cents * resolved.pax;
      values.programTotal = money(feeCents, currency);
      computed.push(`programme fee = ${money(perPax.cents, currency)} x ${resolved.pax} pax `
        + `= ${money(feeCents, currency)}`);
      const tax = Math.round(feeCents * (taxPct / 100));
      values.salesTax = money(tax, currency);
      abCents = feeCents + tax;
      computed.push(`sales tax = ${taxPct}% of ${money(feeCents, currency)} = ${money(tax, currency)}`);
      computed.push(`total for item A + B = ${money(abCents, currency)}`);
    } else {
      notes.push('A per-pax rate was given but no head count, so no line total was worked out.');
    }
  }

  if (stated) {
    /* A total they stated wins: it may cover items the engine knows nothing
       about. If it disagrees with the rate multiplied out, that is said. */
    if (abCents != null && stated.cents !== abCents) {
      notes.push(`The stated total (${money(stated.cents, currency)}) differs from the rate `
        + `worked out with tax (${money(abCents, currency)}). The stated total is used.`);
    }
    abCents = stated.cents;
  }
  if (abCents != null) values.totalAB = money(abCents, currency);

  if (venue) {
    const vc = venue.currency || currency;
    values.venueUnitPrice = money(venue.cents, vc);
    if (venue.basis === 'per pax' && resolved.pax) {
      values.venueUnit = `${resolved.pax} pax`;
      venueCents = venue.cents * resolved.pax;
      computed.push(`hotel = ${money(venue.cents, vc)} x ${resolved.pax} pax `
        + `= ${money(venueCents, vc)}`);
    } else {
      values.venueUnit = '1';
      venueCents = venue.cents;
    }
    values.venueTotal = money(venueCents, vc);
  }

  /* The template prints "FREE" against the coach, so its line total is zero.
     That is the template's own statement, not a figure the engine invented. */
  if (opts.transportIncluded !== false) {
    transportCents = 0;
    values.transportTotal = money(0, currency);
  }

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
      notes.push('No hotel price was given, so the grand total covers the programme fee only. '
        + 'Page 9 keeps its own placeholders.');
    }
  }

  if (!typed.length) {
    notes.push('No price was given, so every price on pages 8, 9 and 12 is left as the '
      + 'template has it. The engine does not invent a figure.');
  }

  if (opts.coverPhoto) values.coverPhoto = opts.coverPhoto;

  return { values, computed, notes: [...notes, ...(resolved.notes || [])] };
}

module.exports = { compose, reference, abbreviate, money, programLine };

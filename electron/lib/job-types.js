'use strict';
/* ───────────────────────── job types ─────────────────────────
   One job type = one PowerPoint template + one table saying which fact goes
   in which spot. Nothing here is inferred at run time: a slot is addressed by
   where it sits, and `expect` records the text that is there now, so if the
   template is edited the fill stops and says which slot moved instead of
   writing a client's name into a price column.

   Addressing, in order of preference:
     { slide, slot }              the nth highlighted placeholder on a slide
     { slide, table, row, col }   a table cell — the only safe way to address a
                                  price, because a cell's text arrives as a
                                  flat sequence of "Xxx" runs that says nothing
                                  about which column it is in
     { slide, find }              a run addressed by its own text
     { slide, pic }               a picture frame

   Fields come from the resolver (what the person typed) and from the catalog.
   Slides not listed are never touched: the cover art, the logo, the programme
   write-up and the terms stay exactly as the designer left them. */

/* Smart Solutions Learning's team-building proposal, 12 pages.
   Measured against "Teambuilding Proposal template.pptx". */
const TEAM_BUILDING = {
  id: 'team_building',
  name: 'Team Building',
  template: 'Teambuilding Proposal template.pptx',
  slides: 12,

  /* Pages with no placeholder at all: branding, the programme description,
     the methodology and the terms. The engine does not open them. */
  untouched: [2, 3, 5, 6, 7, 10, 11],

  text: [
    /* ── page 1, the cover sheet ──
       The labels sit in one text box reading down the page (Client,
       Attention to, Date, Group Size) and their values in the box beside it,
       in the same order, which is what fixes slots 2 to 5. */
    { slide: 1, slot: 0, field: 'reference', expect: 'xxxxxxx' },
    { slide: 1, slot: 1, field: 'preparedBy', expect: 'xxxxxx' },
    { slide: 1, slot: 2, field: 'company', expect: 'xxxxxx' },
    { slide: 1, slot: 3, field: 'attention', expect: 'xxxxxx' },
    { slide: 1, slot: 4, field: 'programDate', expect: 'xxxxxx' },
    { slide: 1, slot: 5, field: 'groupSize', expect: 'xxxxxx' },

    /* ── page 4, the programme brief ── */
    { slide: 4, slot: 0, field: 'company', expect: 'XXX' },
    { slide: 4, slot: 1, field: 'programDateDuration', expect: 'XXX' },
    { slide: 4, slot: 2, field: 'groupSize', expect: 'XXX' },

    /* ── page 8, the two figures that sit above the table ──
       These two live inside the table's description cell, so that cell is
       never addressed as a cell; doing both would collide, which the fill
       detects and refuses. */
    { slide: 8, slot: 0, field: 'days', expect: 'xxxxx' },
    { slide: 8, slot: 1, field: 'groupSize', expect: 'xxxxx' },

    /* ── page 12, the confirmation sheet ──
       The template repeats page 1 and 4 here and says so in its own words;
       those notes are cleared below. */
    { slide: 12, slot: 0, field: 'reference', expect: 'Xxxx' },
    { slide: 12, slot: 1, field: 'company', expect: 'Xxxx' },
    { slide: 12, slot: 2, field: 'programDateDuration', expect: 'Xxxx' },
    { slide: 12, slot: 3, field: 'groupSize', expect: 'Xxx' },
    { slide: 12, slot: 4, field: 'grandTotal', expect: 'Xxxx' },
  ],

  /* Values the template asks for but does not highlight: the note under the
     page 8 table, and the consultant's own contact details on page 12, which
     belong in Settings rather than being retyped for every proposal. */
  labelled: [
    { slide: 12, after: 'Proposal prepared by:', field: 'preparedBy', expect: 'xxxx' },
    { slide: 12, after: 'Email:', field: 'preparedByEmail', expect: 'xxxxxx' },
    { slide: 12, after: 'Mobile:', field: 'preparedByMobile', expect: 'xxxxxx' },
    /* The coach's line total. The template prints "FREE" as its unit price,
       so this cell is the zero that follows from the template's own wording. */
    { slide: 9, after: 'FREE', field: 'transportTotal', expect: 'xxxx' },
  ],

  /* The rate note under the page 8 table repeats two figures inside running
     prose, so each is replaced by its exact phrase rather than by position. */
  phrases: [
    { slide: 8, find: 'RM xxx', field: 'rateNote', count: 1 },
    { slide: 8, find: 'xxx participants', field: 'capacityNote', count: 1 },
  ],

  /* The designer's notes to whoever fills the template in. A client must
     never read these, so each is removed and the count is asserted. */
  notes: [
    { slide: 12, find: ' – link from page 1', replace: '', count: 2 },
    { slide: 12, find: ' – link from page 4', replace: '', count: 2 },
    { slide: 12, find: ' – link from page 9', replace: '', count: 1 },
  ],

  /* Prices, addressed by row and column so a figure cannot land in the wrong
     column. Column 1 is UNIT, column 2 is UNIT PRICE (RM), column 3 is
     TOTAL PRICE (RM). Column 0 is the description and is left alone. */
  cells: [
    /* page 8 — (A) training fees and (B) event management */
    { slide: 8, table: 0, row: 1, col: 1, field: 'programUnit', expect: 'Xxxxxx' },
    { slide: 8, table: 0, row: 1, col: 2, field: 'programUnitPrice', expect: 'Xxxxxx' },
    { slide: 8, table: 0, row: 1, col: 3, field: 'programTotal', expect: 'xxx +Xxx +' },
    { slide: 8, table: 0, row: 2, col: 3, field: 'salesTax', expect: 'XXX' },
    { slide: 8, table: 0, row: 3, col: 3, field: 'totalAB', expect: 'XXX' },

    /* page 9 — (C) hotel and (D) transport */
    { slide: 9, table: 0, row: 1, col: 1, field: 'venueUnit', expect: 'xxxxxx' },
    { slide: 9, table: 0, row: 1, col: 2, field: 'venueUnitPrice', expect: 'xxxxxx' },
    { slide: 9, table: 0, row: 1, col: 3, field: 'venueTotal', expect: 'xxxxxx' },
    { slide: 9, table: 0, row: 2, col: 3, field: 'grandTotal', expect: 'xxx' },
  ],

  /* The cover photograph. The 12-page template carries artwork only on its
     first two pages; the venue and activity pages are added from the state
     decks, whose frames are a 6.67 x 3.75 inch quad grid. */
  photos: [
    { slide: 1, pic: 0, field: 'coverPhoto' },
  ],

  /* How this template groups money. The investment pages name four items and
     the engine has to know which catalog records feed each one, because the
     tax line sits under A+B only: a hotel bill carries its own tax, so adding
     8% to it here would overcharge the client.

         (A) training professional fees  the host, the activities
         (B) event management fees       coordination and production
         (C) hotel, meals, meeting room  accommodation and the venue
         (D) transportation              the coach

     A+B is taxed, then GRAND TOTAL = (A+B incl. tax) + C + D, which is what
     page 9 spells out. */
  money: {
    taxedItems: ['programme'],
    items: {
      programme: { label: 'A + B', takes: ['mc', 'activities', 'logistics'] },
      venue: { label: 'C', takes: ['hotel', 'room', 'venue'] },
      transport: { label: 'D', takes: ['transport'] },
    },
  },

  /* What the person must have given us before a deck is worth producing.
     Everything else is optional and simply left as the template had it. */
  required: ['company', 'groupSize', 'programDate'],
};

const JOB_TYPES = [TEAM_BUILDING];

const byId = (id) => JOB_TYPES.find((j) => j.id === id) || null;

/** Every mapping entry for a job type, as one array for template-fill. */
function mappingFor(jobType) {
  const j = typeof jobType === 'string' ? byId(jobType) : jobType;
  if (!j) return [];
  return [
    ...(j.text || []), ...(j.labelled || []), ...(j.phrases || []),
    ...(j.notes || []), ...(j.cells || []), ...(j.photos || []),
  ];
}

/** Which fields a job type can place, so the UI can show what it will use. */
function fieldsFor(jobType) {
  const j = typeof jobType === 'string' ? byId(jobType) : jobType;
  if (!j) return [];
  const seen = new Set();
  for (const m of mappingFor(j)) if (m.field) seen.add(m.field);
  return [...seen];
}

/** Missing required fields, named plainly for the person to fill in. */
function missingFor(jobType, values) {
  const j = typeof jobType === 'string' ? byId(jobType) : jobType;
  if (!j) return [];
  return (j.required || []).filter((f) => values[f] == null || values[f] === '');
}

module.exports = { JOB_TYPES, TEAM_BUILDING, byId, mappingFor, fieldsFor, missingFor };

'use strict';

/*
 * Turning a sentence into a selection, without a model.
 *
 * "team building for ABC Sdn Bhd, 45 pax, 14-15 March, MC Sera, at Lexis
 *  Hibiscus, amazing race and culinary face-off"
 *
 * This reads like something only a language model could handle, but it is not.
 * The catalog already holds every host's name, every hotel, every activity and
 * every state. So the job is not to understand the sentence — it is to find
 * which known names appear in it. That is lookup, and lookup is exact.
 *
 * Three rules keep it honest:
 *
 *   Longest match wins.  "Lexis Hibiscus Port Dickson" must not be read as
 *   "Port Dickson" the state plus a stray word, and "Villea Port Dickson"
 *   must not collide with "Villea Hotel Port Dickson".
 *
 *   Nothing is guessed.  A term that matches two catalog entries equally well
 *   is reported as ambiguous and the user picks. It is never resolved by
 *   taking the first, because a proposal naming the wrong hotel is worse than
 *   one that asks a question.
 *
 *   Everything is accounted for.  Words that matched nothing are returned, so
 *   the interface can say "I did not recognise 'kayaking'" instead of quietly
 *   dropping it.
 */

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* Words too common to identify anything on their own. A hotel called "The
   Resort" should not match on "resort". */
/* For a job type, only the words that would be weak in any sentence. */
const JOB_WEAK = new Set(['the', 'and', 'for', 'with', 'at', 'in', 'of', 'a', 'an']);
/* "Team Building Proposal" is the same job as "Team Building". */
const DOCUMENT_WORDS = /\s+(proposal|proposals|package|packages|quote|quotation|template|deck|programme|program)$/i;
const stripDocumentWords = (name) => {
  let out = String(name || '');
  for (let i = 0; i < 3; i += 1) out = out.replace(DOCUMENT_WORDS, '');
  return out.trim() || String(name || '');
};

const WEAK = new Set([
  'hotel', 'resort', 'the', 'and', 'for', 'with', 'at', 'in', 'of', 'a', 'an',
  'star', 'by', 'pax', 'day', 'days', 'night', 'nights', 'program', 'programme',
  'activity', 'activities', 'team', 'building', 'event', 'venue', 'centre', 'center',
]);

const distinctive = (name, weak = WEAK) => norm(name).split(' ')
  .filter((w) => w.length > 2 && !weak.has(w));

/**
 * Find every catalog entry whose name appears in the text.
 * Returns matches sorted longest-first, so the caller can take the best and
 * then exclude the span it consumed.
 */
function findMatches(haystack, entries, nameOf = (e) => e.name, weak = WEAK) {
  const hay = ` ${norm(haystack)} `;
  const found = [];

  for (const entry of entries) {
    const full = norm(nameOf(entry));
    if (!full) continue;

    // Whole name present verbatim — the strongest signal available.
    if (hay.includes(` ${full} `)) {
      found.push({
        entry, score: full.length + 100, matched: full, how: 'full name',
        /* Where it was said. Several things matched at once come back in the
           order they were named, which for activities is the order they run:
           an itinerary that lists them in catalog order reads as though the
           day were planned by the database. */
        at: hay.indexOf(` ${full} `),
      });
      continue;
    }

    /* Otherwise every distinctive word of the name must be present. Requiring
       all of them is what stops "Villea Port Dickson" matching a sentence that
       only says "Port Dickson". */
    const words = distinctive(full, weak);
    if (!words.length) continue;
    const hit = words.filter((w) => hay.includes(` ${w} `) || hay.includes(` ${w}s `));
    if (hit.length === words.length) {
      found.push({
        entry, score: words.join('').length, matched: words.join(' '), how: 'all key words',
        at: Math.min(...hit.map((w) => {
          const i = hay.indexOf(` ${w} `);
          return i < 0 ? hay.indexOf(` ${w}s `) : i;
        }).filter((i) => i >= 0)),
      });
      continue;
    }
    /* A single distinctive word is enough only when it is distinctive across
       the whole catalog — checked by the caller, which knows the other names. */
    if (hit.length === 1 && words.length > 1 && hit[0].length >= 5) {
      const i = hay.indexOf(` ${hit[0]} `);
      found.push({
        entry, score: hit[0].length, matched: hit[0], how: 'partial', partial: true,
        at: i >= 0 ? i : hay.indexOf(` ${hit[0]}s `),
      });
    }
  }

  return found.sort((a, b) => b.score - a.score);
}

/**
 * Pick one entry from a set of matches, or report that it is ambiguous.
 * `cue` words near the match (MC, host, hotel) raise confidence but are never
 * required.
 */
function pickOne(matches) {
  if (!matches.length) return { value: null };
  const best = matches[0];
  const rivals = matches.filter((m) => m !== best && m.score >= best.score - 1);
  if (rivals.length) {
    return {
      value: null,
      ambiguous: [best, ...rivals].map((m) => ({ id: m.entry.id, name: m.entry.name })),
    };
  }
  return { value: best.entry, how: best.how, partial: !!best.partial };
}

/* ----------------------------------------------------------- field readers */

const PAX = /\b(\d{1,4})\s*(?:pax|people|persons?|participants?|attendees?|guests?|staff)\b/i;
const PAX_ALT = /\b(?:pax|participants?|people|group\s+size)\s*(?:of|[:=])?\s*(\d{1,4})\b/i;
const NIGHTS = /\b(\d)\s*d\s*(\d)\s*n\b/i;                     // 2D1N
const NIGHTS_ALT = /\b(\d{1,2})\s*nights?\b/i;
const DAYS_ALT = /\b(\d{1,2})\s*days?\b/i;

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december'
  + '|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
// "14 - 15 March 2026", "14th March", "March 14 2026", "14/3/2026"
const DATE_RANGE = new RegExp(
  String.raw`\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-–to]+\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s+(${MONTHS})\.?\s*(\d{4})?`, 'i');
const DATE_ONE = new RegExp(
  String.raw`\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(${MONTHS})\.?\s*(\d{4})?`, 'i');

const readPax = (t) => {
  const m = t.match(PAX) || t.match(PAX_ALT);
  return m ? Number(m[1]) : null;
};

function readDuration(t) {
  /* `text` is what the reader consumed, so those words are not then reported
     as unrecognised. Telling someone "2d1n" was not understood, right after
     showing them "Duration: 2D1N", destroys confidence in the whole report. */
  const dn = t.match(NIGHTS);
  if (dn) return { days: Number(dn[1]), nights: Number(dn[2]), text: dn[0] };
  const n = t.match(NIGHTS_ALT);
  const d = t.match(DAYS_ALT);
  if (n && d) return { days: Number(d[1]), nights: Number(n[1]), text: `${d[0]} ${n[0]}` };
  if (n) return { days: Number(n[1]) + 1, nights: Number(n[1]), text: n[0] };
  if (d) return { days: Number(d[1]), nights: Math.max(0, Number(d[1]) - 1), text: d[0] };
  return { days: null, nights: null, text: null };
}

function readDates(t) {
  const r = t.match(DATE_RANGE);
  if (r) {
    const year = r[4] || '';
    return { text: `${r[1]} - ${r[2]} ${title(r[3])}${year ? ` ${year}` : ''}`.trim(), from: r[1], to: r[2] };
  }
  const o = t.match(DATE_ONE);
  if (o) {
    const year = o[3] || '';
    return { text: `${o[1]} ${title(o[2])}${year ? ` ${year}` : ''}`.trim(), from: o[1], to: null };
  }
  return { text: null };
}

const title = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();

/* The company is whatever carries a trading suffix, which is the one reliable
   marker in a free-typed sentence. Finding the suffix is easy; finding where the
   name STARTS is the real problem. A regex that allows any word before the
   suffix reads "Team Building proposal for ABC Sdn Bhd" as one long company,
   because it matches from the leftmost capital it can reach. So we locate the
   suffix and then walk backwards one word at a time, keeping only words that
   can belong to a company name: a capitalised word, an all-caps acronym, or a
   small joiner ("&", "of") that must itself be followed by more name. The walk
   stops at the first word that cannot (a lowercase verb or preposition like
   "for", "proposal", "at"), which is exactly the boundary we want. */
const SUFFIX = /\b(?:Sdn\.?\s*Bhd|Berhad|Bhd|Pte\.?\s*Ltd|Pvt\.?\s*Ltd|Limited|Ltd|LLC|Inc|Corp(?:oration)?|GmbH|PLC|LLP)\.?/g;
const JOINER = new Set(['&', 'of', 'and', 'the', 'bin', 'binti']);
/* Walking backwards must stop at a trading suffix: it closes the company
   before this one. Without this, "to Maybank Berhad and CIMB Group Holdings
   Berhad" reads the second name as starting back at "Maybank". */
const SUFFIX_WORD = new Set(['sdn', 'bhd', 'berhad', 'pte', 'pvt', 'ltd', 'limited',
  'llc', 'inc', 'corp', 'corporation', 'gmbh', 'plc', 'llp']);
const NAME_WORD = /^(?:[A-Z][\w'’.-]*|[A-Z]{2,}|\(\w+\))$/;

function readCompanies(text) {
  const all = [];
  SUFFIX.lastIndex = 0;
  let m;
  while ((m = SUFFIX.exec(text))) {
    const before = text.slice(0, m.index).replace(/\s+$/, '');
    const words = before.split(/\s+/);
    let keep = 0;
    for (let i = words.length - 1; i >= 0; i -= 1) {
      const w = words[i].replace(/^[("']+/, '').replace(/[,;:.)"']+$/, '');
      if (!w) break;
      if (SUFFIX_WORD.has(w.toLowerCase().replace(/\./g, ''))) break;
      if (NAME_WORD.test(w)) { keep = words.length - i; continue; }
      if (JOINER.has(w.toLowerCase()) && keep > 0) { keep = words.length - i; continue; }
      break;
    }
    /* Drop a trailing joiner: "for ABC & Sdn Bhd" must not begin with "&". */
    while (keep > 0 && JOINER.has(words[words.length - keep].toLowerCase())) keep -= 1;
    if (keep === 0) continue;
    const name = `${words.slice(words.length - keep).join(' ')} ${m[0]}`
      .replace(/\s{2,}/g, ' ').trim();
    if (!all.includes(name)) all.push(name);
  }
  return all;
}
const PIC = /\b(?:attn|attention|pic|contact|c\/o|care of)\s*[:\-]?\s*((?:mr|ms|mrs|dr|en|pn|puan|encik)\.?\s*)?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/i;


/* ───────── money and times the person typed ─────────
   These are never invented. The engine has a standing rule that it does not
   generate a price; it only carries across a figure somebody typed or that the
   catalog already holds. So what follows is strictly reading, and each figure
   is kept with the exact text it came from, so the slide can show "RM 285.00"
   when that is what was written rather than a number we reformatted. */

/* A leading \b cannot precede "$", because "$" is not a word character, so the
   left edge is a negative lookbehind instead. Longer symbols come first so
   "US$" is not read as "$". */
const NUM = String.raw`[0-9](?:[0-9,]*[0-9])?(?:\.[0-9]{1,2})?`;
const CURRENCY = new RegExp(
  String.raw`(?<![\w$])(US\$|S\$|RM|MYR|SGD|USD|IDR|THB|RP|\$)\s*(${NUM})`
  + String.raw`|\b(${NUM})\s*(ringgit|myr|sgd|usd|dollars?|baht)\b`,
  'gi',
);
const CUR_NAME = {
  RM: 'RM', MYR: 'MYR', SGD: 'SGD', USD: 'USD', IDR: 'IDR', THB: 'THB',
  RP: 'IDR', 'S$': 'SGD', 'US$': 'USD', $: '$',
  RINGGIT: 'RM', DOLLAR: 'USD', DOLLARS: 'USD', BAHT: 'THB',
};
const PER_PAX = /\b(?:per|\/)\s*(?:pax|person|head|participant|pc)\b/i;
const TOTAL = /\b(?:total|grand\s*total|all\s*in|altogether|sum)\b/i;
const DEPOSIT = /\b(?:deposit|down\s*payment|upfront)\b/i;
/* What a figure is FOR, as opposed to how it is counted. The investment pages
   separate the programme fee from the hotel and the coach, so a price has to
   carry which of them it belongs to or it cannot be placed. */
const SUBJECTS = [
  ['hotel', /\b(?:hotel|venue|accommodation|resort|room|package|stay)\b/i],
  ['transport', /\b(?:bus|coach|transport|transfer|van)\b/i],
  ['programme', /\b(?:programme|program|training|facilitation|fees?|teambuilding|team\s*building)\b/i],
];

/** Every money figure in the text, each labelled by the words around it. */
function readMoney(t) {
  /* Collect the figures first, then label them. A figure's label has to be
     read from the gap between it and its neighbours: a window of fixed width
     would reach past a comma into the previous figure's wording, and
     "RM 285 per pax, total RM 11,400" would make the total per-pax too. */
  const raw = [];
  CURRENCY.lastIndex = 0;
  let m;
  while ((m = CURRENCY.exec(t))) {
    const symbol = (m[1] || m[4] || '').toUpperCase();
    const digits = (m[2] || m[3] || '').replace(/,/g, '');
    const amount = Number(digits);
    if (!Number.isFinite(amount)) continue;
    raw.push({ text: m[0].trim(), symbol, amount, start: m.index, end: m.index + m[0].length });
  }

  return raw.map((f, i) => {
    const gapBefore = t.slice(i === 0 ? 0 : raw[i - 1].end, f.start);
    const gapAfter = t.slice(f.end, i === raw.length - 1 ? t.length : raw[i + 1].start);
    let basis = 'unlabelled';
    /* "per pax" always follows its amount; a label like "total" precedes it. */
    if (PER_PAX.test(gapAfter)) basis = 'per pax';
    else if (DEPOSIT.test(gapBefore)) basis = 'deposit';
    else if (TOTAL.test(gapBefore)) basis = 'total';
    else if (PER_PAX.test(gapBefore)) basis = 'per pax';
    const subject = (SUBJECTS.find(([, re]) => re.test(gapBefore)) || [null])[0];
    return {
      subject,
      text: f.text,
      currency: CUR_NAME[f.symbol] || f.symbol || null,
      amount: f.amount,
      cents: Math.round(f.amount * 100),
      basis,
    };
  });
}

const TIME = /\b(?:([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*(am|pm)?|([01]?\d|2[0-3])\s*(am|pm))\b/gi;
const BARE_24H = /\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours|h)\b/gi;

/** Every clock time, normalised to 24-hour, with the text it came from. */
function readTimes(t) {
  const found = [];
  const push = (h, min, suffix, text, index) => {
    let hour = Number(h);
    const s = (suffix || '').toLowerCase();
    if (s === 'pm' && hour < 12) hour += 12;
    if (s === 'am' && hour === 12) hour = 0;
    found.push({
      text: String(text).trim(),
      hour,
      minute: Number(min || 0),
      value: `${String(hour).padStart(2, '0')}:${String(min || 0).toString().padStart(2, '0')}`,
      index,
    });
  };
  TIME.lastIndex = 0;
  let m;
  while ((m = TIME.exec(t))) {
    if (m[1] != null) push(m[1], m[2], m[3], m[0], m.index);
    else push(m[4], 0, m[5], m[0], m.index);
  }
  BARE_24H.lastIndex = 0;
  while ((m = BARE_24H.exec(t))) push(m[1], m[2], null, m[0], m.index);
  found.sort((a, b) => a.index - b.index);
  /* A pair joined by a dash is a window, not two separate times. */
  for (let i = 0; i < found.length - 1; i += 1) {
    const between = t.slice(found[i].index + found[i].text.length, found[i + 1].index);
    if (/^\s*(?:-|–|to|till|until|until\s+)\s*$/i.test(between)) {
      found[i].rangeWith = found[i + 1].value;
      found[i + 1].rangeFrom = found[i].value;
    }
  }
  return found.map(({ index, ...rest }) => rest);
}


/**
 * Which job the request is for.
 *
 * Job types get their own matcher rather than another option on findMatches,
 * because they are a handful of curated records and the way people name them
 * is nothing like the way they name a hotel. Three things it has to survive:
 *
 *   "this job is a team building"  — the catalog says "Team Building Proposal"
 *   "teambuilding at Lexis"        — written as one word
 *   "we need a gala dinner"        — the catalog says "Annual Gala Dinner"
 *
 * So the document words are dropped, spaces are ignored for comparison, and a
 * partial match counts: the type matching the most of its own words wins. A
 * tie is reported as ambiguous and never resolved by picking the first.
 */
function matchJobType(text, jobs) {
  const hay = ` ${norm(text)} `;
  const squashedHay = norm(text).replace(/\s+/g, '');
  const scored = [];

  for (const job of jobs) {
    const name = stripDocumentWords(job.name);
    const full = norm(name);
    if (!full) continue;
    const squashed = full.replace(/\s+/g, '');

    if (hay.includes(` ${full} `)) {
      scored.push({ entry: job, score: 1000 + full.length, how: 'full name' });
      continue;
    }
    /* "teambuilding" and "team building" are the same request. */
    if (squashed.length > 5 && squashedHay.includes(squashed)) {
      scored.push({ entry: job, score: 900 + squashed.length, how: 'name written as one word' });
      continue;
    }
    const words = distinctive(full, JOB_WEAK);
    if (!words.length) continue;
    const hit = words.filter((w) => hay.includes(` ${w} `) || hay.includes(` ${w}s `));
    if (!hit.length) continue;
    /* Every word matched outranks some of them, and more words outrank fewer. */
    const score = hit.length === words.length
      ? 500 + words.join('').length
      : hit.length * 10 + hit.join('').length / 100;
    scored.push({ entry: job, score, how: hit.length === words.length ? 'all key words' : `${hit.length} of ${words.length} words` });
  }

  return pickOne(scored);
}

/**
 * @param {string} text        what the salesperson typed
 * @param {object} catalog     { mcs, hotels, activities, locations, venues, jobTypes, customers }
 */
function resolve(text, catalog = {}) {
  const t = String(text || '');
  const result = {
    text: t,
    jobType: null, company: null, pic: null, pax: null,
    days: null, nights: null, dates: null,
    location: null, hotels: [], mc: null, activities: [], venues: [],
    companies: [], money: [], times: [],
    ambiguous: [], unrecognised: [], notes: [],
  };

  /* Job type first — it decides which template is used, so getting it wrong
     costs more than any other field.

     It also needs its own idea of which words carry meaning. The general list
     treats "team", "building", "event" and "programme" as weak, because they
     turn up in half the hotel and activity names in any catalog. For a job
     type they are the whole name: "Team Building Proposal" would otherwise be
     distinguished only by the word "Proposal", and somebody typing "this job
     is a team building" would be told no job type was recognised. The trailing
     words that describe the document rather than the job are dropped instead. */
  const jobs = catalog.jobTypes || [];
  const jobMatch = matchJobType(t, jobs);
  if (jobMatch.ambiguous) result.ambiguous.push({ field: 'job type', options: jobMatch.ambiguous });
  result.jobType = jobMatch.value || null;

  result.companies = readCompanies(t);
  /* Their own company appears on the cover of every deck, so a sentence that
     names it alongside the client's must not hand us the wrong one. */
  const own = catalog.ownCompany ? norm(catalog.ownCompany) : null;
  const others = own ? result.companies.filter((c) => norm(c) !== own) : result.companies;
  result.company = others[0] || null;
  if (own && result.companies.length > others.length) {
    result.notes.push(`${catalog.ownCompany} read as the sender, not the client.`);
  }
  if (others.length > 1) {
    result.notes.push(`More than one client company named: ${others.join('; ')}. Using the first.`);
  }

  const pic = t.match(PIC);
  if (pic) result.pic = `${(pic[1] || '').trim()} ${pic[2]}`.trim();

  result.money = readMoney(t);
  result.times = readTimes(t);
  result.pax = readPax(t);
  const dur = readDuration(t);
  result.days = dur.days;
  result.nights = dur.nights;
  const dates = readDates(t);
  result.dates = dates.text;

  /* Hotels before locations: a hotel's name often contains its town, and the
     town should not be claimed by the location matcher first. */
  const hotelMatches = findMatches(t, catalog.hotels || []);
  const takenSpans = new Set();
  for (const m of hotelMatches) {
    if (result.hotels.some((h) => h.id === m.entry.id)) continue;
    // Skip a partial match that is fully covered by a hotel already taken.
    if ([...takenSpans].some((s) => s.includes(m.matched))) continue;
    const rivals = hotelMatches.filter((x) => x !== m && x.score === m.score
      && !result.hotels.some((h) => h.id === x.entry.id));
    if (rivals.length && m.partial) {
      result.ambiguous.push({ field: 'hotel', options: [m, ...rivals].map((x) => ({ id: x.entry.id, name: x.entry.name })) });
      continue;
    }
    result.hotels.push(m.entry);
    takenSpans.add(m.matched);
  }

  const locMatches = findMatches(t, catalog.locations || [])
    .filter((m) => ![...takenSpans].some((s) => s.includes(m.matched)));
  const loc = pickOne(locMatches);
  if (loc.ambiguous) result.ambiguous.push({ field: 'location', options: loc.ambiguous });
  result.location = loc.value || null;
  // A hotel implies its own location when none was named.
  if (!result.location && result.hotels.length && catalog.locations) {
    const byId = catalog.locations.find((l) => l.id === result.hotels[0].location_id);
    if (byId) { result.location = byId; result.notes.push(`Location taken from ${result.hotels[0].name}.`); }
  }

  const mc = pickOne(findMatches(t, catalog.mcs || []));
  if (mc.ambiguous) result.ambiguous.push({ field: 'host', options: mc.ambiguous });
  result.mc = mc.value || null;

  /* In the order they were named, not the order the catalog holds them. The
     itinerary runs the activities in this order, so "amazing race, beach
     olympics and culinary face-off" has to come back that way round. */
  const inSaidOrder = (matches) => matches
    .slice()
    .sort((a, b) => (a.at == null ? 1e9 : a.at) - (b.at == null ? 1e9 : b.at));

  for (const m of inSaidOrder(findMatches(t, catalog.activities || []))) {
    if (result.activities.some((a) => a.id === m.entry.id)) continue;
    result.activities.push(m.entry);
  }

  for (const m of inSaidOrder(findMatches(t, catalog.venues || []))) {
    if (result.venues.some((v) => v.id === m.entry.id)) continue;
    result.venues.push(m.entry);
  }

  /* Anything left over. Words the reader could not place are reported rather
     than ignored, so a request for something not in the catalog is visible
     instead of silently missing from the proposal. */
  const claimed = new Set();
  const claim = (s) => norm(s).split(' ').forEach((w) => claimed.add(w));
  [result.company, result.pic, result.dates, result.jobType && result.jobType.name,
    result.location && result.location.name, result.mc && result.mc.name]
    .filter(Boolean).forEach(claim);
  [...result.hotels, ...result.activities, ...result.venues].forEach((e) => claim(e.name));
  /* Everything the other readers consumed is accounted for too, so what comes
     back as unrecognised is genuinely unrecognised. */
  claim(result.dates);
  claim(result.pic);
  result.companies.forEach(claim);
  result.money.forEach((m) => claim(m.text));
  result.times.forEach((x) => claim(x.text));
  claim(dur.text);

  const FILLER = new Set([...WEAK, 'is', 'be', 'will', 'we', 'need', 'want', 'please', 'make',
    'proposal', 'quote', 'quotation', 'client', 'customer', 'attn', 'attention', 'pic',
    'mc', 'emcee', 'host', 'from', 'to', 'on', 'this', 'that', 'it', 'about', 'around',
    'people', 'persons', 'participants', 'guests', 'staff', 'pax', 'about',
    'per', 'package', 'depart', 'departure', 'back', 'return', 'arrive', 'arrival',
    'night', 'nights', 'day', 'days', 'rate', 'rates', 'price', 'prices', 'cost',
    'total', 'deposit', 'session', 'inclusive', 'includes', 'including', 'incl',
    'compare', 'option', 'options', 'quoted', 'each', 'all', 'and', 'with', 'our']);
  result.unrecognised = norm(t).split(' ')
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !claimed.has(w) && !FILLER.has(w)
      && !new RegExp(`^(${MONTHS})$`, 'i').test(w))
    .filter((w, i, a) => a.indexOf(w) === i);

  return result;
}

/** A plain-language account of what was understood, for the interface. */
function describe(r) {
  const lines = [];
  if (r.jobType) lines.push(`Job type: ${r.jobType.name}`);
  if (r.company) lines.push(`Client: ${r.company}`);
  if (r.pic) lines.push(`Attention to: ${r.pic}`);
  if (r.pax) lines.push(`Participants: ${r.pax}`);
  if (r.dates) lines.push(`Dates: ${r.dates}`);
  if (r.days) lines.push(`Duration: ${r.days}D${r.nights}N`);
  if (r.location) lines.push(`Location: ${r.location.name}`);
  if (r.hotels.length) lines.push(`Venues: ${r.hotels.map((h) => h.name).join(', ')}`);
  if (r.mc) lines.push(`Host: ${r.mc.name}`);
  if (r.activities.length) lines.push(`Activities: ${r.activities.map((a) => a.name).join(', ')}`);
  for (const m of r.money) {
    lines.push(`Price: ${m.text}${m.basis !== 'unlabelled' ? ` (${m.basis})` : ''}`);
  }
  for (const tm of r.times) {
    lines.push(`Time: ${tm.value}${tm.rangeWith ? ` to ${tm.rangeWith}` : ''}`);
  }
  return lines;
}

module.exports = {
  resolve, describe, findMatches, pickOne, norm, stripDocumentWords, matchJobType,
  readPax, readDuration, readDates, readCompanies, readMoney, readTimes,
};

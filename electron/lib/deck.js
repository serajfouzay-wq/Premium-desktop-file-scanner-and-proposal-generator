'use strict';
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');
const { money, clientFacing } = require('./pricing');
const L = require('./layout');

/*
 * The deck builder.
 *
 * Slides are assembled from masters and catalog records — no prose is written
 * here that was not either typed by the user or stored against a vendor. Every
 * figure comes from pricing.js. Running this twice with the same selections
 * produces the same deck.
 */

const W = L.SLIDE.w;       // 16:9 at 13.333 x 7.5 inches
const H = L.SLIDE.h;
const M = L.MARGIN;        // outer margin

const INK = '12191C';
const SOFT = '4A565B';
const FAINT = '8A959A';
const RULE = 'DEDBD1';
const WASH = 'F6F5F1';
const PAPER = 'FFFFFF';

const SANS = 'Segoe UI';
const SERIF = 'Georgia';

const hex = (v, fallback) => {
  const s = String(v || '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
};

const exists = (p) => {
  try { return !!p && fs.existsSync(p); } catch { return false; }
};

const firstImage = (subject) => {
  const imgs = (subject && subject.images) || [];
  const found = imgs.find((i) => exists(i.path));
  return found ? found.path : null;
};

/** An image if there is one, a framed placeholder if there is not. */
function plate(slide, opts) {
  const { x, y, w, h, path, label, accent } = opts;
  if (exists(path)) {
    slide.addImage({ path, x, y, w, h, sizing: { type: 'cover', w, h } });
    return;
  }
  slide.addShape('rect', { x, y, w, h, fill: { color: WASH }, line: { color: RULE, width: 0.75 } });
  slide.addText(label || 'Photograph', {
    x, y: y + h / 2 - 0.22, w, h: 0.44,
    align: 'center', fontSize: 10, color: FAINT, fontFace: SANS, charSpacing: 2,
  });
  if (accent) {
    slide.addShape('rect', { x, y, w: 0.06, h, fill: { color: accent } });
  }
}

/* A consistent frame on every slide but the cover, so the deck reads as one
   document rather than a stack of unrelated pages. */
function chrome(slide, ctx, title, kicker) {
  slide.background = { color: PAPER };
  slide.addShape('rect', { x: 0, y: 0, w: 0.16, h: H, fill: { color: ctx.accent } });

  if (kicker) {
    slide.addText(String(kicker).toUpperCase(), {
      x: M, y: 0.46, w: W - M * 2, h: 0.26,
      fontSize: 10, bold: true, color: ctx.accent, fontFace: SANS, charSpacing: 3,
    });
  }
  if (title) {
    slide.addText(title, {
      x: M, y: 0.76, w: W - M * 2, h: 0.62,
      fontSize: 30, bold: true, color: INK, fontFace: SERIF,
    });
    slide.addShape('line', {
      x: M, y: 1.44, w: W - M * 2, h: 0, line: { color: RULE, width: 1 },
    });
  }

  slide.addText(`${ctx.hostName}  ·  ${ctx.clientName}`, {
    x: M, y: H - 0.5, w: W - M * 2 - 1, h: 0.26,
    fontSize: 9, color: FAINT, fontFace: SANS,
  });
  slide.addText(String(ctx.page), {
    x: W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.26,
    fontSize: 9, color: FAINT, fontFace: SANS, align: 'right',
  });
  ctx.page++;
}

/* ------------------------------------------------------------- the slides */

const SLIDES = {
  cover(pptx, ctx, d) {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addShape('rect', { x: 0, y: 0, w: W * 0.42, h: H, fill: { color: ctx.accent } });

    if (exists(ctx.coverImage)) {
      s.addImage({ path: ctx.coverImage, x: W * 0.42, y: 0, w: W * 0.58, h: H, sizing: { type: 'cover', w: W * 0.58, h: H } });
    }

    if (exists(ctx.hostLogo)) s.addImage({ path: ctx.hostLogo, x: M, y: 0.55, w: 1.9, h: 0.62, sizing: { type: 'contain', w: 1.9, h: 0.62 } });
    else {
      s.addText(ctx.hostName, {
        x: M, y: 0.55, w: 4.4, h: 0.5, fontSize: 15, bold: true, color: PAPER, fontFace: SANS,
      });
    }

    s.addText(String(d.templateName || 'Proposal').toUpperCase(), {
      x: M, y: 2.35, w: W * 0.42 - M * 2, h: 0.3,
      fontSize: 11, bold: true, color: PAPER, fontFace: SANS, charSpacing: 4, transparency: 25,
    });
    s.addText(d.title, {
      x: M, y: 2.75, w: W * 0.42 - M * 2, h: 2.0,
      fontSize: 38, bold: true, color: PAPER, fontFace: SERIF, lineSpacingMultiple: 0.92,
    });

    const meta = [
      ['PREPARED FOR', d.client],
      ['DATES', d.dates || 'To be confirmed'],
      ['ATTENDING', `${d.pax} guests`],
    ];
    meta.forEach(([k, v], i) => {
      const y = 5.1 + i * 0.62;
      s.addText(k, { x: M, y, w: 2.1, h: 0.22, fontSize: 8, color: PAPER, fontFace: SANS, charSpacing: 2, transparency: 40 });
      s.addText(String(v), { x: M, y: y + 0.21, w: W * 0.42 - M * 2, h: 0.3, fontSize: 13, bold: true, color: PAPER, fontFace: SANS });
    });
    ctx.page++;
  },

  credentials(pptx, ctx, d) {
    const s = pptx.addSlide();
    chrome(s, ctx, 'Who you are working with', 'Credentials');
    s.addText(ctx.hostBlurb, {
      x: M, y: 1.9, w: 6.3, h: 2.4, fontSize: 14, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.35,
    });
    const stats = ctx.stats || [];
    stats.forEach((st, i) => {
      const x = 7.5 + (i % 2) * 2.7;
      const y = 1.9 + Math.floor(i / 2) * 1.5;
      s.addShape('rect', { x, y, w: 2.45, h: 1.25, fill: { color: WASH }, line: { color: RULE, width: 0.75 } });
      s.addText(st.value, { x: x + 0.2, y: y + 0.18, w: 2.05, h: 0.5, fontSize: 24, bold: true, color: ctx.accent, fontFace: SANS });
      s.addText(st.label, { x: x + 0.2, y: y + 0.72, w: 2.05, h: 0.4, fontSize: 10, color: SOFT, fontFace: SANS });
    });
  },

  destination(pptx, ctx, d) {
    if (!d.location) return;
    const s = pptx.addSlide();
    chrome(s, ctx, d.location.name, 'Destination');
    plate(s, { x: M, y: 1.85, w: 7.1, h: 4.3, path: firstImage(d.locationImages), label: d.location.name, accent: ctx.accent });
    s.addText(d.location.region || '', {
      x: 8.05, y: 1.85, w: 4.6, h: 0.3, fontSize: 10, bold: true, color: ctx.accent, fontFace: SANS, charSpacing: 2,
    });
    s.addText(d.location.blurb || '', {
      x: 8.05, y: 2.25, w: 4.6, h: 2.6, fontSize: 13, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.35,
    });
  },

  hotel(pptx, ctx, d) {
    if (!d.hotel) return;
    const s = pptx.addSlide();
    chrome(s, ctx, d.hotel.name, 'Accommodation');

    const imgs = (d.hotel.images || []).filter((i) => exists(i.path));
    plate(s, { x: M, y: 1.85, w: 5.9, h: 3.35, path: imgs[0] && imgs[0].path, label: 'Hotel exterior', accent: ctx.accent });
    plate(s, { x: M, y: 5.35, w: 2.87, h: 1.55, path: imgs[1] && imgs[1].path, label: 'Room', accent: ctx.accent });
    plate(s, { x: M + 3.03, y: 5.35, w: 2.87, h: 1.55, path: imgs[2] && imgs[2].path, label: 'Room', accent: ctx.accent });

    const x = 6.85;
    s.addText(`${'★'.repeat(Math.max(0, Math.min(5, d.hotel.star_rating || 0)))}   ${d.hotel.address || ''}`, {
      x, y: 1.85, w: 5.85, h: 0.3, fontSize: 10, color: FAINT, fontFace: SANS,
    });

    if (d.room) {
      s.addShape('rect', { x, y: 2.25, w: 5.85, h: 1.0, fill: { color: WASH }, line: { color: RULE, width: 0.75 } });
      s.addText(d.room.tier, { x: x + 0.24, y: 2.4, w: 3.2, h: 0.34, fontSize: 15, bold: true, color: INK, fontFace: SANS });
      s.addText(`Sleeps ${d.room.occupancy} · ${d.roomCount} room${d.roomCount === 1 ? '' : 's'} · ${d.nights} night${d.nights === 1 ? '' : 's'}`, {
        x: x + 0.24, y: 2.78, w: 3.6, h: 0.3, fontSize: 11, color: SOFT, fontFace: SANS,
      });
      s.addText(`${money(d.room.nightly_rate)}`, {
        x: x + 3.9, y: 2.48, w: 1.7, h: 0.44, fontSize: 17, bold: true, color: ctx.accent, fontFace: SANS, align: 'right',
      });
      s.addText('per room, per night', {
        x: x + 3.4, y: 2.9, w: 2.2, h: 0.24, fontSize: 9, color: FAINT, fontFace: SANS, align: 'right',
      });
    }

    const amenities = String(d.hotel.amenities || '').split('\n').filter(Boolean);
    if (amenities.length) {
      s.addText('WHAT THE VENUE OFFERS', { x, y: 3.5, w: 5.85, h: 0.26, fontSize: 9, bold: true, color: FAINT, fontFace: SANS, charSpacing: 2 });
      s.addText(amenities.map((t) => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true } })), {
        x, y: 3.82, w: 5.85, h: 2.6, fontSize: 12, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.3,
      });
    }
  },

  mc(pptx, ctx, d) {
    if (!d.mc) return;
    const s = pptx.addSlide();
    chrome(s, ctx, d.mc.name, 'Your host');
    plate(s, { x: M, y: 1.85, w: 4.1, h: 4.6, path: firstImage(d.mc), label: d.mc.name, accent: ctx.accent });

    const x = 5.15;
    s.addText(d.mc.headline || '', { x, y: 1.9, w: 7.5, h: 0.4, fontSize: 15, bold: true, color: ctx.accent, fontFace: SANS });
    s.addText(d.mc.bio || '', { x, y: 2.45, w: 7.5, h: 2.2, fontSize: 13, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.35 });

    const badges = [
      `${d.mc.years || 0} years hosting`,
      ...String(d.mc.languages || '').split(',').map((l) => l.trim()).filter(Boolean),
    ];
    badges.forEach((b, i) => {
      const bx = x + (i % 3) * 2.5;
      const by = 4.85 + Math.floor(i / 3) * 0.62;
      s.addShape('roundRect', { x: bx, y: by, w: 2.35, h: 0.46, fill: { color: WASH }, line: { color: RULE, width: 0.75 }, rectRadius: 0.2 });
      s.addText(b, { x: bx, y: by, w: 2.35, h: 0.46, fontSize: 10, color: SOFT, fontFace: SANS, align: 'center', valign: 'middle' });
    });

    s.addText(`${money(d.mc.day_rate)} per day`, {
      x, y: H - 1.15, w: 7.5, h: 0.32, fontSize: 12, bold: true, color: INK, fontFace: SANS,
    });
  },

  activities(pptx, ctx, d) {
    const list = d.activities || [];
    if (!list.length) return;

    /* The slide shape follows the count: one activity gets the whole slide,
       three get three columns, seven get a slide of six and a hero. The rules
       live in layout.js so every grid in the deck is built the same way. */
    const pages = L.paginate(list);
    pages.forEach((page, pageIndex) => {
      const s = pptx.addSlide();
      chrome(s, ctx, pageIndex === 0 ? 'The programme' : 'The programme, continued', 'Activities');

      if (page.length === 1) {
        const a = page[0];
        const box = L.hero('scene');
        plate(s, { ...box.image, path: firstImage(a), label: a.name, accent: ctx.accent });
        s.addText(activityMeta(a), { ...box.kicker, fontSize: 10, bold: true, color: ctx.accent, fontFace: SANS, charSpacing: 2 });
        s.addText(a.name, { ...box.title, fontSize: 24, bold: true, color: INK, fontFace: SANS });
        s.addText(a.summary || '', { ...box.body, fontSize: 14, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.35 });
        s.addText(activityPrice(a), { ...box.footer, fontSize: 15, bold: true, color: ctx.accent, fontFace: SANS });
        return;
      }

      const { cells } = L.cells(page.length);
      page.forEach((a, j) => {
        const c = L.card(cells[j], 'scene');
        plate(s, { ...c.image, path: firstImage(a), label: a.name, accent: ctx.accent });
        s.addText(a.name, { ...c.title, fontSize: page.length > 3 ? 13 : 15, bold: true, color: INK, fontFace: SANS });
        s.addText(a.summary || '', {
          ...c.body, fontSize: page.length > 3 ? 10 : 11, color: SOFT, fontFace: SANS,
          lineSpacingMultiple: 1.2, shrinkText: true,
        });
        s.addText(activityPrice(a), { ...c.footer, fontSize: 11, bold: true, color: ctx.accent, fontFace: SANS });
      });
    });
  },

  venue(pptx, ctx, d) {
    if (!d.venue) return;
    const s = pptx.addSlide();
    chrome(s, ctx, d.venue.name, 'The space');
    const box = L.split(0.56);
    plate(s, { ...box.left, path: firstImage(d.venue), label: d.venue.name, accent: ctx.accent });
    s.addText(String(d.venue.kind || '').toUpperCase(), {
      x: box.right.x, y: box.right.y, w: box.right.w, h: 0.3,
      fontSize: 10, bold: true, color: ctx.accent, fontFace: SANS, charSpacing: 2,
    });
    s.addText(d.venue.description || '', {
      x: box.right.x, y: box.right.y + 0.4, w: box.right.w, h: 1.8,
      fontSize: 13, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.35,
    });
    if (d.venue.capacity) {
      s.addText(`${d.venue.capacity} guests`, {
        x: box.right.x, y: box.right.y + 2.3, w: box.right.w, h: 0.5,
        fontSize: 22, bold: true, color: INK, fontFace: SANS,
      });
      s.addText('maximum capacity', {
        x: box.right.x, y: box.right.y + 2.78, w: box.right.w, h: 0.3,
        fontSize: 10, color: FAINT, fontFace: SANS,
      });
    }
  },

  logistics(pptx, ctx, d) {
    const list = d.logistics || [];
    if (!list.length) return;
    const s = pptx.addSlide();
    chrome(s, ctx, 'Production and logistics', 'Delivery');
    const rows = [[
      { text: 'ITEM', options: headCell() },
      { text: 'SPECIFICATION', options: headCell() },
      { text: 'BASIS', options: headCell(), },
      { text: 'RATE', options: { ...headCell(), align: 'right' } },
    ]];
    for (const l of list) {
      rows.push([
        { text: l.name, options: bodyCell(true) },
        { text: l.spec || '', options: bodyCell() },
        { text: basisLabel(l.rate_type), options: bodyCell() },
        { text: money(l.rate), options: { ...bodyCell(), align: 'right' } },
      ]);
    }
    s.addTable(rows, {
      x: M, y: 1.9, w: W - M * 2, colW: [3.2, 5.0, 1.8, 2.11],
      border: { type: 'solid', color: RULE, pt: 0.5 }, autoPage: false,
    });
  },

  investment(pptx, ctx, d) {
    /* Stripped of cost before anything is drawn. A buy price on a slide the
       client reads would be worse than a wrong number. */
    const q = clientFacing(d.quote);
    const s = pptx.addSlide();
    chrome(s, ctx, 'Investment', 'Costs');

    const rows = [[
      { text: 'DESCRIPTION', options: headCell() },
      { text: 'QTY', options: { ...headCell(), align: 'right' } },
      { text: 'UNIT', options: { ...headCell(), align: 'right' } },
      { text: 'AMOUNT', options: { ...headCell(), align: 'right' } },
    ]];

    for (const g of q.groups) {
      rows.push([{ text: g.name.toUpperCase(), options: { ...bodyCell(true), fill: WASH, color: ctx.accent, fontSize: 9, charSpacing: 2 } },
        { text: '', options: { fill: WASH } }, { text: '', options: { fill: WASH } },
        { text: money(g.subtotal), options: { ...bodyCell(true), fill: WASH, align: 'right', fontSize: 10 } }]);
      for (const l of g.lines) {
        rows.push([
          { text: [{ text: l.description, options: { bold: true } }, ...(l.detail ? [{ text: `\n${l.detail}`, options: { fontSize: 9, color: FAINT } }] : [])], options: bodyCell() },
          { text: `${l.qty} ${l.unit}`, options: { ...bodyCell(), align: 'right' } },
          { text: money(l.unitPrice), options: { ...bodyCell(), align: 'right' } },
          { text: money(l.amount), options: { ...bodyCell(), align: 'right' } },
        ]);
      }
    }
    s.addTable(rows, {
      x: M, y: 1.75, w: 8.4, colW: [4.3, 1.4, 1.35, 1.35],
      border: { type: 'solid', color: RULE, pt: 0.5 }, autoPage: false, fontSize: 10,
    });

    // The arithmetic sits apart from the lines, so the total is never mistaken
    // for another line item.
    const bx = 9.35;
    s.addShape('rect', { x: bx, y: 1.75, w: 3.35, h: 4.4, fill: { color: WASH }, line: { color: RULE, width: 0.75 } });
    const money_rows = [
      ['Subtotal', q.subtotal],
      ...(q.margin ? [[`Margin (${q.marginPct}%)`, q.margin]] : []),
      [`Service charge (${q.serviceChargePct}%)`, q.serviceCharge],
      [`Tax (${q.taxPct}%)`, q.tax],
    ];
    money_rows.forEach(([k, v], i) => {
      const y = 2.0 + i * 0.48;
      s.addText(k, { x: bx + 0.22, y, w: 1.9, h: 0.3, fontSize: 10, color: SOFT, fontFace: SANS });
      s.addText(money(v), { x: bx + 1.1, y, w: 2.0, h: 0.3, fontSize: 10, color: INK, fontFace: SANS, align: 'right' });
    });
    const ty = 2.0 + money_rows.length * 0.48 + 0.18;
    s.addShape('line', { x: bx + 0.22, y: ty, w: 2.9, h: 0, line: { color: INK, width: 1.5 } });
    s.addText('TOTAL', { x: bx + 0.22, y: ty + 0.16, w: 1.6, h: 0.32, fontSize: 10, bold: true, color: INK, fontFace: SANS, charSpacing: 2 });
    s.addText(money(q.total), { x: bx + 0.22, y: ty + 0.5, w: 2.9, h: 0.55, fontSize: 24, bold: true, color: ctx.accent, fontFace: SANS, align: 'right' });
    s.addText(`${money(q.perPax)} per person`, { x: bx + 0.22, y: ty + 1.06, w: 2.9, h: 0.28, fontSize: 10, color: FAINT, fontFace: SANS, align: 'right' });

    s.addText('All amounts in Malaysian Ringgit. Rates held for 30 days from the date of this proposal.', {
      x: M, y: H - 0.95, w: 9.0, h: 0.28, fontSize: 9, color: FAINT, fontFace: SANS,
    });
  },

  terms(pptx, ctx, d) {
    const s = pptx.addSlide();
    chrome(s, ctx, 'Terms', 'The agreement');
    const items = d.terms && d.terms.length ? d.terms : ctx.defaultTerms;
    s.addText(items.map((t) => ({ text: t, options: { bullet: { code: '2022' }, breakLine: true } })), {
      x: M, y: 1.95, w: W - M * 2, h: 4.4, fontSize: 13, color: SOFT, fontFace: SANS, lineSpacingMultiple: 1.45,
    });
  },

  closing(pptx, ctx, d) {
    const s = pptx.addSlide();
    s.background = { color: INK };
    s.addShape('rect', { x: 0, y: 0, w: W, h: 0.22, fill: { color: ctx.accent } });
    s.addText('We would be glad to run this for you.', {
      x: M, y: 2.5, w: 9.5, h: 1.2, fontSize: 32, bold: true, color: PAPER, fontFace: SERIF,
    });
    s.addText(`Prepared for ${d.client}`, {
      x: M, y: 3.75, w: 9.5, h: 0.4, fontSize: 14, color: PAPER, fontFace: SANS, transparency: 35,
    });
    const contact = [ctx.hostName, ctx.hostPhone, ctx.hostEmail, ctx.hostWebsite].filter(Boolean).join('   ·   ');
    s.addText(contact, {
      x: M, y: H - 1.2, w: W - M * 2, h: 0.4, fontSize: 11, color: PAPER, fontFace: SANS, transparency: 25,
    });
  },
};

const activityMeta = (a) => [
  a.duration_mins ? `${Math.round(a.duration_mins / 60 * 10) / 10} HOURS` : null,
  a.pax_max ? `UP TO ${a.pax_max} PAX` : null,
  a.indoor ? 'INDOOR' : 'OUTDOOR',
].filter(Boolean).join('   ·   ');

const activityPrice = (a) => (a.rate_type === 'per_head'
  ? `${money(a.rate)} per person` : `${money(a.rate)} for the group`);

const headCell = () => ({
  bold: true, fontSize: 9, color: FAINT, fontFace: SANS, charSpacing: 2,
  fill: PAPER, margin: [6, 6, 6, 6], valign: 'bottom',
});
const bodyCell = (bold = false) => ({
  bold, fontSize: 10, color: INK, fontFace: SANS, margin: [6, 6, 6, 6], valign: 'top',
});
const basisLabel = (t) => (t === 'per_day' ? 'per day' : t === 'per_head' ? 'per person' : 'flat');

const DEFAULT_TERMS = [
  'A 50% deposit confirms the booking; the balance falls due seven days before the event.',
  'Rates are held for 30 days from the date of this proposal.',
  'Final head count is required fourteen days before the event date.',
  'Outdoor activities carry an indoor alternative at no additional cost.',
  'Cancellation within fourteen days of the event forfeits the deposit.',
];

/**
 * @param {object} d    the built proposal: template, client, selections, quote
 * @param {object} brand the host company from Settings
 * @param {string} destination absolute path for the .pptx
 */
async function build(d, brand, destination) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W16x9', width: W, height: H });
  pptx.layout = 'W16x9';
  pptx.author = brand.name || 'Cabinet';
  pptx.company = brand.name || '';
  pptx.title = d.title;
  pptx.subject = `Proposal for ${d.client}`;

  const ctx = {
    accent: hex(d.accent || brand.accent, '1F6E62'),
    hostName: brand.name || 'Your company',
    hostLogo: brand.logoPath || null,
    hostBlurb: brand.blurb
      || `${brand.name || 'We'} plan and run corporate events across Malaysia — conferences, incentives, team building and gala dinners. We handle the venue, the production and the people on the day.`,
    hostPhone: brand.phone, hostEmail: brand.email, hostWebsite: brand.website,
    stats: brand.stats || [
      { value: '120+', label: 'events delivered' },
      { value: '15', label: 'years running' },
      { value: '40k', label: 'guests hosted' },
      { value: '5', label: 'destinations covered' },
    ],
    coverImage: d.coverImage || null,
    defaultTerms: DEFAULT_TERMS,
    page: 1,
  };

  const plan = d.slidePlan && d.slidePlan.length ? d.slidePlan
    : ['cover', 'credentials', 'destination', 'venue', 'hotel', 'mc', 'activities', 'logistics', 'investment', 'terms', 'closing'];

  for (const kind of plan) {
    const fn = SLIDES[kind];
    if (fn) fn(pptx, ctx, d);
  }

  await pptx.writeFile({ fileName: destination });
  const st = fs.statSync(destination);
  return { path: destination, bytes: st.size, slides: ctx.page - 1 };
}

module.exports = { build, SLIDES, DEFAULT_TERMS, W, H };

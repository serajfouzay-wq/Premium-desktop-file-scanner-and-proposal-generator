'use strict';

/*
 * One renderer, three destinations: the live preview in the app, the printed
 * PDF, and the Word export. Keeping a single source of truth is the only way
 * the preview can honestly claim to be what the client will receive.
 */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const nl2p = (s) => String(s || '')
  .split(/\n{2,}/)
  .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
  .join('');

function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return currency + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const longDate = (iso) => new Date(iso || Date.now()).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric',
});

/* A placeholder that looks deliberate rather than unfinished — it prints
   cleanly if the user never swaps in a photograph. */
const photoFrame = (image, caption, aspect) => {
  if (image) {
    return `<figure class="plate" style="--aspect:${aspect}">
      <img src="${esc(image)}" alt="${esc(caption || '')}">
      ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
    </figure>`;
  }
  return `<figure class="plate plate-empty" style="--aspect:${aspect}">
    <div class="plate-mark">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/>
        <path d="M21 16l-5-5-6.5 6.5L7 15l-4 4"/>
      </svg>
      <span>${esc(caption || 'Photograph')}</span>
    </div>
  </figure>`;
};

function styles(accent) {
  return `
  :root{
    --accent:${accent};
    --ink:#14191C; --ink-soft:#4C585E; --ink-faint:#8B949A;
    --rule:#DFDCD3; --paper:#FFFFFF; --wash:#F6F5F1;
  }
  @page { size:A4; margin:18mm 16mm 20mm; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:var(--paper); color:var(--ink);
    font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    font-size:10.5pt; line-height:1.62;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  .sheet{ max-width:190mm; margin:0 auto; padding:0 0 24mm; }
  .sans{font-family:Inter,"Segoe UI","SF Pro Text",system-ui,sans-serif}

  /* ---------- cover ---------- */
  .cover{ position:relative; padding:0 0 18mm; break-after:page; }
  .crest{
    display:flex; justify-content:space-between; align-items:flex-start;
    gap:18px; padding:0 0 10mm; border-bottom:1px solid var(--rule);
  }
  .crest img{ max-height:52px; max-width:190px; object-fit:contain; }
  .crest .slot{
    font-family:Inter,system-ui,sans-serif; font-size:7.5pt; letter-spacing:.14em;
    text-transform:uppercase; color:var(--ink-faint);
    border:1px dashed var(--rule); border-radius:3px; padding:14px 18px;
  }
  .crest .who{ text-align:right; font-family:Inter,system-ui,sans-serif;
    font-size:8pt; line-height:1.55; color:var(--ink-soft); }
  .crest .who b{ display:block; color:var(--ink); font-size:9pt; letter-spacing:.01em; }

  .cover-kicker{
    margin:14mm 0 6mm; font-family:Inter,system-ui,sans-serif; font-size:8pt;
    letter-spacing:.24em; text-transform:uppercase; color:var(--accent); font-weight:600;
  }
  .cover h1{
    margin:0; font-size:34pt; line-height:1.08; font-weight:600;
    letter-spacing:-.02em; max-width:15ch;
  }
  .cover .lede{
    margin:6mm 0 0; font-size:13pt; line-height:1.5; color:var(--ink-soft); max-width:46ch;
  }
  .cover-meta{
    display:grid; grid-template-columns:repeat(4,1fr); gap:7mm 6mm; margin:12mm 0 0;
    padding-top:6mm; border-top:1px solid var(--rule);
    font-family:Inter,system-ui,sans-serif; font-size:8.5pt;
  }
  .cover-meta div{ min-width:0 }
  .cover-meta dd{ overflow-wrap:anywhere }
  .cover-meta dt{ letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); font-size:7pt; margin:0 0 3px }
  .cover-meta dd{ margin:0; font-weight:600; font-size:10pt }

  /* ---------- plates ---------- */
  .plate{ margin:8mm 0; break-inside:avoid; }
  .plate img{ width:100%; display:block; border-radius:2px; aspect-ratio:var(--aspect); object-fit:cover; }
  .plate figcaption{
    margin-top:6px; font-family:Inter,system-ui,sans-serif; font-size:7.5pt;
    letter-spacing:.06em; color:var(--ink-faint); text-transform:uppercase;
  }
  .plate-empty{
    aspect-ratio:var(--aspect); border:1px solid var(--rule); border-radius:2px;
    background:
      linear-gradient(135deg,rgba(0,0,0,.015) 25%,transparent 25%,transparent 50%,rgba(0,0,0,.015) 50%,rgba(0,0,0,.015) 75%,transparent 75%) 0 0/14px 14px,
      var(--wash);
    display:flex; align-items:center; justify-content:center;
  }
  .plate-mark{
    display:flex; flex-direction:column; align-items:center; gap:7px; color:var(--ink-faint);
    font-family:Inter,system-ui,sans-serif; font-size:7.5pt; letter-spacing:.16em; text-transform:uppercase;
  }

  /* ---------- sections ---------- */
  section{ break-inside:avoid-page; margin:0 0 11mm; }
  .sec-head{ display:flex; align-items:baseline; gap:12px; margin:0 0 4mm;
    padding-bottom:3mm; border-bottom:1px solid var(--rule); }
  .sec-num{
    font-family:Inter,system-ui,sans-serif; font-size:8pt; font-weight:700;
    color:var(--accent); letter-spacing:.1em; min-width:22px;
  }
  .sec-head h2{ margin:0; font-size:15pt; font-weight:600; letter-spacing:-.01em; }
  section p{ margin:0 0 3.4mm; }
  section p:last-child{ margin-bottom:0 }

  .cite{
    margin-top:3mm; font-family:Inter,system-ui,sans-serif; font-size:7pt;
    letter-spacing:.06em; color:var(--ink-faint);
  }
  .cite b{ font-weight:500 }

  /* ---------- timeline ---------- */
  .phases{ display:flex; gap:10px; margin:6mm 0 0; }
  .phase{ flex:1; border-top:2px solid var(--accent); padding-top:8px; }
  .phase:nth-child(n+2){ border-top-color:var(--rule) }
  .phase b{ display:block; font-family:Inter,system-ui,sans-serif; font-size:7pt;
    letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:3px }
  .phase span{ font-size:9.5pt; font-weight:600 }

  /* ---------- investment ---------- */
  table.invest{ width:100%; border-collapse:collapse; margin-top:4mm; font-family:Inter,system-ui,sans-serif; font-size:9pt; }
  table.invest th{
    text-align:left; font-size:7pt; letter-spacing:.16em; text-transform:uppercase;
    color:var(--ink-faint); font-weight:600; padding:0 0 7px; border-bottom:1px solid var(--rule);
  }
  table.invest td{ padding:9px 0; border-bottom:1px solid var(--rule); vertical-align:top; }
  table.invest .num{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  table.invest .desc b{ font-weight:600 }
  table.invest .desc small{ display:block; color:var(--ink-faint); font-size:7.5pt; margin-top:2px }
  tr.total td{ border-bottom:none; border-top:2px solid var(--ink); padding-top:11px;
    font-size:11pt; font-weight:700; }

  .assume{ margin:5mm 0 0; padding:5mm 6mm; background:var(--wash); border-left:2px solid var(--accent); }
  .assume h3{ margin:0 0 2mm; font-family:Inter,system-ui,sans-serif; font-size:7.5pt;
    letter-spacing:.16em; text-transform:uppercase; color:var(--ink-soft); }
  .assume ul{ margin:0; padding-left:16px }
  .assume li{ margin:0 0 1.5mm; font-size:9.5pt }

  /* ---------- signature ---------- */
  .sign{ display:flex; gap:30px; margin:12mm 0 0; break-inside:avoid; }
  .sign div{ flex:1 }
  .sign .line{ border-bottom:1px solid var(--ink); height:16mm }
  .sign p{ margin:3mm 0 0; font-family:Inter,system-ui,sans-serif; font-size:8pt; color:var(--ink-soft) }
  .sign p b{ display:block; color:var(--ink); font-size:9pt }

  .colophon{
    margin-top:14mm; padding-top:4mm; border-top:1px solid var(--rule);
    font-family:Inter,system-ui,sans-serif; font-size:7.5pt; color:var(--ink-faint);
    display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap;
  }
  @media screen{
    body{ background:#E9E7E0; padding:24px 0 }
    .sheet{ background:#fff; padding:20mm 18mm 18mm; box-shadow:0 18px 50px -20px rgba(0,0,0,.35); }
  }
  `;
}

/**
 * @param {object} doc    { title, subtitle, sections, terms, assumptions, company }
 * @param {object} brand  host company identity
 * @param {Array}  items  line items with user-entered prices
 * @param {object} assets { clientLogo, hero, plates: {sectionIndex: dataURI} }
 */
function renderDocument(doc, brand, items, assets = {}) {
  const currency = brand.currency || '$';
  const accent = brand.accent || '#1F6E62';
  const priced = (items || []).filter((i) => i.description);
  const complete = priced.length > 0 && priced.every((i) => i.unitPrice != null && i.unitPrice !== '');
  const total = priced.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const sections = doc.sections || [];

  const hostCrest = brand.logo
    ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}">`
    : (brand.name
      ? `<div class="sans" style="font-size:13pt;font-weight:700;letter-spacing:-.01em">${esc(brand.name)}</div>`
      : '<div class="slot">Your logo</div>');

  const clientCrest = assets.clientLogo
    ? `<img src="${esc(assets.clientLogo)}" alt="${esc(doc.company)}">`
    : `<div class="who"><b>${esc(doc.company)}</b>Prepared for</div>`;

  const timeline = (doc.phases && doc.phases.length ? doc.phases : null);

  const body = sections.map((s, i) => {
    const plate = assets.plates && assets.plates[i];
    const wantsPlate = plate || i === 1 || i === 3;      // scope and approach carry imagery well
    return `<section>
      <div class="sec-head"><span class="sec-num">${String(i + 1).padStart(2, '0')}</span><h2>${esc(s.heading)}</h2></div>
      ${nl2p(s.body)}
      ${wantsPlate ? photoFrame(plate, s.heading, '16/9') : ''}
      ${(s.citations && s.citations.length)
        ? `<div class="cite">Drawn from ${s.citations.map((c) => `<b>${esc(c)}</b>`).join(', ')}</div>` : ''}
    </section>`;
  }).join('');

  const investRows = priced.map((i) => `<tr>
      <td class="desc"><b>${esc(i.description)}</b>${i.basis ? `<small>${esc(i.basis)}</small>` : ''}</td>
      <td class="num">${esc(i.qty)}${i.unit ? ` ${esc(i.unit)}` : ''}</td>
      <td class="num">${i.unitPrice != null && i.unitPrice !== '' ? money(i.unitPrice, currency) : '—'}</td>
      <td class="num">${i.unitPrice != null && i.unitPrice !== '' ? money((Number(i.qty) || 0) * Number(i.unitPrice), currency) : '—'}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(doc.title)}</title>
<style>${styles(accent)}</style>
</head><body><div class="sheet">

  <div class="cover">
    <div class="crest">
      <div>${hostCrest}</div>
      <div>${clientCrest}</div>
    </div>

    <div class="cover-kicker">${esc(doc.kicker || 'Proposal')}</div>
    <h1>${esc(doc.title)}</h1>
    ${doc.subtitle ? `<p class="lede">${esc(doc.subtitle)}</p>` : ''}

    ${photoFrame(assets.hero, 'Cover photograph', '21/9')}

    <dl class="cover-meta">
      <div><dt>Prepared for</dt><dd>${esc(doc.company)}</dd></div>
      <div><dt>Prepared by</dt><dd>${esc(brand.name || '—')}</dd></div>
      <div><dt>Date</dt><dd>${esc(longDate(doc.date))}</dd></div>
      ${complete ? `<div><dt>Total investment</dt><dd>${esc(money(total, currency))}</dd></div>` : ''}
    </dl>
  </div>

  ${body}

  <section>
    <div class="sec-head"><span class="sec-num">${String(sections.length + 1).padStart(2, '0')}</span><h2>Investment</h2></div>
    <table class="invest">
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${investRows || '<tr><td class="desc" colspan="4">No line items.</td></tr>'}
        ${complete ? `<tr class="total"><td>Total</td><td></td><td></td><td class="num">${esc(money(total, currency))}</td></tr>` : ''}
      </tbody>
    </table>
    ${!complete ? '<p class="cite">Amounts are completed by the author before issue.</p>' : ''}
  </section>

  ${timeline ? `<section>
    <div class="sec-head"><span class="sec-num">${String(sections.length + 2).padStart(2, '0')}</span><h2>Schedule</h2></div>
    <div class="phases">${timeline.map((p) => `<div class="phase"><b>${esc(p.when)}</b><span>${esc(p.what)}</span></div>`).join('')}</div>
  </section>` : ''}

  ${doc.terms ? `<section>
    <div class="sec-head"><span class="sec-num">${String(sections.length + (timeline ? 3 : 2)).padStart(2, '0')}</span><h2>Terms</h2></div>
    ${nl2p(doc.terms)}
  </section>` : ''}

  ${(doc.assumptions && doc.assumptions.length) ? `<div class="assume">
    <h3>Assumptions</h3>
    <ul>${doc.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
  </div>` : ''}

  <div class="sign">
    <div><div class="line"></div><p><b>${esc(brand.name || 'Authorised signatory')}</b>Signature and date</p></div>
    <div><div class="line"></div><p><b>${esc(doc.company)}</b>Signature and date</p></div>
  </div>

  <div class="colophon">
    <span>${esc([brand.name, brand.address].filter(Boolean).join(' · ')) || '&nbsp;'}</span>
    <span>${esc([brand.phone, brand.email, brand.website].filter(Boolean).join(' · '))}</span>
  </div>

</div></body></html>`;
}

module.exports = { renderDocument, money, esc };

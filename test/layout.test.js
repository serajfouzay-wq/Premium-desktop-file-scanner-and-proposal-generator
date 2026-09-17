'use strict';
/* Geometry is invisible until somebody opens the deck, so it is checked here.
   Run with: npm run test:layout */
const L = require('../electron/lib/layout');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const RIGHT = L.SLIDE.w - L.MARGIN;
const BOTTOM = L.BAND.y + L.BAND.h;

// The count decides the shape.
const shapes = { 1: '1x1', 2: '2x1', 3: '3x1', 4: '2x2', 5: '3x2', 6: '3x2' };
for (const [n, want] of Object.entries(shapes)) {
  const g = L.gridFor(Number(n));
  check(`${n} item${n === '1' ? '' : 's'} lays out ${want}`, `${g.cols}x${g.rows}` === want, `${g.cols}x${g.rows}`);
}
check('one item is flagged as a hero', L.gridFor(1).hero === true);
check('more than one is not', L.gridFor(2).hero === false);

for (const n of [1, 2, 3, 4, 5, 6]) {
  const { cells } = L.cells(n);
  check(`${n}: every cell starts at the left margin or beyond`,
    cells.every((c) => c.x >= L.MARGIN - 0.001));
  check(`${n}: nothing crosses the right margin`,
    cells.every((c) => c.x + c.w <= RIGHT + 0.01),
    `widest right edge ${Math.max(...cells.map((c) => c.x + c.w)).toFixed(3)} vs ${RIGHT.toFixed(3)}`);
  check(`${n}: nothing runs into the footer`,
    cells.every((c) => c.y + c.h <= BOTTOM + 0.01));

  // The row must span the full content width — gutters between cells only.
  const row0 = cells.filter((c) => c.row === 0);
  const spanned = row0.reduce((a, c) => a + c.w, 0) + L.GUTTER * (row0.length - 1);
  check(`${n}: the row fills the content width exactly`, near(spanned, L.contentW()),
    `${spanned.toFixed(3)} vs ${L.contentW().toFixed(3)}`);

  // No two cells may overlap.
  let overlap = false;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]; const b = cells[j];
      if (a.x < b.x + b.w - 0.001 && b.x < a.x + a.w - 0.001
        && a.y < b.y + b.h - 0.001 && b.y < a.y + a.h - 0.001) overlap = true;
    }
  }
  check(`${n}: no two cells overlap`, !overlap);
}

// A picture keeps its aspect and stays inside its cell.
const { cells: three } = L.cells(3);
for (const [name, aspect] of Object.entries(L.ASPECT)) {
  const box = L.fitBox(three[0], name, 0.56);
  check(`a ${name} picture keeps its aspect ratio`, near(box.w / box.h, aspect, 0.02),
    `${(box.w / box.h).toFixed(3)} vs ${aspect.toFixed(3)}`);
  check(`a ${name} picture stays inside its cell`,
    box.x >= three[0].x - 0.001 && box.x + box.w <= three[0].x + three[0].w + 0.001
    && box.y + box.h <= three[0].y + three[0].h + 0.001);
}

// A card's text must sit below its picture, never across it.
for (const n of [2, 3, 4, 6]) {
  const { cells } = L.cells(n);
  const c = L.card(cells[0], 'scene');
  check(`${n}: the caption starts below the picture`, c.title.y >= c.image.y + c.image.h,
    `title at ${c.title.y} vs picture ending ${(c.image.y + c.image.h).toFixed(3)}`);
  check(`${n}: the card stays within its cell`,
    c.footer.y + c.footer.h <= cells[0].y + cells[0].h + 0.01);
  check(`${n}: the body has room to exist`, c.body.h > 0.25, `${c.body.h}`);
}

// The hero layout must not let its picture collide with its text column.
for (const a of ['scene', 'venue', 'portrait']) {
  const h = L.hero(a);
  check(`hero (${a}): text clears the picture`, h.title.x >= h.image.x + h.image.w,
    `text at ${h.title.x} vs picture ending ${(h.image.x + h.image.w).toFixed(3)}`);
  check(`hero (${a}): text stays on the slide`, h.title.x + h.title.w <= RIGHT + 0.01);
  check(`hero (${a}): picture stays in the band`, h.image.y + h.image.h <= BOTTOM + 0.01);
}

// Pagination keeps a trailing item from being stranded.
const pages = L.paginate(Array.from({ length: 7 }, (_, i) => i));
check('seven items split into two slides', pages.length === 2, `${pages.map((p) => p.length).join(' + ')}`);
check('the last slide lays out for its own count',
  L.gridFor(pages[1].length).cols === 1, `${pages[1].length} item -> ${L.gridFor(pages[1].length).cols} column`);

console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

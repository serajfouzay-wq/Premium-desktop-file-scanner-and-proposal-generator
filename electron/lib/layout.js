'use strict';

/*
 * Procedural slide geometry.
 *
 * Everything a slide places is computed from the slide's own dimensions and
 * the number of items being placed. There is no per-case hand-positioning, so
 * a deck of three activities and a deck of six are laid out by the same rules
 * and look like the same document.
 *
 * ── The coordinate system ────────────────────────────────────────────────
 * PowerPoint measures in inches. A 16:9 slide is 13.333 x 7.5.
 *
 *   SLIDE.w = 13.333          SLIDE.h = 7.5
 *   MARGIN  = 0.62            the outer gutter on all four sides
 *   BAND.y  = 1.85            where content begins, below the title rule
 *   BAND.h  = 5.15            content height, stopping clear of the footer
 *
 *   contentW = w - 2*MARGIN               = 12.093
 *   contentH = BAND.h                     = 5.15
 *
 * ── Choosing a grid ──────────────────────────────────────────────────────
 * The shape follows the count, because a single item deserves the whole slide
 * and six do not:
 *
 *   n = 1   hero      one image across 55% of the width, text in the rest
 *   n = 2   1 x 2     two tall cards
 *   n = 3   1 x 3     three columns
 *   n = 4   2 x 2
 *   n = 5,6 2 x 3
 *   n > 6   paginated into slides of 6, the last one using the grid for its
 *           own remainder so a trailing single item is not a lonely sliver
 *
 * ── Cell arithmetic ──────────────────────────────────────────────────────
 *   colW = (contentW - GUTTER * (cols - 1)) / cols
 *   rowH = (contentH - GUTTER * (rows - 1)) / rows
 *   x(i) = MARGIN + col * (colW + GUTTER)
 *   y(i) = BAND.y + row * (rowH + GUTTER)
 *
 * Gutters sit only *between* cells, never outside them, which is why the
 * multiplier is (cols - 1). Getting that wrong is what makes a grid drift
 * right and fall off the slide.
 *
 * ── Fitting a picture into a cell ────────────────────────────────────────
 * Photographs arrive at whatever shape the camera produced. Two rules keep
 * them from distorting:
 *
 *   1. The *placeholder* has a fixed aspect, chosen by subject:
 *        scene    16:9   activities, venues, destinations
 *        venue     3:2   hotels and rooms
 *        portrait  3:4   headshots, which are nearly always taller than wide
 *
 *      Its size inside the cell is the largest box of that aspect that fits:
 *        boxW = min(cellW, cellH * aspect)
 *        boxH = boxW / aspect
 *
 *   2. The *image* is drawn with pptxgenjs `sizing: { type: 'cover' }`, which
 *      scales the source until it covers the box and crops the overflow,
 *      centred. The picture is never stretched: it is cropped. That is why the
 *      aspect is chosen per subject — a portrait headshot dropped into a 16:9
 *      box would be cropped through the face.
 *
 * Text then takes the remainder of the cell beneath the picture, so a taller
 * picture yields a shorter caption rather than overlapping it.
 */

const SLIDE = { w: 13.333, h: 7.5 };
const MARGIN = 0.62;
const GUTTER = 0.28;
const BAND = { y: 1.85, h: 5.15 };
const FOOTER_Y = SLIDE.h - 0.5;

const ASPECT = { scene: 16 / 9, venue: 3 / 2, portrait: 3 / 4, square: 1 };

const contentW = () => SLIDE.w - MARGIN * 2;

/** The grid shape for a given number of items. */
function gridFor(n) {
  if (n <= 1) return { cols: 1, rows: 1, hero: true };
  if (n === 2) return { cols: 2, rows: 1, hero: false };
  if (n === 3) return { cols: 3, rows: 1, hero: false };
  if (n === 4) return { cols: 2, rows: 2, hero: false };
  return { cols: 3, rows: 2, hero: false };
}

const PER_SLIDE = 6;

/** Split a list into slide-sized pages. */
function paginate(items, perSlide = PER_SLIDE) {
  const pages = [];
  for (let i = 0; i < items.length; i += perSlide) pages.push(items.slice(i, i + perSlide));
  return pages;
}

/**
 * Cell rectangles for `n` items, in reading order.
 * @returns {{cells: Array<{x,y,w,h,col,row}>, cols, rows, hero}}
 */
function cells(n) {
  const { cols, rows, hero } = gridFor(n);
  const cw = contentW();
  const colW = (cw - GUTTER * (cols - 1)) / cols;
  const rowH = (BAND.h - GUTTER * (rows - 1)) / rows;

  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      col, row,
      x: round(MARGIN + col * (colW + GUTTER)),
      y: round(BAND.y + row * (rowH + GUTTER)),
      w: round(colW),
      h: round(rowH),
    });
  }
  return { cells: out, cols, rows, hero };
}

/**
 * The largest box of a given aspect that fits inside a cell, pinned to its
 * top edge and centred horizontally.
 */
function fitBox(cell, aspectName = 'scene', maxHeightRatio = 1) {
  const aspect = ASPECT[aspectName] || ASPECT.scene;
  const limitH = cell.h * maxHeightRatio;
  let w = Math.min(cell.w, limitH * aspect);
  let h = w / aspect;
  if (h > limitH) { h = limitH; w = h * aspect; }
  return {
    x: round(cell.x + (cell.w - w) / 2),
    y: round(cell.y),
    w: round(w),
    h: round(h),
  };
}

/**
 * A card: a picture with text beneath it, filling the cell exactly.
 * `imageRatio` caps how much of the cell height the picture may take, so the
 * caption always has room.
 */
function card(cell, aspectName = 'scene', imageRatio = 0.56) {
  const image = fitBox(cell, aspectName, imageRatio);
  const textY = round(image.y + image.h + 0.16);
  return {
    image,
    title: { x: cell.x, y: textY, w: cell.w, h: 0.34 },
    body: { x: cell.x, y: round(textY + 0.38), w: cell.w, h: round(Math.max(0.3, cell.y + cell.h - textY - 0.76)) },
    footer: { x: cell.x, y: round(cell.y + cell.h - 0.3), w: cell.w, h: 0.3 },
  };
}

/**
 * The single-item layout: one large picture beside a column of text.
 * Used whenever exactly one item is being shown, so a lone activity gets the
 * slide it deserves instead of a third of one.
 */
function hero(aspectName = 'scene', split = 0.55) {
  const cw = contentW();
  const imageW = round(cw * split);
  const aspect = ASPECT[aspectName] || ASPECT.scene;
  let imageH = round(imageW / aspect);
  if (imageH > BAND.h) imageH = round(BAND.h);
  const textX = round(MARGIN + imageW + GUTTER * 1.6);
  const textW = round(SLIDE.w - MARGIN - textX);
  return {
    image: { x: MARGIN, y: BAND.y, w: imageW, h: imageH },
    kicker: { x: textX, y: BAND.y, w: textW, h: 0.3 },
    title: { x: textX, y: round(BAND.y + 0.38), w: textW, h: 0.6 },
    body: { x: textX, y: round(BAND.y + 1.06), w: textW, h: round(BAND.h - 1.9) },
    footer: { x: textX, y: round(BAND.y + BAND.h - 0.5), w: textW, h: 0.34 },
  };
}

/** Two columns, for a picture set beside a list. */
function split(leftRatio = 0.56) {
  const cw = contentW();
  const leftW = round(cw * leftRatio);
  const rightX = round(MARGIN + leftW + GUTTER * 1.6);
  return {
    left: { x: MARGIN, y: BAND.y, w: leftW, h: BAND.h },
    right: { x: rightX, y: BAND.y, w: round(SLIDE.w - MARGIN - rightX), h: BAND.h },
  };
}

const round = (n) => Math.round(n * 1000) / 1000;


/* ── a grid inside an area measured on the slide itself ──
   cells() above works in a fixed band, which suits a deck we draw ourselves.
   When photographs go into a template page that already has a title on it,
   a fixed band is dangerous: the client's team-building template puts its
   titles from 1.38" to 2.19" down, so a band starting at 1.85" would lay
   photographs across the words. The area has to be measured from what is
   already on the page, and the same column arithmetic then applies inside it. */
/**
 * The arrangement that shows pictures of a given shape as large as possible
 * inside an area, without cropping them.
 *
 * gridFor() above answers "how do you arrange n things", which is the right
 * question for a band of fixed height. It is the wrong question here: four
 * 4:3 photographs in a band 11.7 inches wide and 4.2 high do not want a two
 * by two grid, because each cell would then be nearly three times wider than
 * it is tall and a quarter of every photograph would be cropped away. One row
 * of four fits them whole. So every arrangement is measured and the one that
 * shows the most picture wins — a fixed rule would be wrong half the time.
 */
function bestGridIn(area, n, aspect) {
  if (!(n > 0)) return { cols: 0, rows: 0, cellW: 0, cellH: 0 };
  const ratio = aspect > 0 ? aspect : 1;
  let best = null;
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const colW = (area.w - GUTTER * (cols - 1)) / cols;
    const rowH = (area.h - GUTTER * (rows - 1)) / rows;
    if (colW <= 0 || rowH <= 0) continue;
    /* Keep the picture's shape: whichever of the two limits binds, take it. */
    const cellW = Math.min(colW, rowH * ratio);
    const cellH = cellW / ratio;
    const score = cellW * cellH;
    /* Fewer rows reads better when two arrangements show the same amount. */
    if (!best || score > best.score + 1e-9
      || (Math.abs(score - best.score) < 1e-9 && rows < best.rows)) {
      best = { cols, rows, cellW, cellH, score };
    }
  }
  return best || { cols: n, rows: 1, cellW: area.w / n, cellH: area.h };
}

/* ── a grid inside an area measured on the slide itself ──
   cells() further up works in a fixed band, which suits a deck we draw
   ourselves. When photographs go into a template page that already has a
   title on it, a fixed band is dangerous: the client's team-building template
   puts its titles from 1.38" to 2.19" down, so a band starting at 1.85" would
   lay photographs across the words. The area is measured from what is already
   on the page, and the arrangement is then chosen to suit both that space and
   the shape of the pictures going into it.

   Pass `aspect` (width / height of the pictures) to have them placed whole.
   Without it the cells simply divide the area, as cells() does. */
function cellsIn(area, n, opts = {}) {
  let cols; let rows; let cellW; let cellH;
  if (opts.aspect > 0) {
    const g = bestGridIn(area, n, opts.aspect);
    ({ cols, rows, cellW, cellH } = g);
  } else {
    const g = gridFor(n);
    cols = g.cols;
    rows = g.rows;
    cellW = (area.w - GUTTER * (cols - 1)) / cols;
    cellH = (area.h - GUTTER * (rows - 1)) / rows;
  }

  /* The block is centred in the area, so what is left over sits as an even
     border rather than a gap down one side. */
  const blockW = cols * cellW + GUTTER * (cols - 1);
  const blockH = rows * cellH + GUTTER * (rows - 1);
  const left = area.x + Math.max(0, (area.w - blockW) / 2);
  const top = area.y + Math.max(0, (area.h - blockH) / 2);

  const out = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      col, row,
      x: round(left + col * (cellW + GUTTER)),
      y: round(top + row * (cellH + GUTTER)),
      w: round(cellW),
      h: round(cellH),
    });
  }

  /* An uneven last row is centred too, so three pictures in a grid built for
     four do not sit hard against the left with a hole beside them. */
  const lastRow = out.filter((c) => c.row === rows - 1);
  if (lastRow.length && lastRow.length < cols) {
    const used = lastRow.length * cellW + GUTTER * (lastRow.length - 1);
    const shift = round(area.x + (area.w - used) / 2 - lastRow[0].x);
    lastRow.forEach((c) => { c.x = round(c.x + shift); });
  }

  /* Rounding each edge to a thousandth of an inch can push the far column a
     thousandth past the area. That is 914 EMU and invisible, but a cell
     outside its area by any amount makes "the photographs stay inside the
     space measured for them" untestable, so the far edges are clamped. */
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  for (const c of out) {
    if (c.x + c.w > right) c.w = round(right - c.x);
    if (c.y + c.h > bottom) c.h = round(bottom - c.y);
    if (c.x < area.x) c.x = round(area.x);
    if (c.y < area.y) c.y = round(area.y);
  }
  return { cells: out, cols, rows, hero: n <= 1 };
}

module.exports = {
  cellsIn, bestGridIn,
  SLIDE, MARGIN, GUTTER, BAND, FOOTER_Y, ASPECT, PER_SLIDE,
  gridFor, paginate, cells, fitBox, card, hero, split, contentW,
};

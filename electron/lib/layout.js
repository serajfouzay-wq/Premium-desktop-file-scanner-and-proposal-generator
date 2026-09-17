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

module.exports = {
  SLIDE, MARGIN, GUTTER, BAND, FOOTER_Y, ASPECT, PER_SLIDE,
  gridFor, paginate, cells, fitBox, card, hero, split, contentW,
};

'use strict';
/* Putting photos into a real deck's existing frames.
   The crop maths is checked always. The real-deck half additionally needs a
   .pptx to fill, which is the client's own file and is not in the repository:
     DECK=<deck.pptx> node test/template-images.test.js
   The photographs it inserts are drawn by the test itself. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const tf = require('../electron/lib/template-fill');

const { writePng, SHAPES } = require('./helpers/png');

/* DECK, not TEMPLATE: this test wants a finished deck with a photo grid,
   while test/proposal.test.js wants the blank 12-page template. */
const TEMPLATE = process.env.DECK;
let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

/* ── the pure maths, which needs no files ── */
console.log('\n── crop maths ──');
for (const [label, frame, image] of [
  ['a panorama into a landscape frame', 1.7778, 3.3333],
  ['a portrait into a landscape frame', 1.7778, 0.3333],
  ['a square into a landscape frame', 1.7778, 1.0],
  ['a landscape into a portrait frame', 0.74, 1.7778],
  ['your real 1.33 photos into your 1.78 frames', 1.7778, 1.3333],
]) {
  const c = tf.coverCrop(frame, image);
  const visible = image * (1 - (c.l + c.r) / 100000) / (1 - (c.t + c.b) / 100000);
  check(label, Math.abs(visible - frame) < 0.002, `fills to ratio ${visible.toFixed(4)}`);
  check(`  ${label}: crop is centred`, c.l === c.r && c.t === c.b);
  check(`  ${label}: only one axis is cropped`, (c.l === 0) || (c.t === 0));
}
const none = tf.coverCrop(1.7778, 1.7778);
check('a photo that already fits is not cropped at all',
  none.l === 0 && none.r === 0 && none.t === 0 && none.b === 0);
check('an unknown frame ratio crops nothing rather than guessing',
  JSON.stringify(tf.coverCrop(null, 1.5)) === JSON.stringify({ l: 0, r: 0, t: 0, b: 0 }));

if (!TEMPLATE || !fs.existsSync(TEMPLATE)) {
  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed`);
  console.log('(set DECK to a .pptx with a photo grid to also run the real-deck half)\n');
  process.exit(fail ? 1 : 0);
}

(async () => {
  console.log('\n── filling a real deck ──');
  const before = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const slideNames = Object.keys(before.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));

  /* Find a slide with four frames — the quad grid the real decks use. */
  let target = null;
  for (const n of slideNames.sort((a, b) => (+a.match(/\d+/)) - (+b.match(/\d+/)))) {
    const frames = tf.picturesOf(await before.file(n).async('string'));
    if (frames.length === 4) { target = { slide: +n.match(/\d+/), frames }; break; }
  }
  if (!target) { console.log('  (no four-picture slide found)'); process.exit(fail ? 1 : 0); }
  console.log(`  using slide ${target.slide}, which holds 4 frames`);

  /* Four deliberately awkward shapes, drawn here so the test is self-contained. */
  const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-photos-'));
  const photos = SHAPES.map((sh) =>
    writePng(path.join(photoDir, `${sh.name}.png`), sh.width, sh.height, sh.rgb));
  check('four test photos were drawn', photos.length === 4
    && photos.every((f) => fs.existsSync(f)));

  const mapping = photos.map((_, i) => ({ slide: target.slide, pic: i, field: `photo${i}` }));
  const values = {};
  photos.forEach((p, i) => { values[`photo${i}`] = p; });

  const dest = path.join(os.tmpdir(), `images-test-${Date.now()}.pptx`);
  const res = await tf.fill(TEMPLATE, dest, mapping, values);

  check('no problems reported', res.problems.length === 0, res.problems.join('; '));
  check('all four photos were placed', res.photos.length === 4);

  for (const p of res.photos) {
    const visible = (p.image.width / p.image.height)
      * (1 - (p.crop.l + p.crop.r) / 100000) / (1 - (p.crop.t + p.crop.b) / 100000);
    check(`${path.basename(p.source)} fills its frame exactly`,
      Math.abs(visible - p.frame.ratio) < 0.002,
      `${p.image.width}x${p.image.height} -> ${p.frame.w.toFixed(2)}x${p.frame.h.toFixed(2)}" `
      + `(ratio ${p.frame.ratio.toFixed(3)}), visible ${visible.toFixed(3)}`);
  }

  const after = await JSZip.loadAsync(fs.readFileSync(dest));

  /* The geometry must be byte-identical: we changed what is in the frames,
     never where they are. This is what stops a "salad". */
  const xmlBefore = await before.file(`ppt/slides/slide${target.slide}.xml`).async('string');
  const xmlAfter = await after.file(`ppt/slides/slide${target.slide}.xml`).async('string');
  const framesAfter = tf.picturesOf(xmlAfter);
  const geom = (f) => `${f.widthEmu}x${f.heightEmu}`;
  const posOf = (xml) => [...xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((m) => m.slice(1).join(',')).join(' | ');
  check('every frame keeps its exact size',
    target.frames.map(geom).join() === framesAfter.map(geom).join(),
    framesAfter.map((f) => `${f.widthIn.toFixed(2)}x${f.heightIn.toFixed(2)}"`).join('  '));
  check('every shape on the slide keeps its exact position',
    posOf(xmlBefore) === posOf(xmlAfter));

  check('each frame now points at a different image',
    new Set(framesAfter.map((f) => f.embed)).size === 4,
    framesAfter.map((f) => f.embed).join(', '));
  check('every frame has a crop set',
    framesAfter.every((f) => /srcRect/.test(xmlAfter.slice(f.start, f.end))));

  /* Text is addressed separately, so none of it may have moved. */
  const textOf = (xml) => [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('\u0001');
  let textSame = true;
  for (const n of slideNames) {
    if (textOf(await before.file(n).async('string')) !== textOf(await after.file(n).async('string'))) {
      textSame = false;
    }
  }
  check('not one character of text changed anywhere in the deck', textSame);

  /* The original media must survive untouched — the logo is one image part
     shared by many frames, and overwriting bytes would alter every slide. */
  const mediaBefore = Object.keys(before.files).filter((f) => /^ppt\/media\/.+/.test(f));
  let identical = 0;
  for (const m of mediaBefore) {
    const a = await before.file(m).async('nodebuffer');
    const b = after.file(m) ? await after.file(m).async('nodebuffer') : null;
    if (b && a.equals(b)) identical += 1;
  }
  check('all of the original images are still there, byte for byte',
    identical === mediaBefore.length, `${identical}/${mediaBefore.length}`);

  const added = Object.keys(after.files).filter((f) => /^ppt\/media\/filled\d+\./.test(f));
  check('the new photos were added as new parts', added.length === 4, added.join(', '));

  /* Every r:embed on the slide must resolve, or PowerPoint repairs the file. */
  const rels = await after.file(`ppt/slides/_rels/slide${target.slide}.xml.rels`).async('string');
  const declared = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...xmlAfter.matchAll(/r:(?:embed|id|link)="([^"]+)"/g)].map((m) => m[1]);
  check('every image reference resolves to a relationship',
    used.every((u) => declared.has(u)), `${used.length} references checked`);
  const targets = [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => `ppt/media/${m[1]}`);
  check('every relationship points at a file that exists',
    targets.every((t) => after.file(t)), `${targets.length} image parts checked`);

  const ct = await after.file('[Content_Types].xml').async('string');
  check('the png type is declared', /Extension="png"/i.test(ct));
  check('no duplicate type declarations',
    (ct.match(/Default Extension="png"/gi) || []).length === 1);

  console.log(`\n   result: ${(res.bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
  fs.unlinkSync(dest);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

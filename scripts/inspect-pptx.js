'use strict';
/*
 * Reads an existing .pptx and reports what it is made of.
 *
 * Matching a house style means copying real measurements, not eyeballing a
 * screenshot: which fonts, which exact colours, how many slides, what sits
 * where, which slides repeat unchanged and which vary per client. This prints
 * those facts so a template can be written from them.
 *
 *   node scripts/inspect-pptx.js "/path/to/their-proposal.pptx"
 *   node scripts/inspect-pptx.js deck.pptx --text     # full text per slide
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const EMU = 914400;                      // English Metric Units per inch
const inches = (emu) => Math.round((Number(emu) / EMU) * 100) / 100;

function readZip(file) {
  const buf = fs.readFileSync(file);
  const entries = {};
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Not a zip archive — is this really a .pptx?');
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    entries[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const textOf = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
const tally = (list) => [...list.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]);

function main() {
  const file = process.argv[2];
  const wantText = process.argv.includes('--text');
  if (!file) {
    console.error('Usage: node scripts/inspect-pptx.js <file.pptx> [--text]');
    process.exit(1);
  }

  const zip = readZip(file);
  const names = Object.keys(zip);
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  console.log(`\n${path.basename(file)}  ·  ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
  console.log('═'.repeat(72));

  // Slide size tells us the aspect the whole design assumes.
  const pres = zip['ppt/presentation.xml'] ? zip['ppt/presentation.xml']().toString() : '';
  const size = pres.match(/sldSz[^/]*cx="(\d+)"[^/]*cy="(\d+)"/);
  if (size) {
    const w = inches(size[1]); const h = inches(size[2]);
    console.log(`Slide size      ${w} x ${h} in  (${(w / h).toFixed(3)}:1 — ${Math.abs(w / h - 16 / 9) < 0.02 ? '16:9' : Math.abs(w / h - 4 / 3) < 0.02 ? '4:3' : 'custom'})`);
  }
  console.log(`Slides          ${slides.length}`);
  console.log(`Images          ${names.filter((n) => n.startsWith('ppt/media/') && !n.endsWith('/')).length}`);
  console.log(`Layouts         ${names.filter((n) => /slideLayout\d+\.xml$/.test(n)).length}`);

  const allXml = slides.map((n) => zip[n]().toString());
  const joined = allXml.join('\n');

  const fonts = tally([...joined.matchAll(/typeface="([^"]+)"/g)].map((m) => m[1])
    .filter((f) => f && !/^\+/.test(f)));
  const colours = tally([...joined.matchAll(/srgbClr val="([0-9A-Fa-f]{6})"/g)].map((m) => `#${m[1].toUpperCase()}`));
  const sizes = tally([...joined.matchAll(/\ssz="(\d+)"/g)].map((m) => Number(m[1]) / 100));

  console.log(`\nFonts           ${fonts.slice(0, 6).map(([f, n]) => `${f} (${n})`).join(', ') || '— theme defaults only'}`);
  console.log(`Brand colours   ${colours.slice(0, 10).map(([c, n]) => `${c} x${n}`).join('  ')}`);
  console.log(`Text sizes      ${sizes.slice(0, 10).map(([s, n]) => `${s}pt x${n}`).join('  ')}`);

  console.log(`\n${'─'.repeat(72)}\nPER SLIDE\n`);
  const fingerprints = new Map();

  slides.forEach((n, i) => {
    const xml = allXml[i];
    const texts = textOf(xml);
    const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
    const offs = [...xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/g)];
    const tables = (xml.match(/<a:tbl>/g) || []).length;
    const rows = (xml.match(/<a:tr /g) || []).length;

    const heading = texts.find((t) => t.trim().length > 2) || '(no text)';
    console.log(`Slide ${String(i + 1).padStart(2)}  ${heading.slice(0, 54)}`);
    console.log(`          ${texts.length} text runs · ${pics.length} image${pics.length === 1 ? '' : 's'}`
      + `${tables ? ` · ${tables} table (${rows} rows)` : ''} · ${offs.length} positioned shapes`);

    // The largest picture is the one the layout is built around.
    if (pics.length) {
      const picBoxes = pics.map((p) => {
        const m = p[0].match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/);
        return m ? { x: inches(m[1]), y: inches(m[2]), w: inches(m[3]), h: inches(m[4]) } : null;
      }).filter(Boolean).sort((a, b) => b.w * b.h - a.w * a.h);
      picBoxes.slice(0, 3).forEach((b) => {
        console.log(`            image  ${b.w} x ${b.h} in at (${b.x}, ${b.y})  ratio ${(b.w / b.h).toFixed(2)}`);
      });
    }

    if (wantText) texts.slice(0, 14).forEach((t) => t.trim() && console.log(`            "${t.slice(0, 68)}"`));

    /* Slides whose shape repeats are the fixed ones — credentials, terms —
       and the ones that vary are the per-client pages that need rules. */
    const fp = `${pics.length}i/${tables}t/${Math.round(texts.length / 5)}`;
    fingerprints.set(fp, [...(fingerprints.get(fp) || []), i + 1]);
  });

  console.log(`\n${'─'.repeat(72)}\nSHAPES THAT REPEAT\n`);
  [...fingerprints.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([fp, list]) => {
      console.log(`  ${list.length > 1 ? 'repeats' : 'unique '}  slides ${list.join(', ').slice(0, 56)}   (${fp})`);
    });
  console.log('\nA shape appearing once is probably a fixed slide; a shape repeating');
  console.log('across several is the pattern a template rule should generate.\n');
}

main();

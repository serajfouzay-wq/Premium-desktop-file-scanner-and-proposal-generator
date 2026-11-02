'use strict';
const fs = require('fs/promises');
const JSZip = require('jszip');

/*
 * Filling the client's own PowerPoint, rather than drawing a new one.
 *
 * Their requirement is explicit: "Retain the existing standard template and
 * layout. No editing or customisation is required. Content and design should
 * remain fixed." Redrawing their deck from code could only ever approximate
 * it. So the template file itself is the output: every part of it is copied
 * through byte for byte, and only the text inside named placeholder runs is
 * replaced.
 *
 * The placeholders are the runs their designer highlighted yellow and filled
 * with "xxx". They are addressed by slide and by position in document order,
 * which is stable — but position alone is not safe, because a designer who
 * inserts a line shifts every index after it. So each mapping also records
 * the text it expects to find. If the template changes underneath us the fill
 * refuses rather than writing the client's name into the date field.
 */

const YELLOW = 'FFFF00';

const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const escapeXml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slideNumber = (name) => Number((name.match(/slide(\d+)\.xml$/) || [])[1] || 0);

/** Every text run on a slide, in document order, with its position in the XML. */
function runsOf(xml) {
  const out = [];
  const re = /<a:r>([\s\S]*?)<\/a:r>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const seg = m.group || m[1];
    const t = /<a:t>([\s\S]*?)<\/a:t>/.exec(seg);
    if (!t) continue;
    // Offset of the text itself, so a replacement touches nothing else.
    const segStart = m.index + '<a:r>'.length;
    out.push({
      index: out.length,
      text: unescapeXml(t[1]),
      highlighted: seg.includes(YELLOW),
      start: segStart + t.index + '<a:t>'.length,
      end: segStart + t.index + '<a:t>'.length + t[1].length,
    });
  }
  return out;
}

/** A run is a fillable placeholder if it is highlighted and reads as filler. */
const isPlaceholder = (run) => run.highlighted && /^[\sx:.…-]*$/i.test(run.text) && /x/i.test(run.text);

/**
 * Read a template and report what can be filled.
 * @returns {{slides: number, placeholders: Array}}
 */
async function inspect(templatePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const placeholders = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    const runs = runsOf(xml);
    runs.forEach((r) => {
      if (!isPlaceholder(r)) return;
      placeholders.push({
        slide: slideNumber(name),
        // Position among the placeholders of this slide, which is what a
        // mapping refers to — stable against unrelated text edits elsewhere.
        slot: placeholders.filter((p) => p.slide === slideNumber(name)).length,
        text: r.text,
        // A little context helps a human read the mapping file.
        near: runs.slice(Math.max(0, r.index - 3), r.index)
          .map((x) => x.text.trim()).filter(Boolean).slice(-2).join(' '),
      });
    });
  }
  return { slides: slideNames.length, placeholders };
}

/**
 * Fill a template.
 *
 * @param {string} templatePath  the client's .pptx, never modified
 * @param {string} destination   where the filled copy is written
 * @param {Array}  mapping       [{ slide, slot, field, expect }]
 * @param {object} values        { field: 'text to write' }
 * @param {object} opts          { strict = true }
 */
async function fill(templatePath, destination, mapping, values, opts = {}) {
  const strict = opts.strict !== false;
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));

  const bySlide = new Map();
  for (const m of mapping) {
    if (!bySlide.has(m.slide)) bySlide.set(m.slide, []);
    bySlide.get(m.slide).push(m);
  }

  const written = [];
  const skipped = [];
  const problems = [];

  for (const [slide, entries] of bySlide) {
    const name = `ppt/slides/slide${slide}.xml`;
    const file = zip.file(name);
    if (!file) { problems.push(`slide ${slide} is not in this template`); continue; }

    let xml = await file.async('string');
    const runs = runsOf(xml);
    const slots = runs.filter(isPlaceholder);

    /* Apply from the end backwards: every replacement changes the length of
       the XML, and editing forwards would invalidate every later offset. */
    const ordered = entries
      .map((e) => ({ entry: e, run: slots[e.slot] }))
      .sort((a, b) => (b.run ? b.run.start : -1) - (a.run ? a.run.start : -1));

    for (const { entry, run } of ordered) {
      if (!run) { problems.push(`slide ${slide} has no placeholder ${entry.slot} (${entry.field})`); continue; }
      if (entry.expect != null && run.text.trim() !== String(entry.expect).trim()) {
        problems.push(`slide ${slide} slot ${entry.slot} (${entry.field}) reads `
          + `"${run.text.trim()}" but the mapping expects "${entry.expect}" — the template has changed`);
        continue;
      }
      const value = values[entry.field];
      if (value == null || value === '') { skipped.push(entry.field); continue; }
      xml = xml.slice(0, run.start) + escapeXml(value) + xml.slice(run.end);
      written.push({ slide, slot: entry.slot, field: entry.field, value: String(value) });
    }

    zip.file(name, xml);
  }

  if (strict && problems.length) {
    const err = new Error(`The template does not match the mapping:\n  ${problems.join('\n  ')}`);
    err.problems = problems;
    throw err;
  }

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(destination, out);

  return { path: destination, bytes: out.length, written, skipped, problems };
}

/** Read the text of every slide back, for checking what a fill produced. */
async function readText(pptxPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(pptxPath));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const out = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    out.push({
      slide: slideNumber(n),
      runs: [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1])),
    });
  }
  return out;
}

module.exports = { inspect, fill, readText, runsOf, isPlaceholder };

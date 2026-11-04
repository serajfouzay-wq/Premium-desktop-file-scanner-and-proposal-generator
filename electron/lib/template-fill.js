'use strict';
const fs = require('fs/promises');
const JSZip = require('jszip');
const layout = require('./layout');

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
 * @param {Array}  mapping       text slots:    [{ slide, slot, field, expect }]
 *                                table cells:   [{ slide, table, row, col, field, expect }]
 *                                picture slots: [{ slide, pic, field }]
 *                                literal runs:  [{ slide, find, replace, count }]
 *                                after a label: [{ slide, after, field, expect }]
 *                                photo grid:    [{ slide, grid: true, field, max }]
 * @param {object} values        { field: 'text to write' | '/path/to/photo.jpg' }
 * @param {object} opts          { strict = true, blankUnfilled = true, addSlides }
 *
 * `addSlides` creates pages the template has none of:
 *   [{ from: 5, after: 5, title, lines, photos, name }]
 * `from` is the page whose background and layout the new one copies.
 */
async function fill(templatePath, destination, mapping, values, opts = {}) {
  const strict = opts.strict !== false;
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));

  /* A mapping entry addresses one of three things:
       { slide, slot }              a highlighted text placeholder
       { slide, table, row, col }   a table cell, for the pricing pages
       { slide, pic }               a picture frame
     Table cells contain placeholder runs too, so the two kinds of text target
     overlap. Every position is therefore measured on the ORIGINAL slide XML
     and all the edits are applied together, last one first. Editing in two
     passes would shift the offsets of the second. */
  const bySlide = new Map();
  for (const m of mapping) {
    if (!bySlide.has(m.slide)) bySlide.set(m.slide, []);
    bySlide.get(m.slide).push(m);
  }

  const written = [];
  const photos = [];
  const skipped = [];
  const problems = [];
  const originals = new Map();
  const size = await slideSize(zip);

  for (const [slide, entries] of bySlide) {
    const name = `ppt/slides/slide${slide}.xml`;
    const file = zip.file(name);
    if (!file) { problems.push(`slide ${slide} is not in this template`); continue; }

    const original = await file.async('string');
    const runs = runsOf(original);
    const slots = runs.filter(isPlaceholder);
    const tables = tablesOf(original);
    const frames = picturesOf(original);
    const edits = [];
    /* New shapes are appended to the shape tree rather than replacing a span,
       so they are applied after the span edits, when the position of
       </p:spTree> is settled. */
    const appends = [];

    for (const entry of entries) {
      const value = values[entry.field];

      /* ── a table cell ── */
      if (entry.table != null) {
        const table = tables[entry.table];
        const cell = table && table.rows[entry.row] && table.rows[entry.row][entry.col];
        if (!cell) {
          problems.push(`slide ${slide} has no cell [${entry.row}][${entry.col}] in table `
            + `${entry.table} (${entry.field})`
            + (table ? ` — it is ${table.rows.length} rows` : ' — there is no such table'));
          continue;
        }
        if (entry.expect != null && cell.text.trim() !== String(entry.expect).trim()) {
          problems.push(`slide ${slide} cell [${entry.row}][${entry.col}] (${entry.field}) reads `
            + `"${cell.text.trim()}" but the mapping expects "${entry.expect}" — the table has changed`);
          continue;
        }
        if (value == null || value === '') { skipped.push(entry.field); continue; }
        if (!cell.runs.length) {
          problems.push(`slide ${slide} cell [${entry.row}][${entry.col}] (${entry.field}) has no `
            + 'text to replace — an empty cell carries no formatting to keep');
          continue;
        }
        /* Keep the first run's formatting, drop the rest of the cell's text. */
        edits.push({ start: cell.runs[0].start, end: cell.runs[0].end, text: escapeXml(value), field: entry.field });
        for (let i = 1; i < cell.runs.length; i += 1) {
          edits.push({ start: cell.runs[i].start, end: cell.runs[i].end, text: '' });
        }
        written.push({
          slide, table: entry.table, row: entry.row, col: entry.col,
          field: entry.field, value: String(value),
        });
        continue;
      }

      /* ── a table built onto an otherwise empty page ──
         The itinerary page carries a title and nothing else, so the table is
         created, in the space measured below that title. */
      if (entry.rows) {
        const data = Array.isArray(value) ? value : null;
        if (!data || !data.length) { skipped.push(entry.field); continue; }
        const area = freeArea(original, size, entry.area);
        if (!(area.h >= (entry.minHeight != null ? entry.minHeight : 1)) || !(area.w > 0)) {
          problems.push(`slide ${slide} has no room for a table `
            + `(${area.h.toFixed(2)}" free below what is already there)`);
          continue;
        }
        appends.push(buildTable({
          id: maxShapeId(original) + 1,
          name: entry.field,
          rect: area,
          rows: data,
          widths: entry.widths,
          headerRows: entry.headerRows,
          fontSize: entry.fontSize,
        }));
        written.push({ slide, field: entry.field, tableRows: data.length });
        continue;
      }

      /* ── a grid of photographs on an otherwise empty page ──
         The one place the engine chooses geometry. It measures the space left
         on the page and lays the photographs out inside it, so they cannot
         cover the title: one fills the space, three make a row, four a two by
         two, more a three by two with the last row centred. */
      if (entry.grid) {
        const list = (Array.isArray(value) ? value : [value]).filter(Boolean);
        if (!list.length) { skipped.push(entry.field); continue; }
        const area = freeArea(original, size, entry.area);
        const min = entry.minHeight != null ? entry.minHeight : 1.0;
        if (!(area.h >= min) || !(area.w > 0)) {
          problems.push(`slide ${slide} has no room for photographs `
            + `(${area.h.toFixed(2)}" free below what is already there), so `
            + `${entry.field} was not placed`);
          continue;
        }
        const take = list.slice(0, entry.max || 6);
        if (take.length < list.length) {
          problems.push(`slide ${slide} takes ${take.length} photograph(s) for `
            + `${entry.field}; ${list.length - take.length} more were not placed`);
        }
        /* The pictures are read before the grid is laid out, because their
           shape decides how tall a cell should be. */
        const loaded = [];
        for (const src of take) {
          let buffer;
          try {
            buffer = await fs.readFile(src);
          } catch {
            problems.push(`cannot read the photograph ${src} for ${entry.field}`);
            continue;
          }
          const ext = String(src).split('.').pop().toLowerCase().replace(/^jpg$/, 'jpeg');
          if (!MIME[ext]) {
            problems.push(`${entry.field}: ${ext} is not an image format PowerPoint accepts`);
            continue;
          }
          const dim = imageSize(buffer);
          if (!dim) {
            problems.push(`${entry.field}: ${src} is not a readable PNG, JPEG or GIF`);
            continue;
          }
          loaded.push({ src, buffer, ext, dim });
        }
        if (!loaded.length) continue;

        /* The middle shape of the set, so one odd picture does not drag the
           whole row out of proportion. */
        const ratios = loaded.map((l) => l.dim.width / l.dim.height).sort((a, b) => a - b);
        const aspect = ratios[Math.floor(ratios.length / 2)];
        const grid = layout.cellsIn(area, loaded.length, { aspect });
        let nextId = maxShapeId(original) + 1;
        for (let i = 0; i < loaded.length; i += 1) {
          const { src, buffer, ext, dim } = loaded[i];
          const cell = grid.cells[i];
          const crop = coverCrop(cell.w / cell.h, dim.width / dim.height);
          const rId = await addImageRel(zip, slide, buffer, ext);
          appends.push(buildPicture({
            id: nextId,
            name: `${entry.field} ${i + 1}`,
            rId,
            rect: cell,
            crop,
          }));
          nextId += 1;
          photos.push({
            slide,
            field: entry.field,
            source: String(src),
            added: true,
            frame: { x: cell.x, y: cell.y, w: cell.w, h: cell.h, ratio: cell.w / cell.h },
            image: dim,
            crop,
            grid: `${grid.cols}x${grid.rows}`,
            area,
          });
        }
        written.push({
          slide, field: entry.field, placed: loaded.length, grid: `${grid.cols}x${grid.rows}`,
        });
        continue;
      }

      /* ── a picture frame ── */
      if (entry.pic != null) {
        const frame = frames[entry.pic];
        if (!frame) {
          problems.push(`slide ${slide} has no picture frame ${entry.pic} (${entry.field})`
            + ` — it holds ${frames.length}`);
          continue;
        }
        if (value == null || value === '') { skipped.push(entry.field); continue; }
        let buffer;
        try {
          buffer = await fs.readFile(value);
        } catch {
          problems.push(`cannot read the photo for ${entry.field}: ${value}`);
          continue;
        }
        const ext = String(value).split('.').pop().toLowerCase().replace(/^jpg$/, 'jpeg');
        if (!MIME[ext]) {
          problems.push(`${entry.field}: ${ext} is not an image format PowerPoint accepts`);
          continue;
        }
        const size = imageSize(buffer);
        if (!size) {
          problems.push(`${entry.field}: ${value} is not a readable PNG, JPEG or GIF`);
          continue;
        }
        const crop = coverCrop(frame.ratio, size.width / size.height);
        const rId = await addImageRel(zip, slide, buffer, ext);
        const body = repointPictureBody(original.slice(frame.start, frame.end), rId, crop);
        edits.push({ start: frame.start, end: frame.end, text: body, isPicture: true, field: entry.field });
        photos.push({
          slide,
          pic: entry.pic,
          field: entry.field,
          source: String(value),
          frame: { x: frame.xIn, y: frame.yIn, w: frame.widthIn, h: frame.heightIn, ratio: frame.ratio },
          image: size,
          crop,
          inGroup: frame.inGroup,
        });
        continue;
      }

      /* ── the run after a label ──
         This template is largely "LABEL: value" pairs, and several of those
         values are not highlighted, so they have no slot number. Addressing
         the run that follows the label reads the slide the way a person does,
         and tells the two identical "xxxxxx" runs under Email and Mobile
         apart, which a text search cannot. */
      if (entry.after != null) {
        const i = runs.findIndex((r) => r.text.includes(entry.after));
        const next = i >= 0 ? runs.slice(i + 1).find((r) => r.text.trim() !== '') : null;
        if (!next) {
          problems.push(`slide ${slide}: nothing follows "${entry.after}" (${entry.field})`);
          continue;
        }
        if (entry.expect != null && next.text.trim() !== String(entry.expect).trim()) {
          problems.push(`slide ${slide}: the run after "${entry.after}" reads `
            + `"${next.text.trim()}" but the mapping expects "${entry.expect}" `
            + '— the template has changed');
          continue;
        }
        if (value == null || value === '') { skipped.push(entry.field); continue; }
        edits.push({ start: next.start, end: next.end, text: escapeXml(value), field: entry.field });
        written.push({ slide, after: entry.after, field: entry.field, value: String(value) });
        continue;
      }

      /* ── a run addressed by its own text ──
         The template carries notes to whoever fills it in: slide 12 reads
         "Xxxx – link from page 1". Filling the placeholder alone would leave
         the client reading "ABC Sdn Bhd – link from page 1", so these have to
         go. They are not highlighted, so they cannot be addressed by slot
         number; they are addressed by their text, and the expected number of
         occurrences is stated so a template change is noticed. */
      if (entry.find != null) {
        const hits = runs.filter((r) => r.text.includes(entry.find));
        if (entry.count != null && hits.length !== entry.count) {
          problems.push(`slide ${slide}: expected ${entry.count} run(s) containing `
            + `"${entry.find}" but found ${hits.length} — the template has changed`);
          continue;
        }
        if (!hits.length) {
          problems.push(`slide ${slide}: no run contains "${entry.find}"`);
          continue;
        }
        /* `replace` says what to put there regardless of any value, which is
           how the template's own notes to its filler are removed. Without it,
           a missing value must SKIP: replacing with an empty string would
           erase the figure out of a sentence and leave "the rate of  per
           session covers up to ." on the page. */
        if (entry.replace == null && (value == null || value === '')) {
          skipped.push(entry.field || entry.find);
          continue;
        }
        const replacement = entry.replace != null ? entry.replace : String(value);
        for (const r of hits) {
          edits.push({
            start: r.start,
            end: r.end,
            text: escapeXml(r.text.split(entry.find).join(replacement)),
            field: entry.field || entry.find,
          });
        }
        written.push({
          slide, find: entry.find, field: entry.field || null,
          value: replacement, occurrences: hits.length,
        });
        continue;
      }

      /* ── a highlighted text placeholder ── */
      const run = slots[entry.slot];
      if (!run) {
        problems.push(`slide ${slide} has no placeholder ${entry.slot} (${entry.field})`
          + ` — it holds ${slots.length}`);
        continue;
      }
      if (entry.expect != null && run.text.trim() !== String(entry.expect).trim()) {
        problems.push(`slide ${slide} slot ${entry.slot} (${entry.field}) reads `
          + `"${run.text.trim()}" but the mapping expects "${entry.expect}" — the template has changed`);
        continue;
      }
      if (!entry.clear && (value == null || value === '')) { skipped.push(entry.field); continue; }
      const text = entry.clear ? '' : escapeXml(value);
      edits.push({ start: run.start, end: run.end, text, field: entry.field });
      written.push({ slide, slot: entry.slot, field: entry.field, value: entry.clear ? '' : String(value) });
    }

    /* Two mapping entries pointing at the same run is a fault in the mapping,
       not drift in the template, and applying both would leave overlapping
       replacements in the XML — a file PowerPoint offers to repair. So this
       stops the fill whatever `strict` says: tolerating a mismatch is one
       thing, writing a broken file is another. */
    const sorted = edits.slice().sort((a, b) => a.start - b.start);
    const clashes = [];
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) {
        clashes.push(`slide ${slide}: two mapping entries write to the same place `
          + `(${sorted[i - 1].field || '?'} and ${sorted[i].field || '?'}) `
          + '— one of them is addressing the wrong target');
      }
    }
    if (clashes.length) {
      const err = new Error(`The mapping addresses the same place twice:\n  ${clashes.join('\n  ')}`);
      err.problems = clashes;
      throw err;
    }

    let xml = original;
    for (const e of sorted.slice().reverse()) {
      xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
    }
    xml = appendShapes(xml, appends);
    zip.file(name, xml);
    /* Kept so the leftover scan can address runs as they are in the TEMPLATE,
       which is what a mapping entry refers to. */
    originals.set(slide, { xml: original, applied: sorted.map((e) => [e.start, e.end]) });
  }

  /* ── slides the engine creates ──
     Applied after every fill pass, deliberately: adding a slide renumbers
     everything after it, and a mapping entry says "page 8" meaning the page 8
     the designer made. Filling first, then inserting, keeps both true. */
  const added = [];
  for (const spec of (opts.addSlides || [])) {
    try {
      const n = await cloneSlide(zip, spec.from, spec.after);
      const name = `ppt/slides/slide${n}.xml`;
      let xml = await zip.file(name).async('string');

      /* The copy is emptied FIRST, and only then measured. Measuring before
         clearing read the source page as it stands after its own fill — the
         venue page by then carries six photographs reaching almost to the
         bottom edge, so the space left over was negative and every shape was
         written with a negative extent. PowerPoint will not open that. */
      xml = replaceShapes(xml, () => false, []);

      let nextId = maxShapeId(xml) + 1;
      const titleRect = spec.titleRect || { x: 0.813, y: 1.38, w: 7.04, h: 0.81 };
      if (spec.title != null) {
        xml = appendShapes(xml, [buildTextBox({
          id: nextId, name: 'Title', rect: titleRect,
          lines: [{ text: spec.title, bold: true, size: spec.titleSize || 2800 }],
        })]);
        nextId += 1;
      }

      /* Now the area below the title it will actually have. */
      const area = freeArea(xml, size, spec.area);
      checkRect(area, `the ${spec.name || 'new'} page's content area`);

      const built = [];
      const hasText = spec.lines && spec.lines.length;
      const hasPics = spec.photos && spec.photos.length;

      if (hasText) {
        const textRect = hasPics
          ? { ...area, w: area.w * 0.42 }
          : area;
        built.push(buildTextBox({
          id: nextId, name: spec.name || 'Details', rect: textRect, lines: spec.lines,
          fontSize: spec.fontSize,
        }));
        nextId += 1;
      }

      if (hasPics) {
        const picRect = hasText
          ? { ...area, x: area.x + area.w * 0.46, w: area.w * 0.54 }
          : area;
        const loaded = [];
        for (const src of spec.photos.slice(0, spec.maxPhotos || 3)) {
          try {
            const buffer = await fs.readFile(src);
            const ext = String(src).split('.').pop().toLowerCase().replace(/^jpg$/, 'jpeg');
            const dim = MIME[ext] ? imageSize(buffer) : null;
            if (dim) loaded.push({ src, buffer, ext, dim });
          } catch { /* reported below */ }
        }
        if (loaded.length) {
          const ratios = loaded.map((l) => l.dim.width / l.dim.height).sort((a, b) => a - b);
          const grid = layout.cellsIn(picRect, loaded.length,
            { aspect: ratios[Math.floor(ratios.length / 2)] });
          for (let i = 0; i < loaded.length; i += 1) {
            const cell = grid.cells[i];
            const crop = coverCrop(cell.w / cell.h,
              loaded[i].dim.width / loaded[i].dim.height);
            const rId = await addImageRel(zip, n, loaded[i].buffer, loaded[i].ext);
            built.push(buildPicture({
              id: nextId, name: `${spec.name || 'photo'} ${i + 1}`, rId, rect: cell, crop,
            }));
            nextId += 1;
            photos.push({
              slide: n, field: spec.name || 'photo', source: loaded[i].src,
              added: true, onNewSlide: true,
              frame: { x: cell.x, y: cell.y, w: cell.w, h: cell.h, ratio: cell.w / cell.h },
              image: loaded[i].dim, crop, grid: `${grid.cols}x${grid.rows}`,
            });
          }
        } else {
          problems.push(`none of the ${spec.photos.length} picture(s) for the `
            + `${spec.name || 'new'} page could be read`);
        }
      }

      xml = appendShapes(xml, built);

      zip.file(name, xml);
      added.push({ slide: n, after: spec.after, from: spec.from, title: spec.title || null });
    } catch (err) {
      problems.push(`could not add the ${spec.name || 'new'} page: ${err.message}`);
    }
  }

  /* What is still a placeholder. A deck that reaches a client with "xxx" on
     it is worse than one that was never produced, so every slide is read back
     — not only the ones we touched — and anything that still looks like a
     placeholder is named, with the words around it so it can be found. */
  const remaining = [];
  for (const n of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const slide = slideNumber(n);
    /* Measured on the TEMPLATE, not on what was just written. A slot number
       taken from the filled file is useless for addressing: the runs we filled
       no longer look like placeholders, so every index after them has shifted,
       and handing that number back would write to the wrong run. */
    const cached = originals.get(slide);
    const xml = cached ? cached.xml : await zip.file(n).async('string');
    const applied = cached ? cached.applied : [];
    const all = runsOf(xml);
    const slotsHere = all.filter(isPlaceholder);
    all.forEach((r, i) => {
      if (!/^[\s]*[xX]{2,}[\s.:·–-]*$/.test(r.text)) return;
      /* Skip the ones this fill wrote to. */
      if (applied.some(([a, b]) => r.start >= a && r.end <= b)) return;
      const before = all.slice(Math.max(0, i - 2), i).map((x) => x.text).join(' ').trim();
      const slot = slotsHere.indexOf(r);
      remaining.push({
        slide,
        slot: slot >= 0 ? slot : null,
        text: r.text.trim(),
        highlighted: r.highlighted,
        after: before.slice(-48) || null,
        /* Pass this straight back to fill() with a field name to have it
           filled: the interface can offer the leftover to the person and
           place what they type without them opening PowerPoint. */
        address: slot >= 0
          ? { slide, slot }
          : { slide, after: before.replace(/\s+/g, ' ').trim().split(' ').slice(-2).join(' ') || null },
      });
    });
  }
  remaining.sort((a, b) => a.slide - b.slide);

  /* ── clear what is left ──
     A placeholder is a note to whoever fills the template in, not content: a
     deck that reaches a client showing "xxx" looks unfinished whatever else is
     right about it. So any run that is nothing but a placeholder is emptied,
     and what was emptied is reported, because an empty line on a price table
     still needs somebody to look at it before the deck goes out.

     Only a run that is ENTIRELY a placeholder is cleared. "RM xxx per session
     covers up to xxx participants" is a sentence with gaps in it, and blanking
     part of it would leave broken prose, so those are reported instead. */
  const blanked = [];
  const leftInProse = [];
  if (opts.blankUnfilled !== false) {
    /* A table cell is cleared whole, never run by run. The total cell on page
       8 holds "xxx +Xxx +": emptying its placeholders one at a time would
       leave a lone "+" sitting in the column, so if everything in a cell is
       placeholder and punctuation the whole cell goes. */
    const PURE = /^[\s]*[xX]{2,}[\s.:·–+-]*$/;
    const CELL_PLACEHOLDER = /^[\sxX.:·–+()-]*$/;

    for (const n of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const slide = slideNumber(n);
      let xml = await zip.file(n).async('string');
      const clears = [];

      const cellRanges = [];
      for (const table of tablesOf(xml)) {
        for (const row of table.rows) {
          for (const cell of row) {
            if (!cell.runs.length) continue;
            if (!/[xX]{2,}/.test(cell.text)) continue;
            if (!CELL_PLACEHOLDER.test(cell.text)) continue;
            for (const r of cell.runs) clears.push({ start: r.start, end: r.end });
            cellRanges.push([cell.start, cell.end]);
            blanked.push({ slide, was: cell.text.trim(), cell: [cell.row, cell.col] });
          }
        }
      }

      for (const r of runsOf(xml)) {
        if (!PURE.test(r.text)) continue;
        if (cellRanges.some(([a, b]) => r.start >= a && r.end <= b)) continue;
        clears.push({ start: r.start, end: r.end });
        blanked.push({ slide, was: r.text.trim() });
      }

      if (!clears.length) continue;
      clears.sort((a, b) => b.start - a.start);
      for (const c of clears) xml = xml.slice(0, c.start) + xml.slice(c.end);
      zip.file(n, xml);
    }

    /* A placeholder left inside a sentence cannot simply be emptied: "For
       Professional Fees, the rate of RM xxx per session covers up to xxx
       participants." becomes "the rate of  per session covers up to ." which
       is worse than the placeholder was. The sentence means nothing without
       its figures, so the whole paragraph goes, and what went is reported.

       A text body must keep at least one paragraph to stay valid, so where it
       is the only one its runs are emptied instead of the paragraph removed. */
    for (const n of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
      const slide = slideNumber(n);
      let xml = await zip.file(n).async('string');
      const cuts = [];
      for (const body of xml.matchAll(/<(a:txBody|p:txBody)>[\s\S]*?<\/\1>/g)) {
        const paras = [...body[0].matchAll(/<a:p>[\s\S]*?<\/a:p>/g)];
        for (const para of paras) {
          const text = [...para[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map((t) => unescapeXml(t[1])).join('');
          if (!/[xX]{3,}/.test(text)) continue;
          const at = body.index + para.index;
          if (paras.length > 1) {
            cuts.push({ start: at, end: at + para[0].length, text: '' });
          } else {
            /* Keep the paragraph, drop its runs. */
            for (const r of para[0].matchAll(/<a:r>[\s\S]*?<\/a:r>/g)) {
              cuts.push({ start: at + r.index, end: at + r.index + r[0].length, text: '' });
            }
          }
          leftInProse.push({ slide, text: text.trim().slice(0, 70), removed: true });
        }
      }
      if (!cuts.length) continue;
      cuts.sort((a, b) => b.start - a.start);
      for (const c of cuts) xml = xml.slice(0, c.start) + c.text + xml.slice(c.end);
      zip.file(n, xml);
    }
  }
  blanked.sort((a, b) => a.slide - b.slide);

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

  return {
    path: destination,
    bytes: out.length,
    written,
    photos,
    skipped,
    problems,
    /* Where a placeholder was before it was cleared, so somebody can check. */
    remaining,
    blanked,
    leftInProse,
    /* Slides the engine created, which the template did not have. */
    added,
  };
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


/* ───────────────────────── pictures ─────────────────────────
   A photo goes into a frame the template already contains. We never create a
   frame, move one, or resize one, so a photo cannot land on top of text or
   drift out of the slide: the position and size are the designer's, not ours.
   Two rules make the result look deliberate rather than stretched:

   1. We re-point the frame at a NEW image part rather than overwriting the
      bytes of the old one. The same picture is often reused across slides —
      the logo is one part referenced by many frames — so overwriting bytes
      would silently change every slide that shares it.

   2. We crop to cover. A 4000x3000 photo (ratio 1.33) in a 6.67x3.75 frame
      (ratio 1.78) is too tall, so we trim equal slivers off the top and
      bottom until what remains matches the frame exactly, and the photo fills
      it edge to edge at its true proportions. Nothing is squashed, and the
      subject stays centred. PowerPoint does this through <a:srcRect>, whose
      four insets are in thousandths of a percent of the original image. */

const EMU_PER_INCH = 914400;

/** Pixel size of a PNG, JPEG or GIF, read from its header. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      /* SOF0..SOF15, skipping the four that are not frame headers. */
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buf.length > 10 && buf.slice(0, 3).toString('latin1') === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

/**
 * Insets that make an image of ratio `imageRatio` exactly cover a frame of
 * ratio `frameRatio`, in thousandths of a percent, centred.
 */
function coverCrop(frameRatio, imageRatio) {
  const zero = { l: 0, r: 0, t: 0, b: 0 };
  if (!(frameRatio > 0) || !(imageRatio > 0)) return zero;
  if (Math.abs(frameRatio - imageRatio) < 0.001) return zero;
  if (imageRatio > frameRatio) {
    /* Too wide: keep a centred column frameRatio/imageRatio wide. */
    const trim = Math.round(((1 - frameRatio / imageRatio) / 2) * 100000);
    return { l: trim, r: trim, t: 0, b: 0 };
  }
  /* Too tall: keep a centred band imageRatio/frameRatio high. */
  const trim = Math.round(((1 - imageRatio / frameRatio) / 2) * 100000);
  return { l: 0, r: 0, t: trim, b: trim };
}

/** Every <p:pic> on a slide, with its frame geometry and current embed id. */
function picturesOf(xml) {
  const out = [];
  const re = /<p:pic>[\s\S]*?<\/p:pic>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[0];
    const embed = (body.match(/r:embed="([^"]+)"/) || [])[1] || null;
    const ext = body.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const off = body.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const name = (body.match(/name="([^"]*)"/) || [])[1] || '';
    out.push({
      index: out.length,
      name,
      embed,
      start: m.index,
      end: m.index + body.length,
      widthEmu: ext ? Number(ext[1]) : null,
      heightEmu: ext ? Number(ext[2]) : null,
      widthIn: ext ? Number(ext[1]) / EMU_PER_INCH : null,
      heightIn: ext ? Number(ext[2]) / EMU_PER_INCH : null,
      xIn: off ? Number(off[1]) / EMU_PER_INCH : null,
      yIn: off ? Number(off[2]) / EMU_PER_INCH : null,
      ratio: ext && Number(ext[2]) ? Number(ext[1]) / Number(ext[2]) : null,
      inGroup: false,
    });
  }
  /* A picture inside a group is scaled by the group, so its own ext is not the
     rendered size. Mark those: we still fill them, but the crop is advisory. */
  const groups = [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)];
  for (const pic of out) {
    pic.inGroup = groups.some((g) => pic.start > g.index && pic.end < g.index + g[0].length);
  }
  return out;
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff', webp: 'image/webp',
};

/** Declare an image extension in [Content_Types].xml if it is not already. */
async function ensureContentType(zip, ext) {
  const path = '[Content_Types].xml';
  const xml = await zip.file(path).async('string');
  if (new RegExp(`Default Extension="${ext}"`, 'i').test(xml)) return;
  const mime = MIME[ext] || 'application/octet-stream';
  zip.file(path, xml.replace('<Types ', '<Types ').replace(
    /(<Types[^>]*>)/,
    `$1<Default Extension="${ext}" ContentType="${mime}"/>`,
  ));
}

/** Add an image part and return a fresh relationship id on that slide. */
async function addImageRel(zip, slideNum, buffer, ext) {
  const relPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
  const rels = await zip.file(relPath).async('string');
  const used = new Set([...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  const rId = `rId${n}`;

  const media = Object.keys(zip.files).filter((f) => /^ppt\/media\//.test(f));
  let k = 1;
  while (media.includes(`ppt/media/filled${k}.${ext}`)) k += 1;
  const part = `ppt/media/filled${k}.${ext}`;

  zip.file(part, buffer);
  await ensureContentType(zip, ext);
  zip.file(relPath, rels.replace(
    /<\/Relationships>/,
    `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/filled${k}.${ext}"/></Relationships>`,
  ));
  return rId;
}

/** The XML of one <p:pic>, pointed at a new relationship with a cover crop. */
function repointPictureBody(body, rId, crop) {
  body = body.replace(/(<a:blip[^>]*\sr:embed=")[^"]+(")/, `$1${rId}$2`);
  const rect = `<a:srcRect l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"/>`;
  if (/<a:srcRect\b[^>]*\/>/.test(body)) {
    body = body.replace(/<a:srcRect\b[^>]*\/>/, rect);
  } else if (/<a:srcRect\b[\s\S]*?<\/a:srcRect>/.test(body)) {
    body = body.replace(/<a:srcRect\b[\s\S]*?<\/a:srcRect>/, rect);
  } else {
    /* Goes immediately after the blip, which is where the schema wants it. */
    body = body.replace(/(<a:blip[^>]*(?:\/>|>[\s\S]*?<\/a:blip>))/, `$1${rect}`);
  }
  return body;
}

/** Point one <p:pic> at a new relationship and set its cover crop. */
function repointPicture(xml, pic, rId, crop) {
  return xml.slice(0, pic.start)
    + repointPictureBody(xml.slice(pic.start, pic.end), rId, crop)
    + xml.slice(pic.end);
}


/* ───────────────────────── tables ─────────────────────────
   A price must never be written into the wrong column. On the investment
   pages the placeholders are table cells, and in the XML they arrive as a flat
   run of "Xxx", "xxx", "Xxx"... with nothing to say which is a unit, which a
   unit price and which a total. Counting along that sequence would put a unit
   price in the total column the first time the client edits a row.

   So a cell is addressed by where it sits: { slide, table, row, col }. That
   survives edits to the wording, and a row added or removed is reported rather
   than silently shifting every figure after it. */

/** Tables on a slide, as a grid of cells with their text and XML extent. */
function tablesOf(xml) {
  const tables = [];
  const tblRe = /<a:tbl>[\s\S]*?<\/a:tbl>/g;
  let t;
  while ((t = tblRe.exec(xml))) {
    const body = t[0];
    const rows = [];
    const rowRe = /<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g;
    let r;
    while ((r = rowRe.exec(body))) {
      const cells = [];
      const cellRe = /<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g;
      let c;
      while ((c = cellRe.exec(r[0]))) {
        /* Offsets are kept absolute to the slide XML so a write can be placed
           without re-deriving the position from the nesting. */
        const absolute = t.index + r.index + c.index;
        const texts = [...c[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
        cells.push({
          row: rows.length,
          col: cells.length,
          text: texts.map((m) => unescapeXml(m[1])).join(''),
          runs: texts.map((m) => ({
            start: absolute + m.index + '<a:t>'.length,
            end: absolute + m.index + '<a:t>'.length + m[1].length,
            text: unescapeXml(m[1]),
          })),
          start: absolute,
          end: absolute + c[0].length,
        });
      }
      rows.push(cells);
    }
    tables.push({ index: tables.length, rows, start: t.index, end: t.index + body.length });
  }
  return tables;
}

/**
 * Write text into one table cell, keeping the cell's own formatting by
 * replacing the text of its first run and emptying any that follow.
 */
function writeCell(xml, cell, value) {
  if (!cell.runs.length) return xml;
  let out = xml;
  /* Back to front, so earlier offsets stay valid. */
  for (let i = cell.runs.length - 1; i >= 1; i -= 1) {
    const run = cell.runs[i];
    out = out.slice(0, run.start) + out.slice(run.end);
  }
  const first = cell.runs[0];
  return out.slice(0, first.start) + escapeXml(value) + out.slice(first.end);
}

/** A readable dump of every table on every slide, for building a mapping. */
async function inspectTables(templatePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const out = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    const tables = tablesOf(xml);
    if (!tables.length) continue;
    out.push({
      slide: slideNumber(n),
      tables: tables.map((tb) => ({
        index: tb.index,
        rows: tb.rows.length,
        cols: Math.max(0, ...tb.rows.map((r) => r.length)),
        cells: tb.rows.map((r) => r.map((c) => c.text)),
      })),
    });
  }
  return out;
}


/* ───────── putting photographs onto an empty page ─────────
   Pages 5, 6 and 7 of the client's template carry a title and nothing else:
   "Program Venue & Photo", "Program Itinerary", "Activity Detail". A frame
   has to be created there rather than filled, which is the one case where the
   engine decides geometry. Two rules keep that safe:

   1. The space is measured, never assumed. Everything already on the page is
      read, and photographs go below the lowest of it. The titles here run to
      2.19 inches down, so a hard-coded content band starting at 1.85 would
      print pictures across the words.
   2. The left and right edges follow the title's own left edge, so the block
      lines up with the page rather than with a margin from somewhere else. */

const SLIDE_DEFAULT = { w: 13.333, h: 7.5 };
const round3 = (n) => Math.round(n * 1000) / 1000;

/** The slide size, in inches, from the presentation part. */
async function slideSize(zip) {
  const f = zip.file('ppt/presentation.xml');
  if (!f) return { ...SLIDE_DEFAULT };
  const xml = await f.async('string');
  const m = xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
    || xml.match(/<p:sldSz[^>]*cy="(\d+)"[^>]*cx="(\d+)"/);
  if (!m) return { ...SLIDE_DEFAULT };
  return { w: Number(m[1]) / EMU_PER_INCH, h: Number(m[2]) / EMU_PER_INCH };
}

/** Every positioned shape on a slide, in inches. */
function boxesOf(xml) {
  const out = [];
  const re = /<(p:sp|p:pic|p:graphicFrame|p:grpSp)\b[\s\S]*?<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const off = m[0].match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const ext = m[0].match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!off || !ext) continue;
    out.push({
      kind: m[1],
      x: Number(off[1]) / EMU_PER_INCH,
      y: Number(off[2]) / EMU_PER_INCH,
      w: Number(ext[1]) / EMU_PER_INCH,
      h: Number(ext[2]) / EMU_PER_INCH,
      text: [...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('').trim(),
    });
  }
  return out;
}

/**
 * The free rectangle below everything already on a slide.
 * @param {string} xml
 * @param {{w:number,h:number}} slide
 * @param {{gutter:number, margin:number}} opts
 */
function freeArea(xml, slide = SLIDE_DEFAULT, opts = {}) {
  const gutter = opts.gutter != null ? opts.gutter : 0.28;
  const boxes = boxesOf(xml);
  /* A full-bleed background is not an obstacle: it covers the whole page, so
     taking it as "occupied" would leave nowhere to put anything. */
  const content = boxes.filter((b) => !(b.w >= slide.w - 0.05 && b.h >= slide.h - 0.05));
  const bottom = content.length ? Math.max(...content.map((b) => b.y + b.h)) : 0;
  /* Follow the existing left edge where there is one, so the block lines up
     with the title instead of with a margin invented here. */
  const left = content.length
    ? Math.min(...content.map((b) => b.x))
    : (opts.margin != null ? opts.margin : 0.62);
  const marginX = Math.max(0.2, left);
  const top = bottom > 0 ? bottom + gutter : marginX;
  const marginBottom = opts.margin != null ? opts.margin : marginX;
  return {
    x: round3(marginX),
    y: round3(top),
    w: round3(slide.w - marginX * 2),
    h: round3(slide.h - top - marginBottom),
    measuredFrom: content.length ? `${content.length} shape(s), lowest at ${round3(bottom)}"` : 'an empty page',
  };
}

const emu = (inches) => Math.round(inches * EMU_PER_INCH);

/* PowerPoint will not open a shape with a zero or negative extent, and the
   failure is silent in the XML: cx="-914400" simply does not match a reader
   expecting digits. So a rectangle is checked before anything is built from
   it, and the caller is told rather than handed a broken file. */
function checkRect(rect, what) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) {
    throw new Error(`${what} has no room on the page `
      + `(${rect ? `${rect.w.toFixed(2)}x${rect.h.toFixed(2)}"` : 'no rectangle'})`);
  }
  return rect;
}

/** The largest shape id in use on a slide, so a new one does not collide. */
function maxShapeId(xml) {
  let max = 1;
  for (const m of xml.matchAll(/<p:cNvPr\s+id="(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** A <p:pic> element placed at a rectangle given in inches. */
function buildPicture({ id, name, rId, rect, crop }) {
  checkRect(rect, `the picture "${name}"`);
  const c = crop || { l: 0, t: 0, r: 0, b: 0 };
  return '<p:pic>'
    + '<p:nvPicPr>'
    + `<p:cNvPr id="${id}" name="${escapeXml(name)}"/>`
    + '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
    + '<p:nvPr/>'
    + '</p:nvPicPr>'
    + '<p:blipFill>'
    + `<a:blip r:embed="${rId}"/>`
    + `<a:srcRect l="${c.l}" t="${c.t}" r="${c.r}" b="${c.b}"/>`
    + '<a:stretch><a:fillRect/></a:stretch>'
    + '</p:blipFill>'
    + '<p:spPr>'
    + `<a:xfrm><a:off x="${emu(rect.x)}" y="${emu(rect.y)}"/>`
    + `<a:ext cx="${emu(rect.w)}" cy="${emu(rect.h)}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    + '</p:spPr>'
    + '</p:pic>';
}

/** Add the elements to a slide's shape tree, which is where they must sit. */
function appendShapes(xml, elements) {
  if (!elements.length) return xml;
  const close = xml.lastIndexOf('</p:spTree>');
  if (close < 0) return xml;
  return xml.slice(0, close) + elements.join('') + xml.slice(close);
}


/* ───────── building new shapes ─────────
   Everything above fills what a designer already drew. These two create: a
   table for the itinerary page, and a whole slide for the trainer, because
   the client's template has neither. Both follow the theme rather than
   carrying colours of their own — text asks for the theme's minor font
   (`+mn-lt`) and the header fills with `accent1`, so if the client restyles
   the deck these follow it. */

const esc = (v) => escapeXml(String(v == null ? '' : v));

/** A cell's text body; a newline in the text becomes a new paragraph. */
function cellBody(text, { bold = false, size = 1100, align = 'l', colour = null } = {}) {
  const runs = String(text == null ? '' : text).split('\n').map((line) => {
    const fill = colour ? `<a:solidFill><a:srgbClr val="${colour}"/></a:solidFill>` : '';
    return `<a:p><a:pPr algn="${align}"/>`
      + `<a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}" dirty="0">`
      + `${fill}<a:latin typeface="+mn-lt"/></a:rPr>`
      + `<a:t>${esc(line)}</a:t></a:r></a:p>`;
  });
  return `<a:txBody><a:bodyPr/><a:lstStyle/>${runs.join('')}</a:txBody>`;
}

/**
 * A table as a <p:graphicFrame>, placed at a rectangle given in inches.
 * @param {object} o  { id, name, rect, rows, widths, headerRows, fontSize }
 */
function buildTable(o) {
  const { id, name = 'Table', rect, rows } = o;
  checkRect(rect, `the table "${name}"`);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  /* Column widths as fractions of the frame, defaulting to equal. */
  const fractions = o.widths && o.widths.length === cols
    ? o.widths
    : new Array(cols).fill(1 / cols);
  const total = fractions.reduce((a, b) => a + b, 0) || 1;
  const grid = fractions
    .map((f) => `<a:gridCol w="${emu((f / total) * rect.w)}"/>`).join('');

  const headerRows = o.headerRows != null ? o.headerRows : 1;
  const size = o.fontSize || 1100;
  /* Rows are given a nominal height; PowerPoint grows them to fit the text. */
  const rowH = emu(Math.max(0.24, rect.h / Math.max(1, rows.length)));

  const body = rows.map((row, r) => {
    const isHeader = r < headerRows || /^TIME$/.test(String(row[0] || ''));
    const cells = [];
    for (let c = 0; c < cols; c += 1) {
      const fillTag = isHeader
        ? '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'
        : '';
      cells.push('<a:tc>'
        + cellBody(row[c], {
          bold: isHeader,
          size,
          align: c === 0 ? 'ctr' : 'l',
          colour: isHeader ? 'FFFFFF' : null,
        })
        + `<a:tcPr marL="54000" marR="54000" marT="27000" marB="27000" anchor="ctr">`
        + '<a:lnL w="6350"><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></a:lnL>'
        + '<a:lnR w="6350"><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></a:lnR>'
        + '<a:lnT w="6350"><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></a:lnT>'
        + '<a:lnB w="6350"><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></a:lnB>'
        + `${fillTag}</a:tcPr>`
        + '</a:tc>');
    }
    return `<a:tr h="${rowH}">${cells.join('')}</a:tr>`;
  }).join('');

  return '<p:graphicFrame>'
    + '<p:nvGraphicFramePr>'
    + `<p:cNvPr id="${id}" name="${esc(name)}"/>`
    + '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>'
    + '<p:nvPr/>'
    + '</p:nvGraphicFramePr>'
    + `<p:xfrm><a:off x="${emu(rect.x)}" y="${emu(rect.y)}"/>`
    + `<a:ext cx="${emu(rect.w)}" cy="${emu(rect.h)}"/></p:xfrm>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl>'
    + '<a:tblPr firstRow="1" bandRow="1"/>'
    + `<a:tblGrid>${grid}</a:tblGrid>`
    + body
    + '</a:tbl>'
    + '</a:graphicData></a:graphic>'
    + '</p:graphicFrame>';
}

/** A plain text box at a rectangle given in inches. */
function buildTextBox(o) {
  const { id, name = 'Text', rect, lines } = o;
  checkRect(rect, `the text box "${name}"`);
  const size = o.fontSize || 1200;
  const paras = (Array.isArray(lines) ? lines : [lines]).map((line) => {
    const text = typeof line === 'string' ? line : line.text;
    const bold = typeof line === 'object' && line.bold;
    const sz = (typeof line === 'object' && line.size) || size;
    return `<a:p><a:pPr algn="${o.align || 'l'}"/>`
      + `<a:r><a:rPr lang="en-US" sz="${sz}" b="${bold ? 1 : 0}" dirty="0">`
      + '<a:latin typeface="+mn-lt"/></a:rPr>'
      + `<a:t>${esc(text)}</a:t></a:r></a:p>`;
  }).join('');
  return '<p:sp>'
    + `<p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/>`
    + '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + `<p:spPr><a:xfrm><a:off x="${emu(rect.x)}" y="${emu(rect.y)}"/>`
    + `<a:ext cx="${emu(rect.w)}" cy="${emu(rect.h)}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr>`
    + `<a:lstStyle/>${paras}</p:txBody>`
    + '</p:sp>';
}

/**
 * Copy a slide and put the copy at a chosen place in the deck.
 *
 * A .pptx keeps the running order in presentation.xml, the part list in
 * [Content_Types].xml and the links in presentation.xml.rels. Miss any of the
 * three and PowerPoint offers to repair the file, so all three are written.
 * The copy points at the same layout and the same images as its source; media
 * is shared rather than duplicated, which is why the file does not grow.
 *
 * @returns {number} the new slide's number
 */
async function cloneSlide(zip, sourceNumber, afterNumber) {
  const srcPath = `ppt/slides/slide${sourceNumber}.xml`;
  const src = zip.file(srcPath);
  if (!src) throw new Error(`slide ${sourceNumber} is not in this deck, so it cannot be copied`);

  const numbers = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .map(slideNumber);
  const next = Math.max(...numbers) + 1;
  const newPath = `ppt/slides/slide${next}.xml`;

  zip.file(newPath, await src.async('string'));

  const srcRels = zip.file(`ppt/slides/_rels/slide${sourceNumber}.xml.rels`);
  if (srcRels) {
    zip.file(`ppt/slides/_rels/slide${next}.xml.rels`, await srcRels.async('string'));
  }

  /* 1. the part list */
  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath).async('string');
  if (!ct.includes(`/ppt/slides/slide${next}.xml`)) {
    ct = ct.replace('</Types>',
      `<Override PartName="/ppt/slides/slide${next}.xml" `
      + 'ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '</Types>');
    zip.file(ctPath, ct);
  }

  /* 2. the link from the presentation */
  const prPath = 'ppt/_rels/presentation.xml.rels';
  let pr = await zip.file(prPath).async('string');
  const used = new Set([...pr.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  const rId = `rId${n}`;
  pr = pr.replace('</Relationships>',
    `<Relationship Id="${rId}" `
    + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" '
    + `Target="slides/slide${next}.xml"/></Relationships>`);
  zip.file(prPath, pr);

  /* 3. the running order */
  const presPath = 'ppt/presentation.xml';
  let pres = await zip.file(presPath).async('string');
  const ids = [...pres.matchAll(/<p:sldId\s+id="(\d+)"/g)].map((m) => Number(m[1]));
  const newId = Math.max(255, ...ids) + 1;
  const entry = `<p:sldId id="${newId}" r:id="${rId}"/>`;

  const list = pres.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (!list) throw new Error('this deck has no slide list, so a slide cannot be added');
  const items = [...list[1].matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => m[0]);
  /* afterNumber is a position in the deck as it reads, 1-based. */
  const at = afterNumber == null
    ? items.length
    : Math.min(items.length, Math.max(0, afterNumber));
  items.splice(at, 0, entry);
  pres = pres.replace(list[0], `<p:sldIdLst>${items.join('')}</p:sldIdLst>`);
  zip.file(presPath, pres);

  return next;
}

/** Replace a slide's shapes, keeping its background and layout. */
function replaceShapes(xml, keep, elements) {
  /* Shapes are dropped back to front so the earlier offsets stay valid. */
  let out = xml;
  const all = [...xml.matchAll(/<(p:sp|p:pic|p:graphicFrame|p:grpSp)\b[\s\S]*?<\/\1>/g)];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const m = all[i];
    const text = [...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((t) => unescapeXml(t[1])).join('').trim();
    if (keep && keep(text, m[0], i)) continue;
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }
  return appendShapes(out, elements);
}

module.exports = {
  inspect, fill, readText, runsOf, isPlaceholder,
  imageSize, coverCrop, picturesOf, addImageRel, repointPicture, repointPictureBody,
  ensureContentType,
  tablesOf, writeCell, inspectTables,
  slideSize, boxesOf, freeArea, buildPicture, appendShapes, maxShapeId,
  buildTable, buildTextBox, cellBody, cloneSlide, replaceShapes, checkRect,
};

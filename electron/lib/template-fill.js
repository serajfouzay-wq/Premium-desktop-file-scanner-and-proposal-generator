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
 * @param {Array}  mapping       text slots:    [{ slide, slot, field, expect }]
 *                                table cells:   [{ slide, table, row, col, field, expect }]
 *                                picture slots: [{ slide, pic, field }]
 *                                literal runs:  [{ slide, find, replace, count }]
 *                                after a label: [{ slide, after, field, expect }]
 * @param {object} values        { field: 'text to write' | '/path/to/photo.jpg' }
 * @param {object} opts          { strict = true }
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
        const replacement = entry.replace != null ? entry.replace
          : (value != null ? String(value) : '');
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
    zip.file(name, xml);
    /* Kept so the leftover scan can address runs as they are in the TEMPLATE,
       which is what a mapping entry refers to. */
    originals.set(slide, { xml: original, applied: sorted.map((e) => [e.start, e.end]) });
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

  return { path: destination, bytes: out.length, written, photos, skipped, problems, remaining };
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

module.exports = {
  inspect, fill, readText, runsOf, isPlaceholder,
  imageSize, coverCrop, picturesOf, addImageRel, repointPicture, repointPictureBody,
  ensureContentType,
  tablesOf, writeCell, inspectTables,
};

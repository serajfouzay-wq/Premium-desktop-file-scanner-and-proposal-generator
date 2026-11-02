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
 *                                picture slots: [{ slide, pic, field }]
 * @param {object} values        { field: 'text to write' | '/path/to/photo.jpg' }
 * @param {object} opts          { strict = true }
 */
async function fill(templatePath, destination, mapping, values, opts = {}) {
  const strict = opts.strict !== false;
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));

  /* A mapping entry addresses either a text run (slot) or a picture frame
     (pic). They are applied in separate passes over the same slide XML. */
  const bySlide = new Map();
  const picsBySlide = new Map();
  for (const m of mapping) {
    const bucket = m.pic != null ? picsBySlide : bySlide;
    if (!bucket.has(m.slide)) bucket.set(m.slide, []);
    bucket.get(m.slide).push(m);
  }
  for (const slide of picsBySlide.keys()) if (!bySlide.has(slide)) bySlide.set(slide, []);

  const written = [];
  const skipped = [];
  const problems = [];
  const photos = [];

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

    /* Pictures. Also back to front, for the same reason: re-pointing a frame
       rewrites that stretch of XML and shifts everything after it. */
    const picEntries = (picsBySlide.get(slide) || []).slice();
    if (picEntries.length) {
      const frames = picturesOf(xml);
      const ordered2 = picEntries
        .map((e) => ({ entry: e, frame: frames[e.pic] }))
        .sort((a, b) => (b.frame ? b.frame.start : -1) - (a.frame ? a.frame.start : -1));

      for (const { entry, frame } of ordered2) {
        if (!frame) {
          problems.push(`slide ${slide} has no picture frame ${entry.pic} (${entry.field})`
            + ` — it holds ${frames.length}`);
          continue;
        }
        const src = values[entry.field];
        if (src == null || src === '') { skipped.push(entry.field); continue; }

        let buffer;
        try {
          buffer = await fs.readFile(src);
        } catch (e) {
          problems.push(`cannot read the photo for ${entry.field}: ${src}`);
          continue;
        }
        const ext = String(src).split('.').pop().toLowerCase().replace('jpg', 'jpeg');
        if (!MIME[ext] && !MIME[`${ext}`]) {
          problems.push(`${entry.field}: ${ext} is not an image format PowerPoint accepts`);
          continue;
        }
        const size = imageSize(buffer);
        if (!size) {
          problems.push(`${entry.field}: ${src} is not a readable PNG, JPEG or GIF`);
          continue;
        }
        const crop = coverCrop(frame.ratio, size.width / size.height);
        const rId = await addImageRel(zip, slide, buffer, ext);
        xml = repointPicture(xml, frame, rId, crop);
        photos.push({
          slide,
          pic: entry.pic,
          field: entry.field,
          source: String(src),
          frame: { x: frame.xIn, y: frame.yIn, w: frame.widthIn, h: frame.heightIn, ratio: frame.ratio },
          image: size,
          crop,
          inGroup: frame.inGroup,
        });
      }
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

  return { path: destination, bytes: out.length, written, photos, skipped, problems };
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

/** Point one <p:pic> at a new relationship and set its cover crop. */
function repointPicture(xml, pic, rId, crop) {
  let body = xml.slice(pic.start, pic.end);
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
  return xml.slice(0, pic.start) + body + xml.slice(pic.end);
}

module.exports = {
  inspect, fill, readText, runsOf, isPlaceholder,
  imageSize, coverCrop, picturesOf, addImageRel, repointPicture, ensureContentType,
};

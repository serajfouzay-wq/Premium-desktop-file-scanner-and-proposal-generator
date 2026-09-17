'use strict';
/*
 * Builds a real deck from the real catalog and inspects the .pptx that comes
 * out — slide count, injected images, and whether the figures on the
 * investment slide are the ones the pricing engine calculated.
 *
 *   npm run test:deck
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

/* A minimal zip reader — enough to look inside the deck without adding a
   dependency purely for the test. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const entries = {};
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
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
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-test-'));
  try {
    const db = require('../electron/lib/db');
    const catalog = require('../electron/lib/catalog');
    const pricing = require('../electron/lib/pricing');
    const deck = require('../electron/lib/deck');

    db.init(path.join(tmp, 'ud'));
    const seeded = catalog.init();
    check('catalog seeds itself', seeded.hotels > 0 && seeded.activities > 0,
      `${seeded.hotels} hotels, ${seeded.activities} activities, ${seeded.templates} templates`);

    // Attach the generated placeholder images if the seeder has been run.
    const imgDir = process.env.CATALOG_IMAGE_DIR;
    let imageCount = 0;
    if (imgDir && fs.existsSync(imgDir)) {
      const files = fs.readdirSync(imgDir);
      for (const h of catalog.listHotels()) {
        files.filter((f) => f.startsWith(`hotel_${h.id}_`)).forEach((f, i) => {
          catalog.addImage('hotel', h.id, path.join(imgDir, f), 'View', i); imageCount++;
        });
      }
      for (const m of catalog.listMcs()) {
        files.filter((f) => f.startsWith(`mc_${m.id}_`)).forEach((f, i) => {
          catalog.addImage('mc', m.id, path.join(imgDir, f), 'Headshot', i); imageCount++;
        });
      }
      for (const a of catalog.listActivities()) {
        files.filter((f) => f.startsWith(`activity_${a.id}_`)).forEach((f, i) => {
          catalog.addImage('activity', a.id, path.join(imgDir, f), 'Action', i); imageCount++;
        });
      }
    }
    check('catalog images are linked', imageCount > 0, `${imageCount} images`);

    const hotel = catalog.getHotel('htl_kl_grand');
    const room = hotel.rooms.find((r) => r.tier === 'Deluxe King');
    const mc = catalog.getMc('mc_1');
    const activities = ['act_1', 'act_3'].map(catalog.getActivity);
    const logistics = ['log_2', 'log_6'].map(catalog.getLogistics);

    const selections = { pax: 60, nights: 2, days: 3, hotel, room, mc, activities, logistics };
    const quote = pricing.calculate(selections, { serviceChargePct: 10, taxPct: 8, marginPct: 12 });

    const built = {
      title: 'Annual Team Offsite 2026',
      client: 'Meridian Logistics Sdn Bhd',
      templateName: 'Team Building Proposal',
      dates: '14 – 16 March 2026',
      accent: '#1F6E62',
      pax: 60, nights: 2,
      location: catalog.getLocation('loc_kl'),
      locationImages: { images: catalog.imagesFor('location', 'loc_kl') },
      hotel, room, roomCount: Math.ceil(60 / room.occupancy),
      mc, activities, logistics, quote,
      slidePlan: JSON.parse(catalog.getTemplate('tpl_team').slide_plan),
    };

    const out = path.join(tmp, 'proposal.pptx');
    const result = await deck.build(built, {
      name: 'Northwind Events', phone: '+60 3 2011 8800',
      email: 'hello@northwind.test', website: 'northwind.test', accent: '#1F6E62',
    }, out);

    check('writes a .pptx', fs.existsSync(out) && fs.readFileSync(out).subarray(0, 2).toString() === 'PK',
      `${(result.bytes / 1024).toFixed(0)} KB`);

    const zip = readZip(out);
    const names = Object.keys(zip);
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    check('produces the planned slides', slides.length >= 9, `${slides.length} slides`);

    const media = names.filter((n) => n.startsWith('ppt/media/'));
    check('embeds the catalog photographs', media.length >= 5, `${media.length} images embedded`);

    const allText = slides.map((n) => zip[n]().toString())
      .join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    check('cover names the client', allText.includes('Meridian Logistics Sdn Bhd'));
    check('cover carries the event title', allText.includes('Annual Team Offsite 2026'));
    check('hotel slide names the venue', allText.includes('The Grand Bintang'));
    check('host slide names the MC', allText.includes('Farah Nordin'));
    check('activity slides name the activities',
      allText.includes('Amazing Race') && allText.includes('Culinary Face-Off'));
    check('amenities are listed', allText.includes('Pillarless ballroom'));

    // The figures in the deck must be the figures the engine produced.
    const fmt = (n) => pricing.money(n).replace('RM ', '');
    check('investment slide shows the calculated total', allText.includes(fmt(quote.total)),
      `looking for ${fmt(quote.total)}`);
    check('investment slide shows the subtotal', allText.includes(fmt(quote.subtotal)));
    check('investment slide shows service charge', allText.includes(fmt(quote.serviceCharge)));
    check('investment slide shows tax', allText.includes(fmt(quote.tax)));
    check('investment slide shows the per-person figure', allText.includes(fmt(quote.perPax)));

    // Determinism: the same input twice must give the same deck content.
    const out2 = path.join(tmp, 'proposal2.pptx');
    // The same brand as the first build — a different one would legitimately
    // change the closing slide and prove nothing about determinism.
    await deck.build(built, {
      name: 'Northwind Events', phone: '+60 3 2011 8800',
      email: 'hello@northwind.test', website: 'northwind.test', accent: '#1F6E62',
    }, out2);
    const text2 = Object.keys(readZip(out2)).filter((n) => /slide\d+\.xml$/.test(n))
      .map((n) => readZip(out2)[n]().toString()).join('').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const text1 = slides.map((n) => zip[n]().toString()).join('').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    check('the same selections produce the same deck', text1 === text2);

    // No prose may be invented: every figure on the page traces to the quote.
    const moneyOnSlides = [...allText.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g)].map((m) => m[0]);
    const knownFigures = new Set([
      ...quote.lines.flatMap((l) => [fmt(l.unitPrice), fmt(l.amount)]),
      ...quote.groups.map((g) => fmt(g.subtotal)),
      fmt(quote.subtotal), fmt(quote.margin), fmt(quote.serviceCharge),
      fmt(quote.tax), fmt(quote.total), fmt(quote.perPax),
      ...[hotel.rooms, [mc], activities, logistics].flat()
        .map((r) => fmt(r.nightly_rate || r.day_rate || r.rate)),
    ]);
    const orphans = [...new Set(moneyOnSlides)].filter((m) => !knownFigures.has(m));
    check('every figure in the deck comes from the catalog or the quote',
      orphans.length === 0, orphans.length ? `unexplained: ${orphans.join(', ')}` : 'no orphan figures');

    /* Structural validation — the closest thing to proving PowerPoint will
       open the file without offering to repair it. The failures that actually
       break a deck are a relationship pointing at a part that is not there, a
       slide using an r:id its own .rels never declares, and a slide the
       presentation never references. */
    const posix = path.posix;
    const partNames = new Set(names);
    const dangling = [];
    for (const n of names.filter((x) => x.endsWith('.rels'))) {
      const base = posix.dirname(posix.dirname(n));
      const rels = zip[n]().toString();
      for (const m of rels.matchAll(/Target="([^"]+)"([^>]*)/g)) {
        if (/TargetMode="External"/.test(m[2])) continue;
        const resolved = posix.normalize(posix.join(base, m[1])).replace(/^\/+/, '');
        if (!partNames.has(resolved)) dangling.push(`${n} -> ${m[1]}`);
      }
    }
    check('every relationship points at a part that exists', dangling.length === 0,
      dangling.slice(0, 3).join(' | ') || `${names.filter((x) => x.endsWith('.rels')).length} rels files checked`);

    const undeclared = [];
    for (const s of slides) {
      const relFile = `ppt/slides/_rels/${posix.basename(s)}.rels`;
      const declared = new Set([...(partNames.has(relFile) ? zip[relFile]().toString() : '')
        .matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
      for (const m of new Set([...zip[s]().toString().matchAll(/r:(?:embed|id|link)="([^"]+)"/g)].map((x) => x[1]))) {
        if (!declared.has(m)) undeclared.push(`${s}:${m}`);
      }
    }
    check('every image and link a slide uses is declared in its rels',
      undeclared.length === 0, undeclared.slice(0, 3).join(' | ') || 'all resolved');

    const presRels = zip['ppt/_rels/presentation.xml.rels']().toString();
    const slideTargets = new Set([...presRels.matchAll(/Target="([^"]*slides\/slide\d+\.xml)"/g)]
      .map((m) => posix.basename(m[1])));
    const orphanSlides = slides.filter((s) => !slideTargets.has(posix.basename(s)));
    check('every slide is referenced by the presentation', orphanSlides.length === 0,
      orphanSlides.join(' | ') || `${slideTargets.size} referenced`);

    /* pptxgenjs declares one slideMaster content-type override per slide while
       writing a single master — true of 3.12 and 4.0.1 alike, so it is the
       library's long-standing behaviour rather than anything this code does.
       Recorded here so a future reader does not rediscover it as a surprise. */
    const ctypes = zip['[Content_Types].xml']().toString();
    const declaredMasters = new Set([...ctypes.matchAll(/slideMaster\d+\.xml/g)].map((m) => m[0])).size;
    const presentMasters = names.filter((n) => /slideMasters\/slideMaster\d+\.xml$/.test(n)).length;
    console.log(`  NOTE  pptxgenjs declares ${declaredMasters} slide masters and writes ${presentMasters} —`
      + ' a known quirk of the library, unchanged between 3.12 and 4.0.1');

    fs.copyFileSync(out, path.join(os.tmpdir(), 'cabinet-sample-deck.pptx'));
    console.log(`\n  Sample deck kept at ${path.join(os.tmpdir(), 'cabinet-sample-deck.pptx')}`);
  } catch (err) {
    check('unexpected failure', false, err.stack || String(err));
  }

  console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});

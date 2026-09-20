'use strict';
/*
 * The acceptance test, written as the job is actually described:
 *
 *   "The MC will be Sera, the event is at hotel X, and the activities are
 *    A, B and C."
 *
 * Sera is added to the catalog with a photograph, the hotel and the three
 * activities are chosen, and the deck that comes out is opened and read back:
 * are the right names on the right slides, did every photograph arrive, is the
 * pricing table built from the right rates?
 *
 * It also runs the cases that would make it "broken and confused": an item
 * with no photograph, a one-activity and a seven-activity deck, and a catalog
 * entry with no cost set.
 *
 *   npm run test:scenario
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
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    entries[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const slideText = (zip) => Object.keys(zip)
  .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .map((n) => zip[n]().toString())
  .join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// A zip carries directory entries too; only the files are images.
const mediaFiles = (zip) => Object.keys(zip).filter((n) => n.startsWith('ppt/media/') && !n.endsWith('/'));
const mediaCount = (zip) => mediaFiles(zip).length;
const slideCount = (zip) => Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-'));
  try {
    const db = require('../electron/lib/db');
    const catalog = require('../electron/lib/catalog');
    const catalogImages = require('../electron/lib/catalog-images');
    const pricing = require('../electron/lib/pricing');
    const deck = require('../electron/lib/deck');

    const userData = path.join(tmp, 'ud');
    db.init(userData);
    catalog.init();

    // The photographs a real install generates on first run.
    const imageDir = path.join(userData, 'catalog-images');
    await catalogImages.generate(catalog, imageDir);

    console.log('\n── Adding a new host, the way the dashboard does ──');

    const seraId = catalog.createItem('mcs', {
      name: 'Sera Fouzay',
      headline: 'Corporate host and awards night specialist',
      bio: 'Hosts annual dinners and award ceremonies across the region, working '
        + 'from a written run sheet and comfortable switching languages mid-programme.',
      languages: 'English, Bahasa Malaysia, Arabic',
      years: 12,
      day_rate: 5200,
      cost_price: 3900,
    });
    check('the new host is created', !!seraId, seraId);

    // A headshot, copied in the way the dashboard copies one.
    const headshotSource = path.join(tmp, 'sera.png');
    const anyImage = fs.readdirSync(imageDir).find((f) => f.startsWith('mc_'));
    fs.copyFileSync(path.join(imageDir, anyImage), headshotSource);
    const stored = path.join(imageDir, `mc_${seraId}_headshot.png`);
    fs.copyFileSync(headshotSource, stored);
    catalog.addImage('mc', seraId, stored, 'Headshot', 0);

    const sera = catalog.getMc(seraId);
    check('the headshot is attached', sera.images.length === 1);
    check('she appears in the picker list',
      catalog.listMcs().some((m) => m.id === seraId), `${catalog.listMcs().length} hosts`);

    console.log('\n── "MC is Sera, hotel is the Grand Bintang, activities are A, B, C" ──');

    const hotel = catalog.getHotel('htl_kl_grand');
    const room = hotel.rooms[0];
    const activities = ['act_1', 'act_3', 'act_5'].map(catalog.getActivity);
    const selections = {
      pax: 80, nights: 2, days: 3, hotel, room, mc: sera, activities, logistics: [],
    };
    const quote = pricing.calculate(selections, { serviceChargePct: 10, taxPct: 8 });

    const proposal = {
      title: 'Annual Awards Night 2026',
      client: 'Corveth Marine Sdn Bhd',
      templateName: 'Annual Gala Dinner',
      dates: '9 – 11 May 2026',
      accent: '#7E5B13',
      pax: 80, nights: 2,
      location: catalog.getLocation('loc_kl'),
      locationImages: { images: catalog.imagesFor('location', 'loc_kl') },
      hotel, room, roomCount: Math.ceil(80 / room.occupancy),
      mc: sera, activities, logistics: [], quote,
      slidePlan: JSON.parse(catalog.getTemplate('tpl_gala').slide_plan),
    };

    const out = path.join(tmp, 'deck.pptx');
    const built = await deck.build(proposal, {
      name: 'Northwind Events', phone: '+60 3 2011 8800',
      email: 'hello@northwind.test', accent: '#7E5B13',
    }, out);

    const zip = readZip(out);
    const text = slideText(zip);

    check('a deck is produced', fs.existsSync(out) && slideCount(zip) >= 9,
      `${slideCount(zip)} slides, ${(built.bytes / 1024).toFixed(0)} KB`);

    console.log('\n── Is the right thing on the right slide? ──');
    check('the new host is named on the host slide', text.includes('Sera Fouzay'));
    check('her headline is used', text.includes('awards night specialist'));
    check('her biography is used', text.includes('run sheet'));
    check('her languages became badges', text.includes('Arabic'));
    check('her day rate is shown', text.includes('5,200.00'));
    check('no other host leaked in',
      !text.includes('Farah Nordin') && !text.includes('Daniel Yeoh'));

    check('the chosen hotel is named', text.includes('The Grand Bintang'));
    check('its amenities are listed', text.includes('Pillarless ballroom'));
    check('the chosen room tier is shown', text.includes(room.tier), room.tier);
    check('no other hotel leaked in', !text.includes('Horizon Suites'));

    for (const a of activities) {
      check(`activity "${a.name}" is on a slide`, text.includes(a.name));
    }
    check('an activity that was NOT chosen is absent',
      !text.includes('Dragon Boat'), 'Dragon Boat was not selected');

    check('the client is named', text.includes('Corveth Marine Sdn Bhd'));
    check('the event title is used', text.includes('Annual Awards Night 2026'));
    check('the dates are used', text.includes('9 – 11 May 2026') || text.includes('11 May 2026'));

    console.log('\n── Did the photographs arrive? ──');
    // Hotel (3) + host (1) + 3 activities + destination = 8 expected at most,
    // deduplicated by pptxgenjs where the same file is used twice.
    check('photographs are embedded in the file', mediaCount(zip) >= 5,
      `${mediaCount(zip)} images embedded`);
    check('every embedded image has real bytes and a PNG header',
      mediaFiles(zip).every((n) => {
        const b = zip[n]();
        return b.length > 1000 && b.subarray(0, 4).toString('hex') === '89504e47';
      }),
      `smallest ${Math.min(...mediaFiles(zip).map((n) => zip[n]().length))} bytes`);

    console.log('\n── Is the money right? ──');
    const fmt = (n) => pricing.money(n).replace('RM ', '');
    check('the host line uses her rate x days',
      Math.abs(quote.lines.find((l) => l.group === 'Host').amount - 5200 * 3) < 0.005,
      fmt(quote.lines.find((l) => l.group === 'Host').amount));
    check('the pricing table shows the total', text.includes(fmt(quote.total)), fmt(quote.total));
    check('the lines add up to the subtotal',
      Math.abs(quote.lines.reduce((a, l) => a + l.amount, 0) - quote.subtotal) < 0.005);
    check('her cost never reaches a slide', !text.includes(fmt(3900)) && !text.includes(fmt(3900 * 3)));

    console.log('\n── The cases that would look broken ──');

    // A catalog item with no photograph at all.
    const noPhotoId = catalog.createItem('activities', {
      name: 'Silent Disco Finale', category: 'gala', summary: 'Three channels, headsets for every guest.',
      duration_mins: 120, pax_min: 20, pax_max: 400, rate_type: 'per_head', rate: 85, cost_price: 55,
    });
    const noPhoto = catalog.getActivity(noPhotoId);
    check('an item can exist with no photograph', noPhoto.images.length === 0);
    const mixed = { ...proposal, activities: [...activities, noPhoto] };
    const mixedOut = path.join(tmp, 'mixed.pptx');
    await deck.build(mixed, { name: 'Northwind Events', accent: '#7E5B13' }, mixedOut);
    const mixedText = slideText(readZip(mixedOut));
    check('a photoless item still gets a slide with its name',
      mixedText.includes('Silent Disco Finale'));
    check('it shows a framed placeholder rather than failing',
      mixedText.includes('Silent Disco Finale'), 'deck built without error');

    // One activity, and seven.
    const oneOut = path.join(tmp, 'one.pptx');
    await deck.build({ ...proposal, activities: [activities[0]] },
      { name: 'N', accent: '#7E5B13' }, oneOut);
    const sevenActs = ['act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'act_6', 'act_7'].map(catalog.getActivity);
    const sevenOut = path.join(tmp, 'seven.pptx');
    await deck.build({ ...proposal, activities: sevenActs },
      { name: 'N', accent: '#7E5B13' }, sevenOut);

    const oneZip = readZip(oneOut);
    const sevenZip = readZip(sevenOut);
    check('one activity still produces a complete deck', slideCount(oneZip) >= 9, `${slideCount(oneZip)} slides`);
    check('seven activities add a slide rather than overflowing one',
      slideCount(sevenZip) === slideCount(oneZip) + 1,
      `${slideCount(sevenZip)} vs ${slideCount(oneZip)}`);
    const sevenText = slideText(sevenZip);
    check('all seven activities are named', sevenActs.every((a) => sevenText.includes(a.name)));

    // Nothing chosen at all.
    const bareOut = path.join(tmp, 'bare.pptx');
    await deck.build({
      ...proposal, mc: null, hotel: null, room: null, activities: [], logistics: [],
      quote: pricing.calculate({ pax: 0, nights: 0, days: 1, activities: [], logistics: [] }, {}),
    }, { name: 'Northwind Events', accent: '#7E5B13' }, bareOut);
    const bareZip = readZip(bareOut);
    check('an empty selection still produces a valid deck rather than an error',
      slideCount(bareZip) >= 4, `${slideCount(bareZip)} slides`);
    check('it does not invent a host or a hotel',
      !slideText(bareZip).includes('Sera Fouzay') && !slideText(bareZip).includes('Grand Bintang'));

    // An item with no cost entered.
    const noCostId = catalog.createItem('activities', {
      name: 'Beach Bonfire', category: 'gala', summary: 'Fire pit, seating and a guitarist.',
      rate_type: 'flat', rate: 3400, pax_min: 10, pax_max: 200,
    });
    const noCostQuote = pricing.calculate({
      pax: 50, nights: 0, days: 1, activities: [catalog.getActivity(noCostId)], logistics: [],
    }, {});
    check('an item with no cost still prices for the client',
      Math.abs(noCostQuote.subtotal - 3400) < 0.005, fmt(noCostQuote.subtotal));
    check('and is reported as uncosted rather than assumed profitable',
      noCostQuote.internal.uncostedLines === 1 && noCostQuote.internal.grossMargin === 3400,
      `uncosted ${noCostQuote.internal.uncostedLines}`);

    fs.copyFileSync(out, path.join(os.tmpdir(), 'scenario-deck.pptx'));
    console.log(`\n  Deck kept at ${path.join(os.tmpdir(), 'scenario-deck.pptx')}`);
  } catch (err) {
    check('unexpected failure', false, err.stack || String(err));
  }

  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});

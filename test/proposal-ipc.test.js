'use strict';
/* The path the app's own screen takes: the real catalog, the real settings,
   the real template. Run under Electron because the database needs it:
     TEMPLATE=<file.pptx> npm run test:proposal-ipc                        */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const settings = require('../electron/lib/settings');
  const db = require('../electron/lib/db');
  const catalog = require('../electron/lib/catalog');
  const organize = require('../electron/lib/organize');
  const tf = require('../electron/lib/template-fill');
  const jt = require('../electron/lib/job-types');
  const { resolve: readRequest, describe } = require('../electron/lib/resolve');
  const { compose } = require('../electron/lib/compose');

  try {
    /* A throwaway user-data folder and library, so the test never touches a
       real installation's database or settings. */
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-app-'));
    const userData = path.join(base, 'userData');
    fs.mkdirSync(userData, { recursive: true });
    settings.init(userData, path.join(base, 'Library'));
    db.init(userData);
    const seeded = catalog.init();
    check('the catalog is there', seeded.hotels > 0 && seeded.activities > 0,
      `${seeded.hotels} hotels, ${seeded.mcs || '?'} hosts, ${seeded.activities} activities`);

    console.log('\n── the settings the screen relies on ──');
    const s = settings.get();
    check('brand is the real key, not branding', s.brand != null && s.branding === undefined);
    check('there is somewhere to keep the template and the consultant',
      s.proposals != null && 'template' in s.proposals && 'preparedBy' in s.proposals,
      Object.keys(s.proposals || {}).join(', '));
    settings.update({ proposals: { ...s.proposals, preparedBy: 'Joanne Teoh', sequence: 6 } });
    check('a proposals setting survives an update',
      settings.get().proposals.preparedBy === 'Joanne Teoh'
      && settings.get().proposals.sequence === 6);
    check('the optional API key is off by default and holds no key',
      s.model.enabled === false && !s.model.apiKey);

    console.log('\n── reading a request against the seeded catalog ──');
    /* Built from the catalog's own records, so the test cannot drift from it. */
    const hotel = catalog.listHotels()[0];
    const mc = catalog.listMcs()[0];
    const acts = catalog.listActivities().slice(0, 2);
    const forReading = {
      jobTypes: catalog.listTemplates(),
      locations: catalog.listLocations(),
      hotels: catalog.listHotels(),
      mcs: catalog.listMcs(),
      activities: catalog.listActivities(),
      venues: catalog.listVenues(),
      ownCompany: (settings.get().brand || {}).name || null,
    };
    check('every list the screen needs came back',
      forReading.jobTypes.length > 0 && forReading.hotels.length > 0
      && forReading.mcs.length > 0 && forReading.activities.length > 0,
      `${forReading.jobTypes.length} job types, ${forReading.venues.length} halls`);

    const sentence = `team building for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, `
      + `14 - 15 March 2026, 2D1N at ${hotel.name}, MC ${mc.name}, `
      + `${acts.map((a) => a.name).join(' and ')}, depart 8:30am back 6pm`;
    const resolved = readRequest(sentence, forReading);
    console.log(`     "${sentence.slice(0, 96)}…"`);
    describe(resolved).forEach((l) => console.log(`       ${l}`));

    check('it found the hotel from the catalog',
      resolved.hotels.some((h) => h.id === hotel.id), resolved.hotels.map((h) => h.name).join(', '));
    check('it found the host', resolved.mc && resolved.mc.id === mc.id,
      resolved.mc ? resolved.mc.name : 'none');
    check('it found both activities', resolved.activities.length === 2,
      resolved.activities.map((a) => a.name).join(', '));
    check('it read the head count and the dates',
      resolved.pax === 45 && /March 2026/.test(resolved.dates || ''));
    check('nothing is reported as unrecognised', resolved.unrecognised.length === 0,
      resolved.unrecognised.join(', ') || 'none');

    console.log('\n── prices and pictures out of the database ──');
    const rooms = catalog.listRooms(hotel.id);
    const transport = catalog.listLogistics()
      .filter((l) => /transport|bus|coach|transfer/i.test(`${l.category} ${l.name}`));
    check('the hotel has a room with a rate', rooms.length > 0 && rooms[0].nightly_rate > 0,
      rooms.length ? `${rooms[0].tier} at ${rooms[0].nightly_rate}` : 'none');
    check('a coach is in the catalog', transport.length > 0,
      transport.map((t) => t.name).join(', ') || 'none');

    const built = compose(resolved, {
      selections: {
        programme: { mc: resolved.mc, activities: resolved.activities },
        venue: { hotel, room: rooms[0], venue: resolved.venues[0] || null },
        transport: transport.length ? { logistics: [transport[0]] } : null,
      },
      rates: {},
      photoLookup: (type, id) => catalog.imagesFor(type, id).map((i) => i.file_path || i.path),
      preparedBy: settings.get().proposals.preparedBy,
      sequence: 7,
    });
    check('a price came out of the catalog without anybody typing one',
      built.values.grandTotal != null, built.values.grandTotal || 'nothing');
    check('and it shows its working',
      built.computed.some((c) => /from the catalog/.test(c)),
      built.computed.find((c) => /catalog/.test(c)) || 'no catalog line');
    check('the reference follows the scheme',
      /^SSL\/[A-Z]+\/\d{2}\/\d{4}\/007$/.test(built.values.reference || ''),
      built.values.reference);
    check('no cost price is among the values the deck will show',
      !Object.keys(built.values).some((k) => /cost|margin/i.test(k)));

    console.log('\n── where the file is filed ──');
    const root = settings.get().library.root;
    const target = organize.plan(root, {
      company: 'ABC Sdn Bhd', folder: 'Proposals', typeLabel: 'Proposal',
      date: '2026-03-01', ext: 'pptx',
    });
    check('a .pptx gets a real path under the library',
      /\.pptx$/.test(target.full) && target.dir.startsWith(root),
      target.full.replace(root, '…'));

    const TEMPLATE = process.env.TEMPLATE;
    if (TEMPLATE && fs.existsSync(TEMPLATE)) {
      console.log('\n── filling the template the way the button does ──');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'));
      const dest = path.join(dir, 'out.pptx');
      const res = await tf.fill(TEMPLATE, dest, jt.mappingFor('team_building'),
        built.values, { strict: false });
      check('a deck was written', fs.existsSync(dest) && res.bytes > 100000,
        `${(res.bytes / 1024 / 1024).toFixed(2)} MB`);
      check('spots were filled', res.written.length > 10, `${res.written.length} placed`);
      const text = (await tf.readText(dest)).flatMap((x) => x.runs).join(' ');
      check('no placeholder survived', !/[xX]{2,}/.test(text),
        (text.match(/[xX]{2,}/g) || []).join(', ') || 'none');
      check('the client is on page 1', /ABC Sdn Bhd/.test(text));
      check('Smart Solutions Learning is still there', /Smart Solutions Learning/.test(text));
      check('the response the screen renders has every field it reads',
        ['path', 'bytes', 'written', 'photos', 'problems', 'blanked', 'leftInProse', 'remaining']
          .every((k) => k in res));
    } else {
      console.log('\n   (set TEMPLATE to also fill the real template)');
    }
  } catch (err) {
    console.error(err);
    fail += 1;
  }

  console.log(`\n${'─'.repeat(62)}\n${pass} passed, ${fail} failed\n`);
  app.exit(fail ? 1 : 0);
});

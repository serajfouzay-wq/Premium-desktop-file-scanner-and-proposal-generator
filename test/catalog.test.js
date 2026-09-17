'use strict';
/* The catalog dashboard writes to these functions, so they are exercised
   directly: create, edit, remove, migrate, and images copied into app storage.
   Run with: npm run test:catalog */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-test-'));
  try {
    const db = require('../electron/lib/db');
    const catalog = require('../electron/lib/catalog');
    const pricing = require('../electron/lib/pricing');

    db.init(path.join(tmp, 'ud'));
    const info = catalog.init();
    check('venues are seeded', info.venues > 0, `${info.venues} venues`);

    // Running init twice must not fail — the migration has to be idempotent.
    let second = null;
    try { second = catalog.init(); } catch (err) { second = { error: err.message }; }
    check('starting twice does not fail', !second.error, second.error || 'clean');
    check('the second start applies no further migrations',
      Array.isArray(second.migrated) && second.migrated.length === 0, JSON.stringify(second.migrated));

    /* A category added in a later version must arrive populated on an install
       that already exists, or it shows up as an empty tab with no explanation.
       Emptying one table and re-initialising stands in for that upgrade. */
    db.handle().run('DELETE FROM venues', []);
    const upgraded = catalog.init();
    check('a newly added category is seeded on an existing install',
      upgraded.venues > 0 && upgraded.seeded.includes('venues'),
      `venues ${upgraded.venues}, seeded ${JSON.stringify(upgraded.seeded)}`);
    check('the tables that were already populated are left alone',
      upgraded.seeded.length === 1, JSON.stringify(upgraded.seeded));

    /* Samples the user has deliberately removed must not reappear. */
    // The last one, so the fixture a later check relies on stays put.
    const venueList = catalog.listVenues();
    catalog.deleteItem('venues', venueList[venueList.length - 1].id);
    const afterDelete = catalog.listVenues().length;
    catalog.init();
    check('deleted samples are not restored on the next start',
      catalog.listVenues().length === afterDelete, `${catalog.listVenues().length} vs ${afterDelete}`);

    // Seeded items must carry a cost, or margin reporting is meaningless.
    const anMc = catalog.getMc('mc_1');
    check('seeded items carry a cost as well as a price',
      anMc.cost_price > 0 && anMc.cost_price < anMc.day_rate,
      `cost ${anMc.cost_price} vs price ${anMc.day_rate}`);

    /* --- create --- */
    const id = catalog.createItem('activities', {
      name: 'Night Kayak Expedition', category: 'team building',
      summary: 'Guided paddle through the mangroves after dark.',
      duration_mins: 150, pax_min: 10, pax_max: 40,
      rate_type: 'per_head', rate: 240, cost_price: 168, gear: 'Kayaks, lights, guides', indoor: 0,
    });
    const created = catalog.getActivity(id);
    check('an activity can be created', created && created.name === 'Night Kayak Expedition', id);
    check('both prices are stored', created.rate === 240 && created.cost_price === 168);

    /* --- edit --- */
    catalog.updateItem('activities', id, { rate: 265, summary: 'Guided paddle after dark, with supper.' });
    const edited = catalog.getActivity(id);
    check('an activity can be edited', edited.rate === 265 && /supper/.test(edited.summary));
    check('fields not sent are left alone', edited.cost_price === 168 && edited.pax_max === 40);

    // The write list is a whitelist: unknown columns must not get through.
    let rejected = false;
    try { catalog.updateItem('activities', id, { id: 'hacked', nonsense: 1 }); }
    catch { rejected = true; }
    check('unknown columns are ignored rather than written',
      !rejected && catalog.getActivity(id) !== null && catalog.getActivity('hacked') === null);

    let badTable = false;
    try { catalog.createItem('sqlite_master', { name: 'x' }); } catch { badTable = true; }
    check('a table outside the catalog is refused', badTable);

    /* --- images copied into app storage --- */
    const source = path.join(tmp, 'source-photo.png');
    fs.writeFileSync(source, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
    ));
    const store = path.join(tmp, 'ud', 'catalog-images');
    fs.mkdirSync(store, { recursive: true });
    const copied = path.join(store, `activity_${id}_test.png`);
    fs.copyFileSync(source, copied);
    catalog.addImage('activity', id, copied, 'Action', 0);

    const withImage = catalog.getActivity(id);
    check('an image is attached to the item', withImage.images.length === 1);
    check('the stored path is inside the app folder',
      withImage.images[0].path.startsWith(store), withImage.images[0].path.replace(tmp, '…'));
    fs.unlinkSync(source);
    check('the catalog survives the original being deleted',
      fs.existsSync(catalog.getActivity(id).images[0].path));

    /* --- the new item prices like any other --- */
    const quote = pricing.calculate({
      pax: 20, nights: 0, days: 1, activities: [catalog.getActivity(id)], logistics: [],
    }, { serviceChargePct: 10, taxPct: 8 });
    check('a newly added item prices correctly',
      Math.abs(quote.subtotal - 265 * 20) < 0.005, `${quote.subtotal} vs ${265 * 20}`);
    check('its margin is reported internally',
      Math.abs(quote.internal.totalCost - 168 * 20) < 0.005, `cost ${quote.internal.totalCost}`);

    /* --- venues price through the same engine --- */
    const venue = catalog.getVenue('ven_1');
    const withVenue = pricing.calculate({ pax: 100, nights: 0, days: 2, venue, activities: [], logistics: [] }, {});
    check('a venue prices by the day',
      Math.abs(withVenue.subtotal - venue.client_price * 2) < 0.005,
      `${withVenue.subtotal} vs ${venue.client_price * 2}`);
    check('a venue carries its cost too',
      Math.abs(withVenue.internal.totalCost - venue.cost_price * 2) < 0.005);

    /* --- remove --- */
    catalog.deleteItem('activities', id);
    check('an activity can be removed', catalog.getActivity(id) === null);
    check('its catalog image rows go with it', catalog.imagesFor('activity', id).length === 0);
    check('the picture file itself is left on disk', fs.existsSync(copied));

    const hotelCount = catalog.listHotels().length;
    catalog.deleteItem('hotels', 'htl_kl_horizon');
    check('removing a hotel removes its rooms',
      catalog.listHotels().length === hotelCount - 1
      && catalog.listRooms('htl_kl_horizon').length === 0);
  } catch (err) {
    check('unexpected failure', false, err.stack || String(err));
  }

  console.log(`\n${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});

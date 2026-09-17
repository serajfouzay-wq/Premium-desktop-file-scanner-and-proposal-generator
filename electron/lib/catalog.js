'use strict';
const db = require('./db');

/*
 * The vendor catalog.
 *
 * Version 3 stops drafting prose from past documents and instead assembles a
 * deck from priced, structured records. That makes the output reproducible:
 * the same selections always produce the same deck and the same total, which
 * is the point of a quotation.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  region   TEXT,
  blurb    TEXT,
  sort     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hotels (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  star_rating  INTEGER,
  address      TEXT,
  amenities    TEXT,                       -- newline separated
  notes        TEXT,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS hotel_rooms (
  id           TEXT PRIMARY KEY,
  hotel_id     TEXT NOT NULL,
  tier         TEXT NOT NULL,              -- Deluxe, Club, Suite
  occupancy    INTEGER DEFAULT 2,
  nightly_rate REAL NOT NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  headline   TEXT,
  bio        TEXT,
  languages  TEXT,                         -- comma separated
  years      INTEGER,
  day_rate   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT,                      -- team building, gala, conference
  summary       TEXT,
  duration_mins INTEGER,
  pax_min       INTEGER DEFAULT 1,
  pax_max       INTEGER DEFAULT 500,
  rate_type     TEXT NOT NULL,             -- per_head | flat
  rate          REAL NOT NULL,
  gear          TEXT,
  indoor        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS logistics (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,                         -- audio, lighting, staging, transport
  spec       TEXT,
  rate_type  TEXT NOT NULL,                -- per_head | flat | per_day
  rate       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_images (
  id         TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,                -- hotel | room | mc | activity | location
  owner_id   TEXT NOT NULL,
  path       TEXT NOT NULL,
  caption    TEXT,
  sort       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposal_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  blurb      TEXT,
  accent     TEXT,
  slide_plan TEXT NOT NULL,                -- JSON array of slide kinds, in order
  sort       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decks (
  id          TEXT PRIMARY KEY,
  client      TEXT NOT NULL,
  title       TEXT NOT NULL,
  template_id TEXT,
  payload     TEXT NOT NULL,
  total       REAL,
  file_path   TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hotels_location ON hotels(location_id);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel     ON hotel_rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_images_owner    ON catalog_images(owner_type, owner_id);
`;

function init() {
  db.handle().exec(SCHEMA);
  if (!count('proposal_templates')) seed();
  return { templates: count('proposal_templates'), hotels: count('hotels'), activities: count('activities') };
}

const count = (table) => (db.handle().get(`SELECT COUNT(*) AS n FROM ${table}`) || {}).n || 0;
const run = (sql, params) => db.handle().run(sql, params);
const all = (sql, params = []) => db.handle().all(sql, params);
const get = (sql, params = []) => db.handle().get(sql, params);

/* ------------------------------------------------------------------ seed */

const LOCATIONS = [
  ['loc_kl', 'Kuala Lumpur', 'Klang Valley', 'The capital, and the easiest arrival point for mixed-origin delegates.', 1],
  ['loc_penang', 'Penang', 'Northern Corridor', 'Heritage streets, food, and beach resorts within half an hour of each other.', 2],
  ['loc_langkawi', 'Langkawi', 'Northern Corridor', 'Island resorts and duty-free, suited to longer incentive programmes.', 3],
  ['loc_genting', 'Genting Highlands', 'Klang Valley', 'Cool highland air an hour from the capital, with large indoor venues.', 4],
  ['loc_melaka', 'Melaka', 'Southern Corridor', 'A compact heritage city, strong for short conferences and gala dinners.', 5],
];

const HOTELS = [
  ['htl_kl_grand', 'loc_kl', 'The Grand Bintang, Kuala Lumpur', 5, 'Jalan Sultan Ismail, 50250 Kuala Lumpur',
    'Pillarless ballroom for 600\nEight breakout rooms\nRooftop pool deck\nDirect link to the monorail\nIn-house AV team', 'Preferred rate applies above 40 rooms.'],
  ['htl_kl_horizon', 'loc_kl', 'Horizon Suites KLCC', 4, 'Jalan Pinang, 50450 Kuala Lumpur',
    'Ballroom for 320\nFour breakout rooms\nExecutive lounge\nTen minutes from KLCC\nComplimentary shuttle', 'Good value for mid-sized conferences.'],
  ['htl_png_straits', 'loc_penang', 'Straits Heritage Resort, Batu Ferringhi', 5, 'Batu Ferringhi, 11100 Penang',
    'Beachfront function lawn\nBallroom for 400\nThree restaurants\nWater sports centre\n45 minutes from the airport', 'Beach lawn subject to weather; indoor backup included.'],
  ['htl_lgk_andaman', 'loc_langkawi', 'Andaman Bay Resort, Langkawi', 5, 'Pantai Kok, 07000 Langkawi',
    'Private bay\nBallroom for 250\nSpa and wellness centre\nIsland-hopping jetty on site\nRainforest trail access', 'Minimum three-night stay for group rates.'],
  ['htl_gen_summit', 'loc_genting', 'Summit Highlands Hotel', 4, 'Genting Highlands, 69000 Pahang',
    'Convention hall for 1,200\nTwelve breakout rooms\nIndoor theme park access\nCable car station\nCool climate year round', 'Best option above 400 pax.'],
  ['htl_mlk_riverine', 'loc_melaka', 'Riverine Court Melaka', 4, 'Jalan Kota, 75000 Melaka',
    'Riverside ballroom for 280\nHeritage walking tours\nThree breakout rooms\nRooftop bar\nTwo hours from Kuala Lumpur', 'Heritage tour can be bundled as an activity.'],
];

const ROOMS = [
  ['rm_1', 'htl_kl_grand', 'Deluxe King', 2, 420], ['rm_2', 'htl_kl_grand', 'Club Twin', 2, 560], ['rm_3', 'htl_kl_grand', 'Executive Suite', 2, 890],
  ['rm_4', 'htl_kl_horizon', 'Superior Twin', 2, 280], ['rm_5', 'htl_kl_horizon', 'Deluxe King', 2, 350],
  ['rm_6', 'htl_png_straits', 'Garden View Twin', 2, 380], ['rm_7', 'htl_png_straits', 'Sea View Deluxe', 2, 510], ['rm_8', 'htl_png_straits', 'Beach Villa', 3, 980],
  ['rm_9', 'htl_lgk_andaman', 'Rainforest Deluxe', 2, 460], ['rm_10', 'htl_lgk_andaman', 'Bay View Suite', 2, 820],
  ['rm_11', 'htl_gen_summit', 'Standard Twin', 2, 240], ['rm_12', 'htl_gen_summit', 'Premier King', 2, 330],
  ['rm_13', 'htl_mlk_riverine', 'Heritage Twin', 2, 260], ['rm_14', 'htl_mlk_riverine', 'River Suite', 2, 470],
];

const MCS = [
  ['mc_1', 'Farah Nordin', 'Bilingual corporate host and moderator',
    'Fifteen years hosting annual dinners and product launches across the region. Known for keeping a long programme moving without rushing the room.',
    'English, Bahasa Malaysia, Mandarin', 15, 4800],
  ['mc_2', 'Daniel Yeoh', 'Conference moderator and panel facilitator',
    'Moderates technical conferences and panel sessions. Background in broadcast, comfortable with unscripted question and answer segments.',
    'English, Mandarin, Cantonese', 11, 4200],
  ['mc_3', 'Priya Raman', 'Gala dinner host and entertainer',
    'Gala and awards specialist who also performs a short live set. Handles bilingual scripts and long award sequences.',
    'English, Bahasa Malaysia, Tamil', 9, 3900],
  ['mc_4', 'Hafiz Rahman', 'Team building facilitator and emcee',
    'Runs the floor for large team building days and doubles as the day host. Strong with mixed-seniority groups.',
    'English, Bahasa Malaysia', 8, 3200],
];

const ACTIVITIES = [
  ['act_1', 'Amazing Race: Heritage Trail', 'team building',
    'Teams work through checkpoints across the old town, solving tasks that need the whole group rather than the loudest member.',
    240, 20, 200, 'per_head', 185, 'Route packs, checkpoint marshals, first aid, radios', 0],
  ['act_2', 'Dragon Boat Challenge', 'team building',
    'Crews train with a coach, then race over a short course. Fast to explain, hard to win without timing together.',
    180, 24, 120, 'per_head', 240, 'Boats, paddles, life jackets, safety craft, coach', 0],
  ['act_3', 'Culinary Face-Off', 'team building',
    'Teams cook a set menu against the clock and are judged by a local chef. Works indoors, so it is weatherproof.',
    180, 16, 80, 'per_head', 210, 'Cooking stations, ingredients, chef judge, aprons', 1],
  ['act_4', 'Escape Room Circuit', 'team building',
    'Rotating rooms with different puzzle types, so groups that stall in one format still get a win in another.',
    120, 12, 60, 'per_head', 160, 'Portable room kits, facilitators, timers', 1],
  ['act_5', 'Beach Olympics', 'team building',
    'Six short outdoor events run in parallel, scored as a league. Suits large groups with mixed fitness.',
    210, 30, 250, 'per_head', 150, 'Equipment sets, scoring boards, shade tents, marshals', 0],
  ['act_6', 'Awards Night Production', 'gala',
    'Full evening production: run sheet, stage cues, award sequencing, walk-on music and a rehearsal in the afternoon.',
    300, 50, 600, 'flat', 18500, 'Stage, lectern, trophies handling, run sheet, rehearsal', 1],
  ['act_7', 'Cultural Performance Set', 'gala',
    'Three traditional dance pieces with live percussion, staged between dinner courses.',
    45, 0, 1000, 'flat', 7200, 'Performers, costumes, percussion, sound check', 1],
  ['act_8', 'Keynote Stage Package', 'conference',
    'Speaker stage with confidence monitor, clicker, countdown timer and a technician on headset for the full session.',
    480, 0, 1200, 'flat', 9800, 'Stage set, monitors, timer, comms, technician', 1],
  ['act_9', 'Breakout Facilitation', 'conference',
    'Trained facilitators run parallel breakout rooms and return a written synthesis the same evening.',
    240, 20, 300, 'per_head', 95, 'Facilitator per room, materials, synthesis write-up', 1],
];

const LOGISTICS = [
  ['log_1', 'Line Array Sound System', 'audio', '12kW system with two engineers, suitable to 600 pax', 'per_day', 6800],
  ['log_2', 'Compact PA and Microphones', 'audio', '4kW system, four wireless handhelds, one engineer', 'per_day', 2400],
  ['log_3', 'Stage Wash and Moving Heads', 'lighting', 'Twenty-four fixtures, one operator, full programming', 'per_day', 5200],
  ['log_4', 'Ambient Uplighting', 'lighting', 'Forty battery uplighters, colour matched to brand', 'per_day', 1800],
  ['log_5', 'Main Stage 12m x 6m', 'staging', 'Decked stage with skirting, steps and LED backdrop 8m x 3m', 'flat', 14500],
  ['log_6', 'Coach Transfer, 44-seat', 'transport', 'Airport and venue transfers, driver and fuel included', 'per_day', 1250],
  ['log_7', 'Executive Van, 12-seat', 'transport', 'For speakers and organisers, on standby through the event', 'per_day', 780],
];

const TEMPLATES = [
  ['tpl_team', 'Team Building Proposal',
    'A day or multi-day programme built around activities, with accommodation and a host.',
    '#1F6E62', JSON.stringify(['cover', 'credentials', 'destination', 'hotel', 'mc', 'activities', 'logistics', 'investment', 'terms', 'closing']), 1],
  ['tpl_gala', 'Annual Gala Dinner',
    'An evening production: venue, host, entertainment, staging and the full run of show.',
    '#7E5B13', JSON.stringify(['cover', 'credentials', 'destination', 'hotel', 'mc', 'activities', 'logistics', 'investment', 'terms', 'closing']), 2],
  ['tpl_conf', 'Corporate Conference',
    'Plenary and breakout programme with stage, accommodation and delegate logistics.',
    '#2C5A78', JSON.stringify(['cover', 'credentials', 'destination', 'hotel', 'mc', 'activities', 'logistics', 'investment', 'terms', 'closing']), 3],
];

function seed() {
  const insert = (sql, rows) => rows.forEach((r) => run(sql, r));
  insert('INSERT INTO locations (id,name,region,blurb,sort) VALUES (?,?,?,?,?)', LOCATIONS);
  insert('INSERT INTO hotels (id,location_id,name,star_rating,address,amenities,notes) VALUES (?,?,?,?,?,?,?)', HOTELS);
  insert('INSERT INTO hotel_rooms (id,hotel_id,tier,occupancy,nightly_rate) VALUES (?,?,?,?,?)', ROOMS);
  insert('INSERT INTO mcs (id,name,headline,bio,languages,years,day_rate) VALUES (?,?,?,?,?,?,?)', MCS);
  insert('INSERT INTO activities (id,name,category,summary,duration_mins,pax_min,pax_max,rate_type,rate,gear,indoor) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ACTIVITIES);
  insert('INSERT INTO logistics (id,name,category,spec,rate_type,rate) VALUES (?,?,?,?,?,?)', LOGISTICS);
  insert('INSERT INTO proposal_templates (id,name,blurb,accent,slide_plan,sort) VALUES (?,?,?,?,?,?)', TEMPLATES);
}

/* ----------------------------------------------------------------- reads */

const listTemplates = () => all('SELECT * FROM proposal_templates ORDER BY sort');
const listLocations = () => all('SELECT * FROM locations ORDER BY sort');

const listHotels = (locationId) => all(
  locationId ? 'SELECT * FROM hotels WHERE location_id = ? ORDER BY star_rating DESC, name'
    : 'SELECT * FROM hotels ORDER BY name',
  locationId ? [locationId] : [],
).map((h) => ({ ...h, rooms: listRooms(h.id), images: imagesFor('hotel', h.id) }));

const listRooms = (hotelId) => all('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY nightly_rate', [hotelId]);
const listMcs = () => all('SELECT * FROM mcs ORDER BY name').map((m) => ({ ...m, images: imagesFor('mc', m.id) }));
const listActivities = (category) => all(
  category ? 'SELECT * FROM activities WHERE category = ? ORDER BY name' : 'SELECT * FROM activities ORDER BY category, name',
  category ? [category] : [],
).map((a) => ({ ...a, images: imagesFor('activity', a.id) }));
const listLogistics = () => all('SELECT * FROM logistics ORDER BY category, name');

const imagesFor = (ownerType, ownerId) => all(
  'SELECT * FROM catalog_images WHERE owner_type = ? AND owner_id = ? ORDER BY sort', [ownerType, ownerId],
);

const getHotel = (id) => {
  const h = get('SELECT * FROM hotels WHERE id = ?', [id]);
  if (!h) return null;
  const loc = get('SELECT * FROM locations WHERE id = ?', [h.location_id]);
  return { ...h, location: loc, rooms: listRooms(h.id), images: imagesFor('hotel', h.id) };
};
const getRoom = (id) => get('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
const getMc = (id) => {
  const m = get('SELECT * FROM mcs WHERE id = ?', [id]);
  return m ? { ...m, images: imagesFor('mc', m.id) } : null;
};
const getActivity = (id) => {
  const a = get('SELECT * FROM activities WHERE id = ?', [id]);
  return a ? { ...a, images: imagesFor('activity', a.id) } : null;
};
const getLogistics = (id) => get('SELECT * FROM logistics WHERE id = ?', [id]);
const getTemplate = (id) => get('SELECT * FROM proposal_templates WHERE id = ?', [id]);
const getLocation = (id) => get('SELECT * FROM locations WHERE id = ?', [id]);

function addImage(ownerType, ownerId, filePath, caption, sort = 0) {
  const id = db.uid('img_');
  run('INSERT INTO catalog_images (id,owner_type,owner_id,path,caption,sort) VALUES (?,?,?,?,?,?)',
    [id, ownerType, ownerId, filePath, caption || null, sort]);
  return id;
}
const clearImages = () => run('DELETE FROM catalog_images', []);

function saveDeck(deck) {
  const id = db.uid('deck_');
  run('INSERT INTO decks (id,client,title,template_id,payload,total,file_path,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, deck.client, deck.title, deck.templateId || null, JSON.stringify(deck), deck.total || 0, deck.filePath || null, db.nowISO()]);
  return id;
}
const listDecks = () => all('SELECT id, client, title, total, file_path, created_at FROM decks ORDER BY created_at DESC LIMIT 50');

module.exports = {
  init, listTemplates, listLocations, listHotels, listRooms, listMcs, listActivities, listLogistics,
  getHotel, getRoom, getMc, getActivity, getLogistics, getTemplate, getLocation,
  imagesFor, addImage, clearImages, saveDeck, listDecks, count,
};

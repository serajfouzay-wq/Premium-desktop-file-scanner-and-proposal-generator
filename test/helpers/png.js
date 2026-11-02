'use strict';
/* A real PNG, written by hand, so the tests that need photographs do not
   depend on an image library, a network fetch, or a seeding step having been
   run first. A test that goes red because an environment variable is missing
   teaches people to ignore red, so the suites make their own pictures.

   The drawing is deliberate: a ring centred in the frame plus both diagonals.
   If a crop is centred, the ring stays centred and the diagonals still meet in
   the middle, so a wrong crop is visible at a glance in PowerPoint. */
const zlib = require('zlib');
const fs = require('fs');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'latin1');
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {[number,number,number]} rgb  background colour
 * @returns {Buffer} PNG bytes
 */
function makePng(width, height, rgb = [60, 90, 140]) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 3;
  const thick = Math.max(4, Math.min(width, height) / 40);
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const ring = Math.abs(Math.hypot(x - cx, y - cy) - r) < thick / 2;
      const diag = Math.abs((x / width) - (y / height)) < 0.004
        || Math.abs((x / width) - (1 - y / height)) < 0.004;
      const p = row + 1 + x * 3;
      const col = (ring || diag) ? [255, 255, 255] : rgb;
      raw[p] = col[0]; raw[p + 1] = col[1]; raw[p + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 2;  // truecolour RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePng(path, width, height, rgb) {
  fs.writeFileSync(path, makePng(width, height, rgb));
  return path;
}

/** The four awkward shapes worth testing: too wide, too tall, square, exact. */
const SHAPES = [
  { name: 'wide', width: 4000, height: 1200, rgb: [40, 90, 160] },
  { name: 'tall', width: 1200, height: 3600, rgb: [160, 60, 60] },
  { name: 'square', width: 2000, height: 2000, rgb: [40, 130, 90] },
  { name: 'exact', width: 1600, height: 900, rgb: [150, 110, 30] },
];

module.exports = { makePng, writePng, SHAPES };

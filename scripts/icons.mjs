// Draws the toolbar icon (three offset lines in the signal colors) as PNGs, without image tools.
import { deflateSync } from 'node:zlib';

const LINES = [
  { y: 8, x0: 4, x1: 20, color: [0xa3, 0x74, 0xd9] },
  { y: 14, x0: 8, x1: 24, color: [0xc9, 0x7f, 0x22] },
  { y: 20, x0: 6, x1: 22, color: [0x3f, 0x8f, 0xe0] },
];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Distance from point to a horizontal segment with round caps, in 28-unit icon space. */
function coverage(px, py, line, width) {
  const dx = Math.max(line.x0 - px, 0, px - line.x1);
  const d = Math.hypot(dx, py - line.y);
  return Math.max(0, Math.min(1, width / 2 - d + 0.5));
}

export function iconPng(size) {
  const scale = 28 / size;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const width = size <= 16 ? 3.4 : 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      // Supersample 4x4 for smooth edges.
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = (x + (sx + 0.5) / 4) * scale;
          const py = (y + (sy + 0.5) / 4) * scale;
          for (const line of LINES) {
            const c = coverage(px, py, line, width);
            if (c > 0) {
              r += line.color[0] * c; g += line.color[1] * c; b += line.color[2] * c; a += c;
              break;
            }
          }
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (a > 0) {
        raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a);
        raw[o + 3] = Math.round((a / 16) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

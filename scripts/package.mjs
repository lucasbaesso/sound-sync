// Zips the production build (dist/, without source maps) for the Chrome Web Store and Edge Add-ons:
// release/sound-sync-<version>.zip with manifest.json at the root.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const dist = 'dist';
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const out = `release/sound-sync-${manifest.version}.zip`;

async function files(dir) {
  const list = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) list.push(...(await files(p)));
    else if (!p.endsWith('.map')) list.push(p);
  }
  return list.sort();
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

const locals = [];
const centrals = [];
let offset = 0;
for (const file of await files(dist)) {
  const name = Buffer.from(relative(dist, file).split('\\').join('/'));
  const data = await readFile(file);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(useDeflate ? 8 : 0, 8);
  header.writeUInt32LE(0, 10); // time/date
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  locals.push(header, name, body);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += header.length + name.length + body.length;
}
const centralSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
await mkdir('release', { recursive: true });
await writeFile(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${out}: ${(((await stat(out)).size) / 1e6).toFixed(1)} MB, ${centrals.length / 2} files`);

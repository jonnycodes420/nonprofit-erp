#!/usr/bin/env node
// Generates favicon assets into client/public/
// Design: dark green #1a6b4a rounded-square, cream #f0ede6 "S"
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "client", "public");
fs.mkdirSync(OUT, { recursive: true });

// SVG template — scales to any size
function makeSvg(size) {
  const r = Math.round(size * 0.22); // corner radius ~22% of size
  const fontSize = Math.round(size * 0.62);
  const letterY = Math.round(size * 0.73); // baseline
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#1a6b4a"/>
  <text
    x="${size / 2}" y="${letterY}"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="${fontSize}"
    font-weight="700"
    fill="#f0ede6"
    text-anchor="middle"
    dominant-baseline="auto"
  >S</text>
</svg>`;
}

async function generate() {
  const sizes = [
    { name: "favicon-16x16.png",   size: 16 },
    { name: "favicon-32x32.png",   size: 32 },
    { name: "apple-touch-icon.png", size: 180 },
  ];

  for (const { name, size } of sizes) {
    await sharp(Buffer.from(makeSvg(size)))
      .png()
      .toFile(path.join(OUT, name));
    console.log(`✓ ${name}`);
  }

  // favicon.ico — ICO container with embedded 16x16 and 32x32 PNGs
  const png16 = await sharp(Buffer.from(makeSvg(16))).png().toBuffer();
  const png32 = await sharp(Buffer.from(makeSvg(32))).png().toBuffer();
  const icoBuffer = buildIco([png16, png32], [16, 32]);
  fs.writeFileSync(path.join(OUT, "favicon.ico"), icoBuffer);
  console.log("✓ favicon.ico");

  console.log(`\nAll files written to ${OUT}`);
}

// Build a valid ICO file containing PNG data (modern ICO format)
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + count * entrySize;

  // Calculate offsets
  const offsets = [];
  let offset = dirSize;
  for (const buf of pngBuffers) {
    offsets.push(offset);
    offset += buf.length;
  }

  const total = offset;
  const ico = Buffer.alloc(total);
  let pos = 0;

  // ICONDIR header
  ico.writeUInt16LE(0, pos);      // reserved
  ico.writeUInt16LE(1, pos + 2);  // type = 1 (icon)
  ico.writeUInt16LE(count, pos + 4);
  pos += 6;

  // ICONDIRENTRY for each image
  for (let i = 0; i < count; i++) {
    const sz = sizes[i] >= 256 ? 0 : sizes[i]; // 0 means 256 in ICO spec
    ico.writeUInt8(sz, pos);           // width
    ico.writeUInt8(sz, pos + 1);       // height
    ico.writeUInt8(0, pos + 2);        // color count (0 = >256 colors)
    ico.writeUInt8(0, pos + 3);        // reserved
    ico.writeUInt16LE(1, pos + 4);     // color planes
    ico.writeUInt16LE(32, pos + 6);    // bits per pixel
    ico.writeUInt32LE(pngBuffers[i].length, pos + 8);  // size of image data
    ico.writeUInt32LE(offsets[i], pos + 12);            // offset of image data
    pos += 16;
  }

  // Image data
  for (const buf of pngBuffers) {
    buf.copy(ico, pos);
    pos += buf.length;
  }

  return ico;
}

generate().catch(err => { console.error(err); process.exit(1); });

import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = (name) => resolve(__dirname, "client/public", name);

// Tab-optimized SVG (no gold bar — reads cleanly at 16x16 and 32x32)
const tabSvg = readFileSync(resolve(__dirname, "client/public/favicon.svg"));

// Full logo SVG (dark bg + cream S + gold underline bar — used for large app icons)
const fullLogoSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#0f1a12"/>
  <text x="200" y="252"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="230"
    font-weight="700"
    fill="#f0ede6"
    text-anchor="middle">S</text>
  <rect x="120" y="278" width="160" height="10" rx="5" fill="#c9a84c"/>
</svg>`);

// Small tab favicons — from tab-optimized SVG
const tabSizes = [
  { file: "favicon-16x16.png", size: 16 },
  { file: "favicon-32x32.png", size: 32 },
  { file: "favicon.ico",       size: 32 },
];

// Large app icons — from full logo SVG (gold bar, great at 180px+)
const appSizes = [
  { file: "apple-touch-icon.png",       size: 180 },
  { file: "android-chrome-192x192.png", size: 192 },
  { file: "android-chrome-512x512.png", size: 512 },
];

for (const { file, size } of tabSizes) {
  await sharp(tabSvg).resize(size, size).png().toFile(out(file));
  console.log(`✓ ${file} (${size}x${size}) — tab-optimized`);
}

for (const { file, size } of appSizes) {
  await sharp(fullLogoSvg).resize(size, size).png().toFile(out(file));
  console.log(`✓ ${file} (${size}x${size}) — full logo`);
}

// Social / marketing images
const ogSvg = readFileSync(resolve(__dirname, "client/public/og-image.svg"));
await sharp(ogSvg).resize(1200, 630).png().toFile(out("og-image.png"));
console.log("✓ og-image.png (1200x630)");

const liSvg = readFileSync(resolve(__dirname, "client/public/linkedin-cover.svg"));
await sharp(liSvg).resize(1128, 191).png().toFile(out("linkedin-cover.png"));
console.log("✓ linkedin-cover.png (1128x191)");

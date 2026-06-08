import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgBuffer = readFileSync(resolve(__dirname, "client/public/favicon.svg"));
const out = (name) => resolve(__dirname, "client/public", name);

const sizes = [
  { file: "favicon-16x16.png",        size: 16  },
  { file: "favicon-32x32.png",         size: 32  },
  { file: "apple-touch-icon.png",      size: 180 },
  { file: "android-chrome-192x192.png",size: 192 },
  { file: "android-chrome-512x512.png",size: 512 },
  { file: "favicon.ico",               size: 32  },
];

for (const { file, size } of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(out(file));
  console.log(`✓ ${file} (${size}x${size})`);
}

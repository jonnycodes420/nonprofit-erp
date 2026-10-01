#!/usr/bin/env node
// LANDING-2 — writes client/public/sitemap.xml from the marketing route table
// (client/src/marketing/routes.js). Re-run after adding a marketing route;
// tests/landing2-marketing.test.js fails while the two disagree.
//   node scripts/landing2-sitemap.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ROUTES } from "../client/src/marketing/routes.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.stewardapp.dev";
const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...ROUTES.map(r => `  <url><loc>${ORIGIN}${r.path}</loc><priority>${r.path === "/" ? "1.0" : r.path.split("/").length > 2 ? "0.6" : "0.8"}</priority></url>`),
  "</urlset>", ""].join("\n");
fs.writeFileSync(path.join(ROOT, "client", "public", "sitemap.xml"), xml);
console.log("sitemap.xml:", ROUTES.length, "urls");

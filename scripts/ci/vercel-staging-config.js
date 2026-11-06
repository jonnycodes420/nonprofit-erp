#!/usr/bin/env node
// STAGE-1 · THE STAGING FRONTEND'S VERCEL CONFIG, MADE FROM PROD'S.
//
// vercel.json names prod's API host in its rewrites (/portal-api, /unsubscribe,
// /recurring/…) and in its Content-Security-Policy. A staging frontend built
// from it would send a donor's portal call, an unsubscribe or a card update to
// PROD. So staging deploys with `vercel deploy --local-config vercel.staging.json`,
// which this writes: every prod API host replaced by staging's, nothing else
// changed. It fails if any prod host is left behind.
//
// usage: node scripts/ci/vercel-staging-config.js <staging api url> [out=vercel.staging.json]
"use strict";
const fs = require("fs");
const path = require("path");

const PROD_HOSTS = ["https://nonprofit-erp-production.up.railway.app", "https://api.stewardapp.dev"];

function stagingConfig(prodJsonText, stagingApi) {
  const api = String(stagingApi || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(api)) throw new Error(`the staging API must be an https origin, not "${stagingApi}"`);
  if (PROD_HOSTS.includes(api)) throw new Error("the staging API is prod's");
  let text = prodJsonText;
  for (const h of PROD_HOSTS) text = text.split(h).join(api);
  const cfg = JSON.parse(text);
  cfg.git = { deploymentEnabled: false };   // staging is deployed by CI only, like prod
  // Staging is public (Muse walks it) but never in a search index.
  cfg.headers = [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }, ...(cfg.headers || [])];
  const out = JSON.stringify(cfg, null, 2) + "\n";
  const left = PROD_HOSTS.filter(h => out.includes(h.replace("https://", "")));
  if (left.length) throw new Error(`a prod host is still in the staging config: ${left.join(", ")}`);
  return out;
}

if (require.main === module) {
  const root = path.join(__dirname, "..", "..");
  const out = process.argv[3] || path.join(root, "vercel.staging.json");
  fs.writeFileSync(out, stagingConfig(fs.readFileSync(path.join(root, "vercel.json"), "utf8"), process.argv[2]));
  console.log(`wrote ${path.relative(root, out)} for ${process.argv[2]}`);
}
module.exports = { stagingConfig, PROD_HOSTS };

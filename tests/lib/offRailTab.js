// tests/lib/offRailTab.js · NAV-2 (27 Nov), for tests/smoke-walk.test.js.
//
// Auctions, Peer-to-peer, Memberships and Major Gifts start off an org's rail
// (client/src/lib/navGroups.js DEFAULT_OFF, read from the source so the list
// is the product's own). When the walk finds one of them has no rail button,
// it opens it by its address instead, looks at the page like any tab, and
// checks it landed on its page or its Fundraising part (Major Gifts, off the
// rail, opens inside Fundraising → Major gifts). Returns true when it handled
// the id, so the walk moves on; false for anything else.
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "lib", "navGroups.js"), "utf8");
const DEFAULT_OFF = new Set(((/export const DEFAULT_OFF\s*=\s*new Set\(\[([^\]]*)\]/.exec(SRC)) || [0, ""])[1]
  .split(",").map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean));
const BY_URL = {
  auctions: ["/app/fundraising?fr=auctions", '[data-fr-view="auctions"]'],
  p2p: ["/app/fundraising?fr=p2p", '[data-fr-view="p2p"]'],
  memberships: ["/app/fundraising?fr=members", '[data-fr-view="members"]'],
  majorgifts: ["/app/majorgifts?subtab=pipeline", '[data-fr-view="pipeline"], [data-mg-view="pipeline"]'],
};

async function openOffRail(id, { page, APP, look, ok }) {
  if (!DEFAULT_OFF.has(id) || !BY_URL[id]) return false;
  const [url, at] = BY_URL[id];
  await page.goto(APP + url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await look(`tab ${id} (off the rail, by its address)`);
  ok(`tab ${id}: off the rail, ${url} still opens it`, await page.locator(at).count() >= 1, page.url());
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  return true;
}

module.exports = { openOffRail, DEFAULT_OFF };

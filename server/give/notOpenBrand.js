// server/give/notOpenBrand.js · FLOWS-13 item 2 (W-1114-Atlas-15). A PAGE THAT ISN'T OPEN IS STILL THEIRS.
//
// "The public giving page showed "Not open yet" with no logo or header." The
// not-open answers carried only the sentence, so a donor who followed the link
// saw a bare line with no sign of whose page it was. They now carry the same
// name and logo the open page draws (giveThemePayload: the giving page's logo,
// else the one saved under Settings, Organization), and the page draws its
// header above the sentence.
"use strict";

// `org` is a row selected with GIVE_THEME_COLS (give_logo, display_name).
function notOpenBrand(org, giveThemePayload) {
  const th = giveThemePayload(org) || {};
  return { brand: { name: th.displayName || (org && org.name) || "", logo: th.logo || null, primary: th.primary || null, primaryFg: th.primaryFg || null } };
}

// HONEST-2 item 2 (W-1126-Integrations-04): "a public page that is Not open yet shows a bare
// notice". It shows the org's name, its mission line and "Opens soon". The mission is read here when
// the caller's row didn't select it.
const OPENS_SOON = "Opens soon";
const missionLine = m => { const s = String(m || "").replace(/\s+/g, " ").trim(); if (!s) return null;
  const first = (s.match(/^.{20,240}?[.!?](?=\s|$)/) || [s.slice(0, 240)])[0]; return first.length < s.length && !/[.!?]$/.test(first) ? first.replace(/\s+\S*$/, "") + "…" : first; };
async function notOpenBrandFull(query, org, giveThemePayload) {
  const out = notOpenBrand(org, giveThemePayload);
  let mission = org && org.mission;
  if (mission === undefined && org && org.id) mission = ((await query("SELECT mission FROM orgs WHERE id=?", [org.id]).catch(() => []))[0] || {}).mission;
  out.brand.mission = missionLine(mission);
  // HONEST-3 item 4: a page with no opening date doesn't promise one. "Opens soon" is gone.
  out.brand.heading = require("./examplePage").NOT_PUBLISHED;
  return out;
}

module.exports = { notOpenBrand, notOpenBrandFull, missionLine, OPENS_SOON };

// server/outreach/campaignTiers.js · CAMPAIGN-2 item 2. A CAMPAIGN'S TIERS ARE THE GIVING LEVELS.
//
// Jarvis (24 Nov): "Selecting all five tiers together still gives 0 donors, while Tag = Major
// gives 29 and the form defines Major as $10,000+ in the last 12 months." The campaign picker
// offered five wealth-capacity tiers (transformational … micro) and matched them against
// donors.capacity_tier, a wealth-score column almost nobody has, so every tier was empty.
//
// Steward has ONE tier definition: the giving level (donorStatus.statusSql, over
// shared/numbers/tags.js LEVEL_SQL and the org's cut points in Settings, Giving levels):
// General, Mid and Major on what they gave in the last 12 months. The Donors list's tags,
// Groups and the "Major" audience all read it. Here a level holds only people who gave in
// those 12 months, so the three together are everyone with a gift in the window, and Major
// here is Major on the Donors list. A key that is not a level (an old capacity tier saved on
// a draft) selects nobody, never everybody.
"use strict";
const { query } = require("../../db");

const TIER_KEYS = Object.freeze(["major", "mid", "general"]);
const TIER_LABELS = Object.freeze({ major: "Major", mid: "Mid", general: "General" });
const WINDOW_SENTENCE = "A level here holds only people who gave in the last 12 months, so the three together are everyone with a gift in that time.";

// The ids of everyone at one of `tiers` who gave in the last 12 months.
async function tierIds(orgId, tiers) {
  const want = [...new Set((tiers || []).map(String))].filter(k => TIER_KEYS.includes(k));
  if (!want.length) return [];
  const DS = require("../../donorStatus");
  const st = DS.statusSql(orgId, await DS.todayFor(orgId), await DS.cutsFor(orgId));
  const rows = await query(`SELECT s.donor_id FROM (${st.sql}) s WHERE s.last12 > 0 AND s.level IN (${want.map(() => "?").join(",")})`, [...st.args, ...want]);
  return rows.map(r => r.donor_id);
}

// The sentence under the picker: the org's own cut points, then the window.
async function tierSentence(orgId) {
  const DS = require("../../donorStatus");
  return `${DS.levelSentence(await DS.cutsFor(orgId))} ${WINDOW_SENTENCE}`;
}

module.exports = { TIER_KEYS, TIER_LABELS, WINDOW_SENTENCE, tierIds, tierSentence };

// FIX-37 · HAVE THE GIFTS FROM THE LAST 30 DAYS ALREADY BEEN THANKED?
//
// An import's recent gifts go through recordGift like any other gift (LIVE-1),
// which drafts a thank-you and can start a first-gift journey. That is right
// for a monthly file. It is wrong for a move from another system, where those
// gifts were thanked there already. So before saving, the import asks, and
// this file holds the answer's three shapes and the default.
//
//   none  "Yes, don't draft thank-yous"   no draft, no gift journey, no gift sequence
//   all   "No, draft them all"            every recent gift is treated as new
//   min   "Only gifts of $___ or more"    gifts at or above the floor are new; the rest as "none"
//
// THE DEFAULT is "none" for an org's first import, for a file Steward
// recognises as another system's export, and whenever more than
// BIG_COUNT gifts would be thanked. Otherwise "all". Decided here and only
// here: the preview route asks this, and an import that arrives with no
// answer (an API caller) is given this same default.
"use strict";

const BIG_COUNT = 50;
const MODES = new Set(["none", "all", "min"]);

// The systems a move usually comes from. Bloomerang, DonorPerfect, Neon, Little
// Green Light and Kindful are read through the mapper's own presets, Salesforce
// through the NPSP preset. Raiser's Edge has no preset; its export carries a
// Constituent ID beside its own fund, appeal and campaign description columns
// (a plain "Gift ID" or "Gift Amount" is in every system's export, so those
// are not evidence).
const SYSTEM_LABELS = {
  bloomerang: "Bloomerang", donorperfect: "DonorPerfect", neon: "Neon", littlegreenlight: "Little Green Light",
  kindful: "Kindful", salesforce: "Salesforce", raisersedge: "Raiser's Edge",
};
const RE_SIGNALS = ["fund description", "appeal description", "campaign description", "appeal id", "fund id", "gift subtype"];
const normH = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function recognizeSystem(headers) {
  const hs = (Array.isArray(headers) ? headers : []).map(String);
  if (!hs.length) return null;
  const { detectNpsp } = await import("./shared/npspPreset.js");
  if (detectNpsp(hs).isNpsp) return "salesforce";
  const { detectMigrationPreset } = await import("./shared/migrationPresets.js");
  const m = detectMigrationPreset(hs);
  if (m && m.key && SYSTEM_LABELS[m.key]) return m.key;
  const set = new Set(hs.map(normH));
  if (set.has("constituent id") && RE_SIGNALS.filter(s => set.has(s)).length >= 2) return "raisersedge";
  return null;
}

function defaultAnswer({ firstImport, system, count }) {
  if (firstImport) return { mode: "none", why: "first_import",
    sentence: "This is your first import, so these gifts were most likely thanked in the system they came from." };
  if (system) return { mode: "none", why: "other_system",
    sentence: `This file looks like an export from ${SYSTEM_LABELS[system] || system}, so these gifts were most likely thanked there.` };
  if (count > BIG_COUNT) return { mode: "none", why: "many",
    sentence: `More than ${BIG_COUNT} recent gifts is more thank-yous than one day's mail, so Steward assumes they were thanked.` };
  return { mode: "all", why: "default", sentence: "" };
}

// What the import was told, cleaned. Anything unrecognisable is null, so the
// caller falls back to the default rather than guessing.
function cleanAnswer(a) {
  if (!a || typeof a !== "object" || !MODES.has(a.mode)) return null;
  if (a.mode !== "min") return { mode: a.mode };
  const min = Math.round((Number(a.min) || 0) * 100) / 100;
  return min > 0 ? { mode: "min", min } : null;
}

// Is THIS gift to be treated as new (thanked by Steward)? A gift the answer
// says was thanked already gets no draft and starts no gift journey.
function treatAsNew(answer, amount) {
  if (!answer || answer.mode === "all") return true;
  if (answer.mode === "none") return false;
  return (Number(amount) || 0) >= answer.min;
}

// The answer in words, for the run's history.
function answerSentence(a) {
  if (!a) return "";
  if (a.mode === "none") return "Gifts from the last 30 days had already been thanked: no thank-yous drafted.";
  if (a.mode === "all") return "Thank-yous drafted for every gift from the last 30 days.";
  return `Thank-yous drafted for gifts of $${Number(a.min).toLocaleString("en-US")} or more from the last 30 days.`;
}

// An org's first import: no import run on file that was not undone.
async function isFirstImport(query, orgId, exceptId = null) {
  const [r] = await query(
    `SELECT COUNT(*)::int AS n FROM imports WHERE org_id=? AND reversed_at IS NULL AND (?::text IS NULL OR id <> ?::text)`,
    [orgId, exceptId, exceptId]);
  return !r || Number(r.n) === 0;
}

module.exports = { BIG_COUNT, SYSTEM_LABELS, recognizeSystem, defaultAnswer, cleanAnswer, treatAsNew, answerSentence, isFirstImport };

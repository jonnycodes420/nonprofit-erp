// server/outreach/skipRows.js · FLOWS-16 item 5 (W-1115-Fundraising-32, a repeat). WHY A STEP WAS SKIPPED, ON EVERY ROW.
//
// A journey's "Steps skipped" said "The reason is on each row", and 1 of 3
// rows had one: the rows were DISTINCT people with the raw `skip_reason`, so a
// skip written before reasons were kept showed a name only, and Margaret Chen,
// skipped in two entries, showed twice with nothing to tell the rows apart.
//
// Now there is one row per skipped step, and each says
//   · why and when: "Stopped by Dana, Nov 13", "Skipped: no address on file, Nov 13",
//     or, for a skip written before reasons were kept, "Reason not recorded (before Nov 16)";
//   · which entry it belongs to: "Entered Oct 2 · step 2, Birthday card".
// The figure counts these same rows (JOURNEY_ROW_SQL.skipped), so the number opens to itself.
"use strict";

const STOPPED = "Skipped, journey stopped";   // server/majorGifts/planStop.js SKIPPED
const NOT_RECORDED = "Reason not recorded (before Nov 16)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-13" → "Nov 13"; another year than the one it is read in carries its year.
function shortDay(ymd, thisYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return "";
  const s = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return thisYear && m[1] !== String(thisYear) ? `${s}, ${m[1]}` : s;
}
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "";
const isSystem = id => /^system[:_]/.test(String(id || ""));
const lower1 = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const tidy = s => String(s || "").trim().replace(/\.+$/, "");

// The one sentence for one skipped step.
function skipSentence(r, thisYear) {
  const reason = tidy(r.raw_reason);
  const day = shortDay(r.skipped_on, thisYear);
  if (!reason) return NOT_RECORDED;
  if (reason === STOPPED) return `Stopped by ${isSystem(r.closed_by) || !r.closed_by_name ? "Steward" : firstName(r.closed_by_name)}${day ? `, ${day}` : ""}`;
  if (isSystem(r.closed_by) || !r.closed_by_name) return `Skipped: ${lower1(reason.replace(/^Skipped[:,]?\s*/i, ""))}${day ? `, ${day}` : ""}`;
  return `${reason} (${firstName(r.closed_by_name)}${day ? `, ${day}` : ""})`;
}

// Which entry the row belongs to: the day they went in, and the step.
function entryLine(r, thisYear) {
  const went = shortDay(r.entered, thisYear);
  const step = r.step_label ? `step ${Number(r.seq) + 1}, ${tidy(r.step_label)}` : "";
  return [went ? `Entered ${went}` : "", step].filter(Boolean).join(" · ");
}

// GET /journeys/:id/rows?rows=skipped: the rows as the screen shows them.
function shape(rows, { thisYear } = {}) {
  return rows.map(r => ({ id: r.id, name: r.name, planId: r.plan_id, stepId: r.step_id,
    reason: skipSentence(r, thisYear), entry: entryLine(r, thisYear), recorded: !!tidy(r.raw_reason) }));
}

module.exports = { STOPPED, NOT_RECORDED, skipSentence, entryLine, shape, shortDay };

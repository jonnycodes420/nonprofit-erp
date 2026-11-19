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
//   · which entry it belongs to: "Entered Oct 2 · step 1, Birthday card" (FLOWS-19: the editor's numbering).
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

// FLOWS-19 item 4 (W-1115-Fundraising-32, a repeat): "step 2, Mail a birthday card" on a journey
// with one step. A plan step's seq already counts from 1 (journeyStart.js copies the journey's
// steps as seq 1, 2, …), and FLOWS-16 added 1 again. The number is now the step's place in the
// journey as the editor shows it today, 1-based: the editor's step with this one's label, the one
// at the same place first. A step since deleted from the journey has no number to give, and says so.
function editorPosition(r, editorSteps) {
  const labels = (Array.isArray(editorSteps) ? editorSteps : []).map(st => tidy(st && st.label));
  const want = tidy(r.step_label);
  if (!want || !labels.length) return null;
  const same = Number(r.seq) - 1;
  if (labels[same] === want) return same + 1;
  const at = labels.indexOf(want);
  return at >= 0 ? at + 1 : null;
}

// Which entry the row belongs to: the day they went in, and the step.
function entryLine(r, thisYear, editorSteps = null) {
  const went = shortDay(r.entered, thisYear);
  const n = editorPosition(r, editorSteps);
  const step = !r.step_label ? "" : n ? `step ${n}, ${tidy(r.step_label)}` : `${tidy(r.step_label)} (a step no longer in this journey)`;
  return [went ? `Entered ${went}` : "", step].filter(Boolean).join(" · ");
}

// GET /journeys/:id/rows?rows=skipped: the rows as the screen shows them. `steps` is the journey's
// own steps (cultivation_templates.steps), in the editor's order.
function shape(rows, { thisYear, steps = null } = {}) {
  return rows.map(r => ({ id: r.id, name: r.name, planId: r.plan_id, stepId: r.step_id,
    reason: skipSentence(r, thisYear), entry: entryLine(r, thisYear, steps), recorded: !!tidy(r.raw_reason) }));
}

module.exports = { STOPPED, NOT_RECORDED, skipSentence, entryLine, editorPosition, shape, shortDay };

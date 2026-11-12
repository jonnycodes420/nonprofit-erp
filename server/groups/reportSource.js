// server/groups/reportSource.js · FLOWS-8 (W-1112-Volunteers-34X). A GROUP SAVED FROM A REPORT SAYS HOW FAR IT HAS DRIFTED.
//
// Saving a list report (LYBUNT, SYBUNT, Lost) as a group offers two things:
//   · Keep updating: a group by rule, where the report's question is a rule
//     (only LYBUNT: its rule, groups.js `bunt: "lybunt"`, is the report's own
//     predicate; SYBUNT's starter rule is narrower than the report, so it is
//     not offered as "the same list, kept up to date").
//   · Freeze today's list: a hand-kept group that remembers the report and the
//     day (audiences.source_report, source_at). Its page then says "Saved from
//     LYBUNT on Nov 12 · 23 people have changed since", counted against the
//     report as it reads now (the report itself, run with its own defaults), and
//     offers a refresh that makes the group today's list.
"use strict";

const REPORTS = Object.freeze({
  lybunt: { label: "LYBUNT", rule: { bunt: "lybunt" } },
  sybunt: { label: "SYBUNT" },
  "std:lapsed-24": { label: "Lost: over 24 months" },
});
const reportOf = key => (Object.prototype.hasOwnProperty.call(REPORTS, String(key || "")) ? REPORTS[key] : null);

// The people on the report today, by id: the report's own rows.
async function currentIds(orgId, key) {
  if (key === "std:lapsed-24") {
    const d = await require("../reports/lostReport").lostReport(orgId);
    return (d.rows || []).map(r => r._pid).filter(Boolean);
  }
  const d = await require("../../routes/crm").reportHooks.run(orgId, key, {});
  return (d.rows || []).map(r => r.id).filter(Boolean);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || "")) ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : "");

// Pure: the members against the report now. `changed` is everyone on one side
// only: on the report and not in the group (joined), or the other way (left).
function driftOf(memberIds, reportIds) {
  const m = new Set(memberIds), r = new Set(reportIds);
  const joined = [...r].filter(id => !m.has(id)), left = [...m].filter(id => !r.has(id));
  return { joined, left, changed: joined.length + left.length };
}
function driftSentence(label, sourceAt, changed) {
  const head = `Saved from ${label} on ${dayWords(sourceAt)}`;
  return changed === 0 ? `${head} · nobody has changed since` : `${head} · ${changed} ${changed === 1 ? "person has" : "people have"} changed since`;
}

// The drift line for a group, or null when it was not frozen from a report.
async function driftFor(orgId, group, memberIds) {
  const rep = group && reportOf(group.sourceReport);
  if (!rep || group.kind !== "static") return null;
  const d = driftOf(memberIds, await currentIds(orgId, group.sourceReport));
  return { report: group.sourceReport, label: rep.label, since: group.sourceAt, changed: d.changed, joined: d.joined.length, left: d.left.length,
    sentence: driftSentence(rep.label, group.sourceAt, d.changed),
    detail: d.changed ? `${d.joined.length} on ${rep.label} now and not in this group, ${d.left.length} in this group and not on ${rep.label} now.` : null };
}

module.exports = { REPORTS, reportOf, currentIds, driftOf, driftSentence, driftFor, dayWords };

// server/volunteers/volunteerSources.js · VOL-3 item 6. THE VOLUNTEER HEADER CARDS OPEN THEIR ROWS.
//
// Registered into figureSources.js's SOURCES. The four numbers across the top of Volunteers were
// buttons that switched the part below; every number opens now (CLAUDE.md), so each is a figure
// whose rows foot to it:
//   volunteers-active               the Active volunteers (shared/numbers/volunteerStatus.js), or,
//                                   with servedSince, those of them with a shift since that day
//                                   and on or before today (shared/numbers/served.js)
//   volunteer-applications-pending  applications from the volunteer page waiting for a decision
//   volunteer-week-conflicts        this week's overlaps, from the Schedule's own weekProblems
//   volunteer-week-short            this week's published shifts with a role still short
"use strict";
const VST = require("../../shared/numbers/volunteerStatus");
const SRV = require("../../shared/numbers/served");
const orgTime = require("../../orgTime");
const WEEK = require("./weekProblemsHook");

async function orgDay(orgId) {
  const { query } = require("../../db");
  const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone });
}

// Rows worked out in JavaScript, handed to SQL as one JSON parameter so the drawer pages and foots them.
const fromJson = rows => ({
  sql: `SELECT x.id, x.type, x.donor_id, x.name, x.date, NULL::numeric AS amount, x.detail
          FROM jsonb_to_recordset(?::jsonb) AS x(id text, type text, donor_id text, name text, date text, detail text)`,
  args: [JSON.stringify(rows)],
  order: "date, name, id",
});

module.exports = function volunteerSources() {
  return {
    "volunteers-active": {
      label: "Active volunteers",
      measure: () => "count",
      params: { servedSince: "date" },
      sentence: (p, dd) => p.servedSince
        ? `Active volunteers with a shift dated ${dd(p.servedSince)} to today. ${SRV.SERVED_SENTENCE}`
        : VST.ACTIVE_SENTENCE,
      sql: async (orgId, p) => {
        const today = await orgDay(orgId);
        const served = p.servedSince
          ? ` AND EXISTS (SELECT 1 FROM volunteer_shifts vx WHERE vx.org_id = d.org_id AND vx.person_id = d.id AND vx.date >= ? AND ${SRV.SERVED("vx", today)})` : "";
        return {
          sql: `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name,
                       (SELECT MAX(vx.date) FROM volunteer_shifts vx WHERE vx.org_id = d.org_id AND vx.person_id = d.id AND ${SRV.SERVED("vx", today)}) AS date,
                       NULL::numeric AS amount, 'Last served' AS detail
                  FROM donors d
                 WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.erased_at IS NULL
                   AND d.person_types @> '["volunteer"]'::jsonb AND ${VST.ACTIVE_SQL("d")}${served}`,
          args: [orgId, ...(p.servedSince ? [p.servedSince] : [])],
          order: "name, id",
        };
      },
    },
    "volunteer-applications-pending": {
      label: "Pending applications",
      measure: () => "count",
      params: {},
      sentence: () => "Applications from your volunteer page waiting for Approve or Decline.",
      sql: orgId => ({
        sql: `SELECT a.id, 'application' AS type, a.person_id AS donor_id, a.name, LEFT(a.submitted_at::text, 10) AS date,
                     NULL::numeric AS amount, 'Applied from the volunteer page' AS detail
                FROM volunteer_applications a WHERE a.org_id = ? AND a.status = 'pending'`,
        args: [orgId],
        order: "date DESC, id",
      }),
    },
    "volunteer-week-conflicts": {
      label: "Schedule conflicts this week",
      measure: () => "count",
      params: {},
      sentence: () => "This week, the same person with a place on two shifts that overlap in time. Back to back is not a conflict.",
      sql: async orgId => {
        const wp = await WEEK.get(orgId);
        return fromJson(wp.conflicts.map((c, i) => ({ id: `${c.personId}:${c.a.id}:${c.b.id}:${i}`, type: "person", donor_id: c.personId,
          name: c.name, date: c.date, detail: `${c.a.name || "A shift"} and ${c.b.name || "another shift"} overlap` })));
      },
    },
    "volunteer-week-short": {
      label: "Shifts short this week",
      measure: () => "count",
      params: {},
      sentence: () => "Published shifts this week, Monday to Sunday, where at least one role still needs people.",
      sql: async orgId => {
        const wp = await WEEK.get(orgId);
        return fromJson(wp.short.map(s => ({ id: s.id, type: "shift", donor_id: null, name: s.name, date: s.date,
          detail: `${s.footer.short} more needed (${s.footer.scheduled} of ${s.footer.needed})` })));
      },
    },
  };
};

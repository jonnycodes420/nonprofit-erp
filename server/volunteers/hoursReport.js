// server/volunteers/hoursReport.js · FLOWS-4 (W-1109-Volunteers-26). THE HOURS
// REPORT, ONE ROW PER ENTRY.
//
// The Hours report's three breakdowns each ran their own query. By program
// joined the shift to every sign-up that pointed at it, so a shift reached by
// two sign-ups was summed twice there and By program no longer footed to the
// header; By person left out deleted people while By month and By program kept
// them. Now every breakdown, the rows behind each figure and the funder's
// export read ONE set: each logged shift once, with its one program, held by a
// person who is not deleted. By person, By program and By month each foot to
// the header because they are three groupings of the same rows.
//
// A shift's program: the opportunity the hours name (PARITY-3 records it on
// the shift), else the opportunity of the shift somebody was checked in or out
// of, else the role written on the shift.
"use strict";

const NO_PROGRAM = "Not assigned to a program";

// The rows, each logged shift exactly once. `?` placeholders: org, from, to.
const SHIFT_ROWS = `
  SELECT s.id, s.date, s.hours, round(s.hours * 100)::bigint AS h, s.role, s.via,
         d.id AS person_id, d.name, d.email,
         COALESCE(o1.name, sg.opp_name) AS opportunity,
         COALESCE(NULLIF(o1.program, ''), NULLIF(sg.program, '')) AS opp_program,
         COALESCE(NULLIF(o1.program, ''), NULLIF(sg.program, ''), NULLIF(s.role, ''), '${NO_PROGRAM}') AS program
    FROM volunteer_shifts s
    JOIN donors d ON d.id = s.person_id AND d.org_id = s.org_id AND d.deleted_at IS NULL
    LEFT JOIN volunteer_opportunities o1 ON o1.id = s.opportunity_id AND o1.org_id = s.org_id
    LEFT JOIN LATERAL (
      SELECT o.name AS opp_name, o.program FROM volunteer_signups su
        JOIN volunteer_slots sl ON sl.id = su.slot_id
        JOIN volunteer_opportunities o ON o.id = sl.opportunity_id
       WHERE su.hours_shift_id = s.id AND su.org_id = s.org_id
       ORDER BY su.id LIMIT 1) sg ON true
   WHERE s.org_id = ? AND s.date >= ? AND s.date <= ?`;

// One grouping of those rows. `by` is "person", "program" or "month".
const GROUP = {
  person: { cols: "x.person_id AS id, x.name", key: "x.person_id, x.name", order: "h DESC, x.name" },
  program: { cols: "x.program", key: "x.program", order: "h DESC, x.program" },
  month: { cols: "substring(x.date from 1 for 7) AS month", key: "1", order: "1" },
};
function groupSql(by) {
  const g = GROUP[by];
  if (!g) throw new Error("hoursReport: no grouping " + by);
  return `SELECT ${g.cols}, SUM(x.h)::bigint AS h, COUNT(*)::int AS n
            FROM (${SHIFT_ROWS}) x GROUP BY ${g.key} ORDER BY ${g.order}`;
}

async function breakdowns(query, orgId, from, to) {
  const p = [orgId, from, to];
  const [byPerson, byProgram, byMonth] = await Promise.all([
    query(groupSql("person"), p), query(groupSql("program"), p), query(groupSql("month"), p)]);
  return { byPerson, byProgram, byMonth };
}

// The rows behind one figure: the same set, narrowed by the figure's key.
function rowsWhere(kind) {
  if (kind === "person") return "x.person_id = ?";
  if (kind === "month") return "substring(x.date from 1 for 7) = ?";
  if (kind === "program") return "x.program = ?";
  return null;
}

module.exports = { NO_PROGRAM, SHIFT_ROWS, groupSql, breakdowns, rowsWhere };

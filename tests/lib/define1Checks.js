// tests/lib/define1Checks.js · DEFINE-1. ONE NAME, ONE POPULATION, EVERYWHERE.
//
// Jarvis (22 Nov): five "lapsed" counts from five populations under one word; "All donors"
// claimed members who never gave; two audiences both named Volunteers. Each registry population
// (shared/populationWords.js) that two surfaces count is asked of both here, through the real API,
// and the two must agree. Planted (tests/define1-populations.test.js): All donors back on the
// stored role → `donors` red; the Volunteers screen's group offered again → `one Volunteers` red.
"use strict";

async function define1Checks({ orgId, get, q, agree, diffs, skip }) {
  // An ended campaign shows its result, never a pace (Jarvis: "ended campaigns say 'Behind pace'").
  if (!skip.has("endedPace")) {
    const list = await get("/fundraising/campaigns");
    const goals = (list && (list.goals || list.campaigns)) || (Array.isArray(list) ? list : []);
    for (const g of goals.filter(x => x && x.lifecycle === "ended")) {
      if (["behind", "on_track", "ahead"].includes(g.paceState)) diffs.push(`endedPace: campaign "${g.name}" ended and still reads a pace (${g.paceState})`);
    }
  }
  if (skip.has("populations")) return;
  const [aud, dir, roster, starters, lyb, monthly] = await Promise.all([
    get("/audiences"),
    get("/donors?roleCounts=1&role=donor&limit=1&offset=0"),
    get("/volunteer-hub/roster"),
    get("/groups/starters"),
    get("/reports/lybunt"),
    get("/donors?monthly=1&limit=1&offset=0"),
  ]);
  const audiences = (aud && aud.audiences) || [];
  const byId = id => audiences.find(a => a.id === id);
  const { POPULATION_IDS } = require("../../shared/numbers/populations");

  // Every population an audience or a starter names is a registry id.
  for (const a of audiences) if (a.population && !POPULATION_IDS.includes(a.population)) diffs.push(`audience "${a.name}" names population "${a.population}", which the registry does not have`);
  for (const s of (starters && starters.starters) || []) if (s.population && !POPULATION_IDS.includes(s.population)) diffs.push(`starter "${s.name}" names population "${s.population}", which the registry does not have`);

  // Donors: the Directory's Donors count and the All donors audience are one population (gave at least once).
  const donorsAud = byId("builtin:donors");
  if (donorsAud && dir && dir.roleCounts) {
    agree("population donors (gave at least once)", [
      ["the Directory's Donors count", Number(dir.roleCounts.donors)],
      ["the All donors audience", Number(donorsAud.members)],
    ]);
    if (donorsAud.population !== "donors") diffs.push(`All donors audience is population "${donorsAud.population}", not "donors"`);
  }
  // And nobody in Donors has never given (by the gift rows, written out here).
  const [ng] = await q(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.erased_at IS NULL AND d.archived_at IS NULL
                          AND COALESCE(d.imported_total, 0) <= 0
                          AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0)
                          AND (COALESCE(d.gift_count, 0) > 0 OR COALESCE(d.total_giving, 0) > 0)`, [orgId]);
  if (Number(ng.n)) diffs.push(`population donors: ${ng.n} people count as donors with no gift above $0 on file`);

  // Volunteers: one audience by that name, and it is the roster.
  const vols = audiences.filter(a => String(a.name).trim().toLowerCase() === "volunteers");
  if (vols.length > 1) diffs.push(`one Volunteers: ${vols.length} audiences are named Volunteers (${vols.map(v => `${v.id} ${v.members}`).join(", ")})`);
  const volAud = byId("builtin:volunteers");
  if (volAud && roster && Array.isArray(roster.people)) {
    const [arch] = await q(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.erased_at IS NULL AND d.archived_at IS NOT NULL
                              AND d.person_types @> '["volunteer"]'::jsonb`, [orgId]);
    agree("population volunteers (the roster)", [
      ["the Volunteers roster, less archived records", roster.people.length - Number(arch.n)],
      ["the Volunteers audience", Number(volAud.members)],
    ]);
  }

  // LYBUNT you can ask: the Groups starter is Reports > LYBUNT less those marked deceased, do not contact or do not solicit.
  const st = ((starters && starters.starters) || []).find(s => s.key === "lybunt");
  if (lyb && Array.isArray(lyb.rows)) {
    const ids = lyb.rows.map(r => r.id);
    const [ask] = ids.length ? await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = $1 AND id = ANY($2::text[])
                                          AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND do_not_solicit IS NOT TRUE`, [orgId, ids]) : [{ n: 0 }];
    agree("population lybunt_askable", [
      ["Reports > LYBUNT, less the unaskable", Number(ask.n)],
      ["the Groups starter", st ? Number(st.count) : 0],
    ]);
    // Households are never more than people, and the report's people are its rows.
    const units = (lyb.units || lyb.rows).length;
    if (units > lyb.rows.length) diffs.push(`population lybunt_households: ${units} households is more than ${lyb.rows.length} LYBUNT people`);
  }

  // Monthly givers: the starter and the Donors filter.
  const mst = ((starters && starters.starters) || []).find(s => s.key === "monthly");
  if (monthly && monthly.total != null) agree("population monthly_givers", [["the Donors filter Gives monthly", Number(monthly.total)], ["the Groups starter", mst ? Number(mst.count) : 0]]);
}

module.exports = { define1Checks };

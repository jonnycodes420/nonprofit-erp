// server/outreach/journeyBatchOptions.js · FLOWS-1 item 1. WHICH JOURNEY THESE
// PEOPLE CAN START, ON EACH JOURNEY'S OWN ROW.
//
// The Donors list's "Add to a journey" showed a bare dropdown and a Start that
// stayed off with no reason. Now the dialog lists every journey with, for the
// people checked, how many would start it and, when nobody would, why not
// ("None of these 3 can start: all are already in it").
//
// `splitFor` is the start path's rules (journeyStart.js) for one journey, on
// facts read once: `loadFacts` reads the people and the journeys they are in
// with two queries for the whole list, so every journey's row is worked out in
// memory, never a query per journey. The batch preview and start use the same
// split (journeys.js batchSplit), so a row and its Start never disagree.
"use strict";

async function loadFacts(query, orgId, ids) {
  if (!ids.length) return { people: [], plans: [] };
  const [people, plans] = await Promise.all([
    query(`SELECT id, deceased, do_not_contact, do_not_solicit FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL`, [orgId, ids]),
    query(`SELECT p.donor_id, p.template_id, p.priority, COALESCE(ct.exclusive, false) AS exclusive
             FROM cultivation_plans p LEFT JOIN cultivation_templates ct ON ct.id = p.template_id AND ct.org_id = p.org_id
            WHERE p.org_id=? AND p.status='active' AND p.donor_id = ANY(?::text[])`, [orgId, ids]),
  ]);
  return { people, plans };
}

// Who of `ids` would start journey `t`, and who would not and why.
function splitFor(J, t, ids, facts, joinOthers = true) {
  const asks = J.journeyAsks(t.steps);
  const out = { asked: ids.length, willStart: [], skips: {} };
  const skip = (reason, id) => (out.skips[reason] = out.skips[reason] || []).push(id);
  const flags = new Map(facts.people.map(d => [d.id, d]));
  const byDonor = new Map();
  for (const p of facts.plans) (byDonor.get(p.donor_id) || byDonor.set(p.donor_id, []).get(p.donor_id)).push(p);
  for (const id of ids) {
    const f = flags.get(id);
    if (!f) { skip("donor_not_found", id); continue; }
    if (f.deceased === true) { skip("deceased", id); continue; }
    if (f.do_not_contact === true) { skip("do_not_contact", id); continue; }
    if (asks && f.do_not_solicit === true) { skip("do_not_solicit", id); continue; }
    const mine = byDonor.get(id) || [];
    if (mine.some(p => p.template_id === t.id)) { skip("already_in_this_journey", id); continue; }
    if (t.exclusive && mine.some(p => p.exclusive && Number(p.priority) >= Number(t.priority))) { skip("already_in_a_journey", id); continue; }
    if (!joinOthers && mine.length) { skip("in_another_journey", id); continue; }
    out.willStart.push(id);
  }
  return out;
}

// The short reason on a journey's row when nobody checked can start it.
const NONE_WHY = {
  already_in_this_journey: "already in it",
  already_in_a_journey: "already in a journey that comes first",
  in_another_journey: "in another journey",
  do_not_contact: "marked do not contact",
  deceased: "marked as died",
  do_not_solicit: "marked do not solicit, and this journey asks for money",
  donor_not_found: "no longer in Steward",
};
function rowWhy(asked, willStart, skips) {
  const who = asked === 1 ? "This person can't start" : `None of these ${asked.toLocaleString("en-US")} can start`;
  if (willStart > 0) {
    return willStart === asked
      ? `${asked === 1 ? "This person" : `All ${asked.toLocaleString("en-US")}`} can start.`
      : `${willStart.toLocaleString("en-US")} of ${asked.toLocaleString("en-US")} can start.`;
  }
  const reasons = Object.entries(skips).filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length);
  if (reasons.length === 1) {
    const [k] = reasons[0];
    return `${who}: ${asked === 1 ? "they are" : "all are"} ${NONE_WHY[k] || "unable to start"}.`;
  }
  return `${who}: ${reasons.map(([k, v]) => `${v.length} ${NONE_WHY[k] || "unable to start"}`).join(", ")}.`;
}

const STATE_NOTE = {
  running: "On",
  paused: "Paused: people you add here still start",
  draft: "Draft: people you add here still start",
};

function register(app, { query, journeyMod, requireAuth, wrap, batchIdsFrom, BATCH_MAX }) {
  // A POST because the list can be thousands of ids long; it writes nothing.
  app.post("/journeys/batch-options", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const ids = batchIdsFrom(req.body);
    if (!ids.length) return res.status(400).json({ error: "no_donors", sentence: "Check at least one person first." });
    if (ids.length > BATCH_MAX) return res.status(400).json({ error: "too_many", sentence: `That is more than ${BATCH_MAX.toLocaleString("en-US")} people at once. Narrow the list first.` });
    const J = await journeyMod();
    const [templates, facts] = await Promise.all([
      query(`SELECT id, name, steps, priority, exclusive, journey_enabled, ever_enabled
               FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY priority DESC, name`, [orgId]),
      loadFacts(query, orgId, ids),
    ]);
    const everIn = new Set((await query(`SELECT DISTINCT template_id FROM cultivation_plans WHERE org_id=? AND template_id IS NOT NULL`, [orgId])).map(r => r.template_id));
    const journeys = templates.map(t => {
      const s = splitFor(J, t, ids, facts);
      const state = J.journeyState({ enabled: !!t.journey_enabled, everEnabled: !!t.ever_enabled, archived: false, everIn: everIn.has(t.id) ? 1 : 0 });
      return { id: t.id, name: t.name, state, stateNote: STATE_NOTE[state] || "", willStart: s.willStart.length,
        canPick: s.willStart.length > 0, why: rowWhy(ids.length, s.willStart.length, s.skips) };
    });
    res.json({ asked: ids.length, journeys });
  }));
}

module.exports = { loadFacts, splitFor, register, rowWhy };

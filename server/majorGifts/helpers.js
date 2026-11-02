// server/majorGifts/helpers.js — what more than one major gifts file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  proposalMod, query,
} = ctx;

async function orgFundNames(orgId) {
  const rows = await query("SELECT id, name FROM fin_funds WHERE org_id=?", [orgId]);
  return new Map(rows.map(r => [r.id, r.name]));
}

// THE HOUSEHOLD HALF OF "ONE OPEN AT A TIME PER FUND". The per-person half is a
// unique index (db.js); this is the half a partial index cannot express, and it
// is the half that matters most — asking a husband and a wife separately for
// the capital campaign is exactly the double-ask the rule exists to stop.
async function openProposalConflict(orgId, donorId, fundId, excludeId) {
  const [me] = await query("SELECT id, household_id FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
  if (!me) return null;
  const P = await proposalMod();
  const rows = await query(
    `SELECT o.id, o.donor_id, d.name AS donor_name, d.household_id
       FROM opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
      WHERE o.org_id = ? AND o.proposal_stage = ANY(?::text[]) AND COALESCE(o.fund_id,'') = ?
        AND (d.id = ? OR (?::text IS NOT NULL AND d.household_id = ?))
        AND d.deleted_at IS NULL`,
    [orgId, P.OPEN_STAGE_KEYS, fundId || "", donorId, me.household_id, me.household_id]);
  const hit = rows.find(r => r.id !== excludeId);
  if (!hit) return null;
  const fundLabel = fundId ? (await orgFundNames(orgId)).get(fundId) || "fund" : "no particular fund";
  return {
    code: "proposal_already_open",
    error: hit.donor_id === donorId
      ? `There is already an open proposal for ${fundLabel}. Close or move that one first.`
      : `${hit.donor_name} in the same household already has an open proposal for ${fundLabel}. Close or move that one first.`,
    conflictId: hit.id,
  };
}
return { openProposalConflict, orgFundNames };
}

module.exports = { mount };

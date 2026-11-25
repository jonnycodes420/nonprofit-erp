// server/admin/sales/orderDeal.js · ORDER-1 item 4. THE DEAL FOLLOWS THE ORDER.
//
// An order is raised for a Steward org (the close link, ONBOARD-1). Its deal is the open
// deal of the sales organization linked to that org (sales_orgs.steward_org_id), found
// when the order is made and kept on the link. When she signs, the deal moves to
// **Signed** with the signed order on it; when Stripe says the card went in, to
// **Card on file**. Never backwards, never past a won or lost deal.
//
// A pipeline made before ORDER-1 has neither stage. The first order that needs one adds
// it, after "Verbal yes", as an onboarding stage, stamped with the signer's system actor
// (a change a person caused by signing, never one made at deploy).
//
// Here, because only server/admin/sales/ reads the sales_ tables (tests/tenant-isolation.test.js).
"use strict";
const { newId } = require("../../shared/newId");

const STAGES = {
  signed: { name: "Signed", probability: 85, after: /^verbal yes$/i },
  card: { name: "Card on file", probability: 88, after: /^signed$/i },
};
const MISSING = new Set(["42P01", "42703"]);
const quiet = fallback => e => { if (e && MISSING.has(e.code)) return fallback; throw e; };

// The open deal for a Steward org: its linked sales organization's newest open deal.
async function dealForOrg(query, orgId) {
  const [d] = await query(`SELECT d.id, d.name FROM sales_orgs o
      JOIN sales_links l ON l.b_type = 'org' AND l.b_id = o.id AND l.a_type = 'deal'
      JOIN sales_deals d ON d.id = l.a_id AND d.deleted_at IS NULL
      LEFT JOIN sales_stages s ON s.id = d.stage_id
     WHERE o.steward_org_id = ? AND o.deleted_at IS NULL AND COALESCE(s.kind, 'open') IN ('open', 'won')
     ORDER BY (COALESCE(s.kind, 'open') = 'open') DESC, d.updated_at DESC NULLS LAST, d.created_at DESC LIMIT 1`, [orgId]).catch(quiet([]));
  return d || null;
}
async function dealName(query, dealId) {
  if (!dealId) return null;
  const [d] = await query(`SELECT name FROM sales_deals WHERE id = ? AND deleted_at IS NULL`, [dealId]).catch(quiet([]));
  return d ? d.name : null;
}

async function ensureStage(ctx, pipelineId, key, who) {
  const want = STAGES[key];
  const stages = await ctx.query(`SELECT id, name, position, kind FROM sales_stages WHERE pipeline_id = ? ORDER BY position`, [pipelineId]);
  const have = stages.find(s => s.name.trim().toLowerCase() === want.name.toLowerCase());
  if (have) return have;
  const prev = stages.find(s => want.after.test(s.name.trim())) || [...stages].reverse().find(s => s.kind === "open");
  const position = prev ? Number(prev.position) + 1 : stages.length;
  await ctx.run(`UPDATE sales_stages SET position = position + 1 WHERE pipeline_id = ? AND position >= ?`, [pipelineId, position]);
  const id = newId("sst");
  await ctx.run(`INSERT INTO sales_stages (id, pipeline_id, name, position, probability, limit_days, kind, onboarding, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, 21, 'open', true, ?, ?)`, [id, pipelineId, want.name, position, want.probability, who.id, who.name]);
  return { id, name: want.name, position, kind: "open" };
}

// Move the deal forward to Signed or Card on file. Returns the stage name it is at, or null.
async function moveTo(ctx, dealId, key, who) {
  if (!dealId) return null;
  const [d] = await ctx.query(`SELECT d.pipeline_id, s.position, s.kind, s.name FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id
                                WHERE d.id = ? AND d.deleted_at IS NULL`, [dealId]).catch(quiet([]));
  if (!d || !d.pipeline_id) return null;
  if (d.kind && d.kind !== "open") return d.name;   // won, lost or later: the order does not move it back
  const st = await ensureStage(ctx, d.pipeline_id, key, who);
  if (d.position != null && Number(d.position) >= Number(st.position)) return d.name;
  const r = await require("./records").setStage(ctx, dealId, st.id, who);
  return r && r.ok ? st.name : d.name;
}

async function note(ctx, dealId, body, who) {
  if (!dealId) return;
  await require("./activities").create(ctx, { kind: "note", records: [{ type: "deal", id: dealId }], body }, who);
}

module.exports = { dealForOrg, dealName, moveTo, note, STAGES };

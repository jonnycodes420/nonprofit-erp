#!/usr/bin/env node
// LETTERS-1 item 5 · CAMPAIGNS THAT SHARE A NAME, AND DRAFTS WITH GIFTS ON THEM.
//
// Before LETTERS-1, Add a gift's picker offered "+ New campaign: 'ANNU'" while a name was still
// being typed, and a campaign made from a gift has no goal, so it never showed on the Campaigns
// page where it could be found and fixed (a pilot customer, 24 Nov). LETTERS-1 stops new ones and
// puts drafts on the Campaigns page with Merge; this lists the ones that already exist.
//
// DRY RUN BY DEFAULT, read only. Per org:
//   * campaigns that share a name (case and spacing ignored), with each one's gifts, and which one
//     --apply would keep: the oldest that has a goal, else the oldest;
//   * draft campaigns (no goal) that have gifts on them, with their gift count.
//
//   DATABASE_URL=… node scripts/ops/letters1-campaign-duplicates.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/letters1-campaign-duplicates.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply merges each same-name group in that one org into the one kept, through the app's own
// merge (server/outreach/campaignMerge.js mergeCampaigns: every gift, pledge, recurring gift,
// giving page, grant, event, task and appeal moves; the merged campaigns are retired, kept on past
// reports; Undo stays available on the Campaigns page by POST /campaign-tidy/merge/:id/undo). One
// audit row per merge as system:letters1-campaign-duplicates. Drafts with gifts are listed only:
// which campaign a draft meant is her call, on the Campaigns page. A remote database needs
// --i-know-this-is-prod (prodGuard's writerDbUrl). Never org_creo, never org_b72demo. Nothing sends.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:letters1-campaign-duplicates", name: "Campaigns of one name merged (LETTERS-1)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

async function main() {
  const db = require("../../db");
  const { query } = db;
  const CM = require("../../server/outreach/campaignMerge");
  const { GIFT } = require("../../shared/numbers/money");
  const rows = await query(
    `SELECT c.id, c.org_id, c.name, c.created_at, ${CM.DRAFT("c")} AS draft, ${CM.KEY_SQL("c.name")} AS k,
            (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = c.org_id AND g.campaign_id = c.id AND ${GIFT("g")}) AS gifts
       FROM campaigns c
      WHERE c.retired_at IS NULL AND NOT ${CM.EMAIL_ONLY("c")} AND c.is_sample IS NOT TRUE
        AND ($1::text IS NULL OR c.org_id = $1) AND NOT (c.org_id = ANY($2))
      ORDER BY c.org_id, k, c.created_at`, [ORG || null, NEVER]);
  const byOrg = new Map();
  for (const r of rows) {
    const o = byOrg.get(r.org_id) || byOrg.set(r.org_id, { groups: new Map(), drafts: [] }).get(r.org_id);
    (o.groups.get(r.k) || o.groups.set(r.k, []).get(r.k)).push(r);
    if (r.draft && r.gifts > 0) o.drafts.push(r);
  }
  const plans = [];
  for (const [org, o] of byOrg) {
    const dupes = [...o.groups.values()].filter(g => g.length > 1);
    if (!dupes.length && !o.drafts.length) continue;
    console.log(`\n${org}`);
    for (const g of dupes) {
      const keep = g.find(c => !c.draft) || g[0];
      console.log(`  "${keep.name}": ${g.length} campaigns share the name. Keep ${keep.id} (${keep.draft ? "a draft, the oldest" : "the oldest with a goal"}).`);
      for (const c of g) console.log(`    ${c.id === keep.id ? "keep " : "merge"} ${c.id}  "${c.name}"  ${c.draft ? "draft" : "goal set"}  ${c.gifts} gift${c.gifts === 1 ? "" : "s"}`);
      plans.push({ org, keep, merge: g.filter(c => c.id !== keep.id) });
    }
    for (const d of o.drafts) console.log(`  draft with gifts: ${d.id}  "${d.name}"  ${d.gifts} gift${d.gifts === 1 ? "" : "s"} (merge or finish it on the Campaigns page)`);
  }
  console.log(`\n${plans.length} same-name group${plans.length === 1 ? "" : "s"} to merge${ORG ? ` in ${ORG}` : ""}.`);
  if (!APPLY) { console.log("Dry run: nothing was written." + (plans.length ? " Add --org <org> --apply to merge them." : "")); return; }
  for (const p of plans) {
    const r = await CM.mergeCampaigns(db, p.org, p.keep.id, p.merge.map(c => c.id), ACTOR);
    if (r.status !== 200) { console.log(`  skipped "${p.keep.name}": ${r.body.sentence}`); continue; }
    await query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES (?,?,?,?,?,'letters1 campaigns of one name merged','campaign',?,?,NULL,NULL,?,?,'SCRIPT','scripts/ops/letters1-campaign-duplicates.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), p.org, ACTOR.id, ACTOR.name, ACTOR.kind, p.keep.id,
       JSON.stringify({ mergeId: r.body.mergeId, merged: r.body.merged, moved: r.body.moved }), r.body.sentence, (r.body.moved.gifts || 0)]);
    console.log(`  ${r.body.sentence} Undo: POST /campaign-tidy/merge/${r.body.mergeId}/undo`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

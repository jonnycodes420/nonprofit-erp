#!/usr/bin/env node
// ADMIN-CLEAN Part 5 · SORT EVERY ORG INTO ITS KIND, AND CLEAR THE JUNK.
//
// DRY RUN BY DEFAULT. It prints one line per org, by name and id only: the
// kind it would get (orgKind.js, the same rule the console shows), the action
// (keep, archive, delete, decide) and why. Nothing is written without --apply,
// and --apply does exactly what the dry run printed, in one transaction, with
// one fin_audit_log row per org (actor system:scripts/admin-clean).
//
// THE GUARD: an org with a Stripe subscription, a paid Steward invoice or a
// real (non-sample) donor is NEVER deleted. At most it is archived, which only
// hides it and is undone by --unarchive=org_x or Restore in /admin.
//
// Duplicates are never merged. Two orgs with the same name are listed with
// their logins, last sign-in and Stripe state; when only one has real donors
// the empty one is proposed for archiving, and when they are level (both
// empty) the script says "decide" and does nothing until Jonathan names one
// with --archive=org_x.
//
// Usage (Jonathan runs it; prod needs the flag):
//   railway run node scripts/admin-clean.js --i-know-this-is-prod                 # dry run
//   railway run node scripts/admin-clean.js --i-know-this-is-prod --apply         # do it
//   --archive=org_a,org_b   archive these too (the duplicate he names)
//   --keep=org_a            leave these exactly as they are
//   --unarchive=org_a       undo an archive (with --apply)
// Locally: DATABASE_URL=postgresql://steward@localhost:5544/<db> node scripts/admin-clean.js

const crypto = require("crypto");
const ORG_KIND = require("../orgKind");

const ACTOR = { id: "system:scripts/admin-clean", name: "Admin clean-up", kind: "system" };

const listArg = name => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1].split(",").map(s => s.trim()).filter(Boolean) : [];
};
const normName = n => String(n || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// The decision for one org, with no database in it, so the suite reads it too.
// `facts` = { users, payments, realDonors }; `opts` = { archive:Set, keep:Set,
// dupes: Map(normName -> orgs) }.
function decide(org, facts, opts = {}) {
  const k = ORG_KIND.inferKind({ ...org, org_kind: org.org_kind }, facts);
  const blockers = [];
  if (org.stripe_subscription_id) blockers.push("Stripe subscription");
  if (facts.payments > 0) blockers.push(`${facts.payments} paid invoice${facts.payments === 1 ? "" : "s"}`);
  if (facts.realDonors > 0) blockers.push(`${facts.realDonors} real donor${facts.realDonors === 1 ? "" : "s"}`);
  const base = { id: org.id, name: org.name, kind: k.kind, kindReason: k.reason, blockers };
  const out = (action, why) => ({ ...base, action, why });

  if (opts.keep?.has(org.id)) return out("keep", "named with --keep");
  if (org.archived_at && !opts.unarchive?.has(org.id)) return out("keep", "already archived");
  if (opts.unarchive?.has(org.id)) return out("unarchive", "named with --unarchive");
  if (opts.archive?.has(org.id)) return out("archive", "named with --archive");
  if (ORG_KIND.DEMO_ORG_IDS.includes(org.id)) return out("keep", "the demo org prospects are shown");

  // Duplicates of a real prospect: never merged, the empty twin archived.
  const twins = (opts.dupes?.get(normName(org.name)) || []).filter(o => o.id !== org.id && !o.archived_at && !opts.archive?.has(o.id));
  if (twins.length && ORG_KIND.countsAsCustomer(k.kind)) {
    const mine = facts.realDonors, best = Math.max(...twins.map(t => t.realDonors || 0));
    if (best > mine && !blockers.includes("Stripe subscription") && facts.payments === 0)
      return out("archive", `duplicate of ${twins.map(t => t.id).join(", ")}, which has ${best} real donors to this one's ${mine}`);
    if (best === mine)
      return out("decide", `same name as ${twins.map(t => t.id).join(", ")}, level on real donors (${mine}). Jonathan names the one to archive with --archive=`);
    return out("keep", `the fuller of ${twins.length + 1} orgs named "${org.name}"`);
  }

  if (k.kind === "fixture" || (k.kind === "internal_test" && ORG_KIND.JUNK_NAME_RE.test(org.name || ""))
      || (k.kind === "demo")) {
    if (blockers.length) return out("archive", `${ORG_KIND.KIND_LABEL[k.kind]}, but it has ${blockers.join(", ")}, so archive, never delete`);
    return out("delete", `${ORG_KIND.KIND_LABEL[k.kind]} with no subscription, no payment and no real donor`);
  }
  if (k.kind === "internal_test") return out("keep", "Jonathan's own; kept, never counted");
  return out("keep", ORG_KIND.KIND_LABEL[k.kind]);
}

async function gather(query) {
  const cols = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='orgs' AND column_name IN ('org_kind','archived_at')`);
  if (cols.length < 2) throw new Error("orgs.org_kind / orgs.archived_at are missing: deploy ADMIN-CLEAN first (the server's boot adds them).");
  const orgs = await query(`SELECT id, name, org_kind, archived_at, is_demo_org, plan, subscription_status,
                                   stripe_customer_id, stripe_subscription_id, created_at
                              FROM orgs ORDER BY created_at`);
  const users = await query(`SELECT u.org_id, u.email, u.role, u.deactivated_at,
                                    (SELECT MAX(s.last_active_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen
                               FROM users u ORDER BY u.created_at`);
  const pay = await query(`SELECT org_id, COUNT(*) AS c FROM platform_payments GROUP BY org_id`);
  const real = await query(`SELECT org_id, COUNT(*) AS c FROM donors WHERE deleted_at IS NULL AND COALESCE(is_sample,false)=false GROUP BY org_id`);
  const byOrg = new Map();
  for (const o of orgs) byOrg.set(o.id, { users: [], payments: 0, realDonors: 0 });
  for (const u of users) byOrg.get(u.org_id)?.users.push(u);
  for (const p of pay) if (byOrg.has(p.org_id)) byOrg.get(p.org_id).payments = parseInt(p.c, 10);
  for (const r of real) if (byOrg.has(r.org_id)) byOrg.get(r.org_id).realDonors = parseInt(r.c, 10);
  // Logins that are deactivated do not make an org "someone else's".
  const facts = id => { const f = byOrg.get(id); return { ...f, users: f.users.filter(u => !u.deactivated_at) }; };
  return { orgs, facts, allUsers: id => byOrg.get(id).users };
}

function plan(orgs, facts, opts) {
  const dupes = new Map();
  for (const o of orgs) {
    const f = facts(o.id);
    const key = normName(o.name);
    if (!key) continue;
    if (!dupes.has(key)) dupes.set(key, []);
    dupes.get(key).push({ id: o.id, realDonors: f.realDonors, archived_at: o.archived_at });
  }
  for (const [k, v] of dupes) if (v.length < 2) dupes.delete(k);
  return orgs.map(o => decide(o, facts(o.id), { ...opts, dupes }));
}

function printPlan(rows, orgs, allUsers) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nADMIN-CLEAN ${process.argv.includes("--apply") ? "APPLY" : "DRY RUN"}: ${rows.length} orgs\n`);
  console.log(pad("ACTION", 10) + pad("KIND", 16) + pad("ORG ID", 22) + "NAME  (why)");
  for (const r of rows) {
    console.log(pad(r.action.toUpperCase(), 10) + pad(ORG_KIND.KIND_LABEL[r.kind], 16) + pad(r.id, 22)
      + `${r.name}  (${r.why}; kind: ${r.kindReason}${r.blockers.length ? `; has ${r.blockers.join(", ")}` : ""})`);
  }
  const totals = rows.reduce((t, r) => (t[r.action] = (t[r.action] || 0) + 1, t), {});
  console.log("\nTotals: " + Object.entries(totals).map(([a, n]) => `${n} ${a}`).join(", "));
  // The duplicates Jonathan decides: who signs in where, and what Stripe holds.
  const decide = rows.filter(r => r.action === "decide" || /duplicate|fuller of/.test(r.why));
  if (decide.length) {
    console.log("\nDUPLICATES (never merged). Logins, last sign-in and Stripe state:");
    for (const r of decide) {
      const o = orgs.find(x => x.id === r.id);
      console.log(`  ${r.id}  ${r.name}: ${o.subscription_status || "no status"}, plan ${o.plan || "none"}, `
        + `Stripe customer ${o.stripe_customer_id ? "yes" : "no"}, subscription ${o.stripe_subscription_id ? "yes" : "no"}`);
      for (const u of allUsers(r.id))
        console.log(`      ${u.email} (${u.role}${u.deactivated_at ? ", removed" : ""}) last signed in ${u.last_seen ? new Date(u.last_seen).toISOString().slice(0, 10) : "never"}`);
    }
  }
}

async function audit(runTx, client, orgId, action, summary, before, after) {
  await runTx(client,
    `INSERT INTO fin_audit_log
       (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
        changes, before_fields, after_fields, summary, record_count, request_method, request_path)
     VALUES (?,?,?,?,?,?,'org',?,?,?,?,?,1,'SCRIPT','scripts/admin-clean.js')`,
    ["al_" + crypto.randomUUID().slice(0, 12), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, orgId,
     JSON.stringify(after), JSON.stringify(before), JSON.stringify(after), summary]);
}

// Every table that holds an org's rows, emptied in passes inside ONE
// transaction per org: a pass deletes what nothing else still points at, and
// passes repeat until nothing moves. The audit tables stay (the log promises
// seven years, FIX-12). If the org row still cannot go, the whole delete rolls
// back and the org is archived instead: nothing is ever half-deleted.
const KEEP_TABLES = new Set(["fin_audit_log", "sample_data_audit", "orgs"]);
async function deleteOrgEverywhere(client, orgId) {
  const tables = (await client.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.column_name = 'org_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`)).rows
    .map(r => r.table_name).filter(t => !KEEP_TABLES.has(t));
  // Rows that hang off a login rather than the org.
  await client.query("SAVEPOINT ac");
  try { await client.query("DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)", [orgId]); await client.query("RELEASE SAVEPOINT ac"); }
  catch { await client.query("ROLLBACK TO SAVEPOINT ac"); }
  let left = tables.slice();
  for (let pass = 0; pass < 8 && left.length; pass++) {
    const next = [];
    for (const t of left) {
      await client.query("SAVEPOINT ac");
      try { await client.query(`DELETE FROM "${t}" WHERE org_id = $1`, [orgId]); await client.query("RELEASE SAVEPOINT ac"); }
      catch { await client.query("ROLLBACK TO SAVEPOINT ac"); next.push(t); }
    }
    if (next.length === left.length) break;
    left = next;
  }
  await client.query("DELETE FROM orgs WHERE id = $1", [orgId]);
}

async function apply(rows, orgs, db) {
  const { withTransaction, runTx } = db;
  // 1. Kinds, archives and restores: one transaction.
  await withTransaction(async client => {
    for (const r of rows) {
      const o = orgs.find(x => x.id === r.id);
      // Every org gets its kind written down, so the mail rule and the console
      // read a fact rather than a guess from here on.
      // The two demo orgs are never written (CLAUDE.md: only seed-demo writes
      // org_b72demo, and org_creo is never written on prod); they are known
      // by id everywhere a kind matters.
      if (ORG_KIND.DEMO_ORG_IDS.includes(r.id)) continue;
      if (r.action !== "delete" && o.org_kind !== r.kind) {
        await runTx(client, "UPDATE orgs SET org_kind=?, org_kind_set_at=NOW(), org_kind_set_by=? WHERE id=?", [r.kind, ACTOR.id, r.id]);
        await audit(runTx, client, r.id, "set org kind", `Kind set to ${ORG_KIND.KIND_LABEL[r.kind]} (${r.kindReason})`, { org_kind: o.org_kind }, { org_kind: r.kind });
      }
      if (r.action === "archive") {
        await runTx(client, "UPDATE orgs SET archived_at=NOW(), archived_by=? WHERE id=? AND archived_at IS NULL", [ACTOR.id, r.id]);
        await audit(runTx, client, r.id, "archive org", `Archived: ${r.why}`, { archived_at: null }, { archived: true });
      } else if (r.action === "unarchive") {
        await runTx(client, "UPDATE orgs SET archived_at=NULL, archived_by=NULL WHERE id=?", [r.id]);
        await audit(runTx, client, r.id, "unarchive org", "Restored", { archived: true }, { archived_at: null });
      }
    }
  });
  // 2. Deletes: one transaction each, the guard re-read inside it.
  for (const r of rows.filter(x => x.action === "delete")) {
    try {
      await withTransaction(async client => {
        const [o] = (await client.query("SELECT stripe_subscription_id FROM orgs WHERE id=$1 FOR UPDATE", [r.id])).rows;
        if (!o) return;
        const pay = (await client.query("SELECT COUNT(*) AS c FROM platform_payments WHERE org_id=$1", [r.id])).rows[0].c;
        const real = (await client.query("SELECT COUNT(*) AS c FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND COALESCE(is_sample,false)=false", [r.id])).rows[0].c;
        if (o.stripe_subscription_id || Number(pay) > 0 || Number(real) > 0) throw new Error("it has a subscription, a payment or a real donor");
        await audit(runTx, client, r.id, "delete org", `Deleted ${r.name}: ${r.why}`, { name: r.name, kind: r.kind }, { deleted: true });
        await deleteOrgEverywhere(client, r.id);
      });
      console.log(`  deleted ${r.id} ${r.name}`);
    } catch (e) {
      console.log(`  NOT deleted ${r.id} ${r.name}: ${e.message}. Archiving it instead.`);
      await withTransaction(async client => {
        await runTx(client, "UPDATE orgs SET org_kind=COALESCE(org_kind, ?), archived_at=COALESCE(archived_at, NOW()), archived_by=? WHERE id=?", [r.kind, ACTOR.id, r.id]);
        await audit(runTx, client, r.id, "archive org", `Archived (delete refused: ${e.message})`, { archived_at: null }, { archived: true });
      });
    }
  }
}

async function main() {
  const { writerDbUrl } = require("./lib/prodGuard");
  process.env.DATABASE_URL = writerDbUrl();
  if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && !process.env.DB_SSL) process.env.DB_SSL = "disable";
  const db = require("../db");
  const APPLY = process.argv.includes("--apply");
  const opts = { archive: new Set(listArg("archive")), keep: new Set(listArg("keep")), unarchive: new Set(listArg("unarchive")) };
  const { orgs, facts, allUsers } = await gather(db.query);
  const rows = plan(orgs, facts, opts);
  printPlan(rows, orgs, allUsers);
  if (!APPLY) { console.log("\nDry run: nothing was changed. Add --apply to do exactly this."); return; }
  await apply(rows, orgs, db);
  console.log("\nApplied. Every change has a fin_audit_log row (actor system:scripts/admin-clean).");
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { decide, plan, gather, normName, apply };

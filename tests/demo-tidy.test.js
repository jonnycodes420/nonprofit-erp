// tests/demo-tidy.test.js · DEMO-TIDY-1. THE DEMO TIDY SCRIPT (scripts/ops/demo-tidy.js).
//
// It writes donor data in a demo org, so it is guarded: on a planted copy of
// the demo's shape (org_dtidy, made-up names, with the fleet's QA residue)
// the dry run lists every change and writes nothing; --apply (in its own
// process, as Jonathan runs it) leaves no QA record and sets each baseline;
// a second apply changes nothing; --undo puts every row back; and an org
// that is not a demo is refused. Tests set their clock: --today is fixed.
//
// Would fail if: the demo check went (§0), a step wrote on a dry run (§1), a
// table left QA rows (§2), a step was not idempotent (§3), or an entry was not
// kept whole for undo (§4).
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");
const { q, closeDb } = require("./helpers");

const ORG = "org_dtidy", LIVE = "org_dtidy_live", TODAY = "2026-11-07";
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const S = require("../scripts/ops/demo-tidy");
let passed = 0, failed = 0;
const ok = (name, cond, info) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name + (info !== undefined ? "\n      " + JSON.stringify(info).slice(0, 600) : "")); } };
const by = { created_by: "system:test", created_by_name: "test" };

async function wipe() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let p = 0; p < 5; p++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id = ANY($1::text[])`, [[ORG, LIVE]]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id = ANY($1::text[])`, [[ORG, LIVE]]).then(() => true).catch(() => false)) break;
  }
}
const ins = (t, row) => { const k = Object.keys(row); return q(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map((_, i) => "$" + (i + 1)).join(",")})`, k.map(x => row[x] !== null && typeof row[x] === "object" ? JSON.stringify(row[x]) : row[x])); };

async function plant() {
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,org_kind,ein,receipt_signature_name,receipt_signature_title)
           VALUES ($1,'Tidy Lantern Arts (Demo)','org-dtidy',1,'active','team','America/New_York','demo','47-1234567','Maya Reyes','Executive Director'),
                  ($2,'Tidy Lantern Live','org-dtidy-live',1,'active','team','America/New_York',NULL,'47-1234567',NULL,NULL)`, [ORG, LIVE]);
  await ins("users", { id: "u_dtidy", org_id: ORG, email: "dtidy@test.local", password_hash: "x", name: "Priya Lindqvist", role: "admin", sign_title: "Executive Director" });
  await ins("users", { id: "u_dtidy_qa", org_id: ORG, email: "dtidy-qa@test.local", password_hash: "x", name: "Fleet Walker", role: "member" });
  const P = (id, name, extra = {}) => ins("donors", { id, org_id: ORG, name, email: `${id}@dtidy.example.org`, stage: "steward", status: "active", person_types: ["donor"], ...by, ...extra });
  await P("dt_marlowe", "Ottilie Marlowe", { about_them: "QA Nov5 walk note: edited About", address: "1 QA Street" });
  await P("dt_renee", "Renee Vantongeren", { email: "shared@dtidy.example.org" });
  await P("dt_renee2", "Renee V. (second record)", { email: "Shared@dtidy.example.org " });
  await P("dt_wendell", "Wendell Ashgrove");
  await P("dt_qa1", "QA Nov4 Test Person");
  await P("dt_qa2", "QA A3 Donor");
  await P("dt_qadir", "Qadir Hollins");   // not QA: the word must be QA
  await ins("fin_funds", { id: "dtf_gen_op", org_id: ORG, name: "General Operating", restricted: false });
  await ins("fin_funds", { id: "dtf_gen", org_id: ORG, name: "General", restricted: false });
  await ins("fin_funds", { id: "dtf_bld_fund", org_id: ORG, name: "Building Fund", restricted: true });
  await ins("fin_funds", { id: "dtf_bld", org_id: ORG, name: "Building", restricted: true });
  await ins("gifts", { id: "dtg_1", org_id: ORG, donor_id: "dt_renee", amount: 400, date: "2026-09-02", fund_id: "dtf_gen", ...by });
  await ins("gifts", { id: "dtg_2", org_id: ORG, donor_id: "dt_wendell", amount: 1200, date: "2026-08-14", fund_id: "dtf_bld", ...by });
  await ins("donor_list_views", { id: "dt_view", org_id: ORG, user_id: "u_dtidy", name: "QA Nov6 saved view", ...by });
  await ins("audiences", { id: "dt_grp", org_id: ORG, name: "QA A1 group", segment: {}, ...by });
  await ins("group_members", { org_id: ORG, group_id: "dt_grp", donor_id: "dt_wendell", added_by: "system:test" });
  await ins("cultivation_templates", { id: "dt_jt", org_id: ORG, name: "QA Nov5 journey", steps: [], ...by });
  await ins("cultivation_plans", { id: "dt_jp", org_id: ORG, donor_id: "dt_wendell", template_id: "dt_jt", template_name: "QA Nov5 journey", applied_on: "2026-10-01", status: "active", ...by });
  await ins("tasks", { id: "dt_task", org_id: ORG, title: "QA call back", ...by });
  await ins("tasks", { id: "dt_task_ok", org_id: ORG, title: "Quarterly thank-you calls", ...by });
  await ins("volunteer_shifts", { id: "dt_shift", org_id: ORG, person_id: "dt_wendell", date: "2026-10-01", hours: 2, role: "QA A2 usher", ...by });
  await ins("events", { id: "dt_ev", org_id: ORG, name: "QA Nov4 gala", event_type: "gala", date: "2026-10-10", ...by });
  await ins("event_attendees", { id: "dt_att", org_id: ORG, event_id: "dt_ev", donor_id: "dt_wendell", name: "Wendell Ashgrove", status: "attended" });
  await ins("interactions", { id: "dt_int", org_id: ORG, donor_id: "dt_wendell", type: "event", note: "Came to QA Nov4 gala.", date: "2026-10-10", metadata: { via: "event_attendance", event_id: "dt_ev", attendee_id: "dt_att" } });
  await ins("agent_drafts", { id: "dt_draft", org_id: ORG, donor_id: "dt_wendell", subject: "QA A5 draft", body: "x", status: "pending" });
  await ins("campaigns", { id: "dt_gala", org_id: ORG, name: "GALA 2026", status: "sent", recipient_count: 0, ...by });
  await ins("invites", { id: "dt_inv1", org_id: ORG, email: "new.hire@dtidy.example.org", token: "dtidy-tok-1", role: "member", expires_at: "2027-01-01T00:00:00Z", created_at: "2026-11-01T12:00:00Z" });
  await ins("invites", { id: "dt_inv2", org_id: ORG, email: "New.Hire@dtidy.example.org ", token: "dtidy-tok-2", role: "member", expires_at: "2027-01-01T00:00:00Z", created_at: "2026-11-03T12:00:00Z" });
}

const QA_LEFT = async () => {
  const out = {};
  const [p] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND name ~ '^\\s*QA\\M'`, [ORG]); if (p.n) out.donors = p.n;
  for (const [t, col] of require("../scripts/ops/demoTidy/steps").QA_TABLES) {
    const [r] = await q(`SELECT COUNT(*)::int n FROM ${t} WHERE org_id=$1 AND ${col} ~ '^\\s*QA\\M'`, [ORG]); if (r.n) out[t] = r.n;
  }
  return out;
};
const facts = async () => ({
  org: (await q(`SELECT ein, receipt_signature_name AS s, receipt_signature_title AS t FROM orgs WHERE id=$1`, [ORG]))[0],
  donors: (await q(`SELECT id, email, deleted_at IS NOT NULL AS gone, about_them, address, birth_month FROM donors WHERE org_id=$1 ORDER BY id`, [ORG])),
  funds: (await q(`SELECT id, retired_at IS NOT NULL AS retired FROM fin_funds WHERE org_id=$1 ORDER BY id`, [ORG])),
  gifts: (await q(`SELECT id, fund_id FROM gifts WHERE org_id=$1 ORDER BY id`, [ORG])),
  rows: (await q(`SELECT 'v' k, id FROM donor_list_views WHERE org_id=$1 UNION ALL SELECT 'g', id FROM audiences WHERE org_id=$1
                  UNION ALL SELECT 'm', group_id||donor_id FROM group_members WHERE org_id=$1 UNION ALL SELECT 'jt', id FROM cultivation_templates WHERE org_id=$1
                  UNION ALL SELECT 'jp', id FROM cultivation_plans WHERE org_id=$1 UNION ALL SELECT 't', id FROM tasks WHERE org_id=$1 AND milestone_id IS NULL
                  UNION ALL SELECT 's', id FROM volunteer_shifts WHERE org_id=$1 UNION ALL SELECT 'e', id FROM events WHERE org_id=$1
                  UNION ALL SELECT 'a', id FROM event_attendees WHERE org_id=$1 UNION ALL SELECT 'i', id FROM interactions WHERE org_id=$1 AND gift_id IS NULL
                  UNION ALL SELECT 'd', id FROM agent_drafts WHERE org_id=$1 UNION ALL SELECT 'gr', id FROM grants WHERE org_id=$1
                  UNION ALL SELECT 'pl', id FROM offline_recurring_plans WHERE org_id=$1 ORDER BY 1, 2`, [ORG])),
  invites: (await q(`SELECT id, revoked_at IS NOT NULL AS revoked FROM invites WHERE org_id=$1 ORDER BY id`, [ORG])),
  campaigns: (await q(`SELECT id, retired_at IS NOT NULL AS retired FROM campaigns WHERE org_id=$1 ORDER BY id`, [ORG])),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  await plant();
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    console.log("\n§0 only a demo org");
    const refused = await S.run({ client: pg, orgId: LIVE, apply: true, today: TODAY, log: () => {} }).then(() => null, e => e.message);
    ok("§0 an org that is not a demo is refused, and nothing is written", /not a demo org/.test(refused || "")
      && (await q(`SELECT ein FROM orgs WHERE id=$1`, [LIVE]))[0].ein === "47-1234567", refused);

    console.log("\n§1 the dry run");
    const before = await facts();
    const lines = [];
    const dry = await S.run({ client: pg, orgId: ORG, today: TODAY, log: l => lines.push(l) });
    const text = lines.join("\n");
    const want = [/2 QA people to the trash/, /1 QA saved views/, /1 QA groups/, /1 QA journeys on a person/, /1 QA journeys\b/, /1 QA tasks/, /1 QA logged shifts/,
      /1 QA events/, /1 QA drafts/, /1 timeline lines of those events/, /Ottilie Marlowe: About, address, birthday set/, /EIN 47-1234567 → 84-2917365/,
      /Signer Maya Reyes → Priya Lindqvist, Executive Director/, /"General" merged into "General Operating"/, /"Building" merged into "Building Fund"/,
      /Corinne Halvorsen: \$50 a month by check since 2026-05-07, 7 payments, next 2026-12-07/, /Desmond Okafor: .*9 payments/,
      /Alder Creek Foundation: .*in Reporting, interim report due 2026-11-28/, /An email on 2 people now sits on one \(dt_renee\)/, /2 pending invites to one address: 1 revoked/,
      /Archived "GALA 2026"/, /16 demo payments would be recorded/, /Everyone: /, /lifetime \$/];
    const missing = want.filter(r => !r.test(text)).map(String);
    ok("§1 the dry run lists every change, each with its count", !missing.length && dry.changes > 0, { missing, text: text.slice(0, 900) });
    ok("§1 the dry run writes nothing", same(before, await facts()) && !(await q(`SELECT 1 FROM fin_audit_log WHERE org_id=$1 AND user_id=$2`, [ORG, S.ACTOR.id])).length);
    ok("§1 Qadir is not QA", !/Qadir/.test(text) && !(await facts()).donors.find(d => d.id === "dt_qadir").gone);

    console.log("\n§2 --apply, in its own process");
    const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "ops", "demo-tidy.js"), `--org=${ORG}`, "--apply", `--today=${TODAY}`],
      { env: { ...process.env, DATABASE_URL: DB, DEMO_TIDY_PORT: "0" }, encoding: "utf8", timeout: 240000 });
    const runId = (out.match(/--undo=(al_[0-9a-f]+)/) || [])[1];
    const after = await facts();
    ok("§2 apply leaves no QA-prefixed record", same(await QA_LEFT(), {}) && !after.rows.some(r => ["i", "a", "m"].includes(r.k) && /dt_(int|att)|dt_grpdt_wendell/.test(r.id)), await QA_LEFT());
    const m = after.donors.find(d => d.id === "dt_marlowe");
    ok("§2 Marlowe's About, address and birthday are the demo baseline", !/QA/.test(m.about_them) && m.address === "214 Linden Avenue" && m.birth_month === 4, m);
    ok("§2 receipts: a real-looking EIN and the director as signer", after.org.ein === "84-2917365" && after.org.s === "Priya Lindqvist" && after.org.t === "Executive Director", after.org);
    ok("§2 General and Building are merged into their keepers, with their gifts", after.funds.filter(f => f.retired).map(f => f.id).join() === "dtf_bld,dtf_gen"
      && after.gifts.find(g => g.id === "dtg_1").fund_id === "dtf_gen_op" && after.gifts.find(g => g.id === "dtg_2").fund_id === "dtf_bld_fund", after);
    const plans = await q(`SELECT p.id, p.status, COUNT(g.id)::int n FROM offline_recurring_plans p LEFT JOIN gifts g ON g.offline_plan_id = p.id AND g.org_id = p.org_id
                            WHERE p.org_id=$1 GROUP BY 1,2 ORDER BY 1`, [ORG]);
    const giftActors = await q(`SELECT DISTINCT created_by FROM gifts WHERE org_id=$1 AND offline_plan_id IS NOT NULL`, [ORG]);
    ok("§2 two active offline recurring donors, 6+ monthly payments each, through recordGift", plans.length === 2 && plans.every(p => p.status === "active" && p.n >= 6)
      && giftActors.length === 1 && giftActors[0].created_by === S.ACTOR.id, { plans, giftActors });
    const [gr] = await q(`SELECT g.status, m.kind, LEFT(m.due_date::text,10) d FROM grants g JOIN grant_milestones m ON m.grant_id = g.id WHERE g.org_id=$1`, [ORG]);
    ok("§2 one grant in Reporting with a report due in 21 days", gr && gr.status === "reporting" && gr.kind === "report_due" && gr.d === "2026-11-28", gr);
    ok("§2 the shared email sits on one person; one invite stays; GALA 2026 is archived",
      after.donors.filter(d => /^shared@/i.test((d.email || "").trim())).length === 1 && after.invites.filter(i => !i.revoked).map(i => i.id).join() === "dt_inv2"
      && after.campaigns.find(c => c.id === "dt_gala").retired, { inv: after.invites, c: after.campaigns });
    const audits = await q(`SELECT action FROM fin_audit_log WHERE org_id=$1 AND user_id=$2`, [ORG, S.ACTOR.id]);
    ok("§2 one audit row per change and one for the run", !!runId && audits.filter(a => a.action === S.RUN_ACTION).length === 1 && audits.filter(a => /^demo tidy: /.test(a.action)).length >= 15, { runId, n: audits.length });
    ok("§2 the baselines print", /Baselines for Muse[\s\S]*Everyone: \d+[\s\S]*This fiscal year[\s\S]*Ottilie Marlowe .*lifetime[\s\S]*Renee[\s\S]*Wendell Ashgrove .*lifetime \$1,200\.00/.test(out), out.slice(-700));

    console.log("\n§3 a second apply");
    const again = await S.run({ client: pg, orgId: ORG, apply: true, today: TODAY, log: () => {}, writers: { recordGift: () => { throw new Error("a second run must not write a gift"); } } });
    ok("§3 a second apply changes nothing", again.changes === 0 && !again.runId && same(after, await facts()), again.changes);

    console.log("\n§4 --undo");
    const u = await S.undo({ client: pg, orgId: ORG, runId, log: () => {} });
    const back = await facts();
    ok("§4 undo restores every row: QA records, Marlowe, receipt details, funds and gifts, invites, the campaign; the demo data goes",
      u.count > 0 && same(before, back), Object.keys(before).filter(k => !same(before[k], back[k])).map(k => ({ k, before: before[k], back: back[k] })));
    ok("§4 the demo payments are gone with their ledger rows", !(await q(`SELECT 1 FROM gifts WHERE org_id=$1 AND offline_plan_id IS NOT NULL`, [ORG])).length
      && !(await q(`SELECT 1 FROM fin_transactions WHERE org_id=$1 AND gift_id LIKE 'dt1_%'`, [ORG])).length);
    const twice = await S.undo({ client: pg, orgId: ORG, runId, log: () => {} }).then(() => null, e => e.message);
    ok("§4 a run is undone once", /already undone/.test(twice || ""), twice);
  } finally {
    await pg.end();
    await wipe();
    await closeDb();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); try { await wipe(); await closeDb(); } catch {} process.exit(1); });

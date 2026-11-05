// tests/people1-deceased.test.js: PEOPLE-1. MARK SOMEONE DECEASED WITH CARE,
// AND LINK A PARTNER LIKE A SPOUSE. Guards donor data (who is asked, listed,
// suggested and pooled) and email (every send gate refuses the deceased).
//
//   §1 marking a made-up person deceased through the profile's action takes
//      them out of Home's moves, Re-engage, a journey's next step and a
//      campaign audience at once; every kind of donor mail refuses them; their
//      active journey ends with reason 'deceased'; his open next step closes and
//      his profile suggests no next move; an open ask closes
//      ("Closed: marked deceased") and another task stays; their lifetime is
//      unchanged and the truth check holds; their spouse's profile reads
//      "Harold Lee (died March 2026)"; the anniversary reminder is a task.
//   §2 "Undo: they're not deceased" puts them back in the lists and reopens
//      the ask; the journey that ended stays ended, and the answer says so.
//   §3 a Partner link pools like a spouse: one household with both in its
//      total, and a gift from one keeps the other off Lapsed and Re-engage.
//
// HOW IT GOES RED ON MAIN (ca2eb4e): POST /donors/:id/deceased is a 404, so
// Harold stays on Re-engage, in the campaign audience and in his journey,
// Mae's pledge stays a Home move, and no gate refuses them; "partner" is not
// a relationship type (400), so Sam stays Lapsed.
// Planted (PEOPLE-1 report): the gate's deceased line dropped turns §1's
// audience and gate checks red; partner taken out of the lapse unit turns §3 red.
//
// Standard scratch stack (tests/README.md). Sends nothing. Made-up people only.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, mailTypesOn } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { testNow } = require("./clock");

const PASSWORD = "loadtest1234";
const ORG = "org_people1_deceased";
const P = s => `${ORG}_${s}`;
const SYS = ["system:test/people1", "PEOPLE-1 test"];
const day = n => new Date(testNow() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const person = (id, name, email) => q(
  `INSERT INTO donors (id,org_id,name,kind,email,stage,auto_email,created_by,created_by_name,created_at,updated_at)
   VALUES ($1,$2,$3,'person',$4,'steward',true,$5,$6,NOW()-INTERVAL '3 years',NOW()-INTERVAL '3 years')`, [P(id), ORG, name, email, ...SYS]);
const gift = (tok, id, amount, date) => api("POST", `/donors/${P(id)}/gifts`, tok, { amount, date, type: "one-time", payment_method: "check" });
async function summaries(tok) {
  const out = [];
  for (let off = 0; ; off += 500) {
    const r = await api("GET", `/donors/summaries?limit=500&offset=${off}`, tok);
    out.push(...(r.body || []));
    if (!r.body || r.body.length < 500) break;
  }
  return new Map(out.map(d => [d.id, d]));
}
const onReengage = async (tok, id) => !!((await summaries(tok)).get(P(id)) || {}).reengage;
async function homeMoveIds(tok) {
  const r = await api("GET", "/insights?view=deck", tok);
  const deck = (r.body && (r.body.deck || r.body)) || {};
  return new Set((deck.tabs || []).flatMap(t => (t.moves || []).flatMap(m => [...(m.ids || []), m.lead])));
}
async function audienceIds(tok) {
  const r = await api("POST", "/campaigns/segment-preview", tok, { segment: {} });
  const b = r.body || {};
  // who it reaches: everyone in the segment less those it leaves out
  const out = new Set((b.leftOut || []).flatMap(g => (g.people || []).map(p => p.id)));
  return new Set((await q(`SELECT id FROM donors WHERE org_id = $1 AND deleted_at IS NULL`, [ORG])).map(r => r.id).filter(id => !out.has(id) && (b.audience || {}).total > 0));
}
const MAIL_KINDS = (() => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "email.js"), "utf8");
  const body = src.slice(src.indexOf("const DONOR_MAIL_POLICY = {"), src.indexOf("};", src.indexOf("const DONOR_MAIL_POLICY = {")));
  return [...body.matchAll(/^\s*["']?([a-z_][a-z0-9_]*)["']?\s*:/gim)].map(m => m[1]).filter(k => k !== "const");
})();

(async () => {
  const tok = await freshOrg(ORG, "People One Trust");
  // Donor mail and campaign mail on for Everyone, so an audience has people in it (the sink receives; nothing leaves).
  await q(`UPDATE orgs SET emails_enabled = true, onboarded_at = NOW() WHERE id = $1`, [ORG]);
  await mailTypesOn(ORG, "everyone");
  // Harold and Ruth Lee: spouses, both lapsed (his last gift 400 days ago, hers 500).
  await person("harold", "Harold Lee", "harold.lee@people1.test");
  await person("ruth", "Ruth Lee", "ruth.lee@people1.test");
  await person("mae", "Mae Ostrander", "mae.o@people1.test");
  await gift(tok, "harold", 300, day(800));
  await gift(tok, "harold", 250, day(400));
  await gift(tok, "ruth", 100, day(500));
  await gift(tok, "mae", 1000, day(200));
  const link = await api("POST", `/donors/${P("harold")}/relationships`, tok, { relatedDonorId: P("ruth"), relationshipType: "spouse" });
  ok("setup: Harold and Ruth are linked as spouses", link.status === 201, link.body);
  // Mae owes on a pledge (Home's "collect" move).
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,status,due_date,created_by,created_by_name,created_at) VALUES ($1,$2,$3,2000,'open',$4,$5,$6,NOW()-INTERVAL '200 days')`,
    [P("pl_mae"), ORG, P("mae"), day(30), ...SYS]);
  // Harold's journey, with its next step to come.
  await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_name,applied_on,status,created_by,created_by_name) VALUES ($1,$2,$3,'Welcome back',$4,'active',$5,$6)`,
    [P("plan"), ORG, P("harold"), day(10), ...SYS]);
  await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status) VALUES ($1,$2,$3,1,'call','Call Harold',$4,'pending')`,
    [P("step"), ORG, P("plan"), day(-5)]);
  // Two open tasks: an ask, and a task that is not one.
  for (const [id, title] of [["t_ask", "Ask Harold about the year-end gift"], ["t_other", "Return Harold's photo album"]])
    await q(`INSERT INTO tasks (id,org_id,title,due,done,donor_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,0,$5,$6,$7)`, [P(id), ORG, title, day(-3), P("harold"), ...SYS]);

  // ── §1 MARK AS DECEASED ──────────────────────────────────────────────────
  console.log("\n§1 marked deceased: out of every ask, list and send at once");
  ok("§1 before: Harold is on Re-engage", await onReengage(tok, "harold"), null);
  const audBefore = await audienceIds(tok);
  ok("§1 before: Harold is in a campaign audience of everyone", audBefore.has(P("harold")), [...audBefore]);
  ok("§1 before: Mae's pledge is one of Home's moves", (await homeMoveIds(tok)).has(P("mae")), null);
  const openStep = async id => (await q(`SELECT id FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, P(id)])).length;
  ok("§1 before: Harold has an open next step (thank him for his gift)", (await openStep("harold")) === 1, null);
  ok("§1 before: Home's thank-you queue offers a draft to Harold", ((await api("GET", "/thank-yous", tok)).body.drafts || []).some(x => x.donorId === P("harold")), null);
  const lifeBefore = (await q(`SELECT id, total_giving::text AS t FROM donors WHERE org_id=$1 ORDER BY id`, [ORG])).map(r => `${r.id}:${r.t}`).join(",");

  const mk = await api("POST", `/donors/${P("harold")}/deceased`, tok, { diedOn: "2026-03", note: "Ruth called on Tuesday.", remind: true });
  ok("§1 Mark as deceased answers", mk.status === 200 && mk.body && mk.body.deceased === true, mk);
  const mk2 = await api("POST", `/donors/${P("mae")}/deceased`, tok, {});
  ok("§1 a date of death is optional", mk2.status === 200, mk2);
  const fut = await api("POST", `/donors/${P("ruth")}/deceased`, tok, { diedOn: "2027-01-01" });
  ok("§1 a date after today is refused, and Ruth is not marked", fut.status === 400 && !(await q(`SELECT deceased FROM donors WHERE id=$1`, [P("ruth")]))[0].deceased, fut.body);

  ok("§1 Harold is off Re-engage", !(await onReengage(tok, "harold")), null);
  const audAfter = await audienceIds(tok);
  ok("§1 Harold is out of the campaign audience; Ruth is still in it", !audAfter.has(P("harold")) && audAfter.has(P("ruth")), [...audAfter]);
  ok("§1 Mae is gone from Home's moves", !(await homeMoveIds(tok)).has(P("mae")), null);
  const [plan] = await q(`SELECT status, end_reason FROM cultivation_plans WHERE id=$1`, [P("plan")]).catch(() => [{}]);   // (no end_reason column on main)
  const [step] = await q(`SELECT status FROM cultivation_plan_steps WHERE id=$1`, [P("step")]);
  ok("§1 his journey ended with reason 'deceased', its next step skipped", plan.status === "abandoned" && plan.end_reason === "deceased" && step.status === "skipped", [plan, step]);
  const tasks = Object.fromEntries((await q(`SELECT id, done, closed_reason FROM tasks WHERE org_id=$1 AND id = ANY($2)`, [ORG, [P("t_ask"), P("t_other")]]).catch(() => [{ id: P("t_ask") }, { id: P("t_other") }])).map(t => [t.id, t]));
  ok("§1 the ask closed: 'Closed: marked deceased'", tasks[P("t_ask")].done === 1 && tasks[P("t_ask")].closed_reason === "Closed: marked deceased", tasks);
  ok("§1 the task that is not an ask stays open", tasks[P("t_other")].done === 0, tasks);
  const memo = await q(`SELECT title, recur FROM tasks WHERE org_id=$1 AND donor_id=$2 AND title LIKE 'Anniversary%'`, [ORG, P("ruth")]);
  ok("§1 the reminder is a yearly task: 'Anniversary of Harold Lee's passing: a note to Ruth Lee'",
    memo.length === 1 && memo[0].title === "Anniversary of Harold Lee's passing: a note to Ruth Lee" && memo[0].recur && memo[0].recur.every === "year", memo);
  ok("§1 his open next step closed (none is suggested for him now)", (await openStep("harold")) === 0, null);
  const nm = await api("GET", `/insights/donor/${P("harold")}`, tok);
  ok("§1 his profile suggests no next move", nm.status === 200 && nm.body.move == null, nm.body && nm.body.move);
  const ty = await api("GET", "/thank-yous", tok);
  ok("§1 Home's thank-you queue offers no draft to him or Mae", ty.status === 200 && !(ty.body.drafts || []).some(x => [P("harold"), P("mae")].includes(x.donorId)), (ty.body.drafts || []).map(x => x.donorName));
  const starts = await q(`SELECT 1 FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 AND status='active'`, [ORG, P("harold")]);
  ok("§1 no journey is active for him", starts.length === 0, starts);

  // The one gate, in this process, bound to the scratch database (the server binds it at boot).
  const EM = require("../routes/email");
  EM.mount({ isBlockedAddress: require("../mailBlock").isBlockedAddress, orgMailGateCache: new Map(),
    query: (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); } });
  const wrong = [];
  for (const kind of MAIL_KINDS) {
    const d = await EM.donorMailDecision(kind, "harold.lee@people1.test", ORG, null).catch(e => ({ send: true, reason: e.message }));
    // the onboarding sequence is off for every org and person (MAIL-1); every other kind answers "deceased"
    if (d.send !== false || !(d.reason === "deceased" || d.reason === "onboarding_sequence_off")) wrong.push([kind, d]);
  }
  const ruthGate = await EM.donorMailDecision("receipt", "ruth.lee@people1.test", ORG, null);
  ok(`§1 every send gate refuses him, for all ${MAIL_KINDS.length} kinds of donor mail, because he is deceased`, MAIL_KINDS.length > 10 && wrong.length === 0, wrong.slice(0, 5));
  ok("§1 (the gate is live for this org: Ruth's receipt may send)", ruthGate.send === true, ruthGate);

  const lifeAfter = (await q(`SELECT id, total_giving::text AS t FROM donors WHERE org_id=$1 ORDER BY id`, [ORG])).map(r => `${r.id}:${r.t}`).join(",");
  ok("§1 everyone's lifetime is unchanged", lifeAfter === lifeBefore, [lifeBefore, lifeAfter]);
  const truth = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "after marking" });
  ok("§1 every surface agrees with the gifts (TRUTH-1 and LEDGER-1 keys)", truth.ok, truth.diffs.join(" | "));
  const rel = await api("GET", `/donors/${P("ruth")}/relationships`, tok);
  ok("§1 Ruth's profile: 'Harold Lee (died March 2026)', and the household stays",
    ((rel.body && rel.body.relationships) || []).some(r => r.relatedDonorName === "Harold Lee (died March 2026)") && rel.body.householdTotal != null, rel.body);
  const info = await api("GET", `/donors/${P("harold")}/deceased`, tok);
  ok("§1 the banner: 'In memory · died March 2026'", info.body && info.body.banner === "In memory · died March 2026", info.body);

  // ── §2 UNDO ──────────────────────────────────────────────────────────────
  console.log("\n§2 Undo: they're not deceased");
  const un = await api("POST", `/donors/${P("harold")}/not-deceased`, tok, {});
  ok("§2 undo answers, and says the journey stays ended", un.status === 200 && /stays ended/.test((un.body && un.body.sentence) || ""), un.body);
  ok("§2 Harold is back on Re-engage", await onReengage(tok, "harold"), null);
  ok("§2 and back in the campaign audience", (await audienceIds(tok)).has(P("harold")), null);
  const [ask2] = await q(`SELECT done, closed_reason FROM tasks WHERE id=$1`, [P("t_ask")]).catch(() => [{}]);
  ok("§2 the ask reopened", ask2.done === 0 && ask2.closed_reason === null, ask2);
  ok("§2 his next step is open again", (await openStep("harold")) === 1, null);
  const [plan2] = await q(`SELECT status FROM cultivation_plans WHERE id=$1`, [P("plan")]);
  ok("§2 the journey that ended stays ended", plan2.status === "abandoned", plan2);
  const memo2 = await q(`SELECT voided_at FROM tasks WHERE org_id=$1 AND title LIKE 'Anniversary%'`, [ORG]);
  ok("§2 the anniversary reminder is withdrawn", memo2.length === 1 && memo2[0].voided_at != null, memo2);

  // ── §3 PARTNER ───────────────────────────────────────────────────────────
  console.log("\n§3 a Partner link pools like a spouse");
  await person("sam", "Sam Ortiz", "sam.o@people1.test");
  await person("alex", "Alex Park", "alex.p@people1.test");
  await gift(tok, "sam", 400, day(420));
  await gift(tok, "alex", 150, day(25));
  ok("§3 before: Sam (last gift 420 days ago) is on Re-engage", await onReengage(tok, "sam"), null);
  const pl = await api("POST", `/donors/${P("sam")}/relationships`, tok, { relatedDonorId: P("alex"), relationshipType: "partner" });
  ok("§3 Partner is a relationship type", pl.status === 201, pl.body);
  ok("§3 Alex's gift keeps Sam off Re-engage", !(await onReengage(tok, "sam")), null);
  const st = await api("GET", `/donors/${P("sam")}/status`, tok).catch(() => null);
  const tags = ((st && st.body && st.body.tags) || []).map(t => t.key);
  ok("§3 and off Lapsed", st && st.status === 200 && !tags.includes("lapsed"), st && st.body);
  const hh = await q(`SELECT household_id FROM donors WHERE id = ANY($1)`, [[P("sam"), P("alex")]]);
  ok("§3 the two are one household", hh.length === 2 && hh[0].household_id && hh[0].household_id === hh[1].household_id, hh);
  const r3 = await api("GET", `/donors/${P("alex")}/relationships`, tok);
  ok("§3 the household's total includes both ($550)", Number(r3.body.householdTotal) === 550, r3.body);
  const truth3 = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "after the partner link" });
  ok("§3 every surface agrees with the gifts", truth3.ok, truth3.diffs.join(" | "));

  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

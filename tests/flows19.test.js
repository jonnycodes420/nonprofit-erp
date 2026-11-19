// tests/flows19.test.js · FLOWS-19 (lead-2026-11-18). The build's one new suite: it guards donor
// email (what a starter card thanks a donor for), money (a cancelled plan that leaves no record, the
// count of who to re-engage) and what a journey does to a donor while it is paused.
//
// §1 The starter card (W-1118-Fundraising-T1, third night). New campaign's Thank-you card, for a
//    giver whose newest gift is $25 refunded in full, reads his last real gift ($5,801), and the
//    card, the editor's preview and the test-as-person all take it from one fill
//    (server/outreach/previewPerson.js → emailCompose.personFields).
// §2 A cancelled offline plan (W-1118-Finance-24). Cancelled, it stays on Recurring giving under
//    Canceled (the card plan's status) with the day it was cancelled; MRR and the sustainer count
//    leave it out.
// §3 A paused journey never acts (Area 1 Explore 8). Paused mid-run: finishing step 1 opens no step
//    2 (no Thread, no task, no timeline line, no draft); nobody is started by hand, by plan, or by
//    the birthday sweep; turned back on, step 2 opens.
// §4 Steps skipped (W-1115-Fundraising-32). A one-step journey's skipped step is "step 1", the
//    editor's numbering; a skip names no step the journey doesn't have.
// §5 Re-engage's change (W-1118-Donors-T6). Against the day kept before, the line names who moved
//    and why (crossed 12 months; gave), and the count it explains is the badge's.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · the gallery's own fill back (newest gift row, its raw amount) → §1 card red.
//   · offlineRoster back on OFFLINE_ACTIVE only → §2 Canceled red.
//   · advance without the paused check → §3 "no step 2" red.
//   · skipRows back on `seq + 1` → §4 red.
//   · change() with no moves (a count with no reason) → §5 red.
"use strict";
const { ok, summary, api, q, closeDb, civilToday, mailTypesOn } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";
const addDays = require("../orgTime").addDays;

(async () => {
  console.log("flows19 (FLOWS-19)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Flows Nineteen Corrowmere Trust ${run}`, userName: "Philippa Strand", email: `owner-${run}@flows19.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@flows19.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, amount, date) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, type: "cash", paymentMethod: "Check" });
    const gid = g.body && (g.body.gift ? g.body.gift.id : g.body.id);
    if (!gid) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 160)}`);
    return gid;
  };

  // ── §1 the starter card ──────────────────────────────────────────────────
  console.log("\n§1 the Thank-you starter card");
  const silas = await person("Silas Penhallow");
  await give(silas, 5801, addDays(today, -108));
  const g25 = await give(silas, 25, addDays(today, -3));
  const rf = await api("POST", `/gifts/${g25}/refund`, tok, { amount: 25, date: addDays(today, -2), reason: "Given twice by mistake" });
  ok("§1 fixture: Silas's newest gift, $25, is refunded in full", rf.status < 300, rf.body);
  const gal = (await api("GET", "/campaigns/templates", tok)).body || {};
  const ty = (gal.templates || []).find(t => t.key === "thank_you");
  const T = await import("../shared/emailTemplates.js");
  // The card's own render, as Communications.jsx draws it (renderPreview → renderMergeFields).
  const sd = gal.sampleDonor || {};
  const card = ty ? T.renderMergeFields(ty.body, { first_name: sd.firstName || "Margaret", donor_name: sd.name || "", org_name: gal.orgName,
    gift_amount: sd.giftAmount || "", total_giving: sd.totalGiving || "" }).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "";
  ok("§1 the card names Silas and his last real gift: \"Thank you for your gift of $5,801\" (staging: \"$25\")",
    sd.id === silas && sd.giftAmount === "$5,801" && /Thank you for your gift of \$5,801/.test(card) && !/\$-?25\b/.test(card), { sampleDonor: sd, card: card.slice(0, 200) });
  await mailTypesOn(ORG, "everyone");   // so the editor's audience has a first recipient, as Harborlight's does
  const seg = (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone" } })).body || {};
  const asSilas = await require("../server/outreach/testAsPerson").personFields(require("../db").query, ORG, silas);
  const ec = await require("../emailCompose").personFields({ orgId: ORG, orgName: "", base: "", orgSlug: "" }, { id: silas, name: "Silas Penhallow" });
  ok("§1 one fill: the card, the editor's preview person and the test-as-person read the send's own $5,801",
    seg.first && seg.first.id === silas && seg.first.giftAmount === "$5,801" && asSilas && asSilas.fields.last_gift_amount === "$5,801" && ec.last_gift_amount === "$5,801",
    { segFirst: seg.first, test: asSilas && asSilas.fields, send: ec.last_gift_amount });

  // ── §2 a cancelled offline plan ──────────────────────────────────────────
  console.log("\n§2 a cancelled offline plan stays on Recurring giving");
  const bertie = await person("Bertilde Okonkwo-Vane");
  const pl = await api("POST", `/donors/${bertie}/offline-plans`, tok, { amount: 40, frequency: "monthly", startDate: addDays(today, -20), method: "Check" });
  const plan = pl.body && pl.body.id;
  const card2 = await person("Rosalind Thackery");
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,canceled_at,created_at) VALUES ($1,$2,$3,$4,25,'month','canceled',NOW() - INTERVAL '3 days',NOW() - INTERVAL '90 days')`,
    [`rs_f19_${run}`, ORG, card2, `sub_f19_${run}`]);
  const before = (await api("GET", "/recurring/movement", tok)).body || {};
  const cx = await api("POST", `/offline-plans/${plan}/cancel`, tok, { confirmed: true });
  const roster = ((await api("GET", "/recurring/roster", tok)).body || {}).subs || [];
  const off = roster.find(s => s.id === plan), cardRow = roster.find(s => s.id === `rs_f19_${run}`);
  ok("§2 cancelled, the offline plan is listed under Canceled, with the day it was cancelled (staging: gone)",
    pl.status === 201 && cx.status === 200 && off && off.displayStatus === "canceled" && off.status === "canceled" && !!off.canceledAt && off.source === "offline",
    { created: pl.status, cancel: cx.status, row: off });
  ok("§2 the cancelled card plan and the cancelled offline plan carry the same status, so the Canceled filter shows both",
    cardRow && cardRow.displayStatus === "canceled" && roster.filter(s => s.displayStatus === "canceled").length === 2, roster.map(s => [s.donorName, s.displayStatus]));
  const after = (await api("GET", "/recurring/movement", tok)).body || {};
  ok("§2 MRR and the sustainer count leave it out once cancelled ($40 → $0, one plan → none)",
    before.mrrOffline === 40 && before.offlineCount === 1 && after.mrrOffline === 0 && (after.offlineCount || 0) === 0, { before: [before.mrrOffline, before.offlineCount], after: [after.mrrOffline, after.offlineCount] });

  // ── §3 a paused journey never acts ───────────────────────────────────────
  console.log("\n§3 a paused journey never acts");
  const step = (label, offsetDays) => ({ type: "follow_up", label, offsetDays });
  const jr = await api("POST", "/journeys", tok, { name: "Corrowmere birthday card", trigger: "by_hand", enabled: true, steps: [step("Write the card", 0), step("Mail a birthday card", 3)] });
  const J = jr.body && jr.body.id;
  const marg = await person("Margarethe Quennell");
  const ap = await api("POST", `/journeys/${J}/apply`, tok, { donorIds: [marg] });
  const steps = async () => q(`SELECT s.seq, s.status, s.thread_id FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id WHERE p.org_id=$1 AND p.template_id=$2 AND p.donor_id=$3 ORDER BY s.seq`, [ORG, J, marg]);
  const s1 = await steps();
  ok("§3 fixture: Margarethe is in the journey, step 1 open", jr.status < 300 && ap.status === 200 && s1[0] && s1[0].status === "open" && !!s1[0].thread_id, { j: jr.status, ap: ap.body, s1 });
  const pz = await api("PATCH", `/journeys/${J}`, tok, { enabled: false });
  const counts = async () => (await q(`SELECT (SELECT COUNT(*) FROM threads WHERE org_id=$1 AND donor_id=$2)::int AS threads,
      (SELECT COUNT(*) FROM tasks WHERE org_id=$1 AND donor_id=$2)::int AS tasks,
      (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Journey%')::int AS lines,
      (SELECT COUNT(*) FROM milestone_drafts WHERE org_id=$1 AND donor_id=$2)::int AS drafts`, [ORG, marg]))[0];
  const c0 = await counts();
  const done = await api("POST", `/threads/${s1[0].thread_id}/done`, tok, {});
  const s2 = await steps(), c1 = await counts();
  ok("§3 paused mid-run: finishing step 1 opens no step 2: no Thread, no task, no timeline line, no draft",
    pz.status === 200 && done.status === 200 && s2[0].status === "done" && s2[1].status === "pending" && !s2[1].thread_id
      && c1.threads === c0.threads && c1.tasks === c0.tasks && c1.lines === c0.lines && c1.drafts === c0.drafts,
    { pause: pz.status, done: done.status, s2, c0, c1 });
  const ned = await person("Nedra Albescu");
  const apP = await api("POST", `/journeys/${J}/apply`, tok, { donorIds: [ned] });
  const byPlan = await api("POST", `/donors/${ned}/plan`, tok, { templateId: J });
  const nIn = Number((await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2`, [ORG, ned]))[0].n);
  ok("§3 paused: nobody is started by hand or by applying it as a plan", apP.status === 409 && byPlan.status === 409 && nIn === 0, { apply: apP.status, plan: [byPlan.status, byPlan.body], nIn });
  const bj = await api("POST", "/journeys", tok, { name: "Corrowmere birthdays", trigger: "birthday", enabled: true, steps: [step("Mail a birthday card", 0)] });
  await api("PATCH", `/journeys/${bj.body && bj.body.id}`, tok, { enabled: false });
  const bday = await person("Cosima Ferrandino");
  await q(`UPDATE donors SET birth_month=$1, birth_day=$2 WHERE id=$3`, [Number(today.slice(5, 7)), Number(today.slice(8, 10)), bday]);
  const sw = await api("POST", "/journeys/run-sweep", tok, {});
  const bIn = Number((await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2`, [ORG, bday]))[0].n);
  ok("§3 paused: the birthday sweep starts nobody on their birthday", sw.status === 200 && bIn === 0, { sweep: sw.body, bIn });
  const on = await api("PATCH", `/journeys/${J}`, tok, { enabled: true });
  const s3 = await steps();
  ok("§3 turned back on, Margarethe's step 2 opens", on.status === 200 && s3[1].status === "open" && !!s3[1].thread_id && on.body.resumedPeople === 1, { on: on.body && on.body.resumedPeople, s3 });

  // ── §4 steps skipped ─────────────────────────────────────────────────────
  console.log("\n§4 a skipped step names the editor's step number");
  const one = await api("POST", "/journeys", tok, { name: "Corrowmere one card", trigger: "by_hand", enabled: true, steps: [step("Mail a birthday card", 0)] });
  const O = one.body && one.body.id;
  const ivo = await person("Ivo Delacorte");
  await api("POST", `/journeys/${O}/apply`, tok, { donorIds: [ivo] });
  const [pi] = await q(`SELECT id FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND donor_id=$3`, [ORG, O, ivo]);
  const stop = await api("POST", `/plans/${pi && pi.id}/stop`, tok, {});
  const sk = (await api("GET", `/journeys/${O}/rows?rows=skipped`, tok)).body || {};
  const rows4 = sk.donors || [];
  ok("§4 the one-step journey's skipped row is \"step 1, Mail a birthday card\", with its reason (staging: \"step 2\")",
    stop.status < 300 && rows4.length === 1 && / · step 1, Mail a birthday card$/.test(rows4[0].entry) && rows4[0].recorded === true && /^Stopped by Philippa/.test(rows4[0].reason),
    { stop: stop.status, rows4 });
  const SR = require("../server/outreach/skipRows");
  const removed = SR.entryLine({ entered: today, seq: 2, step_label: "Send the photo" }, today.slice(0, 4), [{ label: "Mail a birthday card" }]);
  ok("§4 a step since deleted from the journey gets no number, and says so", !/step \d/.test(removed) && /no longer in this journey/.test(removed), removed);

  // ── §5 Re-engage's change ────────────────────────────────────────────────
  console.log("\n§5 Re-engage says why its count moved");
  const old = await person("Aurelio Vantongeren"), cross = await person("Tamsin Ollerenshaw"), back = await person("Gideon Marchbank");
  await give(old, 300, addDays(today, -500));
  await give(cross, 120, addDays(today, -365));       // turns 12 months old today
  await give(back, 90, addDays(today, -400));
  const RC = require("../server/donors/reengageChange");
  const at = d => new Date(`${d}T17:00:00Z`);   // midday in the org's zone (America/New_York)
  const kept = await RC.snapshot(ORG, { at: at(addDays(today, -1)) });
  const again = await RC.snapshot(ORG, { at: at(addDays(today, -1)) });
  const [snap] = await q(`SELECT n, people, created_by FROM reengage_snapshots WHERE org_id=$1 AND day=$2`, [ORG, addDays(today, -1)]);
  const keptIds = (snap && snap.people || []).map(p => p.id).sort();
  ok("§5 yesterday's list is kept once, by a system actor: Aurelio and Gideon (Tamsin was not yet 12 months)",
    kept.wrote === true && again.wrote === false && JSON.stringify(keptIds) === JSON.stringify([old, back].sort()) && /^system:/.test(snap.created_by), { kept, again, snap });
  await give(back, 75, today);
  const ch = (await api("GET", "/donors/reengage-change", tok)).body || {};
  const badge = ((await api("GET", "/donors/counts", tok)).body || {}).reengage;
  const yd = RC.joinedWhy({ name: "x", last: addDays(today, -365) }, addDays(today, -1), today);
  ok("§5 the line names who moved and why: Tamsin crossed 12 months today, Gideon gave today",
    ch.since === addDays(today, -1) && ch.moves && ch.moves.some(m => m.id === cross && m.kind === "calendar" && m.dir === "joined")
      && ch.moves.some(m => m.id === back && m.kind === "gave" && m.dir === "left") && /^The same 2 as \w{3} \d+: /.test(ch.sentence || "")
      && /Tamsin Ollerenshaw crossed 12 months without a gift on/.test(ch.sentence) && /Gideon Marchbank gave on/.test(ch.sentence) && yd.on === today,
    ch);
  ok("§5 the count the line explains is the badge's own", ch.now === badge && ch.now === 2, { line: ch.now, badge });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

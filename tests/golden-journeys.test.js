// tests/golden-journeys.test.js · HARDEN-1 item 2. THE TEN GOLDEN JOURNEYS.
//
//     THE TEN THINGS A DEVELOPMENT OFFICE DOES MOST, DRIVEN THROUGH THE ROUTES
//     HER CLICKS CALL, AND EACH RESULT READ BACK FROM WHERE IT LIVES.
//
//   J1 import a CSV        the file's rows through the app's own parse layer
//                          (shared/importShape.js) and /donors/import-combined,
//                          the run recorded by POST /imports; one person is new,
//                          one matches the person already on file (no second
//                          record), and every amount lands to the cent
//   J2 record a gift       POST /donors/:id/gifts (recordGift): the gift and the
//                          person's lifetime, to the cent
//   J3 thank it            POST /acknowledgments/mark: the gift reads thanked on
//                          the profile and leaves the not-thanked backlog
//   J4 the Agent           a plan of thank-you drafts on a second server whose
//                          model is a local stand-in: the draft lands on the
//                          person (Thread next step) and in /agent/waiting
//   J5 Ask why             "Why did Odile Marsh stop giving?" from her profile:
//                          answered, and every reason opens rows that foot to it
//   J6 a grant             funder, request, moved to Awarded, awarded in two
//                          instalments, the first cheque linked to the first
//                          instalment to the cent, the move on the funder's history
//   J7 an email template   from a starter, edited, read back, previewed with the
//                          edit in the HTML; an em dash is refused
//   J8 the Calendar        a task due date and the grant's report deadline are
//                          on /calendar/items, once each
//   J9 a report number     the giving summary for the year, and its rows
//                          (/figures/gifts/rows) foot to it to the cent
//   J10 merge two people   a duplicate with its own gift merged in: nothing lost,
//                          nothing doubled, no row points at the duplicate
//
// WHY NOT THE DEMO ORG ITSELF (the brief said "on Harborlight"). CLAUDE.md: the
// demo is its own org, only its seed script writes it, and no suite logs in
// to it or names it. Running that seed into a second org id was read and
// rejected: it is 3,800 lines with several hundred hard-coded primary keys
// (user, donor, grant, mailbox ids, the org slug), so a second copy in the same
// database would collide on every one of them, and parameterising every id
// would put the default run (the one that writes the pitch org, and the one
// path that may reach production) at risk for a test. So this suite builds a
// small Harborlight-shaped org of its own, `org_golden` with
// director@golden.harborlight.test, and most of its people arrive the way a
// real org's do: through the import (J1). The org row, its admin, its fund and
// its revenue account are fixture rows (as every suite's are); every act after
// that goes through the routes, so the audit middleware writes its own rows.
// The org is deleted by org_id across every org_id table at the start and end.
//
// HOW IT WOULD GO RED: an import that mints a second person for an email on
// file in another case (J1); money rounded to dollars anywhere on the way in
// (J1, J2: $1,250.50 and $40.10 are checked in cents); a thank that does not
// reach the gift (J3); a draft that lives only in the queue (J4); a reason
// whose rows do not foot (J5); an instalment that does not link (J6); a preview
// that renders the saved template instead of the edit (J7); a dated kind left
// off the calendar (J8); a figure whose rows disagree with the report (J9); a
// merge that drops or doubles a gift or leaves a pointer behind (J10).
// Proven able to fail (HARDEN-1g), twice:
//   1. /acknowledgments/mark planted to set acknowledgement_sent=false: J3
//      "the gift reads thanked on her profile" went red (71 passed, 1 failed),
//      nothing else did; restored, green.
//   2. The first run found a real defect: GET /grants read the hand-typed
//      `grants.received` column, so a grant whose first instalment had been
//      paid read "$0 of $6,000" on its profile while its award plan said
//      $3,000. J6 "the Grants list reads it Awarded with the first instalment
//      received" was red (received "0.00") before withGrantReceived in
//      routes/crm.js, green after.
//
// Runtime budget: under four minutes in CI. Measured locally: the suite runs
// in about 2 seconds, 4.5 with its shard's database and server boot. The
// last check fails the run if it ever takes four minutes.
//
//   SHARD_N=1 SHARD_SUITES="golden-journeys" bash tests/shard.sh
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_golden", USER = "u_golden_dana", DANA = "director@golden.harborlight.test", PW = "loadtest1234";
const today = civilToday();
const year = today.slice(0, 4);
const monthStart = today.slice(0, 8) + "01";
const cents = v => Math.round(Number(v || 0) * 100);
const T0 = Date.now();

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

// ── J4's stand-in model and second server ───────────────────────────────────
// It answers the three tools the drafting path asks for: filter_spec (who gave
// this month), drafts (one per person it is shown) and plan (counted; the
// drafting path should never need it).
async function agentLeg(H) {
  const calls = { filter_spec: 0, drafts: 0, plan: 0, other: 0 };
  const model = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      let j = {}; try { j = JSON.parse(b); } catch { j = {}; }
      const tool = ((j.tools || [])[0] || {}).name || "";
      const text = JSON.stringify((j.messages || [])[0] || {});
      let input = {};
      if (tool === "filter_spec") { calls.filter_spec++; input = { filters: [{ field: "gaveFrom", value: monthStart }, { field: "gaveTo", value: today }], suggestAsk: false, unsupported: "" }; }
      else if (tool === "drafts") {
        calls.drafts++;
        const people = [...text.matchAll(/(?:^|\\n)\s{2}(d[a-z]*_[A-Za-z0-9_-]+) \| ([^|]+) \|/g)].map(m => ({ id: m[1], name: m[2].trim() }));
        input = { drafts: people.map(p => ({ donorId: p.id, subject: "Thank you", body: `Dear ${p.name}, thank you for your gift this month. With gratitude, Harborlight Youth Collective.` })) };
      } else if (tool === "plan") { calls.plan++; input = { steps: [], sends: 0, headline: "", cannot: "" }; }
      else calls.other++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_g", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: tool || "x", input }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => model.listen(0, r));
  const port = await new Promise(r => { const t = http.createServer(); t.listen(0, () => { const p = t.address().port; t.close(() => r(p)); }); });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: `http://localhost:${model.address().port}`,
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret",
           RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const B2 = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await new Promise(r => setTimeout(r, 500)); up = await fetch(B2 + "/health").then(r => r.ok).catch(() => false); }
  ok("J4 the Agent's server started", up, errs.slice(-300));
  try {
    const lg = await (await fetch(B2 + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: DANA, password: PW }) })).json();
    const AH = { "Content-Type": "application/json", Authorization: "Bearer " + lg.token };
    const call = async (m, u, body) => { const r = await fetch(B2 + u, { method: m, headers: AH, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

    const p = await call("POST", "/agent/instructions", { text: "Draft a thank-you to every donor who gave this month" });
    const steps = (p.body.plan && p.body.plan.steps) || [];
    const mine = steps.find(s => s.donorId === H.tobias);
    ok("J4 a plan of thank-you drafts, one for Tobias (his imported gift is not thanked)", p.status === 201 && mine && mine.tool === "draft_note" && mine.purpose === "thank_you",
      { status: p.status, calls, body: JSON.stringify(p.body).slice(0, 400) });
    ok("J4 drafted through the drafts tool, never one big plan call", calls.drafts >= 1 && calls.plan === 0, calls);
    ok("J4 Tobias's draft carries his imported gift", mine && JSON.stringify(mine.giftIds) === JSON.stringify([H.tobiasGift]), mine && mine.giftIds);

    const run = await call("POST", `/agent/instructions/${p.body.id}/confirm`, {});
    ok("J4 the run leaves the drafts waiting for her", run.status === 200 && (run.body.steps || []).some(x => x.outcome === "waiting"), run.body);
    const W = (await call("GET", "/agent/waiting")).body;
    const waiting = (W.items || []).filter(i => i.kind === "agent_draft" && i.instructionId === p.body.id);
    ok("J4 Tobias's draft is in Drafts to review", waiting.some(i => i.donorId === H.tobias), waiting.map(i => i.donorId));
    const th = (await call("GET", `/threads?donorId=${H.tobias}&scope=all`)).body;
    const open = (th.list || []).find(t => t.donorId === H.tobias && t.kind === "thread");
    ok("J4 the draft is the next step on his record and the Thread", !!open && open.nextStep && /draft ready/i.test(open.nextStep.label), th);
    const rec = (await call("GET", `/donors/${H.tobias}`)).body;
    ok("J4 the draft is on his timeline", (rec.interactions || []).some(i => /drafted by steward/i.test(i.note || "")), (rec.interactions || []).map(i => i.note));
    const [row] = await q(`SELECT COUNT(*)::int n FROM agent_drafts WHERE org_id=$1 AND donor_id=$2 AND status='pending'`, [ORG, H.tobias]);
    ok("J4 one pending draft row, on him", row.n === 1, row);
    const dr = waiting.find(i => i.donorId === H.tobias);
    const apv = dr ? await call("POST", `/agent/waiting/agent_draft/${dr.id}/approve`, {}) : { status: 0 };
    const [tgr] = await q(`SELECT acknowledgement_sent FROM gifts WHERE id=$1`, [H.tobiasGift]);
    ok("J4 approving it marks his gift thanked", apv.status === 200 && tgr.acknowledgement_sent === true, { apv: apv.body, tgr });
    const W2 = (await call("GET", "/agent/waiting")).body;
    ok("J4 …and it leaves Drafts to review", !(W2.items || []).some(i => i.kind === "agent_draft" && i.donorId === H.tobias && i.instructionId === p.body.id), (W2.items || []).length);
  } finally {
    child.kill("SIGTERM"); model.close();
  }
}

(async () => {
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,ai_enabled,mission)
           VALUES ($1,'Harborlight Youth Collective (golden journeys)','harborlight-golden',1,'active','team','America/New_York',NOW(),true,
                   'After-school arts and mentoring for young people on the north shore.')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, DANA, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_golden',$1,'4010','Contributions','revenue',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_golden',$1,'General Operating',false)`, [ORG]);
  const dana = await login(DANA);
  await api("POST", "/onboarding/complete", dana, {});
  const H = {};

  // ── J1 import a CSV ──────────────────────────────────────────────────────
  console.log("\nJ1 import a CSV");
  const add = await api("POST", "/donors", dana, { name: "Marisol Okafor-Venn", email: "marisol@golden.test" });
  H.marisol = add.body && (add.body.id || (add.body.donor && add.body.donor.id));
  ok("J1 Marisol is on file before the import, added by hand", add.status < 300 && H.marisol, add.body);
  const d200 = civilPlusDays(-200), d2y = civilPlusDays(-700), d3y = civilPlusDays(-1070);
  const CSV = [
    "Donor Name,Email,Amount,Gift Date",
    `Marisol Okafor-Venn,MARISOL@Golden.test,"$1,250.50",${d200}`,
    `Tobias Wrenfield,tobias@golden.test,$75.25,${today}`,
    `Odile Marsh,odile@golden.test,"$2,000.00",${d2y}`,
    `Odile Marsh,odile@golden.test,"$2,000.00",${d3y}`,
  ].join("\n");
  const IS = await import("../shared/importShape.js");
  const recs = IS.parseCsvRecords(CSV).map(r => r.cells);
  const [hdr, ...body] = recs;
  const col = n => hdr.indexOf(n);
  const items = body.map(r => ({
    key: IS.normalizeEmail(r[col("Email")]).value || r[col("Donor Name")],
    donor: { name: r[col("Donor Name")], email: IS.normalizeEmail(r[col("Email")]).value, stage: "prospect" },
    gift: { amount: IS.normalizeMoney(r[col("Amount")]).value, date: IS.normalizeDate(r[col("Gift Date")]).value, type: "cash", campaign: "", notes: "" },
  }));
  ok("J1 the parse layer reads the money as dollars and cents", items.map(i => cents(i.gift.amount)).join(",") === "125050,7525,200000,200000", items.map(i => i.gift.amount));
  const { donors, gifts } = IS.groupTransactions(items);
  const runId = "imp_golden_" + Date.now().toString(36);
  const imp = await api("POST", "/donors/import-combined", dana, { donors, gifts, importId: runId });
  ok("J1 the import went through and balanced", imp.status === 200 && imp.body.reconciliation && imp.body.reconciliation.balanced === true, imp.body);
  const rr = await api("POST", "/imports", dana, { id: runId, name: "golden.csv", sourceFilename: "golden.csv", shape: "gift_file_with_donors",
    donorsCreated: imp.body.created || 0, giftsCreated: imp.body.giftsInserted || 0, dollars: 5325.75 });
  ok("J1 the run is recorded", rr.status < 300, rr.body);
  const people = await q(`SELECT id, LOWER(email) e FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name`, [ORG]);
  const byEmail = Object.fromEntries(people.map(p => [p.e, p.id]));
  H.tobias = byEmail["tobias@golden.test"]; H.odile = byEmail["odile@golden.test"];
  const types = await q(`SELECT person_types::text t FROM donors WHERE org_id=$1 AND id = ANY($2::text[])`, [ORG, [byEmail["tobias@golden.test"], byEmail["odile@golden.test"]]]);
  ok("J1 the new people are donors", types.length === 2 && types.every(r => /donor/.test(r.t)), types);
  ok("J1 three people: Marisol matched (not doubled), Tobias and Odile new", people.length === 3 && byEmail["marisol@golden.test"] === H.marisol && H.tobias && H.odile, people);
  const gsum = async id => (await q(`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint c, COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0];
  const gm = await gsum(H.marisol), gt = await gsum(H.tobias), go = await gsum(H.odile);
  ok("J1 every amount landed to the cent on the right person", Number(gm.c) === 125050 && gm.n === 1 && Number(gt.c) === 7525 && Number(go.c) === 400000 && go.n === 2, { gm, gt, go });
  const [run1] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, runId]).catch(() => [{ n: -1 }]);
  ok("J1 every imported gift carries the run id", run1.n === 4, run1);
  const [tg] = await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, H.tobias]);
  H.tobiasGift = tg && tg.id;
  const [life] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [H.marisol]);
  ok("J1 Marisol's lifetime reads the imported gift", cents(life.total_giving) === 125050, life);
  const runs = JSON.stringify((await api("GET", "/imports", dana)).body);
  ok("J1 the run is in Settings, Imports", runs.includes(runId), runs.slice(0, 300));
  const sr = await api("GET", `/search?q=${encodeURIComponent("Wrenfield")}`, dana);
  ok("J1 the new person is found by search", sr.status === 200 && JSON.stringify(sr.body).includes(H.tobias), sr.body);
  const trec = (await api("GET", `/donors/${H.tobias}`, dana)).body;
  ok("J1 his imported gift is on his record, to the cent", (trec.gifts || []).length === 1 && cents(trec.gifts[0].amount) === 7525, trec.gifts);

  // ── J2 record a gift ─────────────────────────────────────────────────────
  console.log("\nJ2 record a gift");
  // A cheque that came in ten days ago, entered now: old enough to be in the
  // not-thanked backlog (seven days by default), so J3 can watch it leave.
  const g2 = await api("POST", `/donors/${H.marisol}/gifts`, dana, { amount: "40.10", date: civilPlusDays(-10), type: "cash", paymentMethod: "Check" });
  H.gift = g2.body && (g2.body.id || (g2.body.gift && g2.body.gift.id));
  ok("J2 recordGift took it", g2.status === 201 && H.gift, g2.body);
  const [g2row] = await q(`SELECT ROUND(amount*100)::int c, acknowledgement_sent, created_by FROM gifts WHERE id=$1 AND org_id=$2`, [H.gift, ORG]);
  ok("J2 $40.10 to the cent, stamped with who recorded it, not thanked yet", g2row && g2row.c === 4010 && !g2row.acknowledgement_sent && g2row.created_by === USER, g2row);
  const prof = (await api("GET", `/donors/${H.marisol}`, dana)).body;
  const [led] = await q(`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint c, COUNT(*)::int n FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, H.gift]).catch(e => [{ c: -1, n: -1, e: e.message }]);
  ok("J2 the books have it once, to the cent", Number(led.c) === 4010 && led.n === 1, led);
  ok("J2 her lifetime is $1,290.60 in two gifts", cents(prof.total_giving ?? prof.totalGiving) === 129060 && (prof.gifts || []).length === 2, { t: prof.total_giving ?? prof.totalGiving, n: (prof.gifts || []).length });

  // ── J3 thank it ──────────────────────────────────────────────────────────
  console.log("\nJ3 thank it");
  const backlogHas = async id => JSON.stringify((await api("GET", "/acknowledgments/backlog", dana)).body).includes(id);
  ok("J3 before: the gift is in the not-thanked backlog", await backlogHas(H.gift));
  const mk = await api("POST", "/acknowledgments/mark", dana, { giftIds: [H.gift], via: "letter" });
  ok("J3 marked thanked by letter", mk.status === 200 && mk.body.marked === 1, mk.body);
  const prof3 = (await api("GET", `/donors/${H.marisol}`, dana)).body;
  const pg = (prof3.gifts || []).find(g => g.id === H.gift) || {};
  ok("J3 the gift reads thanked on her profile", pg.acknowledgement_sent === true || pg.acknowledgementSent === true || pg.thanked === true, pg);
  ok("J3 it leaves the not-thanked backlog", !(await backlogHas(H.gift)));
  const ty = (await api("GET", "/thank-yous", dana)).body;
  ok("J3 no drafted thank-you for it is still waiting", !(ty.drafts || []).some(d => d.giftId === H.gift), ty.drafts);
  const [ackBy] = await q(`SELECT acknowledged_by_name, acknowledged_via FROM gifts WHERE id=$1`, [H.gift]);
  ok("J3 it says who thanked and how", ackBy.acknowledged_by_name === "Dana Reyes" && ackBy.acknowledged_via === "letter", ackBy);

  // ── J4 the Agent ─────────────────────────────────────────────────────────
  console.log("\nJ4 the Agent's thank-you drafts");
  await agentLeg(H);

  // ── J5 Ask why ───────────────────────────────────────────────────────────
  console.log("\nJ5 Ask why on a donor");
  const a = (await api("POST", "/ask", dana, { text: "Why did Odile Marsh stop giving?", person: { donor: H.odile, intent: "stopped" } })).body;
  console.log("   " + a.sentence + " | " + (a.reasons || []).map(r => `${r.label}: ${r.cents ?? r.count}`).join("; "));
  ok("J5 Ask answers about Odile", a.answered === true && (!a.donor || a.donor.id === H.odile) && (a.reasons || []).length > 0, { sentence: a.sentence, refused: a.refused, kind: a.kind, n: (a.reasons || []).length });
  let footed = 0;
  for (const r of a.reasons || []) {
    if (!r.source || !r.source.key) { ok(`J5 "${r.label}" has a source`, false, r); continue; }
    const b = (await api("GET", `/figures/${r.source.key}/rows?${new URLSearchParams({ ...(r.source.params || {}), page: "1", pageSize: "200" })}`, dana)).body;
    const rows = b.rows || [];
    const val = r.measure === "count" || r.cents == null ? rows.length : rows.reduce((s, x) => s + cents(x.amount), 0);
    const want = r.measure === "count" || r.cents == null ? r.count : r.cents;
    if (val === want && rows.every(x => !x.donorId || x.donorId === H.odile)) footed++;
    else ok(`J5 "${r.label}" opens Odile's rows and foots`, false, { want, val, source: r.source, rows: rows.map(x => [x.donorId, x.amount]) });
  }
  const typed = (await api("POST", "/ask", dana, { text: "Why did Odile Marsh stop giving?" })).body;
  ok("J5 typed in the box, the same question gets the same answer", typed.answered === true && JSON.stringify((typed.reasons || []).map(r => [r.label, r.cents, r.count])) === JSON.stringify((a.reasons || []).map(r => [r.label, r.cents, r.count])),
    { sentence: typed.sentence, refused: typed.refused, kind: typed.kind });
  ok("J5 every reason opens her rows and foots to it", footed > 0 && footed === (a.reasons || []).length, `${footed} of ${(a.reasons || []).length}`);

  // ── J6 a grant ───────────────────────────────────────────────────────────
  console.log("\nJ6 move a grant and link an instalment");
  const fdn = await api("POST", "/grant-funders", dana, { name: "Lantern Trust", funderType: "private_foundation", email: "grants@lanterntrust.test" });
  H.funder = fdn.body && fdn.body.id;
  ok("J6 the funder is on file", fdn.status === 201 && H.funder, fdn.body);
  const gr = await api("POST", `/funders/${H.funder}/grants`, dana, { program: "Saturday studio", amountRequested: "6000.00", status: "submitted" });
  H.grant = gr.body && (gr.body.id || (gr.body.grant && gr.body.grant.id));
  ok("J6 a $6,000 request, submitted", gr.status === 201 && H.grant, gr.body);
  const mv = await api("PATCH", `/grants/${H.grant}/stage`, dana, { status: "awarded" });
  ok("J6 moved to Awarded", mv.status === 200 && mv.body.status === "awarded", mv.body);
  const [gst] = await q(`SELECT status, awarded_at FROM grants WHERE id=$1 AND org_id=$2`, [H.grant, ORG]);
  ok("J6 the grant reads Awarded, with the day it was won", gst.status === "awarded" && gst.awarded_at, gst);
  const aw = await api("PUT", `/grants/${H.grant}/award`, dana, { amountAwarded: "6000.00", installmentCount: 2, frequency: "semiannual", firstDue: today });
  ok("J6 awarded in two instalments", aw.status === 200, aw.body);
  let ap = (await api("GET", `/grants/${H.grant}/award-plan`, dana)).body;
  const inst = ap.installments || [];
  ok("J6 two instalments that foot to the award", inst.length === 2 && inst.reduce((s, i) => s + i.amountCents, 0) === 600000 && ap.awardedCents === 600000, ap);
  const g6 = await api("POST", `/donors/${H.funder}/gifts`, dana, { amount: inst[0] ? (inst[0].amountCents / 100).toFixed(2) : "0", date: today, type: "cash", paymentMethod: "Check" });
  ap = (await api("GET", `/grants/${H.grant}/award-plan`, dana)).body;
  ok("J6 the first cheque links to the first instalment, to the cent", g6.status === 201 && ap.receivedCents === (inst[0] || {}).amountCents && ap.installments[0].gift && !ap.installments[1].gift, ap);
  const glist = (await api("GET", "/grants", dana)).body;
  const gl = (Array.isArray(glist) ? glist : glist.grants || []).find(x => x.id === H.grant) || {};
  ok("J6 the Grants list reads it Awarded with the first instalment received", gl.status === "awarded" && cents(gl.received ?? gl.amount_received ?? gl.receivedAmount) === (inst[0] || {}).amountCents,
    { status: gl.status, received: gl.received, amount_received: gl.amount_received, awarded: gl.amount_awarded });
  const ms = await api("POST", `/grants/${H.grant}/milestones`, dana, { kind: "report_due", dueDate: civilPlusDays(20) });
  ok("J6 a report deadline", ms.status < 300, ms.body);
  const frec = (await api("GET", `/donors/${H.funder}`, dana)).body;
  ok("J6 the award is on the funder's history", (frec.interactions || []).some(i => /award/i.test(i.note || "")), (frec.interactions || []).map(i => i.note));

  // ── J7 an email template ─────────────────────────────────────────────────
  console.log("\nJ7 edit and preview an email template");
  const lib = (await api("GET", "/email-templates", dana)).body;
  const starter = (lib.starters || [])[0];
  ok("J7 the library offers starters", !!starter, lib);
  const mkT = await api("POST", "/email-templates", dana, { starterKey: starter && starter.starterKey });
  const tpl = mkT.body && mkT.body.template;
  ok("J7 a template from a starter", mkT.status === 201 && tpl && tpl.id, mkT.body);
  const MARK = "Saturday studio needs paint and brushes";
  // A rich-text block holds paragraphs; her edit replaces the first one.
  const withText = (bl, words) => bl.map((b, i) => i === ti ? { ...b, blocks: [{ type: "p", text: words }, ...(b.blocks || []).slice(1)] } : b);
  const ti = (tpl.blocks || []).findIndex(b => b && b.type === "richtext");
  const blocks = withText(tpl.blocks || [], MARK);
  ok("J7 the template has a text block to edit", ti >= 0, (tpl.blocks || []).map(b => b && b.type));
  const put = await api("PUT", `/email-templates/${tpl.id}`, dana, { subject: "A note from Harborlight", blocks });
  ok("J7 the edit saved", put.status === 200, put.body);
  const back = ((await api("GET", "/email-templates", dana)).body.templates || []).find(t => t.id === tpl.id) || {};
  ok("J7 it reads back edited", back.subject === "A note from Harborlight" && JSON.stringify(back.blocks || []).includes(MARK), { subject: back.subject });
  const pv = await api("POST", `/email-templates/${tpl.id}/preview`, dana, {});
  ok("J7 the preview fills every merge field (no {{token}} left for a donor to see)", !/\{\{\s*[a-z_]+\s*\}\}/i.test(String(pv.body.html || "")), (String(pv.body.html || "").match(/\{\{[^}]*\}\}/g) || []).slice(0, 5));
  ok("J7 the preview renders the saved edit", pv.status === 200 && String(pv.body.html || "").includes(MARK) && Array.isArray(pv.body.problems), { status: pv.status, problems: pv.body.problems });
  const pv2 = await api("POST", `/email-templates/${tpl.id}/preview`, dana, { subject: "Unsaved subject", blocks: withText(tpl.blocks || [], "Unsaved words") });
  ok("J7 a preview of unsaved edits shows them, and saves nothing", pv2.status === 200 && String(pv2.body.html || "").includes("Unsaved words")
    && !JSON.stringify(((await api("GET", "/email-templates", dana)).body.templates || []).find(t => t.id === tpl.id) || {}).includes("Unsaved words"), pv2.body.problems);
  const em = await api("PUT", `/email-templates/${tpl.id}`, dana, { subject: "A note \u2014 from Harborlight" });
  ok("J7 an em dash is refused", em.status === 400 && em.body.error === "em_dash", em.body);

  // ── J8 the Calendar ──────────────────────────────────────────────────────
  console.log("\nJ8 a dated item on the Calendar");
  const due = civilPlusDays(4);
  const tk = await api("POST", "/tasks", dana, { title: "Call Marisol about Saturday studio", due, donorId: H.marisol, assignedTo: USER, assignedToName: "Dana Reyes" });
  ok("J8 a task, due in four days", tk.status < 300, tk.body);
  const cal = (await api("GET", `/calendar/items?from=${today}&to=${civilPlusDays(30)}`, dana)).body.items || [];
  const taskItems = cal.filter(i => i.donorId === H.marisol && String(i.start || "").slice(0, 10) === due);
  ok("J8 the task is on the calendar on its day, once", taskItems.length === 1, cal.map(i => [i.type, i.title, i.start]));
  const dl = cal.filter(i => i.type === "deadline" && String(i.start || "").slice(0, 10) === civilPlusDays(20));
  ok("J8 the grant's report deadline is on it, once", dl.length === 1, cal.map(i => [i.type, i.title, i.start]));
  const second = (inst[1] || {}).dueDate ? String(inst[1].dueDate).slice(0, 10) : null;
  const cal2 = second ? ((await api("GET", `/calendar/items?from=${second}&to=${second}`, dana)).body.items || []) : [];
  ok("J8 the grant's unpaid second instalment is on the calendar on its due day", cal2.some(i => i.donorId === H.funder || /lantern/i.test(i.title || "")), { second, items: cal2.map(i => [i.type, i.title, i.start]) });

  // ── J9 a report number opens its rows ────────────────────────────────────
  console.log("\nJ9 open a report number to its rows");
  const from = `${year}-01-01`;
  const want = (await q(`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint c, COUNT(*)::int n FROM gifts WHERE org_id=$1 AND date BETWEEN $2 AND $3`, [ORG, from, today]))[0];
  const gs = (await api("GET", `/reports/giving-summary?from=${from}&to=${today}`, dana)).body;
  const gsd = gs.d || gs;
  ok("J9 the giving summary is the year's gifts, to the cent", cents(gsd.total) === Number(want.c) && gsd.giftCount === want.n, { total: gsd.total, n: gsd.giftCount, want });
  const fr = (await api("GET", `/figures/gifts/rows?from=${from}&to=${today}&pageSize=200`, dana)).body;
  const frows = fr.rows || [];
  ok("J9 its rows foot to it, to the cent", frows.length === want.n && frows.reduce((s, r) => s + cents(r.amount), 0) === cents(gsd.total), { n: frows.length, sum: frows.reduce((s, r) => s + cents(r.amount), 0) });
  if (fr.value != null) ok("J9 the figure's own value is the same number", cents(fr.value) === cents(gsd.total), fr.value);

  // ── J10 merge two people ─────────────────────────────────────────────────
  console.log("\nJ10 merge two people");
  const dupR = await api("POST", "/donors", dana, { name: "Tobias Wrenfield", phone: "555-0142" });
  const DUP = dupR.body && (dupR.body.id || (dupR.body.donor && dupR.body.donor.id));
  ok("J10 a second Tobias, added by hand", dupR.status < 300 && DUP && DUP !== H.tobias, dupR.body);
  const dg = await api("POST", `/donors/${DUP}/gifts`, dana, { amount: "15.05", date: today, type: "cash", paymentMethod: "Cash" });
  ok("J10 the duplicate has its own $15.05 gift", dg.status === 201, dg.body);
  const before = (await q(`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint c, COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0];
  const mg = await api("POST", "/data-health/merge", dana, { keptId: H.tobias, mergedId: DUP });
  ok("J10 the merge went through", mg.status < 300, mg.body);
  const after = (await q(`SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint c, COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0];
  const his = await gsum(H.tobias);
  ok("J10 no gift lost or doubled: $90.30 in two gifts, both his", Number(after.c) === Number(before.c) && after.n === before.n && Number(his.c) === 9030 && his.n === 2, { before, after, his });
  const [tot] = await q(`SELECT total_giving, gift_count, phone FROM donors WHERE id=$1`, [H.tobias]);
  ok("J10 his lifetime is $90.30 over two gifts, and he keeps the duplicate's phone", cents(tot.total_giving) === 9030 && Number(tot.gift_count) === 2 && /0142/.test(tot.phone || ""), tot);
  const [gone] = await q(`SELECT deleted_at FROM donors WHERE id=$1`, [DUP]);
  ok("J10 the duplicate is gone from the list", gone && gone.deleted_at, gone);
  const colsP = await q(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'
                         AND (column_name ~ '(^|_)(donor|person)_id$' OR column_name IN ('person_ids','donor_id_a','donor_id_b','match_employer_id','tribute_donor_id','funder_donor_id'))`);
  const left = [];
  for (const c of colsP) {
    if (/^(donor_merges|merge_|data_health|import_merges|deleted_records|fin_audit_log|audit)/.test(c.table_name)) continue;
    const cond = c.data_type === "ARRAY" ? `$1 = ANY(${c.column_name})` : `${c.column_name} = $1`;
    const [r] = await q(`SELECT COUNT(*)::int n FROM ${c.table_name} WHERE ${cond}`, [DUP]).catch(() => [{ n: 0 }]);
    if (r.n) left.push(`${c.table_name}.${c.column_name}`);
  }
  ok("J10 no row anywhere still points at the duplicate", left.length === 0, left);
  const s10 = JSON.stringify((await api("GET", `/search?q=${encodeURIComponent("Tobias Wrenfield")}`, dana)).body);
  ok("J10 search finds one Tobias, not two", s10.includes(H.tobias) && !s10.includes(DUP), s10.slice(0, 300));
  const t10 = (await api("GET", `/donors/${H.tobias}`, dana)).body;
  ok("J10 his record shows both gifts, $90.30", (t10.gifts || []).length === 2 && (t10.gifts || []).reduce((x, g) => x + cents(g.amount), 0) === 9030, t10.gifts);

  await wipe();
  const secs = Math.round((Date.now() - T0) / 1000);
  console.log(`\ngolden journeys ran in ${secs}s`);
  ok("the ten journeys finish well inside four minutes", secs < 240, secs);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await wipe().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });

// tests/check2-match.test.js · CHECK-2. A CHECK LANDS ON THE DONOR YOU ALREADY HAVE.
//
// Jonathan, prod, 21 Oct: a joint check from "HENRIETTA M. DUFFIELD / GEORGE A.
// DUFFIELD" for $2,500, memo "Gala - in memory of Walter", made a NEW donor in
// capitals, thanked her for her "first gift", dropped the tribute, ignored
// George, while the file already had Henrietta Duffield (4 gifts since 2023,
// $153,117) among 27 Henriettas. This suite is that check, in a fixture org.
//
// Money, donor data and security: the check matches the existing person with
// the reason on the card; confirming adds $2,500 to HER lifetime and makes no
// new person; the tribute and the memo are on the gift; the draft does not say
// "first gift" and mentions Walter; the household rule says who got what; the
// draft is one row seen in the three places; an unmatched name never becomes a
// new person on its own; a check printed in capitals reads in proper case
// everywhere; "pledge pmt 2 of 4" pays payment 2; the account number is in no
// table, log line or model request.
//
// It boots server.js IN-PROCESS with a stand-in model (capture1-zero-day's
// pattern), hostile about bank numbers: it copies the MICR line into the memo.
//
// Red on main (origin/main 23a26ae): §1 (the card proposed a new person),
// §2 (a new donor was made), §3 (no tribute, no memo), §4 ("first gift"),
// §6 (capitals), §7 (no pledge offer), §9 (an org named "(Demo)" was swept).
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5699);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.TEST_MODE = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-check2-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const LOGS = [];
for (const k of ["log", "error", "warn"]) { const o = console[k]; console[k] = (...a) => { LOGS.push(a.map(String).join(" ")); o(...a); }; }

const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { FAKE_ROUTING, FAKE_ACCOUNT } = require("../scripts/capture1-make-fixtures.js");
const FX = path.join(__dirname, "fixtures", "capture1");
const dataUrl = f => `data:image/png;base64,${fs.readFileSync(path.join(FX, f)).toString("base64")}`;

const ORG = "org_check2", SLUG = "check2-test", ADMIN = "check2-admin@example.org", USER = "u_check2";
const sys = "'system:test','test'";
const DEMO = "org_check2_demo";
const HEN = "d_ck2_hen", GALA = "f_ck2_gala", GEN = "f_ck2_gen";
const MICR = ` ⑆${FAKE_ROUTING}⑆ ${FAKE_ACCOUNT}⑈`;

// ── THE STAND-IN MODEL ────────────────────────────────────────────────────
const queued = [];
const sentToModel = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/v1/messages")) {
      sentToModel.push(body);
      if (body.includes('"name":"pick_fund"')) {
        return send(200, { id: "msg_f", type: "message", role: "assistant", model: "claude-haiku-4-5", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", id: "tu_f", name: "pick_fund", input: { fund: "none", confidence: "low" } }] });
      }
      return send(200, { id: "msg_r", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tu_1", name: "record_items", input: { items: queued.shift() || [] } }] });
    }
    send(200, {});
  });
});

const blank = { kind: "other", payer: "", payee: "", amountDigits: "", amountWords: "", amountStated: "", memo: "", date: "", chequeNumber: "",
  donorName: "", email: "", line1: "", city: "", state: "", postal: "", fundName: "", advisorName: "", employer: "", frequency: "",
  installments: "", startDate: "", shares: "", ticker: "", originalGiftDate: "", sentence: "" };
const check = o => ({ ...blank, kind: "check", payee: "Lighthouse Youth Coll.", date: "Oct 19, 2026", chequeNumber: "4417", ...o,
  memo: (o.memo || "") + MICR, routingNumber: FAKE_ROUTING });

const TABLES = ["group_sweep_seen", "group_crossings", "audiences", "donor_rhythm", "capture_items", "capture_batches", "capture_fund_words",
  "thank_you_drafts", "tribute_notices", "gift_soft_credits", "pledge_installments", "threads", "interactions", "fin_transactions", "gifts", "pledges",
  "milestone_drafts", "journey_enrollments", "portal_assets", "tasks", "donors", "households", "user_sessions", "users", "fin_funds", "accounts", "budgets", "ai_usage"];
async function reset() {
  for (const o of [ORG, DEMO]) {
    await q(`UPDATE gifts SET pledge_id=NULL WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
async function settle(tok) {
  for (const c of await q(`SELECT id FROM capture_items WHERE org_id=$1 AND status='confirmed'`, [ORG])) await api("GET", `/capture/${c.id}/settled`, tok);
}
const upload = (tok, item) => { queued.push([item]); return api("POST", "/capture/upload", tok, { files: [{ name: "check-1.png", dataUrl: dataUrl("check-1.png") }], source: "photo" }); };

(async () => {
  console.log("check2-match (CHECK-2)");
  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await new Promise(r => setTimeout(r, 3500));
  await reset();

  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Lighthouse Youth Collective',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($2,$1,'General Operating',false),($3,$1,'Gala Reserve',true)`, [ORG, GEN, GALA]);
  await q(`UPDATE orgs SET default_fund_id=$2 WHERE id=$1`, [ORG, GEN]);
  // The crowded file: Henrietta Duffield, 27 other Henriettas, other Duffields.
  await q(`INSERT INTO donors (id,org_id,name,address,city,state,zip,stage,person_types,created_by,created_by_name)
           VALUES ($2,$1,'Henrietta Duffield','5 Elm St','Beverly','MA','01915','active','["donor"]'::jsonb,${sys})`, [ORG, HEN]);
  const SURN = ["Ashby", "Blake", "Crane", "Dorsey", "Ellery", "Finch", "Garrow", "Hale", "Ives", "Jarvis", "Keene", "Lowell", "Marsh", "Noble",
    "Orme", "Pratt", "Quill", "Rowe", "Sayer", "Thorne", "Usher", "Vance", "Wade", "Yates", "Zeller", "Abbott", "Bristow"];
  for (const [i, s] of SURN.entries()) {
    await q(`INSERT INTO donors (id,org_id,name,zip,stage,person_types,created_by,created_by_name) VALUES ($2,$1,$3,'01915','active','["donor"]'::jsonb,${sys})`,
      [ORG, `d_ck2_h${i}`, `Henrietta ${s}`]);
  }
  for (const [i, f] of ["Horatio", "Desmond", "Vespasia"].entries()) {
    await q(`INSERT INTO donors (id,org_id,name,address,zip,stage,person_types,created_by,created_by_name) VALUES ($2,$1,$3,$4,'01907','active','["donor"]'::jsonb,${sys})`,
      [ORG, `d_ck2_dd${i}`, `${f} Duffield`, `${10 + i} Cabot St`]);
  }
  // Her history: 4 gifts since 2023, $153,117, the last $38,088 to Gala Reserve.
  const HIST = [["2023-05-10", 50000, GEN], ["2024-04-02", 40029, GEN], ["2025-03-15", 25000, GEN], ["2026-05-01", 38088, GALA]];
  for (const [i, [d, a, f]] of HIST.entries()) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,created_by,created_by_name) VALUES ($2,$1,$3,$4,$5,'cash',$6,'Check',${sys})`,
      [ORG, `g_ck2_${i}`, HEN, a, d, f]);
  }
  await q(`UPDATE donors SET total_giving=153117, gift_count=4, last_gift_amount=38088, last_gift_date='2026-05-01', first_gift_date='2023-05-10' WHERE id=$1`, [HEN]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  const [p0] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);

  // ── §1 the joint check matches Henrietta, with the reason on the card ──
  console.log("\n§1 the match");
  const up = await upload(tok, check({ payer: "HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD", amountDigits: "2,500.00",
    amountWords: "Two thousand five hundred and 00/100", memo: "Gala - in memory of Walter",
    sentence: "A check from HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD to Lighthouse Youth Coll. for the gala." }));
  const card = up.body && up.body.cards && up.body.cards[0];
  ok("§1 one card, $2,500.00 settled", up.status === 201 && !!card && card.amount.cents === 250000 && card.amount.settled, up.body);
  ok("§1 the card matches the existing Henrietta Duffield, not a new person",
    !!card && card.donor.state === "matched" && card.donor.selectedId === HEN, card && card.donor);
  ok("§1 the card says why: same name, and her history (4 gifts since 2023)",
    !!card && /^Matched Henrietta Duffield: same name.*4 gifts since 2023\.$/.test(card.donor.sentence || ""), card && card.donor.sentence);
  ok("§1 the joint name is named in proper case, with who gets the gift",
    !!card && card.donor.credit && /George A\. Duffield isn't in Steward, so the whole gift is Henrietta Duffield's/.test(card.donor.credit.sentence)
    && /first name on the check/.test(card.donor.credit.sentence), card && card.donor.credit);
  ok("§1 the tribute is read from the memo", !!card && card.tribute && card.tribute.type === "memory" && card.tribute.name === "Walter", card && card.tribute);
  ok("§1 the fund comes from the memo", !!card && card.fund.id === GALA, card && card.fund);
  ok("§1 no capitals on the card: headline and sentence read in proper case",
    !!card && !/HENRIETTA|GEORGE|DUFFIELD/.test(card.headline + " " + card.sentence) && /Henrietta Duffield/.test(card.headline), card && [card.headline, card.sentence]);

  // ── §2 confirm: her lifetime grows, nobody new ──────────────────────────
  console.log("\n§2 confirm");
  const conf = await api("POST", `/capture/${card.id}/confirm`, tok, { amountCents: 250000, date: "2026-10-19", donorId: card.donor.selectedId,
    fundId: card.fund.id, kind: "check", logAnyway: true });
  ok("§2 confirm logs it", conf.status === 200 && !!conf.body.giftId, conf.body);
  await settle(tok);
  const [p1] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  ok("§2 no new person was made", p1.n === p0.n, { before: p0.n, after: p1.n });
  const [hen] = await q(`SELECT total_giving::text AS t, gift_count, tags FROM donors WHERE id=$1`, [HEN]);
  ok("§2 $2,500 is added to her lifetime: $155,617.00 over 5 gifts", hen.t === "155617.00" && hen.gift_count === 5, hen);
  ok("§2 she is not tagged New", !(Array.isArray(hen.tags) ? hen.tags : []).some(t => /^new/i.test(String(t))), hen.tags);

  // ── §3 the tribute and the memo are on the gift ─────────────────────────
  console.log("\n§3 tribute and memo");
  const [g] = await q(`SELECT id, donor_id, fund_id, tribute_type, tribute_name, to_jsonb(gifts)->>'memo' AS memo FROM gifts WHERE id=$1`, [conf.body.giftId]);
  ok("§3 the gift is in memory of Walter", !!g && g.tribute_type === "memory" && g.tribute_name === "Walter", g);
  ok("§3 the memo is saved as written, without the bank numbers", !!g && /^Gala - in memory of Walter\b/.test(g.memo || "")
    && !(g.memo || "").includes(FAKE_ACCOUNT) && !(g.memo || "").includes(FAKE_ROUTING), g && g.memo);
  ok("§3 the confirm says who got what", /Henrietta Duffield gets the gift/.test(conf.body.sentence) && /in memory of Walter/.test(conf.body.sentence), conf.body.sentence);

  // ── §4 the draft: one row, no "first gift", mentions Walter ─────────────
  console.log("\n§4 the thank-you draft");
  const drafts = await q(`SELECT id, donor_id, body FROM thank_you_drafts WHERE org_id=$1 AND gift_id=$2`, [ORG, conf.body.giftId]);
  ok("§4 exactly one draft, on Henrietta", drafts.length === 1 && drafts[0].donor_id === HEN, drafts);
  const body = drafts[0] ? drafts[0].body : "";
  ok("§4 it does not call this her first gift", !/first gift/i.test(body), body);
  ok("§4 it mentions Walter, gently", /remember Walter/.test(body), body);
  ok("§4 it greets her in proper case", /\bHenrietta\b/.test(body) && !/HENRIETTA/.test(body), body.slice(0, 80));
  const md = await q(`SELECT milestone_key FROM milestone_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, HEN]);
  ok("§4 no first-gift welcome draft for someone who is not new", !md.some(m => /first|welcome|new/i.test(m.milestone_key)), md);
  const viewsHave = [];
  const comms = await api("GET", "/thank-yous", tok);
  if (JSON.stringify(comms.body || {}).includes(drafts[0] && drafts[0].id)) viewsHave.push("thank-yous");
  const seen = (JSON.stringify(comms.body || {}).match(new RegExp(drafts[0] ? drafts[0].id : "^$", "g")) || []).length;
  // Communications, the profile (Emails tab and Thank-yous panel) and Money in,
  // Acknowledgments all read GET /thank-yous: one draft, never three copies.
  ok("§4 the draft is in the drafts waiting to send, once", viewsHave.includes("thank-yous") && seen === 1, { status: comms.status, seen });

  // ── §5 an unmatched name: "New donor" is a choice, never the default ────
  console.log("\n§5 nobody matches");
  const up5 = await upload(tok, check({ payer: "PRUDENCE Q. NOBODY", amountDigits: "40.00", amountWords: "Forty and 00/100", memo: "",
    sentence: "A check from PRUDENCE Q. NOBODY." }));
  const c5 = up5.body && up5.body.cards && up5.body.cards[0];
  ok("§5 nobody is selected, and nobody new is proposed as the answer", !!c5 && c5.donor.state === "none" && !c5.donor.selectedId, c5 && c5.donor);
  ok("§5 the new-donor name is ready in proper case", !!c5 && c5.donor.prefill.name === "Prudence Q. Nobody", c5 && c5.donor.prefill);
  const no5 = await api("POST", `/capture/${c5.id}/confirm`, tok, { amountCents: 4000, date: "2026-10-19", fundId: GEN, kind: "check", logAnyway: true });
  ok("§5 confirming without choosing records nothing", no5.status === 400 && no5.body.error === "who", no5.body);
  // A first name alone, even a common one, matches nobody.
  const up5b = await upload(tok, check({ payer: "Henrietta", amountDigits: "10.00", amountWords: "Ten and 00/100" }));
  const c5b = up5b.body.cards && up5b.body.cards[0];
  ok("§5 \"Henrietta\" alone (28 in the file) matches nobody", !!c5b && c5b.donor.state !== "matched" && !c5b.donor.selectedId, c5b && c5b.donor);
  await api("POST", `/capture/${c5b.id}/skip`, tok, { reason: "test" });

  // ── §6 a check in capitals reads in proper case everywhere ──────────────
  console.log("\n§6 proper case");
  const yes5 = await api("POST", `/capture/${c5.id}/confirm`, tok, { amountCents: 4000, date: "2026-10-19", fundId: GEN, kind: "check", logAnyway: true,
    newPerson: c5.donor.prefill });
  ok("§6 New donor, chosen, logs it", yes5.status === 200 && !!yes5.body.giftId, yes5.body);
  await settle(tok);
  const [pru] = await q(`SELECT d.name, t.description FROM gifts g JOIN donors d ON d.id=g.donor_id LEFT JOIN fin_transactions t ON t.org_id=g.org_id AND t.description LIKE 'Gift from%' AND t.date=g.date
                          WHERE g.id=$1 ORDER BY t.created_at DESC LIMIT 1`, [yes5.body.giftId]);
  ok("§6 the person and Finance read Prudence Q. Nobody", !!pru && pru.name === "Prudence Q. Nobody" && (!pru.description || pru.description === "Gift from Prudence Q. Nobody"), pru);
  const [caps] = await q(`SELECT (SELECT COUNT(*) FROM thank_you_drafts WHERE org_id=$1 AND (body LIKE '%PRUDENCE%' OR body LIKE '%HENRIETTA%'))
                              + (SELECT COUNT(*) FROM fin_transactions WHERE org_id=$1 AND (description LIKE '%PRUDENCE%' OR description LIKE '%HENRIETTA%'))
                              + (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND (note LIKE '%PRUDENCE%' OR note LIKE '%HENRIETTA%'))
                              + (SELECT COUNT(*) FROM donors WHERE org_id=$1 AND (name LIKE '%PRUDENCE%' OR name LIKE '%HENRIETTA%'))
                              + (SELECT COUNT(*) FROM capture_items WHERE org_id=$1 AND (headline LIKE '%PRUDENCE%' OR sentence LIKE '%PRUDENCE%' OR headline LIKE '%HENRIETTA%' OR sentence LIKE '%HENRIETTA%')) AS n`, [ORG]);
  ok("§6 no draft, Finance line, timeline note, record or card says it in capitals", Number(caps.n) === 0, caps);

  // ── §7 "pledge pmt 2 of 4" pays payment 2 of her open pledge ───────────
  console.log("\n§7 pledge payment");
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ('pl_ck2',$1,$2,4000,'2026-01-15','open',${sys})`, [ORG, HEN]);
  for (let i = 1; i <= 4; i++) {
    await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES ($2,$1,'pl_ck2',$3,$4,1000)`, [ORG, `pi_ck2_${i}`, i, `2026-0${i * 2}-15`]);
  }
  const up7 = await upload(tok, check({ payer: "Henrietta Duffield", amountDigits: "1,000.00", amountWords: "One thousand and 00/100", memo: "pledge pmt 2 of 4" }));
  const c7 = up7.body.cards && up7.body.cards[0];
  ok("§7 the card offers payment 2 of her pledge", !!c7 && c7.pledge && c7.pledge.pledgeId === "pl_ck2" && c7.pledge.installmentId === "pi_ck2_2", c7 && c7.pledge);
  const conf7 = await api("POST", `/capture/${c7.id}/confirm`, tok, { amountCents: 100000, date: "2026-10-19", donorId: HEN, fundId: GEN, kind: "check", logAnyway: true });
  await settle(tok);
  const inst = await q(`SELECT id, paid_gift_id FROM pledge_installments WHERE pledge_id='pl_ck2' ORDER BY seq`);
  ok("§7 payment 2 is paid by this gift, and payment 1 is not", conf7.status === 200 && inst[1].paid_gift_id === conf7.body.giftId && !inst[0].paid_gift_id, { s: conf7.status, inst });

  // ── §8 the account number is nowhere ────────────────────────────────────
  console.log("\n§8 bank numbers");
  const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const hits = [];
  for (const { table_name: t } of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n FROM "${t}" x WHERE x::text LIKE $1 OR x::text LIKE $2`, [`%${FAKE_ROUTING}%`, `%${FAKE_ACCOUNT}%`]).catch(() => [{ n: 0 }]);
    if (r.n) hits.push(`${t}: ${r.n}`);
  }
  ok("§8 no table holds the routing or account number", hits.length === 0, hits);
  ok("§8 no log line holds them", !LOGS.some(l => l.includes(FAKE_ROUTING) || l.includes(FAKE_ACCOUNT)), LOGS.filter(l => l.includes(FAKE_ACCOUNT)).slice(0, 2));
  const modelText = sentToModel.map(b => b.replace(/"data":"[A-Za-z0-9+/=]+"/g, '"data":"<image>"')).join("\n");
  ok("§8 no request to the model holds them (the image aside)", sentToModel.length >= 4 && !modelText.includes(FAKE_ROUTING) && !modelText.includes(FAKE_ACCOUNT), sentToModel.length);

  // ── §9 a demo org's pledge sends no reminder ─────────────────────────────
  console.log("\n§9 demo org pledge reminders");
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,emails_enabled,is_demo_org)
           VALUES ($1,'Check Two Arts (Demo)','check2-demo',1,'core','active',true,false)`, [DEMO]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_check2_demo',$1,'check2-demo@example.org',$2,'Demo Admin','admin')`, [DEMO, pw]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ('d_ck2_demo',$1,'Pat Example','pat@example.com','active',${sys})`, [DEMO]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,first_overdue_at,next_reminder_at)
           VALUES ('pl_ck2_demo',$1,'d_ck2_demo',500,'2026-09-01','open',NOW() - INTERVAL '2 days',NOW() - INTERVAL '1 hour')`, [DEMO]);
  const dtok = await login("check2-demo@example.org");
  const sweep = await api("POST", "/pledges/process-reminders", dtok);
  ok("§9 the pledge-reminder sweep picks nothing in a demo org", sweep.status === 200 && sweep.body.picked === 0, sweep.body);

  // ── §10 FIX-48: the demo's "new person" check says what a real read says ──
  console.log("\n§10 the seeded Hollis Tran card");
  const hol = await upload(tok, check({ payer: "HOLLIS TRAN", amountDigits: "75.00", amountWords: "Seventy five and 00/100", memo: "",
    sentence: "A check from HOLLIS TRAN." }));
  const real = hol.body && hol.body.cards && hol.body.cards[0];
  const seedSrc = require("fs").readFileSync(require("path").join(__dirname, "../scripts/seed/capture1-inbox.js"), "utf8");
  const card3 = seedSrc.slice(seedSrc.indexOf('item("check3"'), seedSrc.indexOf('item("pledge"'));
  const seedState = (card3.match(/donor: \{ state: "(\w+)"/) || [])[1];
  ok("§10 a real check from someone new chooses nobody, and the seeded card is in the same state",
    !!real && real.donor.state === "none" && !real.donor.selectedId && seedState === real.donor.state, { real: real && real.donor.state, seed: seedState });
  ok("§10 the seeded card uses CHECK-2's words: no \"(new person)\", no \"confirming adds them\"",
    !!real && /Nobody in Steward matches Hollis Tran\./.test(real.donor.sentence || "") && card3.includes("Nobody in Steward matches ${f3.payer}.")
    && !/new person|confirming adds/.test(card3.replace(/\/\/.*$/gm, "")), real && real.donor.sentence);

  mock.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });

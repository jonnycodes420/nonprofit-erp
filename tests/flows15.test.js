// tests/flows15.test.js — FLOWS-15. WHAT THE SCREEN CLAIMS: APPEALS, PACE, FUND NAMES, COUNTS AND
// CONNECTIONS.
//
// Boots server.js in-process (like atlas3-answers) with a stand-in model, so the Atlas checks go
// through the real routes and every answer is the same every run. One made-up org, made-up names.
//   §1 W-1114-Fundraising-17  a never-giver never receives donor-only copy: left out of the send
//      with the sentence, "Not sent to Ines: no first-gift version." in the preview, ticked in
//      knowingly, and her first-gift version (the hero too) read instead once written
//   §2 W-1116-Fundraising-04  the weekly pace is the money left over the days-left number shown
//   §3 W-1116-Atlas-01X       an answer's figure carries its unit: money, count, list and date
//   §4 W-1116-Finance-28      one fund, one name, the restriction a badge, never in the name
//   §5 W-1116-Atlas-24X       Records + every named part = the Donors tab (erased, archived and
//      unmarked givers, a refund-only giver, and someone marked Donor with no gift)
//   §6 W-1116-Atlas-30        "Take gifts on your giving pages" is the public page's check, and
//      the Stripe card gives one weekly rate with its period
//
// HOW IT GOES RED: run against origin/main in a throwaway worktree with its own database; see the
// PR. Planted, each red there: a never-giver sent donor-only copy (§1), pace from a whole-week day
// count (§2), a money answer drawn as people (§3), "(restricted)" in the name (§4), records plus
// parts missing the archived giver (§5), "Take gifts: On" from synced history (§6).
"use strict";

const http = require("http");
const path = require("path");

const PORT = Number(process.env.MATRIX_PORT || 5698);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);
const SINK = Number(process.env.SINK_PORT || 5617);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = "re_dummy_local";
process.env.RESEND_BASE_URL = `http://localhost:${SINK}`;
process.env.DEMO_SMTP_FROM = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-flows15-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, atlasSaved, mailTypesOn } = require("./helpers");
const ROOT = path.join(__dirname, "..");
const read = f => require("fs").readFileSync(path.join(ROOT, f), "utf8");

const run = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_flows15_${run}`, EMAIL = `owner-${run}@flows15.local`, ME = `u_flows15_${run}`, PASSWORD = "loadtest1234";
const sys = "'system:test','test'";

// ── THE MAIL SINK (nothing leaves) AND THE STAND-IN MODEL ────────────────────
const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { MAIL.push(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});
const step = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", ...o });
const Q = t => [step({ kind: "question", target: t, words: t })];
const PLANS = [
  // money: one giver's lifetime giving (Muse's question)
  [/lifetime giving/, { answerable: true, unsupported: null, entity: "people", where: [{ field: "name", op: "eq", value: "Linwood Foundation" }], measure: { fn: "sum", field: "lifetime_giving" }, list: true }],
  // count: how many people
  [/How many people gave over/, { answerable: true, unsupported: null, entity: "people", where: [{ field: "lifetime_giving", op: "gt", value: 1000 }], measure: { fn: "count" }, list: true }],
  // list: who
  [/Who gave over/, { answerable: true, unsupported: null, entity: "people", where: [{ field: "lifetime_giving", op: "gt", value: 1000 }], measure: { fn: "count_people" }, list: true }],
  // date: when one giver last gave
  [/last give/, { answerable: true, unsupported: null, entity: "gifts", where: [{ field: "donor", op: "eq", value: "Linwood Foundation" }], measure: { fn: "max", field: "date" }, list: true }],
];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, x) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(x)); };
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    let input = null;
    if (name === "atlas_read") { const said = (/What she said: (.*)$/m.exec(user) || [])[1] || ""; input = { steps: said ? Q(said) : [] }; }
    else if (name === "query_plan") {   // matched on the question line only (the prompt's catalogue names every field)
      const asked = (/^Question: (.*)$/m.exec(user) || [])[1] || "";
      const hit = PLANS.find(([re]) => re.test(asked)); input = hit ? hit[1] : { answerable: false, unsupported: "not in this stand-in" };
    }
    if (!input) return send(500, { type: "error", error: { type: "api_error", message: "no stand-in for " + name } });
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: x.model, stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

(async () => {
  console.log("flows15 (FLOWS-15)");
  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await require("./helpers").untilReady();
  const today = civilToday();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,emails_enabled,onboarded_at,receipt_address,legal_name,ein)
           VALUES ($1,'Flows Fifteen Saltmarsh Arts',$1,1,'active','team','America/New_York',NOW(),true,NOW(),'12 Quay Street, Saltmarsh, ME 04101','Saltmarsh Arts Inc','12-3456781')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Halloway','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  ok("fixture owner signed in", !!tok, tok);
  const P = async (id, name, extra = {}) => {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active',$5::jsonb,${sys})`,
      [id, ORG, name, `${id}-${run}@flows15.invalid`, JSON.stringify(extra.types || ["donor"])]);
    return id;
  };
  let gn = 0;
  const G = async (donor, amount, date, extra = {}) => {
    const id = `g_f15_${run}_${++gn}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,fund_id,stripe_payment_id,giving_source_id,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'check',$6,$7,$8,${sys})`, [id, ORG, donor, amount, date, extra.fund || null, extra.stripe || null, extra.source || null]);
    return id;
  };
  const recalc = async ids => { for (const id of ids) await q(`UPDATE donors SET total_giving=COALESCE((SELECT SUM(amount) FROM gifts WHERE donor_id=$1),0),
    gift_count=(SELECT COUNT(*) FROM gifts WHERE donor_id=$1 AND amount>0), last_gift_date=(SELECT MAX(date) FROM gifts WHERE donor_id=$1 AND amount>0),
    last_gift_amount=(SELECT amount FROM gifts WHERE donor_id=$1 AND amount>0 ORDER BY date DESC LIMIT 1) WHERE id=$1`, [id]); };
  const d = id => `d_f15_${run}_${id}`;
  await P(d("marguerite"), "Marguerite Okonkwo"); await G(d("marguerite"), 1500, civilPlusDays(-60));
  await P(d("ines"), "Ines Varga");            // never given
  await P(d("dov"), "Dov Pellander");          // never given
  await P(d("linwood"), "Linwood Foundation"); await G(d("linwood"), 4000, civilPlusDays(-300)); await G(d("linwood"), 2523, civilPlusDays(-40));
  await P(d("elsbeth"), "Elsbeth Crane"); await G(d("elsbeth"), 1200, civilPlusDays(-20));
  await recalc([d("marguerite"), d("linwood"), d("elsbeth"), d("ines"), d("dov")]);

  // ── §1 a never-giver never receives donor-only copy ─────────────────────────
  console.log("\n§1 the Year-end appeal and the people who have never given");
  const PG0 = await import(path.join(ROOT, "shared/pastGiving.js"));
  const none = () => "";   // on a build without FLOWS-15 these are missing, and the checks read red rather than crash
  const PG = { ...PG0, leftOutSentence: PG0.leftOutSentence || none, includedSentence: PG0.includedSentence || none, neverGiverOutcome: PG0.neverGiverOutcome || none };
  await mailTypesOn(ORG, "everyone");
  const tpl = await api("POST", "/email-templates", tok, { starterKey: "year_end_appeal" });
  const blocks = (tpl.body && (tpl.body.template || tpl.body).blocks) || [];
  const claims = PG.claimsOf(blocks);
  const heroAt = blocks.findIndex(b => b.type === "hero");
  ok("§1 the hero heading counts as copy: \"This year, you were part of it\" thanks them for giving", claims.some(c => c.index === heroAt && /you were part of it/i.test(c.phrase)), claims);
  const CAMP = `ecamp_f15_${run}`;
  await q(`INSERT INTO campaigns (id,org_id,name,type,subject,preheader,body,status,segment,email_blocks,created_by,created_by_name)
           VALUES ($1,$2,'Year-end appeal','appeal','Before the year ends, {{first_name}}','','','draft',$3,$4::jsonb,${sys})`,
    [CAMP, ORG, JSON.stringify({ mode: "everyone" }), JSON.stringify(blocks.map(b => (b.type === "hero" ? (({ image, alt, ...rest }) => rest)(b) : b)))]);   // no photo to choose in a test
  const seg = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone" }, donorOnlyCopy: true });
  const leftOut = ((seg.body && seg.body.leftOut) || []).find(g => g.reason === "no_first_gift_version") || {};
  ok("§1 with no first-gift version the two never-givers are left out of the count, under their own reason",
    seg.status === 200 && seg.body.neverGivenLeftOut === 2 && leftOut.count === 2 && seg.body.count === 3
      && (leftOut.people || []).map(p => p.name).sort().join() === "Dov Pellander,Ines Varga", { status: seg.status, n: seg.body && seg.body.neverGivenLeftOut, count: seg.body && seg.body.count, leftOut });
  ok("§1 and the editor says so: \"2 people who have never given won't get this until you write a first-gift version.\"",
    PG.leftOutSentence(seg.body && seg.body.neverGivenLeftOut) === "2 people who have never given won't get this until you write a first-gift version.", PG.leftOutSentence(seg.body && seg.body.neverGivenLeftOut));
  const asInes = await api("POST", "/email-preview", tok, { blocks, subject: "x", as: d("ines"), campaign: true });
  const asInesC = await api("POST", `/campaigns/${CAMP}/preview`, tok, { donorId: d("ines") });
  ok("§1 Preview as Ines (never gave) says \"Not sent to Ines: no first-gift version.\", in the editor and the campaign preview, and shows no letter",
    asInes.body && asInes.body.notSent === "Not sent to Ines: no first-gift version." && !asInes.body.html
      && asInesC.body && asInesC.body.notSent === "Not sent to Ines: no first-gift version." && !asInesC.body.html, { editor: asInes.body && asInes.body.notSent, campaign: asInesC.body && asInesC.body.notSent });
  const sendRes = await api("POST", `/campaigns/${CAMP}/send`, tok, {});
  let rows = [];
  for (let i = 0; i < 40; i++) {
    rows = await q(`SELECT donor_id, sent_at, failure_reason FROM campaign_recipients WHERE campaign_id=$1`, [CAMP]);
    const [c] = await q(`SELECT status FROM campaigns WHERE id=$1`, [CAMP]);
    if (c && c.status === "sent" && rows.length >= 5) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const rowOf = id => rows.find(r => r.donor_id === id) || {};
  const sentTo = MAIL.join("\n");
  ok("§1 the send leaves them out: Ines and Dov get no letter, each row says why", sendRes.status === 200 && sendRes.body.recipientCount === 3
    && rowOf(d("ines")).failure_reason === "suppressed: no_first_gift_version" && !rowOf(d("ines")).sent_at
    && rowOf(d("dov")).failure_reason === "suppressed: no_first_gift_version" && !sentTo.includes(`${d("ines")}-${run}`) && !sentTo.includes(`${d("dov")}-${run}`),
    { send: sendRes.body, rows });
  ok("§1 and the givers get it as written", !!rowOf(d("marguerite")).sent_at && /you were part of it/i.test(sentTo), { rows, mail: MAIL.length });
  // Ticked in, knowingly.
  const segIn = await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone", includeNeverGiven: true }, donorOnlyCopy: true });
  ok("§1 ticked in (\"Send it to them anyway\"), they are counted, and the editor says what they will read",
    segIn.body && segIn.body.neverGivenLeftOut === 0 && segIn.body.count === 5 && PG.includedSentence(2) === "2 people who have never given will get this letter as it is, the one that thanks them for giving.", segIn.body && { n: segIn.body.neverGivenLeftOut, count: segIn.body.count });
  const asInesIn = await api("POST", "/email-preview", tok, { blocks, subject: "x", as: d("ines"), campaign: true, includeNeverGiven: true });
  ok("§1 and Preview as Ines then shows exactly the letter she would get", asInesIn.status === 200 && !asInesIn.body.notSent && /you were part of it/i.test(asInesIn.body.html || ""), asInesIn.body && asInesIn.body.notSent);
  // Her versions written, on the hero and the text.
  const withV = blocks.map((b, i) => (b.type === "hero" ? { ...b, firstGiftHeading: "There is room for you in this year", firstGiftSub: "Join us before it closes." }
    : claims.some(c => c.index === i) ? { ...b, firstGift: "This would be your first gift to Saltmarsh, and we would be glad to welcome you." } : b));
  const inesV = await api("POST", "/email-preview", tok, { blocks: withV, subject: "x", as: d("ines"), campaign: true });
  const margV = await api("POST", "/email-preview", tok, { blocks: withV, subject: "x", as: d("marguerite"), campaign: true });
  ok("§1 with her versions written, Ines reads them, the hero's included, and nothing that thanks her for giving",
    inesV.status === 200 && !inesV.body.notSent && /There is room for you in this year/.test(inesV.body.html) && /your first gift to Saltmarsh/.test(inesV.body.html)
      && !/you were part of it/i.test(inesV.body.html) && !/give once more/.test(inesV.body.html), inesV.body && (inesV.body.notSent || String(inesV.body.html).slice(0, 200)));
  ok("§1 and Marguerite, who gives, reads the letter as written", /you were part of it/i.test(margV.body.html || "") && !/There is room for you/.test(margV.body.html || ""));
  ok("§1 a written version sends to everyone: nobody left out", PG.neverGiverOutcome({ blocks: withV }) === "version" && PG.neverGiverOutcome({ blocks }) === "left_out"
    && PG.neverGiverOutcome({ blocks, includeNeverGiven: true }) === "included");
  const tid = (tpl.body.template || tpl.body).id;
  const saved = await api("PUT", `/email-templates/${tid}`, tok, { blocks: withV });
  const [kept] = await q(`SELECT draft, blocks FROM email_templates WHERE id=$1`, [tid]).catch(() => [{}]);
  ok("§1 her hero version is kept when the blocks are saved", saved.status === 200 && JSON.stringify(kept || {}).includes("There is room for you in this year"), { status: saved.status, body: saved.body && saved.body.error });

  // ── §2 the weekly pace, from the days left shown ─────────────────────────────
  console.log("\n§2 the pace arithmetic");
  const N0 = require(path.join(ROOT, "shared/numbers/pace.js"));
  const N = { weeklyPace: N0.weeklyPace || (() => ({})) };
  ok("§2 $314,327 over 45 days is about $48,895 a week (not $44,904, which is 49 days)", N.weeklyPace({ left: 314327, daysLeft: 45 }).perWeek === 48895);
  ok("§2 at 49 days it is $44,904; at 7 days, all of it; at 3 days, all of it; with nothing left or no days, nothing",
    N.weeklyPace({ left: 314327, daysLeft: 49 }).perWeek === 44904 && N.weeklyPace({ left: 314327, daysLeft: 7 }).perWeek === 314327
      && N.weeklyPace({ left: 9000, daysLeft: 3 }).perWeek === 9000 && N.weeklyPace({ left: 0, daysLeft: 30 }).perWeek === 0 && N.weeklyPace({ left: 500, daysLeft: 0 }).perWeek === 0);
  await q(`INSERT INTO campaigns (id,org_id,name,subject,body,status,goal_amount,start_date,end_date,created_by,created_by_name)
           VALUES ($1,$2,'Annual Fund','x','x','active',20000,$3,$4,${sys})`, [`camp_f15_${run}`, ORG, civilPlusDays(-200), civilPlusDays(45)]);
  await q(`UPDATE gifts SET campaign_id=$1 WHERE org_id=$2 AND donor_id=$3`, [`camp_f15_${run}`, ORG, d("elsbeth")]);
  const ov = await api("GET", "/fundraising/overview", tok);
  const top = ov.body && ov.body.campaigns && ov.body.campaigns.top;
  const lead = (top && top.lead) || {};
  ok("§2 the card's weekly figure is the money left over the very days-left number it prints",
    ov.status === 200 && top && top.daysLeft > 0 && top.daysLeft % 7 !== 0 && lead.left > 0 && lead.perWeek === Math.round(lead.left * 7 / top.daysLeft),
    { daysLeft: top && top.daysLeft, lead });

  // ── §3 an answer's figure carries its unit ──────────────────────────────────
  console.log("\n§3 Atlas: money, count, list and date");
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  const lineOf = r => ((r.body && r.body.request && r.body.request.lines) || [])[0] || {};
  const ask = async t => lineOf(await atlasSaved(tok, { text: t }));
  const money = await ask("What is Linwood Foundation's lifetime giving?");
  ok("§3 money: \"What is Linwood Foundation's lifetime giving?\" says $6,523 and is never a list of 6,523 people",
    /\$6,523/.test(money.line || "") && !(money.answer && money.answer.type === "list" && money.answer.count !== 1) && !/6,523 people/.test(JSON.stringify(money)),
    { line: money.line, answer: money.answer });
  const count = await ask("How many people gave over $1,000?");
  ok("§3 count: \"How many people gave over $1,000?\" is 3 people, and its list says 3", /\b3\b/.test(count.line || "") && count.answer && count.answer.type === "list" && count.answer.count === 3 && count.answer.unit === "people",
    { line: count.line, answer: count.answer && { count: count.answer.count, unit: count.answer.unit } });
  const list = await ask("Who gave over $1,000?");
  ok("§3 list: \"Who gave over $1,000?\" names the three, counted as people", list.answer && list.answer.type === "list" && list.answer.count === 3
    && list.answer.people.map(p => p.name).sort().join() === "Elsbeth Crane,Linwood Foundation,Marguerite Okonkwo", list.answer && list.answer.people);
  const when = await ask("When did Linwood Foundation last give?");
  const lastDay = civilPlusDays(-40);
  const dayWords = require(path.join(ROOT, "askQuery.js")).dayWords;
  ok("§3 date: \"When did Linwood Foundation last give?\" says the date, never a number or a list of people",
    (when.line || "").includes(dayWords ? dayWords(lastDay) : lastDay) && !(when.answer && when.answer.type === "list"), { line: when.line, answer: when.answer, want: lastDay });
  let AU = null; try { AU = require(path.join(ROOT, "shared/numbers/answerUnit.js")); } catch { /* not on this build */ }
  ok("§3 the people count is people for every measure: a sum about one person is 1, a count is its value",
    !!AU && AU.peopleCountOf({ fn: "sum", entity: "people", value: 6523, rows: 1, listed: 1 }) === 1 && AU.peopleCountOf({ fn: "count", entity: "people", value: 3, rows: 3, listed: 3 }) === 3
      && AU.peopleCountOf({ fn: "count_people", entity: "gifts", value: 4, rows: 9, listed: 4 }) === 4 && AU.answerPeopleCount({ count: 6523, figures: { value: { kind: "money" } } }, 1) === 1);

  // ── §4 one fund, one name ───────────────────────────────────────────────────
  console.log("\n§4 fund names");
  const FUND = `fund_f15_${run}`;
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Scholarship Fund',true)`, [FUND, ORG]);
  await G(d("marguerite"), 250, civilPlusDays(-10), { fund: FUND }); await recalc([d("marguerite")]);
  const W0 = await import(path.join(ROOT, "shared/giftWords.js"));
  const W = { fundDisplayName: W0.fundDisplayName || (() => null) };
  const funds = (await api("GET", "/finance/funds", tok)).body || [];
  const fRow = funds.find(f => f.id === FUND) || {};
  const aff = ((await api("GET", `/donors/${d("marguerite")}/fund-affinity`, tok)).body || {}).affinity || [];
  const fa = aff.find(f => f.fundId === FUND) || {};
  ok("§4 Finance's funds and the profile's What they support name it the same: \"Scholarship Fund\", restricted as a flag, not a word in it",
    W.fundDisplayName(fRow) === "Scholarship Fund" && W.fundDisplayName(fa) === "Scholarship Fund" && fa.restricted === true && fRow.restricted === true, { fRow: fRow.name, fa });
  const surfaces = ["client/src/components/gifts/FundField.jsx", "client/src/components/settings/GivingPagesManager.jsx", "client/src/components/Connections.jsx",
    "client/src/components/QboSync.jsx", "client/src/components/XeroSync.jsx", "client/src/components/profile/GivingTab.jsx"];
  const suffix = surfaces.filter(f => /restricted\s*\?\s*["'`]\s*\((?:r|R)estricted\)/.test(read(f)));
  ok("§4 no surface builds a fund's name with \"(restricted)\" in it; each reads fundDisplayName or <FundName>, and the badge is one component",
    !suffix.length && surfaces.every(f => /fundDisplayName|<FundName\b/.test(read(f))) && (() => { try { return /FUND_RESTRICTED_BADGE/.test(read("client/src/components/FundName.jsx")); } catch { return false; } })(), { suffix });

  // ── §5 Records + every part = the Donors tab ────────────────────────────────
  console.log("\n§5 the records line foots");
  await P(d("nogift"), "Caspar Fenwright");                                     // marked Donor, no gift
  await P(d("erased"), "Quill Erasmore"); await G(d("erased"), 300, civilPlusDays(-90));
  await q(`UPDATE donors SET erased_at=NOW(), name='Erased person' WHERE id=$1`, [d("erased")]);
  await P(d("archived"), "Thea Archwood"); await G(d("archived"), 80, civilPlusDays(-500));
  await q(`UPDATE donors SET archived_at=NOW() WHERE id=$1`, [d("archived")]);
  await P(d("volunteer"), "Ossian Helper", { types: ["volunteer"] }); await G(d("volunteer"), 40, civilPlusDays(-15));
  await P(d("refunded"), "Rhoda Refund"); const rg = await G(d("refunded"), 60, civilPlusDays(-25));
  await G(d("refunded"), -60, civilPlusDays(-24)); await q(`UPDATE gifts SET refund_of=$1 WHERE org_id=$2 AND donor_id=$3 AND amount<0`, [rg, ORG, d("refunded")]).catch(() => {});
  const bill = (await api("GET", "/billing/status", tok)).body || {};
  const gap = (await api("GET", "/billing/records-gap", tok)).body || {};
  const tab = ((await api("GET", "/people/everyone-breakdown", tok)).body || {});
  const donorsTab = ((tab.parts || []).find(p => p.key === "donors") || {}).n;
  const records = (bill.pricing1 || bill).records;
  ok("§5 Records + marked Donor with no gift − every giver not on the tab = the Donors tab, from the tab's own count",
    records + gap.markedNoGift - gap.giftNotMarked === donorsTab && gap.records === records && gap.donorsTab === donorsTab, { records, gap, donorsTab });
  ok("§5 each part is named: 3 marked Donor with no gift (Caspar, Ines, Dov), 1 erased, 1 archived, 1 not marked Donor (the refund-only giver is on both sides)",
    gap.markedNoGift === 3 && gap.erasedGivers === 1 && gap.archivedGivers === 1 && gap.unmarkedGivers === 1, gap);
  ok("§5 and the line is the sum: \"Records N, plus 3 people marked Donor with no gift on file, minus 1 erased giver whose gifts remain, minus 1 archived giver, minus 1 giver not marked Donor, is the Donors tab's M.\"",
    gap.sentence === `Records ${records.toLocaleString("en-US")}, plus 3 people marked Donor with no gift on file, minus 1 erased giver whose gifts remain, minus 1 archived giver, minus 1 giver not marked Donor, is the Donors tab's ${donorsTab.toLocaleString("en-US")}.`, gap.sentence);

  // ── §6 the Stripe card ──────────────────────────────────────────────────────
  console.log("\n§6 the Stripe card");
  const SRC = `gs_f15_${run}`;
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,created_by,created_by_name) VALUES ($1,$2,'stripe','Stripe','active',NOW() - interval '5 days',${sys})`, [SRC, ORG]);
  for (let i = 0; i < 12; i++) await G(d("elsbeth"), 25, civilPlusDays(-3 - i * 6), i % 2 ? { source: SRC } : { stripe: `pi_f15_${run}_${i}` });
  const [orgRow] = await q(`SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=$1`, [ORG]);
  const TG = require(path.join(ROOT, "server/give/takesGifts.js"));
  const conns = (await api("GET", "/connections", tok)).body || {};
  const card = ((conns.cards || conns.connections || (Array.isArray(conns) ? conns : [])) || []).find(c => c.id === "own_stripe") || {};
  const part = k => (card.parts || []).find(p => p.key === k) || {};
  ok("§6 Take gifts on your giving pages is Off: the public page's own check says it can't take gifts (\"Not open yet\"), whatever Stripe history was read",
    TG.orgTakesGifts(orgRow) === false && part("pages").connected === false && /^Off\./.test(part("pages").sentence || "") && /Not open yet/.test(part("pages").sentence || ""), card.parts);
  ok("§6 Read your Stripe history says only that, and is On", part("history").connected === true && /^On\. Steward reads the gifts Stripe already holds onto your donor records; it last read them 5 days ago\.$/.test(part("history").sentence || "") && !/a week/.test(part("history").sentence || ""), part("history"));
  const weekly = JSON.stringify(card).match(/about [\d.]+ gifts? a week/g) || [];
  ok("§6 one weekly rate on the whole card, with its period named", new Set(weekly).size === 1 && /over the last 120 days/.test(card.sentence || ""), { weekly, sentence: card.sentence });
  ok("§6 nothing was mailed outside the sink", MAIL.every(b => /flows15\.invalid/.test(b)), MAIL.length);

  await q(`DELETE FROM campaign_recipients WHERE org_id=$1`, [ORG]).catch(() => {});
  summary();
  await closeDb();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });

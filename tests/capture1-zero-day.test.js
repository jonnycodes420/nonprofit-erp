// tests/capture1-zero-day.test.js · CAPTURE-1. NOBODY TYPES A GIFT.
//
// Money, donor data and security in one suite: a photographed check becomes a
// card and NOTHING is recorded until a person confirms; the confirm writes the
// gift exactly once, to the cent, with the image attached and a thank-you
// drafted, and sends nothing; a check QuickBooks already brought in is not
// counted twice; an attachment from somebody not in Steward stores nothing; a
// DAF letter is a gift from the fund with soft credit to the advisor; the
// check's routing and account numbers are in no column, log or audit row; and
// received_at/thanked_at make the clock line.
//
// It boots server.js IN-PROCESS (like tenant-matrix) because the model is a
// stand-in: ANTHROPIC_BASE_URL points at a local server that answers the
// read with what the test queued, as the real model would transcribe it. The
// same stand-in answers Gmail (GMAIL_API_BASE) for the mailbox leg. The
// stand-in is HOSTILE about the bank numbers: it copies the MICR line into the
// memo and adds a routing field, so the scrub is what the test proves.
//
// Planted defects that turned this red: recordGift called on upload (§1
// "nothing recorded"); scrubBank returning its input (§6); the QuickBooks
// lookup removed from confirm (§3); fromMailboxMessage called for unmatched
// mail (§4); the advisor's soft credit dropped (§5).
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
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-capture1-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;
process.env.GMAIL_API_BASE = `http://localhost:${MOCK}`;
process.env.INBOUND_EMAIL_ENABLED = "1";
process.env.INBOUND_EMAIL_DOMAIN = "log.stewardapp.dev";
process.env.INBOUND_EMAIL_SECRET = "local-inbound-secret";

// Every request this process makes to the outside, so §2 can prove nothing
// went to a mail or receipt service.
const OUTBOUND = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { OUTBOUND.push(String(url && url.url || url)); return realFetch(url, opts); };
// Every line the process writes, so §6 can search the logs too.
const LOGS = [];
for (const k of ["log", "error", "warn"]) { const o = console[k]; console[k] = (...a) => { LOGS.push(a.map(String).join(" ")); o(...a); }; }

const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { FAKE_ROUTING, FAKE_ACCOUNT, FIXTURES } = require("../scripts/capture1-make-fixtures.js");
const FX = path.join(__dirname, "fixtures", "capture1");
const dataUrl = (f, t) => `data:${t};base64,${fs.readFileSync(path.join(FX, f)).toString("base64")}`;

const ORG = "org_cap1", SLUG = "cap1-test", ADMIN = "cap1-admin@example.org", USER = "u_cap1";
const sys = "'system:test','test'";
const C1 = FIXTURES["check-1.png"], DAF = FIXTURES["daf-letter.pdf"];

// ── THE STAND-IN: the model and Gmail ─────────────────────────────────────
const queued = [];      // what the "model" will transcribe next, in order
const sentToModel = []; // every request body the server sent the model
const gmailHits = [];
const PDF_BYTES = fs.readFileSync(path.join(FX, "pledge-form.pdf"));
const b64 = s => Buffer.from(s).toString("base64url");
const GMAIL = {
  m_cap_stranger: { id: "m_cap_stranger", internalDate: String(Date.now() - 3600e3), snippet: "pledge attached",
    payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: "Stranger <stranger@nowhere.example.com>" },
      { name: "To", value: ADMIN }, { name: "Subject", value: "My pledge" }],
      parts: [{ mimeType: "text/plain", filename: "", body: { data: b64("Pledge attached.") } },
              { filename: "pledge.pdf", mimeType: "application/pdf", body: { attachmentId: "att_stranger", size: PDF_BYTES.length } }] } },
};
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (u.pathname === "/v1/messages") {
      sentToModel.push(body);
      const items = queued.shift() || [];
      return send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tu_1", name: "record_items", input: { items } }] });
    }
    let m;
    if ((m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/))) {
      gmailHits.push(req.url);
      return send(200, { size: PDF_BYTES.length, data: PDF_BYTES.toString("base64url") });
    }
    if ((m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/))) return GMAIL[m[1]] ? send(200, GMAIL[m[1]]) : send(404, {});
    if (u.pathname === "/gmail/v1/users/me/messages") return send(200, { messages: Object.keys(GMAIL).map(id => ({ id })) });
    send(200, { items: [] });
  });
});

// A check item as the model would transcribe it, with the MICR line copied
// where it never should be (the hostile half).
const blank = { kind: "other", payer: "", amountDigits: "", amountWords: "", amountStated: "", memo: "", date: "", chequeNumber: "",
  donorName: "", email: "", line1: "", city: "", state: "", postal: "", fundName: "", advisorName: "", employer: "", frequency: "",
  installments: "", startDate: "", shares: "", ticker: "", originalGiftDate: "", sentence: "" };
const checkItem = f => ({ ...blank, kind: "check", payer: f.payer, amountDigits: (f.cents / 100).toFixed(2), amountWords: f.words,
  memo: `${f.memo} ⑆${FAKE_ROUTING}⑆ ${FAKE_ACCOUNT}⑈ ${f.number}`, date: "2026-10-12", chequeNumber: f.number,
  sentence: `A check from ${f.payer}, routing ${FAKE_ROUTING}, account ${FAKE_ACCOUNT}.`, routingNumber: FAKE_ROUTING });

const TABLES = ["capture_items", "capture_batches", "capture_fund_words", "thank_you_drafts", "gift_soft_credits", "threads", "interactions",
  "fin_transactions", "gifts", "pledges", "mailbox_connections", "inbound_email_drops", "portal_assets", "tasks", "donors",
  "user_sessions", "users", "fin_funds", "accounts", "budgets", "ai_usage"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  console.log("capture1-zero-day (CAPTURE-1)");
  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await new Promise(r => setTimeout(r, 3500));   // boot DDL settles
  await reset();

  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Capture One',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, ADMIN, pw]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_cap1_gen',$1,'General Operating',false),('f_cap1_bld',$1,'Building Fund',true)`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id='f_cap1_gen' WHERE id=$1`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,address,zip,stage,person_types,created_by,created_by_name) VALUES
           ('d_cap1_marg',$1,'Margaret A. Lindqvist','margaret@example.org','18 Alder Lane','04102','active','["donor"]'::jsonb,${sys}),
           ('d_cap1_fund',$1,'Example Charitable Gift Fund',NULL,NULL,NULL,'active','["organization"]'::jsonb,${sys}),
           ('d_cap1_james',$1,'James Whitford','james@example.org',NULL,NULL,'active','["donor"]'::jsonb,${sys})`, [ORG]);
  const tok = await login(ADMIN);
  ok("fixture admin signed in", !!tok, tok);

  // ── §1 a photographed check is one card, and nothing is recorded ─────────
  console.log("\n§1 the check becomes a card");
  queued.push([checkItem(C1)]);
  const up = await api("POST", "/capture/upload", tok, { files: [{ name: "check-1.png", dataUrl: dataUrl("check-1.png", "image/png") }], source: "photo" });
  const card = up.body && up.body.cards && up.body.cards[0];
  ok("§1 one check, one card", up.status === 201 && up.body.cards.length === 1 && card.kind === "check", up.body);
  ok("§1 the card has the amount to the cent (figures and words agree) and the donor by the printed name",
    !!card && card.amount.cents === C1.cents && card.amount.settled === true && card.donor.state === "matched"
    && card.donor.selectedId === "d_cap1_marg" && card.donor.by === "printed_name", card && { amount: card.amount, donor: card.donor });
  ok("§1 the memo names the Building Fund, so it is proposed, not unsure", !!card && card.fund.id === "f_cap1_bld" && card.fund.unsure === false, card && card.fund);
  ok("§1 the image is stored private and served only by a signed link", !!card && /\/person-photos\/pa_[a-f0-9]+\?e=\d+&s=/.test(card.fileUrl || ""), card && card.fileUrl);
  const [g0] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  const [d0] = await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1`, [ORG]);
  ok("§1 nothing is recorded until confirm: no gift, no draft", g0.n === 0 && d0.n === 0, { g0, d0 });
  const sent0 = sentToModel[0] || "";
  ok("§1 the model was sent the image and the instruction, and no donor or org name", /"type":"image"/.test(sent0) && !/Lindqvist|Capture One/.test(sent0), sent0.slice(0, 200));

  // ── §2 confirm: one gift, to the cent, image attached, a draft, nothing sent
  console.log("\n§2 confirm");
  const outBefore = OUTBOUND.length;
  const conf = await api("POST", `/capture/${card.id}/confirm`, tok, { amountCents: card.amount.cents, date: "2026-10-12",
    donorId: card.donor.selectedId, fundId: card.fund.id, kind: "check" });
  ok("§2 confirm answers with the gift and a sentence", conf.status === 200 && !!conf.body.giftId && /Logged \$250\.00/.test(conf.body.sentence), conf.body);
  const again = await api("POST", `/capture/${card.id}/confirm`, tok, { amountCents: card.amount.cents, date: "2026-10-12",
    donorId: card.donor.selectedId, fundId: card.fund.id, kind: "check" });
  ok("§2 a second tap records nothing more", again.status === 404, again.status);
  const gifts = await q(`SELECT id, amount::text AS amount, fund_id, cheque_asset_id, check_number, payment_method, received_at FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§2 the gift exists once, to the cent, to the Building Fund, paid by check", gifts.length === 1 && gifts[0].amount === "250.00"
    && gifts[0].fund_id === "f_cap1_bld" && gifts[0].payment_method === "Check" && gifts[0].check_number === C1.number, gifts);
  const [cardRow] = await q(`SELECT asset_id, status, gift_id FROM capture_items WHERE id=$1`, [card.id]);
  ok("§2 the image is attached to the gift and kept as evidence", !!gifts[0] && gifts[0].cheque_asset_id === cardRow.asset_id && cardRow.status === "confirmed"
    && cardRow.gift_id === gifts[0].id, { gift: gifts[0], cardRow });
  const drafts = await q(`SELECT id, gift_id, sent_at FROM thank_you_drafts WHERE org_id=$1`, [ORG]);
  ok("§2 a thank-you draft exists for the gift, not sent", drafts.length === 1 && drafts[0].gift_id === gifts[0].id && !drafts[0].sent_at
    && conf.body.thankYouDraftId === drafts[0].id, drafts);
  const [rc] = await q(`SELECT COUNT(*)::int AS n FROM receipts WHERE org_id=$1`, [ORG]);
  const outAfter = OUTBOUND.slice(outBefore).filter(u => !u.startsWith(process.env.BASE) && !u.startsWith(process.env.ANTHROPIC_BASE_URL));
  ok("§2 nothing was sent to anyone: no receipt, no request out of this process", rc.n === 0 && outAfter.length === 0 && conf.body.receipt === "off",
    { rc, outAfter, receipt: conf.body.receipt });
  ok("§2 received_at is set and not in the future", !!gifts[0].received_at && new Date(gifts[0].received_at) <= new Date(), gifts[0].received_at);

  // ── §3 the same check also read from QuickBooks is not counted twice ─────
  console.log("\n§3 QuickBooks");
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ('d_cap1_hol',$1,'Hollis Tran','hollis@example.org','active',${sys})`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,external_id,read_from_vendor,created_by,created_by_name)
           VALUES ('g_cap1_qbo',$1,'d_cap1_hol',75.00,'2026-10-13','cash','f_cap1_gen','Check','qbo:9130:SalesReceipt:77:1','quickbooks',${sys})`, [ORG]);
  queued.push([{ ...checkItem(FIXTURES["check-3.png"]), payer: "Hollis Tran", amountDigits: "75.00", amountWords: "Seventy-five and 00/100", memo: "" }]);
  const up3 = await api("POST", "/capture/upload", tok, { files: [{ name: "check-3.png", dataUrl: dataUrl("check-3.png", "image/png") }] });
  const c3 = up3.body.cards && up3.body.cards[0];
  ok("§3 the check reads as Hollis Tran's $75.00", !!c3 && c3.amount.cents === 7500 && c3.donor.selectedId === "d_cap1_hol", c3 && { a: c3.amount, d: c3.donor });
  const conf3 = await api("POST", `/capture/${c3.id}/confirm`, tok, { amountCents: 7500, date: "2026-10-12", donorId: "d_cap1_hol", fundId: "f_cap1_gen", kind: "check" });
  const hol = await q(`SELECT id, cheque_asset_id FROM gifts WHERE org_id=$1 AND donor_id='d_cap1_hol'`, [ORG]);
  ok("§3 confirm finds the QuickBooks gift and records no second one", conf3.status === 200 && conf3.body.duplicateOf === "g_cap1_qbo" && hol.length === 1, { body: conf3.body, hol });
  ok("§3 the image is attached to the gift QuickBooks brought in", !!hol[0] && !!hol[0].cheque_asset_id, hol);

  // ── §4 an email attachment from somebody not in Steward stores nothing ───
  console.log("\n§4 email from a stranger");
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,created_by,created_by_name)
           VALUES ('mbx_cap1',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',${sys})`, [ORG, USER, ADMIN, sealed]);
  const [a0] = await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1`, [ORG]);
  const [k0] = await q(`SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=$1`, [ORG]);
  const sync = await api("POST", "/mailbox/google/sync", tok, { what: "mail" });
  ok("§4 the mailbox read ran", sync.status === 200, `${sync.status} ${sync.text}`);
  const [a1] = await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1`, [ORG]);
  const [k1] = await q(`SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=$1`, [ORG]);
  const [st] = await q(`SELECT (SELECT COUNT(*) FROM interactions WHERE org_id=$1 AND row_to_json(interactions)::text ILIKE '%stranger%')
                             + (SELECT COUNT(*) FROM capture_items WHERE org_id=$1 AND row_to_json(capture_items)::text ILIKE '%stranger%') AS n`, [ORG]);
  ok("§4 nothing stored: no card, no file, no line", k1.n === k0.n && a1.n === a0.n && Number(st.n) === 0, { k0, k1, a0, a1, st });
  ok("§4 the attachment was never even fetched", !gmailHits.length, gmailHits);
  // The forward address: somebody not on the staff gets nothing stored either.
  const fwd = await fetch(`${process.env.BASE}/inbound-email?secret=local-inbound-secret`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "stranger@nowhere.example.com", to: `capture+${SLUG}@log.stewardapp.dev`, subject: "a pledge", text: "see attached",
      attachments: [{ filename: "pledge.pdf", content_type: "application/pdf", content: PDF_BYTES.toString("base64") }] }) });
  const fwdBody = await fwd.json().catch(() => ({}));
  const [k2] = await q(`SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=$1`, [ORG]);
  const [a2] = await q(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE org_id=$1`, [ORG]);
  ok("§4 a forward from a non-staff sender is dropped with nothing stored", fwd.status === 200 && fwdBody.action === "drop" && k2.n === k1.n && a2.n === a1.n, { fwdBody, k2, a2 });

  // ── §5 a DAF letter: a gift from the fund, soft credit to the advisor ────
  console.log("\n§5 DAF letter");
  queued.push([{ ...blank, kind: "daf_grant", payer: DAF.fundOrg, donorName: DAF.fundOrg, amountStated: "$2,000.00", date: "2026-10-09",
    advisorName: DAF.advisorName, fundName: DAF.fundName, sentence: `A grant from ${DAF.fundOrg} recommended by ${DAF.advisorName}.` }]);
  const fwdDaf = await fetch(`${process.env.BASE}/inbound-email?secret=local-inbound-secret`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: ADMIN, to: `capture+${SLUG}@log.stewardapp.dev`, subject: "Fwd: grant letter", text: "forwarding",
      attachments: [{ filename: "daf-letter.pdf", content_type: "application/pdf", content: fs.readFileSync(path.join(FX, "daf-letter.pdf")).toString("base64") }] }) });
  const fwdDafBody = await fwdDaf.json().catch(() => ({}));
  ok("§5 the forwarded letter from staff becomes one card", fwdDaf.status === 200 && fwdDafBody.action === "capture" && fwdDafBody.cards === 1, fwdDafBody);
  const list = await api("GET", "/capture", tok);
  const dc = (list.body.waiting || []).find(c => c.kind === "daf_grant");
  ok("§5 the card: from the fund, $2,000.00, advisor matched, General Operating", !!dc && dc.donor.selectedId === "d_cap1_fund" && dc.amount.cents === 200000
    && dc.advisor && dc.advisor.selectedId === "d_cap1_james" && dc.fund.id === "f_cap1_gen" && dc.source === "forward", dc);
  const cd = await api("POST", `/capture/${dc.id}/confirm`, tok, { amountCents: 200000, date: "2026-10-09", donorId: "d_cap1_fund",
    fundId: "f_cap1_gen", kind: "daf_grant", advisorDonorId: "d_cap1_james" });
  const [dg] = await q(`SELECT id, donor_id, amount::text AS amount FROM gifts WHERE org_id=$1 AND id=$2`, [ORG, cd.body.giftId || ""]);
  const sc = await q(`SELECT donor_id, amount::text AS amount, role FROM gift_soft_credits WHERE org_id=$1 AND gift_id=$2`, [ORG, cd.body.giftId || ""]);
  ok("§5 the gift is from the fund, $2,000.00", cd.status === 200 && !!dg && dg.donor_id === "d_cap1_fund" && dg.amount === "2000.00", { body: cd.body, dg });
  ok("§5 the advisor has the soft credit, and only the soft credit", sc.length === 1 && sc[0].donor_id === "d_cap1_james" && sc[0].amount === "2000.00"
    && (await q(`SELECT 1 FROM gifts WHERE org_id=$1 AND donor_id='d_cap1_james'`, [ORG])).length === 0, sc);

  // ── §6 the routing and account numbers are nowhere ──────────────────────
  console.log("\n§6 bank numbers");
  const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const hits = [];
  for (const { table_name: t } of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n FROM "${t}" x WHERE x::text LIKE $1 OR x::text LIKE $2`, [`%${FAKE_ROUTING}%`, `%${FAKE_ACCOUNT}%`]).catch(() => [{ n: 0 }]);
    if (r.n) hits.push(`${t}: ${r.n}`);
  }
  ok("§6 no column of any table (audit log included) holds the routing or account number", hits.length === 0, hits);
  ok("§6 the model really did hand them over (the scrub is what kept them out)", sentToModel.length >= 2 && queued.length === 0, sentToModel.length);
  const logHits = LOGS.filter(l => l.includes(FAKE_ROUTING) || l.includes(FAKE_ACCOUNT));
  ok("§6 and no log line of this process", logHits.length === 0, logHits.slice(0, 3));
  ok("§6 the check number survived the scrub", !!(await q(`SELECT 1 FROM capture_items WHERE id=$1 AND read->>'chequeNumber'=$2`, [card.id, C1.number]))[0], "lost");

  // ── §7 received_at and thanked_at make the clock line ───────────────────
  console.log("\n§7 the clock");
  await q(`UPDATE gifts SET received_at = NOW() - INTERVAL '3 days', thanked_at = NOW() - INTERVAL '1 day' WHERE org_id=$1 AND id=$2`, [ORG, gifts[0].id]);
  const sent = await api("POST", `/thank-yous/${drafts[0].id}/sent`, tok, {});
  const [gt] = await q(`SELECT thanked_at FROM gifts WHERE id=$1`, [gifts[0].id]);
  ok("§7 sending the thank-you keeps the first thanked time", sent.status === 200 && !!gt.thanked_at, { s: sent.status, gt });
  await q(`UPDATE gifts SET received_at = NOW() - INTERVAL '5 days', thanked_at = NOW() - INTERVAL '4 days' WHERE org_id=$1 AND id=$2`, [ORG, dg.id]);
  const clock = await api("GET", "/thank-yous/clock", tok);
  ok("§7 two thanked gifts, 2 days and 1 day: the line says 1.5 days", clock.status === 200 && clock.body.count === 2 && clock.body.days === 1.5
    && clock.body.sentence === "Average time from gift to thank-you, last 30 days: 1.5 days", clock.body);
  const fig = await api("GET", "/figures/gift-to-thanked/rows", tok);
  ok("§7 the number opens its gifts, slowest first, and is their mean", fig.status === 200 && fig.body.value === 1.5 && fig.body.rows.length === 2
    && fig.body.rows[0].id === gifts[0].id && fig.body.rows[0].amount === 2 && fig.body.rows[1].amount === 1, fig.body && { v: fig.body.value, rows: fig.body.rows });

  // ── §8 AI off: the card still appears, the image beside an empty form ───
  console.log("\n§8 AI off");
  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [ORG]);
  const before = sentToModel.length;
  const off = await api("POST", "/capture/upload", tok, { files: [{ name: "check-2.png", dataUrl: dataUrl("check-2.png", "image/png") }] });
  const oc = off.body.cards && off.body.cards[0];
  ok("§8 a card with the image, an empty amount and the AI-off sentence; the model was not called", off.status === 201 && !!oc && !!oc.fileUrl
    && oc.amount.cents === null && oc.ai === "off" && /AI is off/.test(oc.sentence) && sentToModel.length === before, oc);

  mock.close();
  await reset();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });

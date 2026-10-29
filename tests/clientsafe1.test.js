// tests/clientsafe1.test.js · CLIENT-SAFE-1. THE ONE GUARD THIS BUILD EARNED.
//
//     WITH PRIVACY MODE ON, A PERSON MARKED AS A CLIENT IS NEVER FETCHED AND
//     NEVER STORED, AND A HEALTH DETAIL IN ANYONE'S EMAIL IS NEVER STORED.
//
// WHAT IS ASSERTED:
//   §1  privacy on: a client's own message is never fetched (no request names
//       it), a message with a client copied in is read for its addresses only
//       and never fetched whole, and nothing about either is stored
//   §2  an email to a donor naming a diagnosis keeps the rest of the email and
//       the neutral line, and the diagnosis is in no table and no log line
//   §3  the BCC address drops a message to a client; Tell Steward refuses a
//       memo about one and keeps nothing
//   §4  the client's gifts and thank-yous work exactly as before
//   §5  AI off: new email stores the date, direction, people and subject only
//   §6  privacy off: an identical org captures exactly as today (the client
//       message is fetched and logged, the health sentence is kept), and email
//       already logged can be removed in one step and put back
//   §7  the uploaded list matches people on file and never creates one, and
//       Undo restores
//   §8  one org's setting never touches another's, an admin alone changes it,
//       and the super-admin's change is in that org's audit log as Steward support
//
// HOW IT WOULD GO RED: search for a client's address, fetch a message before
// checking its addresses, store the body before the screen, or read the
// setting without the org. Proven able to fail: on main every section is red
// (no setting, no screen); removing the address pre-check turns §1 red, and
// storing decision.body unscreened turns §2 red.
//
// Boots server.js in-process with a stand-in Gmail and model on one port.
"use strict";

const http = require("http");
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
process.env.ANTHROPIC_API_KEY = "sk-ant-clientsafe1-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;
process.env.GMAIL_API_BASE = `http://localhost:${MOCK}`;
process.env.INBOUND_EMAIL_ENABLED = "1";
process.env.INBOUND_EMAIL_DOMAIN = "log.stewardapp.dev";
process.env.INBOUND_EMAIL_SECRET = "local-inbound-secret";

const LOGS = [];
for (const k of ["log", "error", "warn", "info"]) { const o = console[k]; console[k] = (...a) => { LOGS.push(a.map(String).join(" ")); o(...a); }; }

const { ok, summary, login, api, q, closeDb, waitFor } = require("./helpers");
const { testNow } = require("./clock");

const A = "org_cs1a", B = "org_cs1b", C = "org_cs1c";
const ORGS = [A, B, C];
const sys = "'system:test','test'";
// What must never be stored in org A, and what org B (setting off) must keep.
const SECRET_A = "Kessler-Varga syndrome";
const SECRET_B = "Ostrander-Bell syndrome";
const AI_OFF_BODY = "PLUM-RIVER the whole body must not be kept";
const CLIENT_SUBJECT = "Hazel's riding session and her new medication";
const em = (who, o) => `${who}@${o}.example`;

const b64 = s => Buffer.from(s).toString("base64url");
const msg = (id, from, to, cc, subject, text) => ({ id, threadId: "t_" + id, internalDate: String(testNow() - 3600e3), labelIds: ["INBOX"],
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: to }, ...(cc ? [{ name: "Cc", value: cc }] : []),
    { name: "Subject", value: subject }], body: { data: b64(text) } } });
const healthBody = secret => `Thank you so much for the barn tour on Saturday. My son was diagnosed with ${secret} last month and starts a new medication on Monday. We would love to sponsor a horse this spring.`;
const BOXES = {};
for (const [o, secret] of [[A, SECRET_A], [B, SECRET_B]]) BOXES["tok_" + o] = {
  [`m_${o}_client`]: msg(`m_${o}_client`, em("rosa", o), em("dana", o), null, CLIENT_SUBJECT, "She had a rough week after the seizure."),
  [`m_${o}_mixed`]: msg(`m_${o}_mixed`, em("marion", o), em("dana", o), em("rosa", o), "Carpool for the riders", "Rosa asked about the carpool."),
  [`m_${o}_health`]: msg(`m_${o}_health`, em("marion", o), em("dana", o), null, "Thank you for Saturday", healthBody(secret)),
};
BOXES["tok_" + C] = { [`m_${C}_health`]: msg(`m_${C}_health`, em("marion", C), em("dana", C), null, "Lunch next week", AI_OFF_BODY) };

const HITS = [];   // { tok, path, format, q }
const MODEL = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (u.pathname === "/v1/messages") {
      MODEL.push(body);
      const j = JSON.parse(body || "{}");
      const text = JSON.stringify(j.messages || []);
      const quotes = [SECRET_A, SECRET_B].filter(s => text.includes(s)).map(s => `My son was diagnosed with ${s} last month and starts a new medication on Monday.`);
      return send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-haiku-4-5", stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name: "health_details", input: { quotes } }] });
    }
    const tok = String(req.headers.authorization || "").replace(/^Bearer /, "");
    const box = BOXES[tok] || {};
    HITS.push({ tok, path: u.pathname, format: u.searchParams.get("format"), q: u.searchParams.get("q") || "" });
    if (u.pathname === "/gmail/v1/users/me/profile") return send(200, { historyId: "100" });
    if (u.pathname === "/gmail/v1/users/me/messages") {
      // Gmail's search: a message is returned when one of its addresses is asked for.
      const asked = (u.searchParams.get("q") || "").toLowerCase();
      const ids = Object.values(box).filter(m => m.payload.headers.filter(h => /^(from|to|cc)$/i.test(h.name))
        .some(h => h.value.split(",").some(a => asked.includes(a.trim().toLowerCase())))).map(m => ({ id: m.id }));
      return send(200, { messages: ids });
    }
    const m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
    if (m && box[m[1]]) {
      const full = box[m[1]];
      if (u.searchParams.get("format") === "metadata")
        return send(200, { id: full.id, payload: { headers: full.payload.headers.filter(h => /^(from|to|cc)$/i.test(h.name)) } });
      return send(200, full);
    }
    send(404, {});
  });
});

const TABLES = ["privacy_holds", "client_marks", "client_email_removals", "voice_memos", "thank_you_drafts", "threads", "interactions",
  "gifts", "fin_transactions", "mailbox_sync_runs", "mailbox_connections", "inbound_email_drops", "inbound_email_unmatched",
  "fin_audit_log", "ai_usage", "ai_fallbacks", "tasks", "donors", "user_sessions", "users", "fin_funds", "accounts"];
async function reset() {
  for (const o of ORGS) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`DELETE FROM users WHERE id='u_cs1_super'`).catch(() => {});
}
const json = v => (typeof v === "string" ? JSON.parse(v) : v) || {};

(async () => {
  console.log("clientsafe1 (CLIENT-SAFE-1)");
  await new Promise(r => mock.listen(MOCK, r));
  require("../server.js");
  await require("./helpers").untilReady();   // FIX-57: the server says when boot is done
  await reset();

  const pw = bcrypt.hashSync("loadtest1234", 4);
  const { sealBag } = await import("../shared/secretBox.js");
  for (const o of ORGS) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),false)`, [o, `Client Safe ${o}`, `cs1-${o.slice(-1)}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${o}`, o, em("dana", o), pw]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sam Okafor','member')`, [`u_${o}_m`, o, em("sam", o), pw]);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES
             ($2,$1,'Marion Reed',$3,'active',${sys}), ($4,$1,'Rosa Delgado',$5,'active',${sys})`,
      [o, `d_${o}_marion`, em("marion", o), `d_${o}_rosa`, em("rosa", o)]);
    await q(`UPDATE donors SET is_client=true WHERE id=$1`, [`d_${o}_rosa`]);
    const sealed = sealBag({ accessToken: "tok_" + o, refreshToken: "ref_" + o, scope: null }, { aad: o });
    await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,created_by,created_by_name)
             VALUES ($1,$2,$3,'google',$4,'active',$5,NOW() + INTERVAL '1 day',${sys})`, ["mbx_" + o, o, `u_${o}`, em("dana", o), sealed]);
  }
  await q(`UPDATE orgs SET ai_enabled=false WHERE id=$1`, [C]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_cs1_super',$1,'support@cs1.example',$2,'Support','admin',true)`, [B, pw]);
  const tokA = await login(em("dana", A)), tokB = await login(em("dana", B)), tokC = await login(em("dana", C));
  const tokAm = await login(em("sam", A)), tokSuper = await login("support@cs1.example");
  ok("fixture admins signed in", !!(tokA && tokB && tokC && tokAm && tokSuper));

  // Off by default; only an admin turns it on.
  const p0 = await api("GET", "/privacy", tokA);
  ok("§8 off by default, with the setting's own words", p0.status === 200 && p0.body.on === false
    && p0.body.label === "We serve clients whose details are private" && !/HIPAA/i.test(JSON.stringify(p0.body)), p0.body);
  const byMember = await api("PUT", "/privacy", tokAm, { on: true });
  ok("§8 a member cannot turn it on", byMember.status === 403, byMember.status);
  const onA = await api("PUT", "/privacy", tokA, { on: true });
  const onC = await api("PUT", "/privacy", tokC, { on: true });
  ok("§8 the admin turns it on", onA.status === 200 && onA.body.on === true && onC.body.on === true, onA.body);
  const [audA] = await q(`SELECT action, entity_type FROM fin_audit_log WHERE org_id=$1 AND entity_type='org setting' ORDER BY created_at DESC LIMIT 1`, [A]);
  ok("§8 the change is in the audit log", !!audA && /turned on/.test(audA.action), audA);
  const pB = await api("GET", "/privacy", tokB);
  ok("§8 org B is untouched by org A's setting", pB.body.on === false, pB.body);

  // ── §1/§2 privacy on: the mailbox read ───────────────────────────────────
  console.log("\n§1 a client is never fetched");
  HITS.length = 0;
  const sA = await api("POST", "/mailbox/google/sync", tokA, { what: "mail" });
  ok("§1 the read ran", sA.status === 200, `${sA.status} ${sA.text}`);
  const hitsA = HITS.filter(h => h.tok === "tok_" + A);
  ok("§1 no search names the client's address", hitsA.filter(h => h.q).length > 0 && hitsA.every(h => !h.q.toLowerCase().includes(em("rosa", A))), hitsA.map(h => h.q));
  ok("§1 the client's own message is never asked for at all", !hitsA.some(h => h.path.includes(`m_${A}_client`)), hitsA.map(h => h.path));
  ok("§1 the message with the client copied in is read for its addresses only, never fetched whole",
    hitsA.some(h => h.path.endsWith(`m_${A}_mixed`) && h.format === "metadata") && !hitsA.some(h => h.path.endsWith(`m_${A}_mixed`) && h.format === "full"),
    hitsA.filter(h => h.path.includes("mixed")));
  const ixA = await q(`SELECT donor_id, note, metadata FROM interactions WHERE org_id=$1`, [A]);
  ok("§1 nothing about the client is stored: no row on her, no subject, no carpool message",
    !ixA.some(r => r.donor_id === `d_${A}_rosa`) && !JSON.stringify(ixA).includes("Hazel") && !JSON.stringify(ixA).includes("Carpool"), ixA);

  console.log("\n§2 a diagnosis is held back, the rest is kept");
  const health = ixA.find(r => json(r.metadata).message_id === `m_${A}_health`);
  ok("§2 the email to the donor is stored with the rest of its words and the neutral line",
    !!health && /sponsor a horse this spring/.test(health.note) && /Thank you so much for the barn tour/.test(health.note)
    && health.note.includes("Mentioned a health matter. Open it in your mailbox.") && json(health.metadata).held_back === "health", health);
  const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const where = [];
  for (const { table_name: t } of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n FROM "${t}" x WHERE x::text ILIKE $1`, [`%${SECRET_A}%`]).catch(() => [{ n: 0 }]);
    if (r.n) where.push(t);
  }
  ok("§2 the diagnosis is in no table", where.length === 0, where);
  ok("§2 and in no log line", !LOGS.some(l => l.includes(SECRET_A)), LOGS.filter(l => l.includes(SECRET_A)).slice(0, 2));
  const [holds] = await q(`SELECT COUNT(*)::int AS n FROM privacy_holds WHERE org_id=$1 AND kind='health'`, [A]);
  const pA = await api("GET", "/privacy", tokA);
  ok("§2 the hold is counted, and the Connections line says so",
    holds.n === 1 && pA.body.line === "Privacy mode is on. 1 person marked as a client is never brought in. 1 health detail held back this month.", { holds, line: pA.body.line });
  const heldList = await api("GET", "/privacy/held", tokA);
  ok("§2 the held list names who and when, never what", heldList.status === 200 && heldList.body.rows.length === 1
    && !JSON.stringify(heldList.body).includes(SECRET_A) && !/medication|diagnos/i.test(JSON.stringify(heldList.body.rows)), heldList.body);

  // ── §3 the BCC address and Tell Steward ──────────────────────────────────
  console.log("\n§3 BCC and Tell Steward");
  const bcc = await fetch(`${process.env.BASE}/inbound-email?secret=local-inbound-secret`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: [`log+cs1-a@log.stewardapp.dev`, em("rosa", A)], from: em("dana", A), subject: CLIENT_SUBJECT, text: "Checking in about Hazel." }) });
  const bccBody = await bcc.json();
  const ixA2 = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [A, `d_${A}_rosa`]);
  const [unm] = await q(`SELECT COUNT(*)::int AS n FROM inbound_email_unmatched WHERE org_id=$1`, [A]);
  ok("§3 the BCC address drops a message to a client and stores nothing of it", bccBody.action === "drop" && ixA2[0].n === 0 && unm.n === 0, { bccBody, ixA2, unm });
  const memo = await api("POST", "/voice/memos", tokA, { text: "Had coffee with Rosa, she wants to help with the spring clinic.", donorId: `d_${A}_rosa` });
  const [vm] = await q(`SELECT COUNT(*)::int AS n FROM voice_memos WHERE org_id=$1`, [A]);
  ok("§3 Tell Steward won't log a memo about a client, says so, and keeps nothing",
    memo.status === 409 && memo.body.sentence === "Rosa Delgado is marked as a client, so Steward won't log a memo about them." && vm.n === 0, { memo: memo.body, vm });

  // ── §4 gifts and thank-yous ──────────────────────────────────────────────
  console.log("\n§4 her gifts still work");
  const gift = await api("POST", `/donors/d_${A}_rosa/gifts`, tokA, { amount: 150, date: "2026-10-12", type: "cash" });
  const [g] = await q(`SELECT id, amount::text AS amount FROM gifts WHERE org_id=$1 AND donor_id=$2`, [A, `d_${A}_rosa`]);
  const [ty] = await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [A, `d_${A}_rosa`]);
  ok("§4 a gift for a client records, to the cent, with its thank-you draft", gift.status < 300 && !!g && g.amount === "150.00" && ty.n === 1, { status: gift.status, g, ty });

  // ── §5 AI off ────────────────────────────────────────────────────────────
  console.log("\n§5 AI off");
  const modelBefore = MODEL.length;
  const sC = await api("POST", "/mailbox/google/sync", tokC, { what: "mail" });
  const [ixC] = await q(`SELECT note, metadata FROM interactions WHERE org_id=$1`, [C]);
  ok("§5 new email keeps the date, direction, people and subject, and not the body",
    sC.status === 200 && !!ixC && /Lunch next week/.test(ixC.note) && !ixC.note.includes("PLUM-RIVER") && json(ixC.metadata).metadata_only === true
    && !MODEL.slice(modelBefore).some(b => b.includes("PLUM-RIVER")), ixC);
  const pC = await api("GET", "/privacy", tokC);
  ok("§5 the Connections card says Steward can't check", /can't check email for health details/.test(pC.body.aiOffSentence || ""), pC.body);

  // ── §6 privacy off: exactly as today ─────────────────────────────────────
  console.log("\n§6 setting off");
  HITS.length = 0;
  const sB = await api("POST", "/mailbox/google/sync", tokB, { what: "mail" });
  const ixB = await q(`SELECT id, donor_id, note, metadata FROM interactions WHERE org_id=$1`, [B]);
  const hitsB = HITS.filter(h => h.tok === "tok_" + B);
  ok("§6 the client's message is fetched and logged, as before", sB.status === 200
    && hitsB.some(h => h.path.endsWith(`m_${B}_client`) && h.format === "full") && ixB.some(r => r.donor_id === `d_${B}_rosa` && /Hazel/.test(r.note)), ixB.map(r => r.note));
  ok("§6 the health sentence is kept, as before, and the model is never asked",
    ixB.some(r => r.note.includes(SECRET_B)) && !ixB.some(r => r.note.includes("Mentioned a health matter")) && !MODEL.some(b => b.includes(SECRET_B)), ixB.map(r => r.note));
  const rosaB = ixB.filter(r => r.donor_id === `d_${B}_rosa`).length;
  const rm = await api("POST", `/donors/d_${B}_rosa/client-email/remove`, tokB, {});
  const [left] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [B, `d_${B}_rosa`]);
  ok("§6 email already logged for her is removed in one step", rm.status === 200 && rm.body.removed === rosaB && rosaB >= 2 && left.n === 0, { rm: rm.body, rosaB, left });
  const crossUndo = await api("POST", `/privacy/removals/${rm.body.removalId}/undo`, tokA, {});
  const back = await api("POST", `/privacy/removals/${rm.body.removalId}/undo`, tokB, {});
  const [again] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [B, `d_${B}_rosa`]);
  ok("§6 Undo puts it back, and only from its own org", crossUndo.status === 404 && back.status === 200 && again.n === rosaB, { crossUndo: crossUndo.status, back: back.body, again });

  // ── §7 the uploaded list ─────────────────────────────────────────────────
  console.log("\n§7 the uploaded list");
  const [before] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [A]);
  const rows = [{ name: "Marion Reed", email: em("marion", A) }, { name: "Nobody On File", email: "nobody@nowhere.example" }, { name: "Rosa Delgado", email: "" }];
  const prev = await api("POST", "/privacy/clients/upload", tokA, { rows });
  const [m0] = await q(`SELECT is_client FROM donors WHERE id=$1`, [`d_${A}_marion`]);
  ok("§7 the preview matches people on file and changes nothing", prev.status === 200 && prev.body.matched.length === 2 && prev.body.unmatched === 1
    && m0.is_client === false, prev.body);
  const applied = await api("POST", "/privacy/clients/upload", tokA, { rows, apply: true });
  const [after] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [A]);
  const [m1] = await q(`SELECT is_client FROM donors WHERE id=$1`, [`d_${A}_marion`]);
  ok("§7 applying marks only the newly matched person and creates nobody",
    applied.status === 200 && applied.body.marked === 1 && after.n === before.n && m1.is_client === true, { applied: applied.body, before, after });
  const crossMark = await api("POST", `/privacy/marks/${applied.body.markId}/undo`, tokB, {});
  const und = await api("POST", `/privacy/marks/${applied.body.markId}/undo`, tokA, {});
  const [m2] = await q(`SELECT is_client FROM donors WHERE id=$1`, [`d_${A}_marion`]);
  const [r2] = await q(`SELECT is_client FROM donors WHERE id=$1`, [`d_${A}_rosa`]);
  ok("§7 Undo restores exactly what it changed, and another org cannot undo it",
    crossMark.status === 404 && und.status === 200 && m2.is_client === false && r2.is_client === true, { crossMark: crossMark.status, und: und.body, m2, r2 });
  const crossFlag = await api("POST", `/donors/d_${A}_marion/client`, tokB, { on: true });
  ok("§8 org B cannot flag org A's person", crossFlag.status === 404, crossFlag.status);

  // ── §8 the super-admin's switch ──────────────────────────────────────────
  console.log("\n§8 Steward support");
  const notSuper = await api("POST", `/admin/orgs/${B}/privacy`, tokA, { on: true });
  ok("§8 an org admin cannot use the support switch", notSuper.status === 403, notSuper.status);
  const sup = await api("POST", `/admin/orgs/${B}/privacy`, tokSuper, { on: true });
  // The audit row is written when the response finishes, so it can land a
  // moment after the answer reaches the test: wait for it, briefly.
  const audB = await waitFor(async () => (await q(`SELECT org_id, user_name AS actor_name, action FROM fin_audit_log WHERE org_id=$1 AND entity_type='org setting' ORDER BY created_at DESC LIMIT 1`, [B]))[0], { timeout: 3000 });
  const pA2 = await api("GET", "/privacy", tokA);
  ok("§8 support turns it on for that org, recorded in that org's log as Steward support",
    sup.status === 200 && sup.body.on === true && !!audB && audB.actor_name === "Steward support" && /turned on/.test(audB.action), { sup: sup.status, audB });
  ok("§8 and no other org moved", pA2.body.on === true && (await api("GET", "/privacy", tokC)).body.on === true, pA2.body);

  await reset();
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });

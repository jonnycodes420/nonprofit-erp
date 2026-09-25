// THE PERMANENT MAIL BLOCK (mailBlock.js, 2026-09-24).
//
// hello@justinsplaceky.com must never receive mail from Steward, from any org,
// for any reason, until Jonathan removes it himself. This suite PLANTS sends
// to it through real routes and asserts nothing leaves:
//
//   §1  the address is on the list, by name (removing it is a deliberate edit
//       to this file and mailBlock.js together);
//   §2  every spelling of the same mailbox is the same mailbox;
//   §3  every place mail can leave checks it: the client proxy, the donor gate,
//       the ops alert and the MiGulfCoast router (read from source);
//   §4  a staff invite to it leaves nothing at the sink, while a control
//       invite to an ordinary address DOES arrive (the sink is listening);
//   §5  a donor receipt to it leaves nothing, and says why;
//   §6  every refusal is written to email_log as "blocked".
//
// Standard scratch stack (tests/README.md). Starts its own capturing sink on
// SINK_PORT, the port the server's RESEND_BASE_URL points at.

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");
const MB = require("../mailBlock");

const ORG = "org_mailblock";
const PW = "loadtest1234";
const BLOCKED = "hello@justinsplaceky.com";

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        try { captured.push(JSON.parse(b || "{}")); } catch { captured.push({ raw: b }); }
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "sunk" }));
      });
    });
    srv.once("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const recipientsOf = m => [m.to, m.cc, m.bcc].flat().filter(Boolean).map(r => MB.bareAddress(r));
const sentTo = addr => captured.some(m => recipientsOf(m).includes(addr));
const settle = () => new Promise(r => setTimeout(r, 1500));

async function reset() {
  for (const t of ["email_log", "receipts", "fin_transactions", "interactions", "gifts", "threads", "tasks", "thank_you_drafts",
                   "workflow_runs", "invites", "donors", "users", "budgets", "accounts", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  // A send with no tenant (an invite can be one) logs org_id NULL, so the
  // per-org sweep above cannot clear it. Scratch database only.
  await q(`DELETE FROM email_log WHERE recipient_domain='justinsplaceky.com'`).catch(() => {});
}

(async () => {
  console.log("mail-block");

  // ── §1 · the list ────────────────────────────────────────────────────────
  ok("§1 hello@justinsplaceky.com is on the permanent block list", MB.BLOCKED_ADDRESSES.includes(BLOCKED));
  ok("§1 …and the list cannot be changed at runtime", Object.isFrozen(MB.BLOCKED_ADDRESSES));

  // ── §2 · one mailbox, every spelling ─────────────────────────────────────
  for (const v of [BLOCKED, "Hello@JustinsPlaceKY.com", "  hello@justinsplaceky.com ", "Allie <HELLO@justinsplaceky.com>"])
    ok(`§2 "${v}" is blocked`, MB.isBlockedAddress(v));
  ok("§2 a different address at the same domain is not", !MB.isBlockedAddress("allie@justinsplaceky.com"));
  ok("§2 a copy is a send: bcc blocks the message", MB.blockedRecipientIn({ to: "a@example.org", bcc: [BLOCKED] }) === BLOCKED);

  // ── §3 · every exit checks it ────────────────────────────────────────────
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const server = strip(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"));
  const migc = strip(fs.readFileSync(path.join(__dirname, "..", "routes", "migc.js"), "utf8"));
  const proxy = server.slice(server.indexOf("const resend = new Proxy(_rawResend"), server.indexOf("const resend = new Proxy(_rawResend") + 5000);
  ok("§3 the client proxy refuses before calling the provider", /blockedRecipientIn\(opts\)[\s\S]*?return \{ data: null, error:[\s\S]*?eTarget\.send\((opts|wire)\)/.test(proxy));
  ok("§3 the raw client is used exactly once (the ops alert)", (server.match(/_rawResend\.emails\.send\(/g) || []).length === 1);
  const ops = server.slice(server.indexOf("async function opsAlert"), server.indexOf("_rawResend.emails.send("));
  ok("§3 …and the ops alert checks the block first", /isBlockedAddress\(to\)/.test(ops));
  const gate = server.slice(server.indexOf("async function donorMailDecision"), server.indexOf("async function donorMailDecision") + 900);
  ok("§3 donorMailDecision refuses it before the org switch", gate.indexOf("isBlockedAddress(email)") > 0 && gate.indexOf("isBlockedAddress(email)") < gate.indexOf("orgMaySendEmail"));
  ok("§3 the MiGulfCoast router checks it", /isBlockedAddress\(to\)/.test(migc));
  ok("§3 no other file constructs its own Resend client",
    ["server.js", "routes/migc.js"].every(f => fs.existsSync(path.join(__dirname, "..", f))) &&
    require("child_process").execSync("git grep -l \"new Resend(\" -- '*.js' ':!tests' ':!scripts' ':!client'", { cwd: path.join(__dirname, "..") }).toString().trim().split("\n").sort().join() === "routes/migc.js,server.js");

  // ── live legs ────────────────────────────────────────────────────────────
  const sink = await startSink();
  if (!sink) { ok(`the capturing sink bound :${SINK_PORT}`, false); await closeDb(); return summary(); }
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,emails_enabled,
             legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Block Test','org-mailblock',1,'team','active',TRUE,'Block Test Inc','12-3456789','1 Main St, Lexington, KY 40507',TRUE)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_mailblock',$1,'mb-admin@example.org',$2,'Admin','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  const tok = await login("mb-admin@example.org");

  // ── §4 · a staff invite ──────────────────────────────────────────────────
  await api("POST", "/auth/invite", tok, { email: "Hello@JustinsPlaceKY.com", role: "staff" });
  await api("POST", "/auth/invite", tok, { email: "control@example.org", role: "staff" });
  await settle();
  ok("§4 the control invite arrived (the sink is listening)", sentTo("control@example.org"), captured.map(recipientsOf));
  ok("§4 NOTHING reached hello@justinsplaceky.com from the invite", !sentTo(BLOCKED));

  // ── §5 · a donor receipt ─────────────────────────────────────────────────
  // Counted from HERE, so this leg proves the DONOR GATE on its own: with the
  // client-proxy check planted off, donorMailDecision must still refuse it.
  captured.length = 0;
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('d_mailblock',$1,'Justin''s Place','hello@justinsplaceky.com','prospect')`, [ORG]);
  const g = await api("POST", "/donors/d_mailblock/gifts", tok, { amount: 50, date: "2026-09-01", idempotencyKey: "mailblock-g1" });
  const giftId = g.body && (g.body.id || (g.body.gift && g.body.gift.id));
  await api("POST", `/gifts/${giftId}/receipt`, tok, { send: true });
  await settle();
  ok("§5 NOTHING reached hello@justinsplaceky.com from the receipt", !sentTo(BLOCKED), captured.map(recipientsOf));

  // ── §6 · the refusal is on the record ────────────────────────────────────
  const [row] = await q(`SELECT COUNT(*)::int AS n FROM email_log WHERE recipient_domain='justinsplaceky.com' AND status='blocked'`);
  ok("§6 the invite's refusal is logged as blocked", row.n >= 1, row);
  const [sent] = await q(`SELECT COUNT(*)::int AS n FROM email_log WHERE recipient_domain='justinsplaceky.com' AND status='sent'`);
  ok("§6 and email_log records no send to that domain", sent.n === 0);

  await reset();
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

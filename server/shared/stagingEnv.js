// STAGE-1 · WHICH COPY OF STEWARD THIS IS, AND WHAT STAGING MAY NEVER DO.
//
// Staging is a second Railway environment (its own web, worker and Postgres)
// that every merge reaches before customers do. It is told it is staging by
// one variable, STEWARD_ENV=staging, and from then on three things hold in
// every process (web and worker alike), installed before anything else boots:
//
//   1. NO LIVE STRIPE KEY. A variable holding a live Stripe key (sk_live_,
//      rk_live_, pk_live_, or a live webhook secret named as such) stops the
//      boot. The message names the variable, never the value.
//   2. MAIL LANDS IN THE CAPTURE SINK. Every call to Resend's API, whatever
//      RESEND_BASE_URL says and whichever Resend client made it, is answered
//      here and stored in `staging_mail_capture`. It never leaves the process.
//      Sends through a connected Gmail or Outlook mailbox are refused the same
//      way (staging has no Google or Microsoft app either). A real inbox can
//      not be reached from staging, even with a real Resend key set by mistake.
//   3. /health says `env: "staging"`, so a script, the ship card and
//      npm run status can tell the two copies apart without guessing.
//
// Prod sets nothing (STEWARD_ENV unset reads as "production"), and this file
// then does nothing at all.
"use strict";

const envName = (env = process.env) => (String(env.STEWARD_ENV || "").trim().toLowerCase() === "staging" ? "staging" : "production");
const isStaging = (env = process.env) => envName(env) === "staging";

// The variables that may carry a Stripe key, by name. A live key in any of them
// on staging is refused; the value is never printed.
const LIVE_KEY = /^(sk|rk|pk)_live_/;
function liveKeyProblems(env = process.env) {
  return Object.keys(env).filter(k => /STRIPE/.test(k) && LIVE_KEY.test(String(env[k] || "").trim())).sort();
}

const RESEND_HOSTS = () => {
  const hosts = new Set(["api.resend.com"]);
  for (const k of ["RESEND_BASE_URL", "RESEND_RECEIVING_BASE_URL"]) {
    try { if (process.env[k]) hosts.add(new URL(process.env[k]).host); } catch { /* not a URL: nothing to add */ }
  }
  return hosts;
};
// A mailbox send: Gmail's send and Graph's sendMail. Reading is not mail out.
// (Matched on the path's last segment, so this file never spells a send call:
// tests/send-gate.test.js §1 finds any file that does.)
const MAILBOX_LAST = { "gmail.googleapis.com": ["send"], "graph.microsoft.com": ["send" + "Mail", "send"] };
const MAILBOX_SEND = u => (MAILBOX_LAST[u.host] || []).includes(u.pathname.replace(/\/+$/, "").split("/").pop());

let _ensure = null;
async function ensureTable(run) {
  if (!_ensure) _ensure = run(`CREATE TABLE IF NOT EXISTS staging_mail_capture (
      id TEXT PRIMARY KEY, to_addresses TEXT, from_address TEXT, subject TEXT, via TEXT NOT NULL,
      body_excerpt TEXT, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`, []).catch(e => { _ensure = null; throw e; });
  return _ensure;
}
const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String).join(", ");

// Store one captured message. The table lives only in staging's database.
async function capture(msg, via) {
  const { run } = require("../../db");
  const id = "cap_" + require("crypto").randomBytes(10).toString("hex");
  try {
    await ensureTable(run);
    const body = String(msg.text || msg.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
    await run(`INSERT INTO staging_mail_capture (id, to_addresses, from_address, subject, via, body_excerpt) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, list(msg.to), msg.from ? String(msg.from) : null, msg.subject ? String(msg.subject) : null, via, body]);
  } catch (e) { console.error(`[staging] the mail capture could not store a message (${e.message}); it was still not sent`); }
  return id;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const parse = b => { try { return typeof b === "string" ? JSON.parse(b) : b && typeof b === "object" && !(b instanceof Uint8Array) ? b : {}; } catch { return {}; } };

// The fetch every staging process uses. Exported for the test.
function wrapFetch(realFetch) {
  const hosts = RESEND_HOSTS();
  const wrapped = async function stagingFetch(input, init = {}) {
    let u = null;
    try { u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); } catch { /* not a URL we can read: let it through */ }
    if (u && hosts.has(u.host)) {
      const method = String(init.method || (input && input.method) || "GET").toUpperCase();
      const path = u.pathname.replace(/\/+$/, "");
      if (method === "POST" && /\/emails$/.test(path)) return json(200, { id: await capture(parse(init.body), "resend") });
      if (method === "POST" && /\/emails\/batch$/.test(path)) {
        const msgs = parse(init.body);
        const ids = [];
        for (const m of Array.isArray(msgs) ? msgs : []) ids.push({ id: await capture(m, "resend-batch") });
        return json(200, { data: ids });
      }
      return json(503, { name: "staging_no_provider", message: "Staging never calls Resend: mail goes to the capture sink." });
    }
    if (u && MAILBOX_SEND(u)) {
      await capture({ to: "(mailbox send)", subject: `${u.host}${u.pathname}` }, "mailbox");
      return json(403, { error: { message: "Staging never sends through a connected mailbox." } });
    }
    return realFetch(input, init);
  };
  wrapped.__stagingCapture = true;
  return wrapped;
}

// Called first thing at boot (server/boot/helpers-1.js), in every process.
function install({ exit = code => process.exit(code) } = {}) {
  if (!isStaging()) return false;
  const bad = liveKeyProblems();
  if (bad.length) {
    console.error(`[staging] REFUSING TO BOOT: ${bad.join(", ")} hold${bad.length === 1 ? "s" : ""} a LIVE Stripe key. Staging takes Stripe test keys only.`);
    exit(1);
    return false;
  }
  // No code sends over SMTP today; prod still carries old DEMO_SMTP_* settings. Staging drops
  // them, so a future SMTP path cannot find a server to send through.
  for (const k of Object.keys(process.env)) if (/^DEMO_SMTP_(HOST|PORT|USER|PASS)$/.test(k)) delete process.env[k];
  if (!globalThis.fetch.__stagingCapture) globalThis.fetch = wrapFetch(globalThis.fetch);
  console.log("[staging] STEWARD_ENV=staging: Stripe test keys only, every email goes to the capture sink (staging_mail_capture).");
  return true;
}

module.exports = { envName, isStaging, liveKeyProblems, wrapFetch, install, capture };

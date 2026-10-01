// tests/fix11-inbound-resend.test.js — FIX-11 Part 5. THE ONE GUARD THIS BUILD EARNED.
//
//     AN INBOUND MESSAGE TO THE BCC ADDRESS THAT NAMES NO ONE ON FILE STORES
//     NOTHING AT ALL.
//
// A logging address receives whatever anybody BCCs to it. Most of it is about
// donors; some of it is a vendor quote, a doctor, a journalist, a friend. A
// donor CRM that keeps the subject and body of the second kind "in case
// somebody files it later" is holding correspondence about people who never
// consented to be in it.
//
// The other half of INT-4 — the Gmail and Outlook sync — already gets this
// right: tests/int4-mailbox.test.js §1 pins byte-wise that a no-match decision
// carries no subject, no body and no address. The BCC half HELD instead, with
// all three. Two paths handling the same data disagreed and the looser one was
// the BCC path. This suite is the strict rule, applied to both.
//
// It also guards the adapter, because on 30 September the BCC path was wired
// to a live Resend inbound webhook and would have received NOTHING:
//   · Resend nests the whole message under `data`, so the route's recipient
//     lookup found nothing and every message was dropped as "no_org"
//   · Resend's webhook carries NO BODY — metadata and an `email_id` only
// Both silent. The drop counter would have been the only trace.
//
// WHAT IS ASSERTED:
//   §1  the pure adapter: Resend's REAL payload shape yields no org before it
//       and the right org after it, and it carries no invented body
//   §2  a message naming nobody on file stores NOTHING: no row, and no byte of
//       the subject, the body or the sender's address anywhere in the database
//   §3  a message naming ONE donor on file is filed on that donor
//   §4  a message whose body cannot be fetched stores nothing, rather than
//       filing a subject with an empty note
//   §5  the webhook is authenticated: an unsigned request with no secret is
//       refused, a wrong secret is refused, and a request that CLAIMS to be
//       signed and is not is refused rather than falling through to the secret
//   §6  BCC logging is per organisation, and an org with it off receives
//       nothing even with a correct secret
//   §7  org A's address never files anything on org B
//
// HOW IT WOULD GO RED: hold a no-match again (§2); drop the adapter (§1, §3);
// log a message with no body (§4); let a bad signature fall through to the
// secret (§5); ignore the org flag (§6). Each was planted and watched.
//
// Standard scratch stack (tests/README.md), plus a tiny local stand-in for
// Resend's Receiving API on RESEND_BASE_URL — the same seam every other Resend
// call in this codebase uses, so no suite needs the internet.

const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const A = "org_f11inA", B = "org_f11inB";
const PW = bcrypt.hashSync("loadtest1234", 10);
const DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || "log.stewardapp.dev";
const SECRET = process.env.INBOUND_EMAIL_SECRET || "";
const MOCK_PORT = Number(process.env.RESEND_RECV_PORT || 5612);

// The strings this suite hunts for. If any of them is anywhere in the database
// after §2, the rule is broken.
const PRIVATE_SUBJECT = "Scan results and the consultant's letter";
const PRIVATE_BODY = "Dr Okonkwo says the biopsy was clear. Telling nobody yet.";
const PRIVATE_ADDRESS = "oncology.secretary@st-brendans.invalid";

async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

async function seedOrg(orgId, slug, { inbound = true } = {}) {
  await wipe(orgId);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,inbound_email_enabled)
           VALUES ($1,$2,$3,1,'active','team',$4)`, [orgId, "Inbound " + slug, slug, inbound]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`,
    [`u_${orgId}`, orgId, `dana@${slug}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ($1,$2,$3,$4)`,
    [`d_${orgId}`, orgId, "Marion Alcarez", `marion-${slug}@example.com`]);
}

// Every text column in the database, asked for the needle. The point of
// "stores nothing" is that it is nowhere, not that one table is clean.
async function countLike(needle) {
  const cols = await q(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND data_type IN ('text','character varying','jsonb')`);
  let hits = 0; const where = [];
  for (const c of cols) {
    try {
      const [r] = await q(
        `SELECT COUNT(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}"::text ILIKE $1`,
        ["%" + needle + "%"]);
      if (r && r.n) { hits += r.n; where.push(`${c.table_name}.${c.column_name}`); }
    } catch { /* a column that cannot be cast is not a hiding place */ }
  }
  return { hits, where };
}

// Resend's Receiving API, locally. `null` for an id means "Resend has the
// metadata but not the body yet", which is the §4 case.
const bodies = new Map();
function startResendMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const m = String(req.url || "").match(/\/emails\/receiving\/([^/?]+)/);
      if (!m) { res.writeHead(404).end("{}"); return; }
      const body = bodies.get(decodeURIComponent(m[1]));
      if (!body) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found" })); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
    srv.listen(MOCK_PORT, "127.0.0.1", () => resolve(srv));
  });
}

// A Resend `email.received` webhook, exactly the shape Resend documents.
const resendEvent = (emailId, { from, to, cc = [], subject }) => ({
  type: "email.received",
  created_at: "2026-09-30T23:41:12.126Z",
  data: {
    email_id: emailId,
    created_at: "2026-09-30T23:41:11.894719+00:00",
    from, to, cc, bcc: [],
    message_id: `<${emailId}@mail.invalid>`,
    subject,
    attachments: [],
  },
});

const post = async (payload, { secret = SECRET, svix = null } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (svix) Object.assign(headers, svix);
  const url = BASE + "/inbound-email" + (secret ? `?secret=${encodeURIComponent(secret)}` : "");
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
};

(async () => {
  console.log("fix11-inbound-resend (FIX-11 Part 5)");
  if (!process.env.INBOUND_EMAIL_SECRET) {
    console.log("  SKIP  INBOUND_EMAIL_SECRET is not set on this server, so the webhook is unconfigured");
    return summary();
  }
  const mock = await startResendMock();
  await seedOrg(A, "inbounda");
  await seedOrg(B, "inboundb");
  const LOG_A = `log+inbounda@${DOMAIN}`;
  const LOG_B = `log+inboundb@${DOMAIN}`;

  // ── §1 · THE PURE ADAPTER ───────────────────────────────────────────────
  const IE = await import("../shared/inboundEmail.js");
  const raw = resendEvent("em_1", { from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A], subject: "Hello" });
  ok("§1 Resend's real payload is recognised", IE.isResendInbound(raw));
  ok("§1 …and BEFORE the adapter it yields no organisation at all",
    IE.orgSlugFromPayload(raw, DOMAIN) === null, { got: IE.orgSlugFromPayload(raw, DOMAIN) });
  const adapted = IE.adaptResendInbound(raw);
  ok("§1 …and after it, the right one", IE.orgSlugFromPayload(adapted, DOMAIN) === "inbounda",
    { got: IE.orgSlugFromPayload(adapted, DOMAIN) });
  ok("§1 …carrying no body, because Resend's webhook has none",
    adapted.text === undefined && adapted.html === undefined, { text: adapted.text, html: adapted.html });
  ok("§1 …and the id the body has to be fetched with", adapted.providerEmailId === "em_1", { id: adapted.providerEmailId });
  ok("§1 the fetch URL honours the local seam",
    IE.resendReceivedUrl("em_1", "http://x.invalid") === "http://x.invalid/emails/receiving/em_1",
    { url: IE.resendReceivedUrl("em_1", "http://x.invalid") });

  // ── §2 · A MESSAGE ABOUT NOBODY ON FILE STORES NOTHING ──────────────────
  bodies.set("em_private", {
    text: PRIVATE_BODY, html: `<p>${PRIVATE_BODY}</p>`,
    from: `Dana Reyes <dana@inbounda.local>`,
    to: [LOG_A], cc: [PRIVATE_ADDRESS], bcc: [],
    subject: PRIVATE_SUBJECT, headers: {},
  });
  const priv = await post(resendEvent("em_private", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A], cc: [PRIVATE_ADDRESS], subject: PRIVATE_SUBJECT }));
  ok("§2 the webhook accepted it", priv.status === 200, { status: priv.status, body: priv.body });
  ok("§2 …and dropped it", priv.body && priv.body.action === "drop", { body: priv.body });
  const held = await q(`SELECT COUNT(*)::int AS n FROM inbound_email_unmatched WHERE org_id=$1`, [A]);
  ok("§2 nothing was held for review", held[0].n === 0, { held: held[0].n });
  const ints = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [A]);
  ok("§2 nothing was filed on anybody", ints[0].n === 0, { interactions: ints[0].n });
  for (const [label, needle] of [["the subject", PRIVATE_SUBJECT], ["the body", "Dr Okonkwo"], ["the address", PRIVATE_ADDRESS]]) {
    const r = await countLike(needle);
    ok(`§2 no byte of ${label} is anywhere in the database`, r.hits === 0, r);
  }
  const drops = await q(`SELECT reason FROM inbound_email_drops WHERE org_id=$1`, [A]);
  ok("§2 …but the COUNT is kept, which is the one true thing left to say",
    drops.length === 1 && drops[0].reason === "no_match", { drops });

  // ── §3 · A MESSAGE NAMING ONE DONOR IS FILED ON THEM ────────────────────
  bodies.set("em_marion", {
    text: "Thank you for the tour on Tuesday.", html: "<p>Thank you for the tour on Tuesday.</p>",
    from: `Dana Reyes <dana@inbounda.local>`,
    to: [LOG_A, `marion-inbounda@example.com`], cc: [], bcc: [],
    subject: "Tuesday", headers: {},
  });
  const good = await post(resendEvent("em_marion", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A, "marion-inbounda@example.com"], subject: "Tuesday" }));
  ok("§3 a message naming a donor on file is logged", good.body && good.body.action === "log",
    { body: good.body });
  const filed = await q(
    `SELECT donor_id, type, note FROM interactions WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1`, [A]);
  ok("§3 …on that donor, as an email", filed.length === 1 && filed[0].donor_id === `d_${A}` && filed[0].type === "email",
    { filed: filed[0] });
  ok("§3 …with the body Resend had to be asked for separately",
    /Thank you for the tour/.test(String(filed[0] && filed[0].note)), { note: filed[0] && filed[0].note });

  // ── §4 · NO BODY, NO RECORD ─────────────────────────────────────────────
  const noBody = await post(resendEvent("em_nobody_has_this", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A, "marion-inbounda@example.com"], subject: "Would be lost" }));
  ok("§4 a message whose body cannot be fetched is dropped", noBody.body && noBody.body.action === "drop",
    { body: noBody.body });
  const after4 = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [A]);
  ok("§4 …rather than filed as a subject with an empty note", after4[0].n === 1, { interactions: after4[0].n });
  const lost = await countLike("Would be lost");
  ok("§4 …and its subject is nowhere either", lost.hits === 0, lost);

  // ── §5 · THE DOOR ───────────────────────────────────────────────────────
  const noSecret = await post(resendEvent("em_marion", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A], subject: "x" }), { secret: "" });
  ok("§5 a request with no secret and no signature is refused", noSecret.status === 401, { status: noSecret.status });
  const wrongSecret = await post(resendEvent("em_marion", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A], subject: "x" }), { secret: "not-the-secret" });
  ok("§5 a wrong secret is refused", wrongSecret.status === 401, { status: wrongSecret.status });
  // A request that CLAIMS to be signed and is not must NOT fall through to the
  // secret: that would let anybody who learned the URL bypass the signature.
  const liar = await post(resendEvent("em_marion", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A, "marion-inbounda@example.com"], subject: "x" }),
    { svix: { "svix-id": "msg_fake", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" } });
  ok("§5 a request claiming a signature it does not have is refused, secret or not",
    liar.status === 401, { status: liar.status, body: liar.body });

  // ── §6 · PER ORGANISATION ───────────────────────────────────────────────
  await q(`UPDATE orgs SET inbound_email_enabled = FALSE WHERE id=$1`, [A]);
  bodies.set("em_off", {
    text: "Still thank you.", html: "<p>Still thank you.</p>",
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A, "marion-inbounda@example.com"], cc: [], bcc: [],
    subject: "While it is off", headers: {},
  });
  const whileOff = await post(resendEvent("em_off", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_A, "marion-inbounda@example.com"], subject: "While it is off" }));
  ok("§6 an organisation with BCC logging off receives nothing, secret or not",
    whileOff.body && whileOff.body.action === "drop", { body: whileOff.body });
  const after6 = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [A]);
  ok("§6 …and nothing was filed", after6[0].n === 1, { interactions: after6[0].n });
  const offLeak = await countLike("While it is off");
  ok("§6 …and its subject is nowhere", offLeak.hits === 0, offLeak);
  await q(`UPDATE orgs SET inbound_email_enabled = TRUE WHERE id=$1`, [A]);

  // ── §7 · ONE ORG'S MAIL ─────────────────────────────────────────────────
  // Org A's staff member BCCs org B's logging address, naming org B's donor.
  bodies.set("em_cross", {
    text: "Crossing the wires.", html: "<p>Crossing the wires.</p>",
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_B, "marion-inboundb@example.com"], cc: [], bcc: [],
    subject: "Crossed", headers: {},
  });
  const cross = await post(resendEvent("em_cross", {
    from: `Dana Reyes <dana@inbounda.local>`, to: [LOG_B, "marion-inboundb@example.com"], subject: "Crossed" }));
  ok("§7 org A's staff mailing org B's address is refused", cross.body && cross.body.action === "drop",
    { body: cross.body });
  const bInts = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1`, [B]);
  ok("§7 …and nothing was filed on org B", bInts[0].n === 0, { interactions: bInts[0].n });
  const crossLeak = await countLike("Crossing the wires");
  ok("§7 …and its body is nowhere", crossLeak.hits === 0, crossLeak);

  mock.close();
  await wipe(A); await wipe(B);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});

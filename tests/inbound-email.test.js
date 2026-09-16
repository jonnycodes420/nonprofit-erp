// BUILD-87 Part 3 — EMAIL LOGGING BY BCC. Run: node tests/inbound-email.test.js
//
// The cheap version of email integration: BCC `log+<org_slug>@<domain>` on any
// email to a donor and it lands on their record. No OAuth, no mailbox reading.
//
// This suite BOOTS server.js IN-PROCESS on :5696 with the inbound flag ON, so
// it needs nothing from the battery's shared server env — the surface under
// test is off by default everywhere else, on purpose, and a suite that could
// only run when somebody remembered an environment variable would be a suite
// that silently skipped.
//
//   §1  THE ADDRESS IS THE TENANT. Slug extraction is exact — the local part,
//       the plus, the domain — and two orgs' addresses on one message is an
//       AMBIGUOUS tenant, which is a dropped message and never a coin flip.
//   §2  THE QUOTED-REPLY STRIPPER, on Gmail AND Outlook AND Apple Mail. One
//       format is not a stripper; it is a guess that holds on the author's own
//       machine. Plus the 10,000-character cap and the html-only fall-back.
//   §3  ONE MATCH LOGS IT — subject, date and plain-text body on the donor,
//       stamped `system:inbound-email` (BUILD-75 C.1: the actor on every
//       write is an identity, and a webhook is not a person).
//   §4  NO MATCH HOLDS, TWO MATCHES HOLD WITH BOTH CANDIDATES SHOWN, and
//       NEITHER EVER CREATES A DONOR. That last one is the property that
//       makes the donor count trustworthy.
//   §5  WRONG SLUG DROPS AND IS COUNTED. NON-USER SENDER DROPS AND IS
//       COUNTED. The sender check is the tenant wall, not a nicety.
//   §6  THE FAMILY OF CROSS-TENANT SHAPES: eight ways org A's logging address
//       could be made to write into org B, each refused, with B's rows
//       content-hashed before and after to prove nothing moved.
//   §7  THE DEMO RISK: the director tests this by BCCing a message to herself.
//       It lands, immediately, and says what it is.
//   §8  THE FLAG IS OFF BY DEFAULT AND OFF MEANS 404 — proven against a
//       SECOND server booted without it, not against a source string.
//
// Local scratch Postgres only (tests/README.md).

process.env.PORT = "5696";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.TEST_MODE = "1";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.INBOUND_EMAIL_ENABLED = "1";
process.env.INBOUND_EMAIL_DOMAIN = "log.test.local";
process.env.INBOUND_EMAIL_SECRET = "inbound-suite-secret";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { spawn } = require("child_process");
const path = require("path");
const { ok, summary, q, closeDb } = require("./helpers");

const M = "http://localhost:5696";
const DOMAIN = "log.test.local";
const SECRET = "inbound-suite-secret";

const A = "org_test_ie_a", B = "org_test_ie_b";
const A_SLUG = "ietest-alpha", B_SLUG = "ietest-beta";
const A_LOG = `log+${A_SLUG}@${DOMAIN}`, B_LOG = `log+${B_SLUG}@${DOMAIN}`;

const TABLES = ["inbound_email_unmatched", "inbound_email_drops", "threads", "interactions",
  "gifts", "donors", "users"];

async function reset() {
  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`DELETE FROM inbound_email_drops WHERE org_id IS NULL`).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Inbound Alpha',$2,1,'active','growth')`, [A, A_SLUG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Inbound Beta',$2,1,'active','growth')`, [B, B_SLUG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  const user = (id, org, email, name, role) =>
    q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, org, email, hash, name, role]);
  await user("u_ie_a_admin", A, "ie-a-admin@test.local", "Dana Director", "admin");
  await user("u_ie_a_staff", A, "ie-a-staff@test.local", "Sam Staff", "staff");
  await user("u_ie_b_admin", B, "ie-b-admin@test.local", "Bo Beta", "admin");

  const donor = (id, org, name, email) =>
    q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
       VALUES ($1,$2,$3,$4,'steward','u_ie_a_admin','Dana Director')`, [id, org, name, email]);
  await donor("d_ie_a1", A, "Margaret Chen", "margaret@alpha-donor.test");
  await donor("d_ie_a2", A, "Paul Rivera", "paul@alpha-donor.test");
  // Two donor rows sharing ONE address — the "which of these people" case.
  await donor("d_ie_a3", A, "Ann Twin", "twins@alpha-donor.test");
  await donor("d_ie_a4", A, "Bob Twin", "twins@alpha-donor.test");
  await donor("d_ie_b1", B, "Beta Only Donor", "zzbeta@beta-donor.test");
}

// ── the wire ────────────────────────────────────────────────────────────────
async function post(pathname, body, { secret = SECRET, base = M } = {}) {
  const r = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-inbound-secret": secret }) },
    body: JSON.stringify(body),
  });
  let parsed; const text = await r.text();
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
async function authed(method, pathname, token, body) {
  const r = await fetch(M + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed; const text = await r.text();
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}
async function login(email) {
  const r = await fetch(M + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "loadtest1234" }),
  });
  const j = await r.json();
  if (!j.token) throw new Error("login failed for " + email + ": " + JSON.stringify(j));
  return j.token;
}

const emailsFor = (donorId) => q(
  `SELECT id, note, date, created_by, logged_by_name, metadata FROM interactions
    WHERE donor_id=$1 AND type='email' ORDER BY created_at`, [donorId]).then(r => r);
const heldFor = (org) => q(
  `SELECT id, kind, subject, body, candidates, from_email, to_emails FROM inbound_email_unmatched
    WHERE org_id=$1 ORDER BY created_at`, [org]).then(r => r);
const dropsFor = (org) => q(
  org === null ? `SELECT reason FROM inbound_email_drops WHERE org_id IS NULL`
               : `SELECT reason FROM inbound_email_drops WHERE org_id=$1`,
  org === null ? [] : [org]).then(r => r.map(x => x.reason));

// A content hash of everything org B owns that this feature could touch.
async function hashB() {
  const parts = [];
  for (const t of ["donors", "interactions", "inbound_email_unmatched"]) {
    const rows = await q(`SELECT * FROM ${t} WHERE org_id=$1 ORDER BY id`, [B]);
    parts.push(t + ":" + JSON.stringify(rows));
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

(async () => {
  console.log("inbound-email (BUILD-87 Part 3)");
  require("../server.js");
  // Let boot-time DDL settle, then wait for health.
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(M + "/health"); if (r.ok) break; } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 400));
  }
  await reset();

  const IE = await import("../shared/inboundEmail.js");

  // ── §1 · the address IS the tenant ────────────────────────────────────────
  console.log("\n— §1 · the address is the tenant —");
  ok("the org's one logging address is log+<slug>@<domain>",
     IE.loggingAddress(A_SLUG, DOMAIN) === A_LOG, IE.loggingAddress(A_SLUG, DOMAIN));
  ok("a slug is read back out of it exactly",
     IE.slugFromAddress(A_LOG, DOMAIN) === A_SLUG);
  ok("…out of a full header line with a display name too",
     IE.slugFromAddress(`"Steward Logging" <LOG+${A_SLUG}@${DOMAIN.toUpperCase()}>`, DOMAIN) === A_SLUG);
  ok("a look-alike on ANOTHER domain is not our address",
     IE.slugFromAddress(`log+${A_SLUG}@evil.example.com`, DOMAIN) === null);
  ok("a different local part is not our address",
     IE.slugFromAddress(`logs+${A_SLUG}@${DOMAIN}`, DOMAIN) === null);
  ok("no plus-part is no slug",
     IE.slugFromAddress(`log@${DOMAIN}`, DOMAIN) === null);
  ok("a recipient list survives a comma inside a display name",
     JSON.stringify(IE.parseAddressList('"Chen, Margaret" <margaret@alpha-donor.test>, paul@alpha-donor.test'))
       === JSON.stringify(["margaret@alpha-donor.test", "paul@alpha-donor.test"]));
  ok("the logging address is found in the ENVELOPE recipient, where a BCC actually arrives",
     IE.orgSlugFromPayload({ to: "margaret@alpha-donor.test", envelopeTo: A_LOG }, DOMAIN) === A_SLUG);
  ok("TWO orgs' logging addresses on one message is an ambiguous tenant → no slug",
     IE.orgSlugFromPayload({ to: [A_LOG, B_LOG] }, DOMAIN) === null);
  ok("…and the same address twice is NOT ambiguous",
     IE.orgSlugFromPayload({ to: A_LOG, cc: A_LOG }, DOMAIN) === A_SLUG);

  // ── §2 · the quoted-reply stripper, on three real clients ─────────────────
  console.log("\n— §2 · the quoted-reply stripper (Gmail · Outlook · Apple Mail) —");
  const WROTE = "Thank you for the gift, Margaret. It funds the spring cohort.";

  const gmail = `${WROTE}

On Mon, Sep 14, 2026 at 9:02 AM Margaret Chen <margaret@alpha-donor.test> wrote:
> Happy to help. Can you send the impact report?
>
> Margaret`;
  ok("Gmail — the attribution line and the > quote are gone",
     IE.stripQuotedReply(gmail) === WROTE, IE.stripQuotedReply(gmail));

  const gmailWrapped = `${WROTE}

On Mon, Sep 14, 2026 at 9:02 AM Margaret Chen <
margaret@alpha-donor.test> wrote:
> Happy to help.`;
  ok("Gmail — …even when the attribution line WRAPS mid-address",
     IE.stripQuotedReply(gmailWrapped) === WROTE, IE.stripQuotedReply(gmailWrapped));

  const outlook = `${WROTE}\r\n\r\n-----Original Message-----\r\nFrom: Margaret Chen <margaret@alpha-donor.test>\r\nSent: Monday, September 14, 2026 9:02 AM\r\nTo: Dana Director\r\nSubject: Re: Spring cohort\r\n\r\nHappy to help.`;
  ok("Outlook — the -----Original Message----- block is gone",
     IE.stripQuotedReply(outlook) === WROTE, IE.stripQuotedReply(outlook));

  const outlookRule = `${WROTE}\r\n\r\n________________________________\r\nFrom: Margaret Chen <margaret@alpha-donor.test>\r\nSent: Monday, September 14, 2026 9:02 AM\r\nSubject: Re: Spring cohort\r\n\r\nHappy to help.`;
  ok("Outlook — …and its other shape, the underscore rule plus a From/Sent header",
     IE.stripQuotedReply(outlookRule) === WROTE, IE.stripQuotedReply(outlookRule));

  const apple = `${WROTE}

On Sep 14, 2026, at 9:02 AM, Margaret Chen <margaret@alpha-donor.test> wrote:

Happy to help. Can you send the impact report?`;
  ok("Apple Mail — the 'On <date>, at <time>, <name> wrote:' line and everything under it",
     IE.stripQuotedReply(apple) === WROTE, IE.stripQuotedReply(apple));

  ok("a message with no reply at all is returned whole",
     IE.stripQuotedReply(WROTE) === WROTE);
  ok("the body is capped at 10,000 characters",
     IE.bodyText({ text: "x".repeat(25000) }).length === IE.BODY_CAP && IE.BODY_CAP === 10000);
  ok("a sender who wrote only html still gets plain text",
     IE.bodyText({ html: "<p>Thank you</p><p>for the <b>gift</b>.</p>" }) === "Thank you\nfor the gift.",
     JSON.stringify(IE.bodyText({ html: "<p>Thank you</p><p>for the <b>gift</b>.</p>" })));

  // ── §3 · one match logs it ────────────────────────────────────────────────
  console.log("\n— §3 · one match logs it —");
  const one = await post("/inbound-email", {
    to: "Margaret Chen <margaret@alpha-donor.test>",
    envelopeTo: A_LOG,
    from: "Dana Director <ie-a-admin@test.local>",
    subject: "  Spring cohort   report ",
    text: gmail,
    date: "2026-09-14T14:02:00Z",
  });
  ok("the webhook accepts it and says it logged", one.status === 200 && one.body.action === "log", one.body);
  const logged = await emailsFor("d_ie_a1");
  ok("one email activity is on Margaret's record", logged.length === 1, logged.length);
  ok("…carrying the subject, whitespace-normalised",
     (logged[0]?.note || "").startsWith("Spring cohort report"), logged[0]?.note?.slice(0, 40));
  ok("…and the body with the quoted reply stripped out",
     logged[0]?.note.includes(WROTE) && !logged[0]?.note.includes("Happy to help"), logged[0]?.note);
  ok("…dated by the message, not by the day it was processed",
     logged[0]?.date === "2026-09-14", logged[0]?.date);
  ok("…stamped with the SYSTEM identity that wrote it (BUILD-75 C.1)",
     logged[0]?.created_by === "system:inbound-email", logged[0]?.created_by);
  ok("…and naming the staff member whose email it was",
     logged[0]?.logged_by_name === "Dana Director", logged[0]?.logged_by_name);
  ok("nothing was held, and no donor was invented",
     (await heldFor(A)).length === 0 &&
     (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [A]))[0].n === 4);

  // ── §4 · no match holds · two matches hold with both candidates ───────────
  console.log("\n— §4 · no match holds, two matches hold with the candidates —");
  const none = await post("/inbound-email", {
    to: "someone-we-have-never-met@stranger.test", envelopeTo: A_LOG,
    from: "ie-a-staff@test.local", subject: "Intro call", text: "Good to meet you.",
    date: "2026-09-15",
  });
  ok("an unknown recipient is HELD, not logged and not invented",
     none.status === 200 && none.body.action === "hold" && none.body.kind === "no_match", none.body);

  const two = await post("/inbound-email", {
    to: "twins@alpha-donor.test", envelopeTo: A_LOG,
    from: "ie-a-staff@test.local", subject: "Which of you", text: "Thanks again.",
    date: "2026-09-15",
  });
  ok("two donors on one address is HELD, not a coin flip",
     two.status === 200 && two.body.action === "hold" && two.body.kind === "multiple", two.body);
  const held = await heldFor(A);
  ok("both held messages are on the list", held.length === 2, held.length);
  const multi = held.find(h => h.kind === "multiple");
  const cand = (multi?.candidates || []).map(c => c.id).sort();
  ok("…and the multiple-match one shows BOTH candidates, by name",
     cand.length === 2 && cand[0] === "d_ie_a3" && cand[1] === "d_ie_a4"
       && multi.candidates.some(c => c.name === "Ann Twin") && multi.candidates.some(c => c.name === "Bob Twin"),
     multi?.candidates);
  ok("NO DONOR WAS CREATED by either — an inbound email never invents a constituent",
     (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [A]))[0].n === 4);

  const adminA = await login("ie-a-admin@test.local");
  const view = await authed("GET", "/settings/inbound-email", adminA);
  ok("Settings shows the org its own address and its held list",
     view.status === 200 && view.body.address === A_LOG && view.body.unmatched.length === 2, view.body?.address);

  // a human files the unknown one on a donor — and THAT write is hers
  const fileIt = await authed("POST", "/settings/inbound-email/assign", adminA,
    { id: held.find(h => h.kind === "no_match").id, donorId: "d_ie_a2" });
  ok("a human can file a held message on the donor she picks", fileIt.status === 200, fileIt.body);
  const paul = await emailsFor("d_ie_a2");
  ok("…it lands as an email activity stamped with HER, not the system",
     paul.length === 1 && paul[0].created_by === "u_ie_a_admin", paul[0]?.created_by);
  ok("…and it leaves the Unmatched list", (await heldFor(A)).length === 1);

  // ── §5 · the two refusals, counted ────────────────────────────────────────
  console.log("\n— §5 · dropped and counted, never guessed —");
  const noSlug = await post("/inbound-email", {
    to: "margaret@alpha-donor.test", envelopeTo: `log+not-a-real-org@${DOMAIN}`,
    from: "ie-a-admin@test.local", subject: "Hello", text: "Hi.",
  });
  ok("a slug that matches no org is DROPPED", noSlug.body.action === "drop", noSlug.body);
  const noAddr = await post("/inbound-email", {
    to: "margaret@alpha-donor.test",
    from: "ie-a-admin@test.local", subject: "Hello", text: "Hi.",
  });
  ok("no logging address at all is DROPPED — the org is never guessed from the sender",
     noAddr.body.action === "drop", noAddr.body);
  ok("both are COUNTED with no org to file them under",
     (await dropsFor(null)).length === 2, await dropsFor(null));

  const stranger = await post("/inbound-email", {
    to: "margaret@alpha-donor.test", envelopeTo: A_LOG,
    from: "anybody@the-internet.test", subject: "I saw your BCC line", text: "Adding a note.",
  });
  ok("a sender who is not a user of that org is DROPPED — this is the tenant wall",
     stranger.body.action === "drop", stranger.body);
  ok("…and counted against the org whose address was aimed at",
     (await dropsFor(A)).filter(r => r === "sender_not_user").length === 1, await dropsFor(A));
  ok("…and wrote NOTHING", (await emailsFor("d_ie_a1")).length === 1 && (await heldFor(A)).length === 1);

  const unsigned = await post("/inbound-email", { to: A_LOG, from: "ie-a-admin@test.local", subject: "x", text: "y" }, { secret: "wrong" });
  ok("a POST without the provider's shared secret is refused outright", unsigned.status === 401, unsigned.status);

  // ── §6 · the FAMILY of cross-tenant shapes ────────────────────────────────
  console.log("\n— §6 · org A's logging address can never write to org B —");
  // Org B holds one of its own FIRST, so the later shapes have a real target
  // and so the before/after hash covers it.
  const bHeld = await post("/inbound-email", {
    to: "nobody-b@stranger.test", envelopeTo: B_LOG,
    from: "ie-b-admin@test.local", subject: "B's own held message", text: "Hi.",
  });
  ok("(org B holds one of its own, so the next shapes have a target)",
     bHeld.body.action === "hold", bHeld.body);
  const bHeldId = (await heldFor(B))[0]?.id;
  const before = await hashB();
  await login("ie-b-admin@test.local");

  const s1 = await post("/inbound-email", {
    to: "zzbeta@beta-donor.test", envelopeTo: A_LOG,
    from: "ie-b-admin@test.local", subject: "B staff at A's address", text: "Hello.",
  });
  ok("[1] B's staff mailing A's logging address → dropped, not logged into A",
     s1.body.action === "drop", s1.body);

  const s2 = await post("/inbound-email", {
    to: "zzbeta@beta-donor.test", envelopeTo: A_LOG,
    from: "ie-a-admin@test.local", subject: "A staff writing to B's donor", text: "Hello.",
  });
  ok("[2] A's staff writing to B's DONOR → held in A, never matched across the wall",
     s2.body.action === "hold" && s2.body.kind === "no_match", s2.body);

  const s3 = await post("/inbound-email", {
    to: ["margaret@alpha-donor.test", B_LOG], envelopeTo: A_LOG,
    from: "ie-a-admin@test.local", subject: "Both slugs", text: "Hello.",
  });
  ok("[3] a message carrying BOTH orgs' logging addresses → ambiguous → dropped",
     s3.body.action === "drop", s3.body);

  const s4 = await post("/inbound-email", {
    to: "margaret@alpha-donor.test", envelopeTo: A_LOG,
    from: "ie-a-admin@test.local", subject: `Re: ${B_LOG}`,
    text: `Please file this under ${B_SLUG} — org ${B}.`,
  });
  ok("[4] a body and subject NAMING org B changes nothing — the envelope decides",
     s4.body.action === "log" && s4.body.donorId === "d_ie_a1", s4.body);

  const s5 = await authed("POST", "/settings/inbound-email/assign", adminA, { id: bHeldId, donorId: "d_ie_a1" });
  ok("[5] A's admin filing B's held message → 404, the codebase's one answer",
     s5.status === 404, s5.status);

  const aHeldId = (await heldFor(A)).find(h => h.kind === "no_match")?.id;
  const s6 = await authed("POST", "/settings/inbound-email/assign", adminA, { id: aHeldId, donorId: "d_ie_b1" });
  ok("[6] A's admin filing A's own message onto B's DONOR → 404",
     s6.status === 404, s6.status);

  const s7 = await authed("POST", "/settings/inbound-email/discard", adminA, { id: bHeldId });
  ok("[7] A's admin discarding B's held message → 404, and B still has it",
     s7.status === 404 && (await heldFor(B)).length === 1, s7.status);

  const s8 = await authed("GET", "/settings/inbound-email", adminA);
  const s8text = JSON.stringify(s8.body);
  // NB B's donor ADDRESS legitimately appears — A's own staff typed it into a
  // To line, and that is A's record of what A sent. What must never appear is
  // anything Steward knows about org B: its slug, its donor's NAME, its mail.
  ok("[8] A's own Settings read carries no trace of B — not its address, not its donors, not its held mail",
     !s8text.includes(B_SLUG) && !s8text.includes("Beta Only Donor")
       && !s8text.includes("d_ie_b1") && !s8text.includes("B's own held message"),
     s8text.slice(0, 200));

  ok("org B's rows are byte-identical after the whole family", (await hashB()) === before);

  // ── §7 · the demo risk: she BCCs herself ──────────────────────────────────
  console.log("\n— §7 · the director tests it by BCCing herself —");
  const selfTest = await post("/inbound-email", {
    to: "Dana Director <ie-a-admin@test.local>", envelopeTo: A_LOG,
    from: "ie-a-admin@test.local", subject: "Testing Steward logging", text: "Does this work?",
  });
  ok("it lands — immediately, on the webhook, with no queue between her and it",
     selfTest.status === 200 && selfTest.body.action === "hold" && selfTest.body.kind === "self_test", selfTest.body);
  const selfRow = (await heldFor(A)).find(h => h.kind === "self_test");
  ok("…visible in Settings, saying what it is rather than looking like a failure",
     !!selfRow && selfRow.subject === "Testing Steward logging", selfRow);
  const seen = await authed("GET", "/settings/inbound-email", adminA);
  ok("…and it is on the list she is looking at",
     seen.body.unmatched.some(u => u.kind === "self_test"), seen.body.unmatched?.map(u => u.kind));
  ok("…and it still did NOT create a donor for her own address",
     (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [A]))[0].n === 4);

  // ── §8 · off by default, and off means 404 ────────────────────────────────
  console.log("\n— §8 · the flag is off by default, and off means 404 —");
  const dropsBeforeOff = (await dropsFor(A)).length;
  const OFF_PORT = 5694;
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(OFF_PORT),
      INBOUND_EMAIL_ENABLED: "",       // the production default
      INBOUND_EMAIL_DOMAIN: "",
      INBOUND_EMAIL_SECRET: "",
    },
    stdio: "ignore",
  });
  let offUp = false;
  for (let i = 0; i < 75; i++) {
    try { const r = await fetch(`http://localhost:${OFF_PORT}/health`); if (r.ok) { offUp = true; break; } } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 400));
  }
  ok("a server booted WITHOUT the flag comes up normally", offUp);
  if (offUp) {
    const offProbe = await post("/inbound-email", { to: A_LOG, from: "ie-a-admin@test.local", subject: "x", text: "y" },
      { base: `http://localhost:${OFF_PORT}`, secret: SECRET });
    const unknown = await post("/no-such-route-at-all", {}, { base: `http://localhost:${OFF_PORT}`, secret: SECRET });
    ok("the inbound webhook is INVISIBLE — 404, byte-identical to an unknown route",
       offProbe.status === 404 && JSON.stringify(offProbe.body) === JSON.stringify(unknown.body),
       { off: offProbe, unknown });
    ok("…and a message to a switched-off server is not counted as anything",
       (await dropsFor(A)).length === dropsBeforeOff, await dropsFor(A));
  }
  child.kill("SIGKILL");

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

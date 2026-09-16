// BUILD-88c C.1 — HER OWN DOMAIN, VERIFIED. Run: node tests/build88c-domain.test.js
//
// Every donor-facing email has left through `stewardapp.dev` with the org's NAME
// in the display slot (BUILD-64). That closed the "bare unfamiliar domain" trust
// gap and did nothing about the other one: an unfamiliar SENDING domain costs
// deliverability, and on a shared domain one organisation's spam complaints drag
// down every other organisation's reputation.
//
//   §1  UNVERIFIED — Steward's domain, the org's name on it, and a Reply-To
//       that reaches a human. (It reached NOBODY before this part: donor mail
//       carried no Reply-To at all, so a donor answering a receipt was writing
//       to `noreply@`.)
//   §2  claiming a domain: what is refused, and why each refusal is a sentence
//   §3  ONE DOMAIN, ONE ORG — at the database, not in an if-statement
//   §4  VERIFIED — the org's own address, on their own domain, in the From, the
//       Reply-To and the List-Unsubscribe mailto; no Steward domain in anything
//       the recipient's inbox shows them
//   §5  nobody is blocked from sending while unverified, and the screen says
//       which of the two is in force
//   §6  releasing it drops back, and frees the domain
//
// The provider is stubbed at RESEND_BASE_URL (the same seam the mail sink uses),
// because proving a REAL verification needs a real customer's DNS — that is the
// BLOCKED item, and this suite is honest about proving the state machine and the
// headers rather than the DNS.
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const A = "org_b88cA", B = "org_b88cB";
const DOMAIN = "sparrowmissions.org";

let captured = [];
let domainState = { id: "d_res_1", name: DOMAIN, status: "pending", records: [
  { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIGfMA0GCSq...", ttl: "Auto", status: "not_started" },
  { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, ttl: "Auto", status: "not_started" },
  { record: "SPF", name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all", ttl: "Auto", status: "not_started" },
] };

// The provider, stubbed: /emails captures, /domains answers like Resend.
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", x => (b += x));
  req.on("end", () => {
    const json = (() => { try { return b ? JSON.parse(b) : null; } catch { return null; } })();
    captured.push({ path: req.url, method: req.method, body: json, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/domains" && req.method === "POST") return res.end(JSON.stringify({ ...domainState, name: json?.name || DOMAIN }));
    if (/^\/domains\//.test(req.url) && req.method === "GET") return res.end(JSON.stringify(domainState));
    if (req.url === "/domains" && req.method === "GET") return res.end(JSON.stringify({ data: [domainState] }));
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");

const CHILD = ["thank_you_drafts", "pledge_installments", "threads", "campaign_recipients", "campaigns",
  "digest_sends", "notification_sends", "email_suppressions", "receipts", "pledges", "fin_audit_log",
  "fin_transactions", "gifts", "interactions", "donors", "budgets", "accounts", "fin_funds", "imports", "users"];

async function seed(org, slug, orgName) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipt_address,receipts_enabled)
           VALUES ($1,$2,$3,1,'active','team','America/New_York','1 Main St, Lexington KY',true)`, [org, orgName, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Trelawney','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Owen Officer','user')`,
    [`u2_${org}`, org, `${slug}-staff@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active) VALUES ($1,$2,'4010','Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ($1,$2,'Margaret Chen',$3,'new','steward')`,
    [`d_${org}`, org, `margaret@${slug}.test`]);
}

// One campaign send to one donor, so the headers can be read off the wire.
async function sendCampaign(org, tok, label) {
  const camp = await api("POST", "/campaigns", tok, {
    name: `${label} appeal`, subject: "A note from us", body: "<p>Dear {{first_name}}, thank you.</p>",
    segment: { mode: "manual", donorIds: [`d_${org}`] }, status: "draft" });
  if (camp.status !== 201 && camp.status !== 200) return { error: camp };
  captured = captured.filter(e => e.path !== "/emails");
  const sent = await api("POST", `/campaigns/${camp.body.id}/send`, tok);
  // The route answers immediately and sends on a `setImmediate` — wait for the
  // wire, not for the response.
  for (let i = 0; i < 60 && mails().length === 0; i++) await new Promise(r => setTimeout(r, 100));
  return { camp: camp.body, sent, mail: mails()[0] };
}

(async () => {
  await new Promise((r, j) => { sink.on("error", j); sink.listen(SINK_PORT, r); });
  await seed(A, "b88ca", "Sparrow Missions");
  await seed(B, "b88cb", "Heart of Africa");
  const tokA = await login("b88ca@t.local");
  const tokB = await login("b88cb@t.local");
  const staffA = await login("b88ca-staff@t.local");

  // ── §1 · unverified ──────────────────────────────────────────────────────
  console.log("\n— §1 · unverified: Steward's domain, her name on it, and a reply that reaches a human —");
  const state0 = (await api("GET", "/org/sending-domain", tokA)).body;
  ok("a fresh org has no sending domain", state0.status === "none" && state0.verified === false && state0.domain === null, state0);
  ok("…and the screen says which of the two is in force, in one sentence",
    /Steward's address with your organisation's name on it, and replies come to you/.test(state0.sentence), state0.sentence);

  const before = await sendCampaign(A, tokA, "Unverified");
  ok("an unverified org can send", before.sent?.status === 200, { status: before.sent?.status, body: JSON.stringify(before.sent?.body).slice(0, 160) });
  ok("…from STEWARD's address, with the organisation's name on it",
    /^Sparrow Missions <noreply@stewardapp\.dev>$/.test(before.mail?.body?.from || ""), before.mail?.body?.from);
  ok("…and a REPLY-TO THAT REACHES A HUMAN — it reached nobody before this part",
    before.mail?.body?.reply_to === "b88ca@t.local", before.mail?.body?.reply_to);
  ok("…with the List-Unsubscribe mailto on Steward's domain, which is honest while the send is Steward's",
    /mailto:unsubscribe@stewardapp\.dev/.test(before.mail?.body?.headers?.["List-Unsubscribe"] || ""),
    before.mail?.body?.headers);

  // ── §2 · what is refused, and why ────────────────────────────────────────
  console.log("\n— §2 · what a claim refuses, each with a sentence —");
  const bad = [
    [{ fromEmail: "not-an-address" }, /real address at your own domain/i, "an address that is not one"],
    [{ fromEmail: "ada@stewardapp.dev" }, /Steward's own/i, "Steward's own domain"],
    [{ fromEmail: "ada@gmail.com" }, /mailbox provider you do not control/i, "a mailbox provider"],
    [{ fromEmail: "ada@sparrowmissions.org", domain: "someoneelse.org" }, /is not at/i, "an address that is not at the domain"],
  ];
  for (const [body, re, label] of bad) {
    const r = await api("POST", "/org/sending-domain", tokA, body);
    ok(`refused: ${label}`, r.status === 400 && re.test(r.body.message || r.body.error || ""), { status: r.status, body: r.body });
  }
  const asStaff = await api("POST", "/org/sending-domain", staffA, { fromEmail: `ada@${DOMAIN}` });
  ok("a non-admin cannot claim a domain", asStaff.status === 403, asStaff.status);

  // ── §3 · one domain, one org ─────────────────────────────────────────────
  console.log("\n— §3 · a sending domain belongs to ONE organisation —");
  const claim = await api("POST", "/org/sending-domain", tokA, { fromEmail: `ada@${DOMAIN}` });
  ok("org A claims it", claim.status === 201 && claim.body.domain === DOMAIN, { status: claim.status, body: JSON.stringify(claim.body).slice(0, 200) });
  ok("…and is given the DNS records the provider asked for, verbatim",
    claim.body.records.length === 3 && claim.body.records.some(r => r.record === "DKIM") && claim.body.records.some(r => r.type === "MX"),
    claim.body.records.map(r => [r.record, r.type, r.name]));
  ok("…and it is PENDING, not verified, because nobody has published anything yet",
    claim.body.status === "pending" && claim.body.verified === false, claim.body.status);
  ok("…and the sentence changes to say so", /Until sparrowmissions\.org verifies/.test(claim.body.sentence), claim.body.sentence);
  const createCall = captured.find(e => e.path === "/domains" && e.method === "POST");
  ok("the provider was actually asked to create it", !!createCall && createCall.body.name === DOMAIN, createCall?.body);

  const steal = await api("POST", "/org/sending-domain", tokB, { fromEmail: `hello@${DOMAIN}` });
  ok("ORG B CANNOT CLAIM IT — 409, with the reason",
    steal.status === 409 && steal.body.error === "domain_taken" && /belongs to one organisation/.test(steal.body.message),
    { status: steal.status, body: steal.body });
  const [bState] = await q(`SELECT sending_domain FROM orgs WHERE id=$1`, [B]);
  ok("…and nothing was written on org B", bState.sending_domain === null, bState);
  // The wall is at the DATABASE, not in the if-statement above it.
  let dbRefused = false;
  try { await q(`UPDATE orgs SET sending_domain=$2 WHERE id=$1`, [B, DOMAIN]); }
  catch (e) { dbRefused = /uq_orgs_sending_domain|duplicate key/.test(e.message); }
  ok("THE WALL IS THE DATABASE: a direct write of the same domain onto org B is refused too", dbRefused, null);

  // ── §4 · verified ────────────────────────────────────────────────────────
  console.log("\n— §4 · verified: her address, her domain, and no Steward in the inbox —");
  const stillPending = await api("POST", "/org/sending-domain/check", tokA);
  ok("a check before the records are published says pending, with the moment it asked",
    stillPending.body.verified === false && !!stillPending.body.checkedAt, stillPending.body.status);
  const midSend = await sendCampaign(A, tokA, "Pending");
  ok("…and a pending org still sends, on Steward's domain — nobody is blocked by a DNS record",
    /noreply@stewardapp\.dev/.test(midSend.mail?.body?.from || ""), midSend.mail?.body?.from);

  domainState = { ...domainState, status: "verified", records: domainState.records.map(r => ({ ...r, status: "verified" })) };
  const verified = await api("POST", "/org/sending-domain/check", tokA);
  ok("with the records published, the check flips to VERIFIED", verified.body.verified === true && verified.body.status === "verified", verified.body.status);
  ok("…with the date it verified", !!verified.body.verifiedAt, verified.body.verifiedAt);
  ok("…and the sentence says what donors will see",
    /Your email goes out from ada@sparrowmissions\.org/.test(verified.body.sentence), verified.body.sentence);

  const after = await sendCampaign(A, tokA, "Verified");
  ok("an appeal now goes out FROM HER ADDRESS AT HER DOMAIN",
    after.mail?.body?.from === `Sparrow Missions <ada@${DOMAIN}>`, after.mail?.body?.from);
  ok("…with no Reply-To, because the From is already a person who can be replied to",
    after.mail?.body?.reply_to === undefined, after.mail?.body?.reply_to);
  ok("…and the List-Unsubscribe mailto on HER domain",
    /mailto:unsubscribe@sparrowmissions\.org/.test(after.mail?.body?.headers?.["List-Unsubscribe"] || ""),
    after.mail?.body?.headers?.["List-Unsubscribe"]);
  // THE ASSERTION THE PART IS ABOUT: nothing the inbox shows says Steward.
  const inboxVisible = JSON.stringify({ from: after.mail?.body?.from, to: after.mail?.body?.to,
    subject: after.mail?.body?.subject, reply_to: after.mail?.body?.reply_to,
    listUnsub: after.mail?.body?.headers?.["List-Unsubscribe"]?.split(",")[0] });
  ok("NO STEWARD DOMAIN IN ANYTHING THE RECIPIENT'S INBOX SHOWS THEM",
    !/steward/i.test(inboxVisible), inboxVisible);

  // A receipt is the other email a donor actually reads.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ($1,$2,$3,250,$4,'cash',$5,'Check')`, [`g_${A}`, A, `d_${A}`, civilToday(), `ff_${A}`]);
  captured = captured.filter(e => e.path !== "/emails");
  const rec = await api("POST", `/gifts/g_${A}/receipt`, tokA, {});
  ok("a receipt issues", rec.status === 200 || rec.status === 201, { status: rec.status, body: JSON.stringify(rec.body).slice(0, 160) });
  for (let i = 0; i < 60 && mails().length === 0; i++) await new Promise(r => setTimeout(r, 100));
  const recMail = mails()[0];
  ok("…and it goes out from her address at her domain too",
    recMail && recMail.body.from === `Sparrow Missions <ada@${DOMAIN}>`, recMail?.body?.from);

  // ── §5 · org B is untouched ──────────────────────────────────────────────
  console.log("\n— §5 · the other organisation is untouched —");
  const bSend = await sendCampaign(B, tokB, "Other org");
  ok("org B still sends on Steward's shared domain, with ITS name",
    /^Heart of Africa <noreply@stewardapp\.dev>$/.test(bSend.mail?.body?.from || ""), bSend.mail?.body?.from);
  ok("…and never on org A's domain", !new RegExp(DOMAIN).test(JSON.stringify(bSend.mail?.body || {})), bSend.mail?.body?.from);
  const bState2 = (await api("GET", "/org/sending-domain", tokB)).body;
  ok("…and org B's screen still offers its own", bState2.status === "none" && bState2.verified === false, bState2.status);

  // ── §6 · releasing it ────────────────────────────────────────────────────
  console.log("\n— §6 · releasing it drops back, and frees the domain —");
  const rel = await api("DELETE", "/org/sending-domain", tokA);
  ok("org A releases it", rel.status === 200 && rel.body.released === DOMAIN, rel.body);
  const backToShared = await sendCampaign(A, tokA, "Released");
  ok("…and the next appeal is back on Steward's domain with a Reply-To",
    /noreply@stewardapp\.dev/.test(backToShared.mail?.body?.from || "") && !!backToShared.mail?.body?.reply_to,
    backToShared.mail?.body);
  const nowB = await api("POST", "/org/sending-domain", tokB, { fromEmail: `hello@${DOMAIN}` });
  ok("…and the organisation that actually owns it can now claim it", nowB.status === 201 && nowB.body.domain === DOMAIN, nowB.status);

  summary("build88c-domain");
  sink.close();
  await closeDb();
})();

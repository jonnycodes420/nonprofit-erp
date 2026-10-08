// tests/int3-optout.test.js — INT-3. THE ONE GUARD THIS BUILD EARNED.
//
//     A PERSON WHO UNSUBSCRIBES IN THE EMAIL TOOL IS MARKED OPTED OUT IN
//     STEWARD, AND THE NEXT AUDIENCE SYNC DOES NOT PUSH THEM AGAIN.
//
// This is the failure the whole build is arranged to prevent. An organisation
// connects Mailchimp so Steward can keep an audience in step; somebody
// unsubscribes in Mailchimp; if Steward does not hear it, or hears it and
// pushes them back anyway, then the next newsletter goes to a person who asked
// to stop. That costs the organisation the relationship and its sending
// reputation, and it is the one mistake an integration like this can make that
// a customer would be right never to forgive.
//
// WHAT IS ASSERTED:
//   §1  Mailchimp's `unsubscribe` webhook writes the opt-out through the ONE
//       path BUILD-94 already owns: a row in `email_suppressions`. No second
//       flag, and the donor's own timeline says what happened.
//   §2  A `cleaned` event is UNREACHABLE, not unsubscribed. BUILD-94 keeps
//       those apart and so does this: the address stopped working, she did not
//       ask to stop.
//   §3  A `subscribe` event changes NOTHING. Steward never re-subscribes
//       anybody on a third party's word: the more restrictive answer wins.
//   §4  The push decision refuses every opted-out person, so the payload the
//       sync would send cannot contain them. This is the assertion that makes
//       "does not push them again" structural rather than a filter somebody
//       has to remember.
//   §5  The preview an organisation reads BEFORE saving a mapping counts the
//       same way and says who is held back and why.
//   §6  A webhook with a wrong or missing secret writes NOTHING, and answers
//       the same flat 200 a good one does, so the URL cannot be probed.
//   §7  Org A's webhook secret cannot write an opt-out onto org B.
//
// HOW IT WOULD GO RED: make `pushDecision` ignore `optedOut`; act on a
// `subscribe` event; look the connection up by provider instead of by secret;
// or write a second opted-out column and read that one on the push.
// Proven able to fail: removing the `optedOut` check in pushDecision turns §4
// and §5 red, and acting on `subscribe` turns §3 red.
//
// NO REAL PROVIDER IS CONTACTED. The webhook is an inbound request, and §4 and
// §5 assert on the decision and the preview rather than on an outbound call, so
// this suite reaches nobody.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_int3a", B = "org_int3b";
const PW = bcrypt.hashSync("loadtest1234", 10);
const SECRET_A = "int3testsecretAAAAAAAAAAAAAAAAAA";
const SECRET_B = "int3testsecretBBBBBBBBBBBBBBBBBB";

const TABLES = ["email_marketing_activity", "email_marketing_campaigns", "email_marketing_connections",
                "email_suppressions", "interactions", "gifts", "donors", "audiences", "users"];

async function reset() {
  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [o, `INT3 ${o}`, `int3-${o}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin','admin')`, [`u_${o}`, o, `${o}@int3.local`, PW]);
  }
  // A connection per org, each with its own webhook secret and NO credentials:
  // this suite never needs a token because it never calls out.
  await q(`INSERT INTO email_marketing_connections
             (id,org_id,provider,status,server_prefix,audience_id,audience_name,mapping,webhook_secret,
              created_by,created_by_name)
           VALUES ($1,$2,'mailchimp','active','us14','aud_a','List A',$3::jsonb,$4,'system:test','test')`,
    ["emc_a", A, JSON.stringify({ audienceId: "aud_a", groups: { "builtin:donors": "Donors" } }), SECRET_A]);
  await q(`INSERT INTO email_marketing_connections
             (id,org_id,provider,status,server_prefix,audience_id,audience_name,mapping,webhook_secret,
              created_by,created_by_name)
           VALUES ($1,$2,'mailchimp','active','us14','aud_b','List B',$3::jsonb,$4,'system:test','test')`,
    ["emc_b", B, JSON.stringify({ audienceId: "aud_b", groups: { "builtin:donors": "Donors" } }), SECRET_B]);

  // Four donors in org A, all reachable to begin with, all with gifts so they
  // are in "All donors".
  const people = [
    ["d_a_unsub", "Marion Reed", "marion.int3@int3-fixture.org"],
    ["d_a_clean", "Rita Bounce", "rita.int3@int3-fixture.org"],
    ["d_a_resub", "Paul Steady", "paul.int3@int3-fixture.org"],
    ["d_a_ok", "Nora Fine", "nora.int3@int3-fixture.org"],
  ];
  for (const [id, name, email] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active',100,'system:test','test')`, [id, A, name, email]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,100,CURRENT_DATE,'system:test','test')`, [`g_${id}`, A, id]);
  }
  // One donor in org B, with the SAME address as org A's unsubscriber, which is
  // what makes §7 mean something: one person may be on two organisations'
  // lists, and an unsubscribe from one is not an unsubscribe from the other.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Marion Reed','marion.int3@int3-fixture.org','active',100,'system:test','test')`,
    ["d_b_same", B]);
}

// Mailchimp POSTs form-encoded, with its bracketed field names.
async function webhook(secret, type, email) {
  const body = new URLSearchParams({ type, "data[email]": email, "data[list_id]": "aud_a" });
  const r = await fetch(`${BASE}/mailchimp/webhook/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const suppressions = (orgId, email) => q(
  `SELECT reason, source FROM email_suppressions WHERE org_id=$1 AND LOWER(email)=$2`, [orgId, email]);
const donorRow = id => q(
  `SELECT do_not_email, email_unreachable, email_unreachable_reason FROM donors WHERE id=$1`, [id]).then(r => r[0]);
const timeline = id => q(
  `SELECT note, created_by FROM interactions WHERE donor_id=$1 AND type='email'`, [id]);

(async () => {
  await reset();
  const tokA = await login(`${A}@int3.local`);

  const EM = await import("../shared/emailMarketing.js");

  // ── §1 · AN UNSUBSCRIBE IN THE TOOL IS AN OPT-OUT IN STEWARD ────────────
  const w1 = await webhook(SECRET_A, "unsubscribe", "marion.int3@int3-fixture.org");
  ok("§1 the webhook is accepted", w1.status === 200, `status ${w1.status}`);
  const s1 = await suppressions(A, "marion.int3@int3-fixture.org");
  ok("§1 a suppression row exists, which is the ONE opt-out path",
    s1.length === 1 && s1[0].reason === "unsubscribed", JSON.stringify(s1));
  const d1 = await donorRow("d_a_unsub");
  ok("§1 an unsubscribe is NOT recorded as a bounce", d1.email_unreachable !== true,
    `email_unreachable=${d1.email_unreachable}`);
  const t1 = await timeline("d_a_unsub");
  ok("§1 the donor's own timeline says what happened",
    t1.some(r => /unsubscribed in mailchimp/i.test(r.note)), JSON.stringify(t1));
  ok("§1 and the actor is the system path that wrote it",
    t1.every(r => String(r.created_by || "").startsWith("system:email-marketing/")), JSON.stringify(t1));

  // ── §2 · CLEANED IS UNREACHABLE, NOT UNSUBSCRIBED ───────────────────────
  await webhook(SECRET_A, "cleaned", "rita.int3@int3-fixture.org");
  const d2 = await donorRow("d_a_clean");
  ok("§2 a cleaned address is marked unreachable", d2.email_unreachable === true,
    `email_unreachable=${d2.email_unreachable}`);
  ok("§2 …with the reason on the record",
    /mailchimp/i.test(String(d2.email_unreachable_reason || "")), String(d2.email_unreachable_reason));

  // ── §3 · STEWARD NEVER RE-SUBSCRIBES ANYBODY ────────────────────────────
  // Paul is suppressed in Steward already. Mailchimp says he is subscribed.
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source)
           VALUES ('sup_int3_paul',$1,'paul.int3@int3-fixture.org','unsubscribed','campaign')`, [A]);
  const w3 = await webhook(SECRET_A, "subscribe", "paul.int3@int3-fixture.org");
  ok("§3 a subscribe event is accepted and ignored", w3.status === 200, `status ${w3.status}`);
  const s3 = await suppressions(A, "paul.int3@int3-fixture.org");
  ok("§3 the suppression is STILL there: the more restrictive answer wins",
    s3.length === 1, JSON.stringify(s3));
  ok("§3 and the module agrees unsubscribed outranks subscribed",
    EM.moreRestrictive("subscribed", "unsubscribed") === "unsubscribed",
    EM.moreRestrictive("subscribed", "unsubscribed"));

  // ── §4 · THE NEXT SYNC CANNOT PUSH THEM ─────────────────────────────────
  // The preview endpoint builds the very payload the push walks, from the same
  // `previewCounts`, so what it returns IS what would be sent.
  const prev = await api("POST", "/email-marketing/mailchimp/preview", tokA,
    { groups: { "builtin:donors": "Donors" } });
  ok("§4 the preview runs", prev.status === 200, `status ${prev.status} ${JSON.stringify(prev.body)}`);
  const held = Object.fromEntries((prev.body.excluded || []).map(e => [e.key, e.count]));
  ok("§4 the unsubscriber is held back", (held.opted_out || 0) >= 1, JSON.stringify(held));
  ok("§4 the bounced address is held back too", (held.unreachable || 0) >= 1, JSON.stringify(held));
  ok("§4 only the one reachable donor is left to send",
    prev.body.total === 1, `total=${prev.body.total}`);

  // And the pure decision, directly, because that is the function the push
  // walks and it must refuse without anybody remembering to filter.
  ok("§4 pushDecision refuses an opted-out person",
    EM.pushDecision({ email: "x@int3-fixture.org", optedOut: true }).push === false,
    JSON.stringify(EM.pushDecision({ email: "x@int3-fixture.org", optedOut: true })));
  ok("§4 …and refuses a bounced one",
    EM.pushDecision({ email: "x@int3-fixture.org", emailUnreachable: true }).push === false, "pushed");
  ok("§4 …and allows a reachable one",
    EM.pushDecision({ email: "x@int3-fixture.org" }).push === true, "refused");

  // ── §5 · THE PREVIEW SAYS WHY, NOT JUST HOW MANY ────────────────────────
  ok("§5 every held-back group carries the sentence a person reads",
    (prev.body.excluded || []).every(e => typeof e.sentence === "string" && e.sentence.length > 20),
    JSON.stringify(prev.body.excluded));
  ok("§5 and the count has its own definition",
    typeof prev.body.definition === "string" && prev.body.definition.length > 20, prev.body.definition);

  // ── §6 · A WRONG SECRET WRITES NOTHING AND GIVES NOTHING AWAY ───────────
  const before = (await q(`SELECT COUNT(*)::int n FROM email_suppressions WHERE org_id=$1`, [A]))[0].n;
  const bad = await webhook("wrongsecretwrongsecretwrong", "unsubscribe", "nora.int3@int3-fixture.org");
  ok("§6 a wrong secret answers the same flat 200", bad.status === 200, `status ${bad.status}`);
  const after = (await q(`SELECT COUNT(*)::int n FROM email_suppressions WHERE org_id=$1`, [A]))[0].n;
  ok("§6 …and wrote nothing", after === before, `${before} -> ${after}`);
  const dOk = await donorRow("d_a_ok");
  ok("§6 …and the person is still reachable",
    dOk.do_not_email !== true && dOk.email_unreachable !== true, JSON.stringify(dOk));

  // ── §7 · ONE ORG'S SECRET CANNOT WRITE ONTO ANOTHER ─────────────────────
  // Marion is on both lists. Org B's secret unsubscribing her must land on org
  // B and never touch org A's already-separate row, and vice versa.
  const bBefore = (await q(`SELECT COUNT(*)::int n FROM email_suppressions WHERE org_id=$1`, [B]))[0].n;
  ok("§7 org B starts with no suppressions", bBefore === 0, `n=${bBefore}`);
  await webhook(SECRET_B, "unsubscribe", "marion.int3@int3-fixture.org");
  const sB = await suppressions(B, "marion.int3@int3-fixture.org");
  ok("§7 org B's secret writes onto org B", sB.length === 1, JSON.stringify(sB));
  const sAstill = await suppressions(A, "marion.int3@int3-fixture.org");
  ok("§7 …and org A still has exactly its own one row, not two",
    sAstill.length === 1, JSON.stringify(sAstill));
  const crossTimeline = await q(
    `SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND donor_id='d_a_unsub'`, [B]);
  ok("§7 …and nothing was written onto the other org's donor",
    Number(crossTimeline[0].n) === 0, JSON.stringify(crossTimeline));

  for (const o of [A, B]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary("INT-3 — an unsubscribe in the email tool is an unsubscribe in Steward");
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

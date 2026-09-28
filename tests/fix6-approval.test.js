// FIX-6 item 1 — NOTHING REACHES THE SEND PATH WITHOUT THE APPROVE CLICK.
//
// THE ONE TEST THIS BUILD ADDS, and it guards the line that is never crossed:
// agents read, draft and propose; a human signs anything that reaches a donor.
//
// The approval queue had no way to approve or skip anything, so this build
// added a door onto four kinds of waiting item. A door onto the send path is
// exactly the thing that must not open by itself. The whole danger of the fix
// is that it is now ONE POST away from marking a thank-you sent, closing a
// thread, and acknowledging a gift, and that a bug which fires it early or
// fires it twice would do so silently on a real donor's record.
//
// So this drives the whole queue with a live Resend sink bound and asserts:
//   §1  the queue offers approve and skip on every kind that has them, and
//       REFUSES the one kind that must not be approved this way (a gift)
//   §2  building the queue changes NOTHING — reading is not acting
//   §3  approve does exactly what the item says, once, in her name
//   §4  skip closes the item and does NOT do the thing
//   §5  the sink saw NOTHING, through the entire queue
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · GET /agent/waiting marking anything sent        → §2 fails
//   · approve mailing the donor                       → §5 fails
//   · approve running twice on one press              → §3 fails
//   · skip marking the thank-you sent                 → §4 fails
//   · the gift kind accepted by the generic approve   → §1 fails

const http = require("http");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_fix6approval";
const USER = "u_fix6approval";
const EMAIL = "fix6-approval@t.local";
const PASS = "loadtest1234";

// ── THE MAIL SINK ─────────────────────────────────────────────────────────
// The server is booted with RESEND_BASE_URL pointing here. Anything that tries
// to mail ANYBODY during this suite lands in `captured`, and §5's whole
// assertion is that the array is empty.
const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        captured.push({ url: req.url, method: req.method, body: body.slice(0, 4000) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function reset() {
  for (const t of ["thank_you_drafts", "tribute_notices", "agent_drafts", "threads",
                   "interactions", "fin_transactions", "gifts", "moves", "donors", "users",
                   "accounts", "budgets", "fin_funds", "fin_audit_log"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  const sink = await startSink();
  const today = civilToday();
  await reset();

  // ── the fixture: one org, one donor, one gift, and one of each waiting kind
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled)
           VALUES ($1,'Approval HQ','approval-hq',1,'active','t1000_monthly',true)`, [ORG]);
  const bcrypt = require("bcryptjs");
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Approver','admin')`,
          [USER, ORG, EMAIL, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count)
           VALUES ('d_fix6',$1,'Perpetua Quillfeather','perpetua@example.demo',500,1)`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type)
           VALUES ('g_fix6',$1,'d_fix6',500,$2,'cash')`, [ORG, today]);
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice)
           VALUES ('ty_fix6',$1,'d_fix6','g_fix6','Thank you for your gift of $500.','default')`, [ORG]);
  // ONE DRAFT PER GIFT is a unique index, so the draft to be skipped needs a
  // gift of its own. The fixture respecting the rule is the point: a fixture
  // that had to break it would mean the rule was not real.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type)
           VALUES ('g_fix6b',$1,'d_fix6',250,$2,'cash')`, [ORG, today]);
  await q(`INSERT INTO thank_you_drafts (id,org_id,donor_id,gift_id,body,voice)
           VALUES ('ty_fix6b',$1,'d_fix6','g_fix6b','A second draft, to be skipped.','default')`, [ORG]);
  await q(`INSERT INTO agent_drafts (id,org_id,donor_id,subject,body,cites,status)
           VALUES ('ad_fix6',$1,'d_fix6','A note','Some words Steward wrote.','["g_fix6"]'::jsonb,'pending')`, [ORG]);

  const token = await login(EMAIL, PASS);

  console.log("— §1 · the queue offers a door, and refuses the one it must not open —");
  const q1 = await api("GET", "/agent/waiting", token);
  ok("the queue lists what is waiting", q1.status === 200 && q1.body.count >= 3, q1.body && q1.body.count);
  const kinds = new Set((q1.body.items || []).map(i => i.kind));
  ok("…including the thank-yous and the drafted note",
     kinds.has("thank_you") && kinds.has("agent_draft"), [...kinds]);

  // A GIFT IS NOT APPROVED THIS WAY. Money is confirmed by running its plan,
  // and a generic approve button over a queue is exactly the shortcut that
  // rule exists to prevent. The server refuses it by name.
  const giftTry = await api("POST", "/agent/waiting/gift_to_confirm/anything/approve", token, {});
  ok("a GIFT cannot be approved through the general queue door",
     giftTry.status === 400 && /plan/i.test(giftTry.body.message || ""), giftTry.body);
  const bogus = await api("POST", "/agent/waiting/something_else/x/approve", token, {});
  ok("…and a kind that does not exist is refused, never guessed at", bogus.status === 400, bogus.body);

  console.log("\n— §2 · reading the queue changes nothing —");
  const beforeRead = await q(
    `SELECT sent_at, skipped_at FROM thank_you_drafts WHERE id='ty_fix6' AND org_id=$1`, [ORG]);
  await api("GET", "/agent/waiting", token);
  await api("GET", "/agent/waiting", token);
  const afterRead = await q(
    `SELECT sent_at, skipped_at FROM thank_you_drafts WHERE id='ty_fix6' AND org_id=$1`, [ORG]);
  ok("building the queue three times marked nothing sent or skipped",
     !afterRead[0].sent_at && !afterRead[0].skipped_at
     && String(beforeRead[0].sent_at) === String(afterRead[0].sent_at), afterRead[0]);
  const noInt = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1`, [ORG]);
  ok("…and logged nothing on the donor's record", noInt[0].n === 0, noInt[0]);

  console.log("\n— §3 · approve does what the item says, once, in her name —");
  const ap = await api("POST", "/agent/waiting/thank_you/ty_fix6/approve", token, {});
  ok("approving a thank-you succeeds", ap.status === 200 && ap.body.ok === true, ap.body);
  ok("…and says what it did", /sent/i.test(ap.body.sentence || ""), ap.body.sentence);
  const ty = await q(`SELECT sent_at, skipped_at FROM thank_you_drafts WHERE id='ty_fix6' AND org_id=$1`, [ORG]);
  ok("…the draft is marked sent", !!ty[0].sent_at && !ty[0].skipped_at, ty[0]);
  const ints = await q(
    `SELECT type, note, logged_by_name, metadata->>'via' AS via FROM interactions WHERE org_id=$1`, [ORG]);
  ok("…exactly ONE interaction was logged", ints.length === 1, ints);
  ok("…in HER name, not Steward's",
     ints[0] && ints[0].logged_by_name === "Ada Approver" && ints[0].via === "approval_queue", ints[0]);
  const gift = await q(`SELECT acknowledgement_sent FROM gifts WHERE id='g_fix6' AND org_id=$1`, [ORG]);
  ok("…and the gift is acknowledged", gift[0].acknowledgement_sent === true, gift[0]);

  // PRESSING IT AGAIN MUST NOT DO IT AGAIN. A double press is a person, not a
  // bug, and it must not log a second line on a donor's record.
  const again = await api("POST", "/agent/waiting/thank_you/ty_fix6/approve", token, {});
  const intsAfter = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1`, [ORG]);
  ok("approving the SAME item twice logs nothing a second time",
     intsAfter[0].n === 1, { second: again.body, interactions: intsAfter[0].n });

  const q2 = await api("GET", "/agent/waiting", token);
  ok("…and the queue count came down by one", q2.body.count === q1.body.count - 1,
     { before: q1.body.count, after: q2.body.count });

  console.log("\n— §4 · skip closes it and does NOT do the thing —");
  const sk = await api("POST", "/agent/waiting/thank_you/ty_fix6b/skip", token, { reason: "She rang them instead" });
  ok("skipping succeeds", sk.status === 200 && sk.body.ok === true, sk.body);
  ok("…and carries the reason back", /rang them/i.test(sk.body.sentence || ""), sk.body.sentence);
  const skipped = await q(
    `SELECT sent_at, skipped_at FROM thank_you_drafts WHERE id='ty_fix6b' AND org_id=$1`, [ORG]);
  ok("…the draft is set aside, and emphatically not sent",
     !!skipped[0].skipped_at && !skipped[0].sent_at, skipped[0]);
  const intsSkip = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1`, [ORG]);
  ok("…and skipping logged nothing on the record", intsSkip[0].n === 1, intsSkip[0]);

  const adSkip = await api("POST", "/agent/waiting/agent_draft/ad_fix6/skip", token, { reason: "Not this one" });
  ok("a drafted note can be skipped too", adSkip.status === 200, adSkip.body);
  const ad = await q(`SELECT status, skip_reason FROM agent_drafts WHERE id='ad_fix6' AND org_id=$1`, [ORG]);
  ok("…and it is skipped with the reason, never sent",
     ad[0].status === "skipped" && /not this one/i.test(ad[0].skip_reason || ""), ad[0]);

  console.log("\n— §5 · the sink saw NOTHING, through the whole queue —");
  ok("NOTHING WAS SENT — the mail sink saw no request at all while the queue was "
     + "read three times, one item approved twice and two items skipped",
     captured.length === 0,
     `sink captured ${captured.length}: ` + JSON.stringify(captured).slice(0, 600));

  sink.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

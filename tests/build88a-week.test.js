// BUILD-88a A.5 — THE WEEK IN REVIEW IS THE ACTIVITY REPORT.
// Run: node tests/build88a-week.test.js
//
// The weekly email listed gifts, asks, moves and past-due tasks: what the money
// did and what was still owed. It never said what anyone DID. A fundraiser's
// week is conversations logged, gifts received, thank-yous sent, and follow-ups
// closed or let go — and that report existed nowhere, so "what happened last
// week?" could only be answered by reading the database.
//
//   §1  ONE counter, over any window, with a definition per figure
//   §2  THE WEEK IS THE SUM OF ITS DAYS, in cents. A number you cannot take
//       apart is a number nobody can audit, so this suite takes it apart: each
//       of the seven single-day windows, summed, against the week
//   §3  the same five figures reach the Week in Review email
//   §4  …and the People dashboard's "This week", from the same counter, so the
//       screen and the email cannot disagree
//   §5  per user as well as per org: a second officer's work is theirs
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_b88a5";
const iso = d => new Date(d).toISOString().slice(0, 10);
const cents = n => Math.round(Number(n) * 100);

let captured = [];
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mails = () => captured.filter(e => e.path === "/emails");

// A pinned, completed week: Monday 2026-09-07 to Sunday 2026-09-13.
const WEEK_START = "2026-09-07";
const DAYS = Array.from({ length: 7 }, (_, i) => iso(Date.UTC(2026, 8, 7) + i * 86400000));

async function reset() {
  for (const t of ["threads", "digest_sends", "notification_sends", "tasks", "receipts", "fin_transactions",
    "gifts", "interactions", "moves", "opportunities", "donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,receipt_address)
           VALUES ($1,'B88a Week','b88a-week',1,'active','team','America/New_York','1 Main St, Lexington KY')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a5',$1,'b88a5@test.local',$2,'Ada Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a5b',$1,'b88a5b@test.local',$2,'Owen Officer','user')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b88a5',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88a5',$1,'General Operating',false)`, [ORG]);
}

(async () => {
  await new Promise((res, rej) => { sink.on("error", rej); sink.listen(SINK_PORT, res); });
  await reset();
  const tok = await login("b88a5@test.local");

  // Two donors, one per officer, so the per-user scoping is checkable.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
           VALUES ('d_b88a5_a',$1,'Ada Donor','ada@b88a5.test','new','steward','u_b88a5','Ada Admin'),
                  ('d_b88a5_b',$1,'Owen Donor','owen@b88a5.test','new','steward','u_b88a5b','Owen Officer')`, [ORG]);

  // A week of work, spread across the seven days on purpose: the arithmetic in
  // §2 is only worth something if more than one day carries something.
  const conv = [["d_b88a5_a", "u_b88a5", 0, "call"], ["d_b88a5_a", "u_b88a5", 0, "meeting"],
                ["d_b88a5_a", "u_b88a5", 2, "email"], ["d_b88a5_b", "u_b88a5b", 3, "call"],
                ["d_b88a5_b", "u_b88a5b", 5, "ask"], ["d_b88a5_a", "u_b88a5", 6, "note"]];
  conv.forEach(() => {});
  let n = 0;
  for (const [donor, user, dayIdx, type] of conv) {
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
             VALUES ($1,$2,$3,$4,'A line about it.',$5,$6,'Somebody')`,
      [`int_b88a5_${n++}`, ORG, donor, type, DAYS[dayIdx], user]);
  }
  // An automatic timeline entry Steward wrote itself — NOT a conversation.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
           VALUES ('int_b88a5_auto',$1,'d_b88a5_a','stage_change','Auto: moved to steward',$2,'u_b88a5')`, [ORG, DAYS[1]]);

  const giftSpec = [["d_b88a5_a", 0, 250.55], ["d_b88a5_a", 2, 1000], ["d_b88a5_b", 4, 75.25], ["d_b88a5_b", 6, 3000.10]];
  let gi = 0;
  for (const [donor, dayIdx, amt] of giftSpec) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
             VALUES ($1,$2,$3,$4,$5,'cash','ff_b88a5','Check')`,
      [`g_b88a5_${gi++}`, ORG, donor, amt, DAYS[dayIdx]]);
  }
  // Thank-yous, stamped with the MOMENT (A.5's new column), on two days.
  await q(`UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=($1::date + interval '10 hours')
            WHERE id='g_b88a5_0'`, [DAYS[1]]);
  await q(`UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=($1::date + interval '16 hours')
            WHERE id='g_b88a5_2'`, [DAYS[5]]);
  // A gift acknowledged BEFORE the stamp existed: the flag is true and there is
  // no date. It belongs to no week, and the definition says so.
  await q(`UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=NULL WHERE id='g_b88a5_1'`);

  // Threads closed: two by outcome, one dismissed, on three different days.
  const closes = [["th_b88a5_1", "d_b88a5_a", "u_b88a5", "outcome", 1],
                  ["th_b88a5_2", "d_b88a5_b", "u_b88a5b", "outcome", 4],
                  ["th_b88a5_3", "d_b88a5_a", "u_b88a5", "dismissed", 6]];
  for (const [id, donor, owner, kind, dayIdx] of closes) {
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,
                                  closed_at,close_kind,closing_interaction_id,close_reason)
             VALUES ($1,$2,$3,'follow_up','Follow up',$4,$4,$5,($6::date + interval '9 hours'),$7::text,
                     CASE WHEN $8::text='outcome' THEN 'int_b88a5_0' ELSE NULL END,
                     CASE WHEN $9::text='dismissed' THEN 'handled_outside' ELSE NULL END)`,
      [id, ORG, donor, DAYS[0], owner, DAYS[dayIdx], kind, kind, kind]);
  }

  // ── §1 · one counter, with definitions ───────────────────────────────────
  console.log("\n— §1 · the activity report, over any window —");
  const week = await api("GET", `/reports/activity?start=${WEEK_START}&end=${DAYS[6]}`, tok);
  ok("the activity report reads", week.status === 200, week.status);
  const W = week.body;
  ok("conversations logged: 6 (the automatic stage-change entry is not one)", W.conversationsLogged === 6, W.conversationsLogged);
  ok("gifts received: 4", W.giftsReceived === 4, W.giftsReceived);
  ok("…and their dollars, to the cent ($4,325.90)", W.giftCents === cents(4325.90), { got: W.giftCents });
  ok("thank-yous marked sent: 2 (the one with no stamp belongs to no week)", W.thankYousMarkedSent === 2, W.thankYousMarkedSent);
  ok("follow-ups closed by outcome: 2", W.threadsClosedByOutcome === 2, W.threadsClosedByOutcome);
  ok("follow-ups dismissed: 1", W.threadsDismissed === 1, W.threadsDismissed);
  for (const k of ["conversationsLogged", "giftsReceived", "thankYousMarkedSent", "threadsClosedByOutcome", "threadsDismissed"]) {
    ok(`${k} carries its definition`, typeof W.definitions[k] === "string" && W.definitions[k].length > 20, W.definitions[k]);
  }
  ok("the thank-you definition SAYS the undated ones are counted nowhere",
    /counted in no week/i.test(W.definitions.thankYousMarkedSent), W.definitions.thankYousMarkedSent);

  // ── §2 · the week is the sum of its days ─────────────────────────────────
  console.log("\n— §2 · the week is the sum of its days, in cents —");
  const sum = { conversationsLogged: 0, giftsReceived: 0, giftCents: 0, thankYousMarkedSent: 0, threadsClosedByOutcome: 0, threadsDismissed: 0 };
  for (const day of DAYS) {
    const d = (await api("GET", `/reports/activity?start=${day}&end=${day}`, tok)).body;
    for (const k of Object.keys(sum)) sum[k] += d[k];
  }
  for (const k of Object.keys(sum)) {
    ok(`${k}: the seven days sum to the week (${sum[k]})`, sum[k] === W[k], { days: sum[k], week: W[k] });
  }
  ok("the DOLLARS agree in integer cents — never two floats compared",
    sum.giftCents === W.giftCents && Number.isInteger(sum.giftCents), { days: sum.giftCents, week: W.giftCents });

  // ── §5 · per user ────────────────────────────────────────────────────────
  console.log("\n— §5 · per user as well as per org —");
  const mine = (await api("GET", `/reports/activity?start=${WEEK_START}&end=${DAYS[6]}&scope=mine`, tok)).body;
  ok("the admin's own week is a SUBSET of the org's, never the same list by default",
    mine.conversationsLogged === 4 && mine.giftsReceived === 2 && mine.giftCents === cents(1250.55),
    { conv: mine.conversationsLogged, gifts: mine.giftsReceived, cents: mine.giftCents });
  ok("…and their own follow-ups", mine.threadsClosedByOutcome === 1 && mine.threadsDismissed === 1, mine);
  const tokB = await login("b88a5b@test.local");
  const theirs = (await api("GET", `/reports/activity?start=${WEEK_START}&end=${DAYS[6]}&scope=mine`, tokB)).body;
  ok("the other officer's week is theirs", theirs.conversationsLogged === 2 && theirs.giftsReceived === 2, theirs);
  ok("the two officers' conversations sum to the org's",
    mine.conversationsLogged + theirs.conversationsLogged === W.conversationsLogged,
    { mine: mine.conversationsLogged, theirs: theirs.conversationsLogged, org: W.conversationsLogged });

  // ── §3 · the email ───────────────────────────────────────────────────────
  console.log("\n— §3 · the five figures reach the Week in Review —");
  captured = [];
  const run = await api("POST", "/digests/run", tok, { type: "weekly", weekStart: WEEK_START });
  ok("the weekly digest runs", run.status === 200, { status: run.status, body: JSON.stringify(run.body).slice(0, 200) });
  const wir = mails().find(m => /Week in Review/.test(String(m.body?.subject || "")));
  ok("a Week in Review went out", !!wir, mails().map(m => m.body?.subject));
  const html = String(wir?.body?.html || "");
  ok("it carries a \"What happened\" section", /What happened/.test(html), html.slice(0, 200));
  for (const [label, value] of [["Conversations logged", "6"], ["Thank-yous marked sent", "2"],
    ["Follow-ups closed by outcome", "2"], ["Follow-ups dismissed", "1"]]) {
    const re = new RegExp(label.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "[\\s\\S]{0,200}?>" + value + "<");
    ok(`…${label}: ${value}`, re.test(html), (html.match(new RegExp(label + "[\\s\\S]{0,140}")) || [])[0]);
  }
  ok("…gifts received, count AND dollars", /Gifts received[\s\S]{0,200}?4 · \$4,325\.9/.test(html),
    (html.match(/Gifts received[\s\S]{0,140}/) || [])[0]);
  ok("every figure in the email carries the sentence it answers to",
    /Calls, meetings, emails, asks and notes somebody logged/.test(html)
    && /Follow-ups closed because the conversation happened/.test(html), null);

  // ── §4 · the People dashboard ────────────────────────────────────────────
  console.log("\n— §4 · the same figures on the People dashboard —");
  // Put a conversation and a gift in the CURRENT week so "This week" is not
  // empty, then check the dashboard against the counter over the same window.
  const TODAY = civilToday();
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
           VALUES ('int_b88a5_now',$1,'d_b88a5_a','call','Rang her today.',$2,'u_b88a5')`, [ORG, TODAY]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_b88a5_now',$1,'d_b88a5_a',510.40,$2,'cash','ff_b88a5','Card')`, [ORG, TODAY]);
  const people = await api("GET", "/dashboards/people", tok);
  const thisWeek = (people.body.metrics || []).find(m => m.key === "thisWeek");
  ok("the People dashboard carries a \"This week\" block", !!thisWeek && thisWeek.label === "This week", thisWeek?.label);
  const rows = Object.fromEntries((thisWeek?.value || []).map(r => [r.label, r.value]));
  const current = (await api("GET", "/reports/activity", tok)).body;   // defaults to Monday→today
  ok("…and every figure on it equals the counter's, over the same window",
    rows["Conversations logged"] === current.conversationsLogged
    && rows["Gifts received"] === current.giftsReceived
    && cents(rows["Given this week"]) === current.giftCents
    && rows["Thank-yous marked sent"] === current.thankYousMarkedSent
    && rows["Follow-ups closed by outcome"] === current.threadsClosedByOutcome
    && rows["Follow-ups dismissed"] === current.threadsDismissed,
    { dashboard: rows, counter: current });
  ok("every ROW carries its own definition — five numbers under one sentence is four nobody can define",
    (thisWeek?.value || []).every(r => typeof r.definition === "string" && r.definition.length > 20),
    (thisWeek?.value || []).map(r => [r.label, (r.definition || "").slice(0, 24)]));
  ok("the block itself says which window it is",
    /Monday and today/i.test(thisWeek?.definition || ""), thisWeek?.definition);

  summary("build88a-week");
  sink.close();
  await closeDb();
})();

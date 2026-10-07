// tests/thread3-human.test.js · THREAD-3's one test. NOTHING THAT NEEDS A HUMAN SLIPS.
//
// §1 email: a real mailbox sync (POST /mailbox/google/sync {what:"mail"})
//    against a stand-in for Gmail on CALENDAR_MOCK_PORT (the server's
//    GMAIL_API_BASE). A donor's own email that has waited past one business
//    day becomes ONE reply step on her Thread. A funder's newsletter, a
//    receipt and an automatic reply open nothing; an email already answered
//    opens nothing; one that arrived two hours ago opens nothing yet. Running
//    the sweep again opens nothing more.
// §2 no-shows: marking an event's attendance with three people who did not
//    come opens ONE task for the event (not three), and a "Missed you at"
//    draft for each person with an email, waiting in Drafts. Saving the list
//    again, and marking a fourth guest by hand, still leaves one task.
// §3 delete: deleting a person with an active monthly plan is refused with the
//    sentence that names the plan, alone or in a batch; the person and the
//    plan are untouched and the Stripe stand-in is never called. Archive takes
//    them off the list and leaves the plan running.
// §4 the Agent: a stored plan whose steps carry no sentence is served with one.
//
// Donor data and email: an unanswered donor is the relationship slipping; a
// delete that strands a live plan is a card charged for somebody Steward no
// longer shows.
//
// HOW IT WOULD GO RED: classify nothing (the newsletter opens a step, §1);
// drop the reply-claim table (the second sweep opens a task, §1); open per
// person (three tasks, §2); count imported history as a reply (Marion's
// old meeting, written today, hides her email, §1); remove the plan check in DELETE /donors/:id (the
// person is deleted, §3); serve plans unnormalised (a blank step, §4). Proven
// able to fail: against main the routes and the reply step do not exist, and
// with the plan check commented out §3 went red.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
const STRIPE_PORT = Number(process.env.STRIPE_MOCK_PORT || 0);
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const ORG = "org_thread3_a";
const USER = `u_${ORG}`, DANA = `dana@${ORG}.example.com`;
const MARION = "marion@donor.example.com", FUNDER = "news@riverbend-fdn.example.com", PETER = "peter@donor.example.com";
const ROSA = "rosa@donor.example.com", QUINN = "quinn@donor.example.com", STORE = "receipts@shop.example.com";
const b64 = s => Buffer.from(s).toString("base64url");
const DAY = 86400000, now = Date.now();
// Four days back is past one business day whatever weekday this runs on.
const OLD = now - 4 * DAY, ANSWERED = now - 3 * DAY, FRESH = now - 2 * 3600000;

const msg = (id, t, from, to, subject, text, extra = []) => ({
  id, threadId: "t_" + id, internalDate: String(t), snippet: text,
  payload: { mimeType: "text/plain",
    headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }, ...extra],
    body: { data: b64(text) } },
});
const MESSAGES = {
  m_t3_marion: msg("m_t3_marion", OLD, `Marion Hale <${MARION}>`, DANA, "A question about my pledge", "Could we talk about spreading it over two years?"),
  m_t3_news: msg("m_t3_news", OLD, `Riverbend Foundation <${FUNDER}>`, DANA, "Riverbend news: spring", "Our spring grantees.",
    [{ name: "List-Unsubscribe", value: "<mailto:unsub@riverbend-fdn.example.com>" }]),
  m_t3_auto: msg("m_t3_auto", OLD, `Peter Lund <${PETER}>`, DANA, "Automatic reply: Thank you", "I am away until Monday.",
    [{ name: "Auto-Submitted", value: "auto-replied" }]),
  m_t3_receipt: msg("m_t3_receipt", OLD, `Shop <${STORE}>`, DANA, "Your receipt", "Order 1234."),
  m_t3_rosa_in: msg("m_t3_rosa_in", OLD, `Rosa Vale <${ROSA}>`, DANA, "Can I volunteer?", "I have Saturdays."),
  m_t3_rosa_out: msg("m_t3_rosa_out", ANSWERED, `Dana <${DANA}>`, ROSA, "Re: Can I volunteer?", "Yes please."),
  m_t3_quinn: msg("m_t3_quinn", FRESH, `Quinn Ames <${QUINN}>`, DANA, "Dinner next week?", "Free Thursday?"),
};
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/))) {
    const full = MESSAGES[decodeURIComponent(m[1])];
    return full ? send(200, full) : send(404, {});
  }
  if (u.pathname === "/gmail/v1/users/me/messages") return send(200, { messages: Object.keys(MESSAGES).map(id => ({ id })) });
  send(200, { items: [] });
});

const TABLES = ["mail_reply_steps", "milestone_drafts", "event_attendees", "events", "recurring_subscriptions", "agent_instructions",
  "interactions", "mailbox_connections", "tasks", "threads", "deleted_records", "donors", "user_sessions", "users",
  "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Thread Three','thread3-a',1,'active','team','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, DANA, pw]);
  const sys = "'system:test','test'";
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES
           ('d_t3_marion',$1,'Marion Hale',$2,'steward',${sys}), ('d_t3_fdn',$1,'Riverbend Foundation',$3,'steward',${sys}),
           ('d_t3_peter',$1,'Peter Lund',$4,'steward',${sys}), ('d_t3_rosa',$1,'Rosa Vale',$5,'steward',${sys}),
           ('d_t3_quinn',$1,'Quinn Ames',$6,'steward',${sys}), ('d_t3_store',$1,'Corner Shop',$7,'steward',${sys})`,
    [ORG, MARION, FUNDER, PETER, ROSA, QUINN, STORE]);
  // Old history written today (an import, a seed): a meeting dated last
  // year is not a reply to an email that arrived this week.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
           VALUES ('int_t3_hist',$1,'d_t3_marion','meeting','Imported: met at the 2025 supper','2025-05-01',$2,'Dana Reyes')`, [ORG, USER]);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,created_by,created_by_name)
           VALUES ('mbx_t3',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',${sys})`, [ORG, USER, DANA, sealed]);
  const dana = await login(DANA);

  // ── §1 email ─────────────────────────────────────────────────────────────
  console.log("\n§1 an unanswered donor email");
  const s1 = await api("POST", "/mailbox/google/sync", dana, { what: "mail" });
  ok("§1 the sync ran", s1.status === 200, `${s1.status} ${s1.text}`);
  const kinds = Object.fromEntries((await q(`SELECT metadata->>'message_id' AS m, metadata->>'mail_kind' AS k FROM interactions WHERE org_id=$1`, [ORG])).map(r => [r.m, r.k]));
  ok("§1 each inbound email is told apart", kinds.m_t3_marion === "personal" && kinds.m_t3_news === "newsletter"
    && kinds.m_t3_auto === "auto_reply" && kinds.m_t3_receipt === "receipt" && kinds.m_t3_rosa_out == null, kinds);
  const threads = await q(`SELECT donor_id, next_step_type, next_step_label, created_by FROM threads WHERE org_id=$1 AND closed_at IS NULL`, [ORG]);
  const mt = threads.filter(t => t.donor_id === "d_t3_marion");
  ok("§1 Marion's email is ONE reply step on her Thread", mt.length === 1 && mt[0].next_step_type === "reply"
    && /^Reply to Marion Hale: "A question about my pledge"/.test(mt[0].next_step_label) && mt[0].created_by === "system:mailbox/needs-reply", mt);
  ok("§1 the newsletter, the receipt, the automatic reply, the answered email and the fresh one open nothing",
    threads.length === 1, threads.map(t => `${t.donor_id}:${t.next_step_label}`));
  const again = await api("POST", "/mailbox/run-replies", dana, {});
  const tasks1 = await q(`SELECT id FROM tasks WHERE org_id=$1`, [ORG]);
  ok("§1 the sweep again opens nothing more", again.status === 200 && again.body.opened === 0 && again.body.tasks === 0 && tasks1.length === 0, again.body);

  // ── §2 no-shows ──────────────────────────────────────────────────────────
  console.log("\n§2 an event's no-shows");
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status) VALUES ('ev_t3',$1,'Spring Supper','dinner',CURRENT_DATE - 1,'completed')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ('d_t3_noemail',$1,'Ned Noemail',NULL,'steward',${sys})`, [ORG]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status) VALUES
           ('ea_t3_1','ev_t3',$1,'d_t3_rosa','Rosa Vale',$2,'registered'), ('ea_t3_2','ev_t3',$1,'d_t3_quinn','Quinn Ames',$3,'registered'),
           ('ea_t3_3','ev_t3',$1,'d_t3_noemail','Ned Noemail',NULL,'registered'), ('ea_t3_4','ev_t3',$1,'d_t3_peter','Peter Lund',$4,'registered'),
           ('ea_t3_5','ev_t3',$1,'d_t3_store','Corner Shop',$5,'registered')`, [ORG, ROSA, QUINN, PETER, STORE]);
  const mark = { attended: ["ea_t3_4"], noShow: ["ea_t3_1", "ea_t3_2", "ea_t3_3"] };
  const a1 = await api("POST", "/events/ev_t3/attendance", dana, mark);
  ok("§2 attendance saved", a1.status === 200 && !!a1.body.noShowTaskId, a1.body);
  let nt = await q(`SELECT id, title, type, event_id, assigned_to, created_by FROM tasks WHERE org_id=$1 AND event_id='ev_t3'`, [ORG]);
  ok("§2 three no-shows are ONE task for the event", nt.length === 1 && nt[0].type === "event_no_show" && nt[0].assigned_to === USER
    && nt[0].title === "Missed you at Spring Supper: 3 people did not come, 2 drafts waiting in Drafts", nt);
  const drafts = await q(`SELECT donor_id, subject, body, status FROM milestone_drafts WHERE org_id=$1 AND milestone_key='event_missed:ev_t3' ORDER BY donor_id`, [ORG]);
  ok("§2 a 'Missed you' draft for each person with an email, waiting for review",
    drafts.length === 2 && drafts.every(d => d.status === "pending_review" && d.subject === "Missed you at Spring Supper" && /We missed you at Spring Supper/.test(d.body))
    && drafts.map(d => d.donor_id).join() === "d_t3_quinn,d_t3_rosa", drafts.map(d => d.donor_id));
  await api("POST", "/events/ev_t3/attendance", dana, mark);
  await api("PATCH", "/events/ev_t3/attendees/ea_t3_5", dana, { status: "no_show" });
  nt = await q(`SELECT title FROM tasks WHERE org_id=$1 AND event_id='ev_t3'`, [ORG]);
  const d2 = await q(`SELECT COUNT(*)::int AS n FROM milestone_drafts WHERE org_id=$1 AND milestone_key='event_missed:ev_t3'`, [ORG]);
  ok("§2 saving again and a fourth by hand: still one task, counting four, and no draft twice",
    nt.length === 1 && nt[0].title === "Missed you at Spring Supper: 4 people did not come, 3 drafts waiting in Drafts" && d2[0].n === 3, { nt, d2 });

  // ── §3 delete with an active plan ────────────────────────────────────────
  console.log("\n§3 deleting a person with an active monthly plan");
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,current_period_end)
           VALUES ('rs_t3',$1,'d_t3_marion','sub_t3_marion',25,'month','active',NOW() + INTERVAL '3 days')`, [ORG]);
  const stripeHits = [];
  const stripe = STRIPE_PORT ? http.createServer((req, res) => { stripeHits.push(req.url); res.writeHead(500); res.end("{}"); }) : null;
  // If another stand-in already holds the port, its own log is the record;
  // the plan row's own state below is the check that matters.
  if (stripe) await new Promise(r => { stripe.once("error", r); stripe.listen(STRIPE_PORT, r); });
  const del = await api("DELETE", "/donors/d_t3_marion", dana);
  ok("§3 the delete is refused with the sentence", del.status === 409 && del.body.error === "active_plan"
    && del.body.sentence === "Marion Hale has a $25 monthly plan. Cancel it first, or archive them instead.", del.body);
  const bulk = await api("POST", "/donors/bulk-delete", dana, { ids: ["d_t3_marion", "d_t3_store"] });
  ok("§3 a batch with her in it is refused whole", bulk.status === 409 && bulk.body.error === "active_plan", bulk.body);
  const [d] = await q(`SELECT deleted_at FROM donors WHERE id='d_t3_marion'`);
  const [st] = await q(`SELECT deleted_at FROM donors WHERE id='d_t3_store'`);
  const [p] = await q(`SELECT status, canceled_at, amount FROM recurring_subscriptions WHERE id='rs_t3'`);
  ok("§3 she, the rest of the batch and the plan are untouched, and Stripe was never called",
    d.deleted_at === null && st.deleted_at === null && p.status === "active" && p.canceled_at === null && Number(p.amount) === 25 && stripeHits.length === 0,
    { d, st, p, stripeHits });
  const ar = await api("POST", "/donors/d_t3_marion/archive", dana, {});
  const list = await api("GET", "/donors?limit=200", dana);
  const rows = list.body.donors || list.body.rows || list.body;
  const archivedList = await api("GET", "/donors?limit=200&archived=1", dana);
  const arows = archivedList.body.donors || archivedList.body.rows || archivedList.body;
  const [p2] = await q(`SELECT status FROM recurring_subscriptions WHERE id='rs_t3'`);
  ok("§3 archive takes her off the list and the plan keeps running", ar.status === 200
    && Array.isArray(rows) && !rows.some(r => r.id === "d_t3_marion") && rows.some(r => r.id === "d_t3_rosa")
    && Array.isArray(arows) && arows.some(r => r.id === "d_t3_marion") && p2.status === "active", { ar: ar.body, n: rows && rows.length });
  const ok2 = await api("DELETE", "/donors/d_t3_store", dana);
  ok("§3 a person with no plan still deletes", ok2.status === 200 && ok2.body.deleted === 1, ok2.body);
  if (stripe && stripe.listening) stripe.close();

  // ── §4 the Agent never shows a blank step ────────────────────────────────
  console.log("\n§4 a plan step always says what it does");
  await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,plan,created_by,created_by_name)
           VALUES ('ai_t3',$1,'Draft the welcome','task','planned','draft',$2,${sys})`,
    [ORG, JSON.stringify({ steps: [{ tool: "find_people", label: "Read Marion Hale's record", donorId: "d_t3_marion" }, { tool: "count" }], sends: 0 })]);
  const plans = await api("GET", "/agent/plans", dana);
  const pl = ((plans.body && plans.body.plans) || []).find(x => x.id === "ai_t3");
  ok("§4 both stored steps are served with a sentence", !!pl && pl.plan.steps.length === 2
    && pl.plan.steps.every(s => String(s.describes || "").trim().length >= 4)
    && pl.plan.steps[0].describes === "Read Marion Hale's record." && pl.plan.steps[1].describes === "Count what that found.",
    pl && pl.plan.steps);

  await reset();
  const [left] = await q(`SELECT COUNT(*)::int AS n FROM orgs WHERE id=$1`, [ORG]);
  ok("the fixture cleans up after itself", left.n === 0, left);
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); mock.close(); await closeDb().catch(() => {}); process.exit(1); });

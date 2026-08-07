// BUILD-44 Part 3 — notifications actually ARRIVE. TESTS ONLY.
//
// Every notification-triggering action must enqueue EXACTLY ONE message with
// the correct recipient and payload — asserted against a real capture sink on
// :5602 (the RESEND_BASE_URL the scratch server is booted with; each suite
// runs its own sink, per the workflows-e2e convention).
//
// Plus the class behind "the alert that silently never landed": what happens
// when the provider FAILS? The failing-sink leg documents current behavior —
// if a failed send still reserves the notification_sends dedup row and never
// retries, that alert is permanently lost. That result is recorded in
// audit/BUILD-44-FINDINGS.md; the assertions here encode CURRENT behavior so
// the suite is green while the finding stands.

const bcrypt = require("bcryptjs");
const http = require("http");
const { ok, summary, login, api, q } = require("./helpers");

const ORG = "org_notif44";
const ADMIN_ID = "u_n44_admin", ADMIN = "n44-admin@example.org";
const OFFICER_ID = "u_n44_officer", OFFICER = "n44-officer@example.org";
const SINK_PORT = 5602;

let received = [];       // captured sends
let sinkMode = "ok";     // "ok" | "fail"
let attempts = 0;        // every POST, including failed ones

function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        attempts++;
        if (sinkMode === "fail") { res.statusCode = 500; return res.end(JSON.stringify({ error: "sink down" })); }
        try { received.push(JSON.parse(body)); } catch { received.push({ raw: body.slice(0, 200) }); }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id: "sunk_" + attempts }));
      });
    });
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const toList = m => [].concat(m.to || []);

(async () => {
  const sink = await startSink();

  // tiny org: admin + officer + one assigned donor
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "tasks", "interactions",
    "fin_transactions", "fin_accounts", "accounts", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status)
           VALUES ($1,'Notif44 Org','notif44',1,'team','active')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'N44 Admin','admin')`, [ADMIN_ID, ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'N44 Officer','staff')`, [OFFICER_ID, ORG, OFFICER, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name)
           VALUES ('d_n44_1',$1,'Notif Donor','n44-donor@example.org','active','cultivate',0,0,$2,'N44 Officer')`, [ORG, OFFICER_ID]);
  const token = await login(ADMIN);

  // ── 1. task assignment → exactly ONE email, right recipient, right payload ──
  {
    received = []; attempts = 0;
    const r = await api("POST", "/tasks", token, { title: "Deliver the N44 packet", due: "2026-10-01", priority: "high", assignedTo: OFFICER_ID });
    ok("task create 200/201", r.status === 200 || r.status === 201, r.body);
    await settle();
    ok("task assignment: exactly ONE message enqueued", received.length === 1, received.length);
    const m = received[0] || {};
    ok("task assignment: recipient is the assignee", toList(m).includes(OFFICER), m.to);
    ok("task assignment: subject/body carry the task title", /Deliver the N44 packet/.test((m.subject || "") + (m.html || "")), m.subject);
    const rows = await q(`SELECT event_key,recipient_user_id FROM notification_sends WHERE org_id=$1`, [ORG]);
    ok("task assignment: ONE dedup row, keyed to the task, for the assignee",
      rows.length === 1 && /^taskassign:/.test(rows[0].event_key) && rows[0].recipient_user_id === OFFICER_ID, rows);
  }

  // ── 2. gift alert (instant_gift_thanks) → owner + ED, one email each, once ──
  {
    const wf = await api("GET", "/workflows", token);
    const igt = (wf.body.workflows || wf.body || []).find?.(w => w.recipe_key === "instant_gift_thanks");
    await api("PUT", `/workflows/${igt.id}`, token, { enabled: true, config: { notify: "both", threshold: 0 } });
    received = []; attempts = 0;
    await q(`DELETE FROM notification_sends WHERE org_id=$1`, [ORG]);
    const g = await api("POST", "/donors/d_n44_1/gifts", token, { amount: 250, date: new Date().toISOString().slice(0, 10), type: "one-time" });
    ok("gift 200/201", g.status === 200 || g.status === 201, g.body);
    await settle(1000);
    // recipients: the OWNER (officer) and the ED (admin) — exactly one email each
    const to = received.map(m => toList(m).join(",")).sort();
    ok("gift alert: exactly TWO messages (owner + ED)", received.length === 2, received.map(m => m.to));
    ok("gift alert: one to the officer, one to the admin",
      to.some(t => t.includes(OFFICER)) && to.some(t => t.includes(ADMIN)), to);
    ok("gift alert: payload carries donor + amount", received.every(m => /Notif Donor/.test(m.html || "") && /\$?250/.test((m.subject || "") + (m.html || ""))), received.map(m => m.subject));
    const rows = await q(`SELECT recipient_user_id FROM notification_sends WHERE org_id=$1 AND event_key LIKE 'gift:%'`, [ORG]);
    ok("gift alert: one reservation per person", rows.length === 2, rows);
  }

  // ── 3. daily task reminder → once per user, once per day ──
  {
    received = []; attempts = 0;
    await q(`UPDATE tasks SET due=$2 WHERE org_id=$1`, [ORG, new Date().toISOString().slice(0, 10)]);
    const r1 = await api("POST", "/digests/run-daily", token, {});
    ok("run-daily 200", r1.status === 200, r1.body);
    await settle();
    ok("daily reminder: exactly ONE message (one user has due tasks)", received.length === 1, received.map(m => m.to));
    ok("daily reminder: recipient is the user with due tasks", toList(received[0] || {}).includes(OFFICER), received[0]?.to);
    const before = received.length;
    await api("POST", "/digests/run-daily", token, {});
    await settle();
    ok("daily reminder: rerun same day sends NOTHING (period reserved)", received.length === before, received.length);
  }

  // ── 4. provider FAILURE: is the alert retried or silently lost? ──────────
  //    (documents current behavior — see FINDINGS)
  {
    sinkMode = "fail"; received = []; attempts = 0;
    await q(`DELETE FROM notification_sends WHERE org_id=$1 AND event_key LIKE 'taskassign:%'`, [ORG]);
    const r = await api("POST", "/tasks", token, { title: "Doomed delivery", due: "2026-10-02", priority: "high", assignedTo: OFFICER_ID });
    ok("task create during outage: 200/201 (send failure never fails the action — correct)", r.status === 200 || r.status === 201, r.body);
    await settle(1200);
    const firstAttempts = attempts;
    ok("outage: the send WAS attempted", firstAttempts >= 1, firstAttempts);
    await settle(2500);
    // CURRENT BEHAVIOR (finding): no retry — attempts don't grow after failure
    ok("outage: NO retry occurs (current behavior — FINDINGS F-2: the alert is lost)", attempts === firstAttempts, { firstAttempts, attempts });
    const rows = await q(`SELECT event_key FROM notification_sends WHERE org_id=$1 AND event_key LIKE 'taskassign:%'`, [ORG]);
    // CURRENT BEHAVIOR (finding): the dedup row was reserved BEFORE the failed
    // send, so even a manual re-trigger would dedup to silence.
    ok("outage: dedup row reserved despite the failed send (FINDINGS F-2)", rows.length === 1, rows);
    sinkMode = "ok";
  }

  sink.close();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

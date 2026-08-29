// BUILD-36 Part A — officer notifications, proven on REAL captured email bytes.
// Local scratch server + Postgres; boot with RESEND_BASE_URL=http://localhost:5602
// (run-all.sh recipe). This suite runs its own capture sink on 5602 for its
// duration — no real email ever leaves.
//
// What it proves:
//   A1  a NEW org (register-org) gets instant_gift_thanks ON by default (ED &
//       assigned officer); a seeded/existing org that only ever calls
//       ensureWorkflows keeps every recipe OFF (untouched). An owner-assigned
//       donor's gift emails the officer ONCE, branded, with no donor footer.
//   A2  a task assigned by SOMEONE ELSE emails the assignee (title/donor/due);
//       a self-assigned task emails no one; reassignment notifies the new
//       assignee once (dedup key = task id + assignee).
//   A3  the daily reminder emails a user their due-today + overdue tasks,
//       ONLY when non-empty, once per day (idempotent), respecting the toggle.
//   A4  per-user toggles are honored (portfolio gifts / task assignments /
//       daily reminder); ONE email per person per event — gift-notify and the
//       major-gift owner alert never both email the same person for one gift.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_ns_a";   // main Team org
const ORG_T = "org_ns_t"; // untouched "existing" org

let captured = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const clearMail = () => { captured = []; };
const mailTo = to => captured.filter(e => e.path === "/emails" && (e.body?.to === to || e.body?.to?.includes?.(to)));
const allTo = () => captured.filter(e => e.path === "/emails").map(e => e.body?.to);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, tries = 40) { for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(50); } return false; }

async function reset() {
  for (const o of [ORG, ORG_T]) {
    for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "tasks", "interactions", "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [o]);
  }
}
const mkUser = (org, id, email, name, role = "staff") =>
  q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, org, email, bcrypt.hashSync("loadtest1234", 10), name, role]);

(async () => {
  await new Promise((res, rej) => { mock.on("error", rej); mock.listen(SINK_PORT, res); });
  await reset();

  // Lowercase org name → header must render it title-cased.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'creo notify test','ns-a',1,'active','team')`, [ORG]);
  await mkUser(ORG, "u_ns_ed", "ed@ns.local", "the director", "admin");
  await mkUser(ORG, "u_ns_off", "off@ns.local", "olivia officer", "staff");
  await mkUser(ORG, "u_ns_off2", "off2@ns.local", "second officer", "staff");
  await q(`INSERT INTO donors (id,org_id,name,assigned_to,assigned_to_name,stage,gift_count,total_giving) VALUES ('d_ns_owned',$1,'margaret owned','u_ns_off','olivia officer','cultivate',1,500)`, [ORG]);
  const tEd = await login("ed@ns.local");
  const tOff = await login("off@ns.local");

  const wfByKey = (list, k) => list.find(w => w.recipe_key === k);
  let wfs = (await api("GET", "/workflows", tEd)).body;

  // ── A1 — assigned-officer gift path, once, branded, no footer ──
  console.log("\n── A1: assigned-officer gift notification ──");
  await api("PUT", `/workflows/${wfByKey(wfs, "instant_gift_thanks").id}`, tEd, { enabled: true, config: { notify: "both", threshold: 0 } });
  clearMail();
  const g1 = await api("POST", "/donors/d_ns_owned/gifts", tEd, { amount: 200, date: "2026-08-01" });
  ok("A1: gift logged 201", g1.status === 201, g1.status);
  ok("A1: the assigned officer is emailed exactly once", await waitFor(() => mailTo("off@ns.local").length === 1), mailTo("off@ns.local").length);
  ok("A1: the ED (admin) is emailed too (notify=both)", mailTo("ed@ns.local").length >= 1, allTo());
  const giftMail = mailTo("off@ns.local")[0]?.body?.html || "";
  ok("A1: officer gift email is BRANDED (org name title-cased in header)", giftMail.includes("Creo Notify Test"), giftMail.slice(0, 120));
  ok("A1: officer gift email carries NO donor unsubscribe footer (internal mail)", !/unsubscribe/i.test(giftMail));

  // ── A4 — one email per person per event ──
  console.log("\n── A4: one email per person per gift event ──");
  await api("PUT", `/workflows/${wfByKey(wfs, "major_gift_alert").id}`, tEd, { enabled: true, config: { threshold: 1000 } });
  clearMail();
  await api("POST", "/donors/d_ns_owned/gifts", tEd, { amount: 5000, date: "2026-08-02" });
  // Both instant_gift_thanks (notify=both) AND major_gift_alert (notify_owner)
  // target the officer for this ONE gift → must collapse to a single email.
  await waitFor(() => mailTo("off@ns.local").length >= 1);
  await sleep(250); // give any (wrong) second email time to arrive
  ok("A4: officer gets EXACTLY ONE email for a gift that fires both recipes", mailTo("off@ns.local").length === 1, mailTo("off@ns.local").length);
  ok("A4: the ED still gets exactly one gift email for that event", mailTo("ed@ns.local").length === 1, mailTo("ed@ns.local").length);

  // ── A4 — portfolio-gifts toggle ──
  await api("PUT", "/me/notification-prefs", tOff, { portfolioGifts: false });
  clearMail();
  await api("POST", "/donors/d_ns_owned/gifts", tEd, { amount: 300, date: "2026-08-03" });
  await sleep(250);
  ok("A4: officer who turned OFF portfolio-gifts gets no gift email", mailTo("off@ns.local").length === 0, mailTo("off@ns.local").length);
  ok("A4: the ED (still opted in) is unaffected", mailTo("ed@ns.local").length === 1, mailTo("ed@ns.local").length);
  await api("PUT", "/me/notification-prefs", tOff, { portfolioGifts: true }); // restore
  // Disable the gift recipes so they don't interfere with the task tests below.
  await api("PUT", `/workflows/${wfByKey(wfs, "instant_gift_thanks").id}`, tEd, { enabled: false });
  await api("PUT", `/workflows/${wfByKey(wfs, "major_gift_alert").id}`, tEd, { enabled: false });

  // ── A2 — task assignment email ──
  console.log("\n── A2: task assignment email ──");
  clearMail();
  const tk = await api("POST", "/tasks", tEd, { title: "Call Margaret about the gala", assignedTo: "u_ns_off", donorId: "d_ns_owned", due: "2026-08-20" });
  ok("A2: task created 201", tk.status === 201, tk.status);
  ok("A2: the assignee (someone else) is emailed once", await waitFor(() => mailTo("off@ns.local").length === 1), mailTo("off@ns.local").length);
  const taskMail = mailTo("off@ns.local")[0]?.body?.html || "";
  ok("A2: task email carries the title, the donor, and a link", taskMail.includes("Call Margaret about the gala") && taskMail.includes("Margaret Owned") && /Open Steward/.test(taskMail), taskMail.slice(0, 200));
  ok("A2: task email is branded, no unsubscribe footer", taskMail.includes("Creo Notify Test") && !/unsubscribe/i.test(taskMail));

  // self-assigned → no email
  clearMail();
  await api("POST", "/tasks", tEd, { title: "My own note", assignedTo: "u_ns_ed" });
  await sleep(200);
  ok("A2: a self-assigned task emails no one", allTo().length === 0, allTo());

  // task-assignments toggle
  await api("PUT", "/me/notification-prefs", tOff, { taskAssignments: false });
  clearMail();
  await api("POST", "/tasks", tEd, { title: "Silent task", assignedTo: "u_ns_off" });
  await sleep(200);
  ok("A2/A4: officer who turned OFF task-assignments gets no task email", mailTo("off@ns.local").length === 0, mailTo("off@ns.local").length);
  await api("PUT", "/me/notification-prefs", tOff, { taskAssignments: true }); // restore

  // reassignment notifies the new assignee once (dedup = task id + assignee)
  clearMail();
  const rk = await api("POST", "/tasks", tEd, { title: "Reassign me", assignedTo: "u_ns_off2" });
  ok("A2: initial assignee (off2) emailed once", await waitFor(() => mailTo("off2@ns.local").length === 1), mailTo("off2@ns.local").length);
  clearMail();
  await api("PUT", `/tasks/${rk.body.id}`, tEd, { title: "Reassign me", assignedTo: "u_ns_off" });
  ok("A2: reassigned-to (off) emailed once", await waitFor(() => mailTo("off@ns.local").length === 1), mailTo("off@ns.local").length);
  clearMail();
  await api("PUT", `/tasks/${rk.body.id}`, tEd, { title: "Reassign me", assignedTo: "u_ns_off" });
  await sleep(200);
  ok("A2: re-saving with the SAME assignee does not re-email (idempotent)", mailTo("off@ns.local").length === 0, mailTo("off@ns.local").length);

  // ── A3 — daily due/overdue reminder ──
  console.log("\n── A3: daily task reminder ──");
  const TODAY = "2026-08-05";
  // Officer: 2 overdue + 1 due today (open), 1 completed-overdue, 1 future → 3 counted.
  await q(`DELETE FROM tasks WHERE org_id=$1`, [ORG]);
  const mkTask = (id, assignee, due, done = 0) =>
    q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,assigned_to,updated_at) VALUES ($1,$2,$3,$4,'medium','donor',$5,$6,NOW())`,
      [id, ORG, `Task ${id}`, due, done, assignee]);
  await mkTask("t_od1", "u_ns_off", "2026-07-01");
  await mkTask("t_od2", "u_ns_off", "2026-07-15");
  await mkTask("t_td1", "u_ns_off", TODAY);
  await mkTask("t_done", "u_ns_off", "2026-06-01", 1);       // completed → excluded
  await mkTask("t_future", "u_ns_off", "2026-12-01");         // future → excluded
  await mkTask("t_edfut", "u_ns_ed", "2026-12-01");           // ED has nothing due → no email
  clearMail();
  const rd = await api("POST", "/digests/run-daily", tEd, { today: TODAY });
  ok("A3: run-daily 200", rd.status === 200, rd.body);
  ok("A3: officer with due/overdue tasks gets exactly one reminder", mailTo("off@ns.local").length === 1, mailTo("off@ns.local").length);
  const dailyMail = mailTo("off@ns.local")[0]?.body || {};
  ok("A3: subject is '3 tasks need you today — <Org>'", dailyMail.subject === "3 tasks need you today — Creo Notify Test", dailyMail.subject);
  ok("A3: body lists overdue + due-today, branded, no footer",
    /Overdue/.test(dailyMail.html) && /Due today/.test(dailyMail.html) && dailyMail.html.includes("Creo Notify Test") && !/unsubscribe/i.test(dailyMail.html));
  ok("A3: a user with nothing due gets NO reminder (non-empty only)", mailTo("ed@ns.local").length === 0, mailTo("ed@ns.local").length);
  // idempotent — same day, run again → nothing new
  clearMail();
  await api("POST", "/digests/run-daily", tEd, { today: TODAY });
  ok("A3: re-running the same day sends nothing (once per user per day)", allTo().length === 0, allTo());
  // toggle off, fresh day → suppressed
  await api("PUT", "/me/notification-prefs", tOff, { dailyTasks: false });
  clearMail();
  await api("POST", "/digests/run-daily", tEd, { today: "2026-08-06" });
  ok("A3: officer who turned OFF the daily reminder gets nothing", mailTo("off@ns.local").length === 0, mailTo("off@ns.local").length);

  // ── A1 (default on for new orgs) + existing-org-untouched ──
  console.log("\n── A1: new-org default vs existing-org untouched ──");
  const rEmail = "founder-" + Math.random().toString(36).slice(2) + "@ns.local";
  const reg = await api("POST", "/auth/register-org", null, { orgName: "brand new org", userName: "sam founder", email: rEmail, password: "loadtest1234" });
  ok("A1: register-org 201", reg.status === 201, reg.status);
  const tNew = reg.body.token;
  const newOrgId = reg.body.org.id;
  const newWfs = (await api("GET", "/workflows", tNew)).body;
  const newThanks = wfByKey(newWfs, "instant_gift_thanks");
  ok("A1: new org has instant_gift_thanks ON by default", newThanks && newThanks.enabled === true, newThanks?.enabled);
  ok("A1: new org's gift-notify mode is ED & assigned officer (both)", (typeof newThanks.config === "object" ? newThanks.config : JSON.parse(newThanks.config)).notify === "both");
  ok("A1: new org's OTHER recipes stay OFF", newWfs.filter(w => w.recipe_key !== "instant_gift_thanks").every(w => !w.enabled));
  // An existing/seeded org that only ever calls ensureWorkflows keeps all OFF.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'existing org','ns-t',1,'active','team')`, [ORG_T]);
  await mkUser(ORG_T, "u_ns_t_ed", "ed@ns-t.local", "existing admin", "admin");
  const tT = await login("ed@ns-t.local");
  const tWfs = (await api("GET", "/workflows", tT)).body;
  ok("A1: an existing org is UNTOUCHED — instant_gift_thanks OFF (only register enables it)",
    wfByKey(tWfs, "instant_gift_thanks").enabled === false, wfByKey(tWfs, "instant_gift_thanks").enabled);

  // Org isolation: org_ns_a's notification rows never bled into org_ns_t.
  const leak = await q(`SELECT COUNT(*)::int n FROM notification_sends WHERE org_id=$1`, [ORG_T]);
  ok("A4: notification ledger is org-scoped (existing org has none)", leak[0].n === 0, leak[0].n);

  await reset();
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "users", "fin_transactions", "budgets", "accounts", "fin_funds"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [newOrgId]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [newOrgId]).catch(() => {});
  await closeDb();
  await new Promise(r => mock.close(r));
  summary();
})();

// BUILD-88a A.2 — ONE TASK, EVERY SCREEN. Run: node tests/build88a-one-task.test.js
//
// A follow-up made by the conversation flow is a THREAD. One made by "+ Add
// task", a pipeline move or a workflow recipe is a TASK. Two tables, and — until
// this part — two LISTS: a donor with an open thread and an open task had one of
// them on their profile and the other on a screen nobody opens. "What do I owe
// this person?" had two answers, which is the same as having none.
//
// The tables do not merge in this build (a thread carries an opening
// interaction, a close kind and a one-open-per-donor constraint a task row has
// no place for). They are READ THROUGH ONE COMPOSER, ranked by the one ranking,
// and every row says which kind it is.
//
//   §1  a follow-up made by each path shows on the donor's profile, in one
//       ranked list, with a count
//   §2  …and on Home for the person who owns it, under BUILD-85's cap, with
//       "and N more" when the cap bites
//   §3  …and in ONE morning email, with Due today ABOVE overdue
//   §4  no label begins "Follow up:" — the label is the step
//
// Local scratch server + Postgres + the :5602 sink (tests/README.md).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT, civilToday } = require("./helpers");

const ORG = "org_b88a2";
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => { const [y, m, d] = civilToday().split("-").map(Number); return iso(Date.UTC(y, m - 1, d) - n * 86400000); };
const daysAhead = n => { const [y, m, d] = civilToday().split("-").map(Number); return iso(Date.UTC(y, m - 1, d) + n * 86400000); };

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

async function reset() {
  for (const t of ["threads", "digest_sends", "notification_sends", "tasks", "interactions", "gifts",
    "fin_transactions", "donors", "users", "budgets", "accounts", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address,thread_nudge_weekends)
           VALUES ($1,'B88a One Task','b88a-one-task',1,'active','team','1 Main St, Lexington KY',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a2',$1,'b88a2@test.local',$2,'Fresh Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b88a2',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_b88a2',$1,'General Operating',false)`, [ORG]);
}

(async () => {
  await new Promise((res, rej) => { sink.on("error", rej); sink.listen(SINK_PORT, res); });
  await reset();
  const tok = await login("b88a2@test.local");
  const TODAY = civilToday();

  const donors = {};
  for (const [key, name] of [["conv", "Conversation Donor"], ["plan", "Planned Donor"],
    ["add", "Added Task Donor"], ["wf", "Workflow Task Donor"]]) {
    const id = `d_b88a2_${key}`;
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name,total_giving,gift_count)
             VALUES ($1,$2,$3,$4,'new','cultivate','u_b88a2','Fresh Admin',1000,1)`,
      [id, ORG, name, `${key}@b88a2.test`]);
    donors[key] = id;
  }

  // ── §1 · each path, then the profile ─────────────────────────────────────
  console.log("\n— §1 · four paths, one list on the donor's record —");

  // PATH 1 — the conversation's next step.
  const conv = await api("POST", `/donors/${donors.conv}/conversations`, tok, {
    touch: "meeting", line: "She asked for the impact report.", date: daysAgo(3),
    nextStep: { type: "send", label: "Send the impact report", due: daysAgo(1) },
  });
  ok("a conversation's next step is recorded", conv.status === 201, conv.status);

  // PATH 2 — a planned follow-up, with nothing having happened yet.
  const plan = await api("POST", `/donors/${donors.plan}/threads`, tok, {
    label: "Call about the spring ask", due: TODAY,
  });
  ok("a planned follow-up is recorded", plan.status === 201 || plan.status === 200, { status: plan.status, body: JSON.stringify(plan.body).slice(0, 160) });

  // PATH 3 — "+ Add task".
  const add = await api("POST", "/tasks", tok, {
    title: "Send the gala invitation", due: daysAgo(2), priority: "medium", type: "donor", donorId: donors.add });
  ok("+ Add task is recorded", add.status === 201, add.status);

  // PATH 4 — the shape a workflow recipe / pipeline move writes: straight into
  // tasks, owned by the donor's officer.
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_at)
           VALUES ('t_b88a2_wf',$1,'Call about the monthly gift that failed',$2,'high','donor',0,$3,'u_b88a2','Fresh Admin',NOW())`,
    [ORG, daysAgo(5), donors.wf]);

  for (const [key, label] of [["conv", "Send the impact report"], ["plan", "Call about the spring ask"],
    ["add", "Send the gala invitation"], ["wf", "Call about the monthly gift that failed"]]) {
    const r = await api("GET", `/threads?donorId=${donors[key]}`, tok);
    ok(`${key}: the donor's profile shows the open item ("${label}")`,
      r.status === 200 && (r.body.list || []).some(x => x.nextStep.label === label),
      (r.body.list || []).map(x => `${x.kind}:${x.nextStep.label}`));
    ok(`${key}: the list carries a COUNT of what is open`,
      r.body.stat && r.body.stat.open === (r.body.list || []).length, r.body.stat);
    ok(`${key}: every row says which kind it is, and is ranked`,
      (r.body.list || []).every(x => (x.kind === "thread" || x.kind === "task") && x.rank && typeof x.rank.score === "number"),
      (r.body.list || []).map(x => [x.kind, x.rank?.score]));
  }

  // Two open items on ONE donor — the case that had two answers before.
  await api("POST", "/tasks", tok, { title: "Post the cheque", due: TODAY, priority: "medium", type: "donor", donorId: donors.conv });
  const both = await api("GET", `/threads?donorId=${donors.conv}`, tok);
  ok("a donor with a thread AND a task shows BOTH, on one list, with the count",
    (both.body.list || []).length === 2 && both.body.stat.open === 2
    && new Set((both.body.list || []).map(x => x.kind)).size === 2,
    (both.body.list || []).map(x => `${x.kind}:${x.nextStep.label}`));
  ok("…ranked by the one ranking: the overdue one leads the one due today",
    both.body.list[0].band === "overdue" && both.body.list[1].band === "today",
    both.body.list.map(x => [x.band, x.nextStep.due]));

  // ── §2 · Home ────────────────────────────────────────────────────────────
  console.log("\n— §2 · Home shows every overdue item for the user, under the cap —");
  const home = await api("GET", "/threads?scope=mine", tok);
  const labels = (home.body.list || []).map(x => x.nextStep.label);
  for (const label of ["Send the impact report", "Send the gala invitation", "Call about the monthly gift that failed", "Call about the spring ask"]) {
    ok(`Home carries "${label}"`, labels.includes(label), labels);
  }
  ok("Home's count is every open item, threads and tasks alike",
    home.body.stat.open === 5, home.body.stat);
  ok("…and the overdue ones lead", (home.body.list || [])[0].band === "overdue", (home.body.list || []).map(x => x.band));

  // THE CAP IS THE FEATURE. Fifteen more overdue tasks, and the list says how
  // many it is not showing rather than growing without end.
  for (let i = 0; i < 15; i++) {
    const did = `d_b88a2_cap${i}`;
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
             VALUES ($1,$2,$3,$4,'new','cultivate','u_b88a2','Fresh Admin')`, [did, ORG, `Cap Donor ${i}`, `cap${i}@b88a2.test`]);
    await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_at)
             VALUES ($1,$2,$3,$4,'medium','donor',0,$5,'u_b88a2','Fresh Admin',NOW())`,
      [`t_b88a2_cap${i}`, ORG, `Ring Cap Donor ${i}`, daysAgo(4), did]);
  }
  const capped = await api("GET", "/threads?scope=mine", tok);
  ok("Home caps at BUILD-85's twelve rows", (capped.body.list || []).length === 12, (capped.body.list || []).length);
  ok("…and says how many more there are, rather than hiding them",
    capped.body.more === 8 && capped.body.stat.open === 20, { more: capped.body.more, stat: capped.body.stat });

  // ── §3 · one morning email ───────────────────────────────────────────────
  console.log("\n— §3 · one email, Due today above overdue —");
  captured = [];
  const run1 = await api("POST", "/nudges/run", tok, { today: TODAY, force: true });
  ok("the morning brief runs", run1.status === 200, run1.status);
  ok("exactly ONE email reaches the user — never one per follow-up system",
    mails().length === 1, mails().map(m => m.body?.subject));
  const html = String(mails()[0]?.body?.html || "");
  ok("it carries the thread follow-ups", /Send the impact report/.test(html), html.slice(0, 200));
  ok("…and the tasks", /Send the gala invitation/.test(html) && /Post the cheque/.test(html), null);
  // Inside the TASK section only: the thread rows carry their own "Overdue N
  // days" reason sentences, which are the ranking talking, not a heading.
  const taskSection = html.slice(html.indexOf("Your tasks"));
  const dueTodayAt = taskSection.indexOf("Due today");
  const overdueAt = taskSection.indexOf("Overdue");
  ok("Due today appears ABOVE overdue — the list she can still finish leads",
    dueTodayAt > -1 && overdueAt > -1 && dueTodayAt < overdueAt, { dueTodayAt, overdueAt });

  // A second run the same day sends nothing: one email per person per morning.
  captured = [];
  await api("POST", "/nudges/run", tok, { today: TODAY, force: true });
  ok("a second run the same morning sends nothing", mails().length === 0, mails().length);

  // A TIMED step emails at its time and is OUT of that morning's digest —
  // never reported twice on one day (shared/threadShape.js digestShouldSkip).
  await q(`UPDATE orgs SET timezone='America/New_York', timezone_confirmed_at=NOW() WHERE id=$1`, [ORG]);
  const timed = await api("POST", `/donors/${donors.wf}/threads`, tok, {
    label: "Ring at two", due: daysAhead(1), time: "14:00",
  });
  ok("a step can carry a time", timed.status === 201 || timed.status === 200, { status: timed.status, body: JSON.stringify(timed.body).slice(0, 200) });
  captured = [];
  await q(`DELETE FROM digest_sends WHERE org_id=$1`, [ORG]);
  await api("POST", "/nudges/run", tok, { today: daysAhead(1), force: true });
  const html2 = String(mails()[0]?.body?.html || "");
  ok("a timed step produces no separate morning send — it is out of the digest on its own due date",
    !/Ring at two/.test(html2), html2.slice(0, 300));

  // ── §4 · the label is the step ───────────────────────────────────────────
  console.log("\n— §4 · no label begins \"Follow up:\" —");
  const prefixed = await api("POST", "/tasks", tok, {
    title: "Follow up: Conversation Donor", due: daysAhead(3), type: "donor", donorId: donors.conv,
    note: "She asked for the impact report by the end of the month.",
  });
  ok("a \"Follow up:\" title is refused as a label and replaced by the STEP",
    prefixed.status === 201 && !/^follow\s*up\s*:/i.test(prefixed.body.title), prefixed.body?.title);
  ok("…and the step comes from the note, by the same extractor the conversation flow uses",
    /impact report/i.test(prefixed.body.title || ""), prefixed.body?.title);
  const bare = await api("POST", "/tasks", tok, {
    title: "Follow up: Added Task Donor", due: daysAhead(3), type: "donor", donorId: donors.add });
  ok("with no note to read, it falls back to the type's own default, never the prefix",
    bare.status === 201 && bare.body.title === "Follow up", bare.body?.title);
  const allTasks = await q(`SELECT title FROM tasks WHERE org_id=$1`, [ORG]);
  ok("no task on this org begins \"Follow up:\"",
    !allTasks.some(t => /^follow\s*up\s*:/i.test(t.title)), allTasks.map(t => t.title).slice(0, 8));

  summary("build88a-one-task");
  sink.close();
  await closeDb();
})();

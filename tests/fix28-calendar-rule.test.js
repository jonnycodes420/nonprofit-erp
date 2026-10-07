// tests/fix28-calendar-rule.test.js · FIX-28's one test. EVERY DATED THING IS ON THE CALENDAR.
//
//     One of each dated type (meeting, next step, task, grant deadline, shift,
//     event, journey step, campaign send, pledge instalment) is created and
//     found on GET /calendar/items. A grant gets three deadlines through its
//     own route; all three are on the feed, and moving one by drag (the
//     request shared/calendarMoves.js builds) moves it there. With "put my
//     dates on my calendar" turned on, her own deadlines, steps and journey
//     steps go to her connected Google calendar; a moved one moves there, a
//     done one comes off, and turning it off takes them all off. Another
//     organisation sees none of it.
//
// Donor data: a funder deadline that never reaches the calendar is a missed
// grant, and a calendar entry left behind after the date moved sends an
// officer to the wrong day.
//
// It stands in for Google on CALENDAR_MOCK_PORT (the server's
// GOOGLE_CALENDAR_API_BASE), as cal1-moves does.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · calendar.js without the deadline read → §1 "deadline on the feed";
//   · moveRequest for a deadline building from the moved day → §2 Undo;
//   · the push skipping its PATCH when the day changes → §3 "moved on Google".

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_fix28cal", ORG2 = "org_fix28cal2";
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const TABLES = ["calendar_pushes", "grant_milestones", "grants", "cultivation_plan_steps", "cultivation_plans", "pledge_installments", "pledges",
  "campaigns", "events", "volunteer_slots", "volunteer_opportunities", "tasks", "calendar_events", "mailbox_connections", "threads", "donors", "users"];

const calls = [];
let seq = 0;
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    calls.push({ method: req.method, url: req.url, body: b ? JSON.parse(b) : null });
    res.writeHead(req.method === "DELETE" ? 204 : 200, { "Content-Type": "application/json" });
    res.end(req.method === "DELETE" ? "" : JSON.stringify({ id: req.method === "POST" ? `gev_push_${++seq}` : "gev_x", items: [] }));
  });
});

async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  for (const [o, slug] of [[ORG, "fix28-cal"], [ORG2, "fix28-cal2"]]) {
    // grant_headsup_days 0: FIX-31's "Start the proposal" tasks are off, so the
    // push below is exactly the items this suite names (fix31-one-record has them).
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,grant_headsup_days)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),0)`, [o, `Calendar ${slug}`, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`, [`u_${o}`, o, `dana@${o}.local`, pw]);
  }
  const U = `u_${ORG}`;
  // Two weeks ahead, so nothing is in the past and no lead time has arrived.
  const base = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const plus = n => new Date(Date.parse(base + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const ins = (sql, args) => q(sql, args);
  await ins(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ('d_f28_p',$1,'Fixture Person','active','system:test','test')`, [ORG]);
  await ins(`INSERT INTO donors (id,org_id,name,stage,person_types,created_by,created_by_name) VALUES ('d_f28_f',$1,'Fixture Foundation','active','["organization"]'::jsonb,'system:test','test')`, [ORG]);
  await ins(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,booked_in_steward,created_by,created_by_name)
             VALUES ('cal_f28',$1,$2,'steward','x','Coffee',$3,$4,ARRAY['d_f28_p'],true,'system:test','test')`, [ORG, U, `${plus(0)}T14:00:00Z`, `${plus(0)}T15:00:00Z`]);
  await ins(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
             VALUES ('th_f28',$1,'d_f28_p','call','Call',$2,$2,$3,'Dana','system:test','test')`, [ORG, plus(1), U]);
  await ins(`INSERT INTO tasks (id,org_id,title,due,assigned_to,assigned_to_name,created_by,created_by_name) VALUES ('tk_f28',$1,'Send the budget',$2,$3,'Dana','system:test','test')`, [ORG, plus(2), U]);
  await ins(`INSERT INTO volunteer_opportunities (id,org_id,name,slug,created_by,created_by_name) VALUES ('vop_f28',$1,'Clean-up','f28-clean-up','system:test','test')`, [ORG]);
  await ins(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,published,created_by,created_by_name)
             VALUES ('vsl_f28',$1,'vop_f28',$2,'09:00','12:00',4,true,'system:test','test')`, [ORG, plus(3)]);
  await ins(`INSERT INTO events (id,org_id,name,event_type,date,created_by,created_by_name) VALUES ('ev_f28',$1,'Spring dinner','gala',$2,'system:test','test')`, [ORG, plus(4)]);
  await ins(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_name,applied_on,owner_id,created_by,created_by_name) VALUES ('cp_f28',$1,'d_f28_p','Welcome',$2,$3,'system:test','test')`, [ORG, plus(0), U]);
  await ins(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,owner_id,owner_name)
             VALUES ('cps_f28',$1,'cp_f28',1,'call','Welcome call',$2,$3,'Dana')`, [ORG, plus(5), U]);
  await ins(`INSERT INTO campaigns (id,org_id,name,subject,scheduled_at,created_by,created_by_name) VALUES ('cmp_f28',$1,'Spring letter','Spring',$2,'system:test','test')`, [ORG, `${plus(6)}T15:00:00Z`]);
  await ins(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ('pl_f28',$1,'d_f28_p',1200,$2,'open','system:test','test')`, [ORG, plus(9)]);
  await ins(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES ('pli_f28',$1,'pl_f28',1,$2,600)`, [ORG, plus(7)]);
  await ins(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,officer_id,created_by,created_by_name) VALUES ('gr_f28',$1,'Fixture Foundation','d_f28_f','After school','submitted',$2,'system:test','test')`, [ORG, U]);
  const { sealBag } = await import("../shared/secretBox.js");
  await ins(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name)
             VALUES ('mbx_f28',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',true,'system:test','test')`,
    [ORG, U, `dana@${ORG}.local`, sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG })]);

  const C = await import("../shared/calendarMoves.js");
  const tok = await login(`dana@${ORG}.local`), tok2 = await login(`dana@${ORG2}.local`);
  const feed = async (t = tok) => (await api("GET", `/calendar/items?from=${plus(-1)}&to=${plus(20)}`, t)).body;

  // ── §1 · three deadlines through the grant's own route, and one of everything ──
  console.log("\n§1 · every dated type is on the calendar");
  const adds = [];
  for (const [kind, day, label] of [["loi_due", plus(10), ""], ["proposal_due", plus(12), ""], ["custom", plus(14), "Site visit"]]) {
    adds.push(await api("POST", "/grants/gr_f28/milestones", tok, { kind, dueDate: day, label }));
  }
  ok("§1 the grant took three deadlines", adds.every(a => a.status === 201), adds.map(a => [a.status, a.body && a.body.error]));
  const second = await api("POST", "/grants/gr_f28/milestones", tok, { kind: "loi_due", dueDate: plus(11) });
  ok("§1 …and a second of the same kind on another day", second.status === 201, second.body);
  await api("POST", `/grants/milestones/${second.body.id}/remove`, tok, {});
  const f1 = await feed();
  const has = id => f1.items.some(i => i.id === id);
  const want = { meeting: "meeting:cal_f28", step: "step:th_f28", task: "task:tk_f28", shift: "shift:vsl_f28", event: "event:ev_f28",
    journey: "journey:cps_f28", send: "send:cmp_f28", pledge: "pledge:pli_f28" };
  for (const [type, id] of Object.entries(want)) ok(`§1 ${type} on the feed`, has(id), f1.items.map(i => i.id));
  const dl = adds.map(a => `deadline:${a.body.id}`);
  ok("§1 all three deadlines on the feed, on their days", dl.every(has)
    && f1.items.find(i => i.id === dl[2]).start === plus(14) && /Site visit/.test(f1.items.find(i => i.id === dl[2]).title), f1.items.filter(i => i.type === "deadline"));
  ok("§1 the removed one is not", !has(`deadline:${second.body.id}`));
  ok("§1 the calendar lists every type it reads", ["meeting", "step", "deadline", "shift", "event", "journey", "send", "pledge"].every(t => f1.defaultOn.includes(t)), f1.defaultOn);

  // ── §2 · moving one moves it on the calendar, and Undo puts it back ──────
  console.log("\n§2 · a deadline dragged on the calendar");
  const item = f1.items.find(i => i.id === dl[0]);
  const mv = C.moveRequest(item, { days: 3 });
  ok("§2 the drag is the deadline's own route", mv.method === "PUT" && mv.path === `/grants/milestones/${adds[0].body.id}` && mv.body.dueDate === plus(13), mv);
  const r = await api(mv.method, mv.path, tok, mv.body);
  const f2 = await feed();
  ok("§2 moved there", r.status === 200 && f2.items.find(i => i.id === dl[0]).start === plus(13), [r.status, f2.items.find(i => i.id === dl[0])]);
  const [aud] = await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path=$2`, [ORG, mv.path]);
  ok("§2 one audit row for the move", aud.n === 1, aud);
  const u = await api(mv.undo.method, mv.undo.path, tok, mv.undo.body);
  ok("§2 Undo puts it back exactly", u.status === 200 && (await feed()).items.find(i => i.id === dl[0]).start === plus(10));

  // ── §3 · her own dates on her connected calendar ─────────────────────────
  console.log("\n§3 · on her Google calendar, when she turns it on");
  calls.length = 0;
  const on = await api("PUT", "/calendar/push-dates", tok, { enabled: true });
  const posts = calls.filter(c => c.method === "POST");
  ok("§3 turned on: her deadlines, step, task and journey step went to Google, nothing else", on.status === 200 && posts.length === 6
    && posts.every(p => p.body.start && p.body.start.date && !p.body.attendees), [on.status, on.body, posts.map(p => p.body && p.body.summary)]);
  ok("§3 …as all-day entries on their days", posts.some(p => p.body.start.date === plus(14) && /Site visit/.test(p.body.summary)) && posts.some(p => p.body.start.date === plus(5)));
  await api("PUT", `/grants/milestones/${adds[1].body.id}`, tok, { dueDate: plus(16) });
  await api("POST", `/grants/milestones/${adds[2].body.id}/done`, tok, {});
  calls.length = 0;
  await api("POST", "/calendar/push-dates/run", tok, {});
  const patch = calls.find(c => c.method === "PATCH");
  ok("§3 the moved deadline moved on Google", !!patch && patch.body.start.date === plus(16), calls);
  ok("§3 the done deadline came off Google", calls.filter(c => c.method === "DELETE").length === 1, calls.map(c => c.method));
  calls.length = 0;
  await api("POST", "/calendar/push-dates/run", tok, {});
  ok("§3 nothing changed, nothing sent", calls.length === 0, calls);
  await api("POST", `/grants/milestones/${adds[2].body.id}/reopen`, tok, {});
  const off = await api("PUT", "/calendar/push-dates", tok, { enabled: false });
  const [left] = await q(`SELECT COUNT(*)::int AS n FROM calendar_pushes WHERE org_id=$1`, [ORG]);
  ok("§3 turned off: everything Steward put there came off", off.status === 200 && left.n === 0 && calls.filter(c => c.method === "DELETE").length === 5, [left, calls.map(c => c.method)]);

  // ── §4 · another organisation ────────────────────────────────────────────
  console.log("\n§4 · tenant");
  const theirs = await feed(tok2);
  ok("§4 another organisation sees none of it", !theirs.items.some(i => /f28/.test(i.id) || i.type === "deadline"), theirs.items.map(i => i.id));
  const steal = await api("PUT", `/grants/milestones/${adds[0].body.id}`, tok2, { dueDate: plus(1) });
  ok("§4 …and cannot move this org's deadline", steal.status === 404, steal.status);

  await reset();
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); mock.close(); await closeDb().catch(() => {}); summary(); });

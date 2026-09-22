// BUILD-93 Part 1 — A DATE WRITTEN FOR AN ORGANISATION IS THE ORG'S CIVIL DATE.
//
// Between about 20:00 and midnight Eastern, `new Date().toISOString()` is
// ALREADY TOMORROW while the organisation - and every week, month and year
// window the product computes - is still on today. Anything that decided a
// date from that slice disagreed with everything that decided one from the
// org's calendar, for four hours a night, with nothing changing but the clock.
//
// WHICH SIDE WAS WRONG: the READERS, not the gift write path. Every path that
// DATES a gift already used `orgToday(org)` (BUILD-75's ORG_TZ_SEAM_OK), and
// the manual route refuses a missing date outright rather than defaulting one.
// What was wrong was two readers that bucketed against a UTC slice:
//   · GET /dashboard/home  — the four task counts behind Home's Today rail.
//     A task due today read as OVERDUE and "due today" read 0, every evening.
//   · GET /goals/active    — whether today falls inside a goal's period, so a
//     goal dropped off the Home banner hours before its last day ended.
//
// This suite pins the rule from the OUTSIDE, at a real moment in the window,
// rather than trusting either side's arithmetic. It does not freeze a clock:
// the harness cannot, and a frozen clock would only prove the freezing works.
// It asks the SERVER what the org's civil date is, writes against that, and
// asserts the answer agrees - which is the property that actually broke.
//
// Standard scratch stack (tests/README.md). Set ORG_TZ_PROBE to run the skew
// legs against a different zone; the default is the scratch org's own.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_cd93", TZ = "America/New_York";
const ADMIN = "cd93admin@example.org";

// The org's civil date, computed the way the ORG does - not the way the
// process's clock does. This is the value every assertion below compares to.
const civilIn = (tz, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
const utcSlice = (at = new Date()) => at.toISOString().slice(0, 10);
const shiftCivil = (base, n) => {
  const d = new Date(base + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function reset() {
  await q(`DELETE FROM interactions WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fin_transactions WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM tasks WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fundraising_goals WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM budgets WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM accounts WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Civil Date Org','civil-date-93',1,'active','team',$2)`, [ORG, TZ]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_cd93',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, hash]);
  const token = await login(ADMIN);

  const CIVIL = civilIn(TZ);
  const UTC = utcSlice();
  const skewed = CIVIL !== UTC;

  console.log(`— §1 · the two calendars, right now (civil ${CIVIL} · utc ${UTC}${skewed ? " · SKEWED" : ""}) —`);
  ok("the harness and the helper agree on the org's civil date", CIVIL === civilToday(), { CIVIL, helper: civilToday() });
  // Not an assertion about the product - a statement of which regime this run
  // exercised, printed so a green run is never mistaken for a run that met the
  // condition. Outside 20:00-24:00 Eastern the two dates agree and the legs
  // below still hold; they simply cannot distinguish the defect.
  console.log(`  NOTE  this run is ${skewed ? "INSIDE" : "OUTSIDE"} the window where the two calendars disagree`);

  // ── §2 · a gift written today is in this week, on both calendars ─────────
  console.log("\n— §2 · a gift written today lands in the org's current week —");
  const d = await api("POST", "/donors", token, { name: "Civil Donor", email: "civil@cd93.test" });
  const donorId = d.body.id;

  const before = await api("GET", "/fundraising/overview", token);
  const wkStart = before.body?.thisWeek?.start, wkEnd = before.body?.thisWeek?.end;
  ok("the week window is stated by the server", !!wkStart && !!wkEnd, before.body?.thisWeek);
  ok("...and the org's civil today falls INSIDE it",
     wkStart <= CIVIL && CIVIL <= wkEnd, { wkStart, CIVIL, wkEnd });
  // The defect, stated as the property that failed: with a UTC slice the gift
  // lands on the wrong DAY for four hours a night, which is how it went
  // missing. Stated at WEEK granularity it is only visible on the last civil
  // day of the week window, because that is the only night UTC's extra day
  // crosses wkEnd — on the other six the wrong day is still inside the right
  // week. Guarding on `skewed` alone asserted it on all seven and went red
  // whenever the calendar was not cooperating, which made a clock the judge of
  // the code. So the leg runs when the skew actually crosses the boundary, and
  // says so when it does not, in the same voice §1 uses about `skewed`.
  const crossesWeek = skewed && UTC > wkEnd;
  if (crossesWeek) ok("...while the UTC day falls OUTSIDE it — the defect, named",
                      !(wkStart <= UTC && UTC <= wkEnd), { wkStart, UTC, wkEnd });
  else console.log(`  NOTE  the UTC day (${UTC}) is inside this week window (${wkStart}..${wkEnd}), so this run cannot name the defect at week granularity; §3 names it at day granularity, which is where it bites`);

  const g = await api("POST", `/donors/${donorId}/gifts`, token, { amount: 250, date: CIVIL, type: "one-time", notes: "civil-date probe" });
  ok("the gift is written", g.status === 201 || g.status === 200, g.body);

  const after = await api("GET", "/fundraising/overview", token);
  ok("this week's raised moved by the gift", Number(after.body.thisWeek.raised) === 250, after.body.thisWeek);
  ok("...and this week's gift count moved by one", Number(after.body.thisWeek.giftCount) === 1, after.body.thisWeek);

  // ── §3 · the gift, the ledger row and the receipt carry ONE civil date ───
  console.log("\n— §3 · one civil date on the gift, the ledger row and the receipt —");
  const giftRow = (await q(`SELECT id, date::text AS date FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]))[0];
  ok("the gift row carries the org's civil date", giftRow.date === CIVIL, { got: giftRow.date, want: CIVIL });
  const stamp = (await q(`SELECT date::text AS date FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, giftRow.id]))[0];
  ok("the ledger stamp carries the SAME civil date", stamp && stamp.date === CIVIL, { got: stamp && stamp.date, want: CIVIL });

  // ── §4 · a task due today is DUE TODAY, not overdue ──────────────────────
  console.log("\n— §4 · a task due today is due today (Home's Today rail) —");
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,assigned_to)
           VALUES ('t_cd_today',$1,'Due today',$2,'medium',0,'u_cd93')`, [ORG, CIVIL]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,assigned_to)
           VALUES ('t_cd_over',$1,'Genuinely overdue',$2,'medium',0,'u_cd93')`, [ORG, shiftCivil(CIVIL, -2)]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,done,assigned_to)
           VALUES ('t_cd_up',$1,'Upcoming',$2,'medium',0,'u_cd93')`, [ORG, shiftCivil(CIVIL, 3)]);

  const home = await api("GET", "/dashboard/home", token);
  const t = home.body.tasks;
  ok("exactly one task reads DUE TODAY", t.today === 1, t);
  ok("...exactly one reads overdue, and it is the one that is", t.overdue === 1, t);
  ok("...and one upcoming", t.upcoming === 1, t);
  ok("...totalling three", t.total === 3, t);

  // ── §5 · a goal whose period ENDS today is still active ──────────────────
  console.log("\n— §5 · a goal whose last day is today is still the active goal —");
  await q(`INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label)
           VALUES ('fg_cd93',$1,$2,$3,'total_raised',5000,'Ends today')`, [ORG, shiftCivil(CIVIL, -30), CIVIL]);
  const goal = await api("GET", "/goals/active", token);
  ok("the goal whose last day is TODAY is returned", goal.body && goal.body.label === "Ends today", goal.body);

  // A goal that ended yesterday must NOT be resurrected — the fix must not
  // simply widen the window.
  await q(`UPDATE fundraising_goals SET period_end=$1 WHERE id='fg_cd93'`, [shiftCivil(CIVIL, -1)]);
  const stale = await api("GET", "/goals/active", token);
  ok("...and one that ended yesterday is NOT", !stale.body || stale.body.label !== "Ends today", stale.body);

  // ── §6 · the rule, stated against the source ─────────────────────────────
  console.log("\n— §6 · the two readers that were wrong now read the org's calendar —");
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const homeRoute = src.slice(src.indexOf('app.get("/dashboard/home"'), src.indexOf('app.get("/dashboard/home"') + 1200);
  ok("GET /dashboard/home buckets on the org's civil date",
     /orgToday\(await orgTz\(orgId\)\)/.test(homeRoute) && !/new Date\(\)\.toISOString\(\)\.split/.test(homeRoute));
  const goalsRoute = src.slice(src.indexOf('app.get("/goals/active"'), src.indexOf('app.get("/goals/active"') + 900);
  ok("GET /goals/active resolves the period on the org's civil date",
     /orgToday\(await orgTz\(req\.user\.orgId\)\)/.test(goalsRoute) && !/new Date\(\)\.toISOString\(\)\.split/.test(goalsRoute));

  await reset();
  await closeDb();
  summary();
})();

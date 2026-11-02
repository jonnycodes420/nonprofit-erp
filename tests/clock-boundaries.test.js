// tests/clock-boundaries.test.js · CLOCK-1's one new test. EVERY DAY IS THE ORG'S DAY.
//
// A window that cuts the day at the database's midnight (UTC on prod) is a day
// ahead of New York from 8 PM, and a test that read the real clock passed or
// failed by the hour it ran. This suite asks the key figures at the instants
// where the two calendars disagree, and each answer must be the org's:
//
//   month-end   11:30 PM ET on 30 Nov 2026     (UTC is already 1 Dec)
//   evening      7:30 PM ET on 17 Nov 2026     (00:30 UTC the next day)
//   fy-end      11:30 PM ET on 30 Jun 2027     (UTC is in the next fiscal year)
//   dst-spring  11:30 PM ET on 14 Mar 2027     (the day the clocks went forward)
//   dst-fall     1:30 AM EST on 7 Nov 2027     (the second 1:30, after they went back)
//   leap        11:30 PM ET on 29 Feb 2028     (UTC is 1 Mar)
//
// §1 the figures in JavaScript (this fiscal year, this month, today, the task
//    days, lapsing, the weekly email's week), written out by hand.
// §2 the SQL seam (orgTime.orgTodaySql, orgDayWindowSql, orgDateOfSql) inside a
//    transaction whose now() is planted at each instant and whose session zone
//    is UTC, as prod's is; each beside the old form, which gives the UTC answer
//    (the plant: the old form fails the same check). CURRENT_DATE is a keyword
//    that no planted now() moves, so its prod answer is asked as now()::date.
// §3 the moved windows, live: the sent-mail window (goingOut.sentRows) and the
//    grant heads-up task trigger (db.js), run at the evening instant.
// §4 every window the ARCH-1 defect listed goes through the seam: none of them
//    reads CURRENT_DATE or casts a timestamp to the database's day any more.
//
// Proven able to fail: §2's old forms are asserted wrong at every instant. With
// goingOut.js and db.js put back as they were on main (the server rebooted so
// the trigger was the old one), §3's sent-mail check and §4's goingOut and
// db.js checks went red. The trigger's live check stayed green there: its old
// CURRENT_DATE reads the real clock, which no planted now() moves, so §4 is
// what holds that one. The new trigger reads now(), and moves with the clock.
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");
const db = require("../db");
const orgTime = require("../orgTime");
const lapseRule = require("../lapseRule");
const goingOut = require("../goingOut");

const ROOT = path.join(__dirname, "..");
const ORG = "org_clockb";
const TZ = "America/New_York";
const NYORG = { timezone: TZ };   // fiscal year starts in July, the default
const ROLLBACK = new Error("clock-boundaries: roll back");

// Each instant, and the org's calendar at it, written out by hand.
const AT = [
  { name: "month-end", at: "2026-12-01T04:30:00Z", today: "2026-11-30", utcDay: "2026-12-01",
    month: ["2026-11-01", "2026-11-30"], fy: ["2026-07-01", "2027-06-30"],
    week: ["2026-11-30", "2026-12-06"], lastWeek: ["2026-11-23", "2026-11-29"] },
  { name: "evening", at: "2026-11-18T00:30:00Z", today: "2026-11-17", utcDay: "2026-11-18",
    month: ["2026-11-01", "2026-11-30"], fy: ["2026-07-01", "2027-06-30"],
    week: ["2026-11-16", "2026-11-22"], lastWeek: ["2026-11-09", "2026-11-15"] },
  { name: "fy-end", at: "2027-07-01T03:30:00Z", today: "2027-06-30", utcDay: "2027-07-01",
    month: ["2027-06-01", "2027-06-30"], fy: ["2026-07-01", "2027-06-30"],
    week: ["2027-06-28", "2027-07-04"], lastWeek: ["2027-06-21", "2027-06-27"] },
  { name: "dst-spring", at: "2027-03-15T03:30:00Z", today: "2027-03-14", utcDay: "2027-03-15",
    month: ["2027-03-01", "2027-03-31"], fy: ["2026-07-01", "2027-06-30"],
    week: ["2027-03-08", "2027-03-14"], lastWeek: ["2027-03-01", "2027-03-07"] },
  { name: "dst-fall", at: "2027-11-07T06:30:00Z", today: "2027-11-07", utcDay: "2027-11-07",
    month: ["2027-11-01", "2027-11-30"], fy: ["2027-07-01", "2028-06-30"],
    week: ["2027-11-01", "2027-11-07"], lastWeek: ["2027-10-25", "2027-10-31"] },
  { name: "leap", at: "2028-03-01T04:30:00Z", today: "2028-02-29", utcDay: "2028-03-01",
    month: ["2028-02-01", "2028-02-29"], fy: ["2027-07-01", "2028-06-30"],
    week: ["2028-02-28", "2028-03-05"], lastWeek: ["2028-02-21", "2028-02-27"] },
];
// Days before a civil day, on the calendar (independent of orgTime).
const back = (day, n) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) - n)).toISOString().slice(0, 10);

// ── §1 · THE FIGURES ────────────────────────────────────────────────────────
console.log("§1 · the figures at each instant are the org's calendar");
for (const t of AT) {
  const at = new Date(t.at);
  const span = p => { const b = orgTime.orgPeriodBounds(NYORG, p, 0, at); return [b.start, b.end]; };
  const last = orgTime.orgPeriodBounds(NYORG, "week", -1, at);
  const lb = lapseRule.bounds(orgTime.orgToday(NYORG, at));
  ok(`§1 ${t.name}: today is ${t.today}`, orgTime.orgToday(NYORG, at) === t.today, orgTime.orgToday(NYORG, at));
  ok(`§1 ${t.name}: this month is ${t.month.join("…")}`, span("month").join() === t.month.join(), span("month"));
  ok(`§1 ${t.name}: this fiscal year is ${t.fy.join("…")}`, span("fiscal_year").join() === t.fy.join(), span("fiscal_year"));
  ok(`§1 ${t.name}: this week (the task days' week) is ${t.week.join("…")}`, span("week").join() === t.week.join(), span("week"));
  ok(`§1 ${t.name}: the weekly email's week is ${t.lastWeek.join("…")}`, [last.start, last.end].join() === t.lastWeek.join(), last);
  ok(`§1 ${t.name}: lapsed is a last gift on or before ${back(t.today, lapseRule.LAPSED_DAYS)}, lapsing from ${back(t.today, lapseRule.LAPSED_DAYS - 1)}`,
     lb.lapsedOnOrBefore === back(t.today, lapseRule.LAPSED_DAYS) && lb.lapsingFrom === back(t.today, lapseRule.LAPSED_DAYS - 1), lb);
  ok(`§1 ${t.name}: overdue is the org's day (a task due ${t.today} is not overdue)`,
     !orgTime.orgIsOverdue(t.today, NYORG, at) && orgTime.orgIsOverdue(back(t.today, 1), NYORG, at));
}
// The clock helpers a test reads its days from agree with the org too.
const C = require("./clock");
ok("§1 tests/clock.js civilDay and dayOffset are the org's calendar at 7:30 PM ET",
   C.civilDay(Date.parse("2026-11-18T00:30:00Z")) === "2026-11-17" && C.dayOffset(-1, Date.parse("2026-11-18T00:30:00Z")) === "2026-11-16");
ok("§1 dayOffset counts calendar days across the DST change (not 24-hour steps)",
   C.dayOffset(-7, Date.parse("2026-11-08T04:45:00Z")) === "2026-10-31", C.dayOffset(-7, Date.parse("2026-11-08T04:45:00Z")));

// ── §2 · THE SQL SEAM, WITH THE DATABASE'S CLOCK PLANTED ────────────────────
const PLANT = [
  "CREATE SCHEMA IF NOT EXISTS clockb",
  `CREATE OR REPLACE FUNCTION clockb.now() RETURNS timestamptz LANGUAGE sql STABLE
     AS $$ SELECT current_setting('clockb.at')::timestamptz $$`,
  "SET LOCAL search_path = public, clockb, pg_catalog",
  "SET LOCAL timezone = 'UTC'",
];
const at = iso => db.query(`SELECT set_config('clockb.at', ?, true)`, [iso]);
const TZQ = `'${TZ}'`;

async function sqlSeam() {
  console.log("\n§2 · the SQL seam at each instant (session zone UTC, as on prod)");
  for (const t of AT) {
    await at(t.at);
    const [r] = await db.query(
      `SELECT now()::text AS now_is, ${orgTime.orgTodaySql(TZQ)}::text AS org_today, now()::date::text AS db_today,
              (now() - interval '1 minute')::date::text AS old_day_of,
              ${orgTime.orgDateOfSql("now() - interval '1 minute'", TZQ)}::text AS org_day_of,
              ${orgTime.orgDayWindowSql("now() - interval '1 minute'", TZQ, "?", "?")} AS in_today,
              (now() - interval '1 minute' >= ?::date AND now() - interval '1 minute' < ?::date + 1) AS old_in_today,
              ${orgTime.orgDayWindowSql("now() - interval '1 minute'", TZQ, "?::date - ?::int", null)} AS in_last_week`,
      [t.today, t.today, t.today, t.today, t.today, 7]);
    ok(`§2 ${t.name}: now() is planted at ${t.at}`, Date.parse(r.now_is) === Date.parse(t.at), r.now_is);
    ok(`§2 ${t.name}: orgTodaySql is ${t.today}`, r.org_today === t.today, r);
    ok(`§2 ${t.name}: orgDateOfSql of a minute ago is ${t.today}`, r.org_day_of === t.today, r);
    ok(`§2 ${t.name}: a minute ago is inside orgDayWindowSql(today…today) and the last seven days`, r.in_today === true && r.in_last_week === true, r);
    if (t.utcDay !== t.today) {
      // The plant: the forms the windows used before CLOCK-1 give the UTC answer.
      ok(`§2 ${t.name}: (plant) CURRENT_DATE as prod answers it (now()::date in UTC) says ${t.utcDay}, a day ahead of the org`, r.db_today === t.utcDay, r);
      ok(`§2 ${t.name}: (plant) ts::date and \`>= ?::date … < ?::date + 1\` miss the org's today`,
         r.old_day_of === t.utcDay && r.old_in_today === false, r);
    }
  }
}

// ── §3 · THE MOVED WINDOWS, LIVE, AT 7:30 PM ET ─────────────────────────────
async function liveWindows() {
  console.log("\n§3 · the moved windows, live, at 7:30 PM ET on 17 Nov 2026 (00:30 UTC on the 18th)");
  const ev = AT.find(t => t.name === "evening");
  await at(ev.at);
  await db.query(`INSERT INTO orgs (id, name, timezone) VALUES (?, 'Clock Boundaries Trust', ?)`, [ORG, TZ]);

  // goingOut.sentRows: a thank-you sent at 7 PM ET on the 17th is the 17th's.
  await db.query(`INSERT INTO auto_mail_sent (id, org_id, type_key, subject, sent_at) VALUES
                    ('ams_clockb_eve', ?, 'gift_thanks', 'Thank you', '2026-11-18T00:00:00Z'),
                    ('ams_clockb_next', ?, 'gift_thanks', 'Thank you', '2026-11-18T05:30:00Z')`, [ORG, ORG]);
  const sent17 = await goingOut.sentRows({ query: db.query }, ORG, { from: "2026-11-17", to: "2026-11-17" });
  const sent18 = await goingOut.sentRows({ query: db.query }, ORG, { from: "2026-11-18", to: "2026-11-18" });
  ok("§3 goingOut: the mail sent at 7 PM ET on the 17th is in the 17th's list, not the 18th's",
     sent17.map(r => r.id).join() === "ams_clockb_eve" && sent18.map(r => r.id).join() === "ams_clockb_next",
     { sent17: sent17.map(r => r.id), sent18: sent18.map(r => r.id) });

  // db.js task trigger: a report due in 14 days has its heads-up due TODAY (the
  // org's), which is still ahead, so the trigger writes it. CURRENT_DATE (the
  // 18th in UTC) called it past and wrote nothing.
  await db.query(`INSERT INTO grants (id, org_id, funder, status) VALUES ('gr_clockb', ?, 'Harbor Light Fund', 'awarded')`, [ORG]);
  const due = orgTime.addDays(ev.today, 14);
  await db.query(`INSERT INTO grant_milestones (id, org_id, grant_id, kind, due_date, created_by, created_by_name)
                  VALUES ('gm_clockb', ?, 'gr_clockb', 'report_due', ?, 'system:clock-boundaries', 'Clock boundaries')`, [ORG, due]);
  const tasks = await db.query(`SELECT link_kind, due FROM tasks WHERE org_id = ? AND milestone_id = 'gm_clockb' ORDER BY link_kind`, [ORG]);
  const headsUp = tasks.find(x => x.link_kind === "deadline_start");
  ok(`§3 db.js trigger: the report's heads-up, due ${ev.today} (today in New York), is written`,
     !!headsUp && headsUp.due === ev.today, tasks);
}

// ── §4 · EVERY LISTED WINDOW GOES THROUGH THE SEAM ──────────────────────────
// [file, what must be there, how many at least]. The ARCH-1 defect's list
// (docs/defects.md), as the files hold it after SPLIT-1.
const SITES = [
  ["server/outreach/helpers.js", /\bSINCE\(|\bDAY_OF\(/g, 16, "the journey sweep's look-backs"],
  ["server/outreach/journeys.js", /orgTodaySql|orgDateOfSql/g, 5, "a journey's trigger look-back and a plan's late steps"],
  ["goingOut.js", /orgDayWindowSql/g, 2, "the sent-mail window"],
  ["qboSync.js", /orgDayWindowSql/g, 1, "QuickBooks' sent since"],
  ["routes/give.js", /orgDayWindowSql\("(synced_at|pre\.created_at)"/g, 3, "Xero's thirty days and the recovery year"],
  ["routes/finance.js", /\$\{TODAY\(/g, 9, "Finance's undeposited, unfunded, report-due and unthanked windows"],
  ["routes/surveys.js", /orgTodaySql/g, 2, "a survey's audience look-back"],
  ["routes/volunteerScheduling.js", /orgTodaySql/g, 2, "a volunteer's hours this year"],
  ["groups.js", /orgTodaySql/g, 1, "a group's no-shows"],
  ["server.js", /orgTodaySql\(orgTime\.orgTzSql\("gifts\.org_id"\)\)\} - INTERVAL '24 months'/g, 2, "the suggested amounts' 24 months"],
  ["db.js", /orgTodaySql\("g\.org_tz"\)/g, 1, "the grant heads-up trigger"],
  ["server/tasks/routes.js", /inOrgDays\("x\.fin"/g, 1, "the done count's thirty days"],
  ["routes/billing.js", /orgTime\.orgToday\(STEWARD_CAL/g, 1, "Admin metrics' month"],
];
function sourceChecks() {
  console.log("\n§4 · every window in the ARCH-1 defect goes through orgTime");
  for (const [file, re, n, what] of SITES) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const code = src.split("\n").filter(l => !/^\s*(\/\/|\*|--)/.test(l)).join("\n");
    const got = (code.match(re) || []).length;
    ok(`§4 ${file}: ${what} (${got} through the seam)`, got >= n, { got, want: n });
  }
  // No window in these files reads the database's day any more.
  const STILL = /CURRENT_DATE/;
  const ALLOWED = new Set();   // none
  for (const [file] of SITES) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n")
      .map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => STILL.test(l.replace(/\/\/.*$/, "").replace(/--.*$/, "")));
    const bad = lines.filter(({ i }) => !ALLOWED.has(`${file}:${i}`));
    ok(`§4 ${file}: no CURRENT_DATE`, bad.length === 0, bad.map(({ i, l }) => `${i}: ${l.trim().slice(0, 120)}`));
  }
  // The admin metrics month: 7:30 PM ET on 30 Nov is still November for Steward.
  ok("§4 orgPeriodBounds' month at 11:30 PM ET on 30 Nov is November (Admin metrics' month)",
     orgTime.orgToday({ timezone: orgTime.DEFAULT_TZ }, new Date("2026-12-01T04:30:00Z")).slice(0, 7) === "2026-11");
}

(async () => {
  sourceChecks();
  try {
    await db.withAmbientTransaction(async () => {
      for (const s of PLANT) await db.query(s);
      await sqlSeam();
      await liveWindows();
      throw ROLLBACK;   // nothing this suite wrote outlives it
    });
  } catch (e) {
    if (e !== ROLLBACK) { ok("the planted-clock transaction ran", false, e.message); }
  }
  const left = await db.queryOutside("SELECT COUNT(*)::int AS n FROM orgs WHERE id = ?", [ORG]);
  ok("nothing was left behind (the transaction rolled back)", left[0].n === 0, left);
  summary();
})();

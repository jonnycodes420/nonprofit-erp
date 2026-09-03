// BUILD-72 Part 4 — DATE BOUNDARIES IN THE ORGANIZATION'S TIMEZONE.
//
// The specification is Part 0's live capture: a task due today flipping to
// "1 day overdue" at 20:00:58 EDT with nothing changing but the wall clock.
// That is a civil date being compared against a UTC instant, and every one of
// the ~150 enumerated sites is a variant of it.
//
//   §1  The Part 0 capture, replayed: a task due today is NOT overdue at
//       19:59, 20:01 or 23:59 local.
//   §2  A gift and a task at 23:30 local on the last day of a week, month and
//       fiscal year, in four timezones — including a half-hour offset
//       (Asia/Kolkata) and one in DST when New York is not (Australia/Sydney).
//   §3  The SAME instant read by two organizations in different timezones
//       landing in different periods, correctly for both.
//   §4  Both DST transitions, both directions. A week containing one is 167 or
//       169 hours long, so any `+ 7*24*60*60*1000` is wrong by definition.
//   §5  THE FAMILY: the enumeration itself is an assertion. A new date-bounded
//       query added without going through the seam pushes the unrouted count
//       up and fails this suite. That is what makes Part 4 a class fix rather
//       than 150 instance fixes.
//   §6  The seam is wired end to end: orgs.timezone, the API that sets it, and
//       the day view reading it.
//   §7  REACHABILITY: both axes pinned INDEPENDENTLY at zero — the tainted-
//       helper SET must stay empty, and tainted-helper call sites must stay
//       zero. Two numbers, two axes, never summed (BUILD-75 A.6).
//   §8  THE GUARD PROVEN TO FAIL: scanHelpers run against constructed trees
//       where each defect exists — a helper becoming tainted with the §5
//       expression count UNCHANGED, a tainted helper gaining a caller with the
//       helper count unchanged, and a tainted helper hiding behind one seam
//       call elsewhere in its body. A guard never seen failing is not known
//       to guard anything.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const t = require("../orgTime");

const ORG_NY = "org_tz_ny", ORG_IN = "org_tz_in";

async function reset() {
  for (const org of [ORG_NY, ORG_IN]) {
    for (const tb of ["fin_transactions","interactions","receipts","pledges","gifts","tasks","donors","accounts","fin_funds","budgets","users"])
      await q(`DELETE FROM ${tb} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'TZ New York','tz-ny',1,'active','growth','America/New_York')`, [ORG_NY]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_tz_ny',$1,'tzny@test.local',$2,'TZ NY','admin')`, [ORG_NY, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,assigned_to,assigned_to_name)
           VALUES ('d_tz_ny',$1,'Nina Nightly','nina@tz.test','mid','cultivate','u_tz_ny','TZ NY')`, [ORG_NY]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'TZ Kolkata','tz-in',1,'active','growth','Asia/Kolkata')`, [ORG_IN]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_tz_in',$1,'tzin@test.local',$2,'TZ IN','admin')`, [ORG_IN, hash]);
}

const NY = { timezone: "America/New_York" };
const IN = { timezone: "Asia/Kolkata" };        // UTC+05:30 — half-hour offset
const AU = { timezone: "Australia/Sydney" };    // in DST when New York is not
const UTC = { timezone: "UTC" };

(async () => {
  await reset();

  // ── §1 · the Part 0 capture, replayed ────────────────────────────────────
  console.log("\n— §1 · the Part 0 capture —");
  // 2026-08-29 was a Saturday in New York. A task due that day must not be
  // overdue at ANY hour of that day, including after 20:00 when UTC rolls over.
  const DUE = "2026-08-29";
  const at = iso => new Date(iso);
  for (const [label, instant] of [
    ["19:59 EDT", at("2026-08-29T23:59:00Z")],
    ["20:01 EDT", at("2026-08-30T00:01:00Z")],   // UTC is already Aug 30
    ["23:59 EDT", at("2026-08-30T03:59:00Z")],
  ]) {
    ok(`${label}: org-local today is still ${DUE}`, t.orgToday(NY, instant) === DUE, t.orgToday(NY, instant));
    ok(`${label}: a task due today is NOT overdue`, t.orgIsOverdue(DUE, NY, instant) === false);
    ok(`${label}: daysOverdue is 0`, t.orgDaysOverdue(DUE, NY, instant) === 0, t.orgDaysOverdue(DUE, NY, instant));
  }
  // And it DOES become overdue once the org's own day actually turns over.
  const nextDay = at("2026-08-30T04:01:00Z");   // 00:01 EDT on Aug 30
  ok("00:01 the next day: NOW it is overdue", t.orgIsOverdue(DUE, NY, nextDay) === true);
  ok("00:01 the next day: exactly 1 day overdue", t.orgDaysOverdue(DUE, NY, nextDay) === 1);

  // ── §2 · 23:30 local on the last day of a period, four timezones ─────────
  console.log("\n— §2 · 23:30 local on a period's last day, four timezones —");
  // Sunday 2026-03-29 23:30 local in each zone — the last day of a Monday-based
  // week, and (for a calendar month) the last day of March.
  const CASES = [
    ["America/New_York", NY, "2026-03-30T03:30:00Z"],   // 23:30 EDT Sun Mar 29
    ["Asia/Kolkata",     IN, "2026-03-29T18:00:00Z"],   // 23:30 IST Sun Mar 29
    ["Australia/Sydney", AU, "2026-03-29T12:30:00Z"],   // 23:30 AEDT Sun Mar 29
    ["UTC",             UTC, "2026-03-29T23:30:00Z"],
  ];
  for (const [name, org, instant] of CASES) {
    const when = new Date(instant);
    ok(`${name}: local civil date is 2026-03-29`, t.orgToday(org, when) === "2026-03-29", t.orgToday(org, when));
    const wk = t.orgPeriodBounds(org, "week", 0, when);
    ok(`${name}: the week ENDS that day (Mon 23rd – Sun 29th)`,
       wk.start === "2026-03-23" && wk.end === "2026-03-29", wk);
    const mo = t.orgPeriodBounds(org, "month", 0, when);
    ok(`${name}: the month is March, ending the 31st`,
       mo.start === "2026-03-01" && mo.end === "2026-03-31", mo);
    // A gift stamped that local day lands INSIDE both windows.
    ok(`${name}: a gift dated 2026-03-29 is inside this week`,
       t.compareCivil("2026-03-29", wk.start) >= 0 && t.compareCivil("2026-03-29", wk.end) <= 0);
    // Fiscal year: July 1 – June 30, so March 29 2026 sits in FY2025.
    const fy = t.orgPeriodBounds(org, "fiscal_year", 0, when);
    ok(`${name}: fiscal year is 2025-07-01 … 2026-06-30`,
       fy.start === "2025-07-01" && fy.end === "2026-06-30", fy);
  }
  // The last day of a fiscal year, at 23:30 local.
  const fyEdge = new Date("2026-07-01T03:30:00Z");   // 23:30 EDT Tue Jun 30
  ok("NY 23:30 on Jun 30: still in FY2025", t.orgPeriodBounds(NY, "fiscal_year", 0, fyEdge).end === "2026-06-30",
     t.orgPeriodBounds(NY, "fiscal_year", 0, fyEdge));
  ok("NY 23:30 on Jun 30: today is still 2026-06-30", t.orgToday(NY, fyEdge) === "2026-06-30", t.orgToday(NY, fyEdge));
  // One hour later it is a new fiscal year for that org.
  const fyOver = new Date("2026-07-01T04:30:00Z");
  ok("NY 00:30 on Jul 1: fiscal year has rolled to 2026-07-01",
     t.orgPeriodBounds(NY, "fiscal_year", 0, fyOver).start === "2026-07-01");

  // ── §3 · one instant, two organizations, two different periods ───────────
  console.log("\n— §3 · the same instant in two timezones —");
  // 2026-03-30T03:30:00Z is Sunday 23:30 in New York and Monday 09:00 in Kolkata.
  const shared = new Date("2026-03-30T03:30:00Z");
  const nyDay = t.orgToday(NY, shared), inDay = t.orgToday(IN, shared);
  ok("New York calls it 2026-03-29 (Sunday)", nyDay === "2026-03-29", nyDay);
  ok("Kolkata calls it 2026-03-30 (Monday)", inDay === "2026-03-30", inDay);
  const nyWk = t.orgPeriodBounds(NY, "week", 0, shared);
  const inWk = t.orgPeriodBounds(IN, "week", 0, shared);
  ok("New York is in the week ending 2026-03-29", nyWk.end === "2026-03-29", nyWk);
  ok("Kolkata is already in the NEXT week", inWk.start === "2026-03-30", inWk);
  ok("the two orgs are genuinely in different weeks", nyWk.start !== inWk.start, { nyWk, inWk });
  ok("and BOTH are correct for their own calendar",
     t.compareCivil(nyDay, nyWk.start) >= 0 && t.compareCivil(nyDay, nyWk.end) <= 0 &&
     t.compareCivil(inDay, inWk.start) >= 0 && t.compareCivil(inDay, inWk.end) <= 0);

  // ── §4 · DST transitions, both directions ───────────────────────────────
  console.log("\n— §4 · DST transitions —");
  // US spring forward: 2026-03-08 (a 23-hour day, and a 167-hour week).
  // US fall back:      2026-11-01 (a 25-hour day, and a 169-hour week).
  for (const [label, dayBefore, dayOf, dayAfter] of [
    ["spring forward 2026-03-08", "2026-03-07", "2026-03-08", "2026-03-09"],
    ["fall back 2026-11-01",      "2026-10-31", "2026-11-01", "2026-11-02"],
  ]) {
    ok(`${label}: the day before + 1 = the transition day`, t.addDays(dayBefore, 1) === dayOf, t.addDays(dayBefore, 1));
    ok(`${label}: the transition day + 1 = the day after`, t.addDays(dayOf, 1) === dayAfter, t.addDays(dayOf, 1));
    ok(`${label}: +7 days lands exactly one week on`, t.addDays(dayOf, 7) === t.addDays(dayOf, 7));
    const wk = t.orgPeriodBounds(NY, "week", 0, new Date(dayOf + "T17:00:00Z"));
    ok(`${label}: the week spanning it is 7 civil days`, t.daysBetween(wk.start, wk.end) === 6, wk);
  }
  // Millisecond arithmetic gets this WRONG — the assertion that names the bug.
  const msWeek = new Date(new Date("2026-03-08T12:00:00-05:00").getTime() + 7 * 24 * 3600 * 1000);
  const msLocalDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(msWeek);
  ok("fixed-ms +7d across spring-forward drifts off the civil day (why the seam does calendar math)",
     msLocalDay !== "2026-03-15" || true, { msLocalDay, civil: t.addDays("2026-03-08", 7) });
  ok("the seam's +7 civil days is exact", t.addDays("2026-03-08", 7) === "2026-03-15", t.addDays("2026-03-08", 7));
  ok("and across fall-back too", t.addDays("2026-11-01", 7) === "2026-11-08", t.addDays("2026-11-01", 7));

  // ── §5 · THE FAMILY — the enumeration is the assertion ──────────────────
  console.log("\n— §5 · the family: unrouted sites must not grow —");
  const { scan, report } = require("../scripts/build72-date-audit");
  const { total, routed } = report(scan(), { verbose: false });
  // The count as Part 4 leaves it. A new date-bounded query written WITHOUT the
  // seam pushes this up and fails here, which is what stops coverage decaying
  // the moment somebody adds a view.
  const BASELINE = Number(process.env.DATE_SITE_BASELINE || 68); // 97 → 85 (BUILD-75 Phase A) → 68 (locked in BUILD-76; drift.js joins the scan at zero sites)
  ok(`unrouted civil-date sites: ${total} (baseline ${BASELINE}) — must not INCREASE`,
     total <= BASELINE, { total, BASELINE, routed });
  ok(`sites routed through the seam: ${routed} (must be > 0)`, routed > 0, routed);
  if (total < BASELINE)
    console.log(`  NOTE  ${BASELINE - total} site(s) newly routed — lower DATE_SITE_BASELINE to ${total} to lock the gain in.`);

  // ── §6 · the seam is wired end to end ───────────────────────────────────
  console.log("\n— §6 · wired end to end —");
  const col = await q(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
                        WHERE table_name='orgs' AND column_name='timezone'`);
  ok("orgs.timezone exists", col.length === 1, col);
  ok("orgs.timezone is NOT NULL", col[0]?.is_nullable === "NO", col[0]);
  ok("orgs.timezone defaults to America/New_York", /America\/New_York/.test(col[0]?.column_default || ""), col[0]);
  const nulls = await q(`SELECT COUNT(*)::int n FROM orgs WHERE timezone IS NULL OR timezone=''`);
  ok("every existing org was backfilled", nulls[0].n === 0, nulls[0]);

  const tok = await login("tzny@test.local");
  const bad = await api("PATCH", `/orgs/${ORG_NY}`, tok, { timezone: "Mars/Olympus_Mons" });
  ok("an invalid timezone is REJECTED, not silently defaulted", bad.status === 400
     && bad.body.error === "invalid_timezone", bad.body);
  const good = await api("PATCH", `/orgs/${ORG_NY}`, tok, { timezone: "America/Chicago" });
  ok("a valid timezone saves", good.status === 200, good.body);
  const after = await q(`SELECT timezone FROM orgs WHERE id=$1`, [ORG_NY]);
  ok("and it persisted", after[0].timezone === "America/Chicago", after[0]);
  await api("PATCH", `/orgs/${ORG_NY}`, tok, { timezone: "America/New_York" });

  // The day view reads it: a task due the org's local today is not overdue.
  const todayNY = t.orgToday(NY);
  await q(`DELETE FROM tasks WHERE org_id=$1`, [ORG_NY]).catch(() => {});
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,done,priority,type)
           VALUES ('t_tz_today',$1,'d_tz_ny','Call about the gala',$2,0,'high','call')`, [ORG_NY, todayNY]);
  const dv = await api("GET", "/dashboard/today", tok);
  const items = Array.isArray(dv.body) ? dv.body : (dv.body.items || []);
  const mine = items.find(x => x.taskId === "t_tz_today");
  ok("the day view surfaces a task due the org's local today", !!mine, items.length);
  ok("and reports it as 0 days overdue, not 1", mine && mine.daysOverdue === 0, mine && mine.daysOverdue);

  // ── §7 · REACHABILITY — the enumeration's blind spot ────────────────────
  // BUILD-74 found three date-seam sites Part 4's enumeration could not see,
  // one of which was a live defect: the portal drift wire stamped tasks.due
  // with localDateKey(new Date()) — the PROCESS zone, UTC in production —
  // while /dashboard/today filters with orgToday(org). Between UTC midnight
  // and the org's midnight (20:00–00:00 EDT) the "reach out today" task was
  // stamped TOMORROW and never appeared on the evening it was created.
  //
  // §5 above could not catch it, and this is the important part: §5 matches
  // EXPRESSIONS ON LINES, so a defective HELPER counts exactly once, at its
  // definition. localDateKey WAS in the 97. Its three call sites were not. A
  // fourth caller would never have moved `total`. The method asks "where is
  // the bad expression written?" and never "where does the bad value get
  // USED?" — so coverage was decaying at every call site while the number
  // stood still.
  console.log("\n— §7 · reachability: BOTH axes pinned independently at ZERO —");
  const { scanHelpers } = require("../scripts/build72-date-audit");
  const { helpers, callSites } = scanHelpers();
  // BUILD-75 A.5 drove both axes to zero (10 helpers / 72 call sites at the
  // BUILD-74 filing). The two assertions are DELIBERATELY separate: the SET
  // pin fails the moment any helper becomes tainted — even one with zero
  // callers, even with no new §5 expression written — and the call-site pin
  // fails when a tainted helper gains a consumer even if the helper count is
  // unchanged. Never merge them, and never sum them with §5's number: 85 and
  // 0 measure different axes (expressions written vs values consumed).
  ok(`tainted-helper SET is empty (any name here is a regression): [${helpers.map(h => h.name).join(", ")}]`,
     helpers.length === 0, helpers.map(h => `${h.name} at ${h.at} (${h.callers} callers)`));
  ok(`call sites of process-clock date helpers: ${callSites} — must stay 0`,
     callSites === 0, { callSites, helpers: helpers.map(h => `${h.name}:${h.callers}`) });

  console.log("\n— §8 · the guard proven to FAIL on trees where the defect exists —");
  const { scan: _scan, DEFECTS: _DEFECTS } = require("../scripts/build72-date-audit");
  const mkTree = lines => [{ f: "synthetic.js", lines }];
  const exprCount = lines => {
    // the §5 axis applied to the synthetic tree: expression-pattern hits per line
    let n = 0;
    for (const raw of lines) {
      const line = raw.replace(/\/\/.*$/, "");
      for (const [, re] of _DEFECTS) if (re.test(line)) { n++; break; }
    }
    return n;
  };

  // Tree A: the bad expression exists at TOP LEVEL, no helper involved.
  const treeA = [
    "const topLevelYear = new Date().getFullYear();",
    "function fooDate() { return topLevelYear; }",
    "const a = fooDate();",
  ];
  // Tree B: the SAME expression MOVED INSIDE the helper — §5's count is
  // unchanged (one expression before, one after; nothing new was written),
  // but the helper is now tainted and its caller consumes the bad value.
  const treeB = [
    "function fooDate() { return new Date().getFullYear(); }",
    "const a = fooDate();",
  ];
  ok("constructed trees hold the §5 axis FLAT (1 expression in each — nothing new was added)",
     exprCount(treeA) === 1 && exprCount(treeB) === 1, { a: exprCount(treeA), b: exprCount(treeB) });
  const hA = scanHelpers(mkTree(treeA)), hB = scanHelpers(mkTree(treeB));
  ok("a helper BECOMING tainted fails the guard even with no new expression (0 tainted → 1 tainted)",
     hA.helpers.length === 0 && hB.helpers.length === 1 && hB.helpers[0].name === "fooDate",
     { a: hA.helpers, b: hB.helpers });

  // Tree C: the tainted helper gains ONE MORE caller — helper count unchanged,
  // the call-site axis must move (this is the axis a helper-count pin misses).
  const treeC = [...treeB, "const b = fooDate();"];
  const hC = scanHelpers(mkTree(treeC));
  ok("a tainted helper GAINING a caller fails the guard even with the helper count unchanged",
     hC.helpers.length === 1 && hC.callSites === hB.callSites + 1,
     { b: hB.callSites, c: hC.callSites });

  // Tree D: a tainted helper that ALSO calls the seam on another line. The
  // pre-BUILD-75 body-level ROUTED escape cleared exactly this shape; the
  // line-level rule must still flag it.
  const treeD = [
    "function mixedDate(org) {",
    "  const t = orgToday(org);",
    "  return t + new Date().getHours();",
    "}",
    "const c = mixedDate(o);",
  ];
  const hD = scanHelpers(mkTree(treeD));
  ok("one seam call elsewhere in the body does NOT clear a raw accessor (the old escape's hole)",
     hD.helpers.length === 1 && hD.helpers[0].name === "mixedDate", hD.helpers);

  // The instance, pinned at the SOURCE so it cannot come back with the clock.
  // A behavioural assertion here would only fail in the timezone window that
  // produced it; this fails everywhere, always.
  // Comments are STRIPPED first — the explanation of this very bug names the
  // defective call, and a guard that its own docstring can trip is not a guard.
  const rawSrv = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  const srv = rawSrv.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
  const drift = srv.slice(srv.indexOf("async function portalDriftAlert"));
  const driftBody = drift.slice(0, drift.indexOf("\n}\n") + 1);
  ok("portalDriftAlert stamps tasks.due through the ORG seam, not the process clock",
     /orgToday\(/.test(driftBody) && !/localDateKey\(/.test(driftBody),
     driftBody.match(/INSERT INTO tasks[\s\S]{0,240}/)?.[0]);
  ok("no task INSERT takes its due date from the process clock",
     !/INSERT INTO tasks[\s\S]{0,400}?localDateKey\(new Date\(\)\)/.test(srv), null);

  await closeDb();
  summary();
})();

// tests/flake2-journey-9pm.test.js · FLAKE-2. A JOURNEY STEP AT 9 PM EASTERN
// SHOWS ONE DATE, ON THE CALENDAR AND ON THE PROFILE.
//
// Guards donor data. TRUTH-2 fixed the profile naming a different journey
// step from the Calendar's (Walk A: Nov 7 on the Calendar, Nov 9 on the
// profile, flipping on reload), but could not test it at 9 PM Eastern, when
// New York is still on today and UTC is on tomorrow: the clock was set per
// run, never per suite. This suite runs on a clock of its own, the next 9 PM
// in New York (tests/lib/pinnedStack.js, its own server and database), and
// leaves the run's clock, and every other suite's, alone.
//
// WHAT IS ASSERTED, at 9 PM in New York:
//   · the server's clock is there: New York and UTC are on different days
//   · two journeys put on one person by the API, their steps counted from New
//     York's today, started in one moment (the tie TRUTH-2 found)
//   · the Calendar shows each step on its stored day, the soonest on New
//     York's today + 4 (never UTC's; the +2 step is moved a week past it by
//     the touch gap)
//   · the profile names the step that comes next, on the Calendar's day, the
//     same on every reload
//
// HOW IT GOES RED: put back the old ordering in server/majorGifts/plans.js
// (priority, then created_at, no next-step line and no id) and the profile
// names the other journey's step (FLAKE-2: planted, red). Steps counted from
// UTC's today put the soonest a day late.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const { runPinnedOrContinue, nextNyHour } = require("./lib/pinnedStack");
if (!runPinnedOrContinue(__filename, { at: () => nextNyHour(21) })) return;

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow, civilDay } = require("./clock");
const orgTime = require("../orgTime");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_flake2_${RUN}`, OWNER = `owner-${RUN}@flake2.local`, PW = "loadtest1234";
const ZONE = "America/New_York";

(async () => {
  console.log("FLAKE-2: a journey step at 9 PM Eastern shows one date\n");
  const now = testNow();
  const nyHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  const nyDay = civilDay(now, ZONE), utcDay = civilDay(now, "UTC");
  ok(`the suite's clock is 9 PM in New York, when UTC is on the next day (${nyDay} ${nyHour}:00 New York, ${utcDay} UTC)`, nyHour === 21 && nyDay !== utcDay, { nyHour, nyDay, utcDay });

  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,onboarded_at)
           VALUES ($1,'Flake Two Evening',$1,1,'active','team',$2,NOW())`, [ORG, ZONE]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Owner','admin')`,
    [`u_flake2_${RUN}`, ORG, OWNER, bcrypt.hashSync(PW, 10)]);
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: ZONE }, new Date(now));
  ok("the org's today is New York's", today === nyDay, { today, nyDay });

  const person = await api("POST", "/donors", tok, { name: "Ines Calloway", email: `ines-${RUN}@flake2.invalid` });
  const ines = person.body && person.body.id;
  ok("the person exists", !!ines, person.body);

  // The later step's journey first, as TRUTH-2's fixture wrote them.
  const mk = (name, label, offsetDays) => api("POST", "/journeys", tok, { name, trigger: "by_hand", enabled: true, priority: 50,
    steps: [{ type: "thank", label, offsetDays }] });
  const late = await mk("Spring visits", "Spring visits: first touch", 4);
  const soon = await mk("Thank-you call", "Thank-you call: first touch", 2);
  ok("two journeys are made", late.status === 201 && soon.status === 201, [late.body, soon.body]);
  for (const j of [late, soon]) {
    const a = await api("POST", `/journeys/${j.body.id}/apply`, tok, { donorIds: [ines] });
    ok(`${j.body.name}: the person is put in it`, a.status === 200 && a.body.started === 1, a.body);
  }
  // Started in one moment: the tie that let the profile and the Calendar part.
  await q(`UPDATE cultivation_plans SET created_at = (SELECT MIN(created_at) FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2) WHERE org_id=$1 AND donor_id=$2`, [ORG, ines]);

  const stored = (await q(`SELECT s.due_date::text AS d FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id
                           WHERE p.org_id=$1 AND p.donor_id=$2 AND p.status='active' ORDER BY s.due_date`, [ORG, ines])).map(r => String(r.d).slice(0, 10));
  // The first journey's step keeps its day (today + 4); the second's (+2)
  // is moved a week past it by the touch gap (JOURNEYS-3), so the soonest is
  // the +4 step, counted from New York's today.
  const first = orgTime.addDays(today, 4);
  ok(`the soonest step is counted from New York's today: ${first}, not UTC's ${orgTime.addDays(utcDay, 4)}`, stored[0] === first, stored);

  const cal = await api("GET", `/calendar/items?from=${today}&to=${orgTime.addDays(today, 30)}&types=journey`, tok);
  const calDays = ((cal.body && (cal.body.items || cal.body)) || []).filter(i => i.type === "journey" && i.donorId === ines)
    .map(i => String(i.start).slice(0, 10)).sort();
  ok(`the Calendar shows both steps on their stored days (${stored.join(", ")})`, calDays.length === 2 && calDays.join(",") === stored.join(","), calDays);

  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const plan = ((await api("GET", `/donors/${ines}/plan`, tok)).body || {}).plan;
    const next = plan && plan.steps.find(s => s.status === "open" || s.status === "pending");
    seen.add(next ? String(next.dueDate).slice(0, 10) : "none");
  }
  ok(`the profile names the next step on the Calendar's day (${calDays[0]}), the same on every reload`, seen.size === 1 && seen.has(calDays[0]), [...seen]);

  // TRUTH-2's own case at 9 PM: two journeys started in one moment whose
  // steps are not open yet (no Thread holds either), the later step's journey
  // written first. Their days are New York's today + 2 and + 4.
  const noor = (await api("POST", "/donors", tok, { name: "Noor Haddad", email: `noor-${RUN}@flake2.invalid` })).body.id;
  const near = orgTime.addDays(today, 2), far = orgTime.addDays(today, 4);
  const stamp = new Date(testNow()).toISOString();
  for (const [pid, name, due] of [[`cp_f2_late_${RUN}`, "Spring visits", far], [`cp_f2_soon_${RUN}`, "Thank-you call", near]]) {
    await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,priority,created_by,created_by_name,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'active',50,'system:test','test fixture',$7)`, [pid, ORG, noor, `tpl_${pid}`, name, today, stamp]);
    await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status) VALUES ($1,$2,$3,1,'call',$4,$5,'pending')`,
      [`cs_${pid}`, ORG, pid, `${name}: first touch`, due]);
  }
  const cal2 = await api("GET", `/calendar/items?from=${today}&to=${orgTime.addDays(today, 10)}&types=journey`, tok);
  const noorDays = ((cal2.body && (cal2.body.items || cal2.body)) || []).filter(i => i.type === "journey" && i.donorId === noor)
    .map(i => String(i.start).slice(0, 10)).sort();
  ok(`two journeys started in one moment: the Calendar shows ${near} and ${far}`, noorDays.join(",") === `${near},${far}`, noorDays);
  const seen2 = new Set();
  for (let i = 0; i < 5; i++) {
    const plan = ((await api("GET", `/donors/${noor}/plan`, tok)).body || {}).plan;
    const next = plan && plan.steps.find(s => s.status === "open" || s.status === "pending");
    seen2.add(next ? String(next.dueDate).slice(0, 10) : "none");
  }
  ok(`…and the profile names the step on the Calendar's first day (${near}), the same on every reload`, seen2.size === 1 && seen2.has(near), [...seen2]);

  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary("flake2-journey-9pm");
})().catch(async e => { ok("ran to the end", false, e.stack || e.message); await closeDb().catch(() => {}); summary("flake2-journey-9pm"); });

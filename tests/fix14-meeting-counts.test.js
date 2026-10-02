// tests/fix14-meeting-counts.test.js — FIX-14 Part 1. A LOGGED MEETING COUNTS EVERYWHERE.
//
// Jonathan logged a meeting on a donor's profile at about 9pm New York time.
// The timeline said "Tomorrow" (the date was the UTC day), the header said
// "Not met yet", the rail said Meetings 0 and the rhythm strip was empty,
// while the timeline's own chip said 1. Two bugs: a civil date taken from the
// UTC clock, and five surfaces that each had their own idea of a meeting.
//
// What this holds:
//   §0  at 2026-10-02T01:00Z (9pm on 1 October in New York) the client's
//       "today" is 1 October, and "Log a conversation" defaults to it
//   §1  a conversation logged at 9pm New York time is dated that day, and is
//       Last met on the header, in the rhythm strip, in Meetings this year,
//       on the timeline, out of "No meeting since", in the per-staff report
//   §2  a CALENDAR meeting at 9pm New York time is dated that day too (the
//       server read calendar events by their UTC day)
//   §3  a meeting logged for a day ahead is in Coming up, not in Last met
//   §4  a touchpoint saved with no date is the org's today
//
// HOW IT WOULD GO RED (each planted once and watched): LogConversation's
// default back to `toISOString().split("T")[0]` turns §0 red; meetings.js's
// CAL_DATE back to `TO_CHAR(c.starts_at, 'YYYY-MM-DD')` turns §2 red; the
// relationship read counting calendar events only turns §1 red.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const orgTime = require("../orgTime");

const ORG = "org_fix14mc";
const PW = bcrypt.hashSync("loadtest1234", 10);
const TZ = "America/New_York";
const DONOR = "d_fix14_oct";
const TABLES = ["threads", "calendar_events", "interactions", "donors", "users"];
const WEST = "org_fix14mcw", WEST_TZ = "America/Los_Angeles", WEST_DONOR = "d_fix14_west";

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'FIX14 meetings','fix14-meetings',1,'active','team',$2)`, [ORG, TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`,
    [`u_${ORG}`, ORG, `dana@${ORG}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Octavian Cobbleworth','octavian@example.org','active',1000,'system:test','test')`, [DONOR, ORG]);
}

async function resetWest() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [WEST]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [WEST]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'FIX14 west','fix14-west',1,'active','team',$2)`, [WEST, WEST_TZ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`,
    [`u_${WEST}`, WEST, `dana@${WEST}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
           VALUES ($1,$2,'Wren Calloway','wren@example.org','active',500,'system:test','test')`, [WEST_DONOR, WEST]);
}

(async () => {
  // §0 — THE CLIENT'S TODAY, AT A PINNED INSTANT. 01:00 UTC on 2 October is
  // 21:00 on 1 October in New York.
  const PINNED = new Date("2026-10-02T01:00:00Z");
  const { civilDateIn } = await import("../shared/displayDate.js");
  const lib = await import("../client/src/lib/orgToday.js");
  ok("§0 9pm New York on 1 October is 1 October", civilDateIn(TZ, PINNED) === "2026-10-01", civilDateIn(TZ, PINNED));
  lib.setOrgTimezone(TZ);
  ok("§0 the client's org today at that instant is 1 October", lib.orgTodayCivil(PINNED) === "2026-10-01", lib.orgTodayCivil(PINNED));
  const convo = fs.readFileSync(path.join(__dirname, "../client/src/components/LogConversation.jsx"), "utf8");
  const todayLine = (convo.match(/const todayLocal = [^\n]+/) || [""])[0];
  ok("§0 Log a conversation defaults to the org's today, not the UTC day",
    /orgTodayCivil\(\)/.test(todayLine) && !/toISOString/.test(todayLine), todayLine);

  await reset();
  const tok = await login(`dana@${ORG}.local`);
  const rel0 = await api("GET", `/donors/${DONOR}/relationship`, tok);
  const today = rel0.body && rel0.body.today;
  ok("the relationship read answers with the org's today", /^\d{4}-\d{2}-\d{2}$/.test(String(today)), rel0.text.slice(0, 200));

  // §1 — logged at 9pm New York time yesterday, on the date the client's
  // default gives at that instant.
  const D = orgTime.addDays(today, -1);
  const ninePm = orgTime.localToInstant(`${D}T21:00`, TZ);
  const dated = lib.orgTodayCivil(ninePm);
  ok("§1 the form's default at 9pm New York is that day", dated === D, { dated, D, instant: ninePm.toISOString() });
  const logged = await api("POST", `/donors/${DONOR}/conversations`, tok,
    { touch: "meeting", line: "Attendees: Octavian and his wife Clementine\nNext Step: follow up in a month", date: dated, place: "Starbucks", nextStep: { skipped: true } });
  ok("§1 the conversation saved", logged.status === 201, logged.text.slice(0, 200));
  const [row] = await q(`SELECT date, metadata FROM interactions WHERE id=$1`, [logged.body && logged.body.interactionId]);
  ok("§1 it is stored on that day", row && row.date === D, row);

  const donor = await api("GET", `/donors/${DONOR}`, tok);
  const lastMet = donor.body && donor.body.figures && donor.body.figures.lastMet;
  ok("§1 the header's Last met counts it (1 day)", lastMet && lastMet.value === 1, lastMet);
  const rel = (await api("GET", `/donors/${DONOR}/relationship`, tok)).body || {};
  const mine = (rel.meetings || []).find(m => m.id === logged.body.interactionId);
  ok("§1 the timeline's meetings include it, on that day", !!mine && mine.date === D, rel.meetings);
  ok("§1 the logged meeting is titled by its place", mine && mine.title === "Meeting at Starbucks", mine);
  const cell = (rel.rhythm || []).find(m => m.month === D.slice(0, 7));
  ok("§1 the rhythm strip has it in its month", cell && cell.count >= 1, rel.rhythm);
  if (D.slice(0, 4) === today.slice(0, 4)) ok("§1 Meetings this year counts it", rel.thisYear && rel.thisYear.meetings.value === 1, rel.thisYear);
  else ok("§1 Meetings this year starts on 1 January (yesterday was last year)", rel.thisYear && rel.thisYear.meetings.value === 0, rel.thisYear);
  const nrm = await api("GET", `/figures/no-recent-meeting/rows?since=${D}&pageSize=200`, tok);
  ok("§1 the No meeting filter no longer lists them", nrm.status === 200 && !(nrm.body.rows || []).some(r => (r.donorId || r.donor_id) === DONOR), nrm.text.slice(0, 300));
  const staff = await api("GET", `/meetings/by-staff`, tok);
  const dana = ((staff.body && staff.body.staff) || []).find(s => s.id === `u_${ORG}`);
  ok("§1 the meetings-per-staff report counts it", dana && dana.total.value >= 1, staff.text.slice(0, 300));

  // §2 — a calendar meeting at 9pm, five days ago, in New York and in an org
  // on Pacific time. (The second org is what makes the guard bite on any
  // machine: a scratch Postgres whose session zone is New York reads the UTC
  // bug as correct for a New York org, but not for a Los Angeles one.)
  const D2 = orgTime.addDays(today, -5);
  const starts = orgTime.localToInstant(`${D2}T21:00`, TZ);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ('cal_fix14',$1,$2,'google','ev_fix14','Dinner with Octavian',$3,$4,$5,'system:test','test')`,
    [ORG, `u_${ORG}`, starts.toISOString(), new Date(starts.getTime() + 3600e3).toISOString(), [DONOR]]);
  const rel2 = (await api("GET", `/donors/${DONOR}/relationship`, tok)).body || {};
  const cal = (rel2.meetings || []).find(m => m.id === "cal_fix14");
  ok("§2 a calendar meeting at 9pm New York is dated that day", cal && cal.date === D2, cal);
  const metRows = await api("GET", `/figures/donor-last-met/rows?donor=${DONOR}&today=${today}&pageSize=50`, tok);
  const calRow = ((metRows.body && metRows.body.rows) || []).find(r => r.id === "cal_fix14");
  ok("§2 Last met's rows date it that day too", calRow && calRow.date === D2, metRows.text.slice(0, 300));
  const chip = (rel2.meetings || []).length;
  ok("§2 the Meetings chip and Last met's rows are the same meetings", chip === ((metRows.body && metRows.body.totalRows) || 0), { chip, rows: metRows.body && metRows.body.totalRows });

  await resetWest();
  const west = await login(`dana@${WEST}.local`);
  const relW0 = (await api("GET", `/donors/${WEST_DONOR}/relationship`, west)).body || {};
  const DW = orgTime.addDays(relW0.today, -5);
  const startsW = orgTime.localToInstant(`${DW}T21:00`, WEST_TZ);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by,created_by_name)
           VALUES ('cal_fix14w',$1,$2,'google','ev_fix14w','Dinner in Pasadena',$3,$4,$5,'system:test','test')`,
    [WEST, `u_${WEST}`, startsW.toISOString(), new Date(startsW.getTime() + 3600e3).toISOString(), [WEST_DONOR]]);
  const relW = (await api("GET", `/donors/${WEST_DONOR}/relationship`, west)).body || {};
  const calW = (relW.meetings || []).find(m => m.id === "cal_fix14w");
  ok("§2 a calendar meeting at 9pm Pacific is dated that day", calW && calW.date === DW, { calW, DW });
  const cellW = (relW.rhythm || []).find(m => m.month === DW.slice(0, 7));
  ok("§2 and sits in that day's month on the rhythm strip", cellW && cellW.count === 1, relW.rhythm);

  // §3 — a meeting logged for a day ahead is coming up, not met.
  const ahead = orgTime.addDays(today, 5);
  const fut = await api("POST", `/donors/${DONOR}/conversations`, tok,
    { touch: "meeting", line: "Lunch booked", date: ahead, nextStep: { skipped: true } });
  const rel3 = (await api("GET", `/donors/${DONOR}/relationship`, tok)).body || {};
  ok("§3 it is in Coming up", (rel3.upcoming || []).some(e => e.id === fut.body.interactionId && e.date === ahead), rel3.upcoming);
  ok("§3 it is not a meeting that happened", !(rel3.meetings || []).some(m => m.id === fut.body.interactionId), rel3.meetings);
  const donor3 = await api("GET", `/donors/${DONOR}`, tok);
  ok("§3 Last met still reads yesterday", donor3.body.figures.lastMet.value === 1, donor3.body.figures.lastMet);

  // §4 — a touchpoint with no date is the org's today, not the UTC day.
  const tp = await api("POST", `/donors/${DONOR}/interactions`, tok, { type: "note", note: "No date given" });
  ok("§4 a touchpoint with no date is dated the org's today", tp.status === 201 && tp.body.date === today, tp.body);

  for (const o of [ORG, WEST]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

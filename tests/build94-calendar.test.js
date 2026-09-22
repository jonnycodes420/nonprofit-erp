// BUILD-94 Part 5 — PUT IT ON MY CALENDAR.
//
// The brief's one test: the three outputs for one task carry the same subject,
// the same start time in the org's timezone, and the UID is stable across two
// generations.
//
// The UID is the line that matters. An .ics with the same UID is an UPDATE to
// the event already in somebody's calendar; a UID derived from the time, or a
// fresh one per download, silently leaves two appointments behind — which is
// worse than no button at all.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b94c";

async function fixture() {
  for (const t of ["threads", "interactions", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Calendar Arts','b94c',1,'active','team','America/Chicago',NOW())
           ON CONFLICT (id) DO UPDATE SET timezone='America/Chicago', timezone_confirmed_at=NOW(),
             subscription_status='active', plan='team'`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94c',$1,'b94c@test.local',$2,'Allie Barnett','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage)
           VALUES ('d_b94c',$1,'Bill Harmon','bill@b94c.test',500,2,'mid','steward')`, [ORG]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date)
           VALUES ('i_b94c',$1,'d_b94c','call','Spoke about the spring appeal; he wants the budget first.','2026-09-18')`, [ORG]);
  // A TIMED next step — 14:00 in America/Chicago on a Thursday.
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,due_time,opened_on)
           VALUES ('th_b94c',$1,'d_b94c','call','Call','2026-09-24','14:00','2026-09-18')`, [ORG]);
  // …and a DATE-ONLY one, which must be an all-day event and not a fiction.
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage)
           VALUES ('d_b94c2',$1,'Nora Nodate','nora@b94c.test',100,1,'new','steward')`, [ORG]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on)
           VALUES ('th_b94c2',$1,'d_b94c2','email','Email','2026-09-25','2026-09-18')`, [ORG]);
}

const icsField = (ics, name) => {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const m = new RegExp(`^${name}[^:]*:(.*)$`, "m").exec(unfolded);
  return m ? m[1].trim() : null;
};

(async () => {
  await fixture();
  const tok = await login("b94c@test.local", "loadtest1234");

  console.log("— the three outputs for one task —");
  const r = await api("GET", "/threads/th_b94c/calendar", tok);
  ok("the three links are offered", r.status === 200 && r.body.outlook && r.body.google && r.body.ics, r.body);
  ok("Outlook is a deep link to its compose screen", /outlook\.office\.com\/calendar\/.*compose/.test(r.body.outlook));
  ok("Google is a deep link to its compose screen", /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/.test(r.body.google));
  ok("the subject is the step and the person", r.body.subject === "Call Bill Harmon", r.body.subject);

  // 14:00 America/Chicago on 24 Sep 2026 is CDT (UTC-5) → 19:00Z.
  ok("the start time is the org's wall clock, converted once",
    r.body.startsAt === "2026-09-24T19:00:00.000Z", r.body.startsAt);
  ok("…and the org's zone is named", r.body.timezone === "America/Chicago", r.body.timezone);

  const icsRes = await fetch(BASE + "/threads/th_b94c/calendar.ics", { headers: { Authorization: "Bearer " + tok } });
  const ics = await icsRes.text();
  ok("the .ics downloads as a calendar file",
    icsRes.status === 200 && /text\/calendar/.test(icsRes.headers.get("content-type") || ""),
    icsRes.headers.get("content-type"));
  ok("…as an attachment with a readable name",
    /attachment; filename="call-bill-harmon\.ics"/.test(icsRes.headers.get("content-disposition") || ""),
    icsRes.headers.get("content-disposition"));

  // ── THE SAME SUBJECT AND THE SAME START TIME, IN ALL THREE ──────────────
  console.log("— and all three agree —");
  const outlook = new URL(r.body.outlook), google = new URL(r.body.google);
  ok("the subject is identical in all three",
    outlook.searchParams.get("subject") === r.body.subject
    && google.searchParams.get("text") === r.body.subject
    && icsField(ics, "SUMMARY") === r.body.subject,
    [outlook.searchParams.get("subject"), google.searchParams.get("text"), icsField(ics, "SUMMARY")]);
  ok("the start time is identical in all three",
    new Date(outlook.searchParams.get("startdt")).toISOString() === r.body.startsAt
    && google.searchParams.get("dates").split("/")[0] === "20260924T190000Z"
    && icsField(ics, "DTSTART") === "20260924T190000Z",
    [outlook.searchParams.get("startdt"), google.searchParams.get("dates"), icsField(ics, "DTSTART")]);

  // ── THE UID IS STABLE ACROSS TWO GENERATIONS ────────────────────────────
  console.log("— re-downloading updates, it does not duplicate —");
  const ics2 = await (await fetch(BASE + "/threads/th_b94c/calendar.ics", { headers: { Authorization: "Bearer " + tok } })).text();
  ok("two generations carry the SAME UID", icsField(ics, "UID") === icsField(ics2, "UID"), [icsField(ics, "UID"), icsField(ics2, "UID")]);
  ok("…and the UID does not contain the time, so changing the time cannot fork it",
    !/2026|1900|T19/.test(icsField(ics, "UID")), icsField(ics, "UID"));
  // Move the step and download again: SAME event, new time.
  await q(`UPDATE threads SET due_time='09:30' WHERE id='th_b94c'`);
  const ics3 = await (await fetch(BASE + "/threads/th_b94c/calendar.ics", { headers: { Authorization: "Bearer " + tok } })).text();
  ok("moving the task keeps the UID", icsField(ics3, "UID") === icsField(ics, "UID"));
  ok("…and moves the time", icsField(ics3, "DTSTART") === "20260924T143000Z", icsField(ics3, "DTSTART"));
  ok("the DTSTAMP moves with each generation (it is the generation time)",
    icsField(ics, "DTSTAMP") !== null && /^\d{8}T\d{6}Z$/.test(icsField(ics, "DTSTAMP")));

  // ── a step with no time is ALL DAY, not a fiction at 9am ────────────────
  console.log("— a step with no time is all day —");
  const r2 = await api("GET", "/threads/th_b94c2/calendar", tok);
  ok("no time on the step means no start time", r2.body.startsAt === null && r2.body.allDay === true, r2.body);
  const ics4 = await (await fetch(BASE + "/threads/th_b94c2/calendar.ics", { headers: { Authorization: "Bearer " + tok } })).text();
  ok("the .ics is an all-day event", /DTSTART;VALUE=DATE:20260925/.test(ics4), ics4.split("\r\n").filter(l => /DTSTART|DTEND/.test(l)));
  ok("…and DTEND is the NEXT day (RFC 5545 makes it exclusive)",
    /DTEND;VALUE=DATE:20260926/.test(ics4), ics4.split("\r\n").filter(l => /DTEND/.test(l)));

  // ── the body ────────────────────────────────────────────────────────────
  console.log("— what is in the body —");
  const desc = (icsField(ics, "DESCRIPTION") || "").replace(/\\n/g, "\n").replace(/\\,/g, ",");
  ok("the last logged line is in the body", /spring appeal/.test(desc), desc.slice(0, 200));
  ok("…and a plain-text way back to the record", /\/donors\/d_b94c/.test(desc), desc);
  ok("…and it says plainly that this is NOT sync",
    /doesn't write to your calendar/i.test(desc) && /doesn't read it/i.test(desc), desc.slice(-220));
  ok("the same sentence ships with the links", /doesn't write to your calendar/i.test(r.body.note || ""), r.body.note);

  // ── a GET never changes state, and another org's task is a 404 ──────────
  console.log("— a GET changes nothing, and it is org-scoped —");
  const before = await q(`SELECT due_time, due_date, next_step_label FROM threads WHERE id='th_b94c'`);
  await fetch(BASE + "/threads/th_b94c/calendar.ics", { headers: { Authorization: "Bearer " + tok } });
  await api("GET", "/threads/th_b94c/calendar", tok);
  const after = await q(`SELECT due_time, due_date, next_step_label FROM threads WHERE id='th_b94c'`);
  ok("nothing on the task moved", JSON.stringify(before) === JSON.stringify(after), [before, after]);
  ok("nothing was logged on the person",
    (await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id='d_b94c'`, [ORG]))[0].n === 1);
  ok("a task that is not this org's is a 404", (await api("GET", "/threads/th_does_not_exist/calendar", tok)).status === 404);

  // ── the module, as a unit ───────────────────────────────────────────────
  const C = await import("../shared/calendarLinks.js");
  ok("the UID is derived from the org and the task, and nothing else",
    C.taskUid("org_a", "t_1") === C.taskUid("org_a", "t_1") && C.taskUid("org_a", "t_1") !== C.taskUid("org_b", "t_1"));
  ok("a semicolon or comma in a subject is escaped, not a broken file",
    /Call Bill\\, then Sue/.test(C.buildIcs({ uid: "u", subject: "Call Bill, then Sue", dueCivil: "2026-09-24" })),
    C.buildIcs({ uid: "u", subject: "Call Bill, then Sue", dueCivil: "2026-09-24" }));
  ok("a long description is folded at 75 octets (Apple Calendar refuses otherwise)",
    C.buildIcs({ uid: "u", subject: "x", dueCivil: "2026-09-24", description: "y".repeat(400) })
      .split("\r\n").every(l => Buffer.byteLength(l) <= 75));

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

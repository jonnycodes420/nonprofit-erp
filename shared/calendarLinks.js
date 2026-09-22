// shared/calendarLinks.js — BUILD-94 Part 5. PUT IT ON MY CALENDAR.
//
// Allie uses Microsoft. There is NO OAuth here, no Azure app, no sync, and
// nothing is written to anybody's calendar by Steward — three deep links and a
// file, which is the version that works on the second meeting rather than the
// version that needs an app registration first.
//
// THE SENTENCE THAT HAS TO BE ON THE SCREEN, because a button that says
// "put it on my calendar" will otherwise be read as sync:
export const NOT_SYNC_NOTE =
  "This opens your calendar with the details filled in. Steward doesn't write to " +
  "your calendar and doesn't read it — if you change the time there, change it here too.";
//
// Pure: no DB, no network, no clock (every "now" is a parameter).

// ── THE UID ────────────────────────────────────────────────────────────────
// Stable per task, forever. An .ics with the SAME UID is an UPDATE to the
// event already in the calendar, not a second one — so re-downloading after
// changing the time moves the appointment instead of leaving two. This is the
// single most important line in the file: a UID derived from the time, or a
// fresh uuid per download, silently duplicates.
export function taskUid(orgId, taskId) {
  return `steward-${String(orgId || "org").replace(/[^A-Za-z0-9_-]/g, "")}-${String(taskId || "").replace(/[^A-Za-z0-9_-]/g, "")}@stewardapp.dev`;
}

// ── TIME ───────────────────────────────────────────────────────────────────
// A next step carries a CIVIL DATE and, sometimes, an HH:MM in the ORG's
// timezone (BUILD-84). A calendar event needs an instant, so the caller
// converts through the one timezone seam (orgTime.localToInstant) and hands
// the result in. A step with NO time is an ALL-DAY event — inventing 9am for
// it would put a fictional appointment in somebody's morning.
const pad = (n) => String(n).padStart(2, "0");
const utcStamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const civilStamp = (civil) => String(civil || "").replace(/-/g, "");
function addCivilDay(civil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(civil || ""));
  if (!m) return civil;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const DEFAULT_MINUTES = 30;

// ── THE THREE OUTPUTS ──────────────────────────────────────────────────────
// event: { uid, subject, description, startInstant|null, dueCivil, minutes }
// All three MUST carry the same subject and the same start time — that is the
// property the suite pins, because three code paths producing three slightly
// different appointments is exactly how this feature rots.

function escIcs(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
// RFC 5545 says lines are folded at 75 octets. Outlook is forgiving; Apple
// Calendar is not, and a long description is the common case here.
function fold(line) {
  if (line.length <= 73) return line;
  const out = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) { out.push(" " + rest.slice(0, 72)); rest = rest.slice(72); }
  if (rest.length) out.push(" " + rest);
  return out.join("\r\n");
}

export function buildIcs(event, { now = new Date(), prodId = "-//Steward//Task//EN" } = {}) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${prodId}`, "CALSCALE:GREGORIAN",
    // A UID that already exists is a change to that event. Without METHOD and
    // a bumped SEQUENCE some clients ignore the update entirely.
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    "SEQUENCE:0",
  ];
  if (event.startInstant) {
    const start = new Date(event.startInstant);
    const end = new Date(start.getTime() + (event.minutes || DEFAULT_MINUTES) * 60000);
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
  } else {
    // All-day, and DTEND is EXCLUSIVE in RFC 5545 — the day after, or the
    // event shows as ending the day before it starts.
    lines.push(`DTSTART;VALUE=DATE:${civilStamp(event.dueCivil)}`,
               `DTEND;VALUE=DATE:${civilStamp(addCivilDay(event.dueCivil))}`);
  }
  lines.push(`SUMMARY:${escIcs(event.subject)}`);
  if (event.description) lines.push(`DESCRIPTION:${escIcs(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Outlook's compose screen. `startdt`/`enddt` take ISO instants; an all-day
// event uses the civil date plus allday=true.
export function outlookUrl(event) {
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: event.subject });
  if (event.description) p.set("body", event.description);
  if (event.startInstant) {
    const start = new Date(event.startInstant);
    p.set("startdt", start.toISOString());
    p.set("enddt", new Date(start.getTime() + (event.minutes || DEFAULT_MINUTES) * 60000).toISOString());
  } else {
    p.set("allday", "true");
    p.set("startdt", event.dueCivil);
    p.set("enddt", addCivilDay(event.dueCivil));
  }
  return "https://outlook.office.com/calendar/0/deeplink/compose?" + p.toString();
}

// Google's compose screen. `dates` is start/end with no punctuation.
export function googleUrl(event) {
  const p = new URLSearchParams({ action: "TEMPLATE", text: event.subject });
  if (event.description) p.set("details", event.description);
  if (event.startInstant) {
    const start = new Date(event.startInstant);
    const end = new Date(start.getTime() + (event.minutes || DEFAULT_MINUTES) * 60000);
    p.set("dates", `${utcStamp(start).replace(/[-:]/g, "")}/${utcStamp(end).replace(/[-:]/g, "")}`);
  } else {
    p.set("dates", `${civilStamp(event.dueCivil)}/${civilStamp(addCivilDay(event.dueCivil))}`);
  }
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

// ── WHAT GOES IN THE BODY ──────────────────────────────────────────────────
// The last logged line, and a plain-text pointer back to the person's record.
// A URL IN A CALENDAR BODY IS FINE — the CRM's no-links rule is about the
// CRM's own screens, and a calendar entry you open on a phone three days later
// is exactly where a way back is worth having.
export function eventDescription({ lastLine, personName, recordUrl, orgName }) {
  const parts = [];
  if (lastLine) parts.push(lastLine);
  if (personName && recordUrl) parts.push(`${personName} in Steward: ${recordUrl}`);
  else if (recordUrl) parts.push(`Open in Steward: ${recordUrl}`);
  if (orgName) parts.push(orgName);
  parts.push(NOT_SYNC_NOTE);
  return parts.join("\n\n");
}

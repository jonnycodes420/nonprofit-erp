// shared/calendarLog.js — INT-BUILD-1 Part 1. THE CALENDAR, UNDER THE SAME LINE AS THE MAIL.
//
// A gift officer's week is meetings, and a calendar is even more personal than
// an inbox: it holds the doctor, the school pickup, the interview she has not
// told anyone about. So the rule is INT-4's rule, tightened:
//
//   AN EVENT IS STORED ONLY IF AT LEAST ONE ATTENDEE IS A PERSON IN STEWARD.
//   Every other event leaves NOTHING: no row, no title, no count, no log line.
//   The provider is asked for a window of events (a calendar cannot be queried
//   by attendee the way a mailbox can be searched by address), and the ones
//   with nobody on file are discarded in memory, here, before anything writes.
//
//   A STORED EVENT KEEPS SIX FIELDS AND NOTHING ELSE: title, start, end,
//   location, the matched people (their Steward ids, never the other
//   attendees' addresses), and who on staff owns it. No description, no
//   conferencing link, no attendee list, no organiser address. The provider
//   is asked not to send the description at all.
//
// Her never-log list applies to attendees exactly as it does to mail: an event
// with anyone on it she listed is dropped whole. Her pause stops the calendar
// as well as the mail, because it is one connection and one switch.
//
// Pure: no DB, no network, no clock.
import { isNeverLogged } from "./mailboxLog.js";

export const CALENDAR_FIELDS = ["title", "startsAt", "endsAt", "location", "personIds", "ownerUserId"];
export const CALENDAR_FIELDS_SENTENCE =
  "From your calendar Steward keeps only meetings with someone already in Steward: the title, the time, the place, who from Steward is in it, and whose calendar it came from. It never reads the description, and it keeps nothing at all about any other event.";

// The scopes that carry the calendar, per provider, so "did she grant it" is
// one question with one answer everywhere.
export const CALENDAR_SCOPE = {
  google: "https://www.googleapis.com/auth/calendar.events",
  microsoft: "Calendars.ReadWrite",
};
export function calendarGranted(provider, scopeString) {
  const want = CALENDAR_SCOPE[provider];
  if (!want || !scopeString) return false;
  return String(scopeString).toLowerCase().split(/[\s,]+/).some(s => s === want.toLowerCase() || s.endsWith("/" + want.toLowerCase()));
}

// How far back and forward the sync looks. Back far enough to catch "how did
// it go" for last week; forward far enough for "who am I seeing".
export const WINDOW_PAST_DAYS = 30;
export const WINDOW_AHEAD_DAYS = 60;

const norm = e => String(e || "").trim().toLowerCase();

/**
 * One provider event, normalised by the fetcher to
 *   { id, status, title, startsAt, endsAt, location, attendees: [email], allDay }
 * and the context
 *   { paused, neverLog:[], excludedIds:[], mailboxAddress, staffEmails:[],
 *     donorsByEmail: Map|object email -> personId, ownerUserId }
 *
 * Returns { action: "store", row } with exactly CALENDAR_FIELDS, or
 * { action: "drop" } and nothing else. A drop carries no reason on purpose:
 * the caller has nothing to count and nothing to log.
 */
export function classifyCalendarEvent(ev, ctx) {
  const e = ev || {};
  const c = ctx || {};
  const drop = { action: "drop" };
  if (c.paused === true) return drop;
  if (!e.id) return drop;
  if (String(e.status || "").toLowerCase() === "cancelled") return drop;
  if ((c.excludedIds || []).includes(String(e.id))) return drop;

  const everyone = (e.attendees || []).map(norm).filter(Boolean);
  if (everyone.some(a => isNeverLogged(a, c.neverLog))) return drop;

  const staff = new Set([...(c.staffEmails || []).map(norm), norm(c.mailboxAddress)].filter(Boolean));
  const lookup = c.donorsByEmail instanceof Map ? (x => c.donorsByEmail.get(x)) : (x => (c.donorsByEmail || {})[x]);
  const personIds = [];
  for (const a of everyone) {
    if (staff.has(a)) continue;
    const id = lookup(a);
    if (id && !personIds.includes(id)) personIds.push(id);
  }
  if (!personIds.length) return drop;

  const startsAt = e.startsAt ? new Date(e.startsAt) : null;
  const endsAt = e.endsAt ? new Date(e.endsAt) : startsAt;
  if (!startsAt || isNaN(startsAt)) return drop;

  return {
    action: "store",
    row: {
      title: String(e.title || "").trim().slice(0, 300) || "Meeting",
      startsAt: startsAt.toISOString(),
      endsAt: (endsAt && !isNaN(endsAt) ? endsAt : startsAt).toISOString(),
      location: String(e.location || "").trim().slice(0, 300) || null,
      personIds,
      ownerUserId: String(c.ownerUserId || ""),
    },
  };
}

// ── THE PROVIDER SHAPES ──────────────────────────────────────────────────────
// Google's `fields` mask means the description never leaves Google. Graph's
// $select does the same for Outlook.
export const GOOGLE_EVENT_FIELDS =
  "items(id,status,summary,location,start,end,attendees(email)),nextPageToken";
export const GRAPH_EVENT_SELECT = "id,subject,start,end,location,attendees,isCancelled";

export function fromGoogle(item) {
  const s = item?.start || {}, en = item?.end || {};
  return {
    id: item?.id, status: item?.status,
    title: item?.summary, location: item?.location,
    startsAt: s.dateTime || (s.date ? s.date + "T00:00:00Z" : null),
    endsAt: en.dateTime || (en.date ? en.date + "T00:00:00Z" : null),
    allDay: !s.dateTime && !!s.date,
    attendees: (item?.attendees || []).map(a => a.email).filter(Boolean),
  };
}
export function fromGraph(item) {
  // Graph returns local wall time plus a zone; the request asks for UTC.
  const z = v => (v?.dateTime ? (/[zZ]|[+-]\d\d:\d\d$/.test(v.dateTime) ? v.dateTime : v.dateTime + "Z") : null);
  return {
    id: item?.id, status: item?.isCancelled ? "cancelled" : "confirmed",
    title: item?.subject, location: item?.location?.displayName,
    startsAt: z(item?.start), endsAt: z(item?.end), allDay: false,
    attendees: (item?.attendees || []).map(a => a?.emailAddress?.address).filter(Boolean),
  };
}

// ── BOOKING A VISIT ─────────────────────────────────────────────────────────
// The event goes on the STAFF MEMBER'S own calendar. The donor is an attendee
// only if she ticked the box, which is off by default: putting a donor on an
// invite sends them mail from her calendar, and that is a send she chose.
export function bookingBody(provider, { title, startsAt, endsAt, location, inviteEmail }) {
  if (provider === "google") {
    return {
      summary: title, location: location || undefined,
      start: { dateTime: startsAt }, end: { dateTime: endsAt },
      ...(inviteEmail ? { attendees: [{ email: inviteEmail }] } : {}),
    };
  }
  return {
    subject: title, location: location ? { displayName: location } : undefined,
    start: { dateTime: startsAt.replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: endsAt.replace(/Z$/, ""), timeZone: "UTC" },
    attendees: inviteEmail ? [{ emailAddress: { address: inviteEmail }, type: "required" }] : [],
  };
}
// Google only emails attendees when told to; Graph emails them whenever there
// are attendees. Both follow the box.
export const googleSendUpdates = invite => (invite ? "all" : "none");

export default { CALENDAR_FIELDS, CALENDAR_FIELDS_SENTENCE, CALENDAR_SCOPE, calendarGranted,
  WINDOW_PAST_DAYS, WINDOW_AHEAD_DAYS, classifyCalendarEvent, GOOGLE_EVENT_FIELDS, GRAPH_EVENT_SELECT,
  fromGoogle, fromGraph, bookingBody, googleSendUpdates };

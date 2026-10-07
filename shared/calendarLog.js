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
  // FIX-33 Part 3b · NO GUEST ON FILE, BUT THE TITLE NAMES SOMEBODY. "Visit
  // with Christine" booked without inviting her is still a donor meeting. The
  // title must carry a meeting word AND name a person on file; one person is
  // linked, more than one is kept as candidates for a person to pick, and
  // nobody at all is dropped exactly as before.
  let candidateIds = [], matchedBy = personIds.length ? "guest" : null;
  if (!personIds.length && c.people) {
    const t = titlePeople(e.title, c.people, c.staffNames || []);
    if (t.ids.length === 1) { personIds.push(t.ids[0]); matchedBy = "title"; }
    else if (t.ids.length > 1) { candidateIds = t.ids.slice(0, 6); matchedBy = "title_unsure"; }
  }
  if (!personIds.length && !candidateIds.length) return drop;

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
      candidateIds,
      matchedBy,
    },
  };
}

// ── FIX-33 Part 3b · WHO A TITLE NAMES ──────────────────────────────────────
// The words that make an event a meeting. Without one of them a title naming a
// donor ("Christine's birthday") is not a meeting and stores nothing.
export const MEETING_WORDS = ["meeting", "meet", "visit", "coffee", "lunch", "call", "tour", "zoom", "breakfast", "dinner", "drinks"];
const NICK = { bill: "william", will: "william", billy: "william", dave: "david", bob: "robert", rob: "robert", bobby: "robert",
  jim: "james", jimmy: "james", mike: "michael", kate: "katherine", katie: "katherine", kathy: "katherine", liz: "elizabeth",
  beth: "elizabeth", betty: "elizabeth", tom: "thomas", sue: "susan", jen: "jennifer", jenny: "jennifer", dan: "daniel",
  joe: "joseph", steve: "steven", tony: "anthony", rick: "richard", rich: "richard", dick: "richard", pat: "patricia",
  ed: "edward", ben: "benjamin", nick: "nicholas", matt: "matthew", andy: "andrew", greg: "gregory", ron: "ronald",
  don: "donald", ken: "kenneth", larry: "lawrence", maggie: "margaret", peggy: "margaret", deb: "deborah", debbie: "deborah",
  cindy: "cynthia", barb: "barbara", chuck: "charles", charlie: "charles", sam: "samuel", alex: "alexander", chris: "christopher" };
const STOP = new Set(["with", "w", "and", "the", "a", "an", "at", "for", "re", "to", "of", "on", "in", "about", "our", "my", "me", "follow", "up", "quick", "catch", "intro"]);
const fold = x => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const wordsOf = x => fold(x).replace(/[^a-z'\s]/g, " ").split(/\s+/).map(w => w.replace(/'s$/, "").replace(/'/g, "")).filter(Boolean);

/**
 * titlePeople(title, people, staffNames) -> { ids, why }
 *   people: [{ id, name }] on file; staffNames: the org's staff names, whose
 *   first names are never read as a donor ("Dave & Jonathan" when Jonathan is
 *   the one with the calendar).
 * A full name in the title wins outright; otherwise each name word is matched
 * against first names (a nickname counts as its name) and last names. Every
 * person any word matches is returned, so two Christines come back as two
 * and the caller asks rather than guesses.
 */
export function titlePeople(title, people, staffNames = []) {
  const words = wordsOf(title);
  if (!words.some(w => MEETING_WORDS.includes(w))) return { ids: [], why: "no_meeting_word" };
  const staff = new Set((staffNames || []).flatMap(n => wordsOf(n).slice(0, 1)));
  const nameWords = words.filter(w => !MEETING_WORDS.includes(w) && !STOP.has(w) && w.length > 1 && !staff.has(w));
  if (!nameWords.length) return { ids: [], why: "no_name" };
  const titleStr = " " + words.join(" ") + " ";
  const full = [], byWord = new Map();
  for (const p of people || []) {
    const pw = wordsOf(p.name);
    if (pw.length < 1) continue;
    const first = pw[0], last = pw.length > 1 ? pw[pw.length - 1] : null;
    if (last && (titleStr.includes(` ${first} ${last} `) || nameWords.some(w => NICK[w] === first) && titleStr.includes(` ${last} `)))
      full.push(p.id);
    for (const w of nameWords) {
      if (w === first || NICK[w] === first || (last && w === last)) {
        if (!byWord.has(w)) byWord.set(w, []);
        byWord.get(w).push(p.id);
      }
    }
  }
  if (full.length) return { ids: [...new Set(full)], why: "full_name" };
  const ids = [...new Set([...byWord.values()].flat())];
  return { ids, why: ids.length ? "name_word" : "no_match" };
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
// FIX-33: the event carries the ORGANISATION's time zone, so it reads as
// "2:00 PM Eastern" on her calendar rather than as a UTC time her calendar
// has to translate (Outlook showed the zone as UTC on the event itself).
export function wallTime(instant, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export function timeBlock(provider, startsAt, endsAt, timeZone) {
  const tz = timeZone || "UTC";
  if (provider === "google")
    return { start: { dateTime: wallTime(startsAt, tz), timeZone: tz }, end: { dateTime: wallTime(endsAt, tz), timeZone: tz } };
  return { start: { dateTime: wallTime(startsAt, tz), timeZone: tz }, end: { dateTime: wallTime(endsAt, tz), timeZone: tz } };
}
export function bookingBody(provider, { title, startsAt, endsAt, location, inviteEmail, timeZone }) {
  if (provider === "google") {
    return {
      summary: title, location: location || undefined,
      ...timeBlock(provider, startsAt, endsAt, timeZone),
      ...(inviteEmail ? { attendees: [{ email: inviteEmail }] } : {}),
    };
  }
  return {
    subject: title, location: location ? { displayName: location } : undefined,
    ...timeBlock(provider, startsAt, endsAt, timeZone),
    attendees: inviteEmail ? [{ emailAddress: { address: inviteEmail }, type: "required" }] : [],
  };
}
// Google only emails attendees when told to; Graph emails them whenever there
// are attendees. Both follow the box.
export const googleSendUpdates = invite => (invite ? "all" : "none");

export default { CALENDAR_FIELDS, CALENDAR_FIELDS_SENTENCE, CALENDAR_SCOPE, calendarGranted,
  WINDOW_PAST_DAYS, WINDOW_AHEAD_DAYS, classifyCalendarEvent, GOOGLE_EVENT_FIELDS, GRAPH_EVENT_SELECT,
  fromGoogle, fromGraph, bookingBody, googleSendUpdates, titlePeople, MEETING_WORDS, wallTime, timeBlock };

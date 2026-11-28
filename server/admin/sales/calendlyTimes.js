// server/admin/sales/calendlyTimes.js · BOOK-1 item 2. THE BOOKING CARD'S TIMES, AND ITS LAST CLICK.
//
// /book shows three weeks of weekdays at a time and the open times of the "Steward intro call" event
// (shared/bookingLink.js), read from Calendly's available-times API with the account's token
// (CALENDLY_API_TOKEN, a Railway variable; never in the repo). Times are Eastern, Jonathan's.
//
// Booking a time: with CALENDLY_DIRECT_BOOK=1 (the account allows Calendly's scheduling API),
// Steward books it through that API and Calendly sends her the invitation. Otherwise the card opens
// that very time on Calendly's own page, her name and email already filled in, for the last click.
// Either way Calendly sends the invitation and the reminder; Steward sends her nothing.
//
// Without a token, or when Calendly can't be read, there are no times to show, and the card says so
// with the calendar's own link (source "unavailable"). Nothing here writes a row.
// HONEST-4 item 7 (W-1126-Integrations-03 and -05): "only 2 slots in the next 30 days ... nothing in
// December or January", and a page that sat on "Loading available times" for 30 seconds. The card
// showed five weekdays and fell back to Calendly's embed whenever it couldn't read. Now:
//   - three weeks of weekdays a page (15 days), with "Later dates" paging further (`page`);
//   - Calendly answers a week per request, so each Monday-to-Friday week is its own request and its
//     own cache entry, kept 5 minutes and served stale for up to an hour while it is read again in
//     the background; a warm-up reads the first page every 4 minutes, so the page draws from cache;
//   - a day with no times is in the list with none, and the card says so;
//   - when Calendly can't be read the answer is { source: "unavailable", link } at once, and the page
//     says "Times didn't load. Open the calendar in a new tab". Never the silent embed. Each failed
//     read is logged with its status.
// Jonathan's Calendly settings are only read, never changed.
"use strict";

const TZ = "America/New_York";
const API = () => (process.env.CALENDLY_API_BASE || "https://api.calendly.com").replace(/\/+$/, "");
const TOKEN = () => String(process.env.CALENDLY_API_TOKEN || "").trim();
const PAGE_DAYS = 15;                 // three weeks of weekdays
const MAX_PAGES = 8;                  // about four months ahead
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const WARM_MS = 4 * 60 * 1000;
const READ_TIMEOUT_MS = 8000;
let weeks = new Map();                // Monday (YYYY-MM-DD) → { at, slots, error, reading }
let eventTypeUri = null;
let warmTimer = null;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The Eastern civil date and clock of an instant.
function eastern(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, weekday: "short" })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hm: `${p.hour}:${p.minute}`, ampm: p.dayPeriod };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isWeekday = date => { const w = new Date(`${date}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
const mondayOf = date => { const w = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, w === 0 ? -6 : 1 - w); };
// Weekdays after today (Eastern): the `n` of them starting `skip` in, as YYYY-MM-DD.
function nextWeekdays(now, n = 5, skip = 0) {
  const out = [];
  let d = eastern(now.toISOString()).date, seen = 0;
  while (out.length < n) { d = addDays(d, 1); if (isWeekday(d) && seen++ >= skip) out.push(d); }
  return out;
}
const dayLabel = date => { const d = new Date(`${date}T12:00:00Z`); return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: MON[d.getUTCMonth()] }; };

async function call(path, init = {}) {
  const r = await fetch(API() + path, { ...init, headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}
class ReadError extends Error { constructor(what, status) { super(`calendly ${what} ${status}`); this.status = status; } }

// The intro call's event type, found by its scheduling link (the one value), once per process.
async function eventType() {
  if (eventTypeUri) return eventTypeUri;
  const { BOOKING_URL } = await import("../../../shared/bookingLink.js");
  const me = await call("/users/me");
  if (!me.ok) throw new ReadError("users/me", me.status);
  const list = await call(`/event_types?user=${encodeURIComponent(me.body.resource.uri)}&active=true&count=100`);
  if (!list.ok) throw new ReadError("event_types", list.status);
  const hit = (list.body.collection || []).find(e => String(e.scheduling_url).replace(/\/+$/, "") === BOOKING_URL);
  if (!hit) throw new ReadError("no active event type has the booking link", "none");
  eventTypeUri = hit.uri;
  return eventTypeUri;
}

// One Monday-to-Friday week of open times, in ONE request (Calendly allows at most a week).
async function readWeek(monday, now) {
  const uri = await eventType();
  // Midnight Monday Eastern at the latest offset, to midnight Saturday at the earliest: under six days.
  const start = new Date(Math.max(now.getTime() + 60 * 1000, Date.parse(`${monday}T04:00:00Z`))).toISOString();
  const end = new Date(Date.parse(`${addDays(monday, 5)}T05:00:00Z`)).toISOString();
  if (Date.parse(end) <= Date.parse(start)) return [];
  const r = await call(`/event_type_available_times?event_type=${encodeURIComponent(uri)}&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`);
  if (!r.ok) throw new ReadError(`available_times (week of ${monday})`, r.status);
  const seen = new Set(), slots = [];
  for (const x of r.body.collection || []) {
    if (seen.has(x.start_time) || x.status !== "available") continue;
    seen.add(x.start_time);
    const e = eastern(x.start_time);
    slots.push({ date: e.date, start: x.start_time, time: e.hm, ampm: e.ampm, url: x.scheduling_url });
  }
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

// A week from the cache: fresh as is; stale (under an hour) at once, read again in the background;
// none, read now. A failed read is logged with its status, and keeps nothing.
function refresh(monday, now) {
  const c = weeks.get(monday);
  if (c && c.reading) return c.reading;
  const reading = readWeek(monday, now)
    .then(slots => { weeks.set(monday, { at: Date.now(), slots }); return slots; })
    .catch(e => { console.warn(`[book] Calendly times could not be read: ${e.message}${e.status ? ` (status ${e.status})` : ""}`);
      const prev = weeks.get(monday); if (prev) weeks.set(monday, { ...prev, reading: null }); else weeks.delete(monday); throw e; });
  weeks.set(monday, { ...(c || {}), reading });
  return reading;
}
async function week(monday, now) {
  const c = weeks.get(monday);
  const age = c && c.at ? Date.now() - c.at : Infinity;
  if (age < FRESH_MS) return c.slots;
  if (age < STALE_MS) { refresh(monday, now).catch(() => {}); return c.slots; }
  return refresh(monday, now);
}

// Three weeks of weekdays and their open times. `page` 0 is the next 15 weekdays, 1 the 15 after.
// { source: "calendly", tz, days, page, more } or { source: "unavailable", reason, link }.
async function times(now = new Date(), { page = 0 } = {}) {
  const { BOOKING_URL } = await import("../../../shared/bookingLink.js");
  if (!TOKEN()) return { source: "unavailable", reason: "no_token", link: BOOKING_URL };
  const p = Math.max(0, Math.min(MAX_PAGES - 1, Number(page) || 0));
  const days = nextWeekdays(now, PAGE_DAYS, p * PAGE_DAYS);
  const mondays = [...new Set(days.map(mondayOf))];
  try {
    const found = (await Promise.all(mondays.map(m => week(m, now)))).flat();
    const byDay = new Map(days.map(d => [d, []]));
    for (const s of found) if (byDay.has(s.date) && Date.parse(s.start) > now.getTime()) byDay.get(s.date).push(s);
    return { source: "calendly", tz: TZ, tzWords: "All times Eastern · Google Meet", page: p, more: p < MAX_PAGES - 1,
      days: days.map(d => ({ date: d, ...dayLabel(d), slots: byDay.get(d).map(({ date, ...x }) => x) })) };
  } catch (e) {
    return { source: "unavailable", reason: "unavailable", status: e.status || null, link: BOOKING_URL };
  }
}

// Keep the first page warm so /book draws from the cache. Not in tests (no token there).
function startWarm() {
  if (warmTimer || !TOKEN() || process.env.TEST_MODE === "1") return;
  const tick = () => times(new Date()).catch(() => {});
  tick();
  warmTimer = setInterval(tick, WARM_MS);
  if (warmTimer.unref) warmTimer.unref();
}

// Her chosen time, checked against the open times just read (a time not offered is refused).
// Returns { booked: true } when Calendly's scheduling API booked it, or { open: <Calendly's own page
// for that time, prefilled> } for her last click, or { error }.
async function book({ start, name, email }, now = new Date()) {
  if (!TOKEN()) return { error: "no_times" };
  const day = /^\d{4}-\d{2}-\d{2}T/.test(String(start)) ? eastern(start).date : null;
  let found = [];
  try { found = day ? await week(mondayOf(day), now) : []; } catch { return { error: "no_times" }; }
  const slot = found.find(s => s.start === start && Date.parse(s.start) > now.getTime());
  if (!slot) return { error: "taken", message: "That time was just taken. Pick another one." };
  const open = (() => { const u = new URL(slot.url); u.searchParams.set("name", name); u.searchParams.set("email", email); return u.toString(); })();
  if (process.env.CALENDLY_DIRECT_BOOK !== "1") return { open };
  const r = await call("/invitees", { method: "POST", body: JSON.stringify({ event_type: await eventType(), start_time: slot.start,
    invitee: { name, email, timezone: TZ }, location: { kind: "google_conference" } }) });
  if (r.ok) { weeks.delete(mondayOf(eastern(slot.start).date)); return { booked: true }; }
  console.warn(`[book] Calendly did not book directly (${r.status}); opening its page for the last click`);
  return { open };
}

function _reset() { weeks = new Map(); eventTypeUri = null; if (warmTimer) { clearInterval(warmTimer); warmTimer = null; } }

module.exports = { times, book, nextWeekdays, eastern, mondayOf, startWarm, _reset, TZ, PAGE_DAYS };

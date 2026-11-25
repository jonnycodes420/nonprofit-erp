// server/admin/sales/calendlyTimes.js · BOOK-1 item 2. THE BOOKING CARD'S TIMES, AND ITS LAST CLICK.
//
// /book shows the next five weekdays and the open times of the "Steward intro call" event
// (shared/bookingLink.js), read from Calendly's available-times API with the account's token
// (CALENDLY_API_TOKEN, a Railway variable; never in the repo). Times are Eastern, Jonathan's.
//
// Booking a time: with CALENDLY_DIRECT_BOOK=1 (the account allows Calendly's scheduling API),
// Steward books it through that API and Calendly sends her the invitation. Otherwise the card opens
// that very time on Calendly's own page, her name and email already filled in, for the last click.
// Either way Calendly sends the invitation and the reminder; Steward sends her nothing.
//
// Without a token there are no times to show, and the card opens Calendly's own calendar instead
// (source "embed"). Nothing here writes a row.
"use strict";

const TZ = "America/New_York";
const API = () => (process.env.CALENDLY_API_BASE || "https://api.calendly.com").replace(/\/+$/, "");
const TOKEN = () => String(process.env.CALENDLY_API_TOKEN || "").trim();
const DAYS = 5;
const CACHE_MS = 60 * 1000;
let cache = { at: 0, key: "", value: null };
let eventTypeUri = null;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The Eastern civil date and clock of an instant.
function eastern(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, weekday: "short" })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hm: `${p.hour}:${p.minute}`, ampm: p.dayPeriod };
}
// The next `n` weekdays after today (Eastern), as YYYY-MM-DD.
function nextWeekdays(now, n = DAYS) {
  const out = [];
  const today = eastern(now.toISOString()).date;
  let d = new Date(`${today}T12:00:00Z`);
  while (out.length < n) {
    d = new Date(d.getTime() + 86400000);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const dayLabel = date => { const d = new Date(`${date}T12:00:00Z`); return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), mon: MON[d.getUTCMonth()] }; };

async function call(path, init = {}) {
  const r = await fetch(API() + path, { ...init, headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

// The intro call's event type, found by its scheduling link (the one value), once per process.
async function eventType() {
  if (eventTypeUri) return eventTypeUri;
  const { BOOKING_URL } = await import("../../../shared/bookingLink.js");
  const me = await call("/users/me");
  if (!me.ok) throw new Error(`calendly users/me ${me.status}`);
  const list = await call(`/event_types?user=${encodeURIComponent(me.body.resource.uri)}&active=true&count=100`);
  if (!list.ok) throw new Error(`calendly event_types ${list.status}`);
  const hit = (list.body.collection || []).find(e => String(e.scheduling_url).replace(/\/+$/, "") === BOOKING_URL);
  if (!hit) throw new Error("calendly: no active event type has the booking link");
  eventTypeUri = hit.uri;
  return eventTypeUri;
}

// The next five weekdays and their open times. { source: "calendly", tz, days: [...] } or { source: "embed" }.
async function times(now = new Date()) {
  if (!TOKEN()) return { source: "embed", reason: "no_token" };
  const days = nextWeekdays(now);
  const key = days.join(",");
  if (cache.value && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const uri = await eventType();
    const start = new Date(Math.max(now.getTime() + 60 * 1000, Date.parse(`${days[0]}T00:00:00-05:00`) - 5 * 3600 * 1000)).toISOString();
    const end = new Date(Date.parse(`${days[days.length - 1]}T23:59:00-05:00`) + 2 * 3600 * 1000).toISOString();
    // Calendly answers at most a week per request: a longer span is asked in two halves.
    const spans = Date.parse(end) - Date.parse(start) > 6.5 * 86400000
      ? [[start, new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString()], [new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString(), end]]
      : [[start, end]];
    const found = [];
    for (const [a, b] of spans) {
      const r = await call(`/event_type_available_times?event_type=${encodeURIComponent(uri)}&start_time=${encodeURIComponent(a)}&end_time=${encodeURIComponent(b)}`);
      if (!r.ok) throw new Error(`calendly available_times ${r.status}`);
      found.push(...(r.body.collection || []));
    }
    const byDay = new Map(days.map(d => [d, []]));
    const seen = new Set();
    for (const s of found) {
      if (seen.has(s.start_time)) continue;
      seen.add(s.start_time);
      if (s.status !== "available") continue;
      const e = eastern(s.start_time);
      if (byDay.has(e.date)) byDay.get(e.date).push({ start: s.start_time, time: e.hm, ampm: e.ampm, url: s.scheduling_url });
    }
    const value = { source: "calendly", tz: TZ, tzWords: "All times Eastern · Google Meet",
      days: days.map(d => ({ date: d, ...dayLabel(d), slots: byDay.get(d).sort((a, b) => a.start.localeCompare(b.start)) })) };
    cache = { at: Date.now(), key, value };
    return value;
  } catch (e) {
    console.warn(`[book] Calendly times could not be read: ${e.message}`);
    return { source: "embed", reason: "unavailable" };
  }
}

// Her chosen time, checked against the open times just read (a time not offered is refused).
// Returns { booked: true } when Calendly's scheduling API booked it, or { open: <Calendly's own page
// for that time, prefilled> } for her last click, or { error }.
async function book({ start, name, email }, now = new Date()) {
  const t = await times(now);
  if (t.source !== "calendly") return { error: "no_times" };
  const slot = t.days.flatMap(d => d.slots).find(s => s.start === start);
  if (!slot) return { error: "taken", message: "That time was just taken. Pick another one." };
  const open = (() => { const u = new URL(slot.url); u.searchParams.set("name", name); u.searchParams.set("email", email); return u.toString(); })();
  if (process.env.CALENDLY_DIRECT_BOOK !== "1") return { open };
  const r = await call("/invitees", { method: "POST", body: JSON.stringify({ event_type: await eventType(), start_time: slot.start,
    invitee: { name, email, timezone: TZ }, location: { kind: "google_conference" } }) });
  if (r.ok) { cache = { at: 0, key: "", value: null }; return { booked: true }; }
  console.warn(`[book] Calendly did not book directly (${r.status}); opening its page for the last click`);
  return { open };
}

function _reset() { cache = { at: 0, key: "", value: null }; eventTypeUri = null; }

module.exports = { times, book, nextWeekdays, eastern, _reset, TZ };

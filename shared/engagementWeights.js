// shared/engagementWeights.js — ENGAGE-1. THE ONE FILE THE TWO SCORES ARE MADE OF.
//
// Every weight, every window and every cut point is here, next to the plain
// words that explain it. The donor profile's "See why" panel prints EXPLANATION
// from this file, so the screen and the arithmetic cannot say different things.
// Change a number here and the explanation's sentence must change with it.
//
// Both scores are 0 to 100 and RELATIVE: a donor's number is where they stand
// among this organisation's own people, never against anybody else's. They are
// computed by engagement.js, nightly and after every gift or touch.

// ── ENGAGEMENT: how close they are, from the touches of the last 24 months ──
export const WINDOW_DAYS = 730;          // 24 months; a touch older than this counts nothing
export const FULL_WEIGHT_DAYS = 90;      // a touch in the last 90 days counts in full
// Between 90 days and 24 months a touch fades in a straight line to nothing:
// a meeting a year ago counts a little over half of one last month.
export function recencyWeight(ageDays) {
  if (ageDays < 0 || ageDays >= WINDOW_DAYS) return ageDays < 0 ? 1 : 0;
  if (ageDays <= FULL_WEIGHT_DAYS) return 1;
  return (WINDOW_DAYS - ageDays) / (WINDOW_DAYS - FULL_WEIGHT_DAYS);
}

// Points for one touch at full weight. A meeting is the strongest sign of a
// relationship, then attending an event, then a call or a reply, then giving
// time; an email opened is the faintest sign there is.
export const TOUCH_POINTS = Object.freeze({
  meetings:    { points: 5,   label: "Meetings",          one: "meeting",  many: "meetings",  how: "a meeting or visit, logged or on the calendar" },
  events:      { points: 4,   label: "Events attended",   one: "event",    many: "events",    how: "an event they came to" },
  calls:       { points: 3,   label: "Calls",             one: "call",     many: "calls",     how: "a call" },
  replies:     { points: 3,   label: "Email replies",     one: "reply",    many: "replies",   how: "an email they wrote back to" },
  surveys:     { points: 3,   label: "Survey answers",    one: "survey",   many: "surveys",   how: "a survey they answered with their name on it" },
  volunteering:{ points: 2,   label: "Volunteer shifts",  one: "shift",    many: "shifts",    how: "a volunteer shift" },
  email:       { points: 1,   label: "Newsletter opens and clicks", one: "open or click", many: "opens and clicks", how: "a newsletter click (1 point) or open (half a point), from Mailchimp or Constant Contact" },
  // WIRE-1 addendum: what a person does FOR the organisation is engagement too.
  // Running a peer-to-peer page means asking their own friends on your behalf,
  // which is as strong a sign as a meeting. A ticket bought, a bid placed and a
  // membership held are each a decision to show up.
  fundraising: { points: 5,   label: "Fundraising pages", one: "fundraising page", many: "fundraising pages", how: "a peer-to-peer page they run for you, dated by its latest gift" },
  tickets:     { points: 3,   label: "Event tickets",     one: "event ticket", many: "event tickets", how: "a ticket or registration for an event (one they came to counts under events instead)" },
  auctions:    { points: 3,   label: "Auction bids",      one: "auction bid", many: "auction bids", how: "an auction they bid in, dated by their latest bid" },
  memberships: { points: 3,   label: "Memberships",       one: "membership", many: "memberships", how: "a membership year they joined or renewed" },
});
export const OPEN_POINTS = 0.5;          // an open without a click
// FIX-33: a meeting booked with them counts under Meetings, dated the day it
// was booked; the meeting itself counts again once it is held.
export const BOOKED_POINTS = 3;
export const ENGAGEMENT_PARTS = Object.keys(TOUCH_POINTS);

// ── GENEROSITY: how much they give, against the organisation's own donors ──
// Each part is a percentile among the donors who have given at least once, and
// the score is these weights times those percentiles. The weights add to 1.
export const GENEROSITY_PARTS = Object.freeze({
  lifetime:    { weight: 0.30, label: "Lifetime giving",      how: "everything they have given, net of refunds" },
  recent:      { weight: 0.30, label: "Last 24 months",       how: "what they have given in the last 24 months" },
  consistency: { weight: 0.20, label: "Years given",          how: "how many of the last five calendar years they gave in" },
  monthly:     { weight: 0.10, label: "Monthly giving",       how: "whether they have a recurring gift running now" },
  upgrade:     { weight: 0.10, label: "Giving more",          how: "how much more they gave in the last 12 months than the 12 before (only for donors who gave in both)" },
});
export const CONSISTENCY_YEARS = 5;
export const UPGRADE_DAYS = 365;

// ── BANDS, on the engagement score ──────────────────────────────────────────
// Three plain words and a number. No "hot", no "on fire": a band is where they
// are, not how excited anybody should be.
export const BANDS = Object.freeze([
  { key: "close",   label: "Close",   min: 67 },
  { key: "warm",    label: "Warm",    min: 34 },
  { key: "distant", label: "Distant", min: 0 },
]);
export function bandFor(score) {
  const s = Number(score) || 0;
  return BANDS.find(b => s >= b.min) || BANDS[BANDS.length - 1];
}

// ── CLOSENESS, the band in words (PARITY-1) ──────────────────────────────────
// The profile's line under the tags says one word, and it is the band above,
// never a second opinion: Close and Warm are the bands of the same names. A
// Distant person is New when they arrived (their record or their first gift)
// in the last NEW_DAYS days. WIRE-1 addendum: otherwise they are judged against
// their OWN rhythm, never the calendar. A Distant person whose giving is inside
// their own usual gap (drift.js, stored as donor_scores.pattern 'on_track') is
// On track: a once-a-year donor who gave this October, on pattern, is not
// cooling. Cooling is the rest: past their own gap, or one gift and nothing
// since. donorStatus.js says the same thing in SQL for lists and Groups.
export const NEW_DAYS = 90;
export const CLOSENESS = Object.freeze([
  { key: "close",    label: "Close" },
  { key: "warm",     label: "Warm" },
  { key: "on_track", label: "On track" },
  { key: "cooling",  label: "Cooling" },
  { key: "new",      label: "New" },
]);
export function closenessFor(band, { isNew = false, pattern = null } = {}) {
  const key = typeof band === "string" ? band : bandFor(band).key;
  if (key === "close" || key === "warm") return key;
  if (isNew) return "new";
  return pattern === "on_track" ? "on_track" : "cooling";
}

// ── THE EXPLANATION, as the screen shows it ─────────────────────────────────
export const EXPLANATION = Object.freeze({
  engagement:
    "Engagement is how close this person is, from 0 to 100. Every meeting (5 points), peer-to-peer page they run for you (5), event attended (4), call (3), email reply (3), "
    + "named survey answer (3), event ticket (3), auction bid in (3), membership year (3), volunteer shift (2), newsletter click (1) or open (half a point) in the last 24 months counts. "
    + "A touch in the last 90 days counts in full and older ones fade to nothing at 24 months. "
    + "The score is where their total stands among the people you have been in touch with in those 24 months: 80 means closer than about 80 in 100 of them (people tied with them count as half). "
    + "67 and above is Close, 34 to 66 is Warm, 33 and below is Distant.",
  generosity:
    "Generosity is how much this person gives, from 0 to 100, against your own donors only. Five parts, each a percentile among everyone who has given: "
    + "lifetime giving (30%), the last 24 months (30%), how many of the last five years they gave (20%), a monthly gift running now (10%) "
    + "and giving more this year than last (10%). It never uses wealth or capacity data.",
  parts:
    "The parts add up to the score. Each part opens the rows it counted.",
});

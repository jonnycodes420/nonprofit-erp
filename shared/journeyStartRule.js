// shared/journeyStartRule.js · FLOWS-3 (W-1107-Fundraising-28). WHO A PERSON
// CAN PUT IN A JOURNEY BY HAND, AND FROM WHAT DAY ITS STEPS COUNT.
//
// 1. Only an Active journey (state "running") starts people. A Draft or a
//    Paused journey is still listed, greyed out, with the reason; the server
//    refuses it too (server/shared/journeyStart.js), so no door can start one.
// 2. A journey with a date trigger counts its steps from that date, not from
//    the day somebody pressed the button: "A date every year" from the next
//    time the date comes round, a birthday journey from the day the sweep would
//    start it for this person. Every other trigger counts from today.
// 3. Several people at once get a breakdown, never a bare "All 3 can start":
//    "2 can start, 1 is already in it."
// Browser-safe: the profile picker, the bulk dialog and the server read it.
import { nextYearlyOn } from "./taskShape.js";
import { birthdayJourneyStart } from "./birthday.js";

export const ACTIVE_STATE = "running";
export const canStartState = state => state === ACTIVE_STATE;

const NOT_ACTIVE = {
  draft: "Draft: turn it on in Journeys before anyone can start it",
  paused: "Paused: turn it back on in Journeys before anyone can start it",
  archived: "Archived",
};
export function notActiveWhy(state) {
  return NOT_ACTIVE[state] || "Not on: turn it on in Journeys before anyone can start it";
}

// The day a by-hand start counts its steps from. `t` is a journey row
// (trigger_key, trigger_filters) or { trigger, triggerFilters }; `person` may
// carry birth_month / birth_day. Never earlier than today.
export function journeyAnchor(t, person, today) {
  const key = (t && (t.trigger_key || t.trigger)) || "";
  const tf = (t && (t.trigger_filters || t.triggerFilters)) || {};
  if (key === "yearly_date" && Number(tf.month) && Number(tf.day)) {
    return nextYearlyOn(Number(tf.month), Number(tf.day), today) || today;
  }
  if (key === "birthday" && person && person.birth_month && person.birth_day) {
    return birthdayJourneyStart(Number(person.birth_month), Number(person.birth_day), today, Number(tf.daysBefore) || 0) || today;
  }
  return today;
}

// Per-person breakdown of a split, for the dialog's row and the preview.
const SHORT = {
  already_in_this_journey: ["is already in it", "are already in it"],
  already_in_a_journey: ["is in a journey that comes first", "are in a journey that comes first"],
  in_another_journey: ["is in another journey", "are in another journey"],
  do_not_contact: ["is marked do not contact", "are marked do not contact"],
  deceased: ["has died", "have died"],
  do_not_solicit: ["is marked do not solicit, and this journey asks for money", "are marked do not solicit, and this journey asks for money"],
  donor_not_found: ["is no longer in Steward", "are no longer in Steward"],
  journey_not_active: ["can't start: the journey isn't on", "can't start: the journey isn't on"],
};
const fmt = n => Number(n || 0).toLocaleString("en-US");
export function breakdownSentence(asked, willStart, skipCounts = {}) {
  const parts = [];
  if (willStart > 0) parts.push(willStart === asked && asked === 1 ? "This person can start" : `${fmt(willStart)} can start`);
  const rest = Object.entries(skipCounts).map(([k, v]) => [k, Array.isArray(v) ? v.length : Number(v) || 0]).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rest) {
    const w = SHORT[k] || ["can't start", "can't start"];
    parts.push(`${fmt(n)} ${n === 1 ? w[0] : w[1]}`);
  }
  if (!parts.length) return "Nobody to start.";
  if (parts.length === 1 && willStart === asked && asked > 1) return `All ${fmt(asked)} can start.`;
  return parts.join(", ") + ".";
}

// One person's row in the preview ("Already in it").
export function personWhy(reason) {
  const w = (SHORT[reason] || ["can't start"])[0].replace(/^(is|has) /, "");
  return w.charAt(0).toUpperCase() + w.slice(1) + ".";
}

export default { personWhy, ACTIVE_STATE, canStartState, notActiveWhy, journeyAnchor, breakdownSentence };

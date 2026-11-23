// shared/populationWords.js · DEFINE-1 item 1. EVERY NAMED GROUP OF PEOPLE A SCREEN COUNTS.
//
// Jarvis (22 Nov): "Five irreconcilable 'lapsed donor' counts: Atlas 173,
// Re-engage 295, Comms audience 342, Fundraising 519 households, Groups/LYBUNT
// 520 people. Only one pair is defined anywhere." Each number was right; they
// were five populations wearing one word. Each population here has an id, the
// name a screen shows, whether it counts people or households, and the one
// sentence that defines it. A screen that shows a population's count shows
// that name and that sentence under it (client/src/components/PopulationCount.jsx),
// never a hover-only definition. Where two populations differ on purpose, the
// names say so ("LYBUNT you can ask" beside "LYBUNT").
//
// The words only. How each population is built (the SQL) is NOT here and is
// not copied anywhere: shared/numbers/populations.js points each id at the
// builder that already exists (lapse.js, bunt.js, isDonor.js, everyone.js …).
// ES module: the browser imports this; the server reads it through
// shared/numbers/populations.js. scripts/ci/population-ids.js fails the build
// when a screen names an id that is not here.
const P = (id, name, unit, sentence) => Object.freeze({ id, name, unit, sentence });

export const POPULATIONS = Object.freeze({
  // ── Giving status ────────────────────────────────────────────────────────
  donors: P("donors", "Donors", "people",
    "Donors: everyone who has given at least once (a gift on file, or a lifetime total from the old system). A person added by hand who has not given yet is a contact until they do."),
  everyone: P("everyone", "Everyone", "people",
    "Everyone: every active person record here, donors and contacts, not counting anyone in the trash, archived, or erased, and never a user's login."),
  gave_this_year: P("gave_this_year", "Gave this year", "people",
    "Gave this year: everyone with at least one gift dated in this fiscal year."),
  monthly_givers: P("monthly_givers", "Monthly givers", "people",
    "Monthly givers: a monthly recurring gift that is still running, or gifts on 6 or more days in the last 12 months that came about a month apart."),
  volunteers: P("volunteers", "Volunteers", "people",
    "Volunteers: everyone on the volunteer roster (the Volunteer role on their record), the same people the Volunteers screen lists."),

  // ── Rolling months (lapseRule.js, shared/numbers/lapse.js) ────────────────
  lapsed: P("lapsed", "Lapsed 12+ months", "people",
    "Lapsed 12+ months: gave before, no gift in the last 12 months, no pledge holding them, and not marked deceased. Counted in rolling months, not fiscal years."),
  lapsing: P("lapsing", "Lapsing", "people",
    "Lapsing: last gift 9 to 12 months ago, their usual time to give has passed, and no pledge holds them."),
  lapsing_or_lapsed: P("lapsing_or_lapsed", "Lapsing or lapsed", "people",
    "Lapsing or lapsed: everyone Lapsing (last gift 9 to 12 months ago and overdue by their own rhythm) plus everyone Lapsed (no gift in 12 months and no pledge holding them)."),
  reengage: P("reengage", "Re-engage", "people",
    "Re-engage: no gift in 12 months or more (Lost included) and no pledge holding them, and still askable: not deceased, do not contact, do not solicit, or a stopped imported sustainer."),
  lost: P("lost", "Lost: over 24 months", "people",
    "Lost: on Re-engage, with no gift in over 24 months."),

  // ── Fiscal years (shared/numbers/bunt.js) ─────────────────────────────────
  lybunt: P("lybunt", "LYBUNT", "people",
    "LYBUNT (Last Year But Unfortunately Not This year): gave in the last fiscal year and has given nothing yet in this one. Counted in fiscal years, one row per person."),
  lybunt_households: P("lybunt_households", "LYBUNT households", "households",
    "LYBUNT households: the LYBUNT people with each household counted once (two people in one household are one line), so this is never more than LYBUNT."),
  lybunt_askable: P("lybunt_askable", "LYBUNT you can ask", "people",
    "LYBUNT you can ask: LYBUNT, leaving out anyone marked deceased, do not contact or do not solicit."),
  sybunt: P("sybunt", "SYBUNT", "people",
    "SYBUNT (Some Year But Unfortunately Not This year): gave in some fiscal year before this one and has given nothing yet in this one, last year's givers included."),
  sybunt_askable: P("sybunt_askable", "SYBUNT, not last year, you can ask", "people",
    "SYBUNT, not last year, you can ask: gave in some fiscal year before last, nothing last year or this year, and not marked deceased, do not contact or do not solicit."),
  lapsing_askable: P("lapsing_askable", "Lapsing, you can ask", "people",
    "Lapsing, you can ask: Lapsing, leaving out anyone marked deceased, do not contact or do not solicit."),
  lapsed_askable: P("lapsed_askable", "Lapsed 12+ months, you can ask", "people",
    "Lapsed 12+ months, you can ask: no gift in the last 12 months after giving before, no pledge holding them, and not marked deceased, do not contact or do not solicit."),
});

export const POPULATION_IDS = Object.freeze(Object.keys(POPULATIONS));
export const population = id => POPULATIONS[id] || null;
export const isPopulationId = id => Object.prototype.hasOwnProperty.call(POPULATIONS, String(id || ""));
// "520 people" / "519 households" / "1 person".
export function unitWords(id, n) {
  const p = population(id);
  const k = Number(n) || 0;
  if (p && p.unit === "households") return k === 1 ? "household" : "households";
  return k === 1 ? "person" : "people";
}

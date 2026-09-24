// shared/numberCensus.js — BUILD-97 Part 2. EVERY NUMBER ON SCREEN HAS A
// SENTENCE UNDER IT A DIRECTOR CAN REPEAT.
//
// BUILD-86 C.3 made this true of the four dashboards and stopped there:
// `shared/dashboards.js` refuses to let a metric reach a board screen without a
// one-sentence definition, and `tests/dashboards.test.js` walks the registry.
// Everywhere else a figure could appear with nothing under it — which is how
// "Score 77/99" sat beside somebody's name for months, and how "Weighted
// forecast · by stage" reached a screen where "by stage" was the whole
// explanation of a number built from six invented probabilities.
//
// ── THE THREE RULES A NUMBER HAS TO PASS ───────────────────────────────────
//   1. It is computed from the ORGANISATION'S OWN ROWS. Nothing here looks
//      outside the customer's own file — no screening, no sector model, no
//      estimate of what somebody could afford.
//   2. It can be stated in ONE PLAIN SENTENCE. If the honest explanation needs
//      a paragraph, the number is doing more than one job and should be two
//      numbers or none.
//   3. THAT SENTENCE IS ON THE SCREEN — inline, or on a hover that is reachable
//      by keyboard and readable by a screen reader. A definition in a source
//      comment is a definition that does not exist.
//
// A number that fails any of the three comes off. The full survey, including
// everything that was counted and everything that was removed, is in
// audit/BUILD-97-NUMBER-CENSUS.md; this file is the part the suite walks.
//
// Pure: no DB, no network, no clock, no JSX.

export const HOVER = "hover";     // reachable by keyboard, exposed to a reader
export const INLINE = "inline";   // rendered under the figure, always visible

// `testid` is the element the suite finds; `sentence` is the exact string that
// must be on the screen — ONE string, from here to the render, never two copies
// that drift. `computation` is for the census document and the next person.
export const NUMBER_CENSUS = [
  // ── HOME (the rail) ──────────────────────────────────────────────────────
  // These three already rendered their definitions inline before this build;
  // they are in the registry so they cannot quietly lose them.
  {
    id: "home.open",
    surface: "Home",
    label: "Open follow-ups",
    computation: "COUNT(threads WHERE closed_at IS NULL), org-scoped, the caller's own by default",
    sentence: "Every donor with a next step planned and not yet done.",
    where: INLINE,
    testid: "rail-def-open",
  },
  {
    id: "home.today",
    surface: "Home",
    label: "Due today",
    computation: "the same open threads, filtered to due_date == the org's civil today",
    sentence: "Next steps whose date is today, in your organization's timezone.",
    where: INLINE,
    testid: "rail-def-today",
  },
  {
    id: "home.failed",
    surface: "Home",
    label: "Cards that failed this week",
    computation: "recurring_subscriptions with first_failed_at inside seven days and no payment since",
    sentence: "A recurring card that declined in the last seven days and has not gone through since.",
    where: INLINE,
    testid: "rail-def-failed",
  },

  // ── THE DONOR PROFILE ────────────────────────────────────────────────────
  // The three tiles that survive. The fourth — "Giving strength 77/99" — does
  // not; see the census document, and `tests/build97-numbers.test.js` asserts
  // it no longer renders here.
  {
    id: "profile.lifetime",
    surface: "Donor profile",
    label: "Lifetime",
    computation: "donors.total_giving — SUM of every gift on this record, recomputed by recalcDonorSummary",
    sentence: "Every gift on this record added up. Their own giving only: a household total is shown separately, and soft credit never moves this figure.",
    where: HOVER,
    testid: "dp-tile-def-Lifetime",
  },
  {
    id: "profile.lastGift",
    surface: "Donor profile",
    label: "Last Gift",
    computation: "the amount and date of the most recent gift row on this donor",
    sentence: "The most recent gift on this record, and the day it arrived.",
    where: HOVER,
    testid: "dp-tile-def-Last Gift",
  },
  {
    id: "profile.contact",
    surface: "Donor profile",
    label: "Contact",
    computation: "days between the org's civil today and the most recent interactions row (any type)",
    sentence: "How long since anyone here last logged a conversation with them. A gift on its own does not count as contact.",
    where: HOVER,
    testid: "dp-tile-def-Contact",
  },

  // ── THE DONOR LISTS ──────────────────────────────────────────────────────
  // Giving strength SURVIVES as a list column and does NOT survive as a tile
  // on the profile — the census document has the reasoning, and it is not a
  // contradiction: a column is a sort order across a list, and a tile beside
  // one person's name is a verdict on that person.
  {
    id: "list.givingStrength",
    surface: "Donor directory · Re-engage",
    label: "Giving strength",
    computation: "donorScore(): amount, recency and frequency of this donor's own giving, clamped 5..99",
    sentence: "How strong this donor's giving has been with you — how much, how recently, and how often. Ranked 5 to 99 against a fixed scale, not against your other donors. It is NOT an estimate of what they could afford to give: nothing here looks outside your own records.",
    where: HOVER,
    testid: "dir-def-giving-strength",
  },

  // ── PIPELINE ─────────────────────────────────────────────────────────────
  {
    id: "pipeline.open",
    surface: "Pipeline",
    label: "Open asks",
    computation: "SUM(opportunities.target_amount WHERE status='open')",
    sentence: "What you have actually asked for and not yet heard back on, added up.",
    where: HOVER,
    testid: "pipe-def-open",
  },
  {
    // THE ONE THAT NEARLY DID NOT SURVIVE. Its sub-label was the two words "by
    // stage", which is not an explanation of anything: the figure multiplies
    // each open ask by a fixed probability attached to the donor's pipeline
    // stage, and those six probabilities are a judgement somebody made once.
    // It survives because the probabilities ARE stateable and they ARE in a
    // constants table (STAGE_WEIGHT, server.js) — but only with them said out
    // loud, and only with the warning that they are not measured.
    id: "pipeline.weighted",
    surface: "Pipeline",
    label: "Weighted forecast",
    computation: "SUM(open ask × STAGE_WEIGHT[donor.stage]) with prospect .1 / qualify .2 / cultivate .4 / solicit .7 / steward .9 / lapsed .05",
    sentence: "Each open ask multiplied by a fixed likelihood for the stage that donor is in — 10% at Prospect, 20% Qualify, 40% Cultivate, 70% Solicit, 90% Steward. Those percentages are a working assumption, not anything measured from your file.",
    where: HOVER,
    testid: "pipe-def-weighted",
  },
  {
    id: "pipeline.closed",
    surface: "Pipeline",
    label: "Closed this FY",
    computation: "SUM(opportunities.gift_amount WHERE status='won' AND closed_at inside the org's fiscal year)",
    sentence: "Asks marked won since the start of your fiscal year, at the amount that actually came in.",
    where: HOVER,
    testid: "pipe-def-closed",
  },

  // ── RECURRING ────────────────────────────────────────────────────────────
  {
    id: "recurring.mrr",
    surface: "Recurring giving",
    label: "Monthly recurring revenue",
    computation: "SUM of each live subscription's monthly-equivalent amount (a yearly gift counted as a twelfth)",
    sentence: "What your live recurring gifts come to in a month. A yearly gift counts as a twelfth of itself. A cancelled one counts as nothing the moment it stops.",
    where: HOVER,
    testid: "rec-def-mrr",
  },
];

export const censusById = (id) => NUMBER_CENSUS.find(n => n.id === id) || null;
export const censusFor = (surface) => NUMBER_CENSUS.filter(n => n.surface === surface);

// Every sentence is checked for the properties the rules above demand, so a
// future entry cannot be added that breaks them quietly.
export function sentenceProblems(entry) {
  const problems = [];
  const s = String(entry.sentence || "");
  if (!s) problems.push("no sentence");
  if (s.length < 25) problems.push("too short to be an explanation");
  if (s.length > 420) problems.push("longer than one plain sentence's worth");
  if (!/[.!?]$/.test(s.trim())) problems.push("does not end as a sentence");
  // The vocabulary that would mean the number looks OUTSIDE the org's own rows.
  // "capacity" and "estimated" are how a giving figure becomes a claim about
  // somebody's means, which is the reading BUILD-100 spent a build denying.
  if (/\bwealth\b|\bcapacity to give\b|\bestimated net worth\b|\bscreened\b/i.test(s))
    problems.push("claims something outside the org's own records");
  return problems;
}

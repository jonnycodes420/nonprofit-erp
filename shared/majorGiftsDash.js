// shared/majorGiftsDash.js — BUILD-99 (major gifts) Part 5. FIVE THINGS A
// DEVELOPMENT DIRECTOR ASKS, AND WHERE EACH ANSWER COMES FROM.
//
// The BUILD-86 C.3 rule, applied again and for the same reason: NOTHING APPEARS
// ON THIS SCREEN WITHOUT A ONE-SENTENCE DEFINITION, and the definition is ONE
// STRING from this registry to the hover and to anything printed. A metric added
// without one cannot reach a screen, because the suite walks the registry.
//
// ── AND NO GOAL IS INVENTED ───────────────────────────────────────────────
// The only target on this screen is the one she typed in Part 2. There is no
// benchmark, no "orgs like yours", no suggested pipeline coverage ratio. A
// figure with nothing to compare it against is shown on its own; the alternative
// is Steward telling an organisation it knows nothing about how it is doing.
//
// Pure: no DB, no network, no clock, no JSX.

export const METRICS = [
  { id: "pipeline",
    label: "Open pipeline",
    definition: "The ask amounts on every proposal still at Identified, Cultivating or Asked. It is what you have asked for, not what anybody expects to land.",
    kind: "money" },
  { id: "weighted",
    label: "Weighted",
    definition: "Each open proposal's ask multiplied by the probability you set on it by hand, added up. A proposal with no probability set is not in this figure.",
    kind: "money" },
  { id: "dueThisQuarter",
    label: "Due this quarter",
    definition: "Open proposals whose expected close date falls inside this quarter on your own calendar.",
    kind: "count" },
  { id: "askedThisYear",
    label: "Asked this year",
    definition: "The ask amounts on proposals that reached Asked, Committed, Declined or Stewarding in this fiscal year. Reaching the stage is the event, not the day the proposal was created.",
    kind: "money" },
  { id: "committedThisYear",
    label: "Committed this year",
    definition: "What people actually said yes to in this fiscal year — the gift amount when one is linked, otherwise the amount they committed to.",
    kind: "money" },
  { id: "conversationsThisMonth",
    label: "Conversations logged this month",
    definition: "Calls, meetings, visits, emails and asks logged against a person this calendar month, counted per officer from who logged them.",
    kind: "count" },
  { id: "threadBacklog",
    label: "Follow-ups open",
    definition: "Open follow-ups on each officer's own people, with the ones past their due date counted separately. A snoozed follow-up is not counted until it comes back.",
    kind: "count" },
];
export const METRIC_IDS = METRICS.map(m => m.id);
export function metric(id) { return METRICS.find(m => m.id === id) || null; }
export function definitionFor(id) { const m = metric(id); return m ? m.definition : ""; }

// A definition has to be a sentence somebody can read, which is a checkable
// property and not a matter of taste: long enough to say something, ending as a
// sentence, and never claiming anything from outside the org's own records.
const OUTSIDE = /\b(industry|benchmark|average nonprofit|similar organi[sz]ations|orgs like|national|typical(ly)? (donors|nonprofits)|peers)\b/i;
export function definitionProblems(m) {
  const out = [];
  const d = String((m && m.definition) || "");
  if (!d) out.push("no definition");
  if (d && d.length < 40) out.push("too short to define anything");
  if (d && !/[.!]$/.test(d.trim())) out.push("does not end as a sentence");
  if (OUTSIDE.test(d)) out.push("claims something from outside the org's own records");
  if (!m || !m.label) out.push("no label");
  if (!m || !["money", "count"].includes(m.kind)) out.push("no kind");
  return out;
}

// ── THE ASKED-VS-COMMITTED PAIR ───────────────────────────────────────────
// A ratio is offered ONLY when both halves are non-zero, and it is stated as a
// plain fraction of what was asked for rather than a "close rate" — a close rate
// implies a benchmark to beat and there is none here.
export function askedVsCommitted({ askedCents, committedCents }, formatMoney) {
  const fm = typeof formatMoney === "function" ? formatMoney : (v => String(v));
  const a = Number(askedCents) || 0, c = Number(committedCents) || 0;
  if (a === 0 && c === 0) return "Nothing asked for and nothing committed this year yet.";
  if (a === 0) return `${fm(c)} committed this year, from proposals that reached Asked before this year began.`;
  const pct = Math.round((c / a) * 100);
  return `${fm(c)} committed against ${fm(a)} asked for this year — ${pct}% of what you asked for.`;
}

// ── THE EMPTY STATE, WHICH HAS TO BE HONEST ───────────────────────────────
// An org with no proposals gets a sentence saying so, not a wall of $0 tiles
// pretending to be a measurement.
export function emptySentence({ proposalCount, officerCount }) {
  const p = Number(proposalCount) || 0;
  if (p > 0) return null;
  if ((Number(officerCount) || 0) <= 1) {
    return "No proposals on file yet. Open one from somebody's record and this screen starts answering questions about it.";
  }
  return "No proposals on file yet — every figure here would be zero, so nothing is shown. Open one from somebody's record.";
}

export function tileSentence(id, value, formatMoney) {
  const m = metric(id);
  if (!m) return "";
  const fm = typeof formatMoney === "function" ? formatMoney : (v => String(v));
  const shown = m.kind === "money" ? fm(Number(value) || 0) : String(Number(value) || 0);
  return `${shown}. ${m.definition}`;
}

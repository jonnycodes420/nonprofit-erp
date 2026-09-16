// shared/dashboards.js — BUILD-86 C.3. FOUR DASHBOARDS, FOUR QUESTIONS.
//
// The Dashboard tab became Dashboards: a left rail of four, each of which is
// ONE question a real person asks, answered on one screen and exportable as a
// PDF for a board packet.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: nothing appears on any dashboard
// without a one-sentence definition available on hover and printed in the PDF
// footnote. That is not documentation, it is the product's honesty contract —
// "stewardship debt" sat on a screen for two months and nobody, including the
// people who built it, could define it in a sentence a board member would
// accept. A number a board cannot define is a number it should not be shown.
//
// This registry is the ONE place a dashboard's shape is declared, and
// tests/dashboards.test.js walks it and fails the build on a missing
// definition. A metric added without one cannot reach a screen.
//
// Pure: no clock, no fetch, no DB. The server computes VALUES; this decides
// what exists, what it is called, and what it means.

// `rowsAre: "money"` on a breakdown says its ROWS are amounts. The renderer
// used to guess from magnitude (over a thousand, treat as money), which put a
// bare "500" directly under "$5,000" in the same column. A value's kind is
// declared, never inferred from how big it happens to be.
export const DASHBOARDS = [
  {
    key: "board",
    label: "Board",
    question: "How are we doing this year?",
    blurb: "The four things a board asks before it asks anything else.",
    metrics: [
      // BUILD-88a A.6 — GIVING, NOT REVENUE. "Revenue" is what a business calls
      // the money it takes in for the things it sells, and a nonprofit that
      // reads it on its own board screen starts answering to it. What Steward
      // counts is CONTRIBUTIONS: gifts. Earned income — a bookshop, a ticket, a
      // programme fee — is real money and Steward does not track it, so the
      // definition says so rather than letting the number be read as everything
      // the organisation brought in.
      { key: "revenueThisYear", label: "Giving this year", kind: "money",
        definition: "Every gift received between the first day of your fiscal year and today. Contributions only. Earned income like store sales or program fees is not tracked here." },
      { key: "revenueLastYear", label: "Same point last year", kind: "money",
        definition: "Gifts received in the equivalent stretch of your previous fiscal year, so the comparison is like for like." },
      { key: "revenueChangePct", label: "Change on last year", kind: "percent",
        definition: "This year's total against the same point last year, as a percentage. Blank when there is no prior year to compare with." },
      // A.6 — the org's OTHER income, when it keeps one. Off by default, one
      // figure somebody types, shown on its own line directly UNDER giving and
      // NEVER added to it: the moment the two are summed, the board is reading
      // a number Steward cannot stand behind, because only one half of it comes
      // from the gifts Steward actually holds.
      { key: "otherIncomeThisYear", label: "Other income this year", kind: "money", optional: true,
        definition: "A figure your organisation keeps elsewhere — earned income, a store, programme fees — typed in Settings. Steward does not track it and never adds it to giving; it is shown so the board can see both." },
      { key: "donorCount", label: "People who gave", kind: "count",
        definition: "Distinct givers with at least one gift this fiscal year." },
      { key: "retentionRate", label: "Retention", kind: "percent",
        definition: "Of the people who gave last fiscal year, the share who have given again this one. Blank until there is enough history for the number to mean anything." },
      { key: "byDesignation", rowsAre: "money", label: "Giving by designation", kind: "breakdown",
        definition: "This year's gifts grouped by the fund or programme they were given to. Gifts with no designation are counted as unrestricted." },
      { key: "recurringActive", label: "Monthly gifts giving", kind: "count",
        definition: "Monthly commitments currently charging successfully." },
      { key: "recurringStopped", label: "Stopped this quarter", kind: "count",
        definition: "Monthly commitments that ended this quarter, whether cancelled or exhausted after a failed card." },
      { key: "recurringRecovered", label: "Recovered this quarter", kind: "count",
        definition: "Monthly commitments that failed and then charged successfully again, this quarter." },
    ],
  },
  {
    key: "fundraising",
    label: "Fundraising",
    question: "Are we on pace?",
    blurb: "What is committed, what is in, and what closes next.",
    metrics: [
      { key: "goals", rowsAre: "money", label: "Goals and campaigns", kind: "breakdown",
        definition: "Every active goal with its target, what has been raised toward it, and whether that is ahead of or behind an even pace through the period." },
      { key: "pledgedOutstanding", label: "Pledged, not yet paid", kind: "money",
        definition: "The unpaid balance of open pledges. A pledge part-paid counts only the remainder." },
      { key: "pledgedPaid", label: "Pledged and paid", kind: "money",
        definition: "Payments received against pledges, whether or not the pledge is fully settled." },
      { key: "grantDeadlines", rowsAre: "money", label: "Grant deadlines, next 90 days", kind: "breakdown",
        definition: "Grants still being pursued whose deadline falls in the next ninety days. A grant already awarded or closed is not listed." },
      // TEAM ONLY. A shop with one executive director does not have a funnel,
      // and showing them an empty one teaches them the product is not for them.
      { key: "pipelineFunnel", label: "Pipeline", kind: "breakdown", teamOnly: true,
        definition: "Prospects assigned to an officer, grouped by the stage they are in." },
    ],
  },
  {
    key: "people",
    label: "People",
    question: "Who is carrying us?",
    blurb: "Drift's board-facing face, and the thank-yous still owed.",
    metrics: [
      { key: "concentration", label: "Share of giving from the top donors", kind: "breakdown",
        definition: "How few people it takes to reach ninety per cent of this year's giving, and who they are." },
      { key: "topDonors", rowsAre: "money", label: "Who they are", kind: "breakdown",
        definition: "The givers who make up that ninety per cent, largest first." },
      { key: "driftingAmongTop", label: "Drifting, among them", kind: "count",
        definition: "People inside that group who are past their own giving pattern. Drift measures each person against their own rhythm, never a fixed number of days." },
      { key: "milestonesThisQuarter", label: "Crossed a milestone this quarter", kind: "count",
        definition: "People whose lifetime giving passed a milestone amount this quarter." },
      // 0.6, ANSWERED. "Stewardship debt" was a weighted score nobody could
      // define; this is a COUNT with a start date, and the start date matters:
      // an imported file is history, and a thank-you is not owed for a gift
      // that arrived before the product did.
      { key: "giftsNotYetThanked", label: "Gifts not yet thanked", kind: "count",
        definition: "Gifts received since you started with Steward that have no thank-you logged." },
    ],
  },
  {
    key: "recurring",
    label: "Recurring",
    question: "Is the monthly base healthy?",
    blurb: "The screen a sponsorship-led organisation asks for by name.",
    metrics: [
      { key: "byStatus", label: "Monthly gifts by status", kind: "breakdown",
        definition: "Every monthly commitment grouped by where it stands: giving, failing, being recovered, paused, or ended." },
      { key: "mrr", label: "Monthly giving", kind: "money",
        definition: "What the currently-giving monthly commitments bring in each month. A commitment billed yearly counts as a twelfth of its amount." },
      { key: "mrrTrend", label: "Change this month", kind: "money",
        definition: "Monthly giving added by new commitments this month, less what was lost to ones that ended." },
      { key: "failuresCaught", label: "Failures caught", kind: "count",
        definition: "Monthly gifts whose card failed and which Steward began working, this quarter." },
      { key: "failuresRecovered", label: "Recovered", kind: "count",
        definition: "Of those, the ones that charged successfully again." },
      { key: "avgMonthsOnFile", label: "Average months on file", kind: "count",
        definition: "How long the currently-giving monthly commitments have been giving, averaged. Ended commitments are not counted." },
    ],
  },
];

export const DASHBOARD_KEYS = DASHBOARDS.map(d => d.key);
export const dashboardByKey = key => DASHBOARDS.find(d => d.key === key) || null;

// Every metric on every dashboard, flat — what the registry test walks.
export function allMetrics() {
  return DASHBOARDS.flatMap(d => d.metrics.map(m => ({ ...m, dashboard: d.key })));
}

export function definitionFor(dashboardKey, metricKey) {
  const d = dashboardByKey(dashboardKey);
  return d ? (d.metrics.find(m => m.key === metricKey)?.definition || null) : null;
}

// A definition is a SENTENCE somebody could say out loud, not a formula and
// not a label repeated back. The registry test holds these; they are here so
// the rule travels with the thing it governs.
export const DEFINITION_RULES = {
  minLength: 30,
  mustEndInPeriod: true,
  bannedOpeners: /^(the )?(number|count|total|sum|amount) of\b/i,
};

// shared/boardPack.js — REPORTS-3. THE BOARD PACK, DECLARED ONCE.
//
// The ED stops rebuilding the same report every month. This file is the ONE
// place that says what a board pack contains, what each number in it means,
// and which figure source each number is computed from. The server computes
// the VALUES (routes/crm.js composeBoardPack) and renders the PDF from that
// one composition, so the screen and the paper cannot disagree.
//
// Pure: no clock, no fetch, no DB.
//
// WHY THE DEFINITIONS ARE WRITTEN HERE AND NOT BORROWED FROM shared/dashboards.js.
// Every dashboard metric already carries a one-sentence definition, and the
// first instinct was to reuse those strings rather than keep a second copy.
// They cannot be reused: they are written for the FISCAL YEAR ("between the
// first day of your fiscal year and today"), and a board pack's period is a
// month or a quarter the org chose. Printing the fiscal-year sentence over a
// quarter's number would put a definition on the definitions page that the
// number does not obey, which is the one thing the definitions page exists to
// prevent. So a pack figure's definition is written for an ARBITRARY period,
// and the period's actual dates come from the source's own `sentence` beside
// it — the sentence figureSources.js composes from the parameters the value
// was really computed with.
//
// EVERY NUMBER IN HERE IS A FIGURE SOURCE. Not one of them is computed beside
// its rows: `source(w)` returns the `{key, params}` that figureSources.js
// aggregates and pages, which is what makes the one test possible — every
// number in the PDF can be re-asked of /figures/:source/rows and footed to the
// cent against the live report.

// A schedule runs monthly or quarterly. Nothing else: a board meets on one of
// those two rhythms, and a weekly board pack is a thing nobody asked for.
export const PACK_FREQUENCIES = ["monthly", "quarterly"];
// The period each frequency reports on: the last COMPLETE one, through
// orgPeriodBounds(org, PACK_PERIOD[freq], -1). A pack sent on the 5th is about
// the month that finished, never the five days of the one running.
export const PACK_PERIOD = { monthly: "month", quarterly: "quarter" };

// The filters a dashboard or a pack may carry. They are saved with the
// dashboard and live in the URL, so a dashboard opens, reloads and shares as
// the same numbers.
// PARITY-1 Part D — and a Group: gift figures count only its members' gifts.
export const FILTER_KEYS = ["from", "to", "fund", "campaign", "owner", "group"];
// A filter's name on a figure source. `owner` is the person a DONOR is
// assigned to, which every gifts-shaped source calls `assigned`.
export const FILTER_PARAM = { fund: "fund", campaign: "campaign", owner: "assigned", group: "group" };

// A tile on a saved dashboard is one of three things, and each one already
// exists somewhere in the product. Nothing here invents a fourth.
export const TILE_KINDS = ["figure", "chart", "list"];

// The one chart the product draws: giving month by month, this year against
// last. It is the board dashboard's `givingByMonth` series and is rendered by
// the same component.
export const CHART_KEYS = ["givingByMonth"];

// ── THE DEFAULT BOARD PACK ─────────────────────────────────────────────────
// Six sections, in the order a board reads them. `source(w)` is given the
// window the pack was asked for: { from, to, prev: {from,to}|null, filters }.
// A figure whose `source` returns null is a figure this period cannot answer
// (no prior year to compare with), and it prints as a blank with the sentence
// that says so rather than as a zero.
const filt = w => {
  const p = {};
  for (const k of ["fund", "campaign", "owner", "group"]) if (w.filters && w.filters[k]) p[FILTER_PARAM[k]] = w.filters[k];
  return p;
};
const win = w => ({ from: w.from, to: w.to, ...filt(w) });

export const PACK_SECTIONS = [
  {
    key: "giving",
    title: "Giving this period against last year",
    kind: "figures",
    figures: [
      { key: "givingThisPeriod", label: "Giving this period", kind: "money",
        definition: "Every gift dated in the period this pack covers. Contributions only. Earned income like store sales or programme fees is not tracked here.",
        source: w => ({ key: "gifts", params: win(w) }) },
      { key: "givingLastYear", label: "The same period last year", kind: "money",
        definition: "Gifts dated in the equivalent stretch of the previous year, so the comparison is like for like.",
        source: w => w.prev ? ({ key: "gifts", params: { from: w.prev.from, to: w.prev.to, ...filt(w) } }) : null },
      { key: "givingChangePct", label: "Change on last year", kind: "percent",
        definition: "This period's giving against the same period last year, as a percentage. Blank when there is no prior year to compare with.",
        source: w => w.prev ? ({ key: "giving-change", params: { from: w.from, to: w.to, prevFrom: w.prev.from, prevTo: w.prev.to } }) : null },
      { key: "giftCount", label: "Gifts", kind: "count",
        definition: "How many gifts were dated in the period this pack covers.",
        source: w => ({ key: "gifts", params: { ...win(w), measure: "count" } }) },
    ],
  },
  {
    key: "people",
    title: "Donors and retention",
    kind: "figures",
    figures: [
      { key: "donorCount", label: "People who gave", kind: "count",
        definition: "Distinct givers with at least one gift dated in the period this pack covers.",
        source: w => ({ key: "givers", params: { from: w.from, to: w.to } }) },
      { key: "retentionRate", label: "Retention", kind: "percent",
        definition: "Of the people who gave last calendar year, the share who have given again this one. It is a calendar-year measure and does not move with the period this pack covers. Blank until there is enough history for the number to mean anything.",
        source: () => ({ key: "retention", params: {} }) },
    ],
  },
  {
    key: "topGifts",
    title: "Top gifts",
    kind: "list",
    definition: "The largest gifts dated in the period this pack covers, biggest first. The total is every gift in the period, not only the ones printed.",
    limit: 10,
    source: w => ({ key: "gifts", params: { ...win(w), order: "amount" } }),
  },
  {
    key: "campaigns",
    title: "Campaign progress",
    kind: "goals",
    definition: "Every active goal with its target and what has been raised toward it. A goal keeps its own period, so these figures do not move with the period this pack covers.",
  },
  {
    key: "volunteers",
    title: "Volunteer hours",
    kind: "figures",
    figures: [
      { key: "volunteerHours", label: "Volunteer hours", kind: "count", suffix: "hours",
        definition: "Hours recorded on volunteer shifts dated in the period this pack covers, added up.",
        source: w => ({ key: "volunteer-hours", params: { from: w.from, to: w.to } }) },
      { key: "volunteerCount", label: "People who volunteered", kind: "count",
        definition: "Distinct people with at least one volunteer shift dated in the period this pack covers.",
        source: w => ({ key: "volunteers-served", params: { from: w.from, to: w.to } }) },
    ],
  },
];

export const packSectionByKey = key => PACK_SECTIONS.find(s => s.key === key) || null;

// Every figure the default pack declares, flat. The definitions page walks
// this, and so does the one test.
export function packFigureDefs() {
  return PACK_SECTIONS.filter(s => s.kind === "figures").flatMap(s => s.figures.map(f => ({ ...f, section: s.key })));
}

// ── A SAVED DASHBOARD ──────────────────────────────────────────────────────
// A name, the tiles she picked, the order she put them in, the filters she
// chose, and whether the team can see it. Validated here so a hostile or
// mistyped payload cannot invent a tile kind, a chart or a filter.
export const MAX_TILES = 12;
export const DASHBOARD_NAME_MAX = 120;

export function validateDashboard(raw) {
  const errors = [];
  const name = String(raw && raw.name || "").trim().slice(0, DASHBOARD_NAME_MAX);
  if (!name) errors.push("Give the dashboard a name.");
  const tilesIn = Array.isArray(raw && raw.tiles) ? raw.tiles : [];
  if (!tilesIn.length) errors.push("Pick at least one tile.");
  if (tilesIn.length > MAX_TILES) errors.push(`A dashboard holds at most ${MAX_TILES} tiles.`);
  const tiles = [];
  for (const t of tilesIn.slice(0, MAX_TILES)) {
    const kind = String(t && t.kind || "");
    if (!TILE_KINDS.includes(kind)) { errors.push(`"${kind || "that"}" is not a kind of tile.`); continue; }
    if (kind === "figure") {
      const source = String(t.source || "");
      if (!source) { errors.push("A number tile names the figure it shows."); continue; }
      tiles.push({ kind, source, params: plainParams(t.params) });
    } else if (kind === "chart") {
      const chart = String(t.chart || "");
      if (!CHART_KEYS.includes(chart)) { errors.push(`"${chart || "that"}" is not a chart Steward draws.`); continue; }
      tiles.push({ kind, chart });
    } else {
      const report = String(t.report || "");
      if (!report) { errors.push("A list tile names the report it shows."); continue; }
      const limit = Math.min(50, Math.max(1, parseInt(t.limit, 10) || 10));
      tiles.push({ kind, report, limit });
    }
  }
  const filters = {};
  for (const k of FILTER_KEYS) {
    const v = raw && raw.filters ? raw.filters[k] : undefined;
    if (v === undefined || v === null || v === "") continue;
    filters[k] = String(v).slice(0, 64);
  }
  if ((filters.from && !filters.to) || (filters.to && !filters.from)) errors.push("A date range needs both a start and an end.");
  return { ok: errors.length === 0, errors, value: { name, tiles, filters, shared: raw && raw.shared === true } };
}

// Only strings and numbers survive, so a tile's saved params cannot carry an
// object a source would then have to guess at.
function plainParams(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    out[String(k).slice(0, 32)] = String(v).slice(0, 64);
  }
  return out;
}

// The filters a tile can actually honour, given its source's declared params.
// A dashboard filtered by fund over a tile whose source has no fund says so on
// the tile — the number is not quietly left unnarrowed under a heading that
// claims it was narrowed.
export function filtersHonoured(sourceParams, filters) {
  const honoured = [], ignored = [];
  for (const k of ["fund", "campaign", "owner"]) {
    if (!filters || !filters[k]) continue;
    (sourceParams && sourceParams[FILTER_PARAM[k]] ? honoured : ignored).push(k);
  }
  return { honoured, ignored };
}

export const FILTER_WORD = { fund: "fund", campaign: "campaign", owner: "owner" };

/** "This number is not narrowed by fund." — said on the tile, never implied. */
export function ignoredFilterSentence(ignored) {
  if (!ignored || !ignored.length) return null;
  const words = ignored.map(k => FILTER_WORD[k] || k);
  const list = words.length === 1 ? words[0]
    : words.length === 2 ? `${words[0]} or ${words[1]}`
    : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
  return `This number is not narrowed by ${list}.`;
}

// ── THE SCHEDULE ───────────────────────────────────────────────────────────
// Off until somebody turns it on. A day of the month between 1 and 28, because
// 29, 30 and 31 do not exist in every month and a board pack that silently
// skips February is a board pack nobody trusts.
export const SCHEDULE_DAY_MIN = 1;
export const SCHEDULE_DAY_MAX = 28;

export function validateSchedule(raw) {
  const errors = [];
  const frequency = String(raw && raw.frequency || "");
  if (!PACK_FREQUENCIES.includes(frequency)) errors.push("A board pack goes out monthly or quarterly.");
  const day = parseInt(raw && raw.dayOfMonth, 10);
  if (!Number.isFinite(day) || day < SCHEDULE_DAY_MIN || day > SCHEDULE_DAY_MAX) {
    errors.push(`Pick a day of the month between ${SCHEDULE_DAY_MIN} and ${SCHEDULE_DAY_MAX}.`);
  }
  return { ok: errors.length === 0, errors,
    value: { frequency, dayOfMonth: day, enabled: raw && raw.enabled === true, dashboardId: raw && raw.dashboardId ? String(raw.dashboardId).slice(0, 64) : null } };
}

// Is today the day? The org's own civil date decides, and a quarterly pack
// goes out in the month after a quarter ends — the month holding the day she
// picked, in the first month of the new quarter.
export function isSendDay(schedule, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  if (!m || !schedule) return false;
  const month = parseInt(m[2], 10), day = parseInt(m[3], 10);
  if (day !== Number(schedule.dayOfMonth)) return false;
  if (schedule.frequency === "monthly") return true;
  // Quarterly: January, April, July, October — the month after each calendar
  // quarter closes.
  return schedule.frequency === "quarterly" && [1, 4, 7, 10].includes(month);
}

/** The ledger key: one send per schedule per period, ever. */
export function periodKeyFor(frequency, periodKey) {
  return `${frequency === "quarterly" ? "q" : "m"}:${String(periodKey || "").replace(/^[a-z]+:/, "")}`;
}

export const SCHEDULE_OFF_SENTENCE = "The schedule is off. Nothing is sent until you turn it on.";

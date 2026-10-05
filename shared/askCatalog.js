// shared/askCatalog.js · ASK-2. WHAT CAN BE ASKED, DEFINED ONCE.
//
// The free box ("Or ask your own question") turns a question into a TYPED
// PLAN: a metric, a period, what to compare it with, what to break it down
// by, and filters. The plan may only name what this catalog defines. Steward
// validates the plan here and runs it with its own code (askEngine.js); the
// model never writes SQL and never states a number. Anything outside the
// catalog is refused in one sentence ("Steward can't break giving down by
// donor age yet") and logged, never guessed.
//
// Two ways to a plan, one check:
//   templatePlan   AI off (or no model): phrase recognisers for the common
//                  questions. A word left over that no recogniser used and
//                  that is not a plain connecting word means NO plan.
//   modelPlan      AI on: the model fills planTool()'s strict schema, whose
//                  enums ARE this catalog.
// Both go through validatePlan. A follow-up ("and last year?", "only monthly
// donors", "who are they?") is followUp(previousPlan, text): it changes one
// thing about the last plan.
//
// Pure: no DB, no network, no clock (today comes in), no JSX. House style for
// the words: no colons, no em dashes.

// ── METRICS ────────────────────────────────────────────────────────────────
// `base: "gifts"` metrics are computed by the engine from one gift set (so
// they compare, break down and filter); the others are an existing figure
// source, computed once, the same number every other screen shows.
export const METRICS = {
  raised:          { label: "Amount raised", kind: "money", base: "gifts", word: "raised",
    sentence: "Every gift in the period, with any refund subtracted." },
  gift_count:      { label: "Gifts", kind: "count", base: "gifts", word: "gifts", unit: ["gift", "gifts"],
    sentence: "Each gift in the period, refunds not counted as gifts." },
  donor_count:     { label: "Donors", kind: "count", base: "gifts", word: "donors", unit: ["donor", "donors"],
    sentence: "Each person with at least one gift in the period, counted once." },
  average_gift:    { label: "Average gift", kind: "money", base: "gifts", word: "average gift",
    sentence: "The gifts in the period added up and divided by how many there are, to the cent." },
  median_gift:     { label: "Median gift", kind: "money", base: "gifts", word: "median gift",
    sentence: "The gift in the middle when every gift in the period is put in order (the two middle gifts averaged when there is an even number)." },
  largest_gift:    { label: "Largest gift", kind: "money", base: "gifts", word: "largest gift",
    sentence: "The single largest gift in the period." },
  new_donor_count: { label: "New donors", kind: "count", base: "gifts", word: "new donors", unit: ["new donor", "new donors"],
    sentence: "Each person whose first gift ever is dated in the period." },
  recaptured_count: { label: "Came back", kind: "count", base: "gifts", unit: ["donor who came back", "donors who came back"],
    sentence: "Each person whose first gift in the period came after twelve months or more with no gift." },
  retention_rate:  { label: "Retention", kind: "percent", base: "source", source: "retention", noPeriod: "this_year",
    sentence: "Of the people who gave last calendar year, the share who have given again this one." },
  first_year_retention: { label: "First-year retention", kind: "percent", base: "gifts", noPeriod: "this_year",
    sentence: "Of the people whose first gift ever was last calendar year, the share who have given again this one." },
  lapsed_count:    { label: "Lapsed donors", kind: "count", base: "donors", noPeriod: "today", unit: ["lapsed donor", "lapsed donors"],
    sentence: "Each person tagged Lapsed today: they gave before and nothing in the last twelve months." },
  recurring_monthly_value: { label: "Monthly giving", kind: "money", base: "source", source: "recurring-monthly", noPeriod: "today",
    sentence: "Every monthly gift charging successfully today, at what it brings in each month. A yearly gift counts as a twelfth of its amount." },
  recurring_donors: { label: "Monthly donors", kind: "count", base: "donors", noPeriod: "today", unit: ["monthly donor", "monthly donors"],
    sentence: "Each person with a monthly gift running today." },
  pledged_outstanding: { label: "Pledged, not yet paid", kind: "money", base: "source", source: "pledges-open", noPeriod: "today",
    sentence: "Every open pledge, at what is still to come on it." },
  volunteer_count: { label: "Active volunteers", kind: "count", base: "donors", noPeriod: "today", unit: ["active volunteer", "active volunteers"],
    sentence: "Each volunteer with an hour logged in the last twelve months or a shift still to come." },
  volunteer_hours: { label: "Volunteer hours", kind: "hours", base: "source", source: "volunteer-hours",
    sentence: "Every volunteer shift logged in the period, added up." },
  event_revenue:   { label: "Event revenue", kind: "money", base: "gifts", needs: "event", word: "raised",
    sentence: "Every gift recorded against the event, with any refund subtracted." },
  campaign_progress: { label: "Progress to goal", kind: "percent", base: "source", source: "goal-progress", needs: "campaign", noPeriod: "campaign",
    sentence: "What has been raised toward the campaign's goal, as a share of its target." },
};
export const METRIC_KEYS = Object.keys(METRICS);

// ── DIMENSIONS (what a gift-set metric can be broken down by) ──────────────
export const DIMENSIONS = {
  year: "year", month: "month", quarter: "quarter", fund: "fund", campaign: "campaign", appeal: "campaign",
  event: "event", source: "giving source", payment_method: "payment method", level: "giving level",
  lifecycle: "lifecycle", city: "city", state: "state", owner: "owner", tag: "tag",
};
export const DIMENSION_KEYS = Object.keys(DIMENSIONS);

// ── PERIODS ────────────────────────────────────────────────────────────────
export const PERIOD_KINDS = ["this_month", "last_month", "month", "this_quarter", "last_quarter", "this_year", "last_year",
  "year", "this_fiscal_year", "last_fiscal_year", "last_12_months", "this_week", "all_time", "custom"];
export const COMPARE_KINDS = ["last_year", "previous_period"];

// The plan's filters: the gift's own attributes, plus the one shared donor
// filter (groups.js RULE_KEYS, passed in) for the people.
export const GIFT_FILTERS = ["fund", "campaign", "event", "payment_method", "donor"];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const pad = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const minusYear = s => { const p = parse(s); return ymd(p.y - 1, p.m, Math.min(p.d, lastDay(p.y - 1, p.m))); };
const addDays = (s, n) => { const p = parse(s); const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.UTC(parse(b).y, parse(b).m - 1, parse(b).d) - Date.UTC(parse(a).y, parse(a).m - 1, parse(a).d)) / 864e5);

// A period in the org's calendar: { from, to, label, toDate }. `toDate` is
// true when the period runs to today (so a comparison stops at the same day).
export function resolvePeriod(period, ctx) {
  const t = parse(ctx.today);
  const fyM = ctx.fyStartMonth || 1;
  const p = period || { kind: "this_year" };
  const fyStartYear = t.m >= fyM ? t.y : t.y - 1;
  const monthName = (y, m) => `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
  switch (p.kind) {
    case "this_month": return { from: ymd(t.y, t.m, 1), to: ctx.today, label: monthName(t.y, t.m), toDate: true };
    case "last_month": { const y = t.m === 1 ? t.y - 1 : t.y, m = t.m === 1 ? 12 : t.m - 1; return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)), label: monthName(y, m) }; }
    case "month": {
      const m = Number(p.month);
      let y = p.year ? Number(p.year) : (m <= t.m ? t.y : t.y - 1);
      if (y === t.y && m === t.m) return { from: ymd(y, m, 1), to: ctx.today, label: monthName(y, m), toDate: true };
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)), label: monthName(y, m) };
    }
    case "this_quarter": { const q = Math.floor((t.m - 1) / 3); return { from: ymd(t.y, q * 3 + 1, 1), to: ctx.today, label: `Q${q + 1} ${t.y}`, toDate: true }; }
    case "last_quarter": { let q = Math.floor((t.m - 1) / 3) - 1, y = t.y; if (q < 0) { q = 3; y--; } return { from: ymd(y, q * 3 + 1, 1), to: ymd(y, q * 3 + 3, lastDay(y, q * 3 + 3)), label: `Q${q + 1} ${y}` }; }
    case "this_year": return { from: ymd(t.y, 1, 1), to: ctx.today, label: `${t.y} so far`, toDate: true };
    case "last_year": return { from: ymd(t.y - 1, 1, 1), to: ymd(t.y - 1, 12, 31), label: String(t.y - 1) };
    case "year": { const y = Number(p.year); return y === t.y ? { from: ymd(y, 1, 1), to: ctx.today, label: `${y} so far`, toDate: true } : { from: ymd(y, 1, 1), to: ymd(y, 12, 31), label: String(y) }; }
    case "this_fiscal_year": return { from: ymd(fyStartYear, fyM, 1), to: ctx.today, label: `this fiscal year (from ${monthName(fyStartYear, fyM)})`, toDate: true };
    case "last_fiscal_year": return { from: ymd(fyStartYear - 1, fyM, 1), to: addDays(ymd(fyStartYear, fyM, 1), -1), label: `last fiscal year (from ${monthName(fyStartYear - 1, fyM)})` };
    case "last_12_months": return { from: addDays(minusYear(ctx.today), 1), to: ctx.today, label: "the last twelve months", toDate: true };
    case "this_week": { const dow = (new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay() + 6) % 7; return { from: addDays(ctx.today, -dow), to: ctx.today, label: "this week", toDate: true }; }
    case "all_time": return { from: "1900-01-01", to: ctx.today, label: "all time", toDate: true };
    case "custom": return { from: p.from, to: p.to, label: `${p.from} to ${p.to}` };
    default: return null;
  }
}

// The span compared with: the same span a year earlier (a to-date period
// stops on the same day a year ago), or the span just before it.
export function resolveCompare(kind, cur) {
  if (!kind || !cur) return null;
  if (kind === "last_year") {
    const from = minusYear(cur.from), to = minusYear(cur.to);
    const lbl = /^\d{4}$/.test(cur.label) ? String(+cur.label - 1)
      : /^\d{4} so far$/.test(cur.label) ? `${+cur.label.slice(0, 4) - 1} to the same day`
      : /^(\w+) (\d{4})( so far)?$/.test(cur.label) ? cur.label.replace(/(\d{4})/, y => String(+y - 1)).replace(" so far", " to the same day")
      : `the same dates a year earlier`;
    return { from, to, label: lbl };
  }
  if (kind === "previous_period") {
    const n = daysBetween(cur.from, cur.to);
    const to = addDays(cur.from, -1);
    return { from: addDays(to, -n), to, label: "the period before" };
  }
  return null;
}

// ── THE CHECK ──────────────────────────────────────────────────────────────
// ctx: { ruleKeys, normalizeRules, funds:[{id,name}], campaigns:[{id,name}],
//        events:[{id,name}], today }. Returns { ok, plan } or { ok:false, refused }.
export function validatePlan(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, refused: "that question" };
  if (raw.unsupported) return { ok: false, refused: String(raw.unsupported).slice(0, 80) };
  const kind = raw.kind || "metric";
  if (!["metric", "who"].includes(kind)) return { ok: false, refused: "that kind of question" };
  const m = METRICS[raw.metric];
  if (!m) return { ok: false, refused: raw.metric ? `${String(raw.metric).replace(/_/g, " ")}` : "that measure" };
  const plan = { kind, metric: raw.metric };
  // Period.
  if (m.noPeriod) plan.period = { kind: m.noPeriod === "this_year" ? "this_year" : "today" };
  else {
    // An event's revenue is every gift recorded against it, whenever it came.
    const p = raw.period || { kind: m.needs === "event" ? "all_time" : "this_year" };
    if (!PERIOD_KINDS.includes(p.kind)) return { ok: false, refused: `the period "${String(p.kind).replace(/_/g, " ")}"` };
    if (p.kind === "month" && !(Number(p.month) >= 1 && Number(p.month) <= 12)) return { ok: false, refused: "that month" };
    if (p.kind === "year" && !(Number(p.year) >= 1990 && Number(p.year) <= 2100)) return { ok: false, refused: "that year" };
    if (p.kind === "custom" && !(parse(p.from) && parse(p.to) && p.from <= p.to)) return { ok: false, refused: "those dates" };
    plan.period = { kind: p.kind, ...(p.month ? { month: Number(p.month) } : {}), ...(p.year ? { year: Number(p.year) } : {}),
      ...(p.kind === "custom" ? { from: p.from, to: p.to } : {}) };
  }
  // Compare and break down: gift-set metrics only.
  if (raw.compare) {
    if (!COMPARE_KINDS.includes(raw.compare)) return { ok: false, refused: `comparing with ${raw.compare}` };
    if (m.base !== "gifts" || m.noPeriod) return { ok: false, refused: `comparing ${m.label.toLowerCase()} with another period` };
    plan.compare = raw.compare;
  }
  if (raw.groupBy) {
    if (!DIMENSIONS[raw.groupBy]) return { ok: false, refused: `breaking giving down by ${String(raw.groupBy).replace(/_/g, " ")}` };
    if (m.base !== "gifts" || m.noPeriod) return { ok: false, refused: `breaking ${m.label.toLowerCase()} down` };
    plan.groupBy = raw.groupBy === "appeal" ? "campaign" : raw.groupBy;
  }
  // Filters.
  const f = raw.filters || {};
  const filters = {};
  const known = (list, id) => (list || []).some(x => x.id === id);
  for (const k of Object.keys(f)) {
    const v = f[k];
    if (v === null || v === undefined || v === "") continue;
    if (k === "rules") continue;
    if (!GIFT_FILTERS.includes(k)) return { ok: false, refused: `filtering by ${String(k).replace(/_/g, " ")}` };
    if (k === "fund" && !known(ctx.funds, v)) return { ok: false, refused: "a fund Steward does not have" };
    if (k === "campaign" && !known(ctx.campaigns, v)) return { ok: false, refused: "a campaign Steward does not have" };
    if (k === "event" && !known(ctx.events, v)) return { ok: false, refused: "an event Steward does not have" };
    filters[k] = String(v);
  }
  if (m.needs && !filters[m.needs]) return { ok: false, refused: `${m.label.toLowerCase()} without naming the ${m.needs}` };
  if (f.rules && Object.keys(f.rules).length) {
    if (m.base === "source") return { ok: false, refused: `${m.label.toLowerCase()} for only some people` };
    for (const k of Object.keys(f.rules)) if (!(ctx.ruleKeys || []).includes(k)) return { ok: false, refused: `filtering by ${k}` };
    const n = ctx.normalizeRules ? ctx.normalizeRules(f.rules) : { ok: true, rules: f.rules };
    if (!n.ok) return { ok: false, refused: n.errors[0] };
    for (const k of Object.keys(f.rules)) if (n.rules[k] === undefined) return { ok: false, refused: k };
    filters.rules = n.rules;
  }
  if (m.base === "source" && Object.keys(filters).some(k => !(m.needs && k === m.needs))) return { ok: false, refused: `${m.label.toLowerCase()} for only part of the file` };
  if (Object.keys(filters).length) plan.filters = filters;
  if (raw.top !== undefined) {
    const n = Number(raw.top);
    if (!(Number.isInteger(n) && n >= 1 && n <= 200)) return { ok: false, refused: "that many people" };
    plan.top = n; plan.kind = "who";
  }
  if (kind === "who" && !["raised", "gift_count", "donor_count", "new_donor_count", "recaptured_count", "lapsed_count", "recurring_donors", "volunteer_count"].includes(plan.metric))
    return { ok: false, refused: `naming the people behind ${m.label.toLowerCase()}` };
  return { ok: true, plan };
}

// ── THE PLAN IN WORDS ──────────────────────────────────────────────────────
// "Amount raised · September 2026 · compared with September 2025 · by fund"
export function planWords(plan, ctx = {}) {
  const m = METRICS[plan.metric];
  const parts = [plan.kind === "who" ? `The people behind ${m.label.toLowerCase()}` : m.label];
  const cur = plan.period && plan.period.kind !== "today" ? resolvePeriod(plan.period, ctx) : null;
  if (cur) parts.push(cur.label);
  else if (plan.period && plan.period.kind === "today" && plan.metric !== "campaign_progress") parts.push("today");
  if (plan.compare && cur) parts.push(`compared with ${resolveCompare(plan.compare, cur).label}`);
  if (plan.groupBy) parts.push(`by ${DIMENSIONS[plan.groupBy]}`);
  const f = plan.filters || {};
  const nameOf = (list, id) => ((list || []).find(x => x.id === id) || {}).name || "one";
  if (f.fund) parts.push(`${nameOf(ctx.funds, f.fund)} only`);
  if (f.campaign) parts.push(`${nameOf(ctx.campaigns, f.campaign)}`);
  if (f.event) parts.push(`${nameOf(ctx.events, f.event)}`);
  if (f.payment_method) parts.push(`paid by ${f.payment_method}`);
  if (f.donor) parts.push(`one person`);
  if (f.rules) parts.push(...(ctx.ruleWords ? ctx.ruleWords(f.rules) : Object.keys(f.rules)));
  return parts.join(" · ");
}

// ── AI OFF: THE TEMPLATES ──────────────────────────────────────────────────
const FILLER = new Set(("how what what's whats is are was were did do does we our us i me my the a an of in for to on at from " +
  "much many have has had get got and so far with total all give given gave giving bring brought in come came per " +
  "it its it's that this there their they them please tell show give me let know number figure overall altogether " +
  "be been currently right now today about stand standing look looking like up who are which ones just only break " +
  "down most more people person donors donor single still outstanding raise doing go going").split(" "));

const MONTH_RE = new RegExp(`\\b(in |for |during )?(${MONTHS.join("|")}|${MON3.join("|")})\\b( (19|20)\\d{2})?`);

// ctx: { today, funds, campaigns, events, cities }
export function templatePlan(text, ctx = {}) {
  let s = " " + String(text || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[?.!]+/g, " ").replace(/\s+/g, " ") + " ";
  const out = { kind: "metric", filters: {} };
  const rules = {};
  let unsupported = null;
  // `putBack` is text a recogniser read and gave back (a place that is not a
  // city on file): it rejoins the question AFTER the replace, never inside it.
  let putBack = "";
  const take = (re, fn) => { re.lastIndex = 0; const hit = re.test(s); re.lastIndex = 0; if (hit) { s = s.replace(re, (...a) => { fn(...a); return " "; }); s += putBack; putBack = ""; } return hit; };
  let saidByName = false;
  const say = w => { saidByName = true; unsupported = unsupported ? `${unsupported}, ${w}` : w; };

  // Things the catalog cannot do, said by name.
  take(/\b(break(ing)? (giving|it|donations|gifts) down |split (giving|it) )?by (donor )?(age|gender|income|ethnicity|race|religion|zip code|zip|postcode|birthday)\b/g, (...a) => say(`breaking giving down by donor ${a[6]}`));
  take(/\b(weather|forecast|stock market|economy)\b/g, (m, w) => say(`the ${w}`));

  // A phrase that names a metric outright, before "each month" is read as a breakdown.
  take(/\b(in )?(recurring|monthly) gifts (each|a|per) month\b|\bwhat'?s that a month\b/g, () => { out.metric = out.metric || "recurring_monthly_value"; out._also = true; });
  // Compare.
  take(/\b(this year )?(vs\.?|versus|compared (with|to)|against) (last year|the same time last year|a year ago)\b/g, () => { out.compare = "last_year"; });
  take(/\b(this year|year) over year\b/g, () => { out.compare = "last_year"; });
  take(/\bthan last year\b/g, () => { out.compare = "last_year"; });
  // Break down.
  take(/\b(broken down |split |broken out )?(by|per|for each|each) (fund|month|quarter|campaign|appeal|event|payment method|method|source|giving source|city|town|state|owner|level|giving level|lifecycle|tag)s?\b/g, (...a) => {
    const w = a[3];
    out.groupBy = { town: "city", method: "payment_method", "payment method": "payment_method", "giving source": "source", "giving level": "level" }[w] || w;
  });
  if (/\bgiving by month\b/.test(s)) out.groupBy = "month";

  // The people: "top 20 donors", "who gave for the first time".
  take(/\b(my |our |the )?top (\d{1,3}) (donors|givers|supporters)\b/g, (m, a, n) => { out.top = Number(n); out.kind = "who"; out.metric = "raised"; });
  take(/\bwho gave for the first time\b|\bgave for the first time\b/g, () => { out.kind = /\bwho\b/.test(String(text).toLowerCase()) ? "who" : "metric"; out.metric = "new_donor_count"; });
  take(/\bwhich (campaign|appeal|fund|event)s? (raised|brought in|did) (the )?(most|best)\b/g, (m, w) => { out.groupBy = w === "appeal" ? "campaign" : w; out.metric = "raised"; });
  take(/\b(how many )?(lapsed donors|donors|people) (came|come|have come|who came) back\b|\b(how many )?(were )?(won|brought) back\b/g, () => { out.metric = "recaptured_count"; });
  take(/\bhow has (their|his|her) giving changed\b|\btheir giving over (the )?years\b/g, () => { out.metric = "raised"; out.groupBy = "year"; out.period = { kind: "all_time" }; });
  take(/\bhow many active volunteers\b|\bactive volunteers\b/g, () => { out.metric = "volunteer_count"; });
  take(/^\s*who (gave|has given|donated|gives)\b/g, () => { out.kind = "who"; out.metric = out.metric || "donor_count"; });

  // Gift filters: a fund, a campaign or an event named by its words.
  const named = (list, words) => {
    const ws = words.split(/\s+/).filter(w => w.length > 1 && !/^(the|our|fund|campaign|appeal|event)$/.test(w));
    if (!ws.length) return null;
    const hits = (list || []).filter(x => ws.every(w => String(x.name || "").toLowerCase().includes(w)));
    hits.sort((a, b) => String(b.startDate || b.date || "").localeCompare(String(a.startDate || a.date || "")));
    return hits[0] || null;
  };
  for (const f of ctx.funds || []) {
    const key = String(f.name).toLowerCase().replace(/ fund$/, "");
    if (s.includes(key)) { out.filters.fund = f.id; s = s.replace(new RegExp(`\\b(for |to |in )?(the )?${key.replace(/[^a-z0-9 ]/g, ".")}( fund)?\\b`, "g"), " "); }
  }
  for (const c of ctx.campaigns || []) {
    const key = String(c.name).toLowerCase();
    if (s.includes(key)) { out.filters.campaign = c.id; s = s.replace(key, " "); }
  }
  for (const e of ctx.events || []) {
    const key = String(e.name).toLowerCase();
    if (s.includes(key)) { out.filters.event = e.id; s = s.replace(key, " "); }
  }
  take(/\b(the )?(gala|supper|run|5k|dinner|auction)\b/g, (m, a, w) => {
    const ev = named(ctx.events, w);
    if (ev) out.filters.event = ev.id; else say(`the ${w}`);
  });
  if (!out.filters.campaign && !out.filters.fund) {
    take(/\b(to|for|in|from) (the )?([a-z0-9' -]{3,40}?) (campaign|appeal|drive)\b/g, (m, a, b, w, kind) => {
      const c = named(ctx.campaigns, `${w} ${kind === "campaign" ? "" : kind}`);
      if (c) out.filters.campaign = c.id; else say(`the ${w} ${kind}`);
    });
    take(/\b(to|for) the ([a-z0-9' -]{3,40}?)(?= this| last| in| so|$| \?)/g, (m, a, w) => {
      const c = named(ctx.campaigns, w);
      if (c) out.filters.campaign = c.id; else putBack += ` to the ${w} `;
    });
  }
  // An event named in full (with its year) is the event, not its campaign.
  if (out.filters.campaign && !out.filters.event) {
    const c = (ctx.campaigns || []).find(x => x.id === out.filters.campaign);
    const ev = c && (ctx.events || []).find(e => String(e.name).toLowerCase() === String(c.name).toLowerCase());
    if (ev && /\b(do|bring|revenue|night)\b/.test(String(text).toLowerCase())) { out.filters.event = ev.id; delete out.filters.campaign; }
  }

  // Periods.
  const P = v => { if (!out.period) { out.period = v; out._periodSaid = true; } };
  take(/\b(so far )?this fiscal year\b|\bfiscal year to date\b|\bthis fy\b/g, () => P({ kind: "this_fiscal_year" }));
  take(/\blast fiscal year\b/g, () => P({ kind: "last_fiscal_year" }));
  take(/\b(so far )?this year( so far)?\b|\byear to date\b|\bytd\b/g, () => P({ kind: "this_year" }));
  take(/\blast year\b/g, () => P({ kind: "last_year" }));
  take(/\bthis month\b/g, () => P({ kind: "this_month" }));
  take(/\blast month\b/g, () => P({ kind: "last_month" }));
  take(/\bthis quarter\b/g, () => P({ kind: "this_quarter" }));
  take(/\blast quarter\b/g, () => P({ kind: "last_quarter" }));
  take(/\bthis week\b/g, () => P({ kind: "this_week" }));
  take(/\b(in the )?(last|past) (12|twelve) months\b/g, () => P({ kind: "last_12_months" }));
  take(/\b(ever|all time|of all time)\b/g, () => P({ kind: "all_time" }));
  take(MONTH_RE, (m, a, mon, y) => { const i = MONTHS.indexOf(mon) >= 0 ? MONTHS.indexOf(mon) : MON3.indexOf(mon); P({ kind: "month", month: i + 1, ...(y ? { year: Number(y) } : {}) }); });
  take(/\b(in |during )?((19|20)\d{2})\b/g, (m, a, y) => P({ kind: "year", year: Number(y) }));

  // People filters (the one shared filter's rules).
  take(/\b(monthly|recurring) (donors?|givers?)\b|\bonly monthly\b|\bmonthly ones\b/g, () => { rules.monthly = "1"; out._who = "monthly"; });
  take(/\bmajor (donors?|givers?)\b/g, () => { rules.level = "major"; });
  take(/\bmid[- ]level (donors?|givers?)\b/g, () => { rules.level = "mid"; });
  take(/\b(who live |living |based )?in ([a-z][a-z'-]+(?: [a-z][a-z'-]+)?)\b/g, (m, a, place) => {
    const find = w => (ctx.cities || []).find(x => x.toLowerCase() === w);
    const c = find(place) || find(place.split(" ")[0]);
    if (c) { rules.city = c; if (find(place) !== c) putBack += ` ${place.split(" ").slice(1).join(" ")} `; }
    else putBack += ` in ${place} `;   // not a city on file: left for the others
  });

  // The metric.
  const M = v => { if (!out.metric) out.metric = v; };
  take(/\b(first[- ]year|first[- ]time donor) retention\b|\bfirst[- ]time donors? (who )?(gave|give|came back) again\b|\bhow many first[- ]time donors gave again\b/g, () => M("first_year_retention"));
  take(/\bretention( rate)?\b/g, () => M("retention_rate"));
  take(/\bprogress( to(ward)?s? (the |its )?goal)?\b|\bagainst (its|the) goal\b|\bto goal\b/g, () => M("campaign_progress"));
  take(/\b(volunteer(ed)? )?hours( volunteered)?\b/g, () => M("volunteer_hours"));
  take(/\b(pledged|pledges?)( and| but)?( still)? (outstanding|unpaid|owed|not yet paid|to come)\b|\boutstanding pledges?\b|\bhow much is pledged\b/g, () => M("pledged_outstanding"));
  take(/\bwhat'?s that a month\b|\b(a|per|each) month in (monthly|recurring) gifts\b|\bmonthly giving\b|\brecurring (giving|revenue|income)\b|\b(in )?recurring gifts each month\b/g, () => M("recurring_monthly_value"));
  take(/\bnew donors?\b|\bfirst[- ]time donors?\b/g, () => M("new_donor_count"));
  take(/\blapsed( donors?)?\b/g, () => M("lapsed_count"));
  take(/\baverage gift( size)?\b|\baverage donation\b/g, () => M("average_gift"));
  take(/\bmedian gift( size)?\b|\bmedian donation\b/g, () => M("median_gift"));
  take(/\b(largest|biggest|top) (single )?(gift|donation)\b/g, () => M("largest_gift"));
  take(/\bhow many (gifts|donations)\b|\bnumber of (gifts|donations)\b|\bgift count\b/g, () => M("gift_count"));
  take(/^\s*gifts\b/g, () => M("gift_count"));
  take(/\bhow many (people|donors|givers|supporters)( gave)?\b|\bnumber of donors\b|\bdonor count\b|\bhow many gave\b/g, () => M("donor_count"));
  take(/\bhow much (did we |have we |has |was |is )?(raise|raised|come in|came in|bring in|brought in|make|made|give|given)\b|\bhow much\b|\b(total )?(amount )?raised\b|\btotal giving\b|\b(revenue|income|giving|donations)\b|\bhow (did|is|was) (it|the [a-z0-9 -]+?) do(ing)?\b|\bhow did (it|we) do\b|\bbring in\b|\bcame in\b|\bcome in\b/g, () => M("raised"));
  if (out._who === "monthly" && /\bhow many\b/.test(String(text).toLowerCase()) && (!out.metric || out.metric === "donor_count")) { out.metric = "recurring_donors"; delete rules.monthly; }
  if (out._who === "monthly" && out.metric === "donor_count" && !out.period) { out.metric = "recurring_donors"; delete rules.monthly; }
  if (out.metric === "recurring_monthly_value" || out.metric === "recurring_donors") delete rules.monthly;
  delete out._who;
  if (out.filters.event && (!out.metric || out.metric === "raised") && !out.period) { out.metric = "event_revenue"; }
  // A question about an event means the whole event unless it names dates.
  if (out.filters.event && !out.period) out.period = { kind: "all_time" };
  if (out.filters.campaign && out.metric === "campaign_progress") out.period = undefined;
  // "how many monthly donors do we have and what's that a month" asks two:
  // the plan is the count, and the value rides along as a second metric.
  if (/\bhow many monthly donors\b/.test(String(text).toLowerCase()) && /\ba month\b/.test(String(text).toLowerCase())) { out.metric = "recurring_donors"; out.also = "recurring_monthly_value"; }
  delete out._also;
  const periodSaid = !!out._periodSaid; delete out._periodSaid;

  if (!out.metric && !saidByName && (out.compare || out.groupBy)) { out.metric = "raised"; if (!out.period) out.period = { kind: "this_year" }; }
  const left = s.split(/[\s,]+/).map(w => w.replace(/[^a-z0-9'$]/g, "")).filter(w => w && !FILLER.has(w));
  if (saidByName) return { plan: null, unsupported, named: true };
  if (!out.metric) return { plan: null, unsupported: unsupported || (left.length ? left.join(" ") : "that question") };
  if (left.length) unsupported = unsupported ? `${unsupported}, ${left.join(" ")}` : left.join(" ");
  if (Object.keys(rules).length) out.filters.rules = rules;
  if (!Object.keys(out.filters).length) delete out.filters;
  return { plan: unsupported ? null : (periodSaid ? Object.defineProperty(out, "_periodSaid", { value: true, enumerable: false }) : out), unsupported };
}

// ── FOLLOW-UPS ─────────────────────────────────────────────────────────────
// One change to the last plan: a period, a comparison, a breakdown, a people
// filter, or "who are they?". Null when the text is not a follow-up.
export function followUp(prev, text, ctx = {}) {
  if (!prev || !prev.metric) return null;
  const t = " " + String(text || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[?.!]+/g, " ").replace(/\s+/g, " ") + " ";
  const next = JSON.parse(JSON.stringify(prev));
  next.kind = prev.kind || "metric";
  let changed = false;
  if (/\b(who are they|who were they|who are those|which ones|name them|list them|show me them|show them|who)\b/.test(t) && t.trim().split(" ").length <= 5) {
    next.kind = "who"; delete next.compare; delete next.groupBy; return next;
  }
  const r = templatePlan(t.replace(/^ *(and|what about|how about|now|only|just)\b/, " "), ctx);
  const partial = r.plan || (() => {
    // A follow-up has no metric of its own: read it with the last plan's.
    const again = templatePlan(`${t} raised`, ctx);
    return again.plan;
  })();
  if (/\b(and|what about|how about)? ?(last year|the year before)\b/.test(t) && !/\bcompared|vs|versus|against\b/.test(t)) {
    const p = prev.period || { kind: "this_year" };
    if (p.kind === "month") next.period = { kind: "month", month: p.month, year: (p.year || resolveYear(p, ctx)) - 1 };
    else if (p.kind === "this_year") next.period = { kind: "last_year" };
    else if (p.kind === "year") next.period = { kind: "year", year: p.year - 1 };
    else if (p.kind === "this_fiscal_year") next.period = { kind: "last_fiscal_year" };
    else if (p.kind === "this_month") next.period = { kind: "month", month: Number(ctx.today.slice(5, 7)), year: Number(ctx.today.slice(0, 4)) - 1 };
    else next.period = { kind: "last_year" };
    changed = true;
  }
  if (/\b(compared (with|to)|vs\.?|versus|against) (last year|a year ago)\b/.test(t)) { next.compare = "last_year"; changed = true; }
  if (partial) {
    if (partial.groupBy) { next.groupBy = partial.groupBy; changed = true; }
    const pf = partial.filters || {};
    for (const k of GIFT_FILTERS) if (pf[k]) { next.filters = { ...(next.filters || {}), [k]: pf[k] }; changed = true; }
    if (pf.rules) { next.filters = { ...(next.filters || {}), rules: { ...((next.filters || {}).rules || {}), ...pf.rules } }; changed = true; }
    if (partial.period && partial._periodSaid && !/\blast year\b/.test(t)) { next.period = partial.period; changed = true; }
  }
  if (/\bmonthly donors?\b|\bonly monthly\b/.test(t) && !((next.filters || {}).rules || {}).monthly) {
    next.filters = { ...(next.filters || {}), rules: { ...((next.filters || {}).rules || {}), monthly: "1" } }; changed = true;
  }
  return changed ? next : null;
}
function resolveYear(p, ctx) {
  const t = parse(ctx.today);
  return Number(p.month) <= t.m ? t.y : t.y - 1;
}

// ── AI ON: THE MODEL FILLS A FORM ─────────────────────────────────────────
// The schema's enums ARE the catalog. `restatement` is the model's reading of
// the question in words; Steward strips any number from it before showing it.
export function planTool({ ruleKeys = [] } = {}) {
  const ruleProps = {};
  for (const k of ruleKeys) ruleProps[k] = { type: ["string", "null"] };
  return {
    name: "ask_plan",
    description: "The plan that answers a question about this organisation's giving. Use only these fields and values. Never guess: name anything they cannot express in unsupported.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["metric", "who"] },
        metric: { type: "string", enum: METRIC_KEYS },
        period: { type: ["object", "null"], additionalProperties: false, properties: {
          kind: { type: "string", enum: PERIOD_KINDS }, month: { type: ["integer", "null"] }, year: { type: ["integer", "null"] },
          from: { type: ["string", "null"] }, to: { type: ["string", "null"] } } },
        compare: { type: ["string", "null"], enum: [...COMPARE_KINDS, null] },
        groupBy: { type: ["string", "null"], enum: [...DIMENSION_KEYS, null] },
        filters: { type: ["object", "null"], additionalProperties: false, properties: {
          fund: { type: ["string", "null"] }, campaign: { type: ["string", "null"] }, event: { type: ["string", "null"] },
          payment_method: { type: ["string", "null"] },
          rules: { type: ["object", "null"], additionalProperties: false, properties: ruleProps } } },
        restatement: { type: ["string", "null"], description: "The question in plain words, with no numbers." },
        unsupported: { type: ["string", "null"], description: "Anything asked that these fields cannot express, in a few words. Null when all of it is covered." },
      },
      required: ["kind", "metric", "unsupported"],
    },
  };
}
export function planPrompt(question, ctx = {}, prev = null) {
  const list = (title, xs) => `${title}:\n${(xs || []).slice(0, 60).map(x => `${x.id}: ${x.name}`).join("\n") || "(none)"}`;
  return [
    "Turn this question about a nonprofit's giving into a plan, using the ask_plan tool. Never answer it yourself and never write a number.",
    `Today is ${ctx.today}. "This year" is the calendar year to date.`,
    "Metrics: " + METRIC_KEYS.map(k => `${k} (${METRICS[k].sentence})`).join("; "),
    list("Funds (id: name)", ctx.funds), list("Campaigns (id: name)", ctx.campaigns), list("Events (id: name)", ctx.events),
    prev ? `The question before this one was planned as ${JSON.stringify(prev)}. If this one follows on from it, change only what it asks to change.` : "",
    `Question: ${question}`,
  ].filter(Boolean).join("\n\n");
}
export function readPlanTool(content) {
  const b = (content || []).find(x => x && x.type === "tool_use" && x.name === "ask_plan");
  if (!b || !b.input || typeof b.input !== "object") return null;
  const raw = JSON.parse(JSON.stringify(b.input));
  const strip = o => { if (o && typeof o === "object") for (const k of Object.keys(o)) { if (o[k] === null) delete o[k]; else strip(o[k]); } };
  strip(raw);
  // A number the model wrote in its own words is never shown.
  if (raw.restatement) raw.restatement = String(raw.restatement).replace(/[$£€]?\d[\d,.]*%?/g, "").replace(/\s{2,}/g, " ").trim();
  return raw;
}

// ── THE REFUSAL ────────────────────────────────────────────────────────────
export function refusalSentence(what) {
  const w = String(what || "").trim();
  if (!w || w === "that question") return "Steward can't answer that one yet. We've noted it.";
  return `Steward can't answer ${/^(breaking|comparing|filtering|naming|the |that |a |an )/.test(w) ? w : `"${w}"`} yet. We've noted the question.`;
}

// The questions offered under the box when the org has asked nothing yet.
export const STARTERS = [
  "How much did we raise last month?",
  "Who are my top 20 donors this year?",
  "What's our retention rate?",
  "How many monthly donors do we have and what's that a month?",
  "This year vs last year by fund",
  "Who should I call tomorrow?",
];

// ── THE ANSWER IN ONE SENTENCE ─────────────────────────────────────────────
// Parts are text and figure references ({ fig: "value" }, { fig: "compare" },
// { fig: "change" }, { fig: "group0" }, { fig: "also" }); the client draws each
// reference as the <Figure> that opens its rows. `plain` is the same sentence
// as text, for the log and the tests. Every number in it is a figure.
const fmtMoney = v => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export function fmtFig(f) {
  if (!f || f.value === null || f.value === undefined) return "no figure yet";
  if (f.kind === "money") return fmtMoney(f.value);
  if (f.kind === "percent") return `${f.value}%`;
  return Number(f.value).toLocaleString("en-US") + (f.suffix || "");
}
export function answerSentence(a, plan, ctx = {}) {
  const P = [];
  const t = x => P.push(x), f = k => P.push({ fig: k });
  const L = a.period ? a.period.label : "";
  const per = !a.period ? "" : /so far$/.test(L) ? ` in ${L.replace(/ so far$/, "")} so far` : L === "all time" ? " ever" : /^(this|the|last) /.test(L) ? ` ${L}` : ` in ${L}`;
  const unit = (m, n) => (METRICS[m].unit ? METRICS[m].unit[n === 1 ? 0 : 1] : "");
  const v = a.value;
  const sc = a.scope || "";
  const per2 = sc && per === " ever" ? "" : per;
  if (plan.kind === "who" && a.people) {
    const n = a.peopleCount;
    if (!n) { t(`Nobody matches${per}.`); return pack(P, a); }
    if (plan.top) { t(`Your top ${Math.min(plan.top, n)} donors${per} gave `); f("value"); t(" between them; "); }
    else {
      const who = n === 1 ? "One person" : `${n.toLocaleString("en-US")} people`;
      const verb = { new_donor_count: "gave for the first time", recaptured_count: "came back", lapsed_count: n === 1 ? "is tagged Lapsed" : "are tagged Lapsed",
        recurring_donors: n === 1 ? "gives monthly" : "give monthly", volunteer_count: n === 1 ? "is an active volunteer" : "are active volunteers" }[plan.metric] || "gave";
      t(`${who} ${verb}${sc}${METRICS[plan.metric].noPeriod ? "" : per2}; `);
    }
    t(plan.top || !["lapsed_count", "recurring_donors", "volunteer_count"].includes(plan.metric) ? `${a.people[0].name} gave the most.` : `${a.people[0].name} is first on the list.`);
    return pack(P, a);
  }
  switch (plan.metric) {
    case "raised":
      if (a.donorName) { t(`${a.donorName} gave `); f("value"); t(per === " ever" ? " in all" : per); }
      else { t("You raised "); f("value"); t(sc + per2); }
      break;
    case "event_revenue": t(`${a.eventName || "The event"} brought in `); f("value"); break;
    case "gift_count": t("You received "); f("value"); t(` ${unit("gift_count", v.value)}${sc}${per2}`); break;
    case "donor_count": f("value"); t(` ${v.value === 1 ? "person" : "people"} gave${sc}${per2}`); break;
    case "new_donor_count": f("value"); t(` ${v.value === 1 ? "person" : "people"} gave for the first time${per}`); break;
    case "recaptured_count": f("value"); t(` ${v.value === 1 ? "person" : "people"} came back${per} after twelve months or more with no gift`); break;
    case "average_gift": t(`The average gift${per} was `); f("value"); break;
    case "median_gift": t(`The median gift${per} was `); f("value"); break;
    case "largest_gift": t(`The largest gift${per} was `); f("value"); if (a.largestFrom) t(`, from ${a.largestFrom}`); break;
    case "retention_rate": t("Retention is "); f("value"); t(": of everyone who gave last calendar year, that share has given again this one"); break;
    case "first_year_retention": t("Of the "); f("part1"); t(" people whose first gift was last calendar year, "); f("part0"); t(" have given again this year, "); f("value"); break;
    case "lapsed_count": f("value"); t(` ${v.value === 1 ? "person is" : "people are"} tagged Lapsed today`); break;
    case "recurring_donors": f("value"); t(` ${v.value === 1 ? "person gives" : "people give"} monthly`); if (a.also) { t(", bringing in "); f("also"); t(" a month"); } break;
    case "recurring_monthly_value": t("Monthly gifts bring in "); f("value"); t(" a month"); break;
    case "pledged_outstanding": f("value"); t(" is pledged and not yet paid"); break;
    case "volunteer_hours": t("Volunteers gave "); f("value"); t(per); break;
    case "volunteer_count": t("You have "); f("value"); t(` active ${v.value === 1 ? "volunteer" : "volunteers"}`); break;
    case "campaign_progress": t(`${(a.campaign || {}).name || "The campaign"} has raised `); f("part0"); t(" of its "); f("part1"); t(" goal, "); f("value"); break;
    default: f("value");
  }
  if (a.compare) {
    if (a.change === null || a.change === undefined) { t(", against "); f("compare"); t(` in ${a.comparePeriod.label}`); }
    else if (a.change === 0) { t(`, the same as ${a.comparePeriod.label} (`); f("compare"); t(")"); }
    else { t(a.change > 0 ? ", up " : ", down "); f("change"); t(` on ${a.comparePeriod.label} (`); f("compare"); t(")"); }
  }
  t(".");
  if (a.groups && a.groups.length && plan.groupBy !== "month" && plan.groupBy !== "quarter" && plan.groupBy !== "year") {
    t(` ${a.groups[0].key} leads with `); f("group0"); t(".");
  }
  return pack(P, a);
}
function pack(parts, a) {
  const figs = { value: a.value, compare: a.compare, change: a.changeFig, also: a.alsoFig, part0: (a.parts || [])[0], part1: (a.parts || [])[1],
    group0: a.groups && a.groups[0] ? a.groups[0].value : null };
  const plain = parts.map(p => (typeof p === "string" ? p : p.fig === "change" ? `${Math.abs(a.change)}%` : fmtFig(figs[p.fig]))).join("");
  return { parts, plain: plain.replace(/\s+\./g, ".").replace(/\.\./g, ".") };
}

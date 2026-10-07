// askEngine.js · ASK-2. A PLAN, RUN BY STEWARD'S OWN CODE.
//
// The plan comes from shared/askCatalog.js (a template or the model's form,
// validated there). This module reads the rows and computes every number
// from them, in cents. The same function serves the answer AND the figure
// source "ask" (figureSources.js), so a number on an answer and the rows it
// opens are one computation: they cannot disagree.
//
// A gift-set metric reads one gift set (period, gift filters, the shared
// donor filter) and is computed from it; a comparison is the same set for the
// other period; a breakdown splits the set by one dimension. A metric another
// screen already shows (retention, monthly giving, pledges, volunteer hours,
// campaign progress) is that screen's figure source, computed once.
//
// Read only. Org-scoped on every query. Nothing here writes.
const { query } = require("./db");
const money = require("./money");
const GR = require("./groups");
const DS = require("./donorStatus");
const orgTime = require("./orgTime");

let _cat = null;
const catMod = async () => (_cat = _cat || await import("./shared/askCatalog.js"));

const cents = v => money.toCents(String(v ?? "0")) ?? 0;
const dollars = c => money.toDollars(c);

// What a plan may name, for this org.
async function askContext(orgId) {
  const [org] = await query("SELECT timezone, vocabulary_json FROM orgs WHERE id = ?", [orgId]);
  const tz = org || {};
  const today = orgTime.orgToday(tz);
  const [funds, campaigns, events, cities] = await Promise.all([
    query("SELECT id, name FROM fin_funds WHERE org_id = ? ORDER BY name", [orgId]),
    // Email campaigns share the table; a giving campaign has no subject and was never sent.
    query(`SELECT id, name, start_date::text AS "startDate" FROM campaigns WHERE org_id = ? AND sent_at IS NULL AND COALESCE(subject,'') = ''
            ORDER BY start_date DESC NULLS LAST, name`, [orgId]),
    query("SELECT id, name, date::text AS date FROM events WHERE org_id = ? ORDER BY date DESC NULLS LAST", [orgId]),
    query(`SELECT DISTINCT trim(city) AS city FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(trim(city),'') <> '' LIMIT 2000`, [orgId]),
  ]);
  return { orgId, today, fyStartMonth: orgTime.orgFiscalStartMonth(tz), funds, campaigns, events,
    cities: cities.map(c => c.city), ruleKeys: GR.RULE_KEYS, normalizeRules: GR.normalizeRules };
}

// ── THE GIFT SET ───────────────────────────────────────────────────────────
async function giftSet(orgId, plan, span) {
  const f = plan.filters || {};
  const args = [orgId, span.from, span.to];
  let where = "";
  if (f.fund) { where += " AND g.fund_id = ?"; args.push(f.fund); }
  if (f.campaign) { where += " AND (g.campaign_id = ? OR g.campaign = (SELECT name FROM campaigns WHERE org_id = g.org_id AND id = ?))"; args.push(f.campaign, f.campaign); }
  if (f.event) { where += " AND g.event_id = ?"; args.push(f.event); }
  if (f.payment_method) { where += " AND lower(COALESCE(g.payment_method,'')) = lower(?)"; args.push(f.payment_method); }
  if (f.donor) { where += " AND g.donor_id = ?"; args.push(f.donor); }
  if (f.rules && Object.keys(f.rules).length) {
    const df = await GR.buildDonorFilter(orgId, { ...f.rules, notDeceased: undefined });
    if (df.badRole || df.badStatus) return [];
    where += ` AND g.donor_id IN (SELECT id FROM donors WHERE ${df.whereSql})`; args.push(...df.params);
  }
  return query(
    `SELECT g.id, g.donor_id, d.name, g.date::text AS date, ROUND(g.amount::numeric, 2)::text AS amount,
            COALESCE(fu.name, 'Unrestricted') AS fund, COALESCE(c.name, NULLIF(g.campaign, ''), 'No campaign') AS campaign,
            COALESCE(e.name, 'No event') AS event, COALESCE(NULLIF(g.payment_method, ''), 'Not recorded') AS payment_method,
            COALESCE(gs.display_name, 'Entered in Steward') AS source,
            COALESCE(NULLIF(trim(d.city), ''), 'No city') AS city, COALESCE(NULLIF(trim(d.state), ''), 'No state') AS state,
            COALESCE(NULLIF(d.assigned_to_name, ''), 'No owner') AS owner, d.tags
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds fu ON fu.id = g.fund_id AND fu.org_id = g.org_id
       LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
       LEFT JOIN events e ON e.id = g.event_id AND e.org_id = g.org_id
       LEFT JOIN giving_sources gs ON gs.id = g.giving_source_id AND gs.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?${where}`, args);
}

// The rows a donor-level metric counts, from the shared filter: the same
// rules the Donors list, a Group and the Volunteers screen read.
const DONOR_METRIC_RULES = {
  lapsed_count: { lifecycle: "lapsed", notDeceased: "1" },
  recurring_donors: { monthly: "1", notDeceased: "1" },
  volunteer_count: { role: "volunteer" },   // FIX-31: on the roster, the Volunteers tile's number
};
// The rows a donor-level metric counts (lapsed, monthly), from the shared filter.
async function donorRows(orgId, rules) {
  const df = await GR.buildDonorFilter(orgId, rules);
  if (df.badRole || df.badStatus) return [];
  return query(`SELECT id, id AS donor_id, name, last_gift_date AS date, ROUND(COALESCE(total_giving,0)::numeric,2)::text AS amount
                  FROM donors WHERE ${df.whereSql} ORDER BY total_giving DESC NULLS LAST, id`, df.params);
}

// ── A METRIC FROM ITS ROWS ─────────────────────────────────────────────────
// Returns { value, cents, measure, rows } where `rows` are exactly what the
// number is computed from (figure-source row shape).
const asRow = (r, detail) => ({ id: r.id, type: "gift", donor_id: r.donor_id, name: r.name, date: r.date, amount: r.amount, detail: detail || r.fund });
function byDonor(rows) {
  const m = new Map();
  for (const r of rows) {
    const x = m.get(r.donor_id) || { id: r.donor_id, type: "person", donor_id: r.donor_id, name: r.name, date: r.date, c: 0, n: 0 };
    x.c += cents(r.amount); x.n++; if (String(r.date) > String(x.date)) x.date = r.date;
    m.set(r.donor_id, x);
  }
  return [...m.values()].map(x => ({ id: x.id, type: "person", donor_id: x.donor_id, name: x.name, date: x.date,
    amount: String(dollars(x.c)), detail: `${x.n} ${x.n === 1 ? "gift" : "gifts"}` }))
    .sort((a, b) => cents(b.amount) - cents(a.amount) || String(a.id).localeCompare(String(b.id)));
}
async function computeGiftMetric(orgId, metric, rows, span) {
  const pos = rows.filter(r => cents(r.amount) > 0);
  switch (metric) {
    case "raised": case "event_revenue": {
      const c = rows.reduce((s, r) => s + cents(r.amount), 0);
      return { value: dollars(c), cents: c, measure: "sum", rows: rows.map(r => asRow(r)) };
    }
    case "gift_count": return { value: pos.length, measure: "count", rows: pos.map(r => asRow(r)) };
    case "donor_count": { const d = byDonor(pos); return { value: d.length, measure: "count", rows: d }; }
    case "average_gift": {
      const c = pos.reduce((s, r) => s + cents(r.amount), 0);
      const m = pos.length ? Math.round(c / pos.length) : 0;
      return { value: dollars(m), cents: m, measure: "mean", rows: pos.map(r => asRow(r)) };
    }
    case "median_gift": {
      const sorted = [...pos].sort((a, b) => cents(a.amount) - cents(b.amount) || String(a.id).localeCompare(String(b.id)));
      if (!sorted.length) return { value: 0, cents: 0, measure: "mean", rows: [] };
      const mid = sorted.length % 2 ? [sorted[(sorted.length - 1) / 2]] : [sorted[sorted.length / 2 - 1], sorted[sorted.length / 2]];
      const m = Math.round(mid.reduce((s, r) => s + cents(r.amount), 0) / mid.length);
      return { value: dollars(m), cents: m, measure: "mean", rows: mid.map(r => asRow(r, "The middle gift")) };
    }
    case "largest_gift": {
      const top = [...pos].sort((a, b) => cents(b.amount) - cents(a.amount) || String(a.id).localeCompare(String(b.id)))[0];
      return top ? { value: dollars(cents(top.amount)), cents: cents(top.amount), measure: "sum", rows: [asRow(top, "The largest gift")] }
        : { value: 0, cents: 0, measure: "sum", rows: [] };
    }
    case "new_donor_count": {
      const ids = [...new Set(pos.map(r => r.donor_id))];
      if (!ids.length) return { value: 0, measure: "count", rows: [] };
      const firsts = await query(`SELECT donor_id, MIN(date)::text AS first FROM gifts WHERE org_id = ? AND donor_id = ANY(?::text[]) AND amount > 0 GROUP BY donor_id`, [orgId, ids]);
      const firstOf = new Map(firsts.map(x => [x.donor_id, x.first]));
      const inSpan = x => !!x && (!span || (x >= span.from && x <= span.to));
      const d = byDonor(pos).filter(p => inSpan(String(firstOf.get(p.donor_id) || "").slice(0, 10)));
      return { value: d.length, measure: "count", rows: d.map(r => ({ ...r, detail: `First gift ${firstOf.get(r.donor_id)}` })) };
    }
    case "recaptured_count": {
      // Their first gift in the period, and the gift before it: twelve
      // months or more between the two is a donor who came back.
      const firstIn = new Map();
      for (const r of pos) { const d = String(r.date).slice(0, 10); if (!firstIn.has(r.donor_id) || d < firstIn.get(r.donor_id)) firstIn.set(r.donor_id, d); }
      const ids = [...firstIn.keys()];
      if (!ids.length) return { value: 0, measure: "count", rows: [] };
      const prev = await query(`SELECT g.donor_id, MAX(g.date)::text AS prev FROM gifts g JOIN unnest(?::text[], ?::text[]) AS f(id, first) ON f.id = g.donor_id
                                 WHERE g.org_id = ? AND g.amount > 0 AND LEFT(g.date,10) < f.first GROUP BY g.donor_id`, [ids, ids.map(i => firstIn.get(i)), orgId]);
      const back = new Map(prev.filter(x => { const f = firstIn.get(x.donor_id); const p = String(x.prev).slice(0, 10);
        const yr = new Date(Date.UTC(+f.slice(0, 4) - 1, +f.slice(5, 7) - 1, +f.slice(8, 10))).toISOString().slice(0, 10); return p < yr; }).map(x => [x.donor_id, String(x.prev).slice(0, 10)]));
      const d = byDonor(pos).filter(p => back.has(p.donor_id)).map(p => ({ ...p, detail: `Last gift before this ${back.get(p.donor_id)}` }));
      return { value: d.length, measure: "count", rows: d };
    }
    default: return null;
  }
}

// The dimension a row falls in.
async function dimensionOf(orgId, dim, rows, today) {
  if (dim === "year") return r => String(r.date).slice(0, 4);
  if (dim === "month") return r => String(r.date).slice(0, 7);
  if (dim === "quarter") return r => `${String(r.date).slice(0, 4)} Q${Math.floor((+String(r.date).slice(5, 7) - 1) / 3) + 1}`;
  if (dim === "tag") return r => { const t = Array.isArray(r.tags) ? r.tags : (() => { try { return JSON.parse(r.tags || "[]"); } catch { return []; } })(); return t.length ? t[0] : "No tag"; };
  if (dim === "level" || dim === "lifecycle") {
    const keys = Object.keys(dim === "level" ? DS.LEVELS : DS.LIFECYCLES);
    const cuts = await DS.cutsFor(orgId);
    const tagOf = new Map();
    const ids = [...new Set(rows.map(r => r.donor_id))];
    for (const k of keys) {
      const c = DS.tagCondition(k, orgId, today, cuts);
      if (!c || !ids.length) continue;
      const hit = await query(`SELECT id FROM donors WHERE org_id = ? AND id = ANY(?::text[]) AND ${c.sql}`, [orgId, ids, ...c.args]);
      for (const h of hit) if (!tagOf.has(h.id)) tagOf.set(h.id, DS.tagLabel(k));
    }
    return r => tagOf.get(r.donor_id) || "None";
  }
  return r => r[dim] || "None";
}

// ── RUN A PLAN ─────────────────────────────────────────────────────────────
// → { plan, words, value/compare/groups as figures, sentence, counted, step }
async function runPlan(orgId, plan, ctx, deps = {}) {
  const C = await catMod();
  const m = C.METRICS[plan.metric];
  const src = cell => ({ key: "ask", params: { plan: JSON.stringify(plan), cell } });
  const fig = (cell, r, label) => ({ label, value: r.value, kind: m.kind === "money" ? "money" : m.kind === "percent" ? "percent" : "count",
    definition: m.sentence, source: src(cell), cents: r.cents ?? null });
  const out = { metric: plan.metric, label: m.label, kind: m.kind, words: C.planWords(plan, wordCtx(ctx)) };

  if (m.base === "source") return runSourceMetric(orgId, plan, ctx, out, m, deps);
  if (m.base === "donors") {
    const rows = await donorRows(orgId, DONOR_METRIC_RULES[plan.metric]);
    out.value = { label: m.label, value: rows.length, kind: "count", definition: m.sentence, source: src("cur") };
    out.counted = m.sentence;
    out.people = rows.slice(0, 50).map(r => ({ donorId: r.donor_id, name: r.name, cents: cents(r.amount) }));
    out.peopleCount = rows.length;
    return out;
  }
  if (plan.metric === "first_year_retention") {
    const r = await firstYearRetention(orgId, ctx.today);
    out.value = { label: m.label, value: r.prior.length ? Math.round((r.kept.length / r.prior.length) * 100) : null, kind: "percent",
      definition: m.sentence, source: { key: "ask-share", params: { plan: JSON.stringify(plan) } } };
    out.parts = [
      { label: "Gave again this year", value: r.kept.length, kind: "count", definition: "Of them, each person who has given again this year.", source: src("kept") },
      { label: `First gave in ${r.lastYear}`, value: r.prior.length, kind: "count", definition: `Each person whose first gift ever was in ${r.lastYear}.`, source: src("prior") },
    ];
    out.counted = `People whose first gift ever was in ${r.lastYear}, and which of them gave again in ${r.lastYear + 1} to ${ctx.today}.`;
    return out;
  }
  const cur = C.resolvePeriod(plan.period, ctx);
  const rows = await giftSet(orgId, plan, cur);
  const v = await computeGiftMetric(orgId, plan.metric, rows, cur);
  out.period = cur;
  out.value = fig("cur", v, `${m.label} · ${cur.label}`);
  if (plan.compare) {
    const cmp = C.resolveCompare(plan.compare, cur);
    const v2 = await computeGiftMetric(orgId, plan.metric, await giftSet(orgId, plan, cmp), cmp);
    out.comparePeriod = cmp;
    out.compare = fig("cmp", v2, `${m.label} · ${cmp.label}`);
    out.change = changeOf(v, v2);
    if (out.change !== null) out.changeFig = { label: "The change", value: out.change, kind: "percent", abs: true,
      definition: "This period against the period it is compared with: the difference, as a share of the earlier one.",
      source: { key: "ask-change", params: { plan: JSON.stringify(plan) } } };
  }
  if (plan.groupBy) {
    const keyOf = await dimensionOf(orgId, plan.groupBy, rows, ctx.today);
    const cmpRows = plan.compare ? await giftSet(orgId, plan, out.comparePeriod) : null;
    const keys = [...new Set([...rows.map(keyOf), ...(cmpRows ? cmpRows.map(keyOf) : [])])].sort();
    out.groups = [];
    for (let i = 0; i < keys.length; i++) {
      const g = await computeGiftMetric(orgId, plan.metric, rows.filter(r => keyOf(r) === keys[i]), cur);
      const row = { key: keys[i], value: fig(`g${i}`, g, `${m.label} · ${keys[i]}`) };
      if (cmpRows) row.compare = fig(`gc${i}`, await computeGiftMetric(orgId, plan.metric, cmpRows.filter(r => keyOf(r) === keys[i]), out.comparePeriod), `${m.label} · ${keys[i]} · ${out.comparePeriod.label}`);
      out.groups.push(row);
    }
    if (!["month", "quarter", "year"].includes(plan.groupBy)) out.groups.sort((a, b) => Number(b.value.value) - Number(a.value.value));
  }
  if (plan.kind === "who") {
    const people = await whoRows(orgId, plan, rows, cur);
    out.people = people.slice(0, plan.top || 50).map(p => ({ donorId: p.donor_id, name: p.name, cents: cents(p.amount), detail: p.detail }));
    out.peopleCount = people.length;
    out.peopleSource = src("who");
    if (plan.top) {
      const top = people.slice(0, plan.top), c = top.reduce((s, p) => s + cents(p.amount), 0);
      out.value = { label: `What the top ${top.length} gave · ${cur.label}`, value: dollars(c), cents: c, kind: "money",
        definition: "What these people gave in the period, added up.", source: src("top") };
    }
  }
  if (plan.metric === "largest_gift" && v.rows[0]) out.largestFrom = v.rows[0].name;
  out.scope = scopeWords(plan, ctx);
  if ((plan.filters || {}).donor) {
    const [d] = await query("SELECT name FROM donors WHERE org_id = ? AND id = ?", [orgId, plan.filters.donor]);
    out.donorName = d ? d.name : null;
  }
  if (plan.metric === "event_revenue") out.eventName = ((ctx.events || []).find(e => e.id === (plan.filters || {}).event) || {}).name;
  out.counted = countedLine(plan, cur, ctx, C);
  // REPORTS-5: a stretch with no gifts in Steward that an old system's report
  // covers: the answer cites it, says where it came from, and keeps it beside
  // Steward's number (it is never added into the value above).
  if (plan.metric === "raised") {
    const FS = require("./figureSources");
    out.oldSystem = [];
    for (const [per, n] of [[cur, rows.length], ...(out.comparePeriod ? [[out.comparePeriod, null]] : [])]) {
      const none = n === 0 || (n === null && !(Number(out.compare && out.compare.value) > 0));
      const h = none ? await FS.historicalGiving(orgId, per.from, per.to) : null;
      if (h) out.oldSystem.push({ label: `${per.label}, from your old system`, value: h.value, cents: h.cents, kind: "money", source: h.source, definition: h.note, note: h.note });
    }
    if (!out.oldSystem.length) delete out.oldSystem;
  }
  return out;
}

// The people behind a gift-set answer: the metric's own people when it
// counts people (new donors are the new donors), else everyone who gave.
async function whoRows(orgId, plan, rows, span) {
  if (["new_donor_count", "donor_count", "recaptured_count"].includes(plan.metric)) return (await computeGiftMetric(orgId, plan.metric, rows, span)).rows;
  return byDonor(rows.filter(r => cents(r.amount) > 0));
}

function changeOf(a, b) {
  const x = Number(a.cents ?? a.value), y = Number(b.cents ?? b.value);
  if (!(y > 0)) return null;
  return Math.round(((x - y) / y) * 100);
}

// "Gifts dated Sep 1 to Sep 30, 2026, refunds subtracted, all funds."
function countedLine(plan, cur, ctx, C) {
  const f = plan.filters || {};
  const name = (list, id) => ((list || []).find(x => x.id === id) || {}).name || "one";
  const bits = [`Gifts dated ${spanWords(cur.from, cur.to)}`];
  if (["raised", "event_revenue"].includes(plan.metric)) bits.push("refunds subtracted");
  else bits.push("refunds not counted");
  bits.push(f.fund ? `${name(ctx.funds, f.fund)} only` : "all funds");
  if (f.campaign) bits.push(`to ${name(ctx.campaigns, f.campaign)}`);
  if (f.event) bits.push(`for ${name(ctx.events, f.event)}`);
  if (f.payment_method) bits.push(`paid by ${f.payment_method}`);
  if (f.rules) bits.push(`from ${wordsOfRules(f.rules, ctx).join(", ")}`);
  if (plan.compare) { const c = C.resolveCompare(plan.compare, cur); bits.push(`compared with ${spanWords(c.from, c.to)}`); }
  return bits.join(", ") + ".";
}
// "Jan 1 to Oct 4, 2026", "Sep 1, 2025 to Aug 31, 2026", "any time to Oct 4, 2026".
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function spanWords(from, to) {
  const d = x => ({ y: x.slice(0, 4), t: `${MON[+x.slice(5, 7) - 1]} ${+x.slice(8, 10)}` });
  const a = d(from), b = d(to);
  if (from <= "1900-12-31") return `any time to ${b.t}, ${b.y}`;
  return a.y === b.y ? `${a.t} to ${b.t}, ${b.y}` : `${a.t}, ${a.y} to ${b.t}, ${b.y}`;
}
// " to the Scholarship Fund", " to Harbor Lights Gala 2026", " from monthly donors"
function scopeWords(plan, ctx) {
  const f = plan.filters || {};
  const name = (list, id) => ((list || []).find(x => x.id === id) || {}).name;
  const bits = [];
  if (f.fund) bits.push(` to ${name(ctx.funds, f.fund) || "one fund"}`);
  if (f.campaign) bits.push(` to ${name(ctx.campaigns, f.campaign) || "one campaign"}`);
  if (f.event) bits.push(` to ${name(ctx.events, f.event) || "one event"}`);
  if (f.rules) bits.push(` from ${wordsOfRules(f.rules, ctx).join(" and ")}`);
  return bits.join("");
}
function wordsOfRules(rules, ctx) {
  const w = [];
  if (rules.monthly) w.push("monthly donors");
  if (rules.level) w.push(`${rules.level} donors`);
  if (rules.lifecycle) w.push(`donors tagged ${rules.lifecycle}`);
  if (rules.city) w.push(`people in ${rules.city}`);
  for (const k of Object.keys(rules)) if (!["monthly", "level", "lifecycle", "city", "notDeceased"].includes(k)) w.push(GR.rulesSentence({ [k]: rules[k] }).replace(/^Everyone on file: |\. Worked out.*$/g, ""));
  return w.length ? w : ["the people these filters find"];
}
function wordCtx(ctx) { return { ...ctx, ruleWords: r => wordsOfRules(r, ctx) }; }

// A metric another screen already shows: its own figure source, once.
async function runSourceMetric(orgId, plan, ctx, out, m, deps = {}) {
  const FS = require("./figureSources");
  const C = await catMod();
  let source;
  if (plan.metric === "retention_rate") source = { key: "retention", params: {} };
  else if (plan.metric === "recurring_monthly_value") source = { key: "recurring-monthly", params: {} };
  else if (plan.metric === "pledged_outstanding") source = { key: "pledges-open", params: {} };
  else if (plan.metric === "campaign_progress") source = { key: "goal-progress", params: { campaign: plan.filters.campaign } };
  else if (plan.metric === "volunteer_hours") {
    const cur = C.resolvePeriod(plan.period, ctx);
    out.period = cur;
    source = { key: "volunteer-hours", params: { from: cur.from, to: cur.to } };
  }
  const f = await FS.figure(orgId, source, deps, { rows: false });
  const kind = m.kind === "money" ? "money" : m.kind === "percent" ? "percent" : "count";
  out.value = { label: m.label + (out.period ? ` · ${out.period.label}` : ""), value: f ? f.value : null, kind, definition: m.sentence, source,
    blank: f && f.blank ? f.blank : undefined, suffix: m.kind === "hours" ? " hours" : "" };
  if (plan.metric === "campaign_progress") {
    const g = await query(`SELECT name FROM campaigns WHERE org_id = ? AND id = ?`, [orgId, plan.filters.campaign]);
    out.campaign = { id: plan.filters.campaign, name: (g[0] || {}).name || "" };
    const raised = await FS.figure(orgId, { key: "goal-raised", params: { campaign: plan.filters.campaign } }, {}, { rows: false });
    const goal = await FS.figure(orgId, { key: "campaign-goal", params: { campaign: plan.filters.campaign } }, {}, { rows: false });
    out.parts = [
      { label: "Raised", value: raised ? raised.value : 0, kind: "money", definition: "Every gift and awarded grant toward this goal.", source: { key: "goal-raised", params: { campaign: plan.filters.campaign } } },
      { label: "The goal", value: goal ? goal.value : 0, kind: "money", definition: "The target set on the campaign.", source: { key: "campaign-goal", params: { campaign: plan.filters.campaign } } },
    ];
  }
  out.counted = m.sentence;
  return out;
}

// First-year retention: first gift ever last calendar year; gave again this one.
async function firstYearRetention(orgId, today) {
  const y = Number(today.slice(0, 4)), last = y - 1;
  const prior = await query(
    `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MIN(g.date)::text AS date, ROUND(SUM(g.amount)::numeric,2)::text AS amount, 'First gave ' || ${last} AS detail
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0
      GROUP BY d.id, d.name HAVING MIN(g.date) >= ? AND MIN(g.date) <= ?`, [orgId, `${last}-01-01`, `${last}-12-31`]);
  const ids = prior.map(p => p.id);
  const kept = ids.length ? await query(
    `SELECT d.id, 'person' AS type, d.id AS donor_id, d.name, MAX(g.date)::text AS date, ROUND(SUM(g.amount)::numeric,2)::text AS amount, 'Gave again in ' || ${y} AS detail
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND g.amount > 0 AND g.date >= ? AND g.date <= ?
      GROUP BY d.id, d.name`, [orgId, ids, `${y}-01-01`, today]) : [];
  return { prior, kept, lastYear: last };
}

// ── THE ROWS BEHIND ONE CELL (the figure source "ask") ─────────────────────
// Re-validates the plan against the org's own catalog first: a plan naming a
// fund, campaign or event the org does not have reads nothing.
async function cellRows(orgId, rawPlan, cell) {
  const C = await catMod();
  const ctx = await askContext(orgId);
  const chk = C.validatePlan(rawPlan, ctx);
  if (!chk.ok) return [];
  const plan = { ...chk.plan, ...(rawPlan.top ? { top: rawPlan.top } : {}) };
  const m = C.METRICS[plan.metric];
  if (m.base === "donors") return donorRows(orgId, DONOR_METRIC_RULES[plan.metric]);
  if (plan.metric === "first_year_retention") { const r = await firstYearRetention(orgId, ctx.today); return cell === "kept" ? r.kept : cell === "prior" ? r.prior : []; }
  if (m.base !== "gifts") return [];
  const cur = C.resolvePeriod(plan.period, ctx);
  const span = /^(cmp|gc\d+)$/.test(cell) ? C.resolveCompare(plan.compare, cur) : cur;
  if (!span) return [];
  let rows = await giftSet(orgId, plan, span);
  if (cell === "who") return whoRows(orgId, plan, rows, span);
  if (cell === "top") return (await whoRows(orgId, plan, rows, span)).slice(0, plan.top || 0);
  const g = /^gc?(\d+)$/.exec(cell);
  if (g && plan.groupBy) {
    const keyOf = await dimensionOf(orgId, plan.groupBy, rows, ctx.today);
    const curRows = span === cur ? rows : await giftSet(orgId, plan, cur);
    const keys = [...new Set([...curRows.map(keyOf), ...(plan.compare ? (await giftSet(orgId, plan, C.resolveCompare(plan.compare, cur))).map(keyOf) : [])])].sort();
    const k = keys[Number(g[1])];
    if (k === undefined) return [];
    rows = rows.filter(r => keyOf(r) === k);
  } else if (!["cur", "cmp"].includes(cell)) return [];
  const v = await computeGiftMetric(orgId, plan.metric, rows, span);
  return v ? v.rows : [];
}
async function cellMeasure(rawPlan, cell) {
  const C = await catMod();
  const m = C.METRICS[rawPlan.metric];
  if (!m) return "count";
  if (cell === "who" || cell === "kept" || cell === "prior" || m.base === "donors") return "count";
  return { raised: "sum", event_revenue: "sum", largest_gift: "sum", gift_count: "count", donor_count: "count",
    new_donor_count: "count", average_gift: "mean", median_gift: "mean" }[rawPlan.metric] || "count";
}

module.exports = { askContext, runPlan, cellRows, cellMeasure, giftSet, computeGiftMetric, firstYearRetention };

// donorStatus.js · PARITY-1 Part 1. THE TAGS UNDER A DONOR'S NAME, DEFINED ONCE.
//
// Three computed tags, always current because nothing is stored:
//   giving level  General, Mid or Major, from what they gave in the last 12
//                 months against the org's cut points (Settings, Giving levels;
//                 defaults $1,000 and $10,000).
//   lifecycle     New, Current, Recaptured or Lapsed, from two 12-month windows.
//   retained      gave last calendar year and again this calendar year.
// Plus the closeness word (Close, Warm, Cooling, New), which is ENGAGE-1's band
// said in words (shared/engagementWeights.js closenessFor), so the word and the
// score can never disagree.
//
// One SQL builder (statusSql) feeds the profile, the donor list filters, the
// Groups rules, the dashboard's giving-level chart and the figure source that
// opens each tag's donors. A refund is a gift with a negative amount: it comes
// off the 12-month total, but it never counts as "gave".

const { query } = require("./db");
const orgTime = require("./orgTime");

const DEFAULT_CUTS = Object.freeze({ midCents: 100000, majorCents: 1000000 });
const NEW_DAYS = 90;

const LEVELS = Object.freeze({
  general: { label: "General", kind: "level" },
  mid: { label: "Mid", kind: "level" },
  major: { label: "Major", kind: "level" },
});
const LIFECYCLES = Object.freeze({
  new: { label: "New", kind: "lifecycle", sentence: "Their first gift was in the last 12 months." },
  current: { label: "Current", kind: "lifecycle", sentence: "They gave in the last 12 months and in the 12 months before that." },
  recaptured: { label: "Recaptured", kind: "lifecycle", sentence: "They gave in the last 12 months after going 12 months or more without a gift." },
  lapsed: { label: "Lapsed", kind: "lifecycle", sentence: "They have given before, but not in the last 12 months." },
});
const RETAINED = Object.freeze({ label: "Retained", kind: "retained", sentence: "They gave last calendar year and have given again this calendar year." });
const CLOSENESS = Object.freeze({
  close: { label: "Close" }, warm: { label: "Warm" }, cooling: { label: "Cooling" }, new: { label: "New" },
});
const TAG_KEYS = [...Object.keys(LEVELS), ...Object.keys(LIFECYCLES), "retained"];

function dollars(cents) {
  const d = Math.round(Number(cents) || 0) / 100;
  return "$" + d.toLocaleString("en-US", { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function levelSentence(cuts) {
  return `Giving level is what they gave in the last 12 months: General is under ${dollars(cuts.midCents)}, `
    + `Mid is ${dollars(cuts.midCents)} to ${dollars(cuts.majorCents - (cuts.majorCents % 100 ? 1 : 100))}, Major is ${dollars(cuts.majorCents)} and up. `
    + "The cut points are in Settings, Giving levels.";
}
function tagSentence(key, cuts) {
  if (LEVELS[key]) return levelSentence(cuts);
  if (LIFECYCLES[key]) return LIFECYCLES[key].sentence;
  if (key === "retained") return RETAINED.sentence;
  return "";
}
function tagLabel(key) {
  return (LEVELS[key] || LIFECYCLES[key] || (key === "retained" ? RETAINED : null) || {}).label || key;
}

async function cutsFor(orgId) {
  const [o] = await query("SELECT giving_level_mid_cents, giving_level_major_cents FROM orgs WHERE id=?", [orgId]);
  const mid = o && o.giving_level_mid_cents != null ? Number(o.giving_level_mid_cents) : DEFAULT_CUTS.midCents;
  const major = o && o.giving_level_major_cents != null ? Number(o.giving_level_major_cents) : DEFAULT_CUTS.majorCents;
  return { midCents: mid, majorCents: major };
}
async function todayFor(orgId) {
  const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone });
}

// The windows, as civil dates. W0 is the last 12 months up to today, W1 the
// 12 months before that.
function windowsFor(today) {
  const y = orgTime.parseCivil(today).y;
  return {
    today,
    w0From: orgTime.addDays(today, -364), w1From: orgTime.addDays(today, -729), w1To: orgTime.addDays(today, -365),
    cyFrom: `${y}-01-01`, lyFrom: `${y - 1}-01-01`, lyTo: `${y - 1}-12-31`,
    newFrom: orgTime.addDays(today, -(NEW_DAYS - 1)),
  };
}

// One row per person who has ever given (a positive gift on or before today):
// donor_id, last12 (dollars, net), first_date, last_date, level, lifecycle,
// retained. `donorId` narrows it to one person.
function statusSql(orgId, today, cuts, { donorId = null } = {}) {
  const w = windowsFor(today);
  const args = [cuts.majorCents, cuts.midCents,
    w.w0From, w.today, w.w0From, w.today, w.w1From, w.w1To, w.w0From, w.cyFrom, w.today, w.lyFrom, w.lyTo,
    orgId, w.today];
  if (donorId) args.push(donorId);
  const sql = `
    SELECT a.donor_id, a.last12, a.first_date, a.last_date,
           CASE WHEN ROUND(a.last12 * 100) >= ? THEN 'major' WHEN ROUND(a.last12 * 100) >= ? THEN 'mid' ELSE 'general' END AS level,
           CASE WHEN a.w0 AND NOT a.before_w0 THEN 'new'
                WHEN a.w0 AND a.w1 THEN 'current'
                WHEN a.w0 THEN 'recaptured'
                ELSE 'lapsed' END AS lifecycle,
           (a.this_cy AND a.last_cy) AS retained
      FROM (
        SELECT g.donor_id,
               ROUND(COALESCE(SUM(g.amount) FILTER (WHERE LEFT(g.date,10) BETWEEN ? AND ?), 0)::numeric, 2) AS last12,
               MIN(LEFT(g.date,10)) FILTER (WHERE g.amount > 0) AS first_date,
               MAX(LEFT(g.date,10)) FILTER (WHERE g.amount > 0) AS last_date,
               COALESCE(BOOL_OR(g.amount > 0 AND LEFT(g.date,10) BETWEEN ? AND ?), false) AS w0,
               COALESCE(BOOL_OR(g.amount > 0 AND LEFT(g.date,10) BETWEEN ? AND ?), false) AS w1,
               COALESCE(BOOL_OR(g.amount > 0 AND LEFT(g.date,10) < ?), false) AS before_w0,
               COALESCE(BOOL_OR(g.amount > 0 AND LEFT(g.date,10) BETWEEN ? AND ?), false) AS this_cy,
               COALESCE(BOOL_OR(g.amount > 0 AND LEFT(g.date,10) BETWEEN ? AND ?), false) AS last_cy
          FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
         WHERE g.org_id = ? AND LEFT(g.date,10) <= ?${donorId ? " AND g.donor_id = ?" : ""}
         GROUP BY g.donor_id
        HAVING BOOL_OR(g.amount > 0)
      ) a`;
  return { sql, args };
}

// The SQL condition "this donor has tag K", for a list or a group rule. `alias`
// is the donors table alias in the caller's query. Returns null for an
// unknown key.
function tagCondition(key, orgId, today, cuts, alias = "") {
  if (!TAG_KEYS.includes(key)) return null;
  const a = alias ? alias + "." : "";
  const { sql, args } = statusSql(orgId, today, cuts);
  const col = LEVELS[key] ? "s.level = ?" : LIFECYCLES[key] ? "s.lifecycle = ?" : "s.retained";
  return {
    sql: `${a}id IN (WITH s AS MATERIALIZED (${sql}) SELECT s.donor_id FROM s WHERE ${col})`,
    args: col.endsWith("?") ? [...args, key] : args,
  };
}

// Closeness in SQL: the stored ENGAGE-1 band, said as a word. A person whose
// band is Distant is New when they arrived (record or first gift) in the last
// 90 days, and Cooling otherwise. The profile says the same through
// shared/engagementWeights.js closenessFor. One expression feeds the list
// column and the filter, so a row and the filter that found it agree.
function closenessSql(today, alias = "") {
  const a = alias ? alias + "." : "donors.";
  const w = windowsFor(today);
  const band = `COALESCE((SELECT ds.band FROM donor_scores ds WHERE ds.org_id = ${a}org_id AND ds.donor_id = ${a}id), 'distant')`;
  // "Arrived" is their first activity on file: a gift, a conversation or a
  // volunteer shift, and only for someone with none of those, the day their
  // record was made (an import made today is not a new relationship).
  const isNew = `(${firstSeenSql(a)} >= ?)`;
  return {
    sql: `(CASE WHEN ${band} IN ('close','warm') THEN ${band} WHEN ${isNew} THEN 'new' ELSE 'cooling' END)`,
    args: [w.newFrom],
  };
}
function firstSeenSql(a) {
  return `COALESCE(LEAST(
      (SELECT MIN(LEFT(gn.date,10)) FROM gifts gn WHERE gn.org_id = ${a}org_id AND gn.donor_id = ${a}id AND gn.amount > 0),
      (SELECT MIN(LEFT(ix.date,10)) FROM interactions ix WHERE ix.org_id = ${a}org_id AND ix.donor_id = ${a}id AND COALESCE(ix.date,'') <> ''),
      (SELECT MIN(LEFT(vs.date::text,10)) FROM volunteer_shifts vs WHERE vs.org_id = ${a}org_id AND vs.person_id = ${a}id)),
    LEFT(${a}created_at::text,10))`;
}
function closenessCondition(key, today, alias = "") {
  if (!CLOSENESS[key]) return null;
  const c = closenessSql(today, alias);
  return { sql: `${c.sql} = ?`, args: [...c.args, key] };
}

// Everything the profile's tag row needs for one person.
async function statusFor(orgId, donorId, { today = null, cuts = null } = {}) {
  today = today || await todayFor(orgId);
  cuts = cuts || await cutsFor(orgId);
  const { sql, args } = statusSql(orgId, today, cuts, { donorId });
  const [row] = await query(sql, args);
  if (!row) return { today, cuts, row: null, tags: [] };
  const keys = [row.level, row.lifecycle];
  if (row.retained) keys.push("retained");
  const tags = keys.map(k => ({
    key: k, label: tagLabel(k), kind: LEVELS[k] ? "level" : LIFECYCLES[k] ? "lifecycle" : "retained",
    sentence: tagSentence(k, cuts),
    source: { key: "donors-by-status", params: { tag: k, today } },
  }));
  return { today, cuts, row, tags };
}

module.exports = {
  DEFAULT_CUTS, NEW_DAYS, LEVELS, LIFECYCLES, RETAINED, CLOSENESS, TAG_KEYS,
  cutsFor, todayFor, windowsFor, statusSql, tagCondition, closenessSql, closenessCondition, firstSeenSql, statusFor,
  tagLabel, tagSentence, levelSentence, dollars,
};

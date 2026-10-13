// LIVE-1 · "WHAT THIS TOLD US".
//
// When an import, a giving-source read or a QuickBooks read finishes, Steward
// writes a short readout from the data: each line a count, the rows behind
// it, one action and one sentence saying which rows and which rule produced
// it. Nothing here is a model's opinion. AI may only re-phrase a line (it
// goes through the AI switch, elsewhere); every number and every reason is
// computed below from gift rows.
//
// A line with a zero is not written. A kind staff dismissed three times
// running moves to the bottom (demotedKinds) and says why; one click puts it
// back. When a readout action is followed by a gift from that person within
// GAVE_AFTER_DAYS, "What changed" says so, and never says the action caused it.
"use strict";

const orgTime = require("./orgTime");

const ACTOR = { id: "system:readout", name: "Steward (what this told us)" };
const RECENT_DAYS = 90;          // a gift line is about gifts from the last 90 days
const LAPSED_DAYS = 365;         // "lapsed" is a year with no gift, as everywhere in Steward
const MONTHLY_GAP_DAYS = 45;     // a monthly gift missing for more than 45 days has stopped
const STOPPED_LOOKBACK_DAYS = 120;
const GAVE_AFTER_DAYS = 60;
const DISMISS_RUN = 3;

// The order lines are shown in, and what each one is.
const KINDS = {
  lapsed_returned:  { action: "task_thank",  actionLabel: "Thank them personally" },
  biggest_ever:     { action: "task_call",   actionLabel: "Call them" },
  above_last_year:  { action: "task_call",   actionLabel: "Call them" },
  new_donors:       { action: "thank_you_draft", actionLabel: "Draft thank-yous" },
  new_above_median: { action: "task_call",   actionLabel: "Call them" },
  recurring_started:{ action: "thank_you_draft", actionLabel: "Draft thank-yous" },
  recurring_stopped:{ action: "task_call",   actionLabel: "Call about their monthly gift" },
  now_late:         { action: "add_to_calls", actionLabel: "Add to calls" },
  crossed_group:    { action: "open_group",  actionLabel: "Open the group" },
  data_problems:    { action: "open_data_health", actionLabel: "Open Data health" },
};
const KIND_ORDER = Object.keys(KINDS);
// What a person may be told the line is called, for the "moved down" note.
const KIND_NAMES = {
  lapsed_returned: "lapsed donors who came back", biggest_ever: "biggest gifts ever",
  above_last_year: "more than last year", new_donors: "new donors", new_above_median: "new donors above your median",
  recurring_started: "monthly gifts started", recurring_stopped: "monthly gifts stopped",
  now_late: "late for their own rhythm", crossed_group: "crossed into a group", data_problems: "data problems",
};

let deps = null;
function configure(d) { deps = d; }
function q(sql, args) { return (deps && deps.query ? deps.query : require("./db").query)(sql, args); }

const cents = v => Math.round((Number(v) || 0) * 100);
const dollars = c => "$" + (Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const isRecurringGift = g => /recurr|monthly|sustain/i.test(String(g.type || ""))
  || !!g.recurring_subscription_id || !!g.provider_recurring_ref;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function sourceWord(kind) { return kind === "import" ? "import" : "read"; }
// FIX-37: an org's first import is its history arriving, not news: every
// person in it is "new", so the readout says what the history shows instead.
const FIRST_IMPORT_TITLE = "What your history shows";
function readoutTitle(sourceKind, sourceName, today, firstImport = false) {
  if (firstImport && sourceKind === "import") return FIRST_IMPORT_TITLE;
  const month = MONTHS[Number(String(today).slice(5, 7)) - 1] || "";
  if (sourceKind === "import") return `Your ${month} import`;
  return `Your ${month} ${sourceName || "read"}`.trim();
}

// THE LINES. Pure over the rows it is handed, so the rules are testable with
// plain data. `gifts` is every gift of every person concerned (new and old);
// `newIds` the ids this run wrote.
function computeLines({ gifts, newIds, names, today, medianCents, crossings = [], lateIds = [], stoppedRows = [],
                        sourceKind = "import", groupNames = {}, firstImport = false }) {
  const word = sourceWord(sourceKind);
  const recentFrom = orgTime.addDays(today, -RECENT_DAYS);
  const yr = Number(String(today).slice(0, 4));
  const byDonor = new Map();
  for (const g of gifts) {
    if (!(Number(g.amount) > 0)) continue;
    if (!byDonor.has(g.donor_id)) byDonor.set(g.donor_id, []);
    byDonor.get(g.donor_id).push(g);
  }
  const out = Object.fromEntries(KIND_ORDER.map(k => [k, []]));
  for (const [donorId, list] of byDonor) {
    list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const fresh = list.filter(g => newIds.has(g.id));
    if (!fresh.length) continue;
    const old = list.filter(g => !newIds.has(g.id));
    const recent = fresh.filter(g => String(g.date).slice(0, 10) >= recentFrom);
    const row = g => ({ donorId, giftId: g.id, date: String(g.date).slice(0, 10), cents: cents(g.amount) });
    if (!old.length) {
      const first = list[0];
      out.new_donors.push(row(first));
      if (medianCents != null && cents(first.amount) > medianCents) out.new_above_median.push(row(first));
    }
    if (!recent.length) continue;
    // The person's WHOLE history is read, including older gifts this same
    // file brought: a first import of three years still says who came back
    // last month, because the file itself shows they had stopped.
    const g0 = recent[0];
    // Came back: the gift before their first recent one is more than a year
    // before it.
    const before = list.filter(g => String(g.date) < String(g0.date));
    if (before.length) {
      const prev = before[before.length - 1];
      if (orgTime.daysBetween(String(prev.date).slice(0, 10), String(g0.date).slice(0, 10)) > LAPSED_DAYS) out.lapsed_returned.push(row(g0));
    }
    const biggestRecent = recent.reduce((m, g) => (cents(g.amount) > cents(m.amount) ? g : m), recent[0]);
    const earlier = list.filter(g => String(g.date) < String(biggestRecent.date));
    const earlierMax = earlier.reduce((m, g) => Math.max(m, cents(g.amount)), 0);
    let biggest = false;
    if (earlier.length && cents(biggestRecent.amount) > earlierMax) { out.biggest_ever.push(row(biggestRecent)); biggest = true; }
    if (!biggest && list.length > recent.length) {
      let thisYear = 0, lastYear = 0;
      for (const g of list) { const y = Number(String(g.date).slice(0, 4)); if (y === yr) thisYear += cents(g.amount); else if (y === yr - 1) lastYear += cents(g.amount); }
      if (lastYear > 0 && thisYear > lastYear && recent.some(g => Number(String(g.date).slice(0, 4)) === yr))
        out.above_last_year.push({ ...row(biggestRecent), cents: thisYear, lastYearCents: lastYear });
    }
    const recRecent = recent.filter(isRecurringGift);
    if (recRecent.length && !list.some(g => isRecurringGift(g) && String(g.date) < String(recRecent[0].date)))
      out.recurring_started.push(row(recRecent[0]));
  }
  for (const s of stoppedRows) out.recurring_stopped.push({ donorId: s.donorId, giftId: s.giftId || null, date: s.date || null, cents: s.cents || 0, how: s.how });
  // "Now late" is about people Steward already knew: someone new in this file
  // was never on time here, so a late rhythm in their own history is not news
  // this file brought.
  // On a first import everyone is new, and their rhythm comes from the dates
  // in the file itself, so lateness is kept and "new donors" is left out.
  const isNew = firstImport ? new Set() : new Set(out.new_donors.map(r => r.donorId));
  const late = new Set(lateIds.filter(id => !isNew.has(id)));
  if (firstImport) { out.new_donors = []; out.new_above_median = []; }
  for (const id of late) out.now_late.push({ donorId: id });
  const seenCross = new Set();
  for (const c of crossings) {
    const k = c.donorId + "|" + c.groupId;
    if (seenCross.has(k)) continue; seenCross.add(k);
    out.crossed_group.push({ donorId: c.donorId, groupId: c.groupId, groupName: c.groupName || groupNames[c.groupId] || "" });
  }

  const lines = [];
  for (const kind of KIND_ORDER) {
    const rows = out[kind];
    if (!rows || !rows.length) continue;
    const people = new Set(rows.map(r => r.donorId)).size;
    const total = rows.reduce((s, r) => s + (r.cents || 0), 0);
    lines.push({ kind, count: people, cents: total, rows: rows.slice(0, 500),
                 sentence: sentenceFor(kind, people, { total, medianCents, rows }),
                 why: whyFor(kind, { word, medianCents, rows, today }),
                 action: KINDS[kind].action, actionLabel: KINDS[kind].actionLabel });
  }
  for (const l of lines) for (const r of l.rows) if (names && names[r.donorId]) r.name = names[r.donorId];
  return lines;
}

function sentenceFor(kind, n, { total, medianCents, rows }) {
  switch (kind) {
    case "lapsed_returned": return `${plural(n, "lapsed donor", "lapsed donors")} came back`;
    case "biggest_ever": return `${n.toLocaleString("en-US")} gave their biggest gift ever`;
    case "above_last_year": return `${n.toLocaleString("en-US")} ${n === 1 ? "has" : "have"} given more this year than all of last year`;
    case "new_donors": return `${plural(n, "new donor", "new donors")}, ${dollars(total)} between them`;
    case "new_above_median": return `${n.toLocaleString("en-US")} of them gave a first gift above your median gift of ${dollars(medianCents)}`;
    case "recurring_started": return `${n.toLocaleString("en-US")} started a recurring gift`;
    case "recurring_stopped": return `${plural(n, "monthly gift", "monthly gifts")} stopped or failed`;
    case "now_late": return `${n.toLocaleString("en-US")} ${n === 1 ? "is" : "are"} now late for their own rhythm`;
    case "crossed_group": {
      const groups = [...new Set(rows.map(r => r.groupName).filter(Boolean))];
      return `${plural(n, "person", "people")} crossed into ${groups.length === 1 ? groups[0] : plural(groups.length, "group", "groups")}`;
    }
    case "data_problems": return `${plural(n, "possible duplicate", "possible duplicates")} to look at`;
    default: return "";
  }
}

function whyFor(kind, { word, medianCents, rows, today }) {
  switch (kind) {
    case "lapsed_returned": return `Each of these people has a gift in this ${word}, dated in the last ${RECENT_DAYS} days, and no gift for more than 12 months before it, reading everything Steward holds for them and everything this ${word} brought.`;
    case "biggest_ever": return `Each person's gift in this ${word}, dated in the last ${RECENT_DAYS} days, is larger than every gift they made before it, in Steward or in this ${word}.`;
    case "above_last_year": return `Their giving in ${String(today).slice(0, 4)}, including this ${word}, adds up to more than everything they gave in ${Number(String(today).slice(0, 4)) - 1}.`;
    case "new_donors": return `Their first gift ever is in this ${word}: Steward held no gift from them before it.`;
    case "new_above_median": return `Their first gift is more than ${dollars(medianCents)}, the middle of every gift your organization had recorded before this ${word} (or, for a first ${word}, of every gift in it).`;
    case "recurring_started": return `A recurring gift in this ${word}, dated in the last ${RECENT_DAYS} days, from someone with no recurring gift before it.`;
    case "recurring_stopped": return `They gave monthly and no monthly gift has come in for more than ${MONTHLY_GAP_DAYS} days up to the newest gift in this ${word}, or their card plan was cancelled or failed in the last 30 days.`;
    case "now_late": return `Drift compares each person with their own rhythm (how often they usually give, or the month they usually give in), and these people became late when this ${word} was saved.`;
    case "crossed_group": return `They now match the rules of ${[...new Set(rows.map(r => r.groupName).filter(Boolean))].join(", ") || "a group"}, and did not before this ${word}.`;
    case "data_problems": return `Data health compared the people this ${word} created with everyone already on file and found these possible duplicates.`;
    default: return "";
  }
}

function headlineOf(title, lines) {
  const top = lines.filter(l => l.kind !== "data_problems").slice(0, 2).map(l => l.sentence);
  return top.length ? `${title}: ${top.join(", ")}` : `${title}: nothing that needs you`;
}

// Monthly givers who stopped: org-wide, because someone whose gift did not
// arrive is, by definition, not in the file. Read from gift rows (an imported
// file has no plan status) and from the card plans and provider plans Steward
// holds.
async function stoppedRecurring(orgId, { asOf, today }) {
  const from = orgTime.addDays(asOf, -STOPPED_LOOKBACK_DAYS);
  const gap = orgTime.addDays(asOf, -MONTHLY_GAP_DAYS);
  const rows = await q(
    `WITH r AS (
       SELECT donor_id, date, amount, id,
              ROW_NUMBER() OVER (PARTITION BY donor_id ORDER BY date DESC) AS rn,
              COUNT(*) OVER (PARTITION BY donor_id) AS n
         FROM gifts
        WHERE org_id=? AND amount > 0
          AND (type ILIKE '%recurr%' OR type ILIKE '%monthly%' OR recurring_subscription_id IS NOT NULL OR provider_recurring_ref IS NOT NULL))
     SELECT r.donor_id, r.id, r.date, r.amount FROM r
       JOIN donors d ON d.id = r.donor_id AND d.org_id = ? AND d.deleted_at IS NULL
      WHERE r.rn = 1 AND r.n >= 2 AND r.date::date < ?::date AND r.date::date >= ?::date`,
    [orgId, orgId, gap, from]);
  const out = rows.map(r => ({ donorId: r.donor_id, giftId: r.id, date: String(r.date).slice(0, 10), cents: cents(r.amount), how: "no monthly gift" }));
  const seen = new Set(out.map(r => r.donorId));
  const subs = await q(
    `SELECT donor_id, amount, status FROM recurring_subscriptions
      WHERE org_id=? AND status IN ('canceled','past_due','unpaid','incomplete_expired')
        AND COALESCE(canceled_at, last_failed_at, updated_at) >= NOW() - INTERVAL '30 days'`, [orgId]).catch(() => []);
  for (const s of subs) if (!seen.has(s.donor_id)) { seen.add(s.donor_id); out.push({ donorId: s.donor_id, cents: cents(s.amount), how: s.status }); }
  const prov = await q(
    `SELECT donor_id, amount_cents, status FROM giving_recurring
      WHERE org_id=? AND status IN ('missed','ended') AND updated_at >= NOW() - INTERVAL '30 days'`, [orgId]).catch(() => []);
  for (const s of prov) if (!seen.has(s.donor_id)) { seen.add(s.donor_id); out.push({ donorId: s.donor_id, cents: Number(s.amount_cents) || 0, how: s.status }); }
  // Said once: someone a readout already reported stopped in the lookback is
  // not reported again by the next file.
  const told = await q(
    `SELECT DISTINCT r->>'donorId' AS id FROM readouts x, jsonb_array_elements(x.lines) l, jsonb_array_elements(l->'rows') r
      WHERE x.org_id=? AND x.removed_at IS NULL AND l->>'kind'='recurring_stopped'
        AND x.created_at >= NOW() - (? || ' days')::interval`, [orgId, String(STOPPED_LOOKBACK_DAYS)]).catch(() => []);
  const toldSet = new Set(told.map(t => t.id));
  void today;
  return out.filter(r => !toldSet.has(r.donorId));
}

// Gather the rows and write one readout. `crossings` / `becameLate` come from
// the after-change step's own result; for a chunked import they are read back
// by the run's stamp instead (`stamp`).
async function writeReadout(orgId, { sourceKind, sourceId, sourceName, giftIds = [], donorIds = [], crossings = null,
                                     becameLate = null, stamp = null, today, isExample = false, firstImport = false }) {
  const newIds = new Set(giftIds);
  const people = [...new Set([...donorIds])];
  const giftRows = people.length ? await q(
    `SELECT id, donor_id, date, amount, type, recurring_subscription_id, provider_recurring_ref
       FROM gifts WHERE org_id=? AND donor_id = ANY(?)`, [orgId, people]) : [];
  for (const g of giftRows) if (newIds.has(g.id) && !people.includes(g.donor_id)) people.push(g.donor_id);
  const [med] = await q(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS m FROM gifts
      WHERE org_id=? AND amount > 0 AND NOT (id = ANY(?))`, [orgId, [...newIds]]);
  let medianCents = med && med.m != null ? cents(med.m) : null;
  if (medianCents == null && newIds.size) {
    // A first import: nothing was on file before it, so the middle gift is
    // the file's own.
    const [m2] = await q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS m FROM gifts WHERE org_id=? AND amount > 0 AND id = ANY(?)`,
      [orgId, [...newIds]]);
    medianCents = m2 && m2.m != null ? cents(m2.m) : null;
  }
  if (stamp && crossings == null) {
    crossings = (await q(
      `SELECT c.donor_id, c.group_id, a.name FROM group_crossings c LEFT JOIN audiences a ON a.id = c.group_id
        WHERE c.org_id=? AND c.door=?`, [orgId, stamp])).map(r => ({ donorId: r.donor_id, groupId: r.group_id, groupName: r.name }));
  }
  if (stamp && becameLate == null) {
    becameLate = (await q(
      `SELECT donor_id FROM donor_rhythm WHERE org_id=? AND last_door=? AND drift_state='drifting'
          AND state_changed_at >= NOW() - INTERVAL '1 day'`, [orgId, stamp])).map(r => r.donor_id);
  }
  if (crossings && crossings.length && crossings.some(c => !c.groupName)) {
    const g = await q(`SELECT id, name FROM audiences WHERE org_id=? AND id = ANY(?)`, [orgId, [...new Set(crossings.map(c => c.groupId))]]);
    const nm = Object.fromEntries(g.map(r => [r.id, r.name]));
    crossings = crossings.map(c => ({ ...c, groupName: c.groupName || nm[c.groupId] || "" }));
  }
  const newDates = giftRows.filter(g => newIds.has(g.id)).map(g => String(g.date).slice(0, 10)).sort();
  const asOf = newDates.length ? (newDates[newDates.length - 1] < today ? newDates[newDates.length - 1] : today) : today;
  const stoppedRows = await stoppedRecurring(orgId, { asOf, today });
  const allIds = [...new Set([...people, ...stoppedRows.map(s => s.donorId), ...(becameLate || [])])];
  const names = Object.fromEntries((allIds.length ? await q(`SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?)`, [orgId, allIds]) : [])
    .map(r => [r.id, r.name]));
  const lines = computeLines({ gifts: giftRows, newIds, names, today, medianCents, crossings: crossings || [],
                               lateIds: becameLate || [], stoppedRows, sourceKind, firstImport });
  const title = readoutTitle(sourceKind, sourceName, today, firstImport);
  const id = "ro_" + require("./db").uuid().replace(/-/g, "").slice(0, 14);
  await q(
    `INSERT INTO readouts (id, org_id, source_kind, source_id, title, headline, lines, for_date, is_example, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?::jsonb,?,?,?,?)`,
    [id, orgId, sourceKind, sourceId || null, title, headlineOf(title, lines), JSON.stringify(lines), today, !!isExample,
     ACTOR.id, ACTOR.name]);
  return { id, title, headline: headlineOf(title, lines), lines };
}

// The kinds staff have dismissed DISMISS_RUN times running (nothing else
// about that kind in between: no action taken on it, no "put it back").
async function demotedKinds(orgId) {
  const rows = await q(
    `SELECT line_kind, event FROM readout_events WHERE org_id=? ORDER BY created_at DESC, id DESC LIMIT 2000`, [orgId]);
  const runs = new Map(), closed = new Set();
  for (const r of rows) {
    if (closed.has(r.line_kind)) continue;
    if (r.event === "dismissed") runs.set(r.line_kind, (runs.get(r.line_kind) || 0) + 1);
    else closed.add(r.line_kind);
  }
  return new Set([...runs].filter(([, n]) => n >= DISMISS_RUN).map(([k]) => k));
}

// The data-health line is read at show time: Data health runs after the
// import is recorded, so it is never ready when the readout is written.
async function dataLine(orgId, row) {
  if (row.source_kind !== "import" || !row.source_id) return null;
  const [r] = await q(`SELECT new_duplicates FROM data_health_runs WHERE org_id=? AND import_id=? ORDER BY created_at DESC LIMIT 1`,
    [orgId, row.source_id]).catch(() => []);
  let pairs = r && r.new_duplicates;
  if (typeof pairs === "string") { try { pairs = JSON.parse(pairs); } catch { pairs = null; } }
  const n = Array.isArray(pairs) ? pairs.length : Number(pairs) || 0;
  if (!n) return null;
  return { kind: "data_problems", count: n, cents: 0, rows: [], sentence: sentenceFor("data_problems", n, {}),
           why: whyFor("data_problems", { word: "import" }), action: "open_data_health", actionLabel: KINDS.data_problems.actionLabel };
}

// A readout as a screen reads it: lines in order, the demoted kinds last with
// the reason, a line already dismissed on THIS readout hidden.
async function shapeReadout(orgId, row, { demoted } = {}) {
  const dem = demoted || await demotedKinds(orgId);
  let lines = typeof row.lines === "string" ? JSON.parse(row.lines) : (row.lines || []);
  const dl = await dataLine(orgId, row);
  if (dl) lines = [...lines.filter(l => l.kind !== "data_problems"), dl];
  const gone = new Set((await q(`SELECT line_kind FROM readout_events WHERE org_id=? AND readout_id=? AND event='dismissed'`,
    [orgId, row.id])).map(r => r.line_kind));
  const acted = new Set((await q(`SELECT DISTINCT line_kind FROM readout_events WHERE org_id=? AND readout_id=? AND event='acted'`,
    [orgId, row.id])).map(r => r.line_kind));
  // A thank-you is drafted only for a gift from the last HISTORY_DAYS days
  // (FIX-36): a line whose gifts are all older has no thank-you to draft, so
  // it offers no button rather than one that does nothing.
  const HG = require("./historyGifts");
  const draftable = l => (l.rows || []).some(r => r.giftId && r.date && !HG.isOldHistory(r.date, row.for_date));
  const shown = lines.filter(l => l.count > 0 && !gone.has(l.kind)).map(l => ({
    kind: l.kind, count: l.count, cents: l.cents || 0, sentence: l.sentence, why: l.why,
    action: l.action === "thank_you_draft" && !draftable(l) ? null : l.action,
    actionLabel: l.action === "thank_you_draft" && !draftable(l) ? null : l.actionLabel, acted: acted.has(l.kind),
    demoted: dem.has(l.kind),
    demotedWhy: dem.has(l.kind) ? `Moved down because "${KIND_NAMES[l.kind]}" was dismissed ${DISMISS_RUN} times running.` : null,
    rowCount: (l.rows || []).length,
  }));
  shown.sort((a, b) => (a.demoted - b.demoted) || (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
  return { id: row.id, title: row.title, headline: row.headline, forDate: row.for_date, sourceKind: row.source_kind,
           sourceId: row.source_id, isExample: !!row.is_example, createdAt: row.created_at, lines: shown };
}

// WHAT WORKED: a readout action followed by a gift from that person within
// GAVE_AFTER_DAYS. Counted, never claimed as the cause.
async function whatWorked(orgId) {
  const rows = await q(
    `SELECT e.donor_id, MIN(e.acted_on) AS acted_on, MIN(e.created_at) AS acted_at, e.action_kind
       FROM readout_events e WHERE e.org_id=? AND e.event='acted' AND e.donor_id IS NOT NULL
      GROUP BY e.donor_id, e.action_kind`, [orgId]);
  if (!rows.length) return { people: 0, cents: 0, since: null, rows: [], sentence: null };
  const gifts = await q(
    `SELECT g.id, g.donor_id, g.date, g.amount, g.created_at FROM gifts g
      WHERE g.org_id=? AND g.donor_id = ANY(?) AND g.amount > 0`, [orgId, [...new Set(rows.map(r => r.donor_id))]]);
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const from = String(r.acted_on).slice(0, 10), to = orgTime.addDays(from, GAVE_AFTER_DAYS);
    for (const g of gifts) {
      const d = String(g.date).slice(0, 10);
      // After the action: dated on or after its day, and written after it
      // (a gift already on file that day is not a gift after the call).
      if (g.donor_id === r.donor_id && d >= from && d <= to && new Date(g.created_at) > new Date(r.acted_at) && !seen.has(g.id)) {
        seen.add(g.id);
        out.push({ donorId: g.donor_id, giftId: g.id, date: d, cents: cents(g.amount), actedOn: from, action: r.action_kind });
      }
    }
  }
  const people = new Set(out.map(o => o.donorId)).size;
  const total = out.reduce((s, o) => s + o.cents, 0);
  const since = rows.map(r => String(r.acted_on).slice(0, 10)).sort()[0];
  const month = since ? MONTHS[Number(since.slice(5, 7)) - 1] : "";
  return { people, cents: total, since, rows: out,
           sentence: people ? `Since ${month}, ${plural(people, "person", "people")} you reached out to after a readout gave ${dollars(total)}.` : null,
           why: `A gift from someone within ${GAVE_AFTER_DAYS} days after a readout action on them (a call or thank-you task, a draft). Steward counts what they gave after; it cannot say the action is why.` };
}

module.exports = { ACTOR, KINDS, KIND_ORDER, KIND_NAMES, DISMISS_RUN, GAVE_AFTER_DAYS, RECENT_DAYS, configure,
  computeLines, writeReadout, shapeReadout, FIRST_IMPORT_TITLE, demotedKinds, whatWorked, readoutTitle, headlineOf, stoppedRecurring };

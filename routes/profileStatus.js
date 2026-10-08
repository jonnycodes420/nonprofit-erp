// routes/profileStatus.js · PARITY-1 Part 1. The donor profile's top block.
//
//   GET /donors/:id/status   the tags under the name, the closeness line, the
//                            at-a-glance figures, the highlights and the next
//                            action with a suggested ask. Read only.
//   GET /settings/giving-levels, PUT /settings/giving-levels (admin)
//                            the two cut points between General, Mid and Major.
//
// Every number here is a figure with a source (figureSources.js), so each tag,
// fact and highlight opens the rows it came from. Nothing is stored: the tags
// are computed from the gifts every time (donorStatus.js).
const express = require("express");
const DS = require("../donorStatus");
const FS = require("../figureSources");
const drift = require("../drift");
const E = require("../engagement");
const DT = require("../donorTags");
const refusedLine = n => (n === 1 ? "One row from your import couldn't be read." : `${n} rows from your import couldn't be read.`);

const routers = { r0: express.Router() };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmt = d => DS.dollars(Math.round(Number(d || 0) * 100));
const times = n => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
function ago(days) {
  if (days == null) return null;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

function mount(ctx) {
const { actor, checkWriteAccess, orgTime, query, requireAdmin, requireAuth, run, wrap } = ctx;
const app = routers.r0;
let W = null;
const weights = async () => (W = W || await import("../shared/engagementWeights.js"));

// The closeness word and the facts that put them there. The word comes from
// the stored ENGAGE-1 band (closenessFor), the facts each from a source.
async function closeness(orgId, d, today, w) {
  const [score] = await query(`SELECT engagement, band FROM donor_scores WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]);
  // FIX-34: their pattern is read from the gifts now (engagement.closenessNow,
  // drift.js's rule), never the stored nightly column, so this word and the
  // drift badge computed on read cannot disagree.
  const { key } = await E.closenessNow(query, orgId, d.id, today, score ? score.band : "distant");
  const facts = [];
  const add = async (source, text) => {
    const v = await FS.figureValue(orgId, source);
    const t = text(v);
    if (t) facts.push({ text: t, source, value: v.value });
  };
  const ytd = { key: "donor-gifts-between", params: { donor: d.id, from: w.cyFrom, to: today } };
  const [ytdRows] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0 AND LEFT(date,10) BETWEEN ? AND ?`,
    [orgId, d.id, w.cyFrom, today]);
  if (ytdRows.n > 0) facts.push({ text: `gave ${times(ytdRows.n)} this year`, source: ytd });
  // WIRE-1 addendum: their own rhythm, said by drift.js's rule, so "gave once
  // this year" reads as the pattern it is for a once-a-year donor.
  if (key === "on_track") {
    const gs = await query(`SELECT LEFT(date,10) AS date, amount::text AS amount FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0 AND LEFT(date,10) <= ?`,
      [orgId, d.id, today]);
    const a = drift.assessDrift(gs.map(g => ({ date: g.date, amount: Number(g.amount) })), today);
    const rhythm = a.seasonal && a.seasonal.kind === "month" ? `every ${MONTHS[a.seasonal.month - 1]}` : drift.humanCadence(a.cadenceDays);
    if (a.state === "ok" && rhythm && a.firstGiftDate) {
      facts.unshift({ text: `gives ${rhythm}, latest gift on time`, source: { key: "donor-gifts-between", params: { donor: d.id, from: a.firstGiftDate, to: today } } });
    }
  }
  await add({ key: "volunteer-hours", params: { from: w.w0From, to: today, donor: d.id } },
    v => (v.value > 0 ? `${Number(v.value).toLocaleString("en-US")} volunteer hours in the last 12 months` : null));
  const evSrc = { key: "donor-engagement-part", params: { donor: d.id, part: "events" } };
  const ev = await FS.figure(orgId, evSrc, {}, { pageSize: 5 });
  if (ev && ev.totalRows === 1) {
    const [e] = await query(`SELECT e.name FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
       WHERE a.org_id = ? AND a.donor_id = ? ORDER BY e.date DESC NULLS LAST LIMIT 1`, [orgId, d.id]).catch(() => []);
    facts.push({ text: e && e.name ? `came to ${e.name}` : "came to an event", source: evSrc });
  } else if (ev && ev.totalRows > 1) facts.push({ text: `came to ${ev.totalRows} events`, source: evSrc });
  await add({ key: "donor-membership", params: { donor: d.id } }, v => (v.value > 0 ? "a member" : null));
  await add({ key: "donor-fundraising", params: { donor: d.id } }, v => (v.value > 0 ? `raised ${fmt(v.value)} as a fundraiser` : null));
  await add({ key: "donor-engagement-part", params: { donor: d.id, part: "surveys" } }, v => (v.value > 0 ? "answered a survey" : null));
  const emailSrc = { key: "donor-engagement-part", params: { donor: d.id, part: "email" } };
  const em = await FS.figure(orgId, emailSrc, {}, { pageSize: 1 });
  if (em && em.totalRows > 0) facts.push({ text: `opened or clicked ${em.totalRows === 1 ? "an email" : `${em.totalRows} emails`}`, source: emailSrc });
  const gapSrc = { key: "donor-contact-gap", params: { donor: d.id, today } };
  const gap = await FS.figureValue(orgId, gapSrc);
  if (gap.totalRows > 0) facts.push({ text: `last conversation ${ago(Number(gap.value))}`, source: gapSrc });
  const label = DS.CLOSENESS[key].label;
  const why = {
    close: "Close and Warm are the engagement score's own bands: 67 and above is Close, 34 to 66 is Warm.",
    warm: "Close and Warm are the engagement score's own bands: 67 and above is Close, 34 to 66 is Warm.",
    on_track: "Their engagement score is 33 or below, but their latest gift came inside their own usual gap between gifts, so their giving is on its own pattern.",
    cooling: "Their engagement score is 33 or below, their first gift, conversation or shift was more than 90 days ago, and their giving is past their own usual gap (or they have given once and not since).",
    new: "Their engagement score is 33 or below, and their first gift, conversation or shift was in the last 90 days.",
  }[key];
  return { key, label, engagement: score ? Number(score.engagement) : null, sentence: why, facts };
}

// Plain facts from the record. Each is true from the data and opens its rows.
async function highlights(orgId, d, today, w) {
  const gifts = await query(`SELECT id, LEFT(date,10) AS date, amount::text AS amount, campaign_id, event_id
      FROM gifts WHERE org_id = ? AND donor_id = ? AND LEFT(date,10) <= ? ORDER BY date ASC, id ASC`, [orgId, d.id, today]);
  const pos = gifts.filter(g => Number(g.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(g.date));
  if (!pos.length) return [];
  const out = [];
  const between = (from, to) => ({ key: "donor-gifts-between", params: { donor: d.id, from, to } });
  const thisY = Number(today.slice(0, 4));
  const byYear = new Map();
  for (const g of gifts) {
    const y = Number(String(g.date).slice(0, 4));
    if (!y) continue;
    byYear.set(y, (byYear.get(y) || 0) + Math.round(Number(g.amount) * 100));
  }
  // Upgraded: the last full year they gave against the year before it, or this
  // year once it has already passed last year.
  const cmp = [[thisY - 1, thisY], [thisY - 2, thisY - 1]].find(([a, b]) => (byYear.get(a) || 0) > 0 && (byYear.get(b) || 0) > (byYear.get(a) || 0));
  if (cmp) {
    const [a, b] = cmp;
    out.push({ key: "upgraded", text: `Upgraded from ${DS.dollars(byYear.get(a))} in ${a} to ${DS.dollars(byYear.get(b))}${b === thisY ? " so far this year" : ` in ${b}`}`,
      source: between(`${a}-01-01`, b === thisY ? today : `${b}-12-31`) });
  }
  // Years in a row, ending this year or last.
  const gaveIn = new Set(pos.map(g => Number(g.date.slice(0, 4))));
  let end = gaveIn.has(thisY) ? thisY : gaveIn.has(thisY - 1) ? thisY - 1 : null;
  if (end) {
    let n = 0;
    while (gaveIn.has(end - n)) n++;
    if (n >= 2) out.push({ key: "streak", text: `Has given ${n} years in a row`, source: between(`${end - n + 1}-01-01`, end === thisY ? today : `${end}-12-31`) });
  }
  // Where the first gift came from.
  const first = pos[0];
  const firstSrc = { key: "donor-first-gift", params: { donor: d.id } };
  if (first.event_id) {
    const [e] = await query(`SELECT name, LEFT(date::text,4) AS y FROM events WHERE id = ? AND org_id = ?`, [first.event_id, orgId]);
    if (e) out.push({ key: "first-at", text: `First gift was at ${/\b(19|20)\d{2}\b/.test(e.name) || !e.y ? e.name : `the ${e.y} ${e.name}`}`, source: firstSrc });
  } else if (first.campaign_id) {
    const [c] = await query(`SELECT name FROM campaigns WHERE id = ? AND org_id = ?`, [first.campaign_id, orgId]);
    if (c) out.push({ key: "first-at", text: `First gift came from ${c.name}`, source: firstSrc });
  }
  // A season: drift.js's own definition (three years or more, 80% of gifts in
  // one month).
  const season = drift.detectSeasonalCluster(pos.map(g => ({ date: g.date })));
  if (season && season.kind === "month") {
    out.push({ key: "season", text: `Gives every ${MONTHS[season.month - 1]}`, source: between(pos[0].date, today) });
  }
  // The largest gift is the latest one.
  if (pos.length >= 2) {
    const last = pos[pos.length - 1];
    const maxC = Math.max(...pos.map(g => Math.round(Number(g.amount) * 100)));
    if (Math.round(Number(last.amount) * 100) === maxC && pos.filter(g => Math.round(Number(g.amount) * 100) === maxC).length === 1) {
      out.push({ key: "largest-latest", text: `Their latest gift, ${DS.dollars(maxC)}, is their largest`, source: { key: "donor-largest-gift", params: { donor: d.id } } });
    }
  }
  return out.slice(0, 4);
}

// The next action, in one line, from the same facts WHY-1's journey suggestion
// reads, and the suggested ask from ENGAGE-1 (engagement.suggestedAsk).
async function nextAction(orgId, d, today, status, glanceLast, viewerMaySee = false) {
  const [[thread], [sub], [score], [unthanked]] = await Promise.all([
    // FIX-27 Part 5: the CURRENT open step, the newest one, as the rail reads it.
    query(`SELECT next_step_label, due_date FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL
            ORDER BY COALESCE(edited_at, created_at) DESC NULLS LAST, id DESC LIMIT 1`, [orgId, d.id]),
    query(`SELECT 1 AS y FROM recurring_subscriptions WHERE org_id = ? AND donor_id = ? AND status IN ('active','past_due','recovering','recovered') LIMIT 1`, [orgId, d.id]),
    query(`SELECT generosity FROM donor_scores WHERE org_id = ? AND donor_id = ?`, [orgId, d.id]),
    query(`SELECT 1 AS y FROM thank_you_drafts WHERE org_id = ? AND donor_id = ? AND sent_at IS NULL AND skipped_at IS NULL LIMIT 1`, [orgId, d.id]).catch(() => []),
  ]);
  let drifting = false;
  try { drifting = !!(ctx.computeDriftForDonors && (await ctx.computeDriftForDonors(orgId, { donorIds: [d.id] })).map.get(d.id)?.state === "drifting"); } catch { drifting = false; }
  const lc = status.row ? status.row.lifecycle : null;
  const [{ n: giftCount }] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0`, [orgId, d.id]);
  let step, why;
  if (thread) {
    step = thread.next_step_label; why = `This is the open next step, due ${thread.due_date}.`;
    // FIX-24 2c: with no proposal open, the step cannot be "send the proposal".
    const NA = await import("../shared/nextStepAgree.js");
    const PS = await import("../shared/proposalShape.js");
    const [{ n: openProps }] = await query(`SELECT COUNT(*)::int AS n FROM opportunities WHERE org_id = ? AND donor_id = ? AND proposal_stage = ANY(?::text[])`,
      [orgId, d.id, PS.OPEN_STAGE_KEYS]);
    const agreed = NA.stepAgainstProposals(step, openProps);
    if (agreed.changed) { step = agreed.label; why = agreed.why; }
  }
  else if (unthanked) { step = `thank them for their ${glanceLast ? fmt(glanceLast) + " " : ""}gift`; why = "Their latest gift has a thank-you waiting to be sent."; }
  else if (lc === "lapsed" || drifting) { step = "ask them back"; why = lc === "lapsed" ? DS.LIFECYCLES.lapsed.sentence : "They are past their usual gap between gifts."; }
  else if (lc === "new" && giftCount === 1) { step = "ask for a second gift"; why = "Their first gift was in the last 12 months and they have not given again."; }
  else if (sub) { step = "thank them for giving every month"; why = "They have a monthly gift running."; }
  else if (score && Number(score.generosity) >= 80) { step = "invite them to a visit"; why = "Their giving puts them among your most generous (generosity 80 or more)."; }
  else if (giftCount >= 2) { step = "ask about monthly giving"; why = "They have given more than once and do not give monthly yet."; }
  else if (giftCount === 1) { step = "ask for a second gift"; why = "They have given once."; }
  else { step = "get to know them"; why = "They have not given yet."; }
  // PROSPECT-1 — screening results move the ask only for a viewer who may see them.
  const P = require("../prospect");
  // WIRE-1 addendum: the ask beside "ask about monthly giving" is a MONTHLY
  // amount sized from their own year, and says "a month"; every other ask is
  // one gift. Same function, one rule (engagement.suggestedAsk).
  const monthly = step === "ask about monthly giving";
  const ask = giftCount > 0 ? await E.suggestedAsk(query, orgId, d.id,
    { monthly, ...(viewerMaySee ? { screening: (await P.latestScreening(orgId, [d.id])).get(d.id) || null } : {}) }) : null;
  const said = String(step).trim().replace(/[.!?]+$/, "");
  const text = `Next: ${said}.` + (ask ? ` Suggested ${ask.monthly ? "ask" : "one-time ask"}: ${DS.dollars(ask.askCents)}${ask.monthly ? " a month" : ""}.` : "");
  return { step, text, why, ask: ask ? { cents: ask.askCents, monthly: !!ask.monthly, sentence: ask.sentence, screening: !!ask.screening } : null };
}

app.get("/donors/:id/status", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, name, created_at FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = await DS.todayFor(orgId);
  const w = DS.windowsFor(today);
  const status = await DS.statusFor(orgId, d.id, { today });
  // At a glance. Each value is the figure's own, from its source.
  const src = k => ({ key: k, params: { donor: d.id } });
  const [lifetime, first, latest, largest, average] = await Promise.all(
    ["donor-lifetime", "donor-first-gift", "donor-latest-gift-alias", "donor-largest-gift", "donor-average-gift"].map(async k => {
      const key = k === "donor-latest-gift-alias" ? "donor-last-gift" : k;
      const f = await FS.figure(orgId, src(key), {}, { pageSize: 1 });
      return { source: src(key), label: f.label, sentence: f.sentence, value: f.totalRows ? f.value : null, date: f.rows[0] ? f.rows[0].date : null, count: f.totalRows };
    }));
  const glance = { lifetime, first, latest, largest, average };
  const [hl, close, next] = await Promise.all([
    highlights(orgId, d, today, w),
    closeness(orgId, d, today, w),
    nextAction(orgId, d, today, status, latest.value, await require("../prospect").canSee(req.user.userId)),
  ]);
  // PARITY-3 — one plain line for a volunteer: "44 hours since 2023, last
  // served May 22", opening the shifts it adds up.
  const [vh] = await query(`SELECT COALESCE(SUM(ROUND(hours*100)),0)::bigint AS h, MIN(date) AS first, MAX(date) AS last
                              FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, d.id]);
  let volunteer = null;
  if (vh && Number(vh.h) > 0) {
    const hrs = Number(vh.h) / 100, first = String(vh.first).slice(0, 10), last = String(vh.last).slice(0, 10);
    const md = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)))
      .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + (iso.slice(0, 4) !== today.slice(0, 4) ? `, ${iso.slice(0, 4)}` : "");
    volunteer = { line: `${hrs} ${hrs === 1 ? "hour" : "hours"} volunteered since ${first.slice(0, 4)}, last served ${md(last)}`,
      sentence: "Every volunteer shift logged for this person, added up. Each shift also counts toward their engagement score.",
      source: { key: "volunteer-hours", params: { from: "1900-01-01", to: "2999-12-31", donor: d.id } } };
  }
  // FIX-33 · rows of theirs an import could not read: a plain line for an
  // admin, never a tag ("HAS-REFUSED-ROWS:2" under the name), opening the rows.
  let importRefusals = null;
  const [me] = await query(`SELECT role FROM users WHERE id = ? AND org_id = ?`, [req.user.userId, orgId]);
  if (me && me.role === "admin") {
    const [t] = await query(`SELECT tags FROM donors WHERE id = ? AND org_id = ?`, [d.id, orgId]);
    const n = DT.refusedRowsOf(t && t.tags);
    if (n > 0) importRefusals = { count: n, line: refusedLine(n), rowsPath: `/donors/${d.id}/refused-rows` };
  }
  // FIX-33 · a booked meeting answers "Cooling" and "Drifting" on the same
  // line, so nobody calls her twice.
  const meetingSet = (await require("../meetingEffects").meetingSetFor(orgId, [d.id])).get(d.id) || null;
  res.json({ today, tags: status.tags, closeness: close, glance, highlights: hl, next, cuts: status.cuts, volunteer, importRefusals, meetingSet });
}));

// FIX-33 · the rows behind that line. The importer keeps each refused row
// (line, reason, the cells as read) on the run it recorded (imports.summary_json
// .refusedRows); this reads the runs that made or fed this person and returns
// their rows. A run recorded before the importer kept them says so plainly.
app.get("/donors/:id/refused-rows", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, name, tags, created_import_id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const count = DT.refusedRowsOf(d.tags);
  const runIds = (await query(`SELECT DISTINCT import_id AS id FROM gifts WHERE org_id = ? AND donor_id = ? AND import_id IS NOT NULL`, [orgId, d.id])).map(r => r.id);
  if (d.created_import_id) runIds.push(d.created_import_id);
  const runs = runIds.length
    ? await query(`SELECT id, name, committed_at, summary_json FROM imports WHERE org_id = ? AND id = ANY(?) ORDER BY committed_at DESC`, [orgId, [...new Set(runIds)]])
    : [];
  const norm = v => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  const rows = [];
  let kept = false;
  for (const r of runs) {
    const sum = typeof r.summary_json === "string" ? JSON.parse(r.summary_json || "{}") : (r.summary_json || {});
    if (!Array.isArray(sum.refusedRows)) continue;
    kept = true;
    for (const x of sum.refusedRows) {
      if (norm(x.name) === norm(d.name)) rows.push({ importId: r.id, importName: r.name, line: x.line ?? null, reason: x.reason || null, raw: x.raw || {} });
    }
  }
  res.json({ donorId: d.id, count, line: count ? refusedLine(count) : null, rows,
    unavailable: kept ? null : "The import that read this person ran before Steward kept the rows it could not read. Run the file again to see them." });
}));

app.get("/settings/giving-levels", requireAuth, wrap(async (req, res) => {
  const cuts = await DS.cutsFor(req.user.orgId);
  res.json({ ...cuts, defaults: DS.DEFAULT_CUTS, sentence: DS.levelSentence(cuts) });
}));

app.put("/settings/giving-levels", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const toCents = v => {
    const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  const mid = toCents(req.body && req.body.mid);
  const major = toCents(req.body && req.body.major);
  if (!mid || !major) return res.status(400).json({ error: "invalid_levels", message: "Both cut points are dollar amounts above zero." });
  if (major <= mid) return res.status(400).json({ error: "invalid_levels", message: "Major has to start above Mid." });
  await run(`UPDATE orgs SET giving_level_mid_cents = ?, giving_level_major_cents = ? WHERE id = ?`, [mid, major, req.user.orgId]);
  const cuts = await DS.cutsFor(req.user.orgId);
  res.json({ ...cuts, defaults: DS.DEFAULT_CUTS, sentence: DS.levelSentence(cuts) });
}));
}

module.exports = { routers, mount };

// server/admin/sales/customers.js · SALES-3 Part B. KEEP: THE CUSTOMER-SUCCESS BOARD, NURTURE, PROOF.
//
// The board: one row per sales organization linked to a Steward org (beta or paying), with the
// plan, the price, billing's start or next charge, the days to it, and a plain health line made
// from facts Steward already has. COUNTS AND DATES ONLY, never donor data: no name, no email, no
// amount of a gift (the test plants a donor in the customer's org and looks for it). Each fact
// opens its source: the dated counts behind it (factRows). Health is a rule Jonathan edits in
// Sales settings (e.g. "no sign-in in 10 days" = Needs a call), shown as words, never a score.
//
// Nurture: a pilot's rhythm, tasks only, nothing sent. A weekly check-in call until billing
// starts and a 30-day review. A logged check-in ("what annoyed you this week?") lands on the deal
// timeline; any line tagged bug becomes a row on /ops's board (ops_checks, the same rows the
// fleet's board reads), named as that customer's.
//
// Proof: the testimonial (asked, received, approved to publish, with its text and the approval
// day) and references (asked for, then each one named → contacted → meeting → won, read from the
// referral deals SALES-2 makes with source "Customer referral"). "Owes" is a line, not a memory.
//
// THE PLANTED DEFECTS (SALES3_PLANT on the server, TEST_MODE=1, tests only):
//   donorname  the health line names the org's newest donor                     → §5
//   bugnote    a line tagged bug never reaches the /ops board                   → §6
"use strict";
const crypto = require("crypto");
const { newId } = require("../../shared/newId");
const { GIFT } = require("../../../shared/numbers/money");
const LINK = require("./stewardLink");
const Q = require("./quotes");

const PLANT = Q.PLANT;
const DAY = 86400000;
const TZ = "America/New_York";
const civil = (t, tz = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numWords = n => (n >= 0 && n <= 10 ? NUM[n] : String(n));

// ── The facts, and the sentence that defines each ───────────────────────────
const FACTS = {
  daysSinceSignIn: { label: "Days since anyone signed in", words: v => (v == null ? "no one has signed in yet" : v === 0 ? "signed in today" : `last sign-in ${plural(v, "day")} ago`),
    sentence: "Days since the latest day someone at the org (not Steward's staff) signed in or was active." },
  signIns14: { label: "Sign-ins in the last 14 days", words: v => `${plural(v, "sign-in")} in the last 14 days`,
    sentence: "Sessions started by people at the org (not Steward's staff) in the last 14 days." },
  people: { label: "People imported", words: v => `${plural(v, "person", "people")} in Steward`,
    sentence: "People in the org's Steward, not counting sample data or deleted people. A count only." },
  gifts30: { label: "Gifts recorded in the last 30 days", words: v => `${plural(v, "gift")} recorded in the last 30 days`,
    sentence: "Gifts above zero entered or synced into the org's Steward in the last 30 days (by when they were recorded), not sample data. A count only." },
  journeysOn: { label: "Journeys on", words: v => `${plural(v, "journey")} on`,
    sentence: "Journeys with at least one step the org has turned on to send." },
  dataHealthOpen: { label: "Open data-health items", words: v => (v == null ? "no data-health check yet" : `${plural(v, "data-health item")} open`),
    sentence: "From the org's latest data-health check: possible duplicates, addresses to tidy or unreadable, emails to fix, names with notes in them and event duplicates." },
  daysToStart: { label: "Days to billing", words: v => (v == null ? "no billing day" : v < 0 ? `billing started ${plural(-v, "day")} ago` : `billing starts in ${plural(v, "day")}`),
    sentence: "Days from today to the first charge: the accepted quote's start day, or the org's trial end." },
};
const OPS = { ">=": (a, b) => a >= b, ">": (a, b) => a > b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, "=": (a, b) => a === b };
const DEFAULT_HEALTH = { rules: [
  { fact: "daysSinceSignIn", op: ">=", value: 10, says: "Needs a call" },
  { fact: "people", op: "=", value: 0, says: "No donors in yet" },
  { fact: "signIns14", op: "<", value: 3, says: "Barely signing in" },
  { fact: "gifts30", op: "=", value: 0, says: "No gifts recorded this month" },
] };
function cleanHealth(v) {
  const rules = (v && Array.isArray(v.rules) ? v.rules : []).map(r => ({
    fact: FACTS[r && r.fact] ? r.fact : null, op: OPS[r && r.op] ? r.op : null, value: Math.round(Number(r && r.value)),
    says: String(r && r.says || "").replace(/\s+/g, " ").trim().slice(0, 80),
  })).filter(r => r.fact && r.op && Number.isFinite(r.value) && r.says).slice(0, 12);
  return v && Array.isArray(v.rules) ? { rules } : DEFAULT_HEALTH;
}
async function healthRule(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'health'`);
  return cleanHealth(r ? r.value : null);
}

// Pure: a customer's facts and the rule → words. A fact never seen (no sign-in yet) matches a
// "days since" rule: never is longer than any number of days.
function healthOf(f, rule) {
  const hits = [];
  for (const r of rule.rules) {
    const v = f[r.fact];
    const match = v == null ? (r.fact === "daysSinceSignIn" && (r.op === ">=" || r.op === ">")) : OPS[r.op](Number(v), r.value);
    if (match) hits.push({ ...r, words: FACTS[r.fact].words(v) });
  }
  if (hits.length) return { ok: false, says: hits.map(h => `${h.says}: ${h.words}`).join(". ") + ".", facts: hits.map(h => h.fact) };
  return { ok: true, says: `On track: ${[FACTS.daysSinceSignIn.words(f.daysSinceSignIn), FACTS.signIns14.words(f.signIns14), FACTS.gifts30.words(f.gifts30)].join(", ")}.`, facts: [] };
}

// ── Reading the facts, one statement per fact across every customer ─────────
const OPEN_KEYS = ["duplicates", "addressesToTidy", "addressesUnreadable", "emails", "namesWithNotes", "eventDuplicates"];
async function customers(query) {
  return query(`SELECT o.id, o.name, o.steward_org_id FROM sales_orgs o WHERE o.deleted_at IS NULL AND o.steward_org_id IS NOT NULL ORDER BY o.name`);
}
async function readFacts(query, stewardIds, now) {
  if (!stewardIds.length) return {};
  const safe = p => p.catch(e => { if (e && e.code === "42P01") return []; throw e; });
  const since14 = new Date(now - 14 * DAY).toISOString(), since30 = new Date(now - 30 * DAY).toISOString();
  const [base, orgs, signIns, gifts, journeys, health] = await Promise.all([
    LINK.facts(query, stewardIds),
    query(`SELECT id, plan, subscription_status, custom_price_cents, trial_ends_at, current_period_end, timezone FROM orgs WHERE id = ANY(?)`, [stewardIds]),
    query(`SELECT s.org_id, COUNT(*)::int AS n FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
            WHERE s.org_id = ANY(?) AND COALESCE(u.is_super_admin, false) = false AND s.created_at >= ? GROUP BY s.org_id`, [stewardIds, since14]),
    query(`SELECT g.org_id, COUNT(*)::int AS n FROM gifts g WHERE g.org_id = ANY(?) AND ${GIFT("g")} AND COALESCE(g.is_sample, false) = false
            AND g.created_at >= ? GROUP BY g.org_id`, [stewardIds, since30]),
    safe(query(`SELECT org_id, COUNT(DISTINCT template_id)::int AS n FROM journey_auto_steps WHERE org_id = ANY(?) AND turned_off_at IS NULL GROUP BY org_id`, [stewardIds])),
    safe(query(`SELECT DISTINCT ON (org_id) org_id, counts, created_at FROM data_health_runs WHERE org_id = ANY(?) ORDER BY org_id, created_at DESC`, [stewardIds])),
  ]);
  const by = rows => new Map(rows.map(r => [r.org_id || r.id, r]));
  const o = by(orgs), si = by(signIns), gi = by(gifts), jo = by(journeys), dh = by(health);
  const out = {};
  for (const id of stewardIds) {
    const b = base[id];
    if (!b) continue;
    const org = o.get(id) || {};
    const today = civil(now, org.timezone || TZ);
    const last = b.lastSignInAt ? civil(b.lastSignInAt, org.timezone || TZ) : null;
    const run = dh.get(id);
    out[id] = { base: b, org, today,
      daysSinceSignIn: last ? Math.max(0, daysBetween(last, today)) : null,
      signIns14: Number((si.get(id) || {}).n || 0), people: b.peopleImported, gifts30: Number((gi.get(id) || {}).n || 0),
      journeysOn: Number((jo.get(id) || {}).n || 0),
      dataHealthOpen: run ? OPEN_KEYS.reduce((n, k) => n + (Number((run.counts || {})[k]) || 0), 0) : null,
      dataHealthAt: run ? new Date(run.created_at).toISOString() : null };
  }
  return out;
}

// The board's rows. `accepted`: the customer's accepted quote, when there is one.
async function board(query, now = Date.now()) {
  const list = await customers(query);
  const sids = [...new Set(list.map(c => c.steward_org_id))];
  const [facts, rule, quotes, proofs] = await Promise.all([readFacts(query, sids, now), healthRule(query),
    query(`SELECT DISTINCT ON (l.b_id) l.b_id AS sales_org_id, q.deal_id, q.plan_name, q.price_cents, q.start_on::text AS start_on, q.accepted_at
             FROM sales_quotes q JOIN sales_links l ON l.a_type = 'deal' AND l.a_id = q.deal_id AND l.b_type = 'org'
            WHERE q.status = 'accepted' ORDER BY l.b_id, q.accepted_at DESC`),
    proofLines(query, list.map(c => c.id))]);
  const qBy = new Map(quotes.map(r => [r.sales_org_id, r]));
  const rows = [];
  for (const c of list) {
    const f = facts[c.steward_org_id];
    if (!f) continue;
    const q = qBy.get(c.id);
    const status = f.org.subscription_status || null;
    const paying = status === "active";
    const startOn = q ? q.start_on : (f.org.trial_ends_at ? civil(f.org.trial_ends_at, f.org.timezone || TZ) : null);
    const nextCharge = paying && f.org.current_period_end ? civil(f.org.current_period_end, f.org.timezone || TZ) : null;
    const facts1 = { ...f, daysToStart: startOn && !paying ? daysBetween(f.today, startOn) : null };
    const health = healthOf(facts1, rule);
    let says = health.says;
    if (PLANT === "donorname") {
      const [d] = await query(`SELECT name FROM donors WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`, [c.steward_org_id]);
      if (d) says += ` Newest: ${d.name}.`;
    }
    rows.push({
      salesOrgId: c.id, name: c.name, stewardOrgId: c.steward_org_id, dealId: q ? q.deal_id : null, status,
      plan: q ? q.plan_name : f.org.plan || null,
      priceCents: q ? Number(q.price_cents) : paying ? f.base.mrrNowCents : (f.org.custom_price_cents != null ? Number(f.org.custom_price_cents) : null),
      billing: paying ? { kind: "next", on: nextCharge } : { kind: "start", on: startOn },
      daysToStart: facts1.daysToStart,
      facts: Object.fromEntries(Object.keys(FACTS).map(k => [k, facts1[k] === undefined ? null : facts1[k]])),
      dataHealthAt: f.dataHealthAt,
      health: { ok: health.ok, says, facts: health.facts },
      proof: proofs.get(c.id) || null,
    });
  }
  // Those that need something first, then the soonest billing.
  rows.sort((a, b) => (a.health.ok - b.health.ok) || ((a.daysToStart == null) - (b.daysToStart == null)) || ((a.daysToStart || 0) - (b.daysToStart || 0)) || a.name.localeCompare(b.name));
  return { rows, rule, facts: Object.fromEntries(Object.entries(FACTS).map(([k, v]) => [k, { label: v.label, sentence: v.sentence }])),
    sentences: { board: "Every organization linked to a Steward org. Counts and dates only: no donor's name, email or gift amount is read here.",
      health: "The health rule in Sales settings, applied to the facts. Each fact opens what it counted.",
      price: "The accepted quote's monthly price; for a paying org with no quote, what its subscription bills." } };
}

// ── What a fact counted: dated counts, never a donor ─────────────────────────
async function factRows(query, salesOrgId, key, now = Date.now()) {
  const [c] = await query(`SELECT id, name, steward_org_id FROM sales_orgs WHERE id = ? AND deleted_at IS NULL AND steward_org_id IS NOT NULL`, [salesOrgId]);
  if (!c || !FACTS[key]) return null;
  const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [c.steward_org_id]);
  const tz = (o && o.timezone) || TZ, id = c.steward_org_id;
  const day = col => `to_char(${col} AT TIME ZONE '${tz.replace(/'/g, "")}', 'YYYY-MM-DD')`;
  let rows = [];
  if (key === "daysSinceSignIn" || key === "signIns14") {
    rows = await query(`SELECT ${day("s.created_at")} AS day, COUNT(*)::int AS n FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
                         WHERE s.org_id = ? AND COALESCE(u.is_super_admin, false) = false AND s.created_at >= ? GROUP BY 1 ORDER BY 1 DESC LIMIT 60`,
      [id, new Date(now - (key === "signIns14" ? 14 : 90) * DAY).toISOString()]);
    rows = rows.map(r => ({ day: r.day, says: plural(r.n, "sign-in") }));
  } else if (key === "people") {
    rows = (await query(`SELECT ${day("d.created_at")} AS day, COUNT(*)::int AS n FROM donors d WHERE d.org_id = ? AND ${require("../../../shared/numbers/households").PERSON("d")}
                          GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [id])).map(r => ({ day: r.day, says: `${plural(r.n, "person", "people")} added` }));
  } else if (key === "gifts30") {
    rows = (await query(`SELECT ${day("g.created_at")} AS day, COUNT(*)::int AS n FROM gifts g WHERE g.org_id = ? AND ${GIFT("g")} AND COALESCE(g.is_sample, false) = false
                          AND g.created_at >= ? GROUP BY 1 ORDER BY 1 DESC`, [id, new Date(now - 30 * DAY).toISOString()])).map(r => ({ day: r.day, says: `${plural(r.n, "gift")} recorded` }));
  } else if (key === "journeysOn") {
    rows = (await query(`SELECT t.name, MIN(a.turned_on_at) AS t FROM journey_auto_steps a JOIN cultivation_templates t ON t.id = a.template_id AND t.org_id = a.org_id
                          WHERE a.org_id = ? AND a.turned_off_at IS NULL GROUP BY t.name ORDER BY 2 DESC`, [id]).catch(() => []))
      .map(r => ({ day: civil(r.t, tz), says: `Journey "${r.name}" on` }));
  } else if (key === "dataHealthOpen") {
    const [run] = await query(`SELECT counts, created_at FROM data_health_runs WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`, [id]).catch(() => []);
    rows = run ? OPEN_KEYS.map(k => ({ day: civil(run.created_at, tz), says: `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${Number((run.counts || {})[k]) || 0}` })) : [];
  } else if (key === "daysToStart") {
    const b = (await board(query, now)).rows.find(r => r.salesOrgId === salesOrgId);
    rows = b && b.billing.on ? [{ day: b.billing.on, says: b.dealId ? "The accepted quote's start day" : "The org's trial end" }] : [];
  }
  return { name: c.name, key, label: FACTS[key].label, sentence: FACTS[key].sentence, rows };
}

// ── Nurture: tasks only ─────────────────────────────────────────────────────
const CHECKIN_PROMPT = "What annoyed you this week?";
async function dealFor(query, salesOrgId) {
  const [d] = await query(`SELECT d.id FROM sales_links l JOIN sales_deals d ON d.id = l.a_id AND d.deleted_at IS NULL LEFT JOIN sales_stages s ON s.id = d.stage_id
                            WHERE l.a_type = 'deal' AND l.b_type = 'org' AND l.b_id = ? ORDER BY (s.kind = 'open') DESC NULLS LAST, (s.kind = 'won') DESC NULLS LAST, d.created_at DESC LIMIT 1`, [salesOrgId]);
  return d ? d.id : null;
}
async function startNurture(ctx, salesOrgId, who, now = Date.now()) {
  const [c] = await ctx.query(`SELECT id, name, steward_org_id FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [salesOrgId]);
  if (!c) return { error: "not_found" };
  const running = await ctx.query(`SELECT id FROM sales_nurture WHERE sales_org_id = ? AND ended_at IS NULL`, [salesOrgId]);
  if (running.length) return { error: "invalid", message: `${c.name} already has a nurture rhythm running.` };
  const today = civil(now);
  const row = (await board(ctx.query, now)).rows.find(r => r.salesOrgId === salesOrgId);
  const until = row && row.billing.kind === "start" && row.billing.on && row.billing.on > today ? row.billing.on : addDays(today, 30);
  const dealId = await dealFor(ctx.query, salesOrgId);
  const records = [{ type: "org", id: c.id }, ...(dealId ? [{ type: "deal", id: dealId }] : [])];
  const ACT = require("./activities");
  const id = newId("snu");
  await ctx.run(`INSERT INTO sales_nurture (id, sales_org_id, deal_id, started_on, until_on, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, c.id, dealId, today, until, who.id, who.name]);
  let n = 0;
  for (let d = addDays(today, 7); d <= until && n < 12; d = addDays(d, 7)) {
    n++;
    await ACT.create(ctx, { kind: "task", due_on: d, records, body: `Weekly check-in call with ${c.name}. Ask: "${CHECKIN_PROMPT}" Log the answers from the Customers board.` }, who);
  }
  await ACT.create(ctx, { kind: "task", due_on: addDays(today, 30), records, body: `30-day review with ${c.name}: what's working, what isn't, and is the price right.` }, who);
  return { ok: true, id, checkIns: n, until, says: `${plural(n, "weekly check-in")} until ${until}, and a 30-day review. Tasks only; nothing is sent.` };
}

// A logged check-in: the answers on the deal's timeline, and each bug line on /ops's board.
// b: { lines: [{ text, bug }] }
async function logCheckin(ctx, salesOrgId, b, who, now = Date.now()) {
  const [c] = await ctx.query(`SELECT id, name FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [salesOrgId]);
  if (!c) return { error: "not_found" };
  const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ text: String(l && l.text || "").replace(/\s+/g, " ").trim().slice(0, 1000), bug: !!(l && l.bug) })).filter(l => l.text).slice(0, 30);
  if (!lines.length) return { error: "invalid", message: "Write at least one answer." };
  const dealId = await dealFor(ctx.query, salesOrgId);
  const body = [`Check-in with ${c.name}: "${CHECKIN_PROMPT}"`, ...lines.map(l => `- ${l.bug ? "[bug] " : ""}${l.text}`)].join("\n");
  const act = await require("./activities").create(ctx, { kind: "note", at: new Date(now).toISOString(), body,
    records: [{ type: "org", id: c.id }, ...(dealId ? [{ type: "deal", id: dealId }] : [])] }, who);
  const filed = [];
  if (PLANT !== "bugnote") {
    for (const l of lines.filter(x => x.bug)) {
      const id = "opc_" + crypto.randomBytes(9).toString("hex");
      const check = `Cust-${id.slice(4, 12)}`;
      await ctx.run(`INSERT INTO ops_checks (id, area_id, check_id, verdict, note, created_at, created_by, created_by_name, customer)
                     VALUES (?, 'customers', ?, 'fail', ?, ?, ?, ?, ?)`, [id, check, l.text, new Date(now).toISOString(), who.id, who.name, c.name]);
      filed.push({ id, check });
    }
  }
  return { ok: true, activityId: act.id, filed, says: filed.length ? `Logged on the timeline; ${plural(filed.length, "bug")} added to the /ops board for ${c.name}.` : "Logged on the timeline." };
}

// ── Proof ───────────────────────────────────────────────────────────────────
const T_STATES = ["none", "asked", "received", "approved"];
const REF_STEPS = ["named", "contacted", "meeting", "won"];
async function referralsOf(query, ids) {
  if (!ids.length) return [];
  return query(`SELECT d.id, d.name, d.referred_by_sales_org_id AS from_id, d.won_at, s.position, s.kind,
                  EXISTS (SELECT 1 FROM sales_activity_links al JOIN sales_activities a ON a.id = al.activity_id AND a.deleted_at IS NULL AND a.kind = 'meeting'
                           WHERE al.record_type = 'deal' AND al.record_id = d.id) AS met,
                  EXISTS (SELECT 1 FROM sales_activity_links al JOIN sales_activities a ON a.id = al.activity_id AND a.deleted_at IS NULL AND a.kind IN ('call', 'meeting')
                           WHERE al.record_type = 'deal' AND al.record_id = d.id)
                  OR EXISTS (SELECT 1 FROM sales_email_links el WHERE el.record_type = 'deal' AND el.record_id = d.id) AS touched,
                  (SELECT MIN(p.position) FROM sales_stages p WHERE p.pipeline_id = d.pipeline_id AND lower(p.name) = 'contacted') AS contacted_pos,
                  (SELECT MIN(p.position) FROM sales_stages p WHERE p.pipeline_id = d.pipeline_id AND lower(p.name) = 'meeting booked') AS meeting_pos
             FROM sales_deals d LEFT JOIN sales_stages s ON s.id = d.stage_id
            WHERE d.referred_by_sales_org_id = ANY(?) AND d.deleted_at IS NULL ORDER BY d.created_at`, [ids]).catch(e => {
    if (e && e.code === "42P01") return [];   // sales_email_links not made on a fresh scratch
    throw e;
  });
}
function refStep(r) {
  if (r.won_at) return "won";
  const at = (p) => p != null && r.position != null && Number(r.position) >= Number(p) && r.kind === "open";
  if (r.met || at(r.meeting_pos)) return "meeting";
  if (r.touched || at(r.contacted_pos)) return "contacted";
  return "named";
}
// The owes line, in words: "Allie owes a testimonial and two references."
function owesLine(who, p, refs) {
  const owed = [];
  if (p.testimonial_state === "asked") owed.push("a testimonial");
  if (p.testimonial_state === "received") owed.push("approval to publish her testimonial");
  const refsOwed = Math.max(0, Number(p.references_asked || 0) - refs.length);
  if (refsOwed) owed.push(`${numWords(refsOwed)} reference${refsOwed === 1 ? "" : "s"}`);
  if (!owed.length) return null;
  return `${who} owes ${owed.length > 1 ? `${owed.slice(0, -1).join(", ")} and ${owed[owed.length - 1]}` : owed[0]}.`;
}
async function proofLines(query, ids) {
  if (!ids.length) return new Map();
  const [rows, refs, champs] = await Promise.all([
    query(`SELECT sales_org_id, testimonial_state, testimonial_text, testimonial_asked_on::text AS asked_on, testimonial_received_on::text AS received_on,
                  testimonial_approved_on::text AS approved_on, references_asked FROM sales_customer_proof WHERE sales_org_id = ANY(?)`, [ids]),
    referralsOf(query, ids),
    query(`SELECT DISTINCT ON (l.b_id) l.b_id AS org_id, c.first_name FROM sales_links l JOIN sales_contacts c ON c.id = l.a_id AND c.deleted_at IS NULL
            WHERE l.a_type = 'contact' AND l.b_type = 'org' AND l.b_id = ANY(?) ORDER BY l.b_id, (lower(COALESCE(l.label, '')) = 'champion') DESC, l.is_primary DESC, l.created_at`, [ids]),
  ]);
  const p = new Map(rows.map(r => [r.sales_org_id, r]));
  const ch = new Map(champs.map(r => [r.org_id, r.first_name]));
  const [names] = await Promise.all([query(`SELECT id, name FROM sales_orgs WHERE id = ANY(?)`, [ids])]);
  const nm = new Map(names.map(r => [r.id, r.name]));
  const out = new Map();
  for (const id of ids) {
    const row = p.get(id) || { testimonial_state: "none", references_asked: 0 };
    const mine = refs.filter(r => r.from_id === id).map(r => ({ dealId: r.id, name: r.name, step: refStep(r) }));
    out.set(id, { testimonial: { state: row.testimonial_state, text: row.testimonial_text || null, askedOn: row.asked_on || null, receivedOn: row.received_on || null, approvedOn: row.approved_on || null },
      referencesAsked: Number(row.references_asked || 0), referrals: mine,
      counts: Object.fromEntries(REF_STEPS.map(s => [s, mine.filter(r => REF_STEPS.indexOf(r.step) >= REF_STEPS.indexOf(s)).length])),
      owes: owesLine(ch.get(id) || nm.get(id) || "They", row, mine) });
  }
  return out;
}
// b: { testimonial_state?, testimonial_text?, references_asked? }. A state change stamps its day.
async function saveProof(ctx, salesOrgId, b, who, now = Date.now()) {
  const [c] = await ctx.query(`SELECT id FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [salesOrgId]);
  if (!c) return { error: "not_found" };
  const [cur] = await ctx.query(`SELECT testimonial_state, testimonial_text, references_asked FROM sales_customer_proof WHERE sales_org_id = ?`, [salesOrgId]);
  const state = b.testimonial_state !== undefined ? String(b.testimonial_state) : (cur ? cur.testimonial_state : "none");
  if (!T_STATES.includes(state)) return { error: "invalid", message: "A testimonial is asked, received or approved to publish." };
  const text = b.testimonial_text !== undefined ? (String(b.testimonial_text || "").trim().slice(0, 4000) || null) : (cur ? cur.testimonial_text : null);
  if ((state === "received" || state === "approved") && !text) return { error: "invalid", message: "Paste the testimonial's words first." };
  const refs = b.references_asked !== undefined ? Math.max(0, Math.min(20, Math.round(Number(b.references_asked) || 0))) : (cur ? cur.references_asked : 0);
  const today = civil(now);
  const was = cur ? cur.testimonial_state : "none";
  const stamp = (s, col) => (state === s && was !== s ? `, ${col} = '${today}'` : "");
  await ctx.run(`INSERT INTO sales_customer_proof (sales_org_id, created_by, created_by_name) VALUES (?, ?, ?) ON CONFLICT (sales_org_id) DO NOTHING`, [salesOrgId, who.id, who.name]);
  await ctx.run(`UPDATE sales_customer_proof SET testimonial_state = ?, testimonial_text = ?, references_asked = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ?
                   ${stamp("asked", "testimonial_asked_on")}${stamp("received", "testimonial_received_on")}${stamp("approved", "testimonial_approved_on")}
                 WHERE sales_org_id = ?`, [state, text, refs, who.id, who.name, salesOrgId]);
  return { ok: true, proof: (await proofLines(ctx.query, [salesOrgId])).get(salesOrgId) };
}

module.exports = { PLANT, FACTS, DEFAULT_HEALTH, cleanHealth, healthRule, healthOf, readFacts, board, factRows, startNurture, logCheckin, CHECKIN_PROMPT,
  proofLines, saveProof, owesLine, refStep, REF_STEPS };

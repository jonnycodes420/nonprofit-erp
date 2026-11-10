// server/onboard/board.js · ONBOARD-2. THE BOARD, THE RECOMPUTE AND THE MORNING LINE.
//
//   board(query, now)        every org's row on /ops → Onboarding, and the line
//                            at the top: "Billing: 3 · Onboarding: 4 · Stuck: 2"
//   recompute(ctx, ids?)     writes org_onboarding's stage, entered_at, blockers
//                            and flags from signals alone. The only writer of
//                            those columns. Runs on the worker every 15 minutes
//                            (and so nightly), and after a signal this build owns.
//   morningLines(rows)       the day-14 and failed-payment lines for Jonathan
//
// The board itself is computed live from signals on each read, so it is never
// staler than the database; the stored row is what the worker's flags and
// Jonathan's morning email read.
"use strict";

const STAGES = require("./stages");
const SIGNALS = require("./signals");

const SYSTEM = { id: "system:onboarding", name: "Steward (onboarding recompute)" };
const STRIPE_RECHECK_MS = 60 * 60 * 1000;

function rowOf(f, now) {
  const c = STAGES.compute(f, now, f.manual);
  return {
    orgId: f.id, name: f.name, stage: c.stage, stageIndex: c.stageIndex, title: c.title,
    daysInStage: c.daysInStage, enteredAt: c.enteredAt, red: c.red, redWhy: c.redWhy, flags: c.flags,
    next: c.next, waitingOn: f.manual.waitingOn, verbalYesOn: f.manual.verbalYesOn,
    firstChargeOn: f.firstChargeOn, mrrNowCents: f.mrrNowCents, mrrAgreedCents: f.mrrAgreedCents,
    blockers: c.blockers, gates: c.gates,
  };
}

async function board(query, now = Date.now()) {
  const ids = await SIGNALS.boardOrgIds(query);
  const facts = await SIGNALS.readFacts(query, ids);
  const rows = Object.values(facts).map(f => rowOf(f, now))
    .sort((a, b) => (b.red - a.red) || a.stageIndex - b.stageIndex || (b.daysInStage || 0) - (a.daysInStage || 0) || a.name.localeCompare(b.name));
  const billing = rows.filter(r => r.stage === "billing");
  const onboarding = rows.filter(r => r.stage !== "billing");
  const summary = {
    billing: billing.length, onboarding: onboarding.length, stuck: rows.filter(r => r.red).length,
    mrrNowCents: rows.reduce((n, r) => n + (r.mrrNowCents || 0), 0),
    // Billing now, plus what each org still onboarding is agreed to pay from its first charge date.
    mrrAtFirstChargeCents: rows.reduce((n, r) => n + (r.stage === "billing" ? (r.mrrNowCents || 0) : (r.mrrAgreedCents || 0)), 0),
    sentences: {
      mrrNow: "What the live Steward subscriptions of the orgs on this board bill each month now.",
      mrrAt: "Billing now, plus the monthly price each org still onboarding has agreed, counted from its first charge date.",
      stuck: "Orgs past their window (paper 3 days from the verbal yes, data 10 days from paper, kickoff 7 days from data in), or flagged in their first month.",
    },
  };
  return { rows, summary, windows: STAGES.WINDOW_DAYS, stages: STAGES.ALL.map(id => ({ id, title: STAGES.TITLE[id] })) };
}

async function one(query, orgId, now = Date.now()) {
  const facts = await SIGNALS.readFacts(query, [orgId]);
  return facts[orgId] ? rowOf(facts[orgId], now) : null;
}

// Ask Stripe, on the worker, whether each org's own account takes charges.
// Only orgs with an account and no yes yet, at most once an hour each.
async function checkStripe({ query, run, stripeCheck, now }, ids) {
  if (!stripeCheck) return 0;
  const rows = await query(`SELECT o.id, o.stripe_account_id, ob.stripe_checked_at FROM orgs o LEFT JOIN org_onboarding ob ON ob.org_id = o.id
                             WHERE o.id = ANY(?) AND o.stripe_account_id IS NOT NULL AND ob.stripe_ok_at IS NULL`, [ids]);
  let n = 0;
  for (const r of rows) {
    if (r.stripe_checked_at && now - new Date(r.stripe_checked_at).getTime() < STRIPE_RECHECK_MS) continue;
    const chk = await stripeCheck(r.stripe_account_id).catch(() => ({ ok: false, definitive: false }));
    await ensureRow(run, r.id);
    await run(`UPDATE org_onboarding SET stripe_checked_at = ?, stripe_ok_at = CASE WHEN ? THEN COALESCE(stripe_ok_at, ?) ELSE stripe_ok_at END WHERE org_id = ?`,
      [new Date(now).toISOString(), chk.ok === true, new Date(now).toISOString(), r.id]);
    n++;
  }
  return n;
}

async function ensureRow(run, orgId, who = SYSTEM) {
  await run(`INSERT INTO org_onboarding (org_id, created_by, created_by_name) VALUES (?, ?, ?) ON CONFLICT (org_id) DO NOTHING`, [orgId, who.id, who.name]);
}

// Writes what the signals say. Never reads a stage anyone typed.
async function recompute({ query, run, stripeCheck = null, now = Date.now() }, onlyIds = null) {
  const ids = onlyIds || await SIGNALS.boardOrgIds(query);
  if (!ids.length) return { orgs: 0 };
  await checkStripe({ query, run, stripeCheck, now }, ids);
  const facts = await SIGNALS.readFacts(query, ids);
  for (const f of Object.values(facts)) {
    const r = rowOf(f, now);
    await ensureRow(run, f.id);
    const day14 = r.flags.some(x => x.key === "no_first_gift");
    await run(`UPDATE org_onboarding SET stage = ?, entered_at = ?, blockers = ?, flags = ?, red = ?, computed_at = ?,
                      flagged_day14_at = CASE WHEN ? THEN COALESCE(flagged_day14_at, ?) ELSE NULL END
                WHERE org_id = ?`,
      [r.stage, JSON.stringify(r.enteredAt), JSON.stringify(r.blockers), JSON.stringify(r.flags), r.red, new Date(now).toISOString(),
       day14, new Date(now).toISOString(), f.id]);
  }
  return { orgs: Object.keys(facts).length };
}

// Jonathan's morning: one line per first-month flag. Nothing goes to the customer.
function morningLines(rows) {
  const out = [];
  for (const r of rows) for (const f of r.flags || []) out.push(`${r.name}: ${f.says}`);
  return out;
}

// Once a day, after 7 AM New York, to FOUNDER_EMAIL only, and only when there
// is a line. The day's row is claimed first, so two processes send one email.
async function sendMorning({ query, run, opsMail, now = Date.now() }) {
  const ny = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (ny.getHours() < 7) return { skipped: "before_7am" };
  const day = `${ny.getFullYear()}-${String(ny.getMonth() + 1).padStart(2, "0")}-${String(ny.getDate()).padStart(2, "0")}`;
  const { rows } = await board(query, now);
  const lines = morningLines(rows);
  if (!lines.length) return { skipped: "nothing_to_say" };
  const claimed = await query(`INSERT INTO onboarding_morning_sends (day, lines) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING day`, [day, lines.length]);
  if (!claimed.length) return { skipped: "already_sent_today" };
  if (!opsMail) return { skipped: "no_sender", lines };
  const r = await opsMail(`Onboarding this morning: ${lines.length} to look at`, lines.join("\n") + "\n\nThe board: /ops?tab=onboarding");
  return { sent: !!(r && r.sent), lines };
}

module.exports = { board, one, recompute, ensureRow, morningLines, sendMorning, SYSTEM };

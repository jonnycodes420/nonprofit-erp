// routes/finance.js — Steward Finance: the ledger, funds, payouts and the bookkeeper's export.
//
// FIX-1 split: these routes and the helpers only they use were moved here
// VERBATIM from server.js. Nothing in them changed.
//
// How it is wired, so it behaves exactly as it did inside server.js:
//   * Each router below is mounted in server.js with app.use(...) at the place
//     its first route used to be declared, so it keeps its place in the stack
//     (before or after the same middleware, before or after the same routes).
//   * server.js calls mount() once, at the end of boot, when every binding the
//     code below reads exists. `app` inside mount() is the current router, so
//     the unchanged `app.get(...)` lines register on it.
//   * `__dirname` is server.js's own, so every path built from it resolves as
//     before; a relative require()/import() reads "../x" because it resolves
//     against this file, one folder down (readSource reads it back as "./x").
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
// FIX-12 Part 7b: the after-meeting chips reach the model only through here.
const { anthropicFor, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../aiClient");
const meetingsSrc = require("../meetings");   // FIX-14 Part 1 — meetings with a person, defined once

const routers = {
  r0: express.Router(),
};

// INT-3 — set by mount() to the daily email-marketing pull below, so the job
// tick can run the SAME sync the Check now button runs. TDZ rule: declared at
// module scope, above every line that reads it.
let sharedProcessEmailMarketing = null;
// FIX-12 Part 7a — set by mount() to the composer behind Home's morning brief,
// so the optional morning email is built from the very same rows.
let sharedComposeTodayMeetings = null;
// PARITY-2 Part 5: set by mount() to the QuickBooks auto-sync, so the hourly
// tick runs the same engine the Sync button does.
let sharedProcessQboAutoSync = null;

function mount(ctx) {
const {
  AGENT_MODEL,
  actor, checkWriteAccess, crypto, finPeriodBounds, grantBalanceFrom, grantMoneyRows, money, orgOwns,
  orgTime, orgToday, orgTz, orgUnrestrictedFundId, parseMoneyOrThrow, query, requireAdmin,
  requireAuth, restrictedMod, run, stripe, toDollars, uuid, wrap, writeAuditLog,
  // INT-3 — the audience resolver the campaign sender uses, and the one
  // unsubscribe write. Both passed in rather than reimplemented.
  resolveSegmentSpec, filterBySegment, recordUnsubscribe,
  // INT-BUILD-1 — the mailbox and calendar syncs, and the token seam.
  syncMailbox, syncCalendar, pushStewardDates, mailboxAccessToken, closeThreadStepForContact,
} = ctx;
let app = routers.r0;
// FIX-1 E — the payout reconciliation and the money-in sentences (pure, ESM).
let payoutReconcileMod = null;
const payoutReconcile = () => payoutReconcileMod || (payoutReconcileMod = import("../shared/payoutReconcile.js"));

// GET /finance/restricted — the org's restricted position, by grant.
app.get("/finance/restricted", requireAuth, wrap(async (req, res) => {
  const R = await restrictedMod();
  const orgId = req.user.orgId;
  const org = await orgTz(orgId);
  const today = orgToday(org);                                          // ORG_TZ_SEAM_OK
  // Only AWARDED or CLOSED grants hold money. A submitted grant's restriction
  // is a proposal, not a balance.
  const rows = await grantMoneyRows(orgId, "AND g.status IN ('awarded','reporting','closed')");
  const balances = rows.map(r => grantBalanceFrom(R, r, today));
  const restricted = balances.filter(b => b.restricted);
  const totals = R.restrictedTotals(balances);
  res.json({
    today,
    grants: restricted.sort((a, b) => b.remainingCents - a.remainingCents),
    unrestricted: balances.filter(b => !b.restricted).map(b => ({
      grantId: b.grantId, funderName: b.funderName, program: b.program,
      awarded: b.awarded, awardedCents: b.awardedCents, sentence: b.sentence,
    })),
    totals: { ...totals, awarded: toDollars(totals.awardedCents), received: toDollars(totals.receivedCents),
              spent: toDollars(totals.spentCents), outstanding: toDollars(totals.outstandingCents),
              remaining: toDollars(totals.remainingCents) },
    sentence: R.totalsSentence(totals, money.formatCentsPlain),
    definitions: Object.fromEntries(R.RESTRICTED_METRICS.map(m => [m.key, m.definition])),
    spendSourceNote: R.SPEND_SOURCE_NOTE,
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  FIN-1 · THE OVERVIEW A TREASURER TRUSTS ON SIGHT
// ═══════════════════════════════════════════════════════════════════════════
//
// Four figures, and every one of them OPENS its rows and foots to the cent.
// That is the whole bar: a number a bookkeeper cannot get behind is a number
// she will not sign, and Finance had four figures that were period totals of
// a ledger most of the org's giving never reaches.
//
// THE FOUR, AND WHY THESE FOUR. They are the four questions somebody opens
// Finance to ask, in the order they ask them:
//   money in this month     did the money arrive
//   restricted balance      how much of it is not ours to spend
//   unrestricted balance    how much of it is
//   deposits not matched    is anything unaccounted for
//
// EVERY FIGURE IS IN CENTS END TO END and only becomes a decimal for
// reading. The rows behind a figure are the SAME query as the figure, run
// again with the rows returned, so the number on the screen and the rows
// behind it cannot drift — the pattern the journey stats and the hours
// report already use.
const FIN_FIGURES = [
  { key: "moneyInThisMonth", label: "Money in this month",
    definition: "Every gift dated in the current month, in your organisation's time zone, whatever it came in through. It is the gifts themselves, not the ledger: imported history and online giving are both here." },
  { key: "restricted", label: "Restricted balance",
    definition: "What is in funds marked restricted: money that arrived for a named purpose and is not the organisation's to spend on anything else." },
  { key: "unrestricted", label: "Unrestricted balance",
    definition: "What is in funds not marked restricted. This is the money the board can actually direct." },
  { key: "unmatched", label: "Deposits not yet matched",
    definition: "Gifts recorded as a cheque, cash or a bank transfer that are not yet on a deposit, plus payouts Steward could not line up with its own gifts. Nothing is wrong with them; nobody has reconciled them yet." },
];

// The month, as the ORG's civil month. A gift recorded at 9pm Eastern on the
// 31st belongs to that month, not to the next one in UTC.
function monthRange(today) {
  const y = today.slice(0, 4), m = today.slice(5, 7);
  const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

// One place each figure's SQL lives, so the figure and its rows are one
// query. `rows` true returns the rows; false returns the total in cents.
async function finFigure(orgId, key, { from, to }, rows = false) {
  if (key === "moneyInThisMonth") {
    const sel = rows
      ? `g.id, g.date, g.amount, g.type, d.name AS who, f.name AS fund`
      : `COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS cents`;
    const r = await query(
      `SELECT ${sel} FROM gifts g
         JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
         LEFT JOIN fin_funds f ON f.id=g.fund_id
        WHERE g.org_id=? AND d.deleted_at IS NULL
          AND g.date IS NOT NULL AND g.date <> '' AND g.date >= ? AND g.date <= ?
        ${rows ? "ORDER BY g.date DESC, g.id LIMIT 2000" : ""}`, [orgId, from, to]);
    return rows ? r : Number(r[0].cents);
  }
  if (key === "restricted" || key === "unrestricted") {
    const want = key === "restricted";
    const sel = rows
      ? `f.id, f.name, f.restricted,
         COALESCE(SUM(CASE WHEN ft.type='income' THEN ROUND(ft.amount*100)
                           WHEN ft.type='expense' THEN -ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS cents`
      : `COALESCE(SUM(CASE WHEN ft.type='income' THEN ROUND(ft.amount*100)
                           WHEN ft.type='expense' THEN -ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS cents`;
    const r = await query(
      `SELECT ${sel} FROM fin_funds f
         LEFT JOIN fin_transactions ft ON ft.fund_id=f.id AND ft.org_id=f.org_id
        WHERE f.org_id=? AND COALESCE(f.restricted,false) = ?
        ${rows ? "GROUP BY f.id, f.name, f.restricted ORDER BY 4 DESC" : ""}`, [orgId, want]);
    return rows ? r : Number(r[0].cents);
  }
  if (key === "unmatched") {
    // A gift that came in as money somebody physically banked, and is not on
    // a deposit yet. A DEPOSIT IS AN `imports` ROW with shape='deposit'
    // (BUILD-88b), and its gifts carry its import_id — there is no
    // `gifts.deposit_id`, and writing one would have been a second place a
    // deposit lives. The window is the last ninety days: an eighteen month
    // old cheque is history, not an open item, and a figure that counts it
    // is a figure nobody can ever drive to zero.
    const sel = rows
      ? `g.id, g.date, g.amount, g.payment_method, d.name AS who`
      : `COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS cents`;
    const r = await query(
      `SELECT ${sel} FROM gifts g
         JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM imports im
                            WHERE im.id = g.import_id AND im.org_id = g.org_id
                              AND im.shape = 'deposit' AND im.reversed_at IS NULL)
          AND lower(COALESCE(g.payment_method,'')) IN ('check','cheque','cash','bank transfer','ach')
          AND g.date >= (CURRENT_DATE - 90)::text
        ${rows ? "ORDER BY g.date DESC, g.id LIMIT 2000" : ""}`, [orgId]).catch(() => rows ? [] : [{ cents: 0 }]);
    return rows ? r : Number((r[0] || {}).cents || 0);
  }
  return rows ? [] : 0;
}

app.get("/finance/overview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const month = monthRange(today);

  const cents = {};
  for (const f of FIN_FIGURES) cents[f.key] = await finFigure(orgId, f.key, month);

  // MONEY IN BY MONTH, as bars that open their gifts. Twelve months back
  // from this one, in the org's civil months, and a month with nothing in it
  // is a zero rather than a gap — a chart that silently skips empty months
  // makes a quiet year look like a busy one.
  const rawMonths = await query(
    `SELECT substring(g.date from 1 for 7) AS month,
            COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS cents,
            COUNT(*)::int AS n
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> ''
        AND g.date >= ? AND g.date <= ?
      GROUP BY 1 ORDER BY 1`,
    [orgId, `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, month.to]);
  const byMonth = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const hit = rawMonths.find(r => r.month === key);
    byMonth.push({ month: key, cents: Number(hit ? hit.cents : 0), gifts: hit ? hit.n : 0,
                   amount: toDollars(Number(hit ? hit.cents : 0)) });
  }

  // ── NEEDS YOU ─────────────────────────────────────────────────────────
  // Three things, and each one is a thing somebody can DO today. Not a
  // health score and not a warning: a list with a count, a sentence and the
  // rows behind it.
  const needsYou = [];
  const [noFund] = await query(
    `SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND d.deleted_at IS NULL AND COALESCE(g.fund_id,'')=''
        AND g.date >= (CURRENT_DATE - 365)::text`, [orgId]);
  if (noFund.n) needsYou.push({ key: "noFund", label: "Gifts with no fund", count: noFund.n,
    amount: toDollars(Number(noFund.cents)),
    sentence: `${noFund.n} ${noFund.n === 1 ? "gift" : "gifts"} in the last year, ${money.formatCentsPlain(Number(noFund.cents))}, are not assigned to a fund. They are counted in your totals and they are not counted in any fund's balance.`,
    rows: "noFund" });

  const [unmatchedN] = await query(
    `SELECT COUNT(*)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM imports im
                          WHERE im.id = g.import_id AND im.org_id = g.org_id
                            AND im.shape = 'deposit' AND im.reversed_at IS NULL)
        AND lower(COALESCE(g.payment_method,'')) IN ('check','cheque','cash','bank transfer','ach')
        AND g.date >= (CURRENT_DATE - 90)::text`, [orgId]).catch(() => [{ n: 0 }]);
  if (unmatchedN.n) needsYou.push({ key: "unmatched", label: "Not yet on a deposit", count: unmatchedN.n,
    amount: toDollars(cents.unmatched),
    sentence: `${unmatchedN.n} ${unmatchedN.n === 1 ? "gift" : "gifts"} came in as a cheque, cash or a transfer in the last ninety days and ${unmatchedN.n === 1 ? "is" : "are"} not on a deposit yet.`,
    rows: "unmatched" });

  // Restricted money with a grant deadline coming. Only AWARDED grants hold
  // money, and only a REPORT or SPEND deadline inside sixty days is a thing
  // to do rather than a date in a calendar.
  // `grants.funder` is a TEXT name and `grants.program` is the grant's title.
  // There is no funder_id: the funders table came later and never became the
  // grant's parent. Written against the real columns, and NOT wrapped in a
  // catch that would turn a wrong column name into a silently empty list —
  // which is exactly how the first version of this shipped looking fine.
  const deadlines = await query(
    `SELECT g.id, g.funder, g.program, g.amount, g.received, g.report_due
       FROM grants g
      WHERE g.org_id=? AND g.status IN ('awarded','reporting')
        AND g.report_due IS NOT NULL AND g.report_due <> ''
        AND g.report_due::date >= CURRENT_DATE AND g.report_due::date <= (CURRENT_DATE + 60)
      ORDER BY g.report_due LIMIT 25`, [orgId]);
  if (deadlines.length) needsYou.push({ key: "grantDeadline", label: "Restricted money with a deadline", count: deadlines.length,
    amount: null,
    sentence: `${deadlines.length} awarded ${deadlines.length === 1 ? "grant has a report" : "grants have reports"} due within sixty days. Restricted money with a report coming is money somebody has to account for.`,
    rows: "grantDeadline" });

  res.json({
    today, month,
    monthLabel: new Date(month.from + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    figures: FIN_FIGURES.map(f => ({
      key: f.key, label: f.label, cents: cents[f.key], amount: toDollars(cents[f.key]),
      definition: f.definition, rows: f.key,
    })),
    byMonth,
    needsYou,
    sentence: needsYou.length
      ? `${needsYou.length} ${needsYou.length === 1 ? "thing needs" : "things need"} you. Every figure here opens the rows behind it.`
      : "Nothing is waiting. Every figure here opens the rows behind it.",
  });
}));

// The rows behind one of those numbers, and they FOOT: the total of the rows
// returned is sent back beside them, so a screen can say out loud that they
// add up rather than asking anybody to trust that they do.
app.get("/finance/overview/rows", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const month = monthRange(today);
  const key = String(req.query.rows || "");

  if (FIN_FIGURES.some(f => f.key === key)) {
    const rows = await finFigure(orgId, key, month, true);
    const total = rows.reduce((a, r) => a + Number(r.cents != null ? r.cents : Math.round(Number(r.amount) * 100)), 0);
    const figure = await finFigure(orgId, key, month);
    return res.json({
      rows: rows.map(r => ({ ...r, amount: r.amount != null ? Number(r.amount) : toDollars(Number(r.cents)) })),
      count: rows.length, totalCents: total, total: toDollars(total),
      foots: total === figure,
      sentence: total === figure
        ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}, ${money.formatCentsPlain(total)}. They add up to the figure, to the cent.`
        : `${rows.length} ${rows.length === 1 ? "row" : "rows"} shown, ${money.formatCentsPlain(total)}, against a figure of ${money.formatCentsPlain(figure)}. More rows exist than this list shows.`,
      definition: (FIN_FIGURES.find(f => f.key === key) || {}).definition,
    });
  }

  if (key === "noFund") {
    const rows = await query(
      `SELECT g.id, g.date, g.amount, g.type, d.name AS who
         FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL AND COALESCE(g.fund_id,'')=''
          AND g.date >= (CURRENT_DATE - 365)::text
        ORDER BY g.date DESC, g.id LIMIT 2000`, [orgId]);
    const total = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
    return res.json({ rows: rows.map(r => ({ ...r, amount: Number(r.amount) })), count: rows.length,
      totalCents: total, total: toDollars(total), foots: true,
      sentence: `${rows.length} ${rows.length === 1 ? "gift" : "gifts"}, ${money.formatCentsPlain(total)}, with no fund on them.` });
  }
  if (key === "grantDeadline") {
    const rows = await query(
      `SELECT g.id, g.funder, g.program, g.amount, g.received, g.report_due
         FROM grants g
        WHERE g.org_id=? AND g.status IN ('awarded','reporting') AND g.report_due IS NOT NULL AND g.report_due <> ''
          AND g.report_due::date >= CURRENT_DATE AND g.report_due::date <= (CURRENT_DATE + 60)
        ORDER BY g.report_due LIMIT 100`, [orgId]);
    return res.json({ rows, count: rows.length, foots: true,
      sentence: `${rows.length} awarded ${rows.length === 1 ? "grant" : "grants"} with a report due inside sixty days.` });
  }
  return res.status(400).json({ error: "unknown_rows", message: "That is not a figure this screen can open." });
}));

// The gifts behind ONE month's bar.
app.get("/finance/overview/month", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const m = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(m)) return res.status(400).json({ error: "bad_month" });
  const rows = await query(
    `SELECT g.id, g.date, g.amount, g.type, d.name AS who, f.name AS fund
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
       LEFT JOIN fin_funds f ON f.id=g.fund_id
      WHERE g.org_id=? AND d.deleted_at IS NULL AND substring(g.date from 1 for 7) = ?
      ORDER BY g.date DESC, g.id LIMIT 2000`, [orgId, m]);
  const total = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  res.json({ month: m, rows: rows.map(r => ({ ...r, amount: Number(r.amount) })), count: rows.length,
    totalCents: total, total: toDollars(total),
    sentence: `${rows.length} ${rows.length === 1 ? "gift" : "gifts"} in ${m}, ${money.formatCentsPlain(total)}.` });
}));

// ── FIN-1 · FUNDS, ONE CARD EACH ──────────────────────────────────────────
// Balance, in and out this period, and the restriction. A restricted fund
// says WHERE THE RESTRICTION CAME FROM — which grant, or which donor — and
// that is the thing a treasurer cannot get out of a chart of accounts.
app.get("/finance/funds-detail", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const month = monthRange(today);
  const funds = await query(
    `SELECT f.id, f.name, f.restricted, f.description,
            COALESCE(SUM(CASE WHEN ft.type='income'  THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS in_all,
            COALESCE(SUM(CASE WHEN ft.type='expense' THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS out_all,
            COALESCE(SUM(CASE WHEN ft.type='income'  AND ft.date >= ? AND ft.date <= ? THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS in_period,
            COALESCE(SUM(CASE WHEN ft.type='expense' AND ft.date >= ? AND ft.date <= ? THEN ROUND(ft.amount*100) ELSE 0 END),0)::bigint AS out_period
       FROM fin_funds f
       LEFT JOIN fin_transactions ft ON ft.fund_id=f.id AND ft.org_id=f.org_id
      WHERE f.org_id=?
      GROUP BY f.id, f.name, f.restricted, f.description
      ORDER BY COALESCE(f.restricted,false) DESC, f.name`,
    [month.from, month.to, month.from, month.to, orgId]);

  // WHO RESTRICTED IT. A grant whose money went to this fund, or a donor
  // whose gift did. Read per fund rather than guessed from the name.
  // THREE WAYS A RESTRICTION ARRIVES, and all three are read rather than
  // guessed from the fund's name: a grant whose money was posted to the
  // fund, a gift that named the fund, and a ledger line that named neither
  // but carries the person or body it came from. The third matters because
  // most restricted money in a small shop arrives as a transaction somebody
  // typed, not as a gift with a fund on it.
  const sources = await query(
    `SELECT ft.fund_id, 'grant' AS kind, COALESCE(NULLIF(gr.funder,''), gr.program) AS who,
            COALESCE(SUM(ROUND(ft.amount*100)),0)::bigint AS cents
       FROM fin_transactions ft JOIN grants gr ON gr.id = ft.grant_id AND gr.org_id = ft.org_id
      WHERE ft.org_id=? AND ft.fund_id IS NOT NULL AND ft.type='income'
      GROUP BY 1,2,3
      UNION ALL
     SELECT g.fund_id, 'donor', d.name, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND g.fund_id IS NOT NULL AND d.deleted_at IS NULL
      GROUP BY 1,2,3
      UNION ALL
     SELECT ft.fund_id, 'ledger', ft.vendor_donor, COALESCE(SUM(ROUND(ft.amount*100)),0)::bigint
       FROM fin_transactions ft
      WHERE ft.org_id=? AND ft.fund_id IS NOT NULL AND ft.type='income'
        AND ft.grant_id IS NULL AND COALESCE(ft.vendor_donor,'') <> ''
      GROUP BY 1,2,3
      ORDER BY 4 DESC`, [orgId, orgId, orgId]);
  const byFund = new Map();
  for (const s of sources) {
    if (!byFund.has(s.fund_id)) byFund.set(s.fund_id, []);
    const list = byFund.get(s.fund_id);
    if (list.length < 4) list.push({ kind: s.kind, who: s.who, amount: toDollars(Number(s.cents)) });
  }

  res.json({
    period: month,
    periodLabel: new Date(month.from + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    funds: funds.map(f => {
      const balance = Number(f.in_all) - Number(f.out_all);
      const restricted = !!f.restricted;
      const who = byFund.get(f.id) || [];
      return {
        id: f.id, name: f.name, restricted, description: f.description || null,
        balanceCents: balance, balance: toDollars(balance),
        inPeriod: toDollars(Number(f.in_period)), outPeriod: toDollars(Number(f.out_period)),
        inPeriodCents: Number(f.in_period), outPeriodCents: Number(f.out_period),
        restrictedBy: restricted ? who : [],
        sentence: restricted
          ? (who.length
              ? `Restricted. ${money.formatCentsPlain(balance)} is held for a named purpose, and it came from ${who.slice(0, 2).map(w => w.who).join(" and ")}${who.length > 2 ? " and others" : ""}.`
              : `Restricted. ${money.formatCentsPlain(balance)} is held for a named purpose. Nothing on file says which grant or donor restricted it.`)
          : `Unrestricted. ${money.formatCentsPlain(balance)} the board can direct.`,
        rows: "fund:" + f.id,
      };
    }),
    definitions: {
      balance: "Everything that has ever come into this fund, less everything that has gone out of it. Not a period figure.",
      inPeriod: "Income posted to this fund inside the current month, in your organisation's time zone.",
      restrictedBy: "The grants and donors whose money went into this fund, largest first. Read from the transactions and the gifts, never from the fund's name.",
    },
    sentence: funds.length
      ? `${funds.length} ${funds.length === 1 ? "fund" : "funds"}. Every number opens the rows behind it.`
      : "No funds yet. A fund is a pot of money with a purpose; every gift can name one.",
  });
}));

app.get("/finance/funds-detail/rows", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const fundId = String(req.query.fund || "");
  if (!(await orgOwns("fin_funds", fundId, orgId))) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT ft.id, ft.date, ft.type, ft.amount, ft.description, ft.vendor_donor
       FROM fin_transactions ft WHERE ft.org_id=? AND ft.fund_id=?
      ORDER BY ft.date DESC, ft.id LIMIT 2000`, [orgId, fundId]);
  const net = rows.reduce((a, r) => a + (r.type === "income" ? 1 : -1) * Math.round(Number(r.amount) * 100), 0);
  res.json({ rows: rows.map(r => ({ ...r, amount: Number(r.amount) })), count: rows.length,
    netCents: net, net: toDollars(net),
    sentence: `${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}, ${money.formatCentsPlain(net)} net. This is every row behind that balance.` });
}));

// ── FIN-1 · THE BOOKKEEPER'S EXPORT, IN THE SHAPE THEIR TOOL WANTS ───────
// ═══════════════════════════════════════════════════════════════════════════
//  INT-2 · SENDING TO THE ACCOUNTING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
//
// Steward knows every gift; QuickBooks needs DEPOSITS. shared/bookkeeping.js
// turns the first into the second and refuses any deposit whose lines do not
// foot to what arrived in the bank, in cents. These routes are the connection,
// the mapping, the send and the monthly agreement.
//
// THE SEND IS IDEMPOTENT BY PAYOUT, and the guarantee is Steward's own ledger
// rather than the vendor's good manners: one row per (org, vendor, payout),
// claimed BEFORE the call and kept afterwards whatever happened. Two deposits
// for one payout doubles a nonprofit's recorded revenue in its own books,
// which is worse than sending nothing at all.
//
// THE EXPORT STAYS. FIN-1's QuickBooks-ready and Xero-ready CSV is the
// fallback and is untouched below, and disconnecting deletes nothing in the
// accounting system: what was sent was sent, and Steward has no business
// reaching back into somebody's books to tidy up after itself.
const bookkeepingMod = () => import("../shared/bookkeeping.js");

// ═══════════════════════════════════════════════════════════════════════════
//  INT-OAUTH · THE CONNECT BUTTONS ACTUALLY CONNECT
// ═══════════════════════════════════════════════════════════════════════════
//
// One flow for every provider, from shared/oauth.js: start, callback, refresh,
// disconnect. Owner or admin only, because connecting an accounting system is
// handing somebody write access to the books.
//
// WHAT NEVER HAPPENS HERE. A secret is never logged, never returned to the
// browser and never stored unsealed: shared/secretBox.js has no plaintext path
// and throws without a key, which becomes a typed 503 and writes nothing. The
// authorize URL is built from the registry's scopes, so a request cannot widen
// what is asked for. And the callback verifies the signed state against the
// SIGNED-IN admin before it stores anything.
const oauthMod = () => import("../shared/oauth.js");
const emailMarketingMod = () => import("../shared/emailMarketing.js");
const mailboxMod = () => import("../shared/mailboxLog.js");
// INT-BUILD-1 — the calendar's decision, the note reader, and the one place
// every figure is computed (so the profile's year and the Reports grid cannot
// disagree with the drawer behind them).
const calendarMod = () => import("../shared/calendarLog.js");
const meetingNoteMod = () => import("../shared/meetingNote.js");
const figureSources = require("../figureSources");

// The state is signed with the server's own secret. The signature is what
// makes a state we did not issue useless; the row in oauth_states is what
// makes one we DID issue single-use.
function signState(raw) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(String(raw)).digest("base64url");
}
function stateMatches(raw, sig) {
  const a = Buffer.from(signState(raw)), b = Buffer.from(String(sig || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function oauthEnv(provider, ENV) {
  const names = ENV[provider] || {};
  const out = {};
  for (const [k, name] of Object.entries(names)) out[k] = process.env[name] || null;
  return { values: out, names };
}

// WHAT IS CONFIGURED, WITHOUT PRINTING ANY OF IT. The Connections screen asks
// this so a Connect button can say "waiting on Intuit's review" instead of
// opening a page nobody can complete. It answers with booleans and variable
// NAMES, never a value, never a prefix of one.
app.get("/oauth/status", requireAuth, wrap(async (req, res) => {
  const O = await oauthMod();
  const out = {};
  for (const key of O.PROVIDER_KEYS) {
    const { values, names } = oauthEnv(key, O.ENV_VARS);
    const missing = Object.entries(names)
      .filter(([k]) => k === "clientId" || k === "clientSecret" || k === "redirectUri")
      .filter(([k]) => !values[k]).map(([, name]) => name);
    // FIX-22: a provider held back (Xero, until its scopes are right) is not
    // ready whatever is configured, and says only that.
    if (O.PROVIDERS[key].held) {
      out[key] = { label: O.PROVIDERS[key].label, kind: O.PROVIDERS[key].kind, ready: false, held: true, missing: [],
        scopes: O.PROVIDERS[key].scopes, note: null, sentence: O.PROVIDERS[key].held };
      continue;
    }
    out[key] = {
      label: O.PROVIDERS[key].label, kind: O.PROVIDERS[key].kind,
      ready: missing.length === 0, missing,
      scopes: O.PROVIDERS[key].scopes,
      // INT-PROD-1: Intuit approved the app, so its "Sandbox until Intuit's
      // review is finished" note is only true while INTUIT_API_BASE points at
      // the sandbox.
      note: key === "intuit" && qboSyncMod().environment() === "production" ? null : (O.PROVIDERS[key].sandboxNote || null),
      // FIX-10 D — `missing` still carries the variable NAMES, because the
      // admin check and the ops report are what that list is for. The
      // SENTENCE is what a customer reads on Connections, and it names
      // nothing she cannot act on.
      sentence: missing.length
        ? O.providerUnavailableSentence(O.PROVIDERS[key].label)
        // INT-3 — A PROVIDER WITH NO SCOPES NEEDS ITS OWN SENTENCE. Mailchimp
        // grants a whole account and offers nothing narrower, so "Steward will
        // ask Mailchimp for 0 scopes and nothing else" told an organisation the
        // opposite of the truth about what it was about to approve.
        : O.PROVIDERS[key].scopeSentence
          ? `Ready. ${O.PROVIDERS[key].scopeSentence}`
          : `Ready. Steward will ask ${O.PROVIDERS[key].label} for ${O.PROVIDERS[key].scopes.length} ${O.PROVIDERS[key].scopes.length === 1 ? "permission" : "permissions"} and nothing else.`,
    };
  }
  // PayPal is not an OAuth provider here, and the card says why rather than
  // offering a button that opens a page nobody can complete.
  out.paypal = { label: "PayPal", kind: "source", ready: false, missing: [],
    // FIX-10 D — the action leads, and `why` is what the card's disclosure
    // reveals. One sentence used to carry both and led with the reason.
    waiting: true, sentence: O.PAYPAL_ACTION, why: O.PAYPAL_WHY,
    // INT-OAUTH item 5 — whether the webhook id is set, WITHOUT printing it.
    webhookConfigured: !!process.env.PAYPAL_WEBHOOK_ID };
  res.json({ providers: out,
    definition: "Which connections Steward can open a consent screen for right now. Steward never shows a secret; this says only whether one is set." });
}));

// START. Mints the state, keeps the PKCE verifier, and hands back the URL for
// the browser to visit. A GET that WRITES one short-lived row is the exception
// the rule allows for: nothing about the organisation changes, and the row is
// the anti-forgery token itself.
// ── INT-4 · WHO MAY START AND FINISH A HANDSHAKE ───────────────────────────
// An org connection (Xero, Square, Mailchimp) is the organisation's, so it
// takes an owner or admin. A MAILBOX is not: it is one person's own inbox, her
// own consent and her own switch to turn off, and requiring an admin to connect
// it would be both wrong and useless, because the admin cannot pass Google's
// consent screen as her anyway. So the wall moves rather than disappearing: for
// a mailbox provider the caller must be a signed-in user, and every row written
// is keyed to that user id.
function requireAdminUnlessMailbox(req, res, next) {
  let kind = null;
  try { kind = PROVIDER_KIND[String(req.params.provider || "")] || null; } catch { kind = null; }
  if (kind === "mailbox") return next();
  return requireAdmin(req, res, next);
}
// Filled at mount from the registry, so a new provider is one entry there.
const PROVIDER_KIND = {};
import("../shared/oauth.js").then(O => {
  for (const k of O.PROVIDER_KEYS) PROVIDER_KIND[k] = O.PROVIDERS[k].kind;
}).catch(() => {});

app.post("/oauth/:provider/start", requireAuth, requireAdminUnlessMailbox, checkWriteAccess, wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key)) return res.status(404).json({ error: "unknown_provider" });
  if (O.PROVIDERS[key].held) return res.status(503).json({ error: "not_available", sentence: O.PROVIDERS[key].held });
  // PARITY-2 Part 5: QuickBooks opens only where the founder turned it on,
  // until Intuit's app assessment is passed and production keys exist.
  if (key === "intuit") {
    const [o] = await query("SELECT qbo_sync_enabled FROM orgs WHERE id=?", [req.user.orgId]);
    if (!o || o.qbo_sync_enabled !== true)
      return res.status(403).json({ error: "qbo_not_enabled",
        sentence: "QuickBooks sync is not turned on for this organisation yet. The bookkeeper file on this page works without it." });
  }
  const { values, names } = oauthEnv(key, O.ENV_VARS);
  if (!values.clientId || !values.clientSecret || !values.redirectUri) {
    return res.status(503).json({ error: "not_configured",
      missing: Object.entries(names).filter(([k]) => ["clientId", "clientSecret", "redirectUri"].includes(k))
        .filter(([k]) => !values[k]).map(([, n]) => n),
      sentence: O.providerUnavailableSentence(O.PROVIDERS[key].label) });
  }
  // INT-BUILD-1 Part 0 — a demo org shows the buttons and connects nothing.
  if (O.PROVIDERS[key].kind === "mailbox") {
    const ML = await mailboxMod();
    const [org] = await query("SELECT id, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
    if (ML.isDemoMailboxOrg(org))
      return res.status(409).json({ error: "demo_org", sentence: ML.DEMO_CONNECT_SENTENCE });
  }
  const nonce = crypto.randomBytes(16).toString("base64url");
  const raw = O.encodeState({ orgId: req.user.orgId, userId: req.user.userId, nonce });
  const state = `${raw}.${signState(raw)}`;
  const verifier = O.PROVIDERS[key].pkce ? crypto.randomBytes(48).toString("base64url") : null;
  const challenge = verifier ? crypto.createHash("sha256").update(verifier).digest("base64url") : null;
  await run(
    `INSERT INTO oauth_states (state,org_id,user_id,provider,code_verifier,redirect_uri,expires_at)
     VALUES (?,?,?,?,?,?, NOW() + INTERVAL '15 minutes')`,
    [state, req.user.orgId, req.user.userId, key, verifier, values.redirectUri]);
  res.json({ url: O.authorizeUrl(key, { clientId: values.clientId, redirectUri: values.redirectUri,
    state, codeChallenge: challenge }), provider: key,
    sentence: `You will be asked to approve ${O.PROVIDERS[key].scopes.length} ${O.PROVIDERS[key].scopes.length === 1 ? "permission" : "permissions"} and nothing else.` });
}));

// THE LANDING, AND WHY IT IS NOT WHERE THE TOKEN IS STORED.
//
// A provider's redirect is a top-level browser navigation. It carries no
// Authorization header, so it cannot be an authenticated route, and it is a
// GET, so by the standing rule it may not write. Both problems have the same
// answer: the provider lands the person on the APP, the app shows them what is
// happening, and the app finishes the job with an authenticated POST carrying
// the code. That also makes the signed-in-admin wall below mean something,
// because by then there is a signed-in admin to check against.
//
// This route exists only for a redirect URI registered against the API host by
// mistake or by a provider that insists on it. It reads nothing and writes
// nothing; it forwards the query to the app and stops.
app.get("/oauth/:provider/callback", wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key)) return res.status(404).json({ error: "unknown_provider" });
  res.redirect(302, require("../publicUrl").oauthLandingUrl(key, req.query));
}));

// COMPLETE. The app sends the code and the state back here, signed in.
// Nothing is stored until the state verifies AGAINST THE SIGNED-IN ADMIN: a
// forged, copied or stale callback writes no token.
app.post("/oauth/:provider/complete", requireAuth, requireAdminUnlessMailbox, checkWriteAccess, wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key)) return res.status(404).json({ error: "unknown_provider" });

  const state = String(req.body?.state || "");
  const [raw, sig] = state.split(".");
  const refuse = (reason, sentence) => res.status(400).json({ error: reason, sentence });
  if (!raw || !sig || !stateMatches(raw, sig))
    return refuse("bad_state", "That sign-in did not come from Steward. Nothing was connected.");
  const claim = O.decodeState(raw);
  if (!claim) return refuse("bad_state", "That sign-in did not come from Steward. Nothing was connected.");
  // THE WALL: the state names an org and an admin, and the person standing
  // here must be that admin of that org.
  if (claim.orgId !== req.user.orgId || claim.userId !== req.user.userId)
    return refuse("state_mismatch", "That sign-in was started by somebody else, or for a different organisation. Nothing was connected.");

  // Single use, and only if we issued it. The UPDATE is the claim: a second
  // callback with the same state changes no rows and is refused.
  const claimed = await query(
    `UPDATE oauth_states SET used_at=NOW() WHERE state=? AND org_id=? AND provider=?
       AND used_at IS NULL AND expires_at > NOW() RETURNING code_verifier, redirect_uri`,
    [state, req.user.orgId, key]);
  if (!claimed.length)
    return refuse("state_spent", "That sign-in has already been used or has expired. Start again and it will take a moment.");

  const code = String(req.body?.code || "");
  if (!code) return refuse("no_code", "The provider did not send a code back. Nothing was connected.");

  const { values } = oauthEnv(key, O.ENV_VARS);
  const reqSpec = O.tokenRequest(key, { code, redirectUri: claimed[0].redirect_uri || values.redirectUri,
    clientId: values.clientId, clientSecret: values.clientSecret, codeVerifier: claimed[0].code_verifier });
  let tokens = null;
  try {
    const r = await fetch(reqSpec.url, { method: "POST",
      headers: { ...reqSpec.headers,
        ...(reqSpec.basic ? { Authorization: "Basic " + Buffer.from(reqSpec.basic).toString("base64") } : {}) },
      body: reqSpec.body });
    const body = await r.json().catch(() => ({}));
    // FIX-10 D — the STATUS CODE goes to the console; the customer reads the
    // provider's own words or a plain phrase. "Square refused to finish the
    // connection: the provider answered 502" put an HTTP code on her screen.
    if (!r.ok) {
      console.error(`[oauth] ${key} token endpoint answered ${r.status}`);
      throw new Error(body?.error_description || body?.error || "the provider did not accept the request");
    }
    tokens = O.readTokens(body);
    if (!tokens) throw new Error("the provider sent no access token");
  } catch (e) {
    // The message may quote the provider; it never quotes a secret, because
    // the only secrets in this request are in headers we built and did not log.
    console.error(`[oauth] ${key} token exchange failed:`, e.message);
    return res.status(502).json({ error: "exchange_failed",
      sentence: `${O.PROVIDERS[key].label} refused to finish the connection: ${e.message}. Nothing was connected.` });
  }

  const sealed = await sealTokens(req.user.orgId, tokens);
  const expiresAt = tokens.expiresInSeconds
    ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString() : null;
  const who = actor(req);
  const account = key === "intuit" ? String(req.body?.realmId || "") || null : (tokens.merchantId || null);

  const vendorKey = O.vendorKeyOf(key);
  // ── INT-3 — THE EMAIL TOOL'S OWN ROW ────────────────────────────────────
  // A third kind, and its own table, because a mailing list is not a giving
  // source and must not become one more thing the money figures exclude.
  //
  // MAILCHIMP'S DATA CENTRE IS LEARNED HERE, ONCE. Every later call goes to
  // `https://<prefix>.api.mailchimp.com`, and the prefix is a property of the
  // ACCOUNT, not of Steward. Asking for it after the exchange is the only way
  // to know it; hardcoding one works for the first customer and fails for the
  // second.
  // ── INT-4 · A MAILBOX ROW IS KEYED TO THE PERSON ─────────────────────────
  // The signed state already proved this is the same signed-in user who
  // started the flow; that user id is what the row is written against, so one
  // person's consent can never land on another person's record even inside one
  // organisation. The address comes from the provider, never from the browser.
  if (O.PROVIDERS[key].kind === "mailbox") {
    const who_ = actor(req);
    const address = await mailboxAddress(key, tokens.accessToken);
    if (!address) {
      return res.status(502).json({ error: "address_unknown",
        sentence: `${O.PROVIDERS[key].label} approved the connection but would not say which mailbox it is, so Steward cannot tell whose it is. Try connecting again.` });
    }
    // INT-BUILD-1 — did this consent include the calendar? Read from what the
    // provider says it granted, never assumed from what was asked: a person
    // can untick the calendar on Google's screen and still connect mail.
    const CL = await import("../shared/calendarLog.js");
    const calendarOk = CL.calendarGranted(key, tokens.scope);
    await run(
      `INSERT INTO mailbox_connections
         (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,calendar_granted,created_by,created_by_name)
       VALUES (?,?,?,?,?, 'active', ?,?,?,?,?)
       ON CONFLICT (user_id, provider) WHERE status <> 'disconnected'
       DO UPDATE SET address=EXCLUDED.address, credentials_sealed=EXCLUDED.credentials_sealed,
                     token_expires_at=EXCLUDED.token_expires_at, calendar_granted=EXCLUDED.calendar_granted,
                     status='active', last_error=NULL, last_error_at=NULL, updated_at=NOW()`,
      ["mbx_" + uuid().slice(0, 10), req.user.orgId, req.user.userId, key, address, sealed, expiresAt,
       calendarOk, who_.id, who_.name]);
    await writeAuditLog(req.user.orgId, who_.id, who_.name, "mailbox_connected", "mailbox", key, {}).catch(() => {});
    const ML = await mailboxMod();
    // The first sync runs now, so the connect page can show what it found.
    // It never blocks the answer: a slow mailbox is a later number, not a
    // failed connection.
    const first = await Promise.race([
      (async () => { const m = await syncMailbox(req.user.userId, req.user.orgId, key).catch(() => null);
                     const c = calendarOk ? await syncCalendar(req.user.userId, req.user.orgId, key).catch(() => null) : null;
                     return { m, c }; })(),
      new Promise(r => setTimeout(() => r(null), 20000)),
    ]);
    return res.json({ ok: true, provider: key, account: address, needsTenantChoice: false, tenants: null,
      calendarGranted: calendarOk, firstSync: !!first,
      sentence: `${address} is connected, and Steward holds the permission encrypted. ${ML.FIELDS_SENTENCE}`
        + (calendarOk ? "" : " The calendar was not included, so meetings will not appear until you add it.") });
  }
  if (O.PROVIDERS[key].kind === "email") {
    let prefix = null, accountName = null;
    if (O.PROVIDERS[key].metadataUrl) {
      const meta = await mailchimpMetadata(O.PROVIDERS[key].metadataUrl, tokens.accessToken);
      if (!meta) {
        return res.status(502).json({ error: "metadata_failed",
          sentence: `${O.PROVIDERS[key].label} approved the connection but would not say which data centre the account is in, so Steward cannot call it yet. Try connecting again.` });
      }
      prefix = meta.dc; accountName = meta.accountName;
    }
    // The webhook secret lives IN the URL because that is the only
    // verification Mailchimp offers. It is per org, per connection, and it is
    // never returned to the browser: the screen is told the webhook is set, not
    // what it is.
    const webhookSecret = crypto.randomBytes(24).toString("base64url");
    await run(
      `INSERT INTO email_marketing_connections
         (id,org_id,provider,status,credentials_sealed,server_prefix,account_name,
          webhook_secret,token_expires_at,created_by,created_by_name)
       VALUES (?,?,?, 'active', ?,?,?,?,?,?,?)
       ON CONFLICT (org_id, provider) WHERE status <> 'disconnected'
       DO UPDATE SET status='active', credentials_sealed=EXCLUDED.credentials_sealed,
                     server_prefix=EXCLUDED.server_prefix, account_name=EXCLUDED.account_name,
                     token_expires_at=EXCLUDED.token_expires_at,
                     last_error=NULL, last_error_at=NULL, updated_at=NOW()`,
      ["emc_" + uuid().slice(0, 10), req.user.orgId, vendorKey, sealed, prefix, accountName,
       webhookSecret, expiresAt, who.id, who.name]);
    await writeAuditLog(req.user.orgId, who.id, who.name, "oauth_connected", "connection", key, {}).catch(() => {});
    const EM = await emailMarketingMod();
    return res.json({ ok: true, provider: key, account: accountName, needsTenantChoice: false, tenants: null,
      needsMapping: true,
      sentence: `${O.PROVIDERS[key].label} is connected and Steward holds the token encrypted. Nothing is sent to it until you choose which ${EM.audienceNoun(vendorKey)} to keep in step.` });
  }
  if (O.PROVIDERS[key].kind === "bookkeeping") {
    // FIX-20: a reconnect that lands on a DIFFERENT company keeps the mapping
    // but marks which company it was chosen in (when it does not say), so
    // qboSync.readMapping refuses to post this company's gifts to the other
    // company's account numbers.
    await run(`UPDATE bookkeeping_connections
                  SET mapping = jsonb_set(mapping, '{qbo,realmId}', to_jsonb(realm_id::text))
                WHERE org_id=? AND vendor=? AND status <> 'disconnected' AND realm_id IS NOT NULL
                  AND realm_id IS DISTINCT FROM ? AND mapping->'qbo' IS NOT NULL AND mapping->'qbo'->'realmId' IS NULL`,
      [req.user.orgId, vendorKey, account]);
    // FIX-34 Q: AUTO-SYNC STARTS OFF ON EVERY NEW CONNECTION. A connect is
    // not consent to send; turning auto-sync on is a separate, later choice,
    // and it cannot be made until every fund is mapped.
    if (vendorKey === "quickbooks") await run("UPDATE orgs SET qbo_auto_sync=false WHERE id=?", [req.user.orgId]);
    await run(
      `INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,credentials_sealed,token_expires_at,
                                            mapping,connected_by,connected_by_name,created_by,created_by_name)
       VALUES (?,?,?, 'active', ?, ?, ?, '{}'::jsonb, ?,?,?,?)
       ON CONFLICT (org_id, vendor) WHERE status <> 'disconnected'
       DO UPDATE SET status='active', realm_id=EXCLUDED.realm_id, credentials_sealed=EXCLUDED.credentials_sealed,
                     token_expires_at=EXCLUDED.token_expires_at, last_error=NULL, updated_at=NOW()`,
      ["bkc_" + uuid().slice(0, 10), req.user.orgId, vendorKey, account, sealed, expiresAt,
       who.id, who.name, who.id, who.name]);
  } else {
    await run(
      `INSERT INTO giving_sources (id,org_id,provider,display_name,status,credentials_sealed,token_expires_at,
                                   provider_account_id,created_by,created_by_name)
       VALUES (?,?,?,?, 'active', ?, ?, ?, ?, ?)
       ON CONFLICT (org_id, provider) WHERE status <> 'disconnected'
       DO UPDATE SET status='active', credentials_sealed=EXCLUDED.credentials_sealed,
                     token_expires_at=EXCLUDED.token_expires_at,
                     provider_account_id=EXCLUDED.provider_account_id, last_error=NULL, updated_at=NOW()`,
      ["gsrc_" + uuid().slice(0, 10), req.user.orgId, vendorKey, O.PROVIDERS[key].label, sealed, expiresAt,
       account, who.id, who.name]);
  }
  await writeAuditLog(req.user.orgId, who.id, who.name, "oauth_connected", "connection", key, {}).catch(() => {});

  // ── XERO'S SECOND QUESTION ────────────────────────────────────────────
  // A Xero login can hold several organisations, and consent does not say
  // which one. One is chosen for you; more than one is a question, never a
  // guess. Posting a deposit to the wrong Xero organisation is not a setting
  // somebody notices later, it is somebody else's books.
  let tenants = null;
  if (key === "xero") {
    tenants = await xeroTenants(tokens.accessToken);
    if (tenants && tenants.length === 1) {
      await run(`UPDATE bookkeeping_connections SET realm_id=?, updated_at=NOW() WHERE org_id=? AND vendor='xero' AND status <> 'disconnected'`,
        [tenants[0].id, req.user.orgId]);
    }
  }
  const needsTenantChoice = key === "xero" && (!tenants || tenants.length !== 1);
  res.json({ ok: true, provider: key, account, needsTenantChoice, tenants,
    sentence: needsTenantChoice
      ? `${O.PROVIDERS[key].label} is connected. It holds ${tenants ? tenants.length : "several"} organisations, so choose which one Steward should post to before anything is sent.`
      : `${O.PROVIDERS[key].label} is connected. Steward asked for ${O.PROVIDERS[key].scopes.length} ${O.PROVIDERS[key].scopes.length === 1 ? "permission" : "permissions"} and holds the tokens encrypted.` });
}));

// The OAuth provider a stored vendor key came from: the reverse of
// `vendorKeyOf`, so the send path can ask for a token by the name it has.
function oauthKeyFor(vendor) {
  return String(vendor) === "quickbooks" ? "intuit" : String(vendor);
}


// ── INT-4 · WHOSE MAILBOX IS THIS ──────────────────────────────────────────
// Asked of the provider, never taken from the browser. A connection whose
// address Steward cannot establish is refused rather than stored under a guess:
// the address is how every later message is judged inbound or outbound, and a
// wrong one silently mislabels every line on every record.
async function mailboxAddress(providerKey, accessToken) {
  try {
    const url = providerKey === "google"
      ? `${process.env.GMAIL_API_BASE || "https://gmail.googleapis.com"}/gmail/v1/users/me/profile`
      : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" } });
    if (!r.ok) { console.error(`[mailbox] ${providerKey} profile answered ${r.status}`); return null; }
    const b = await r.json();
    const addr = providerKey === "google" ? b.emailAddress : (b.mail || b.userPrincipalName);
    return addr ? String(addr).trim().toLowerCase() : null;
  } catch (e) { console.error(`[mailbox] ${providerKey} profile failed:`, e.message); return null; }
}

// ── INT-3 — WHICH DATA CENTRE THIS MAILCHIMP ACCOUNT LIVES IN ──────────────
// Returns null if Mailchimp could not be asked, which is a refusal rather than
// a guess: a wrong prefix is not a setting somebody fixes later, it is every
// subsequent call going to a host that knows nothing about this account.
async function mailchimpMetadata(url, accessToken) {
  try {
    const r = await fetch(url, {
      // Mailchimp's metadata endpoint wants this exact scheme word, not Bearer.
      headers: { Authorization: "OAuth " + accessToken, Accept: "application/json" } });
    if (!r.ok) { console.error(`[oauth] mailchimp metadata answered ${r.status}`); return null; }
    const body = await r.json();
    const dc = body && (body.dc || null);
    if (!dc) return null;
    return { dc: String(dc), accountName: body.accountname || body.login?.login_name || null };
  } catch (e) { console.error("[oauth] mailchimp metadata failed:", e.message); return null; }
}

// Which Xero organisations this consent covers. Returns null if Xero could not
// be asked, which is a reason to ASK the person rather than to pick for them.
async function xeroTenants(accessToken) {
  try {
    const r = await fetch("https://api.xero.com/connections",
      { headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" } });
    if (!r.ok) return null;
    const body = await r.json();
    if (!Array.isArray(body)) return null;
    return body.map(t => ({ id: t.tenantId, name: t.tenantName || t.tenantId, type: t.tenantType || null }));
  } catch { return null; }
}

// THE ANSWER TO THAT QUESTION. The id is checked against Xero's own live list
// rather than taken from the browser: a tenant id typed into a request is not
// evidence that this consent covers it.
app.post("/oauth/xero/tenant", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [c] = await query(`SELECT * FROM bookkeeping_connections WHERE org_id=? AND vendor='xero' AND status <> 'disconnected'`, [orgId]);
  if (!c) return res.status(404).json({ error: "not_connected" });
  const token = await accessTokenFor(orgId, c, "xero");
  if (!token.ok) return res.status(token.status).json(token.body);
  const tenants = await xeroTenants(token.accessToken);
  if (!tenants) return res.status(502).json({ error: "xero_unreachable",
    sentence: "Xero did not answer when Steward asked which organisations this connection covers. Nothing was changed." });
  const wanted = String(req.body?.tenantId || "");
  const match = tenants.find(t => t.id === wanted);
  if (!match) return res.status(400).json({ error: "unknown_tenant", tenants,
    sentence: "That is not one of the organisations this Xero connection covers, so Steward did not choose it." });
  await run(`UPDATE bookkeeping_connections SET realm_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [match.id, c.id, orgId]);
  await writeAuditLog(orgId, actor(req).id, actor(req).name, "oauth_tenant_chosen", "connection", "xero",
    { tenantId: match.id, tenantName: match.name }).catch(() => {});
  res.json({ ok: true, tenantId: match.id, tenantName: match.name,
    sentence: `Steward will post to ${match.name}, and to no other Xero organisation.` });
}));

// ── A LIVE ACCESS TOKEN, REFRESHED BEFORE IT EXPIRES ──────────────────────
// Every path that talks to a provider asks for the token here rather than
// reading the sealed blob itself. It refreshes with five minutes to spare,
// because a token that expires halfway through a send turns one deposit into a
// retry, and INT-2's whole safety model is about not retrying into a second
// deposit. A 401 from the provider is the other trigger, once: the caller
// passes `force` and gets a fresh token or a typed refusal.
//
// Nothing here is logged. The refusal a caller may show says the connection
// needs signing in again; it never says what was in the blob.
async function accessTokenFor(orgId, row, providerKey, { force = false } = {}) {
  const O = await oauthMod();
  const refuse = (status, error, sentence) => ({ ok: false, status, body: { error, sentence } });
  if (!row?.credentials_sealed)
    return refuse(409, "not_connected", `${O.PROVIDERS[providerKey].label} is not connected, so Steward has nothing to send with.`);
  let bag;
  try {
    const { openBag } = await import("../shared/secretBox.js");
    bag = openBag(row.credentials_sealed, { aad: orgId });
  } catch {
    // A blob that will not open for THIS org is either a missing key or a row
    // that does not belong here. Either way it is a refusal, never a retry.
    return refuse(503, "credentials_unreadable",
      `Steward could not open the stored ${O.PROVIDERS[providerKey].label} credentials. Disconnect and connect again, and nothing already imported is affected.`);
  }
  const stale = force || O.needsRefresh(row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
                                        new Date().toISOString());
  if (!stale) return { ok: true, accessToken: bag.accessToken };
  if (!bag.refreshToken)
    return refuse(409, "reauth_needed", `${O.PROVIDERS[providerKey].label} needs signing in again: this connection has no refresh token.`);

  const { values } = oauthEnv(providerKey, O.ENV_VARS);
  const spec = O.tokenRequest(providerKey, { refreshToken: bag.refreshToken,
    clientId: values.clientId, clientSecret: values.clientSecret });
  let fresh;
  try {
    const r = await fetch(spec.url, { method: "POST",
      headers: { ...spec.headers,
        ...(spec.basic ? { Authorization: "Basic " + Buffer.from(spec.basic).toString("base64") } : {}) },
      body: spec.body });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[oauth] ${providerKey} refresh endpoint answered ${r.status}`);
      throw new Error(body?.error_description || body?.error || "the provider did not accept the request");
    }
    fresh = O.readTokens(body);
    if (!fresh) throw new Error("the provider sent no access token");
  } catch (e) {
    console.error(`[oauth] ${providerKey} refresh failed:`, e.message);
    return refuse(409, "reauth_needed",
      `${O.PROVIDERS[providerKey].label} would not renew Steward's access: ${e.message}. Connect it again when you have a moment.`);
  }
  // A refresh usually ROTATES the refresh token, and losing the new one locks
  // the connection out at the next renewal, so the whole bag is re-sealed.
  const sealed = await sealTokens(orgId, { accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken || bag.refreshToken, scope: fresh.scope || bag.scope || null });
  const expiresAt = fresh.expiresInSeconds ? new Date(Date.now() + fresh.expiresInSeconds * 1000).toISOString() : null;
  // INT-3 — THREE KINDS, THREE TABLES. A refresh that writes the rotated token
  // to the wrong table changes no rows and fails silently: the next renewal
  // then presents a refresh token the provider has already retired, and the
  // connection locks itself out. The kind picks the table, once.
  const kind = O.PROVIDERS[providerKey].kind;
  // INT-4 — a mailbox row is keyed by USER, so its update is too. A rotated
  // Google refresh token written against the org would change no rows and the
  // connection would lock itself out at the next renewal.
  if (kind === "mailbox") {
    await run(
      `UPDATE mailbox_connections SET credentials_sealed=?, token_expires_at=?, updated_at=NOW()
        WHERE org_id=? AND provider=? AND status <> 'disconnected' AND user_id=?`,
      [sealed, expiresAt, orgId, providerKey, row.user_id]);
    return { ok: true, accessToken: fresh.accessToken, refreshed: true };
  }
  const sql = kind === "bookkeeping"
    ? `UPDATE bookkeeping_connections SET credentials_sealed=?, token_expires_at=?, updated_at=NOW() WHERE org_id=? AND vendor=? AND status <> 'disconnected'`
    : kind === "email"
    ? `UPDATE email_marketing_connections SET credentials_sealed=?, token_expires_at=?, updated_at=NOW() WHERE org_id=? AND provider=? AND status <> 'disconnected'`
    : `UPDATE giving_sources SET credentials_sealed=?, token_expires_at=?, updated_at=NOW() WHERE org_id=? AND provider=? AND status <> 'disconnected'`;
  await run(sql, [sealed, expiresAt, orgId, O.vendorKeyOf(providerKey)]);
  return { ok: true, accessToken: fresh.accessToken, refreshed: true };
}

// DISCONNECT. Revokes where the provider supports it, deletes the tokens, and
// keeps every record already imported: what came in is the organisation's own
// history and Steward has no business deleting it to tidy up after itself.
app.post("/oauth/:provider/disconnect", requireAuth, requireAdminUnlessMailbox, checkWriteAccess, wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key)) return res.status(404).json({ error: "unknown_provider" });
  // THREE KINDS, THREE TABLES, ONE PROMISE. Whichever it is, disconnecting
  // drops the tokens and keeps every record already brought in: the campaigns
  // on a donor's timeline and the opt-outs they produced do not vanish because
  // somebody unplugged the tool that reported them.
  const kind = O.PROVIDERS[key].kind;
  // ── INT-4 · DISCONNECTING A MAILBOX, AND THE SECOND CHOICE ──────────────
  // The default keeps what was already logged: those conversations are the
  // organisation's record of its own relationships, and they do not belong to
  // whoever happened to be holding the mailbox. But she may also say "and
  // remove everything I logged", because she is entitled to undo what her own
  // consent put there. It is HER rows only, matched by the actor that wrote
  // them, never another colleague's.
  if (kind === "mailbox") {
    const purge = req.body && req.body.removeLogged === true;
    const r = await run(
      `UPDATE mailbox_connections SET status='disconnected', credentials_sealed=NULL, token_expires_at=NULL,
              paused=false, updated_at=NOW()
        WHERE org_id=? AND provider=? AND user_id=? AND status <> 'disconnected'`,
      [req.user.orgId, key, req.user.userId]);
    if (r && r.changes === 0) return res.status(404).json({ error: "not_connected" });
    let removed = 0;
    if (purge) {
      const d = await run(
        `DELETE FROM interactions
          WHERE org_id=? AND type='email' AND created_by=?`,
        [req.user.orgId, `system:mailbox/${key}/${req.user.userId}`]);
      removed = (d && d.changes) || 0;
    }
    await writeAuditLog(req.user.orgId, actor(req).id, actor(req).name,
      purge ? "mailbox_disconnected_purged" : "mailbox_disconnected", "mailbox", key, { removed }).catch(() => {});
    return res.json({ ok: true, removed,
      sentence: purge
        ? `Disconnected, and the ${removed} conversation${removed === 1 ? "" : "s"} you logged from that mailbox ${removed === 1 ? "has" : "have"} been removed.`
        : "Disconnected. Steward will not read anything else from that mailbox, and the conversations already logged are still on the records." });
  }
  if (key === "intuit") await revokeIntuit(req.user.orgId);
  const table = kind === "bookkeeping" ? "bookkeeping_connections"
              : kind === "email" ? "email_marketing_connections" : "giving_sources";
  const col = kind === "bookkeeping" ? "vendor" : "provider";
  const r = await run(
    `UPDATE ${table} SET status='disconnected', credentials_sealed=NULL, token_expires_at=NULL, updated_at=NOW()
      WHERE org_id=? AND ${col}=? AND status <> 'disconnected'`, [req.user.orgId, O.vendorKeyOf(key)]);
  if (r && r.changes === 0) return res.status(404).json({ error: "not_connected" });
  await writeAuditLog(req.user.orgId, actor(req).id, actor(req).name, "oauth_disconnected", "connection", key, {}).catch(() => {});
  res.json({ ok: true,
    sentence: `Disconnected. Steward will not read or send anything else through ${O.PROVIDERS[key].label}, and every record it already brought in is still here.` });
}));

// ═══ INT-4 · HER OWN INBOX ═════════════════════════════════════════════════
//
// Every route here is scoped to `req.user.userId` and not to the org. An admin
// cannot read, pause, purge or disconnect a colleague's mailbox from any of
// them: the connection is hers, and the only thing the organisation gets is the
// conversations she chose to log.
//
// WHAT IS NEVER HERE: a send. There is no route below that writes a message,
// and the scopes in shared/oauth.js could not authorise one if there were.

// FIX-33 · ONE CONNECTION'S HEALTH, from its own run rows. Every number here
// is one person's own mailbox; nothing about a colleague's is ever read.
const STALE_MS = 2 * 3600e3;
const clock = (ts, tz) => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || "America/New_York" });
async function mailboxHealth(conn) {
  const label = conn.provider === "google" ? "Gmail" : "Outlook";
  const tz = (await orgTz(conn.org_id)).timezone || "America/New_York";
  const one = async (sql, args) => (await query(sql, args))[0] || {};
  const mailOk = (await one(`SELECT MAX(finished_at) AS t FROM mailbox_sync_runs WHERE user_id=? AND provider=? AND kind='mail' AND ok`, [conn.user_id, conn.provider])).t || null;
  const calOk = (await one(`SELECT MAX(finished_at) AS t FROM mailbox_sync_runs WHERE user_id=? AND provider=? AND kind='calendar' AND ok`, [conn.user_id, conn.provider])).t || null;
  const lastFail = await one(`SELECT error, finished_at FROM mailbox_sync_runs WHERE user_id=? AND provider=? AND ok=false
                                 ORDER BY started_at DESC LIMIT 1`, [conn.user_id, conn.provider]);
  const actorId = `system:mailbox/${conn.provider}/${conn.user_id}`;
  const today = orgToday(await orgTz(conn.org_id));   // ORG_TZ_SEAM_OK
  const counts = await one(
    `SELECT COUNT(*) FILTER (WHERE LEFT(i.date,10) = ?)::int AS today,
            COUNT(*) FILTER (WHERE i.created_at >= NOW() - INTERVAL '7 days')::int AS week
       FROM interactions i WHERE i.org_id=? AND i.type='email' AND i.created_by=?`, [today, conn.org_id, actorId]);
  const meetings = await one(`SELECT COUNT(*)::int AS n FROM calendar_events WHERE org_id=? AND owner_user_id=? AND provider=?`,
    [conn.org_id, conn.user_id, conn.provider]);
  const pushed = await one(`SELECT COUNT(*)::int AS n FROM calendar_pushes WHERE org_id=? AND user_id=? AND provider=?`,
    [conn.org_id, conn.user_id, conn.provider]);
  const refused = conn.status === "error";
  // The newest failure counts only if nothing has succeeded since.
  const failNewer = lastFail.finished_at && (!mailOk || new Date(lastFail.finished_at) > new Date(mailOk));
  const lastError = refused ? (conn.last_error || `${label} refused Steward's permission. Reconnect to keep it working.`)
    : failNewer ? lastFail.error : (conn.calendar_granted && conn.calendar_error) || null;
  const since = new Date(conn.created_at || Date.now()).getTime();
  const stale = !conn.paused && (refused || (mailOk ? Date.now() - new Date(mailOk).getTime() > STALE_MS : Date.now() - since > STALE_MS));
  const banner = !stale ? null : mailOk
    ? `Steward hasn't read your ${label} since ${clock(mailOk, tz)}. Reconnect`
    : `Steward hasn't been able to read your ${label} yet. Reconnect`;
  return {
    lastMailReadAt: mailOk, lastCalendarReadAt: conn.calendar_granted ? calOk : null,
    loggedToday: counts.today || 0, loggedWeek: counts.week || 0,
    meetingsFound: meetings.n || 0, eventsPushed: pushed.n || 0,
    lastError, lastErrorAt: refused ? conn.last_error_at : failNewer ? lastFail.finished_at : null,
    stale, banner,
    definition: "From Steward's own record of every read. Messages logged counts emails with people on file that this connection added to their records; meetings found counts calendar events with someone on file.",
  };
}

// WHAT IS CONNECTED, FOR ME. Never another person's row.
app.get("/mailbox", requireAuth, wrap(async (req, res) => {
  const O = await oauthMod();
  const ML = await mailboxMod();
  const mine = await query(
    `SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId]);
  const never = await query(
    `SELECT id, pattern, kind FROM mailbox_never_log WHERE user_id=? ORDER BY pattern`, [req.user.userId]);
  const [org] = await query("SELECT id, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
  const demo = ML.isDemoMailboxOrg(org);
  // A demo's "connected" Gmail is built here, never stored: no row, no token,
  // and the sync tick has nothing to find.
  const exampleSync = new Date(); exampleSync.setHours(7, 0, 0, 0);
  const example = demo ? { provider: "google", address: req.user.email || "you@example.org", paused: false,
    last_synced_at: exampleSync.toISOString(), last_logged_count: null, example: true } : null;
  const byProvider = Object.fromEntries(mine.map(r => [r.provider, r]));
  if (example && !byProvider.google) byProvider.google = example;
  // FIX-33 · THE HEALTH PANEL. "Connected" is never shown without when it
  // last read, from the run rows themselves (mailbox_sync_runs).
  const health = {};
  for (const r of mine) if (!demo) health[r.provider] = await mailboxHealth(r);
  const providers = O.PROVIDER_KEYS.filter(k => O.PROVIDERS[k].kind === "mailbox").map(k => {
    const p = O.PROVIDERS[k];
    const row0 = byProvider[k] || null;
    // On a demo org every connection is the example (Harborlight's seed
    // writes one with no token), so it gets no Pause and no Disconnect.
    const row = row0 && demo ? { ...row0, example: true } : row0;
    const { values, names } = oauthEnv(k, O.ENV_VARS);
    const missing = ["clientId", "clientSecret", "redirectUri"].filter(f => !values[f]).map(f => names[f]);
    return {
      key: k, label: p.label, scopes: p.scopes, configured: missing.length === 0, missing,
      connected: !!row, address: row?.address || null, paused: row?.paused === true,
      lastSyncedAt: row?.last_synced_at || null, lastLoggedCount: row?.last_logged_count ?? null,
      lastError: row?.last_error || null,
      health: health[k] || null,
      reviewNote: p.reviewNote || null, example: row?.example === true,
      // INT-BUILD-1 — mail can be connected without the calendar (every INT-4
      // connection, or somebody who unticked it). That is a prompt, not an error.
      calendarGranted: !!row && (row.example === true || row.calendar_granted === true),
      calendarSyncedAt: row?.calendar_synced_at || (row?.example ? row.last_synced_at : null),
      // Shown beside the Gmail button until GOOGLE_APP_VERIFIED is set.
      unverifiedNote: k === "google" && process.env.GOOGLE_APP_VERIFIED !== "true" ? ML.GOOGLE_UNVERIFIED_SENTENCE : null,
      sentence: row?.example
        ? `An example connection. ${ML.DEMO_CONNECT_SENTENCE}`
        : missing.length && !demo
        ? O.providerUnavailableSentence(p.label)
        : row
          ? (row.paused ? `Paused. Nothing new is being read from ${row.address}.`
                        : `Connected to ${row.address}. Only messages to or from someone on file are kept.`)
          : `Connect your own ${p.label} and your conversations with people on file will log themselves.`,
    };
  });
  // YOUR TEAM: who has connected, which provider, and when it last read.
  // Names only. A colleague's address, list and switches stay hers.
  const teamRows = await query(
    `SELECT u.id, u.name, u.email, m.provider, m.status, m.paused, m.last_synced_at
       FROM users u LEFT JOIN mailbox_connections m
         ON m.user_id = u.id AND m.org_id = u.org_id AND m.status <> 'disconnected'
      WHERE u.org_id = ? ORDER BY u.name, m.provider`, [req.user.orgId]);
  const teamBy = new Map();
  for (const r of teamRows) {
    const t = teamBy.get(r.id) || { id: r.id, name: r.name || r.email, you: r.id === req.user.userId, connections: [] };
    if (r.provider) t.connections.push({ provider: r.provider, label: O.PROVIDERS[r.provider]?.label || r.provider,
      paused: r.paused === true, broken: r.status === "error", lastSyncedAt: r.last_synced_at || null, example: demo });
    teamBy.set(r.id, t);
  }
  if (example) {
    const me = teamBy.get(req.user.userId);
    if (me && !me.connections.length)
      me.connections.push({ provider: "google", label: "Gmail", paused: false, broken: false,
        lastSyncedAt: example.last_synced_at, example: true });
  }
  res.json({
    providers, neverLog: never, demo, demoSentence: demo ? ML.DEMO_CONNECT_SENTENCE : null,
    banner: Object.values(health).map(h => h && h.banner).find(Boolean) || null,
    connected: providers.some(p => p.connected),
    team: [...teamBy.values()],
    teamDefinition: "Everyone on your team, and whether their own inbox is connected. Each person connects their own; nobody can connect a colleague's.",
    fieldsLogged: ML.FIELDS_LOGGED, fieldsSentence: ML.FIELDS_SENTENCE,
    calendarSentence: (await import("../shared/calendarLog.js")).CALENDAR_FIELDS_SENTENCE,
    touchSentence: ML.TOUCH_SENTENCE,
    definition: "Your own mailbox. Steward logs only the messages to or from a person already in Steward, and keeps nothing at all about any other message.",
  });
}));

// PAUSE. Hers, and a switch rather than a disconnect: the tokens stay so she
// can turn it back on without another consent screen.
app.post("/mailbox/:provider/pause", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key) || O.PROVIDERS[key].kind !== "mailbox")
    return res.status(404).json({ error: "unknown_provider" });
  const paused = req.body?.paused !== false;
  const r = await run(
    `UPDATE mailbox_connections SET paused=?, updated_at=NOW()
      WHERE user_id=? AND org_id=? AND provider=? AND status <> 'disconnected'`,
    [paused, req.user.userId, req.user.orgId, key]);
  if (r && r.changes === 0) return res.status(404).json({ error: "not_connected" });
  res.json({ ok: true, paused,
    sentence: paused
      ? "Paused. Steward will read nothing new from your mailbox until you turn it back on, and what is already logged stays."
      : "On again. Steward will pick up from where it stopped." });
}));

// THE NEVER-LOG LIST. Hers alone: no admin route reads or writes this table.
app.post("/mailbox/never-log", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const ML = await mailboxMod();
  const v = ML.validateNeverLog(req.body?.pattern);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await run(
    `INSERT INTO mailbox_never_log (id,user_id,org_id,pattern,kind) VALUES (?,?,?,?,?)
     ON CONFLICT (user_id, pattern) DO NOTHING`,
    ["nvr_" + uuid().slice(0, 8), req.user.userId, req.user.orgId, v.value, v.kind]);
  res.status(201).json({ ok: true, pattern: v.value, kind: v.kind,
    sentence: v.kind === "domain"
      ? `Nothing from anyone at ${v.value} will be logged, and nothing already logged from them is kept.`
      : `Nothing to or from ${v.value} will be logged.` });
}));

app.delete("/mailbox/never-log/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await run(`DELETE FROM mailbox_never_log WHERE id=? AND user_id=?`,
    [req.params.id, req.user.userId]);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, sentence: "Removed from your never-log list. Steward does not go back for anything it skipped." });
}));

// "DO NOT LOG THIS ONE" — removes the interaction AND remembers, so the next
// sync does not put it straight back. Remembering is the whole point: without
// the exclusion row, deleting a logged email lasts until the next pass.
app.post("/mailbox/forget", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const interactionId = String(req.body?.interactionId || "");
  if (!interactionId) return res.status(400).json({ error: "interactionId is required" });
  const [row] = await query(
    `SELECT id, org_id, metadata FROM interactions WHERE id=? AND org_id=?`,
    [interactionId, req.user.orgId]);
  if (!row) return res.status(404).json({ error: "Not found" });
  const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : (row.metadata || {});
  const provider = String(meta.provider || "google");
  const messageId = String(meta.message_id || meta.gmail_message_id || "");
  if (messageId) {
    await run(
      `INSERT INTO mailbox_exclusions (id,org_id,user_id,provider,message_id) VALUES (?,?,?,?,?)
       ON CONFLICT (org_id, provider, message_id) DO NOTHING`,
      ["mex_" + uuid().slice(0, 8), req.user.orgId, req.user.userId, provider, messageId]);
  }
  await run(`DELETE FROM interactions WHERE id=? AND org_id=?`, [interactionId, req.user.orgId]);
  res.json({ ok: true,
    sentence: "Removed, and Steward will not log that message again." });
}));

// ═══ INT-BUILD-1 · MEETINGS ═════════════════════════════════════════════════
//
// The calendar is read by syncCalendar (server.js) under shared/calendarLog.js.
// What follows is what the screens read and the three things a person can do
// with a meeting: log how it went, move it, and book one. Every write here is
// a POST from a page she is looking at, and every one is audited by the trail
// mounted above every router; none of them sends anything to a donor.

// SYNC NOW, hers. `what` is mail, calendar or both.
app.post("/mailbox/:provider/sync", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const O = await oauthMod();
  const key = String(req.params.provider || "");
  if (!O.isProvider(key) || O.PROVIDERS[key].kind !== "mailbox") return res.status(404).json({ error: "unknown_provider" });
  const what = ["mail", "calendar"].includes(req.body?.what) ? req.body.what : "both";
  // FIX-33: "Read now" on the card. Same runs as the tick, recorded as hers.
  const mail = what !== "calendar" ? await syncMailbox(req.user.userId, req.user.orgId, key, { trigger: "read_now" }).catch(() => ({ logged: 0 })) : null;
  const calendar = what !== "mail" ? await syncCalendar(req.user.userId, req.user.orgId, key, { trigger: "read_now" }).catch(() => ({ kept: 0 })) : null;
  const error = (mail && mail.error) || (calendar && calendar.error) || null;
  const [conn] = await query(`SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND provider=? AND status <> 'disconnected'`,
    [req.user.userId, req.user.orgId, key]);
  res.json({ ok: !error, error, mail: mail ? { logged: mail.logged || 0 } : null, calendar: calendar ? { kept: calendar.kept || 0 } : null,
    health: conn ? await mailboxHealth(conn) : null,
    sentence: error || `Read just now. ${mail ? `${mail.logged || 0} new ${mail.logged === 1 ? "message" : "messages"} logged` : ""}${mail && calendar ? ", " : ""}${calendar ? `${calendar.kept || 0} ${calendar.kept === 1 ? "meeting" : "meetings"} on your calendar with people on file` : ""}.` });
}));

const meetingTz = async orgId => { const org = await orgTz(orgId); return { org, tz: org.timezone || "America/New_York", today: orgToday(org) }; };   // ORG_TZ_SEAM_OK
const monthName = d => new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const shortDay = d => new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// THE BRIEF. Four lines from her own record, each from a row that exists, and
// a line is left out rather than filled when there is nothing true to say.
async function meetingBrief(orgId, donorId, beforeIso) {
  const before = new Date(beforeIso || Date.now()).toISOString();
  const [d] = await query(`SELECT id, name, total_giving, first_gift_date, last_gift_amount, last_gift_date FROM donors WHERE id=? AND org_id=?`, [donorId, orgId]);
  if (!d) return null;
  // FIX-14 Part 1 — the last time is the newest HELD meeting from the one
  // source (meetings.js), before this one, on the org's calendar day.
  const beforeDay = orgToday(await orgTz(orgId), new Date(before));   // ORG_TZ_SEAM_OK
  const prior = (await meetingsSrc.meetingsWith(orgId, donorId, { held: true, to: beforeDay, limit: 20 }))
    .filter(m => m.kind === "logged" ? m.date < beforeDay : new Date(m.starts_at).getTime() < new Date(before).getTime());
  const last = prior[0] || null;
  let lastTime = null;
  if (last && last.kind === "calendar") lastTime = { date: last.date, text: [last.title, last.note].filter(Boolean).join(". ") };
  else if (last) lastTime = { date: last.date, text: String(last.note || "").trim() };

  const P = await import("../shared/proposalShape.js");
  const [ask] = await query(
    `SELECT o.id, o.name, o.target_amount, o.notes, o.created_at, f.name AS fund_name, o.fund_id
       FROM opportunities o LEFT JOIN fin_funds f ON f.id = o.fund_id AND f.org_id = o.org_id
      WHERE o.org_id=? AND o.donor_id=? AND o.proposal_stage = ANY(?::text[])
      ORDER BY o.target_amount DESC NULLS LAST LIMIT 1`, [orgId, donorId, P.OPEN_STAGE_KEYS]).catch(() => []);
  const openAsk = ask ? {
    id: ask.id, amount: Number(ask.target_amount) || 0, fundId: ask.fund_id || null, fundName: ask.fund_name || null,
    text: `$${(Number(ask.target_amount) || 0).toLocaleString("en-US")} for ${ask.fund_name || ask.name || "an open proposal"}, raised in ${monthName(new Date(ask.created_at).toISOString())}.${ask.notes ? " " + String(ask.notes).trim() : ""}`,
  } : null;

  const [em] = await query(
    `SELECT note, date FROM interactions WHERE org_id=? AND donor_id=? AND type='email' AND metadata->>'direction'='inbound'
      ORDER BY date DESC, created_at DESC LIMIT 1`, [orgId, donorId]);
  const quoteOf = note => { const body = String(note || "").split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
    return body.length > 180 ? body.slice(0, 177).replace(/\s\S*$/, "") + "…" : body; };
  const lastEmail = em && quoteOf(em.note) ? { date: em.date, quote: quoteOf(em.note) } : null;

  const [g] = await query(
    `SELECT id, amount, date FROM gifts WHERE org_id=? AND donor_id=? AND COALESCE(acknowledgement_sent,false)=false
        AND amount > 0 AND date >= (CURRENT_DATE - 365)::text ORDER BY date DESC LIMIT 1`, [orgId, donorId]);
  const unthanked = g ? { giftId: g.id, date: g.date, amount: Number(g.amount), text: `The ${shortDay(g.date)} gift hasn't been thanked yet.` } : null;

  const years = d.first_gift_date ? Math.max(1, new Date().getUTCFullYear() - Number(String(d.first_gift_date).slice(0, 4)) + 1) : null;
  const giving = Number(d.total_giving) > 0 ? {
    lifetime: Number(d.total_giving),
    text: `$${Number(d.total_giving).toLocaleString("en-US")}${years ? ` over ${years} year${years === 1 ? "" : "s"}` : ""}`
      + (d.last_gift_amount && d.last_gift_date ? `, $${Number(d.last_gift_amount).toLocaleString("en-US")} in ${monthName(d.last_gift_date)}` : ""),
  } : null;
  return { donorId, name: d.name, lastTime, openAsk, lastEmail, unthanked, giving };
}

const eventOut = (c, extra = {}) => ({
  id: c.id, title: c.title, startsAt: c.starts_at, endsAt: c.ends_at, location: c.location || null,
  personIds: c.person_ids || [], ownerUserId: c.owner_user_id, ownerName: c.owner_name || null, provider: c.provider,
  note: c.note || null, nextStep: c.next_step || null, loggedAt: c.logged_at || null, bookedInSteward: c.booked_in_steward === true,
  candidateIds: c.candidate_ids || [],
  ...extra,
});

// EVERYTHING THE PROFILE NEEDS FROM THE CALENDAR AND THE INBOX, in one read.
app.get("/donors/:id/relationship", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, donorId = req.params.id;
  const [d] = await query(`SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const { today, org: tzOrg } = await meetingTz(orgId);
  const events = await query(
    `SELECT c.*, u.name AS owner_name FROM calendar_events c LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.org_id=? AND ? = ANY(c.person_ids) ORDER BY c.starts_at DESC LIMIT 200`, [orgId, donorId]);
  const peopleIds = [...new Set(events.flatMap(e => e.person_ids || []))];
  const names = peopleIds.length ? Object.fromEntries((await query(`SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?)`, [orgId, peopleIds])).map(r => [r.id, r.name])) : {};
  const now = Date.now();
  // FIX-14 Part 1 — each calendar event carries its org-local day, so the
  // screen never dates it by UTC.
  const civilOf = e => orgToday(tzOrg, new Date(e.starts_at));   // ORG_TZ_SEAM_OK
  const calUpcoming = events.filter(e => new Date(e.starts_at).getTime() > now).reverse().map(e => eventOut(e, { date: civilOf(e), people: (e.person_ids || []).map(id => names[id]).filter(Boolean) }));
  const past = events.filter(e => new Date(e.starts_at).getTime() <= now).map(e => eventOut(e, { date: civilOf(e), people: (e.person_ids || []).map(id => names[id]).filter(Boolean) }));
  const soon = calUpcoming.find(e => new Date(e.startsAt).getTime() - now <= 30 * 864e5) || null;   // FIX-33: a booked visit shows its card from the day it is booked

  // THE ONE SOURCE (meetings.js): every meeting with this person, calendar
  // and logged by hand. The timeline's Meetings chip counts `meetings` (held
  // ones), and Coming up is the calendar's future events plus any logged
  // meeting dated ahead.
  const allMeetings = await meetingsSrc.meetingsWith(orgId, donorId, { limit: 500 });
  const loggedOut = m => ({ id: m.id, kind: "logged", interactionId: m.id, title: m.location ? `Meeting at ${m.location}` : "Meeting",
    date: m.date, startsAt: null, location: m.location || null, note: m.note || null, ownerName: m.who || null, held: m.held });
  const meetings = allMeetings.filter(m => m.held).map(m => m.kind === "calendar"
    ? { ...(past.find(e => e.id === m.id) || { id: m.id, title: m.title, startsAt: m.starts_at }), kind: "calendar", date: m.date, held: true }
    : loggedOut(m));
  const upcoming = [...calUpcoming.map(e => ({ ...e, kind: "calendar" })),
    ...allMeetings.filter(m => !m.held && m.kind === "logged").map(loggedOut)]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const nextMeeting = soon ? { ...soon, brief: await meetingBrief(orgId, donorId, soon.startsAt) } : null;

  // THE RHYTHM: the last twelve calendar months, this one last, each month's
  // count from the ONE meetings source. A month with a meeting still to come
  // says so, which is what the dashed cell on the profile means.
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const first = orgTime.addDays(today.slice(0, 8) + "01", 0);
    const dt = new Date(first + "T12:00:00Z"); dt.setUTCMonth(dt.getUTCMonth() - i);
    const from = dt.toISOString().slice(0, 8) + "01";
    const end = new Date(dt); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    months.push({ month: from.slice(0, 7), from, to: end.toISOString().slice(0, 10) });
  }
  const yearFrom = months[0].from, yearTo = months[11].to;
  const meetingRows = allMeetings.filter(r => r.date >= yearFrom && r.date <= yearTo);
  const rhythm = months.map(m => ({ ...m,
    count: meetingRows.filter(r => r.date >= m.from && r.date <= m.to && r.date <= today).length,
    upcoming: upcoming.some(e => String(e.date).slice(0, 7) === m.month) }));

  // THIS YEAR, from the same sources the drawer opens.
  const jan1 = today.slice(0, 4) + "-01-01";
  const fv = (key, params) => figureSources.figureValue(orgId, { key, params }, {});
  const [emails, fromThem, meetingsY, given] = await Promise.all([
    fv("donor-emails", { donor: donorId, from: jan1, to: today }),
    fv("donor-emails", { donor: donorId, from: jan1, to: today, direction: "inbound" }),
    fv("meetings", { from: jan1, to: today, donor: donorId }),
    fv("donor-gifts-between", { donor: donorId, from: jan1, to: today }),
  ]);
  const thisYear = {
    from: jan1, to: today,
    emails: { value: emails.value || 0, source: { key: "donor-emails", params: { donor: donorId, from: jan1, to: today } } },
    fromThem: { value: fromThem.value || 0, source: { key: "donor-emails", params: { donor: donorId, from: jan1, to: today, direction: "inbound" } } },
    meetings: { value: meetingsY.value || 0, source: { key: "meetings", params: { from: jan1, to: today, donor: donorId } } },
    given: { value: given.value || 0, source: { key: "donor-gifts-between", params: { donor: donorId, from: jan1, to: today } } },
  };

  // EMAIL THREADS: messages grouped by subject (Re:/Fwd: stripped), newest
  // first, each with its count, attachments and the last reply quoted.
  const mails = await query(
    `SELECT id, note, date, metadata FROM interactions WHERE org_id=? AND donor_id=? AND type='email'
      ORDER BY date DESC, created_at DESC LIMIT 400`, [orgId, donorId]);
  const threads = new Map();
  // FIX-22 · AN ATTACHMENT THE TIMELINE COUNTS MUST OPEN SOMEWHERE. Mailbox
  // sync counts attachments and never keeps them (shared/mailboxLog.js, and the
  // sentence she agreed to when she connected). The file stays in the mailbox
  // it arrived in, so the count carries a link back to that message there.
  const boxRows = await query(
    `SELECT mc.user_id, mc.provider, mc.address, u.name FROM mailbox_connections mc LEFT JOIN users u ON u.id = mc.user_id
      WHERE mc.org_id=?`, [orgId]);
  const boxOf = new Map(boxRows.map(b => [b.user_id + "|" + b.provider, b]));
  // FIX-25: a demo org's emails were seeded, never sent, so there is no
  // message in any mailbox to open. It says so instead of linking to an inbox.
  const [orgRow] = await query(`SELECT is_demo_org FROM orgs WHERE id=?`, [orgId]);
  const demoOrg = orgRow?.is_demo_org === true;
  const mailFileOf = (m, meta) => {
    const n = Number(meta.attachments) || 0;
    if (!n || !meta.provider || !meta.message_id) return null;
    if (demoOrg) return { interactionId: m.id, count: n, app: meta.provider === "google" ? "Gmail" : "Outlook", url: null, demo: true,
      owner: null, date: m.date, subject: meta.subject || null };
    const box = boxOf.get(meta.logged_by + "|" + meta.provider) || {};
    const app = meta.provider === "google" ? "Gmail" : "Outlook";
    const url = meta.provider === "google"
      ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(box.address || "")}#all/${encodeURIComponent(meta.message_id)}`
      : (/^https:\/\/outlook\.(office|live)\.com\//.test(String(meta.web_link || "")) ? meta.web_link : null);
    const owner = String(box.name || "").split(" ")[0] || null;
    return { interactionId: m.id, count: n, app, url, owner, date: m.date, subject: meta.subject || null };
  };
  for (const m of mails) {
    const meta = typeof m.metadata === "string" ? JSON.parse(m.metadata || "{}") : (m.metadata || {});
    const subject = String(meta.subject || String(m.note || "").split("\n")[0] || "Email").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim() || "Email";
    const k = subject.toLowerCase();
    const t = threads.get(k) || { key: k, subject, count: 0, attachments: 0, lastDate: m.date, lastId: m.id, lastQuote: null, lastDirection: meta.direction || null, ids: [] };
    t.count++; t.attachments += Number(meta.attachments) || 0; t.ids.push(m.id);
    const mf = mailFileOf(m, meta); if (mf) (t.mailFiles = t.mailFiles || []).push(mf);
    if (!t.lastQuote) t.lastQuote = String(m.note || "").split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim().slice(0, 240) || null;
    threads.set(k, t);
  }

  const [thread] = await query(
    `SELECT id, next_step_label, due_date FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL LIMIT 1`, [orgId, donorId]);
  // WIRE-1: AN EMPLOYER SEES THE GIFTS IT MATCHED. The employee's gift names
  // the employer (gifts.match_employer_id); on the employer's record each one
  // is a timeline line labelled as matched, opening the employee.
  const matchedGifts = await query(
    `SELECT g.id, g.amount::float AS amount, LEFT(g.date::text,10) AS date, g.donor_id, d.name AS donor_name, g.match_pledge_id
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
      WHERE g.org_id=? AND g.match_employer_id=? ORDER BY g.date DESC LIMIT 200`, [orgId, donorId]).catch(() => []);
  res.json({
    today, upcoming, past, meetings, nextMeeting, rhythm, thisYear, matchedGifts,
    emailThreads: [...threads.values()],
    nextStep: thread ? { id: thread.id, label: thread.next_step_label, due: thread.due_date } : null,
    rhythmSentence: "Each cell is a calendar month, this one last. Brass means at least one meeting with them that month; a dashed cell is a meeting still to come.",
  });
}));

// WHO AM I SEEING TODAY. Her own calendar only, each meeting with its brief.
// FIX-12 Part 7a: one composer for Home and for the optional morning email.
// FIX-14 Part 2b — `withLogged` (the morning email): today's meetings from the
// one source (meetings.js), so a meeting she logged ahead for today is in the
// list too, after the calendar's, with no time. A calendar meeting that was
// logged is still listed once, as the calendar meeting.
async function composeTodayMeetings(orgId, userId, { withLogged = false } = {}) {
  const { tz, today } = await meetingTz(orgId);
  const rows = await query(
    `SELECT c.*, u.name AS owner_name FROM calendar_events c LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.org_id=? AND c.owner_user_id=? AND (c.starts_at AT TIME ZONE ?)::date = ?::date
      ORDER BY c.starts_at`, [orgId, userId, tz, today]);
  let logged = [];
  if (withLogged) {
    const { sql, args } = meetingsSrc.meetingsSql(orgId, { staff: userId, from: today, to: today });
    const fromCal = new Set(rows.map(r => r.interaction_id).filter(Boolean));
    logged = (await query(`SELECT * FROM (${sql}) m WHERE m.kind = 'logged' ORDER BY m.id`, args)).filter(m => !fromCal.has(m.id));
  }
  const ids = [...new Set([...rows.flatMap(r => [...(r.person_ids || []), ...(r.candidate_ids || [])]), ...logged.map(m => m.donor_id)])];
  const names = ids.length ? Object.fromEntries((await query(`SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?)`, [orgId, ids])).map(r => [r.id, r.name])) : {};
  const out = [];
  for (const r of rows) {
    const people = (r.person_ids || []).map(id => ({ id, name: names[id] })).filter(p => p.name);
    const candidates = (r.candidate_ids || []).map(id => ({ id, name: names[id] })).filter(p => p.name);
    out.push(eventOut(r, { people, candidates, brief: people.length === 1 ? await meetingBrief(orgId, people[0].id, r.starts_at) : null }));
  }
  for (const m of logged) {
    const people = names[m.donor_id] ? [{ id: m.donor_id, name: names[m.donor_id] }] : [];
    out.push({ id: m.id, kind: "logged", title: "Meeting", startsAt: null, location: m.location || null, personIds: [m.donor_id],
      people, brief: people.length ? await meetingBrief(orgId, m.donor_id, new Date().toISOString()) : null });
  }
  return { today, tz, meetings: out };
}
sharedComposeTodayMeetings = composeTodayMeetings;

app.get("/calendar/today", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { today, meetings: out } = await composeTodayMeetings(orgId, req.user.userId);
  const [conn] = await query(`SELECT provider FROM mailbox_connections WHERE user_id=? AND org_id=? AND status <> 'disconnected' AND calendar_granted = true LIMIT 1`, [req.user.userId, orgId]);
  res.json({ today, meetings: out, provider: conn?.provider || null,
    sentence: "From your own calendar. Only meetings with people in Steward show here." });
}));

// HOW DID IT GO. Her meetings that ended in the last seven days with nothing
// written down yet, newest first.
app.get("/calendar/to-log", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT c.* FROM calendar_events c WHERE c.org_id=? AND c.owner_user_id=? AND c.logged_at IS NULL AND c.dismissed_at IS NULL
        AND c.ends_at <= NOW() AND c.ends_at >= NOW() - INTERVAL '7 days' ORDER BY c.ends_at DESC LIMIT 10`,
    [orgId, req.user.userId]);
  const ids = [...new Set(rows.flatMap(r => r.person_ids || []))];
  const names = ids.length ? Object.fromEntries((await query(`SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?)`, [orgId, ids])).map(r => [r.id, r.name])) : {};
  res.json({ meetings: rows.map(r => eventOut(r, { people: (r.person_ids || []).map(id => ({ id, name: names[id] })).filter(p => p.name) })) });
}));

async function ownMeeting(req, res) {
  const [c] = await query(`SELECT * FROM calendar_events WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!c) { res.status(404).json({ error: "not_found", sentence: "That meeting is not on this organisation." }); return null; }
  if (c.owner_user_id !== req.user.userId) {
    const [me] = await query(`SELECT role FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
    if (!(me && me.role === "admin")) { res.status(403).json({ error: "not_yours", sentence: "Only the person whose calendar it is, or an admin, can log this meeting." }); return null; }
  }
  return c;
}

// WHAT STEWARD HEARD. Reads her note and offers chips. Writes nothing.
app.post("/calendar/events/:id/suggest", requireAuth, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  const N = await meetingNoteMod();
  const funds = await query(`SELECT id, name FROM fin_funds WHERE org_id=?`, [req.user.orgId]);
  const brief = c.person_ids?.length === 1 ? await meetingBrief(req.user.orgId, c.person_ids[0], c.starts_at) : null;
  const note = String(req.body?.note || "").slice(0, 4000);
  const ctx = { funds, openAsk: brief?.openAsk || null };
  // FIX-12 Part 7b: the Agent engine reads the note, through the one AI door;
  // the simple reader is the fallback when AI is off or nothing it says holds.
  let suggestions = null, source = "reader", aiOff = false;
  if (note.trim()) {
    try {
      const PS = await import("../shared/agentPersonas.js");
      const prompt = N.buildNoteChipPrompt(note, ctx, PS.MEETING_NOTE.systemPrompt);
      const r = await anthropicFor(req.user.orgId).messages.create({
        model: AGENT_MODEL, max_tokens: 800, system: prompt.system, messages: prompt.messages,
        tools: [N.NOTE_CHIP_TOOL], tool_choice: { type: "tool", name: N.NOTE_CHIP_TOOL.name } });
      const use = (r.content || []).find(c => c.type === "tool_use");
      const chips = N.validateNoteChips(use && use.input && use.input.chips, note, ctx);
      if (chips.length) { suggestions = chips; source = "agent"; }
    } catch (e) {
      if (e instanceof AiOffError) aiOff = e.reason === "ai_disabled";
      else recordAiFallback(req.user.orgId, "meeting_chips", e);
    }
  }
  if (!suggestions) suggestions = N.suggestFromNote(note, ctx);
  res.json({ suggestions, source,
    sentence: aiOff ? AI_OFF_MESSAGE + ". These come from Steward's simple reader. Nothing is recorded until you press save."
      : "Read from your note. Nothing is recorded until you press save." });
}));

// SAVE. Her note goes on the meeting and on each person's record as a
// meeting, which is a touch: it feeds Last met and Last contact and can close
// a contact step. It never touches giving, drift, LYBUNT or SYBUNT; a pledge
// or gift she confirmed is recorded by the page through the ordinary gift and
// pledge routes, and the next step through the ordinary thread route.
app.post("/calendar/events/:id/log", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  if (c.logged_at) return res.status(409).json({ error: "already_logged", sentence: "This meeting already has a note." });
  const note = String(req.body?.note || "").trim().slice(0, 8000);
  const nextStep = String(req.body?.nextStep || "").trim().slice(0, 300) || null;
  // FIX-33 Part 3b: the meeting card's fields. Each is optional; what she
  // filled in rides on the conversation, and the date, place and who
  // attended come from the meeting itself.
  const B = req.body || {};
  const txt = (v, n) => String(v || "").trim().slice(0, n) || null;
  const nextStepDate = /^\d{4}-\d{2}-\d{2}$/.test(String(B.nextStepDate || "")) ? String(B.nextStepDate) : null;
  const askAmount = B.askAmount != null && B.askAmount !== "" && Number.isFinite(Number(B.askAmount)) && Number(B.askAmount) >= 0 ? Math.round(Number(B.askAmount) * 100) / 100 : null;
  const ASK_OUTCOMES = ["yes", "no", "thinking", "not_asked"];
  const askOutcome = ASK_OUTCOMES.includes(B.askOutcome) ? B.askOutcome : null;
  const card = { takeaways: txt(B.takeaways, 2000), cares: txt(B.cares, 1000), ask_amount: askAmount, ask_outcome: askOutcome,
                 next_step_date: nextStepDate };
  const who = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  const attendees = (await query(`SELECT name FROM donors WHERE org_id=? AND id = ANY(?)`, [req.user.orgId, c.person_ids || []])).map(r => r.name);
  // FIX-14 Part 1 — the meeting's day in the ORG's zone. toISOString gave its
  // UTC day, so a 9pm meeting in New York was logged as the next day.
  const date = orgToday(await orgTz(req.user.orgId), new Date(c.starts_at));   // ORG_TZ_SEAM_OK
  const firstId = "int_" + uuid().slice(0, 8);
  let i = 0;
  for (const donorId of c.person_ids || []) {
    const intId = i === 0 ? firstId : "int_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata)
       VALUES (?,?,?,'meeting',?,?,?,?,?)`,
      [intId, req.user.orgId, donorId, [c.title, note].filter(Boolean).join("\n\n"), date, who.id, u?.name || null,
       JSON.stringify({ calendar_event_id: c.id, provider: c.provider, location: c.location || null,
                        minutes: Math.round((new Date(c.ends_at) - new Date(c.starts_at)) / 60000), next_step: nextStep,
                        attendees, staff: u?.name || null, ...card })]);
    await closeThreadStepForContact(req.user.orgId, donorId, date, intId).catch(() => {});
    i++;
  }
  await run(`UPDATE calendar_events SET note=?, next_step=?, logged_at=NOW(), logged_by=?, interaction_id=?, updated_at=NOW() WHERE id=?`,
    [note || null, nextStep, who.id, firstId, c.id]);
  // FIX-33 Part 3: the prep and after tasks are done and the meeting step is
  // answered. A next step with a date becomes the person's open step.
  await require("../meetingEffects").meetingLogged(c.id, firstId);
  if (nextStep && nextStepDate) {
    const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
    for (const donorId of c.person_ids || []) {
      const open = await query(`SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL`, [req.user.orgId, donorId]);
      if (open.length) continue;
      await run(
        `INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,opening_interaction_id,owner_id,owner_name,created_by,created_by_name)
         VALUES (?,?,?,'follow_up',?,?,?,?,?,?,?,?)`,
        ["th_" + uuid().slice(0, 10), req.user.orgId, donorId, nextStep, nextStepDate, today, firstId, who.id, u?.name || null, who.id, who.name]);
    }
  }
  req.audit && (req.audit.detail = { meeting: c.id, people: (c.person_ids || []).length });
  res.json({ ok: true, interactionId: firstId, sentence: "Saved to the meeting and to the record." });
}));

// FIX-14 Part 2 — EDIT STEWARD'S OWN PARTS of a calendar meeting: the note,
// the next step and who it is about. The time, the title and the place belong
// to the calendar it came from; Steward never edits the event, and says where
// to change it instead.
app.put("/calendar/events/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  const b = req.body || {};
  const day = new Date(c.starts_at).toISOString().slice(0, 10).replace(/-/g, "/");
  const calendarUrl = c.provider === "google" ? `https://calendar.google.com/calendar/r/day/${day}`
    : `https://outlook.office.com/calendar/view/day/${day}`;
  for (const k of ["title", "startsAt", "endsAt", "location"]) {
    if (b[k] !== undefined) return res.status(409).json({ error: "calendar_owned", calendarUrl,
      sentence: "The time and place come from your calendar. Change it in your calendar." });
  }
  const sets = [], vals = [];
  if (b.note !== undefined) { sets.push("note=?"); vals.push(String(b.note || "").trim().slice(0, 8000) || null); }
  if (b.nextStep !== undefined) { sets.push("next_step=?"); vals.push(String(b.nextStep || "").trim().slice(0, 300) || null); }
  if (b.personIds !== undefined) {
    const ids = [...new Set((Array.isArray(b.personIds) ? b.personIds : []).map(String))];
    if (!ids.length) return res.status(400).json({ error: "no_person", sentence: "A meeting is about at least one person." });
    const ok = await query(`SELECT id FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL`, [req.user.orgId, ids]);
    if (ok.length !== ids.length) return res.status(404).json({ error: "Donor not found" });
    sets.push("person_ids=?"); vals.push(ids);
  }
  if (!sets.length) return res.json({ ok: true, unchanged: true });
  await run(`UPDATE calendar_events SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...vals, c.id, req.user.orgId]);
  // The logged note on the record says the same thing as the meeting.
  if (b.note !== undefined && c.interaction_id) {
    const [u] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
    await run(`UPDATE interactions SET note=?, edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?`,
      [[c.title, String(b.note || "").trim()].filter(Boolean).join("\n\n"), req.user.userId, u?.name || req.user.email || "", c.interaction_id, req.user.orgId]);
  }
  const [out] = await query(`SELECT * FROM calendar_events WHERE id=?`, [c.id]);
  res.json({ ok: true, meeting: out, sentence: "Saved. The event on your calendar is unchanged." });
}));

app.post("/calendar/events/:id/dismiss", requireAuth, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  await run(`UPDATE calendar_events SET dismissed_at=NOW(), updated_at=NOW() WHERE id=?`, [c.id]);
  res.json({ ok: true, sentence: "Fine. It stays on the record from your calendar, without a note." });
}));

// BOOK A VISIT and MOVE IT. Both write to HER OWN calendar through her own
// connection. The donor is invited only if she ticked the box (off by
// default), because an invite is mail from her calendar to the donor.
async function myCalendarConn(req, res) {
  const ML = await mailboxMod();
  const [org] = await query("SELECT id, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
  if (ML.isDemoMailboxOrg(org)) { res.status(409).json({ error: "demo_org", sentence: ML.DEMO_CONNECT_SENTENCE }); return null; }
  const [conn] = await query(
    `SELECT * FROM mailbox_connections WHERE user_id=? AND org_id=? AND status='active' AND calendar_granted=true
      ORDER BY provider LIMIT 1`, [req.user.userId, req.user.orgId]);
  if (!conn) { res.status(409).json({ error: "no_calendar", sentence: "Connect your calendar first. Settings, Connections, Email and calendar." }); return null; }
  const token = await mailboxAccessToken(conn, req.user.orgId, conn.provider);
  if (!token) { res.status(409).json({ error: "calendar_broken", sentence: "Your calendar needs connecting again before Steward can add to it." }); return null; }
  return { conn, token };
}
const validInstant = v => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

app.post("/donors/:id/book-visit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id, name, email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const startsAt = validInstant(req.body?.startsAt), endsAt = validInstant(req.body?.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) return res.status(400).json({ error: "bad_time", sentence: "Choose a start and an end, with the end after the start." });
  const invite = req.body?.inviteDonor === true;
  if (invite && !d.email) return res.status(400).json({ error: "no_email", sentence: `${d.name} has no email on file, so there is nobody to invite.` });
  const got = await myCalendarConn(req, res); if (!got) return;
  const CL = await calendarMod();
  const title = String(req.body?.title || `Visit with ${d.name}`).trim().slice(0, 200);
  const location = String(req.body?.location || "").trim().slice(0, 200) || null;
  const timeZone = (await orgTz(orgId)).timezone || "America/New_York";
  const body = CL.bookingBody(got.conn.provider, { title, startsAt, endsAt, location, inviteEmail: invite ? d.email : null, timeZone });
  const url = got.conn.provider === "google"
    ? `${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events?sendUpdates=${CL.googleSendUpdates(invite)}`
    : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me/events`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + got.token, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const made = r && r.ok ? await r.json().catch(() => null) : null;
  if (!made?.id) return res.status(502).json({ error: "calendar_refused", sentence: "Your calendar did not accept the event. Nothing was added." });
  const who = actor(req);
  const id = "cal_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,booked_in_steward,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,true,?,?)`,
    [id, orgId, req.user.userId, got.conn.provider, String(made.id), title, startsAt, endsAt, location, [d.id], who.id, who.name]);
  // FIX-33 Part 3: the booking reaches the whole record, not only Coming up.
  // The step and tasks carry her NAME (the walk showed her email address there).
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  await require("../meetingEffects").applyMeeting(id, { actorId: who.id, actorName: me?.name || who.name });
  res.status(201).json({ ok: true, id, sentence: invite
    ? `On your calendar, and ${d.name} was sent the invitation from it.`
    : `On your calendar. ${d.name} was not invited; you can add them from your calendar if you want to.` });
}));

app.post("/calendar/events/:id/move", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  if (c.owner_user_id !== req.user.userId) return res.status(403).json({ error: "not_yours", sentence: "Only the person whose calendar it is can move it." });
  const startsAt = validInstant(req.body?.startsAt), endsAt = validInstant(req.body?.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) return res.status(400).json({ error: "bad_time", sentence: "Choose a start and an end, with the end after the start." });
  const got = await myCalendarConn(req, res); if (!got) return;
  const google = c.provider === "google";
  const url = google
    ? `${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events/${encodeURIComponent(c.provider_event_id)}?sendUpdates=all`
    : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me/events/${encodeURIComponent(c.provider_event_id)}`;
  const CLm = await calendarMod();
  const body = CLm.timeBlock(c.provider, startsAt, endsAt, (await orgTz(req.user.orgId)).timezone || "America/New_York");
  const r = await fetch(url, { method: "PATCH", headers: { Authorization: "Bearer " + got.token, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r || !r.ok) return res.status(502).json({ error: "calendar_refused", sentence: "Your calendar did not accept the change. Nothing moved." });
  await run(`UPDATE calendar_events SET starts_at=?, ends_at=?, updated_at=NOW() WHERE id=?`, [startsAt, endsAt, c.id]);
  const whoM = actor(req);
  const [meM] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  await require("../meetingEffects").applyMeeting(c.id, { actorId: whoM.id, actorName: meM?.name || whoM.name });
  res.json({ ok: true, sentence: "Moved on your calendar, and the prep, the follow-up and the next step moved with it." });
}));

// FIX-33 · CANCEL. Off her calendar, and everything the booking changed on the
// record comes off with it: the tasks close, the step goes back to what it was.
app.post("/calendar/events/:id/cancel", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  if (c.owner_user_id !== req.user.userId) return res.status(403).json({ error: "not_yours", sentence: "Only the person whose calendar it is can cancel it." });
  if (c.logged_at) return res.status(409).json({ error: "already_logged", sentence: "This meeting has a note, so it happened. It stays on the record." });
  const got = await myCalendarConn(req, res); if (!got) return;
  const url = c.provider === "google"
    ? `${process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com"}/calendar/v3/calendars/primary/events/${encodeURIComponent(c.provider_event_id)}?sendUpdates=all`
    : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me/events/${encodeURIComponent(c.provider_event_id)}`;
  const r = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer " + got.token } }).catch(() => null);
  if (!r || !(r.ok || r.status === 404 || r.status === 410))
    return res.status(502).json({ error: "calendar_refused", sentence: "Your calendar did not accept the cancellation. Nothing changed." });
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  await require("../meetingEffects").revertMeeting(c.id, { actorId: who.id, actorName: me?.name || who.name });
  await run(`DELETE FROM calendar_events WHERE id=? AND org_id=?`, [c.id, req.user.orgId]);
  res.json({ ok: true, sentence: "Cancelled on your calendar. The prep and follow-up are closed and the next step is back to what it was." });
}));

// FIX-33 Part 3b · ADD TO A DONOR'S RECORD. One click from Steward's
// Calendar, Home's today list or the event itself: the person she picks is
// linked, the candidates are cleared, and the booking takes effect.
app.post("/calendar/events/:id/people", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await ownMeeting(req, res); if (!c) return;
  const donorId = String(req.body?.donorId || "");
  const [d] = await query(`SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const ids = [...new Set([...(c.person_ids || []), d.id])];
  await run(`UPDATE calendar_events SET person_ids=?, candidate_ids='{}', matched_by='person', updated_at=NOW() WHERE id=? AND org_id=?`,
    [ids, c.id, req.user.orgId]);
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=?`, [req.user.userId]);
  await require("../meetingEffects").applyMeeting(c.id, { actorId: who.id, actorName: me?.name || who.name });
  res.json({ ok: true, personIds: ids, sentence: `On ${d.name}'s record now, ready for notes.` });
}));

// ── CAL-1 · ONE CALENDAR FOR EVERYTHING ─────────────────────────────────────
// GET /calendar/items?from&to&scope=mine|everyone&staff=<user>&types=a,b
// Meetings, next steps and tasks, shifts, events, journey steps, sends,
// pledge instalments and (when asked) birthdays, in the org's own time.
// Read only; a move goes through the item's own route (shared/calendarMoves.js).
const CAL = require("../calendar");
app.get("/calendar/items", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(req.query.from || ""), to = String(req.query.to || "");
  if (!D.test(from) || !D.test(to) || to < from) return res.status(400).json({ error: "bad_range", sentence: "Choose a start and an end date." });
  if (orgTime.daysBetween(from, to) > 62) return res.status(400).json({ error: "too_long", sentence: "The calendar shows at most two months at a time." });
  const tzRow = await orgTz(orgId);
  const tz = tzRow.timezone || orgTime.DEFAULT_TZ;
  const isAdmin = req.user.role === "admin";
  const staff = isAdmin && req.query.staff ? String(req.query.staff) : null;
  const types = req.query.types ? String(req.query.types).split(",") : CAL.DEFAULT_ON;
  const items = await CAL.calendarItems(orgId, { from, to, tz, userId: req.user.userId, scope: req.query.scope === "mine" ? "mine" : "everyone", staff, types });
  const staffList = isAdmin ? await query(`SELECT id, name FROM users WHERE org_id = ? AND deactivated_at IS NULL ORDER BY name`, [orgId]).catch(() => []) : [];
  // FIX-31: open tasks with no day yet, so the calendar can offer "Give it a day".
  const owner = staff || (req.query.scope === "mine" ? req.user.userId : null);
  const undated = types.includes("step") ? await query(
    `SELECT t.id, t.title, t.assigned_to_name, d.id AS donor_id, d.name AS donor_name FROM tasks t
       LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND COALESCE(t.done::text, '0') NOT IN ('1', 'true') AND t.voided_at IS NULL AND COALESCE(t.is_sample, false) = false
        AND COALESCE(t.due, '') = '' AND (t.donor_id IS NULL OR d.deleted_at IS NULL) AND (?::text IS NULL OR t.assigned_to = ?)
      ORDER BY t.created_at DESC LIMIT 25`, [orgId, owner, owner]) : [];
  res.json({ items, undated: undated.map(r => ({ taskId: r.id, title: r.title, ownerName: r.assigned_to_name || "", donorId: r.donor_id || null, donorName: r.donor_name || null })), today: orgToday(tzRow), timezone: tz, timezoneConfirmed: !!tzRow.timezone_confirmed_at, types: CAL.TYPES, defaultOn: CAL.DEFAULT_ON, staff: staffList });
}));

// FIX-28 · HER STEWARD DATES ON HER OWN CALENDAR. Off until she turns it on.
// GET says whether she can and whether it is on; PUT turns it on or off and
// runs once straight away; POST /run brings her calendar up to date now.
app.get("/calendar/push-dates", requireAuth, wrap(async (req, res) => {
  const [conn] = await query(
    `SELECT provider, push_dates FROM mailbox_connections WHERE user_id=? AND org_id=? AND status='active' AND calendar_granted=true
        AND credentials_sealed IS NOT NULL ORDER BY provider LIMIT 1`, [req.user.userId, req.user.orgId]);
  res.json({ connected: !!conn, provider: conn ? conn.provider : null, enabled: !!(conn && conn.push_dates) });
}));
app.put("/calendar/push-dates", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const [conn] = await query(
    `SELECT id, provider FROM mailbox_connections WHERE user_id=? AND org_id=? AND status='active' AND calendar_granted=true
        AND credentials_sealed IS NOT NULL ORDER BY provider LIMIT 1`, [req.user.userId, req.user.orgId]);
  if (!conn) return res.status(409).json({ error: "no_calendar", sentence: "Connect your calendar first. Settings, Connections, Email and calendar." });
  const enabled = req.body?.enabled === true;
  await run(`UPDATE mailbox_connections SET push_dates=? WHERE id=?`, [enabled, conn.id]);
  const r = await pushStewardDates(req.user.userId, req.user.orgId, conn.provider).catch(() => ({ pushed: 0 }));
  const where = conn.provider === "microsoft" ? "Outlook" : "Google";
  res.json({ ok: true, enabled, pushed: r.pushed, sentence: enabled
    ? `Your grant deadlines, next steps and journey steps for the next 60 days are on your ${where} calendar.`
    : `Steward took its dates off your ${where} calendar.` });
}));
app.post("/calendar/push-dates/run", requireAuth, wrap(async (req, res) => {
  const [conn] = await query(
    `SELECT provider FROM mailbox_connections WHERE user_id=? AND org_id=? AND status='active' AND calendar_granted=true AND push_dates=true
      ORDER BY provider LIMIT 1`, [req.user.userId, req.user.orgId]);
  if (!conn) return res.json({ ok: true, pushed: 0 });
  const r = await pushStewardDates(req.user.userId, req.user.orgId, conn.provider).catch(() => ({ pushed: 0 }));
  res.json({ ok: true, pushed: r.pushed });
}));

// An event's day and times, on their own: what a drag on the calendar
// changes. The full edit (PUT /events/:id) replaces every column, which a
// drag must never do; this one changes these three and nothing else.
app.patch("/events/:id/schedule", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [e] = await query(`SELECT id, date::text AS date, start_time, end_time FROM events WHERE id = ? AND org_id = ?`, [req.params.id, orgId]);
  if (!e) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const T = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ""))) return res.status(400).json({ error: "bad_date", sentence: "An event needs a date." });
  const st = b.startTime === undefined ? e.start_time : (b.startTime || null), en = b.endTime === undefined ? e.end_time : (b.endTime || null);
  if ((st && !T.test(st)) || (en && !T.test(en)) || (st && en && en <= st)) return res.status(400).json({ error: "bad_time", sentence: "An event ends after it starts, on the same day." });
  req.audit = { ...(req.audit || {}), before: { date: String(e.date).slice(0, 10), startTime: e.start_time, endTime: e.end_time }, after: { date: b.date, startTime: st, endTime: en } };
  await run(`UPDATE events SET date = ?, start_time = ?, end_time = ? WHERE id = ? AND org_id = ?`, [b.date, st, en, e.id, orgId]);
  res.json({ ok: true, date: b.date, startTime: st, endTime: en });
}));

// THE FIRST SYNC, AND WHAT IS WORTH A LOOK. Three numbers from the sources
// the drawer opens, and three kinds of prompt, each from rows that exist.
app.get("/calendar/first-sync", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, me = req.user.userId;
  const { today } = await meetingTz(orgId);
  const since = orgTime.addDays(today, -730);
  const CL = await calendarMod();
  const winFrom = orgTime.addDays(today, -CL.WINDOW_PAST_DAYS), winTo = orgTime.addDays(today, CL.WINDOW_AHEAD_DAYS);
  const fv = (key, params) => figureSources.figureValue(orgId, { key, params }, {});
  const [emails, meetings, people] = await Promise.all([
    fv("mailbox-emails", { staff: me, since }), fv("meetings", { from: winFrom, to: winTo, staff: me }), fv("mailbox-people", { staff: me, since }),
  ]);
  const look = [];
  const [soon] = await query(
    `SELECT c.id, c.starts_at, c.person_ids FROM calendar_events c WHERE c.org_id=? AND c.owner_user_id=?
        AND c.starts_at > NOW() AND c.starts_at <= NOW() + INTERVAL '2 days' ORDER BY c.starts_at LIMIT 1`, [orgId, me]);
  if (soon) {
    const [p] = await query(`SELECT id, name FROM donors WHERE org_id=? AND id=?`, [orgId, soon.person_ids[0]]);
    if (p) look.push({ kind: "meeting", donorId: p.id, name: p.name, startsAt: soon.starts_at, action: "Open the brief" });
  }
  const [waiting] = await query(
    `SELECT i.donor_id, d.name, MAX(i.date) AS last_in, COUNT(*)::int AS n FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id
      WHERE i.org_id=? AND i.type='email' AND i.metadata->>'direction'='inbound' AND i.metadata->>'logged_by'=? AND d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM interactions o WHERE o.org_id=i.org_id AND o.donor_id=i.donor_id AND o.type='email'
                          AND o.metadata->>'direction'='outbound' AND o.date >= i.date)
      GROUP BY i.donor_id, d.name HAVING MAX(i.date) <= ? ORDER BY MAX(i.date) LIMIT 1`, [orgId, me, orgTime.addDays(today, -7)]);
  if (waiting) look.push({ kind: "unanswered", donorId: waiting.donor_id, name: waiting.name, count: waiting.n,
    days: orgTime.daysBetween(String(waiting.last_in).slice(0, 10), today), action: "Open thread" });
  const [top] = (await figureSources.figure(orgId, { key: "no-recent-meeting", params: { since: orgTime.addDays(today, -365), owner: me } }, {}, { pageSize: 1 })).rows || [];
  if (top && Number(top.amount) > 0) look.push({ kind: "no_meeting", donorId: top.donorId || top.donor_id || top.id, name: top.name, given: Number(top.amount), lastMet: top.date || null, action: "Book a visit" });
  res.json({
    emails: { value: emails.value || 0, source: { key: "mailbox-emails", params: { staff: me, since } } },
    meetings: { value: meetings.value || 0, source: { key: "meetings", params: { from: winFrom, to: winTo, staff: me } } },
    people: { value: people.value || 0, source: { key: "mailbox-people", params: { staff: me, since } } },
    worthALook: look, since, today,
  });
}));

// MOVES MANAGEMENT · MEETINGS PER STAFF MEMBER PER MONTH. Every cell is the
// ONE `meetings` source with that person and that month, so a cell opens
// exactly the rows it counts and the row total is the same source over the
// whole year.
app.get("/meetings/by-staff", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { today } = await meetingTz(orgId);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(today.slice(0, 8) + "01T12:00:00Z"); dt.setUTCMonth(dt.getUTCMonth() - i);
    const from = dt.toISOString().slice(0, 10);
    const end = new Date(dt); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    months.push({ month: from.slice(0, 7), from, to: end.toISOString().slice(0, 10) });
  }
  const users = await query(`SELECT id, name, email FROM users WHERE org_id=? ORDER BY name`, [orgId]);
  const staff = [];
  for (const u of users) {
    const cells = await Promise.all(months.map(async m => {
      const params = { from: m.from, to: m.to, staff: u.id };
      const f = await figureSources.figureValue(orgId, { key: "meetings", params }, {});
      return { month: m.month, value: f.value || 0, source: { key: "meetings", params } };
    }));
    const totalParams = { from: months[0].from, to: months[11].to, staff: u.id };
    const total = await figureSources.figureValue(orgId, { key: "meetings", params: totalParams }, {});
    staff.push({ id: u.id, name: u.name || u.email, cells, total: { value: total.value || 0, source: { key: "meetings", params: totalParams } } });
  }
  res.json({ months, staff: staff.sort((a, b) => b.total.value - a.total.value),
    sentence: "Meetings with someone on file, by the staff member who held them, month by month: meetings on that person's connected calendar, and meetings they logged by hand. A calendar meeting that was logged afterwards counts once." });
}));

// ═══ INT-3 · THE EMAIL TOOL SHE ALREADY PAYS FOR ═══════════════════════════
//
// STEWARD NEVER SENDS THE EMAIL. There is no send path in this block and there
// must never be one: the outbound direction is a list of names, emails and
// tags, and the inbound direction is who opened, who clicked and who stopped.
//
// Everything a person reads comes from shared/emailMarketing.js, so the
// preview count on the screen, the sentence in the sync log and the number in
// the campaign list are one computation rather than three that drift.
const emailProviderRow = async (orgId, provider) => {
  const [row] = await query(
    `SELECT * FROM email_marketing_connections WHERE org_id=? AND provider=? AND status <> 'disconnected'`,
    [orgId, provider]);
  return row || null;
};

// The people in each mapped group, resolved through the SAME segment resolver
// the campaign sender uses. `memberOf` is the set of audience ids a person is
// in, which is what turns the org's mapping into that person's tags.
async function audienceMembership(orgId, audienceIds) {
  const A = await import("../shared/audiences.js");
  const donors = await query(
    `SELECT id, name, email, deceased, do_not_contact, do_not_email, email_unreachable, is_sample,
            stage, capacity_tier, total_giving, person_types
       FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]);
  // BUILD-94's opt-out truth, read once: `do_not_email` on the record OR a row
  // in `email_suppressions`. One definition, asked here, passed to the pure
  // module. INT-3 adds no second flag.
  const sup = await query(
    `SELECT LOWER(email) AS email FROM email_suppressions WHERE org_id IS NULL OR org_id=?`, [orgId]);
  const suppressed = new Set(sup.map(r => r.email).filter(Boolean));

  const memberOf = new Map();
  for (const audienceId of audienceIds) {
    let segment;
    if (A.isBuiltInId(audienceId)) {
      segment = A.segmentFor(A.builtInById(audienceId));
    } else {
      const [saved] = await query(`SELECT segment FROM audiences WHERE id=? AND org_id=?`, [audienceId, orgId]);
      if (!saved) continue;
      // PARITY-1 Part D — through the audience door, so a Group (static or by
      // rule) resolves to its members exactly as a campaign's would.
      segment = { mode: "audience", audienceId };
    }
    const resolved = await resolveSegmentSpec(segment, orgId);
    for (const d of filterBySegment(donors, resolved)) {
      if (!memberOf.has(d.id)) memberOf.set(d.id, []);
      memberOf.get(d.id).push(audienceId);
    }
  }
  return donors
    .filter(d => memberOf.has(d.id))
    .map(d => ({
      id: d.id, name: d.name, email: d.email,
      deceased: d.deceased === true,
      doNotContact: d.do_not_contact === true,
      optedOut: d.do_not_email === true || suppressed.has(String(d.email || "").toLowerCase()),
      emailUnreachable: d.email_unreachable === true,
      isSample: d.is_sample === true,
      memberOf: memberOf.get(d.id),
    }));
}

// ── THE TWO FETCHERS ───────────────────────────────────────────────────────
// Everything provider-specific is here and nothing else is. The judgement is
// in shared/emailMarketing.js; these only speak HTTP and shape what comes
// back into the one shape that module expects.
//
// A token for the email tools comes from the same `accessTokenFor` the
// bookkeeping path uses, so a Constant Contact token refreshes five minutes
// before expiry and once more on a 401, and Mailchimp's never-expiring token
// simply never triggers it.
const mailchimpBase = row => `https://${row.server_prefix}.api.mailchimp.com/3.0`;
const CC_BASE = "https://api.cc.email/v3";

async function emailToolFetch(orgId, provider, row, path, { method = "GET", body = null } = {}) {
  const first = await accessTokenFor(orgId, row, provider);
  // `accessTokenFor` answers with a refusal shape rather than throwing, and
  // that refusal is already the sentence a person should read.
  if (!first.ok) { const e = new Error(first.body.sentence); e.status = first.status; throw e; }
  const base = provider === "mailchimp" ? mailchimpBase(row) : CC_BASE;
  const call = t => fetch(base + path, {
    method,
    headers: { Authorization: "Bearer " + t, Accept: "application/json",
               ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let r = await call(first.accessToken);
  // A 401 gets ONE forced renewal and one retry. More than one is how a
  // revoked connection turns into a loop against somebody else's rate limit.
  if (r.status === 401) {
    const again = await accessTokenFor(orgId, row, provider, { force: true });
    if (again.ok) r = await call(again.accessToken);
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    // The STATUS goes to the console; the customer reads plain words.
    console.error(`[email-marketing] ${provider} ${path} answered ${r.status}`);
    const err = new Error(providerErrorSentence(provider, r.status, text));
    err.status = r.status;
    throw err;
  }
  return r.json().catch(() => ({}));
}

// The provider's refusal in words a person can act on. A raw status code on a
// customer's screen tells her nothing she can do.
function providerErrorSentence(provider, status, text) {
  const label = provider === "mailchimp" ? "Mailchimp" : "Constant Contact";
  if (status === 401 || status === 403)
    return `${label} no longer accepts Steward's permission. Reconnect it and nothing else is needed.`;
  if (status === 404) return `${label} could not find that list. It may have been deleted there.`;
  if (status === 429) return `${label} asked Steward to slow down. It will try again on the next check.`;
  if (status >= 500) return `${label} is having trouble at their end. Steward will try again on the next check.`;
  const snippet = String(text || "").slice(0, 160).replace(/\s+/g, " ").trim();
  return `${label} refused the request${snippet ? `: ${snippet}` : ""}.`;
}

/** The audiences or lists this account holds, for the mapping screen. */
async function providerAudiences(orgId, provider, row) {
  if (provider === "mailchimp") {
    const body = await emailToolFetch(orgId, provider, row, "/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count");
    return (body.lists || []).map(l => ({ id: l.id, name: l.name, members: l.stats?.member_count ?? null }));
  }
  const body = await emailToolFetch(orgId, provider, row, "/contact_lists?limit=100");
  return (body.lists || []).map(l => ({ id: l.list_id, name: l.name, members: l.membership_count ?? null }));
}

/** The addresses the tool already holds, so "new to Mailchimp" is a real count. */
async function knownEmails(orgId, provider, row) {
  const mapping = row.mapping
    ? (typeof row.mapping === "string" ? JSON.parse(row.mapping || "null") : row.mapping) : null;
  const audienceId = mapping?.audienceId || row.audience_id;
  if (!audienceId) return [];
  if (provider === "mailchimp") {
    const out = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
      const body = await emailToolFetch(orgId, provider, row,
        `/lists/${encodeURIComponent(audienceId)}/members?count=1000&offset=${offset}&fields=members.email_address,total_items`);
      const members = body.members || [];
      out.push(...members.map(m => m.email_address));
      if (out.length >= (body.total_items || 0) || !members.length) break;
    }
    return out;
  }
  const out = [];
  let cursor = `/contacts?lists=${encodeURIComponent(audienceId)}&limit=500&include=email_address`;
  for (let page = 0; page < 10 && cursor; page++) {
    const body = await emailToolFetch(orgId, provider, row, cursor);
    out.push(...(body.contacts || []).map(c => c.email_address?.address).filter(Boolean));
    const next = body._links?.next?.href;
    cursor = next ? next.replace(/^\/v3/, "") : null;
  }
  return out;
}

// WHAT IS CONNECTED, AND WHAT IT IS SET TO. Read-only, and it never returns a
// token, a webhook secret or a prefix of either.
app.get("/email-marketing", requireAuth, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const O = await oauthMod();
  const A = await import("../shared/audiences.js");
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT * FROM email_marketing_connections WHERE org_id=? AND status <> 'disconnected'`, [orgId]);
  const saved = await query(`SELECT id, name, description, kind FROM audiences WHERE org_id=? ORDER BY name`, [orgId]);
  const byProvider = Object.fromEntries(rows.map(r => [r.provider, r]));
  const providers = EM.PROVIDER_KEYS.map(k => {
    const p = EM.PROVIDERS[k];
    const row = byProvider[k] || null;
    const mapping = row && row.mapping
      ? (typeof row.mapping === "string" ? JSON.parse(row.mapping || "null") : row.mapping) : null;
    const { values, names } = oauthEnv(p.oauthKey, O.ENV_VARS);
    const missing = ["clientId", "clientSecret", "redirectUri"].filter(f => !values[f]).map(f => names[f]);
    return {
      key: k, label: p.label, audienceNoun: p.audienceNoun, tagNoun: p.tagNoun,
      webhooks: p.webhooks, help: p.help, steps: p.steps,
      scopeSentence: O.PROVIDERS[p.oauthKey]?.scopeSentence || null,
      configured: missing.length === 0, missing,
      connected: !!row,
      accountName: row?.account_name || null,
      audienceId: mapping?.audienceId || null,
      audienceName: row?.audience_name || null,
      mapping: mapping?.groups || null,
      mapped: !!(mapping && mapping.audienceId),
      // Booleans only. The secret itself never crosses to the browser.
      webhookConfigured: !!row?.webhook_secret,
      lastSyncedAt: row?.last_synced_at || null,
      lastPushedCount: row?.last_pushed_count ?? null,
      lastError: row?.last_error || null,
      lastErrorAt: row?.last_error_at || null,
      sentence: !missing.length ? null
        : `Steward cannot open ${p.label}'s consent screen yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
    };
  });
  res.json({
    providers,
    // The groups an org may map, built-ins plus its own saved audiences. One
    // list, from the module that already defines them.
    groups: [...A.BUILT_IN_AUDIENCES.map(a => ({ id: a.id, name: a.name, description: a.description })),
             // PARITY-1 Part D — Groups are here too; `kind` lets the card mark
             // a group by rule with its lightning.
             ...saved.map(a => ({ id: a.id, name: a.name, description: a.description || null, kind: a.kind || null }))],
    fieldsPushed: EM.FIELDS_PUSHED, fieldsSentence: EM.FIELDS_PUSHED_SENTENCE,
    restrictiveSentence: EM.RESTRICTIVE_SENTENCE,
    definition: "The email tool your organisation sends from. Steward reads what it reports and writes the people you map. It never sends the email.",
  });
}));

// THE PREVIEW. Nothing has been pushed at this point and nothing is pushed by
// this route: it counts, and it says who is held back and why.
app.post("/email-marketing/:provider/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const provider = String(req.params.provider || "");
  if (!EM.isProvider(provider)) return res.status(404).json({ error: "unknown_provider" });
  const groups = (req.body && req.body.groups) || {};
  const audienceIds = Object.keys(groups).filter(k => String(groups[k] || "").trim());
  if (!audienceIds.length) {
    return res.json({ total: 0, newToTool: 0, excluded: [],
      sentence: "Choose at least one group to send.", definition: EM.PREVIEW_DEFINITION });
  }
  const people = await audienceMembership(req.user.orgId, audienceIds);
  // Who the tool already holds. Without a live connection there is nothing to
  // compare against, so "new" is every eligible person, which is the honest
  // answer for an org that has not connected yet.
  const row = await emailProviderRow(req.user.orgId, provider);
  const known = row ? await knownEmails(req.user.orgId, provider, row).catch(() => []) : [];
  const counts = EM.previewCounts(people, { mapping: groups, knownEmails: known });
  res.json({
    total: counts.total, newToTool: counts.newToTool, alreadyThere: counts.alreadyThere,
    excluded: counts.excluded, excludedTotal: counts.excludedTotal,
    sentence: EM.previewSentence(counts, provider),
    definition: EM.PREVIEW_DEFINITION,
    fieldsSentence: EM.FIELDS_PUSHED_SENTENCE,
  });
}));

// SAVE THE MAPPING. This is the consent: until a mapping exists, no sync runs
// and nothing has ever left Steward for this provider.
app.post("/email-marketing/:provider/mapping", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const provider = String(req.params.provider || "");
  if (!EM.isProvider(provider)) return res.status(404).json({ error: "unknown_provider" });
  const row = await emailProviderRow(req.user.orgId, provider);
  if (!row) return res.status(409).json({ error: "not_connected",
    sentence: `Connect ${EM.providerLabel(provider)} first.` });
  const v = EM.validateMapping({ ...(req.body || {}), provider });
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  await run(
    `UPDATE email_marketing_connections
        SET mapping=?::jsonb, audience_id=?, audience_name=?, updated_at=NOW()
      WHERE id=? AND org_id=?`,
    [JSON.stringify(v.value), v.value.audienceId, v.value.audienceName, row.id, req.user.orgId]);
  await writeAuditLog(req.user.orgId, actor(req).id, actor(req).name,
    "email_marketing_mapping_saved", "connection", provider,
    { audienceId: v.value.audienceId, groups: Object.keys(v.value.groups).length }).catch(() => {});
  res.json({ ok: true,
    sentence: `Saved. Steward will keep that ${EM.audienceNoun(provider)} in step from now on, and send nothing else.` });
}));

// THE TOOL'S OWN AUDIENCES OR LISTS, for the mapping screen to choose from.
app.get("/email-marketing/:provider/audiences", requireAuth, requireAdmin, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const provider = String(req.params.provider || "");
  if (!EM.isProvider(provider)) return res.status(404).json({ error: "unknown_provider" });
  const row = await emailProviderRow(req.user.orgId, provider);
  if (!row) return res.status(409).json({ error: "not_connected",
    sentence: `Connect ${EM.providerLabel(provider)} first.` });
  try {
    const audiences = await providerAudiences(req.user.orgId, provider, row);
    res.json({ audiences, noun: EM.audienceNoun(provider) });
  } catch (e) {
    await noteEmailToolError(req.user.orgId, row.id, e.message, e.status);
    // The STATUS the provider (or the refusal) carried, so the panel can tell
    // "Steward could not ask" apart from "there are none there".
    res.status(e.status && NOT_AN_INCIDENT.includes(e.status) ? e.status : 502)
       .json({ error: "provider_error", sentence: e.message, couldNotAsk: true });
  }
}));

// ── ONE SYNC ───────────────────────────────────────────────────────────────
// Out: the mapped people, as name, email and tags. In: the campaigns, the
// activity, and the unsubscribes. Both directions in one run, because the
// order matters: the opt-outs come IN FIRST so that the push that follows can
// never re-add somebody who unsubscribed since the last run.
app.post("/email-marketing/:provider/sync", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const provider = String(req.params.provider || "");
  if (!EM.isProvider(provider)) return res.status(404).json({ error: "unknown_provider" });
  const orgId = req.user.orgId;
  const row = await emailProviderRow(orgId, provider);
  if (!row) return res.status(409).json({ error: "not_connected",
    sentence: `Connect ${EM.providerLabel(provider)} first.` });
  const mapping = row.mapping
    ? (typeof row.mapping === "string" ? JSON.parse(row.mapping || "null") : row.mapping) : null;
  if (!mapping || !mapping.audienceId) return res.status(409).json({ error: "not_mapped",
    sentence: `Choose which ${EM.audienceNoun(provider)} to keep in step first. Steward has sent nothing.` });

  const out = await runEmailSync(orgId, provider, row, mapping);
  if (!out.ok) return res.status(502).json({ error: "sync_failed", sentence: out.sentence });
  res.json({ ok: true, pushed: out.pushed, campaigns: out.campaigns, optOuts: out.optOuts, sentence: out.sentence });
}));

/**
 * ONE SYNC, used by the button and by the daily tick alike, so the thing that
 * runs unattended every night is the same thing somebody watched succeed.
 *
 * THE ORDER IS THE SAFETY. Opt-outs come in BEFORE the push. If the push ran
 * first, somebody who unsubscribed in Mailchimp an hour ago would be read as
 * still eligible by Steward, pushed back with the subscribed tag set, and only
 * then read as unsubscribed. The window would be small and the mistake would be
 * the exact one this build exists to prevent.
 */
async function runEmailSync(orgId, provider, row, mapping) {
  const EM = await emailMarketingMod();
  await run(`UPDATE email_marketing_connections SET last_tried_at=NOW() WHERE id=?`, [row.id]).catch(() => {});
  try {
    const optOuts = await pullOptOuts(orgId, provider, row, mapping.audienceId);
    const campaigns = await pullCampaigns(orgId, provider, row);
    const pushed = await pushAudience(orgId, provider, row, mapping);
    await run(
      `UPDATE email_marketing_connections
          SET status='active', last_synced_at=NOW(), last_pushed_count=?,
              last_error=NULL, last_error_at=NULL, updated_at=NOW()
        WHERE id=?`, [pushed, row.id]);
    return { ok: true, pushed, campaigns, optOuts,
             sentence: EM.syncSentence({ provider, pushed, campaigns, optOuts }) };
  } catch (e) {
    await noteEmailToolError(orgId, row.id, e.message, e.status);
    return { ok: false, sentence: e.message };
  }
}

/**
 * THE DAILY PULL. Every mapped connection, once a day, riding the existing
 * tick rather than a second scheduler. A connection with no mapping is skipped
 * because it has never been told what to send, and a failure on one org is
 * recorded on that org's card and never stops the rest.
 */
sharedProcessEmailMarketing = async function processEmailMarketing() {
  const rows = await query(
    `SELECT * FROM email_marketing_connections
      WHERE status <> 'disconnected' AND mapping IS NOT NULL`, []);
  let ran = 0, failed = 0;
  for (const row of rows) {
    const mapping = typeof row.mapping === "string" ? JSON.parse(row.mapping || "null") : row.mapping;
    if (!mapping || !mapping.audienceId) continue;
    const out = await runEmailSync(row.org_id, row.provider, row, mapping).catch(e => ({ ok: false, sentence: e.message }));
    if (out.ok) ran++; else failed++;
  }
  return { ran, failed };
};

// A failure is recorded where INT-1's watching layer reads it, so the card goes
// broken and the incident email is the one that already exists.
//
// BUT NOT EVERY REFUSAL IS A BREAKAGE. A connection with no stored credentials
// (every demo row, and every org before it finishes connecting) cannot be
// asked anything, and asking it is not the provider failing: it is Steward
// declining to call out. Recording that as `status='error'` turned the
// demonstration file's healthy Mailchimp card BROKEN the moment somebody opened
// the mapping panel, and left it that way. A missing credential is a state, not
// an incident.
const NOT_AN_INCIDENT = [409, 503];
async function noteEmailToolError(orgId, id, sentence, status) {
  if (status && NOT_AN_INCIDENT.includes(status)) return;
  await run(
    `UPDATE email_marketing_connections SET status='error', last_error=?, last_error_at=NOW(), updated_at=NOW()
      WHERE id=? AND org_id=?`, [String(sentence || "").slice(0, 400), id, orgId]).catch(() => {});
}

/**
 * OUT. Name, email and tags, and nothing else: `FIELDS_PUSHED` is the pinned
 * list and the payload below is built from it, so adding a field is a change to
 * that list and a decision somebody makes on purpose.
 *
 * Nobody excluded by `pushDecision` is in this payload, which is what makes
 * "an unsubscribed person is never pushed again" true by construction rather
 * than by a filter somebody has to remember.
 */
async function pushAudience(orgId, provider, row, mapping) {
  const EM = await emailMarketingMod();
  const people = await audienceMembership(orgId, Object.keys(mapping.groups || {}));
  const counts = EM.previewCounts(people, { mapping: mapping.groups });
  const byId = new Map(people.map(p => [p.id, p]));
  let pushed = 0;
  for (const p of counts.people) {
    const person = byId.get(p.id);
    const [firstName, ...rest] = String(person.name || "").trim().split(/\s+/);
    if (provider === "mailchimp") {
      // Mailchimp keys a member by the MD5 of the lowercased address, and PUT
      // is an upsert. `status_if_new: subscribed` is deliberate: it sets the
      // status only for somebody Mailchimp has never seen, so an existing
      // unsubscribed contact is left exactly as they are. Sending `status`
      // instead would re-subscribe them, which is the one thing this build
      // must never do.
      const hash = crypto.createHash("md5").update(p.email).digest("hex");
      await emailToolFetch(orgId, provider, row,
        `/lists/${encodeURIComponent(mapping.audienceId)}/members/${hash}`,
        { method: "PUT", body: {
          email_address: p.email, status_if_new: "subscribed",
          merge_fields: { FNAME: firstName || "", LNAME: rest.join(" ") },
          tags: p.tags,
        } });
    } else {
      // Constant Contact's upsert takes the list membership and the tags by
      // name, and it too leaves an unsubscribed contact unsubscribed.
      await emailToolFetch(orgId, provider, row, "/contacts/sign_up_form",
        { method: "POST", body: {
          email_address: p.email, first_name: firstName || "", last_name: rest.join(" "),
          list_memberships: [mapping.audienceId],
        } });
    }
    pushed++;
  }
  return pushed;
}

/**
 * IN, FIRST. Whoever the tool says is unsubscribed or cleaned is written
 * through BUILD-94's own `recordUnsubscribe`, with the source and the date on
 * the record. Steward never writes the other direction: a contact the tool
 * says is subscribed does NOT un-suppress anybody here, because the more
 * restrictive answer wins and Steward never re-subscribes.
 */
async function pullOptOuts(orgId, provider, row, audienceId) {
  const EM = await emailMarketingMod();
  let statuses = [];
  if (provider === "mailchimp") {
    for (const status of ["unsubscribed", "cleaned"]) {
      const body = await emailToolFetch(orgId, provider, row,
        `/lists/${encodeURIComponent(audienceId)}/members?status=${status}&count=1000&fields=members.email_address,members.status,members.last_changed`);
      statuses.push(...(body.members || []).map(m => ({ email: m.email_address, status: m.status, at: m.last_changed })));
    }
  } else {
    const body = await emailToolFetch(orgId, provider, row,
      `/contacts?status=unsubscribed&limit=500&include=email_address`);
    statuses.push(...(body.contacts || []).map(c => ({
      email: c.email_address?.address, status: "unsubscribed", at: c.email_address?.opt_out_date || null })));
  }
  let written = 0;
  for (const s of statuses) {
    const email = String(s.email || "").trim().toLowerCase();
    if (!email) continue;
    const decision = EM.optOutFromStatus(s.status);
    if (!decision.optOut) continue;
    // A BOUNCE IS NOT AN UNSUBSCRIBE. The same split the webhook makes, for
    // the same reason: `cleaned` is a mailbox that stopped working and
    // `unsubscribed` is a person who asked to stop, and recording either as
    // the other is a false statement on a donor's record.
    if (decision.kind === "unreachable") {
      const [already] = await query(
        `SELECT email_unreachable FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL LIMIT 1`,
        [orgId, email]);
      if (already && already.email_unreachable === true) continue;
      await run(
        `UPDATE donors SET email_unreachable=true, email_unreachable_at=NOW(), email_unreachable_reason=?
          WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL`,
        [`${EM.providerLabel(provider)} reported this address as ${s.status}`, orgId, email]).catch(() => {});
    } else {
      const already = await query(
        `SELECT 1 FROM email_suppressions WHERE LOWER(email)=? AND (org_id=? OR org_id IS NULL) LIMIT 1`,
        [email, orgId]);
      if (already.length) continue;
      // The ONE unsubscribe write, BUILD-94's. No second flag.
      await recordUnsubscribe(email, orgId, "campaign");
    }
    const [d] = await query(`SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL LIMIT 1`,
      [orgId, email]);
    if (d) {
      await run(
        `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        ["int_" + uuid().slice(0, 8), orgId, d.id, "email",
         `${decision.kind === "unreachable" ? "Email stopped working" : "Unsubscribed"} in ${EM.providerLabel(provider)}.`,
         String(s.at || new Date().toISOString()).slice(0, 10), `system:email-marketing/${provider}`]).catch(() => {});
    }
    written++;
  }
  return written;
}

/**
 * IN. The campaigns the tool sent, their counts, and one activity row per
 * person per campaign. Counts only: no body, no recipient list, nothing that
 * could be mistaken for something Steward could send.
 */
async function pullCampaigns(orgId, provider, row) {
  let campaigns = [];
  if (provider === "mailchimp") {
    const body = await emailToolFetch(orgId, provider, row,
      "/campaigns?status=sent&count=50&sort_field=send_time&sort_dir=DESC" +
      "&fields=campaigns.id,campaigns.settings.title,campaigns.settings.subject_line,campaigns.send_time,campaigns.emails_sent,campaigns.report_summary");
    campaigns = (body.campaigns || []).map(c => ({
      id: c.id, name: c.settings?.title || c.settings?.subject_line || "Untitled campaign",
      subject: c.settings?.subject_line || null, sentAt: c.send_time || null,
      sends: c.emails_sent || 0,
      opens: c.report_summary?.unique_opens || 0,
      clicks: c.report_summary?.subscriber_clicks || 0,
    }));
  } else {
    const body = await emailToolFetch(orgId, provider, row,
      "/emails?limit=50&include=campaign_activities");
    campaigns = (body.campaigns || []).map(c => ({
      id: c.campaign_id, name: c.name || "Untitled campaign", subject: c.name || null,
      sentAt: c.last_sent_date || null, sends: 0, opens: 0, clicks: 0,
    }));
  }
  let n = 0;
  for (const c of campaigns) {
    const id = "emcamp_" + String(c.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
    await run(
      `INSERT INTO email_marketing_campaigns
         (id,org_id,provider,provider_campaign_id,name,subject,sent_at,sends,opens,clicks)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, provider, provider_campaign_id)
       DO UPDATE SET name=EXCLUDED.name, subject=EXCLUDED.subject, sent_at=EXCLUDED.sent_at,
                     sends=EXCLUDED.sends, opens=EXCLUDED.opens, clicks=EXCLUDED.clicks, updated_at=NOW()`,
      [id, orgId, provider, String(c.id), c.name, c.subject, c.sentAt, c.sends, c.opens, c.clicks]);
    n++;
    // The per-person activity, for the most recent campaigns only. Every
    // campaign ever sent would be one call each on every daily run, against
    // somebody else's rate limit, to re-learn something that cannot change.
    if (n <= ACTIVITY_CAMPAIGN_LIMIT) await pullActivity(orgId, provider, row, id, c);
  }
  return n;
}

// How many campaigns deep the per-person activity is read on a run. The older
// ones keep the counts they already have.
const ACTIVITY_CAMPAIGN_LIMIT = 10;

/**
 * ONE ROW PER PERSON PER CAMPAIGN, and one timeline line to match.
 *
 * ONLY PEOPLE STEWARD ALREADY HAS. An address on the org's Mailchimp audience
 * that is not a person in Steward is not created here: that would turn a
 * newsletter list into a donor file behind somebody's back. It is skipped, and
 * the campaign's counts still report the whole send.
 */
async function pullActivity(orgId, provider, row, campaignRowId, campaign) {
  if (provider !== "mailchimp") return;   // Constant Contact's per-person activity lands with its own build
  const EM = await emailMarketingMod();
  let members = [];
  try {
    const body = await emailToolFetch(orgId, provider, row,
      `/reports/${encodeURIComponent(campaign.id)}/email-activity?count=1000&fields=emails.email_address,emails.activity`);
    members = body.emails || [];
  } catch { return; }                     // one campaign's detail is never worth failing the whole sync
  if (!members.length) return;

  const emails = members.map(m => String(m.email_address || "").toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  const donors = await query(
    `SELECT id, LOWER(email) AS email FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND LOWER(email) = ANY(?)`, [orgId, emails]);
  const byEmail = new Map(donors.map(d => [d.email, d.id]));

  for (const m of members) {
    const email = String(m.email_address || "").toLowerCase();
    const donorId = byEmail.get(email);
    if (!donorId) continue;               // not a person on file, and this build does not make one
    const acts = Array.isArray(m.activity) ? m.activity : [];
    const opened = acts.some(a => a.action === "open");
    const clicked = acts.some(a => a.action === "click");
    const unsubscribed = acts.some(a => a.action === "unsub");
    if (!opened && !clicked && !unsubscribed) continue;
    const clickedLabel = (acts.find(a => a.action === "click" && a.url) || {}).url || null;
    const occurred = (acts.find(a => a.timestamp) || {}).timestamp || campaign.sentAt || null;
    await run(
      `INSERT INTO email_marketing_activity
         (id,org_id,campaign_id,donor_id,email,opened,clicked,clicked_label,unsubscribed,occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (campaign_id, donor_id) WHERE donor_id IS NOT NULL
       DO UPDATE SET opened=EXCLUDED.opened, clicked=EXCLUDED.clicked,
                     clicked_label=EXCLUDED.clicked_label, unsubscribed=EXCLUDED.unsubscribed,
                     occurred_at=EXCLUDED.occurred_at`,
      ["emact_" + uuid().slice(0, 10), orgId, campaignRowId, donorId, email,
       opened, clicked, clickedLabel, unsubscribed, occurred]);

    // ONE LINE ON THE TIMELINE, and only one however many times this runs.
    // The note is the whole key: re-reading the same campaign writes the same
    // sentence, so the check below finds it and does not add a second.
    const note = EM.activitySentence({
      campaignName: campaign.name, opened, clicked,
      clickedLabel: clickedLabel ? "the link" : null, unsubscribed });
    const date = String(occurred || "").slice(0, 10) || null;
    const dup = await query(
      `SELECT 1 FROM interactions WHERE org_id=? AND donor_id=? AND type='email' AND note=? LIMIT 1`,
      [orgId, donorId, note]);
    if (!dup.length) {
      await run(
        `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by) VALUES (?,?,?,?,?,?,?)`,
        ["int_" + uuid().slice(0, 8), orgId, donorId, "email", note, date,
         `system:email-marketing/${provider}`]).catch(() => {});
    }
  }
}

// THE CAMPAIGN LIST. Counts only, each opening its people.
app.get("/email-marketing/campaigns", requireAuth, wrap(async (req, res) => {
  const EM = await emailMarketingMod();
  const orgId = req.user.orgId;
  const campaigns = await query(
    `SELECT * FROM email_marketing_campaigns WHERE org_id=? ORDER BY sent_at DESC NULLS LAST LIMIT 100`, [orgId]);
  // ── THE GIFTS BESIDE A CAMPAIGN ARE THAT CAMPAIGN'S PEOPLE'S GIFTS ────────
  // Counting EVERY gift the organisation received within thirty days put "131
  // gifts, $149,715" beside a newsletter, which is the organisation's whole
  // month standing next to an appeal and reading as its result. The footnote
  // saying it is not attribution cannot outrun a number that big.
  //
  // So the window is scoped to the people who actually did something with THIS
  // campaign. That is the honest version of "a gift after a click": these
  // people opened or clicked, and then these gifts arrived. Still beside, still
  // never credited, but now it is a number about the campaign at all.
  const rows = [];
  for (const c of campaigns) {
    const gifts = await query(
      `SELECT g.id, g.date::text AS date, (g.amount * 100)::bigint AS cents
         FROM gifts g
         JOIN email_marketing_activity a
           ON a.donor_id = g.donor_id AND a.campaign_id = ? AND a.org_id = g.org_id
        WHERE g.org_id=? AND g.amount > 0`, [c.id, orgId]);
    rows.push(EM.campaignRow({
      id: c.id, provider: c.provider, name: c.name, sentAt: c.sent_at,
      sends: c.sends, opens: c.opens, clicks: c.clicks,
    }, { gifts: gifts.map(g => ({ id: g.id, date: g.date, cents: Number(g.cents) || 0 })) }));
  }
  res.json({
    campaigns: rows,
    definitions: {
      sends: "How many the email tool reports it delivered for this campaign.",
      opens: "How many people the tool recorded opening it. Counted once per person.",
      clicks: "How many people clicked a link in it. Counted once per person.",
      giftsWithin: "Gifts from the people who opened or clicked THIS campaign, that arrived within 30 days of it going out. Shown beside it, not credited to it: Steward cannot know what made somebody give.",
    },
    giftWindowSentence: EM.GIFT_WINDOW_SENTENCE,
  });
}));

// EVERY NUMBER OPENS. The people behind one campaign's sends, opens or clicks.
app.get("/email-marketing/campaigns/:id/people", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const which = String(req.query.which || "opens");
  const [c] = await query(`SELECT * FROM email_marketing_campaigns WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Not found" });
  const clause = which === "clicks" ? "a.clicked = true"
               : which === "unsubscribes" ? "a.unsubscribed = true"
               : "a.opened = true";
  const rows = await query(
    `SELECT a.donor_id, a.email, a.opened, a.clicked, a.clicked_label, a.unsubscribed, a.occurred_at,
            d.name AS donor_name
       FROM email_marketing_activity a
       LEFT JOIN donors d ON d.id = a.donor_id
      WHERE a.org_id=? AND a.campaign_id=? AND ${clause}
      ORDER BY d.name NULLS LAST`, [orgId, c.id]);
  // ── THE NUMBER THE TOOL COUNTED, AND THE PEOPLE STEWARD CAN NAME ─────────
  // These are two different figures and the screen must not pretend they are
  // one. Mailchimp says 188 people opened the spring appeal; Steward can name
  // the ones whose address belongs to somebody on file, and that is usually
  // fewer. Opening "188" onto three rows with no explanation is a figure that
  // does not foot, which is the one thing a number on a Steward screen may
  // never do.
  //
  // The gap is itself worth knowing: it is how many people are on her mailing
  // list and not in her CRM.
  const counted = which === "clicks" ? Number(c.clicks) || 0
                : which === "unsubscribes" ? Number(c.unsubscribes) || 0
                : Number(c.opens) || 0;
  const named = rows.length;
  const verb = which === "clicks" ? "clicked" : which === "unsubscribes" ? "unsubscribed" : "opened";
  res.json({
    campaign: { id: c.id, name: c.name, sentAt: c.sent_at },
    which,
    people: rows.map(r => ({ donorId: r.donor_id, name: r.donor_name || r.email, email: r.email,
      opened: r.opened === true, clicked: r.clicked === true, clickedLabel: r.clicked_label || null,
      unsubscribed: r.unsubscribed === true, at: r.occurred_at })),
    total: named, counted,
    sentence: counted === named
      ? `${named.toLocaleString()} ${named === 1 ? "person" : "people"} ${verb} it, and Steward can name all of them.`
      : `${counted.toLocaleString()} ${verb} it. Steward can name ${named.toLocaleString()} of them: the rest are addresses on the list that are not people on file here.`,
  });
}));

// The sealer, with its no-plaintext rule intact: a missing key is a refusal,
// never a fallback. The org is the AAD, which is what makes a blob copied
// between tenants fail to open.
async function sealTokens(orgId, tokens) {
  const { sealBag } = await import("../shared/secretBox.js");
  return sealBag({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
                   scope: tokens.scope || null }, { aad: orgId });
}

// The accounting connection, its mapping, and whether it is ready to send.
app.get("/bookkeeping", requireAuth, wrap(async (req, res) => {
  const BK = await bookkeepingMod();
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT id, vendor, status, realm_id, mapping, donor_names, last_sent_at, last_error, last_error_at
       FROM bookkeeping_connections WHERE org_id=? AND status <> 'disconnected'`, [orgId]);
  const funds = await query(`SELECT id, name, restricted FROM fin_funds WHERE org_id=? ORDER BY name`, [orgId]);
  const sourceKeys = (await query(
    `SELECT DISTINCT provider FROM giving_sources WHERE org_id=? AND status <> 'disconnected'`, [orgId]))
    .map(r => r.provider).concat(["stripe"]);
  const sources = [...new Set(sourceKeys)];
  // FIX-9 Part A.6 — A PROVIDER IS ITS LABEL. The mapping screen printed the
  // raw registry keys ("givebutter settles to", "paypal settles to"), which is
  // the database talking to the person filling in their bank accounts.
  const { providerLabel } = await import("../shared/givingSources.js");
  const sourceLabels = Object.fromEntries(sources.map(k => [k, providerLabel(k) || k]));
  const connections = rows.map(r => {
    const mapping = (typeof r.mapping === "string" ? JSON.parse(r.mapping || "{}") : r.mapping) || {};
    const ready = BK.mappingReady({
      funds: funds.map(f => ({ id: f.id, name: f.name, accountId: (mapping.funds || {})[f.id] || null })),
      feeAccountId: mapping.feeAccountId || null,
      depositAccounts: mapping.depositAccounts || {},
    }, { sources });
    const sends = BK.VENDORS[r.vendor]?.sends !== false;
    return { id: r.id, vendor: r.vendor, vendorLabel: BK.VENDORS[r.vendor]?.label || r.vendor, sends,
      secondAxisLabel: BK.VENDORS[r.vendor]?.secondAxisLabel || null,
      status: r.status, realmId: r.realm_id || null, donorNames: r.donor_names === true,
      lastSentAt: r.last_sent_at, lastError: r.last_error, lastErrorAt: r.last_error_at,
      mapping, ...ready,
      // FIX-20 Part 4: a vendor Steward does not send to is never "ready to send".
      ...(sends ? {} : { ready: false, sentence: BK.VENDORS[r.vendor].notSendingSentence }) };
  });
  // PARITY-2 Part 5: where QuickBooks sync is on, its own panel (chosen from
  // the company's real chart of accounts) is the QuickBooks mapping, and this
  // typed-text one stays for Xero.
  const [qboOrg] = await query("SELECT qbo_sync_enabled FROM orgs WHERE id=?", [orgId]);
  res.json({
    qboSyncEnabled: !!(qboOrg && qboOrg.qbo_sync_enabled === true),
    connections, vendors: BK.VENDORS, mappingParts: BK.MAPPING_PARTS,
    funds: funds.map(f => ({ id: f.id, name: f.name, restricted: f.restricted === true })),
    sources, sourceLabels,
    // Said once, here, because it is the sentence an organisation needs before
    // it hands Steward write access to its books.
    definition: "Steward sends one deposit per payout: the gifts inside it split by fund, the processing fee as a negative line, and a net that equals what hit the bank. It never sends the same payout twice, it never sends event or shop takings as donations, and it sends donor names only if you turn that on.",
    donorNamesDefault: "Off. Most organisations do not want their donor list mirrored into a bookkeeping system.",
  });
}));

// The mapping, saved as one document because it is edited as one screen.
// NOTHING IS SENT UNTIL IT IS SAVED, and that is literal: the send route
// re-asks shared/bookkeeping.js and refuses.
app.put("/bookkeeping/:id/mapping", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const BK = await bookkeepingMod();
  const orgId = req.user.orgId;
  const [c] = await query("SELECT id, vendor, mapping FROM bookkeeping_connections WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Not found" });
  const m = req.body?.mapping;
  if (!m || typeof m !== "object") return res.status(400).json({ error: "mapping_required" });
  // Fund ids are checked against THIS org's funds. An id off a request body is
  // never trusted to be one, for the same reason a campaign id never is.
  const funds = await query("SELECT id FROM fin_funds WHERE org_id=?", [orgId]);
  const mine = new Set(funds.map(f => f.id));
  const clean = {
    funds: Object.fromEntries(Object.entries(m.funds || {}).filter(([k]) => mine.has(k))),
    classes: Object.fromEntries(Object.entries(m.classes || {}).filter(([k]) => mine.has(k))),
    revenueAccounts: m.revenueAccounts && typeof m.revenueAccounts === "object" ? m.revenueAccounts : {},
    feeAccountId: m.feeAccountId ? String(m.feeAccountId) : null,
    depositAccounts: m.depositAccounts && typeof m.depositAccounts === "object" ? m.depositAccounts : {},
  };
  // PARITY-2 Part 5: the QuickBooks sync mapping lives beside this one and is
  // saved by its own route; this save carries it over untouched.
  const prior = (typeof c.mapping === "string" ? JSON.parse(c.mapping || "{}") : c.mapping) || {};
  if (prior.qbo) clean.qbo = prior.qbo;
  const donorNames = req.body?.donorNames === true;
  await run(`UPDATE bookkeeping_connections SET mapping=?::jsonb, donor_names=?, updated_at=NOW()
              WHERE id=? AND org_id=?`, [JSON.stringify(clean), donorNames, req.params.id, orgId]);
  res.json({ ok: true, mapping: clean, donorNames,
    sentence: BK.VENDORS[c.vendor]?.sends === false
      ? `Saved. ${BK.VENDORS[c.vendor].notSendingSentence}`
      : "Saved. Nothing has been sent." });
}));

// ── THE SEND ───────────────────────────────────────────────────────────────
// One payout, once, ever. The ledger row is claimed FIRST: an INSERT that
// conflicts means somebody (or yesterday's scheduled run, or a retry after a
// timeout) already has this payout, and the honest answer is to report that
// rather than to send a second deposit.
app.post("/bookkeeping/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const BK = await bookkeepingMod();
  const orgId = req.user.orgId, who = actor(req);
  const [c] = await query("SELECT * FROM bookkeeping_connections WHERE id=? AND org_id=? AND status <> 'disconnected'",
    [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Not found" });
  // FIX-20 Part 4: a vendor Steward cannot really send to is refused here,
  // before anything is claimed, so no row ever says a deposit went.
  if (BK.VENDORS[c.vendor] && BK.VENDORS[c.vendor].sends === false)
    return res.status(409).json({ error: "send_not_available", sentence: BK.VENDORS[c.vendor].notSendingSentence });
  const mapping = { ...((typeof c.mapping === "string" ? JSON.parse(c.mapping || "{}") : c.mapping) || {}),
                    donorNames: c.donor_names === true };

  const payouts = Array.isArray(req.body?.payouts) ? req.body.payouts : [];
  if (!payouts.length) return res.status(400).json({ error: "no_payouts",
    sentence: "Steward had no payouts to send. Payouts arrive from the connections that settle to your bank." });

  const out = { sent: 0, alreadySent: 0, refused: 0, results: [] };
  for (const p of payouts.slice(0, 200)) {
    const payoutId = String(p?.payout?.id || "").trim();
    if (!payoutId) { out.refused++; out.results.push({ payoutId: null, status: "refused", sentence: "A payout with no id cannot be sent once, so it is not sent at all." }); continue; }

    const built = BK.buildDeposit(p.payout, p.gifts || [], p.revenue || [], mapping);
    if (!built.ok) {
      out.refused++;
      out.results.push({ payoutId, status: "refused", sentence: built.sentence, problem: built.problem,
        differenceCents: built.differenceCents ?? null });
      continue;
    }

    // CLAIM IT FIRST. The unique index on (org, vendor, payout) is the
    // guarantee, and a conflict here is the correct, quiet answer to "send
    // everything again".
    const claimed = await query(
      `INSERT INTO bookkeeping_deposits (id,org_id,connection_id,vendor,payout_id,source_key,idempotency_key,
                                         status,net_cents,deposit_on,lines,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,'sending',?,?,?::jsonb,?,?)
       ON CONFLICT (org_id, vendor, payout_id) DO NOTHING
       RETURNING id`,
      ["bkd_" + uuid().slice(0, 10), orgId, c.id, c.vendor, payoutId, built.deposit.sourceKey || null,
       built.deposit.idempotencyKey, built.deposit.netCents, built.deposit.date,
       JSON.stringify(built.deposit.lines), who.id, who.name]);
    if (!claimed.length) {
      const [existing] = await query(
        `SELECT status, vendor_deposit_id, net_cents FROM bookkeeping_deposits
          WHERE org_id=? AND vendor=? AND payout_id=?`, [orgId, c.vendor, payoutId]);
      out.alreadySent++;
      out.results.push({ payoutId, status: "already_sent", vendorDepositId: existing?.vendor_deposit_id || null,
        sentence: "This payout has already been sent to your accounting system. Steward did not send it again." });
      continue;
    }

    // THE VENDOR CALL. Without credentials there is nothing to call, and that
    // is the state every organisation is in until Jonathan's Intuit and Xero
    // apps exist. The ledger row stays, marked, so the next attempt is still
    // the SAME payout rather than a second one.
    // Where to send. The env var still wins, because it is how a sandbox is
    // pointed at; what changed with INT-OAUTH is that an org holding real
    // tokens is connected whether or not anybody set one.
    const base = (c.vendor === "quickbooks" ? process.env.INTUIT_API_BASE : process.env.XERO_API_BASE)
      || (c.credentials_sealed ? (c.vendor === "quickbooks"
            ? "https://quickbooks.api.intuit.com/v3" : "https://api.xero.com/api.xro/2.0") : null);
    if (!base) {
      await run(`UPDATE bookkeeping_deposits SET status='failed', last_error=?, updated_at=NOW()
                  WHERE org_id=? AND vendor=? AND payout_id=?`,
        ["not connected to the accounting system yet", orgId, c.vendor, payoutId]);
      out.refused++;
      out.results.push({ payoutId, status: "not_connected",
        sentence: `Steward built the deposit and did not send it: this organisation is not connected to ${BK.VENDORS[c.vendor].label} yet. The deposit is held against this payout, so connecting later sends it once.` });
      continue;
    }
    try {
      // THE TOKEN, REFRESHED BEFORE IT EXPIRES. `accessTokenFor` renews with
      // five minutes to spare; a 401 from the vendor is the one other trigger,
      // and it is retried ONCE against the same claimed deposit row, so a
      // stale token costs a renewal and never a second deposit.
      const post = tok => fetch(`${base}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
                   "Idempotency-Key": built.deposit.idempotencyKey,
                   ...(tok ? { Authorization: "Bearer " + tok } : {}),
                   ...(c.realm_id ? { "X-Realm-Id": c.realm_id } : {}) },
        body: JSON.stringify(built.deposit),
      });
      // A connection WITHOUT sealed credentials is one pointed at an explicit
      // base by env: the sandbox and the local mock, which is how INT-2's
      // one-deposit guarantee is exercised and how every org sat before this
      // build. It sends unauthenticated, exactly as it did. A connection that
      // holds tokens takes the token path, and only that path refreshes.
      let tok = c.credentials_sealed ? await accessTokenFor(orgId, c, oauthKeyFor(c.vendor)) : null;
      if (tok && !tok.ok) throw new Error(tok.body.sentence);
      let r = await post(tok ? tok.accessToken : null);
      if (r.status === 401 && tok) {
        tok = await accessTokenFor(orgId, c, oauthKeyFor(c.vendor), { force: true });
        if (!tok.ok) throw new Error(tok.body.sentence);
        r = await post(tok.accessToken);
      }
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error(`[bookkeeping] ${c.vendor} answered ${r.status} for payout ${payoutId}`);
        throw new Error(body?.error || "the accounting system did not accept it");
      }
      await run(`UPDATE bookkeeping_deposits SET status='sent', vendor_deposit_id=?, sent_at=NOW(), last_error=NULL, updated_at=NOW()
                  WHERE org_id=? AND vendor=? AND payout_id=?`,
        [body?.id || null, orgId, c.vendor, payoutId]);
      out.sent++;
      out.results.push({ payoutId, status: "sent", vendorDepositId: body?.id || null, sentence: built.sentence });
    } catch (e) {
      // NOT deleted. A timeout means Steward does not know whether the call
      // landed; deleting the row here is what turns one deposit into two.
      await run(`UPDATE bookkeeping_deposits SET status='failed', last_error=?, updated_at=NOW()
                  WHERE org_id=? AND vendor=? AND payout_id=?`,
        [String(e.message || e).slice(0, 300), orgId, c.vendor, payoutId]);
      out.refused++;
      out.results.push({ payoutId, status: "failed", sentence: `Steward could not finish sending this one: ${e.message}. It is held against this payout, so a retry sends it once, not twice.` });
    }
  }
  await run(`UPDATE bookkeeping_connections SET last_sent_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`,
    [c.id, orgId]);
  res.json({ ...out,
    definition: "One deposit per payout, ever. A payout Steward has already sent is reported as already sent and is not sent again." });
}));

// ── DO THE TWO AGREE? ──────────────────────────────────────────────────────
// A month of Steward's deposits beside the accounting system's, matched on the
// payout. Anything on either side with no partner is LISTED rather than netted
// off, because the row that is missing is the whole value of the view.
app.get("/bookkeeping/:id/agreement", requireAuth, wrap(async (req, res) => {
  const BK = await bookkeepingMod();
  const orgId = req.user.orgId;
  const [c] = await query("SELECT * FROM bookkeeping_connections WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Not found" });
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month)
    : String(orgToday(await orgTz(orgId))).slice(0, 7);                // ORG_TZ_SEAM_OK
  const mine = await query(
    `SELECT payout_id, net_cents, deposit_on, status, vendor_deposit_id FROM bookkeeping_deposits
      WHERE org_id=? AND vendor=? AND deposit_on LIKE ? ORDER BY deposit_on`, [orgId, c.vendor, `${month}%`]);
  // The vendor's side. Without credentials Steward has nothing to compare
  // against and says so rather than showing a one-sided view that reads like
  // agreement.
  let theirs = null;
  const base = c.vendor === "quickbooks" ? process.env.INTUIT_API_BASE : process.env.XERO_API_BASE;
  if (base) {
    try {
      const r = await fetch(`${base}/deposits?month=${encodeURIComponent(month)}`,
        { headers: c.realm_id ? { "X-Realm-Id": c.realm_id } : {} });
      const body = await r.json().catch(() => ({}));
      theirs = Array.isArray(body?.deposits) ? body.deposits : [];
    } catch { theirs = null; }
  }
  const stewardSide = mine.filter(m => m.status === "sent")
    .map(m => ({ payoutId: m.payout_id, netCents: Number(m.net_cents), on: m.deposit_on }));
  const result = theirs
    ? BK.agree(stewardSide, theirs, { month })
    : { month, matched: [], onlyInSteward: stewardSide, onlyInVendor: [], differing: [],
        stewardCents: stewardSide.reduce((t, s) => t + s.netCents, 0), vendorCents: null,
        agreed: null,
        sentence: `Steward sent ${stewardSide.length} deposit${stewardSide.length === 1 ? "" : "s"} this month. It cannot read ${BK.VENDORS[c.vendor].label} back yet, so it is not claiming the two agree.` };
  res.json({ ...result, vendor: c.vendor, vendorLabel: BK.VENDORS[c.vendor].label,
    held: mine.filter(m => m.status !== "sent").map(m => ({ payoutId: m.payout_id, status: m.status, netCents: Number(m.net_cents) })),
    definition: "Every deposit Steward sent this month beside the ones in your accounting system, matched on the payout. Anything on either side with no partner is listed, never quietly netted off." });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  PARITY-2 Part 5 · QUICKBOOKS ONLINE SYNC
// ═══════════════════════════════════════════════════════════════════════════
//
// The connection is INT-OAUTH's (Intuit, accounting scope only); these routes
// are what it is for: the mapping, chosen from the company's own chart of
// accounts; the Pending list; and Sync, Sync all, Skip and Retry. The engine
// is qboSync.js. NOTHING IS SENT UNTIL A PERSON PRESSES SYNC, unless the
// organisation's admin turned on auto-sync, which runs the same engine on the
// hourly tick as `system:qbo/auto-sync`.
//
// Every route answers only for the caller's org and takes no row id in its
// path: there is one live QuickBooks connection per org, and gift ids in a
// body are filtered by org inside the engine's own query.
const qboSyncMod = () => require("../qboSync");
async function qboConnection(orgId) {
  const [c] = await query(
    `SELECT * FROM bookkeeping_connections WHERE org_id=? AND vendor='quickbooks' AND status <> 'disconnected'`, [orgId]);
  return c || null;
}
async function qboEnabled(orgId) {
  const [o] = await query("SELECT qbo_sync_enabled, qbo_auto_sync, is_demo_org FROM orgs WHERE id=?", [orgId]);
  return o || null;
}
const qboOff = res => res.status(403).json({ error: "qbo_not_enabled",
  sentence: "QuickBooks sync is not turned on for this organisation yet. The bookkeeper file on this page works without it." });
const qboTokenFor = orgId => (conn, force) => accessTokenFor(orgId, conn, "intuit", { force });

// The connection, the mapping and the switches.
app.get("/qbo", requireAuth, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return res.json({ enabled: false,
    sentence: "QuickBooks sync is not turned on for this organisation. The bookkeeper file does the same job by hand." });
  const c = await qboConnection(orgId);
  const map = QS.readMapping(c);
  const funds = await query(`SELECT id, name, restricted FROM fin_funds WHERE org_id=? ORDER BY name`, [orgId]);
  const campaigns = await query(
    `SELECT id, name, type FROM campaigns WHERE org_id=? ORDER BY created_at DESC LIMIT 300`, [orgId]);
  const demo = org.is_demo_org === true || map.demo;
  // FIX-20 Part 2 · A DIFFERENT COMPANY. Said once, before the first sync to
  // it: what was sent to the other company is not in this one's books, so
  // this company's sent list starts empty.
  let companySentence = null;
  if (c && c.realm_id) {
    const [n] = await query(
      `SELECT COUNT(*) FILTER (WHERE realm_id = ?)::int AS here, COUNT(*) FILTER (WHERE realm_id <> ?)::int AS elsewhere
         FROM gift_bookkeeping_syncs WHERE org_id=? AND vendor='quickbooks' AND status='synced'`,
      [String(c.realm_id), String(c.realm_id), orgId]);
    if (n && n.here === 0 && n.elsewhere > 0)
      companySentence = `This is a different QuickBooks company from the one Steward sent ${n.elsewhere} ${n.elsewhere === 1 ? "gift" : "gifts"} to before, so nothing has been sent here yet and every gift in Pending goes to this company once, including ones already in the other company.`;
  }
  // FIX-34 Q: what is still to map, and what has been sent (the one count the
  // Connections card reads too).
  const gaps = c ? await QS.mappingGaps(orgId, map) : { ok: false, funds: [], sentence: null };
  const sent = c ? await QS.sentSummary(orgId, "1970-01-01") : null;
  res.json({
    enabled: true, autoSync: org.qbo_auto_sync === true, demo, companySentence,
    mappingReady: gaps.ok, mappingGaps: gaps.ok ? null : { funds: gaps.funds, depositAccount: gaps.depositAccount, sentence: gaps.sentence },
    sent,
    mappingOtherCompany: map.otherCompany === true,
    batchSize: QS.RUN_LIMIT,
    environment: QS.environment(),
    connection: c ? { id: c.id, realmId: c.realm_id, signedIn: !!c.credentials_sealed,
      connectedAt: c.created_at, lastSentAt: c.last_sent_at, lastError: c.last_error } : null,
    mapping: { mode: map.mode, startDate: QS.startDateOf(c, map), depositAccount: map.depositAccount,
      feeAccount: map.feeAccount, funds: map.funds, campaigns: map.campaigns },
    funds: [...funds.map(f => ({ id: f.id, name: f.name, restricted: f.restricted === true })),
            { id: QS.NO_FUND, name: "No fund named", restricted: false }],
    campaigns: campaigns.map(x => ({ id: x.id, name: x.name, type: x.type || null })),
    definition: map.mode === "deposit"
      ? "Each payout becomes one deposit in QuickBooks, a line per gift on the account its campaign or fund is mapped to, with the processing fee as one negative line. Nothing is sent until somebody presses Sync, and a payout is never sent twice."
      : "Each gift becomes one sales receipt in QuickBooks, on the account its campaign or fund is mapped to, with the donor as the customer. Nothing is sent until somebody presses Sync, and a gift is never sent twice.",
    demoSentence: demo ? "This is the demonstration file's example connection. It shows what would be sent, and sends nothing." : null,
  });
}));

// The Pending list: every gift waiting, with where it will land, and its total
// as a figure whose rows are exactly these.
app.get("/qbo/pending", requireAuth, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const c = await qboConnection(orgId);
  const map = QS.readMapping(c);
  const since = QS.startDateOf(c, map);
  const q = QS.pendingRowsSql(orgId, since);
  const rows = await query(q.sql, q.args);
  const totalCents = rows.reduce((t, r) => t + Number(r.cents), 0);
  const shown = rows.slice(0, 50).map(r => {
    const landing = QS.landingFor(r, map);
    const where = !landing.ok ? null
      : map.mode === "deposit"
        ? (r.deposit_ref ? `${landing.sentence}, in the deposit for payout ${r.deposit_ref}` : `${landing.sentence}, once it is matched to its payout`)
        : landing.sentence;
    return { giftId: r.id, donorId: r.donor_id, donorName: r.donor_name, date: String(r.date).slice(0, 10),
      amount: Number(r.amount), cents: Number(r.cents), fund: r.fund_name || null, campaign: r.campaign_name || null,
      lands: where, problem: r.sync_status === "failed" ? (r.sync_error || "The last try did not finish.") : (landing.ok ? null : landing.sentence),
      tried: r.sync_status === "failed", source: { key: "one-gift", params: { id: r.id } } };
  });
  const recent = await query(
    `SELECT s.gift_id, s.status, s.qbo_id, s.txn_type, COALESCE(s.synced_at, s.updated_at) AS at, s.created_by_name,
            g.date, ROUND(g.amount::numeric, 2) AS amount, d.name AS donor_name
       FROM gift_bookkeeping_syncs s JOIN gifts g ON g.id = s.gift_id AND g.org_id = s.org_id
       LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE s.org_id=? AND s.vendor='quickbooks' AND s.realm_id=? AND s.status IN ('synced','skipped')
      ORDER BY COALESCE(s.synced_at, s.updated_at) DESC LIMIT 25`, [orgId, c && c.realm_id ? String(c.realm_id) : ""]);
  res.json({
    since, mode: map.mode, count: rows.length, shown: shown.length,
    total: { value: totalCents / 100, cents: totalCents, kind: "money", label: "Waiting to go to QuickBooks",
      definition: `Every gift dated on or after ${since} that has not been sent to QuickBooks or skipped. Real money only: never a sample, a refund, stock or in-kind.`,
      source: { key: "qbo-pending", params: { since } } },
    rows: shown,
    recent: recent.map(r => ({ giftId: r.gift_id, status: r.status, donorName: r.donor_name, date: String(r.date).slice(0, 10),
      amount: Number(r.amount), qboId: r.qbo_id, link: r.status === "synced" ? QS.txnLink(r.txn_type, r.qbo_id) : null,
      at: r.at, by: r.created_by_name || null, source: { key: "one-gift", params: { id: r.gift_id } } })),
  });
}));

// The mapping, saved as one document. Fund and campaign ids are checked
// against THIS org's own rows; an id off a request body is never trusted.
app.put("/qbo/mapping", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const c = await qboConnection(orgId);
  if (!c) return res.status(409).json({ error: "not_connected", sentence: "Connect QuickBooks first, then choose where each gift lands." });
  const b = req.body || {};
  const funds = new Set((await query("SELECT id FROM fin_funds WHERE org_id=?", [orgId])).map(f => f.id).concat([QS.NO_FUND]));
  const camps = new Set((await query("SELECT id FROM campaigns WHERE org_id=?", [orgId])).map(x => x.id));
  const str = (v, n = 200) => (v === null || v === undefined || v === "") ? null : String(v).slice(0, n);
  const pick = (obj, allowed) => {
    const out = {};
    for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
      if (!allowed.has(k) || !v || typeof v !== "object") continue;
      const accountId = str(v.accountId), classId = str(v.classId);
      if (!accountId && !classId) continue;
      out[k] = { accountId, accountName: str(v.accountName), classId, className: str(v.className) };
    }
    return out;
  };
  const acct = v => (v && typeof v === "object" && str(v.id)) ? { id: str(v.id), name: str(v.name) } : null;
  if (b.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate)))
    return res.status(400).json({ error: "bad_date", sentence: "The start date must be written 2026-10-01." });
  const prior = QS.readMapping(c);
  const qbo = {
    mode: b.mode === "deposit" ? "deposit" : "salesreceipt",
    startDate: b.startDate ? String(b.startDate) : prior.startDate,
    depositAccount: acct(b.depositAccount), feeAccount: acct(b.feeAccount),
    funds: pick(b.funds, funds), campaigns: pick(b.campaigns, camps),
    items: prior.items, ...(prior.demo ? { demo: true } : {}),
    // FIX-20: the company these account ids belong to.
    realmId: c.realm_id ? String(c.realm_id) : null,
  };
  await run(`UPDATE bookkeeping_connections SET mapping = jsonb_set(COALESCE(mapping, '{}'::jsonb), '{qbo}', ?::jsonb),
                    updated_at=NOW() WHERE id=? AND org_id=?`, [JSON.stringify(qbo), c.id, orgId]);
  res.json({ ok: true, mapping: { ...qbo, items: undefined },
    sentence: "Saved. Nothing has been sent: gifts wait in Pending until somebody presses Sync." });
}));

// The company's own chart of accounts and classes, for the mapping's lists. A
// POST because asking may renew the token, and a GET never changes state.
app.post("/qbo/lists", requireAuth, requireAdmin, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const c = await qboConnection(orgId);
  if (!c) return res.status(409).json({ error: "not_connected", fallback: true, sentence: "Connect QuickBooks first, and its accounts appear here to choose from." });
  const map = QS.readMapping(c);
  // The demo has no company to ask: its lists are the names already mapped.
  if (org.is_demo_org === true || map.demo) {
    const accts = new Map(), classes = new Map();
    for (const m of [...Object.values(map.funds), ...Object.values(map.campaigns)]) {
      if (m.accountId) accts.set(m.accountId, { id: m.accountId, name: m.accountName || m.accountId, type: "Income" });
      if (m.classId) classes.set(m.classId, { id: m.classId, name: m.className || m.classId });
    }
    const dep = map.depositAccount ? [{ ...map.depositAccount, type: "Bank" }] : [];
    const fee = map.feeAccount ? [{ ...map.feeAccount, type: "Expense" }] : [];
    const income = [...accts.values()];
    return res.json({ ok: true, demo: true, accounts: [...income, ...dep, ...fee], income, deposit: dep, expense: fee,
      classes: [...classes.values()], sentence: "The demonstration file's example accounts. A real company's chart of accounts appears here once it is connected." });
  }
  if (!c.credentials_sealed && process.env.TEST_MODE !== "1")
    return res.status(409).json({ error: "not_signed_in", fallback: true, sentence: "QuickBooks is not signed in yet, so Steward cannot read its accounts. Type them for now, or connect it first." });
  const out = await QS.fetchLists({ orgId, realmId: String(c.realm_id), token: c.credentials_sealed ? qboTokenFor(orgId).bind(null, c) : null });
  if (!out.ok) return res.status(502).json({ error: "lists_failed", fallback: true, sentence: out.sentence });
  res.json({ ok: true, ...out, sentence: `${out.accounts.length} accounts and ${out.classes.length} classes from your QuickBooks company.` });
}));

// INT-PROD-1 · WHAT STEWARD CAN SEE. The company's name and its latest
// customers and payments, read from QuickBooks to prove the connection is the
// right company. Reads only: nothing is sent to QuickBooks and nothing is
// stored. A POST because asking may renew the token, and a GET never changes state.
app.post("/qbo/preview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const c = await qboConnection(orgId);
  if (!c) return res.status(409).json({ error: "not_connected", sentence: "Connect QuickBooks first, and its company appears here." });
  if (org.is_demo_org === true || QS.readMapping(c).demo)
    return res.json({ ok: true, demo: true, sentence: "The demonstration file has no QuickBooks company to read." });
  if (!c.credentials_sealed && process.env.TEST_MODE !== "1")
    return res.status(409).json({ error: "not_signed_in", sentence: "QuickBooks is not signed in yet, so Steward cannot read it. Connect it again." });
  const out = await QS.fetchPreview({ orgId, realmId: String(c.realm_id), token: c.credentials_sealed ? qboTokenFor(orgId).bind(null, c) : null });
  if (!out.ok) return res.status(502).json({ error: "preview_failed", sentence: out.sentence });
  const n = (k, one, many) => k == null ? null : `${k} ${k === 1 ? one : many}`;
  res.json({ ...out, environment: QS.environment(),
    sentence: [`Steward can read ${out.company.name || "this QuickBooks company"}`,
      [n(out.customerCount, "customer", "customers"), n(out.paymentCount, "payment", "payments")].filter(Boolean).join(" and ")]
      .filter(Boolean).join(": ") + ". It only read them; nothing was sent to QuickBooks." });
}));

// SYNC, SYNC ALL AND RETRY are this one route: Retry is Sync on a gift whose
// last try failed, and the engine sends the same request again where the
// outcome was unknown.
app.post("/qbo/sync", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const all = req.body?.all === true;
  const giftIds = Array.isArray(req.body?.giftIds) ? req.body.giftIds.map(String).filter(Boolean) : null;
  // FIX-20 Part 3: Sync all runs in batches. The screen sends back the
  // run's start (the server's own clock, from the first batch's answer) and
  // asks again while `remaining` is above nought.
  const runStartedAt = all && typeof req.body?.runStartedAt === "string" ? req.body.runStartedAt : null;
  const out = await QS.syncGifts({ orgId, giftIds, all, runStartedAt, who: actor(req), tokenFor: qboTokenFor(orgId) });
  if (!out.ok) return res.status(out.status || 409).json({ error: out.error, sentence: out.sentence });
  res.json(out);
}));

// SKIP: a gift the bookkeeper entered by hand, or one that should never go.
// `restore: true` puts skipped gifts back in Pending. A synced gift is never
// touched by either.
app.post("/qbo/skip", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const QS = qboSyncMod();
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const ids = Array.isArray(req.body?.giftIds) ? [...new Set(req.body.giftIds.map(String))].slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: "nothing_chosen", sentence: "Choose the gifts to skip." });
  const mine = (await query("SELECT id, ROUND(amount::numeric * 100)::bigint AS cents FROM gifts WHERE org_id=? AND id = ANY(?)", [orgId, ids]));
  const c = await qboConnection(orgId);
  const who = actor(req);
  let n = 0;
  if (req.body?.restore === true) {
    const r = await run(`DELETE FROM gift_bookkeeping_syncs WHERE org_id=? AND vendor=? AND realm_id=? AND status='skipped' AND gift_id = ANY(?)`,
      [orgId, QS.VENDOR, c && c.realm_id ? String(c.realm_id) : "", mine.map(g => g.id)]);
    n = (r && r.changes) || 0;
    return res.json({ ok: true, restored: n, sentence: `${n} ${n === 1 ? "gift is" : "gifts are"} back in Pending.` });
  }
  for (const g of mine) {
    const r = await run(
      `INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,amount_cents,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,'skipped',?,?,?)
       ON CONFLICT (org_id, gift_id, vendor, realm_id) DO UPDATE SET status='skipped', error=NULL, error_code=NULL, updated_at=NOW()
        WHERE gift_bookkeeping_syncs.status = 'failed'`,
      ["gbs_" + uuid().slice(0, 12), orgId, g.id, QS.VENDOR, c ? c.id : null, c && c.realm_id ? String(c.realm_id) : "", Number(g.cents), who.id, who.name]);
    n += (r && r.changes) || 0;
  }
  res.json({ ok: true, skipped: n, sentence: `${n} ${n === 1 ? "gift" : "gifts"} skipped. ${n === 1 ? "It" : "They"} will not go to QuickBooks unless you put ${n === 1 ? "it" : "them"} back.` });
}));

// AUTO-SYNC, the org admin's own switch. Off by default; on means the hourly
// tick sends what is waiting, exactly as Sync all would.
app.put("/qbo/auto-sync", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const org = await qboEnabled(orgId);
  if (!org || org.qbo_sync_enabled !== true) return qboOff(res);
  const on = req.body?.on === true;
  // FIX-34 Q: auto-sync cannot be turned on while anything is unmapped.
  if (on) {
    const QS = qboSyncMod();
    const c = await qboConnection(orgId);
    if (!c) return res.status(409).json({ error: "not_connected", sentence: "Connect QuickBooks first." });
    const gaps = await QS.mappingGaps(orgId, QS.readMapping(c));
    if (!gaps.ok) return res.status(409).json({ error: "needs_mapping", sentence: gaps.sentence });
  }
  await run("UPDATE orgs SET qbo_auto_sync=? WHERE id=?", [on, orgId]);
  res.json({ ok: true, autoSync: on, sentence: on
    ? "Auto-sync is on. Once an hour Steward sends whatever is waiting, as Steward's own entry in the log."
    : "Auto-sync is off. Nothing goes to QuickBooks until somebody presses Sync." });
}));

// THE HOURLY TICK, published to routes/jobs.js. The same engine as the
// button, for every org whose admin turned auto-sync on, as a system actor.
sharedProcessQboAutoSync = async function processQboAutoSync() {
  const QS = qboSyncMod();
  const orgs = await query(
    `SELECT o.id FROM orgs o
       JOIN bookkeeping_connections c ON c.org_id = o.id AND c.vendor='quickbooks' AND c.status <> 'disconnected'
      WHERE o.qbo_sync_enabled = true AND o.qbo_auto_sync = true AND COALESCE(o.is_demo_org, false) = false`, []);
  const touched = [];
  let sent = 0, waiting = 0;
  for (const { id } of orgs) {
    const r = await QS.syncGifts({ orgId: id, all: true, limit: 50, tokenFor: qboTokenFor(id),
      who: { id: "system:qbo/auto-sync", name: "Steward (QuickBooks auto-sync)" } })
      .catch(e => { console.error("[qbo-auto-sync]", id, e.message); return null; });
    if (r && r.ok && (r.synced || r.failed)) { touched.push(id); sent += r.synced; waiting += r.failed; }
  }
  return { detail: `${orgs.length} org(s) with auto-sync on; ${sent} sent, ${waiting} left in Pending`, orgs: touched,
           summary: `QuickBooks auto-sync sent ${sent} and left ${waiting} in Pending.` };
};

// Disconnecting stops the sending and DELETES NOTHING, in Steward or in the
// accounting system. What was sent was sent.
// PARITY-2 Part 5: DISCONNECTING QUICKBOOKS ALSO TELLS INTUIT. The refresh
// token is revoked at Intuit's revoke endpoint before Steward forgets it, so a
// copy of it anywhere is worthless. Best effort: a revoke Intuit does not
// answer still disconnects, because keeping a token somebody asked to drop is
// the worse failure. Nothing is logged but the outcome.
async function revokeIntuit(orgId) {
  try {
    const [c] = await query(`SELECT credentials_sealed FROM bookkeeping_connections
                              WHERE org_id=? AND vendor='quickbooks' AND status <> 'disconnected'`, [orgId]);
    if (!c || !c.credentials_sealed) return;
    const { openBag } = await import("../shared/secretBox.js");
    const bag = openBag(c.credentials_sealed, { aad: orgId });
    const O = await oauthMod();
    const { values } = oauthEnv("intuit", O.ENV_VARS);
    const token = bag.refreshToken || bag.accessToken;
    if (!token || !values.clientId || !values.clientSecret) return;
    const r = await fetch(process.env.INTUIT_REVOKE_URL || "https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json",
                 Authorization: "Basic " + Buffer.from(`${values.clientId}:${values.clientSecret}`).toString("base64") },
      body: JSON.stringify({ token }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) console.error(`[oauth] intuit revoke answered ${r.status}`);
  } catch (e) { console.error("[oauth] intuit revoke failed:", e.message); }
}

app.post("/bookkeeping/:id/disconnect", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [bkc] = await query("SELECT vendor FROM bookkeeping_connections WHERE id=? AND org_id=? AND status <> 'disconnected'",
    [req.params.id, req.user.orgId]);
  if (bkc && bkc.vendor === "quickbooks") await revokeIntuit(req.user.orgId);
  const r = await run(`UPDATE bookkeeping_connections SET status='disconnected', credentials_sealed=NULL, updated_at=NOW()
                        WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (r && r.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true,
    sentence: "Disconnected. Steward will not send anything else. Every deposit it already sent is still in your accounting system, and every record of what it sent is still here." });
}));

// BUILD-87 gave Steward one bookkeeper's export: one row per gift, a fixed
// column list, and an assertion in cents before a single byte is written.
// That file is correct and a bookkeeper still has to re-map its columns by
// hand every month, because QuickBooks and Xero each want their own header
// row and neither wants Steward's.
//
// So this is a RESHAPE, not a second export. It reads the SAME rows through
// the SAME route and only renames and reorders the columns, which is why
// the totals cannot diverge: there is nothing here that adds anything up.
// A flavour Steward does not know is refused by name rather than falling
// back to one that looks similar.
//
// The mappings are each vendor's documented import header for a sales
// receipt / bank transaction. Marked as documented-not-walked, the same
// honesty the import presets carry: neither has been run through a real
// QuickBooks import, and the day one is, this comment changes.
const BOOKKEEPER_FLAVOURS = require("../bookkeeper").BOOKKEEPER_FLAVOURS;

app.get("/finance/bookkeeper-flavours", requireAuth, wrap(async (req, res) => {
  res.json({
    flavours: Object.entries(BOOKKEEPER_FLAVOURS).map(([key, f]) => ({
      key, label: f.label, confidence: f.confidence, note: f.note,
      columns: f.columns ? f.columns.map(c => c[0]) : null,
    })),
    sentence: "The same rows, in the column order your bookkeeping tool wants. Nothing is added up differently: "
      + "only the headings change, and Steward checks the rows foot to the cent before it writes any of them.",
    caveat: "The QuickBooks and Xero column sets are each vendor's documented import headers. Neither has been run "
      + "through a real import by us, so check the first file before you trust the tenth.",
  });
}));

// ── FIN-1 · THE MONTH-CLOSE CHECKLIST ────────────────────────────────────
// Five things, each one either done or not, each one saying what to do. Not
// a score and not a progress bar: a bookkeeper closing a month wants to know
// which of five things is still open, and a percentage tells her nothing.
app.get("/finance/month-close", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const ymRaw = String(req.query.month || "");
  const ym = /^\d{4}-\d{2}$/.test(ymRaw) ? ymRaw
    : new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const from = `${ym}-01`, to = `${ym}-${String(last).padStart(2, "0")}`;

  const one = async (key, label, sql, params, done, todoFn) => {
    const [r] = await query(sql, params).catch(() => [{ n: 0 }]);
    const n = Number(r ? r.n : 0);
    return { key, label, count: n, done: done(n), sentence: todoFn(n) };
  };

  const items = [
    await one("noFund", "Every gift has a fund",
      `SELECT COUNT(*)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL AND COALESCE(g.fund_id,'')='' AND g.date >= ? AND g.date <= ?`,
      [orgId, from, to],
      n => n === 0,
      n => n ? `${n} ${n === 1 ? "gift has" : "gifts have"} no fund. They are in your totals and in no fund's balance.`
             : "Every gift this month names a fund."),
    await one("banked", "Every cheque is on a deposit",
      `SELECT COUNT(*)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
          AND lower(COALESCE(g.payment_method,'')) IN ('check','cheque','cash')
          AND NOT EXISTS (SELECT 1 FROM imports im WHERE im.id=g.import_id AND im.org_id=g.org_id
                            AND im.shape='deposit' AND im.reversed_at IS NULL)`,
      [orgId, from, to],
      n => n === 0,
      n => n ? `${n} ${n === 1 ? "cheque or cash gift is" : "cheque and cash gifts are"} not on a deposit slip.`
             : "Every cheque and cash gift this month is on a deposit."),
    // A RECEIPT IS A ROW IN `receipts`, not a column on the gift. Writing
    // this against `gifts.receipt_number` would have compiled and counted
    // every gift as un-receipted for ever.
    await one("receipted", "Every gift is receipted",
      `SELECT COUNT(*)::int n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
        WHERE g.org_id=? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?
          AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.gift_id = g.id AND r.org_id = g.org_id)`,
      [orgId, from, to],
      n => n === 0,
      n => n ? `${n} ${n === 1 ? "gift has" : "gifts have"} no receipt on the record.`
             : "Every gift this month carries a receipt."),
    await one("ledger", "The ledger has the month in it",
      `SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=? AND date >= ? AND date <= ?`,
      [orgId, from, to],
      n => n > 0,
      n => n ? `${n} ${n === 1 ? "transaction is" : "transactions are"} posted for this month.`
             : "Nothing is posted to the ledger for this month. Connect Stripe, or log the month's transactions."),
  ];

  // The fifth is the export itself, and it is the one that can REFUSE: the
  // bookkeeper file will not be written unless the rows, the fund totals and
  // the database agree to the cent (BUILD-87). Reported, not re-derived.
  const [gifts] = await query(
    `SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      WHERE g.org_id=? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ?`, [orgId, from, to]);
  items.push({ key: "export", label: "The bookkeeper's file", count: gifts.n,
    done: gifts.n > 0,
    sentence: gifts.n
      ? `${gifts.n} ${gifts.n === 1 ? "gift" : "gifts"}, ${money.formatCentsPlain(Number(gifts.cents))}. Steward checks the rows foot to the cent before it writes the file.`
      : "No gifts were received this month, so there is nothing to send." });

  const open = items.filter(i => !i.done).length;
  res.json({
    month: ym, from, to,
    monthLabel: new Date(from + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    items, openCount: open,
    sentence: open
      ? `${open} of ${items.length} ${open === 1 ? "thing is" : "things are"} still open for this month.`
      : `All ${items.length} are done. This month is ready to close.`,
  });
}));

// ── Financials ─────────────────────────────────────────────────────────────
app.get("/financials", requireAuth, wrap(async (req, res) => {
  const months = await query(
    `SELECT * FROM financials WHERE org_id = ?
     ORDER BY year,
       CASE month WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                  WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                  WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                  WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 ELSE 12 END`,
    [req.user.orgId]
  );
  const funds = await query("SELECT * FROM funds WHERE org_id = ?", [req.user.orgId]);

  const ytdRevenue  = months.reduce((s, m) => s + m.individual + m.grants + m.events + m.other_revenue, 0);
  const ytdExpenses = months.reduce((s, m) => s + m.programs + m.admin + m.fundraising, 0);
  const programsTotal = months.reduce((s, m) => s + m.programs, 0);

  res.json({
    months,
    funds,
    summary: {
      ytdRevenue,
      ytdExpenses,
      netIncome: ytdRevenue - ytdExpenses,
      programRatio: ytdExpenses > 0 ? Math.round(programsTotal / ytdExpenses * 100) : 0,
    },
  });
}));

app.post("/financials/month", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { month, year, individual, grants, events, otherRevenue, programs, admin, fundraising } = req.body;
  if (!month || !year) return res.status(400).json({ error: "Month and year required" });

  const id = "fin_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO financials (id,org_id,month,year,individual,grants,events,other_revenue,programs,admin,fundraising)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, month, year) DO UPDATE SET
       individual=EXCLUDED.individual, grants=EXCLUDED.grants, events=EXCLUDED.events,
       other_revenue=EXCLUDED.other_revenue, programs=EXCLUDED.programs,
       admin=EXCLUDED.admin, fundraising=EXCLUDED.fundraising`,
    [id, req.user.orgId, month, year,
     individual || 0, grants || 0, events || 0, otherRevenue || 0,
     programs || 0, admin || 0, fundraising || 0]
  );
  res.status(201).json({ success: true });
}));

// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

// ── Finance: Accounts ─────────────────────────────────────────────────────
app.get("/finance/accounts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM accounts WHERE org_id = ? ORDER BY code ASC",
    [req.user.orgId]
  );
  res.json(rows);
}));

app.post("/finance/accounts", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { code, name, type, subtype } = req.body;
  if (!code || !name || !type) return res.status(400).json({ error: "code, name, and type required" });
  const id = "acc_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES (?,?,?,?,?,?)",
    [id, req.user.orgId, code, name, type, subtype || ""]
  );
  const rows = await query("SELECT * FROM accounts WHERE id = ?", [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "account", id, {
    description: `Created account ${code} ${name} (${type})`,
    new: { code, name, type, subtype: subtype || "" }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.put("/finance/accounts/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, subtype, active } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [oldAcct] = await query("SELECT * FROM accounts WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  const affected = await run(
    "UPDATE accounts SET name=?,subtype=?,active=? WHERE id=? AND org_id=?",
    [name, subtype || "", active !== false, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Account not found" });
  const rows = await query("SELECT * FROM accounts WHERE id = ?", [req.params.id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "account", req.params.id, {
    description: `Updated account ${oldAcct?.code || ""} ${oldAcct?.name || name}`,
    old: oldAcct ? { name: oldAcct.name, subtype: oldAcct.subtype, active: oldAcct.active } : {},
    new: { name, subtype: subtype || "", active: active !== false }
  }).catch(() => {});
  res.json(rows[0]);
}));

// ── Finance: Funds ─────────────────────────────────────────────────────────
app.get("/finance/funds", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM fin_funds WHERE org_id = ? ORDER BY restricted ASC, name ASC",
    [req.user.orgId]
  );
  // BUILD-88a A.1 (found by the walk) — WHICH FUND IS THE DEFAULT IS THE
  // SERVER'S TO SAY. The conversation form was picking "the first unrestricted
  // fund" out of this list, which is sorted by NAME — so it offered "Gala
  // Reserve" while the write used `ensureOrgLedger`'s oldest unrestricted fund,
  // "General Operating". The screen was stating something it could not back,
  // which is the whole class this build exists to close. The flag comes from
  // the same function the write uses, so the two cannot part company.
  let defaultFundId = null;
  try { defaultFundId = await orgUnrestrictedFundId(req.user.orgId); }
  catch (e) { console.error("[funds] default fund probe:", e.message); }
  res.json(rows.map(r => ({ ...r, isOrgDefault: !!defaultFundId && r.id === defaultFundId })));
}));

app.post("/finance/funds", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, description, restricted } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const id = "ff_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_funds (id,org_id,name,description,restricted) VALUES (?,?,?,?,?)",
    [id, req.user.orgId, name, description || "", restricted ? true : false]
  );
  const rows = await query("SELECT * FROM fin_funds WHERE id = ?", [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "fund", id, {
    description: `Created fund "${name}"${restricted ? " (restricted)" : ""}`,
    new: { name, description: description || "", restricted: !!restricted }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.put("/finance/funds/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, description, restricted } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [oldFund] = await query("SELECT * FROM fin_funds WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  // BUILD-88b B.1 — THE ALIASES A MEMO LINE USES. "Xenia", "Xenia UMC", "for
  // Xenia trip" are all the Xenia Mission Trip fund, and only this org knows
  // that. Typed once here rather than guessed once per deposit.
  let aliases = oldFund ? oldFund.aliases : null;
  if (req.body.aliases !== undefined) {
    const raw = Array.isArray(req.body.aliases) ? req.body.aliases
      : String(req.body.aliases || "").split(/[,\n]/);
    aliases = [...new Set(raw.map(a => String(a).trim()).filter(a => a.length >= 2).map(a => a.slice(0, 80)))].slice(0, 25);
  }
  const affected = await run(
    "UPDATE fin_funds SET name=?,description=?,restricted=?,aliases=?::jsonb WHERE id=? AND org_id=?",
    [name, description || "", restricted ? true : false,
     aliases && aliases.length ? JSON.stringify(aliases) : null, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Fund not found" });
  const rows = await query("SELECT * FROM fin_funds WHERE id = ?", [req.params.id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "fund", req.params.id, {
    description: `Updated fund "${name}"`,
    old: oldFund ? { name: oldFund.name, description: oldFund.description, restricted: oldFund.restricted } : {},
    new: { name, description: description || "", restricted: !!restricted }
  }).catch(() => {});
  res.json(rows[0]);
}));

// ── Finance: Transactions ──────────────────────────────────────────────────
app.get("/finance/transactions", requireAuth, wrap(async (req, res) => {
  const { year, fund, account, donor_id } = req.query;
  let sql = `
    SELECT ft.*, a.code as account_code, a.name as account_name, a.type as account_type,
           f.name as fund_name, f.restricted as fund_restricted
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.org_id = ?
  `;
  const params = [req.user.orgId];
  if (year) { sql += " AND ft.date >= ? AND ft.date <= ?"; params.push(`${year}-01-01`, `${year}-12-31`); }
  if (fund) { sql += " AND ft.fund_id = ?"; params.push(fund); }
  if (account) { sql += " AND ft.account_id = ?"; params.push(account); }
  if (donor_id) { sql += " AND ft.donor_id = ?"; params.push(donor_id); }
  sql += " ORDER BY ft.date DESC, ft.created_at DESC";
  const rows = await query(sql, params);
  res.json(rows);
}));

app.post("/finance/transactions", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { date, description, vendorDonor, amount, type, accountId, fundId, notes, donorId } = req.body;
  if (!date || !description || !amount || !type) {
    return res.status(400).json({ error: "date, description, amount, and type required" });
  }
  // §1 tenant isolation: a foreign account/fund/donor id must not be accepted
  // (would echo another org's label back in the response JOIN and pin a
  // cross-org reference into this org's ledger).
  if (!(await orgOwns("accounts", accountId, req.user.orgId))) return res.status(404).json({ error: "Account not found" });
  if (!(await orgOwns("fin_funds", fundId, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
  if (!(await orgOwns("donors", donorId, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const id = "ft_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,notes,donor_id,source,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual',?,?)",
    [id, req.user.orgId, date, description, vendorDonor || "", parseFloat(amount), type, accountId || null, fundId || null, notes || "", donorId || null, actor(req).id, actor(req).name]
  );
  const rows = await query(`
    SELECT ft.*, a.code as account_code, a.name as account_name, a.type as account_type,
           f.name as fund_name, f.restricted as fund_restricted
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.id = ?`, [id]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "created", "transaction", id, {
    description: `Added ${type === "income" ? "+" : "-"}$${parseFloat(amount).toFixed(2)} — ${description} (${rows[0]?.account_name || "No account"}, ${rows[0]?.fund_name || "No fund"})`,
    new: { amount: parseFloat(amount), type, description, account: rows[0]?.account_name, fund: rows[0]?.fund_name, date, vendorDonor }
  }).catch(() => {});
  res.status(201).json(rows[0]);
}));

app.delete("/finance/transactions/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [txnToDelete] = await query(`
    SELECT ft.*, a.name as account_name, f.name as fund_name
    FROM fin_transactions ft
    LEFT JOIN accounts a ON a.id = ft.account_id
    LEFT JOIN fin_funds f ON f.id = ft.fund_id
    WHERE ft.id = ? AND ft.org_id = ?`, [req.params.id, req.user.orgId]);
  if (!txnToDelete) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  await run("DELETE FROM fin_transactions WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "deleted", "transaction", req.params.id, {
    description: txnToDelete ? `Deleted ${txnToDelete.type === "income" ? "+" : "-"}$${parseFloat(txnToDelete.amount).toFixed(2)} — ${txnToDelete.description}` : "Deleted transaction",
    old: txnToDelete ? { amount: parseFloat(txnToDelete.amount), type: txnToDelete.type, description: txnToDelete.description, account: txnToDelete.account_name, fund: txnToDelete.fund_name, date: txnToDelete.date } : {}
  }).catch(() => {});
  res.json({ success: true });
}));

// ── Finance: Budgets ───────────────────────────────────────────────────────
// ── BUILD-88a A.3 — THE BUDGET WINDOW, IN ONE PLACE ───────────────────────
// A budget year is the ORG's year. `basis` says which kind — the same
// fiscal/calendar switch the rest of Finance already carries — and the bounds
// come from the one seam rather than from `${year}-01-01` string arithmetic,
// which was a calendar year wearing a fiscal year's label on a screen that has
// a fiscal toggle at the top of it.
function budgetYearBounds(year, basis, org) {
  if (basis === "fiscal") {
    // The org's fiscal year LABELLED `year`: BUILD-12's July 1 boundary, so FY
    // 2027 runs 2026-07-01 to 2027-06-30 — the year it ENDS in, which is what
    // a board calls it.
    const fy = orgTime.orgPeriodBounds(org || {}, "fiscal_year", 0);
    const curLabel = Number(String(fy.end).slice(0, 4));
    const shift = year - curLabel;
    const b = orgTime.orgPeriodBounds(org || {}, "fiscal_year", shift);
    return { start: b.start, end: b.end };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

app.get("/finance/budgets", requireAuth, wrap(async (req, res) => {
  const _bTz = await orgTz(req.user.orgId);                       // ORG_TZ_SEAM_OK
  const basis = req.query.basis === "fiscal" ? "fiscal" : "calendar";
  const year = parseInt(req.query.year) || Number(orgToday(_bTz).slice(0, 4));
  const bounds = budgetYearBounds(year, basis, _bTz);
  const accounts = await query(
    "SELECT * FROM accounts WHERE org_id = ? AND active = TRUE AND type IN ('revenue','expense') ORDER BY code ASC",
    [req.user.orgId]
  );
  const budgets = await query(
    `SELECT b.*, f.name AS fund_name FROM budgets b
       LEFT JOIN fin_funds f ON f.id = b.fund_id AND f.org_id = b.org_id
      WHERE b.org_id = ? AND b.year = ?
      ORDER BY b.account_id, f.name NULLS FIRST`,
    [req.user.orgId, year]
  );
  // A.3 — actuals are grouped BY FUND too, so a per-fund budget is compared
  // against the money that actually landed in that fund rather than against
  // the account's whole column.
  const actuals = await query(
    `SELECT account_id, fund_id, SUM(amount) as total
     FROM fin_transactions
     WHERE org_id = ? AND date >= ? AND date <= ?
     GROUP BY account_id, fund_id`,
    [req.user.orgId, bounds.start, bounds.end]
  );
  const actualByAccount = {}, actualByAccountFund = {};
  for (const a of actuals) {
    actualByAccount[a.account_id] = (actualByAccount[a.account_id] || 0) + parseFloat(a.total);
    actualByAccountFund[`${a.account_id}|${a.fund_id || ""}`] = parseFloat(a.total);
  }
  // One row per BUDGET, plus one row per account that has none — so an account
  // with two fund budgets shows two lines rather than one that hides a choice.
  const byAccount = {};
  for (const b of budgets) (byAccount[b.account_id] = byAccount[b.account_id] || []).push(b);
  const out = [];
  for (const a of accounts) {
    const rows = byAccount[a.id] || [];
    if (!rows.length) {
      out.push({ id: null, accountId: a.id, accountCode: a.code, accountName: a.name, accountType: a.type,
                 subtype: a.subtype, fundId: null, fundName: null, year, basis,
                 periodStart: bounds.start, periodEnd: bounds.end,
                 budget: 0, actual: actualByAccount[a.id] || 0, variance: -(actualByAccount[a.id] || 0) });
      continue;
    }
    for (const b of rows) {
      const amt = parseFloat(b.amount) || 0;
      const act = b.fund_id ? (actualByAccountFund[`${a.id}|${b.fund_id}`] || 0) : (actualByAccount[a.id] || 0);
      out.push({ id: b.id, accountId: a.id, accountCode: a.code, accountName: a.name, accountType: a.type,
                 subtype: a.subtype, fundId: b.fund_id || null, fundName: b.fund_name || null, year, basis,
                 periodStart: bounds.start, periodEnd: bounds.end,
                 budget: amt, actual: act, variance: amt - act });
    }
  }
  res.json(out);
}));

app.post("/finance/budgets", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { accountId, year, amount } = req.body;
  if (!accountId || !year) return res.status(400).json({ error: "accountId and year required" });
  // §1 tenant isolation: reject a foreign account id (would leak another org's
  // account code/name into this org's audit log).
  if (!(await orgOwns("accounts", accountId, req.user.orgId))) return res.status(404).json({ error: "Account not found" });
  // BUILD-88a A.3 — AND A FUND. Same tenant guard, same reason.
  const fundId = req.body.fundId || null;
  if (fundId && !(await orgOwns("fin_funds", fundId, req.user.orgId))) return res.status(404).json({ error: "Fund not found" });
  let cents;
  try { cents = parseMoneyOrThrow(amount == null || amount === "" ? 0 : amount, "amount"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  if (cents < 0) return res.status(400).json({ error: "A budget cannot be negative." });
  const amt = toDollars(cents);
  const id = "bgt_" + uuid().slice(0, 8);
  const [row] = await query(
    `INSERT INTO budgets (id,org_id,account_id,year,amount,fund_id)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (org_id, account_id, year, COALESCE(fund_id, '')) DO UPDATE SET amount=EXCLUDED.amount
     RETURNING id`,
    [id, req.user.orgId, accountId, parseInt(year), amt, fundId]
  );
  const [acctRow] = await query("SELECT code, name FROM accounts WHERE id = ?", [accountId]);
  const [fundRow] = fundId ? await query("SELECT name FROM fin_funds WHERE id = ?", [fundId]) : [];
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "updated", "budget", `${accountId}_${year}_${fundId || ""}`, {
    description: `Set ${year} budget for ${acctRow?.code || ""} ${acctRow?.name || accountId}${fundRow ? ` (${fundRow.name})` : ""} to $${amt.toLocaleString()}`,
    new: { account: acctRow?.name || accountId, fund: fundRow?.name || null, year: parseInt(year), amount: amt }
  }).catch(() => {});
  res.json({ success: true, id: row?.id || id, accountId, fundId, year: parseInt(year), amount: amt });
}));

// A.3 — a budget can be REMOVED, which is what makes "editable" true for the
// fund and the year: the upsert is keyed on both, so moving a budget to another
// fund or another year is a write and then a delete of the row it left behind.
app.delete("/finance/budgets/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [b] = await query("SELECT * FROM budgets WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!b) return res.status(404).json({ error: "Budget not found" });
  await run("DELETE FROM budgets WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  writeAuditLog(req.user.orgId, req.user.userId, req.user.email, "deleted", "budget", req.params.id, {
    description: `Removed the ${b.year} budget line`, old: { year: b.year, amount: parseFloat(b.amount) || 0, fundId: b.fund_id || null },
  }).catch(() => {});
  res.json({ deleted: 1 });
}));

// ── Finance: period bounds ─────────────────────────────────────────────────
// Single source of the app's fiscal-year rule (July 1 boundary — identical to
// /dashboard/my-stats and Reports; `now.getMonth() < 6`). offset 0 = current
// period, -1 = the immediately-preceding period of the same basis. Returns
// ISO date bounds + labels the client renders verbatim, so the FY definition
// lives in exactly one place.
const FIN_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Finance: Summary ───────────────────────────────────────────────────────
// Everything the Finance Overview needs, computed server-side so the client
// never juggles cross-calendar-year transaction loads for the fiscal basis and
// every number shares one period definition:
//   cashOnHand   — ALL-TIME ledger net (Σ income − Σ expense). Reconciles with
//                  the ledger by construction; labeled "All-time" on the card.
//   ytd*/net     — CURRENT period (basis-aware).
//   prior*       — the immediately-preceding period, same basis (headline delta).
//   monthly      — current-period months in basis order (Jul-first under fiscal).
//   fundBalances — ALL-TIME per-fund net (a fund balance is cumulative, not per-year).
//   activeFundCount — funds with ≥1 transaction in the CURRENT period.
app.get("/finance/summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const { yearMode = "calendar" } = req.query;
  const _fpTz = await orgTz(orgId);   // ORG_TZ_SEAM_OK
  const cur = finPeriodBounds(yearMode, 0, _fpTz);
  const prior = finPeriodBounds(yearMode, -1, _fpTz);

  const [ytdRows, priorRows, allRows, monthRows, fundRows, activeFundRows, giftHistRows, ledgerGiftRows] = await Promise.all([
    query(`SELECT type, SUM(amount) as total FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type`, [orgId, cur.start, cur.end]),
    query(`SELECT type, SUM(amount) as total FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type`, [orgId, prior.start, prior.end]),
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type", [orgId]),
    query(`SELECT date, type, amount FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ?`, [orgId, cur.start, cur.end]),
    query(`SELECT f.id, f.name, f.restricted,
                  COALESCE(SUM(CASE WHEN ft.type='income' THEN ft.amount
                                    WHEN ft.type='expense' THEN -ft.amount ELSE 0 END), 0) AS balance
           FROM fin_funds f
           LEFT JOIN fin_transactions ft ON ft.fund_id = f.id AND ft.org_id = f.org_id
           WHERE f.org_id = ?
           GROUP BY f.id, f.name, f.restricted
           ORDER BY f.restricted ASC, f.name ASC`, [orgId]),
    query(`SELECT COUNT(DISTINCT fund_id) AS cnt FROM fin_transactions
           WHERE org_id = ? AND date >= ? AND date <= ? AND fund_id IS NOT NULL`, [orgId, cur.start, cur.end]),
    // B1 — the org's whole giving history (all gifts) vs what actually reached the
    // ledger as gift income. Imported HISTORICAL giving deliberately never stamps
    // fin_transactions (it's records being loaded, not money moving through
    // Steward — see "Imported gifts vs the ledger" in CLAUDE.md). The gap is real
    // and must be EXPLAINED, never left to read as "$0 raised" next to a Reports
    // page showing years of giving.
    // BUILD-33: same deleted_at IS NULL predicate as Reports — this figure's
    // whole job is "your giving history lives in Reports", so it must equal
    // what Reports actually shows (trashed donors' gifts excluded).
    query("SELECT COALESCE(SUM(g.amount),0) AS total, COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE g.org_id = ? AND d.deleted_at IS NULL", [orgId]),
    query("SELECT COALESCE(SUM(amount),0) AS total FROM fin_transactions WHERE org_id = ? AND type='income' AND source IN ('gift','import','online','event')", [orgId]),
  ]);

  const ytd   = Object.fromEntries(ytdRows.map(r => [r.type, parseFloat(r.total)]));
  const prev  = Object.fromEntries(priorRows.map(r => [r.type, parseFloat(r.total)]));
  const all   = Object.fromEntries(allRows.map(r => [r.type, parseFloat(r.total)]));

  const ytdRevenue    = ytd.income  || 0;
  const ytdExpenses   = ytd.expense || 0;
  const priorRevenue  = prev.income  || 0;
  const priorExpenses = prev.expense || 0;
  const cashOnHand    = (all.income || 0) - (all.expense || 0);

  // Bucket current-period txns into the basis-ordered month list.
  const monthly = cur.months.map(({ y, m }) => ({
    key: `${y}-${String(m + 1).padStart(2, "0")}`, label: FIN_MONTHS[m], income: 0, expense: 0,
  }));
  const monIdx = Object.fromEntries(monthly.map((mm, i) => [mm.key, i]));
  for (const r of monthRows) {
    const i = monIdx[(r.date || "").slice(0, 7)];
    if (i === undefined) continue;
    if (r.type === "income") monthly[i].income += parseFloat(r.amount);
    else if (r.type === "expense") monthly[i].expense += parseFloat(r.amount);
  }

  // Giving history vs ledger. `unledgeredGiving` = giving that lives in Reports
  // but NOT in the ledger (imported historical gifts). `hasUnledgeredGiving` tells
  // the Finance UI to render the "your giving history lives in Reports" explainer
  // + cross-link instead of implying $0 was ever raised. $1 epsilon so cent-level
  // rounding never trips it.
  const giftHistoryTotal = parseFloat(giftHistRows[0]?.total || 0);
  const giftHistoryCount = parseInt(giftHistRows[0]?.n || 0);
  const ledgerGiftTotal  = parseFloat(ledgerGiftRows[0]?.total || 0);
  const unledgeredGiving = Math.max(0, giftHistoryTotal - ledgerGiftTotal);

  res.json({
    cashOnHand,
    ytdRevenue, ytdExpenses, netSurplus: ytdRevenue - ytdExpenses,
    priorRevenue, priorExpenses, priorNet: priorRevenue - priorExpenses,
    yearMode,
    periodLabel: cur.periodLabel,
    monthlyLabel: cur.chartLabel,
    monthly,
    activeFundCount: parseInt(activeFundRows[0]?.cnt || 0),
    fundBalances: fundRows.map(f => ({
      id: f.id, name: f.name, restricted: f.restricted, balance: parseFloat(f.balance) || 0,
    })),
    giftHistoryTotal, giftHistoryCount, ledgerGiftTotal,
    unledgeredGiving, hasUnledgeredGiving: unledgeredGiving > 1,
  });
}));

// ── Finance: Stripe summary (connected-account money in) ────────────────────
// Live balance + recent payouts for the org's OWN connected Stripe account —
// never Steward's platform billing (that's /billing/*). Org-scoped strictly by
// the caller's orgs.stripe_account_id, never from client input. Cached 5 min
// per org so a Home-adjacent load can't hammer Stripe. Degrades to
// {connected:false} on no account / no Stripe key / any Stripe error — the
// Finance Overview shows a warm connect prompt in that case, never an error.
const STRIPE_SUMMARY_TTL = 5 * 60 * 1000;
const stripeSummaryCache = new Map(); // orgId -> { at, data }
app.get("/finance/stripe-summary", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const cached = stripeSummaryCache.get(orgId);
  if (cached && Date.now() - cached.at < STRIPE_SUMMARY_TTL) return res.json(cached.data);

  const [org] = await query("SELECT stripe_account_id FROM orgs WHERE id=?", [orgId]);
  const acct = org?.stripe_account_id;
  if (!acct || !stripe) {
    const data = { connected: false };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    return res.json(data);
  }
  try {
    // stripeAccount must ride the OPTIONS argument (second position), never
    // params — stripe-node v22 sends a params-object key as a request field
    // and Stripe rejects it ("Received unknown parameter: stripeAccount"),
    // which silently broke the Money-in strip in prod (found 2026-08-12).
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve({}, { stripeAccount: acct }),
      stripe.payouts.list({ limit: 5 }, { stripeAccount: acct }),
    ]);
    const sumCents = arr => (arr || []).reduce((s, b) => s + (b.amount || 0), 0);
    // FIX-1 E — a $0 balance beside a large cash-on-hand figure reads as a
    // discrepancy. It is not one, and the payload says why, in the one
    // sentence shared/payoutReconcile.js holds for the screen as well.
    const PR = await payoutReconcile();
    const data = {
      connected: true,
      balance: {
        available: sumCents(balance.available) / 100,
        pending: sumCents(balance.pending) / 100,
      },
      balanceSentence: PR.stripeBalanceSentence({ availableCents: sumCents(balance.available), pendingCents: sumCents(balance.pending) }),
      payouts: (payouts.data || []).map(p => ({
        id: p.id,
        amount: (p.amount || 0) / 100,
        status: p.status,
        arrival_date: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
      })),
    };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    console.error("[finance] stripe-summary failed:", e.message);
    // Don't 500 the Finance tab over a Stripe hiccup — treat as not-connected.
    const data = { connected: false, error: "stripe_unavailable" };
    stripeSummaryCache.set(orgId, { at: Date.now(), data });
    res.json(data);
  }
}));

// ── FIX-1 E: which gifts made up this payout ───────────────────────────────
// GET /finance/payout-lines?payout=po_…  — every charge, refund and fee Stripe
// says made up one payout, each charge and refund linked to the Steward gift
// (and donor) its payment intent belongs to, reconciled in INTEGER CENTS by
// shared/payoutReconcile.js. A payout that does not add up says by how much.
//
// A READ path: never write-gated (a lapsed org can always see where its money
// went). Org-scoped by the caller's OWN orgs.stripe_account_id, never an
// account from the request: another org's payout id asked of this org's
// account is simply not there, and Stripe's 404 is ours too. The id rides the
// query string (not the path) so the route has no row-id param to cross.
// Cached per org+payout for 5 minutes, like stripe-summary: a paid payout's
// lines do not change.
const PAYOUT_LINES_TTL = 5 * 60 * 1000;
// A payout for the orgs this product serves has dozens of lines. The cap is a
// guard against a runaway loop, and a payout that hits it SAYS so rather than
// claiming a truncated list adds up.
const MAX_PAYOUT_LINES = 2000;
const payoutLinesCache = new Map(); // orgId:payoutId -> { at, data }
app.get("/finance/payout-lines", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const payoutId = String(req.query.payout || "");
  if (!/^po_[A-Za-z0-9_]{3,64}$/.test(payoutId)) return res.status(404).json({ error: "Payout not found" });

  const key = orgId + ":" + payoutId;
  const cached = payoutLinesCache.get(key);
  if (cached && Date.now() - cached.at < PAYOUT_LINES_TTL) return res.json(cached.data);

  const [org] = await query("SELECT stripe_account_id FROM orgs WHERE id=?", [orgId]);
  const acct = org?.stripe_account_id;
  if (!acct || !stripe) return res.status(404).json({ error: "Payout not found" });
  const unavailable = () => res.status(503).json({ error: "stripe_unavailable",
    sentence: "Stripe did not answer, so Steward cannot open this payout right now." });

  let payout;
  try {
    // stripeAccount rides the OPTIONS argument, never params (stripe-node v22).
    payout = await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: acct });
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === "resource_missing")) return res.status(404).json({ error: "Payout not found" });
    console.error("[finance] payout retrieve failed:", e && e.message);
    return unavailable();
  }

  const txns = [];
  let truncated = false;
  try {
    let starting_after;
    for (;;) {
      const page = await stripe.balanceTransactions.list(
        { payout: payoutId, limit: 100, expand: ["data.source"], ...(starting_after ? { starting_after } : {}) },
        { stripeAccount: acct });
      const data = page.data || [];
      txns.push(...data);
      if (!page.has_more || !data.length) break;
      if (txns.length >= MAX_PAYOUT_LINES) { truncated = true; break; }
      starting_after = data[data.length - 1].id;
    }
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === "resource_missing")) return res.status(404).json({ error: "Payout not found" });
    console.error("[finance] payout balance transactions failed:", e && e.message);
    return unavailable();
  }

  const PR = await payoutReconcile();
  const pis = [...new Set(txns.map(PR.paymentIntentOf).filter(Boolean))];
  const giftsByPi = {};
  if (pis.length) {
    // Org-scoped by the gift's own org_id: a payment intent id that happens to
    // sit on another org's gift links to nothing here.
    const rows = await query(
      `SELECT g.id, g.stripe_payment_id, g.donor_id, g.amount, d.name AS donor_name
         FROM gifts g LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND g.stripe_payment_id = ANY(?::text[])`, [orgId, pis]);
    for (const r of rows) giftsByPi[r.stripe_payment_id] = {
      giftId: r.id, donorId: r.donor_id, donorName: r.donor_name,
      amountCents: money.toCents(r.amount) ?? 0,
    };
  }

  const rec = PR.reconcilePayout(payout, txns, giftsByPi);
  const data = {
    ...rec,
    status: payout.status,
    arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
    truncated,
    ...(truncated ? { reconciled: false, sentence: `This payout has more than ${MAX_PAYOUT_LINES} lines, so Steward shows the first ${txns.length} and will not claim the rest add up.` } : {}),
  };
  payoutLinesCache.set(key, { at: Date.now(), data });
  res.json(data);
}));

// ── Finance: Audit Log ─────────────────────────────────────────────────────
app.get("/finance/audit-log", requireAuth, wrap(async (req, res) => {
  const { action, entityType, limit = 200 } = req.query;
  let sql = "SELECT * FROM fin_audit_log WHERE org_id = ?";
  const params = [req.user.orgId];
  if (action) { sql += " AND action = ?"; params.push(action); }
  if (entityType) { sql += " AND entity_type = ?"; params.push(entityType); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(parseInt(limit));
  // FIX-12 Part 4: names are looked up as the log is read, never stored.
  const rows = await require("../middleware/auditTrail").resolveAuditNames(await query(sql, params), req.user.orgId);
  res.json(rows.map(r => ({
    ...r,
    changes: typeof r.changes === "string" ? JSON.parse(r.changes || "{}") : (r.changes || {}),
  })));
}));
}

module.exports = {
  routers, mount,
  // The daily pull, published to routes/jobs.js. It rides the existing tick;
  // INT-3 adds no second scheduler.
  composeTodayMeetings: (...args) => {
    if (!sharedComposeTodayMeetings) throw new Error("composeTodayMeetings called before routes/finance mount()");
    return sharedComposeTodayMeetings(...args);
  },
  processEmailMarketing: (...args) => {
    if (!sharedProcessEmailMarketing) throw new Error("processEmailMarketing called before routes/finance mount()");
    return sharedProcessEmailMarketing(...args);
  },
  processQboAutoSync: (...args) => {
    if (!sharedProcessQboAutoSync) throw new Error("processQboAutoSync called before routes/finance mount()");
    return sharedProcessQboAutoSync(...args);
  },
};

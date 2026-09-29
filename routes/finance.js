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

const routers = {
  r0: express.Router(),
};

function mount(ctx) {
const {
  actor, checkWriteAccess, finPeriodBounds, grantBalanceFrom, grantMoneyRows, money, orgOwns,
  orgTime, orgToday, orgTz, orgUnrestrictedFundId, parseMoneyOrThrow, query, requireAdmin,
  requireAuth, restrictedMod, run, stripe, toDollars, uuid, wrap, writeAuditLog,
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
  const rows = await grantMoneyRows(orgId, "AND g.status IN ('awarded','closed')");
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
      WHERE g.org_id=? AND g.status = 'awarded'
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
        WHERE g.org_id=? AND g.status = 'awarded' AND g.report_due IS NOT NULL AND g.report_due <> ''
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
    return { id: r.id, vendor: r.vendor, vendorLabel: BK.VENDORS[r.vendor]?.label || r.vendor,
      secondAxisLabel: BK.VENDORS[r.vendor]?.secondAxisLabel || null,
      status: r.status, realmId: r.realm_id || null, donorNames: r.donor_names === true,
      lastSentAt: r.last_sent_at, lastError: r.last_error, lastErrorAt: r.last_error_at,
      mapping, ...ready };
  });
  res.json({
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
  const [c] = await query("SELECT id FROM bookkeeping_connections WHERE id=? AND org_id=?", [req.params.id, orgId]);
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
  const donorNames = req.body?.donorNames === true;
  await run(`UPDATE bookkeeping_connections SET mapping=?::jsonb, donor_names=?, updated_at=NOW()
              WHERE id=? AND org_id=?`, [JSON.stringify(clean), donorNames, req.params.id, orgId]);
  res.json({ ok: true, mapping: clean, donorNames,
    sentence: "Saved. Nothing has been sent; press Send, or leave it and Steward sends once a day." });
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
    const base = c.vendor === "quickbooks" ? process.env.INTUIT_API_BASE : process.env.XERO_API_BASE;
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
      const r = await fetch(`${base}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
                   "Idempotency-Key": built.deposit.idempotencyKey,
                   ...(c.realm_id ? { "X-Realm-Id": c.realm_id } : {}) },
        body: JSON.stringify(built.deposit),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `the accounting system answered ${r.status}`);
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

// Disconnecting stops the sending and DELETES NOTHING, in Steward or in the
// accounting system. What was sent was sent.
app.post("/bookkeeping/:id/disconnect", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
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
const BOOKKEEPER_FLAVOURS = {
  steward: { label: "Steward", confidence: "walked",
    note: "Steward's own columns, one row per gift." },
  quickbooks: { label: "QuickBooks", confidence: "documented-not-walked",
    note: "QuickBooks Online's Sales Receipt import columns. Each gift is one sales receipt.",
    columns: [
      ["SalesReceiptNo", r => r.receiptNumber || r.giftId],
      ["Customer", r => r.donorName],
      ["SalesReceiptDate", r => r.date],
      ["Item(Product/Service)", r => r.fund || "Donations"],
      ["ItemAmount", r => r.amount],
      ["ItemDescription", r => [r.paymentMethod, r.reference].filter(Boolean).join(" ")],
      ["PaymentMethod", r => r.paymentMethod],
      ["Memo", r => r.giftId],
    ] },
  xero: { label: "Xero", confidence: "documented-not-walked",
    note: "Xero's Sales Invoice import columns. Each gift is one paid invoice line.",
    columns: [
      ["*ContactName", r => r.donorName],
      ["*InvoiceNumber", r => r.receiptNumber || r.giftId],
      ["*InvoiceDate", r => r.date],
      ["*DueDate", r => r.date],
      ["*Quantity", () => 1],
      ["*UnitAmount", r => r.amount],
      ["Description", r => [r.fund, r.paymentMethod, r.reference].filter(Boolean).join(" · ")],
      ["TrackingName1", r => (r.fund ? "Fund" : "")],
      ["TrackingOption1", r => r.fund || ""],
      ["Reference", r => r.giftId],
    ] },
};

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
  const rows = await query(sql, params);
  res.json(rows.map(r => ({
    ...r,
    changes: typeof r.changes === "string" ? JSON.parse(r.changes || "{}") : (r.changes || {}),
  })));
}));
}

module.exports = { routers, mount };

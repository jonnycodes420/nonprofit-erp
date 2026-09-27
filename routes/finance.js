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

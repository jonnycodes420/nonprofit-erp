// qboRead.js, QBO-IN. GIFTS ENTERED IN QUICKBOOKS COME INTO STEWARD, COUNTED ONCE.
//
// Small nonprofits enter checks, cash and bank transfers in QuickBooks, usually
// the bookkeeper does, and never in Steward. qboSync.js sends gifts TO the
// books; this reads gifts back FROM them, so those donors stop looking like
// they never gave. It only READS: every call to Intuit here is a GET on the
// query endpoint, with the one accounting scope the connection already has.
// Nothing is created, changed or deleted in QuickBooks.
//
// ── WHAT IS READ ──────────────────────────────────────────────────────────
// Sales Receipts, Payments (against invoices, through the invoice's items),
// Deposits with their lines, and Refund Receipts, dated on or after the
// org's "Read gifts from" day (default twelve months back). Intuit's v3
// entity shapes, from the API reference on developer.intuit.com (SalesReceipt,
// Payment, Invoice, Deposit, RefundReceipt, Item, Customer and the query
// endpoint); the stand-in the suite runs answers in exactly those shapes.
//
// ── ONLY DONATIONS COUNT ──────────────────────────────────────────────────
// A line is a gift only when the income account it posts to is one she ticked
// as a donation account. Program fees, dues, tuition, tickets: left out and
// counted in one line. Nothing ticked means the read refuses to run.
//
// ── NEVER COUNTED TWICE ───────────────────────────────────────────────────
// Skipped, and listed with the reason:
//   · what Steward sent itself (the sent-gift ledger, gift_bookkeeping_syncs,
//     and the gift id FIX-34 put in DocNumber, the field a bookkeeper does not
//     read; a payout deposit Steward sent says "Steward payout" in its note);
//   · a gift already in Steward from Stripe, PayPal, Givebutter, Zeffy, Square,
//     a giving page or an import: the processor's id when the line carries it,
//     or the same person, the same amount to the cent, within three days;
//   · a deposit line that is a processor's payout (those gifts are already in
//     Steward one by one);
//   · a deposit line that is a payment or receipt being banked (QuickBooks'
//     LinkedTxn): the same money as the receipt, read once from the receipt.
// A QuickBooks line read twice is recorded once: `qbo_read_gifts` is keyed on
// company + transaction + line, claimed BEFORE recordGift, and the gift's
// external id is the same key, so recordGift's own conflict is a second belt.
//
// ── WHO GAVE ──────────────────────────────────────────────────────────────
// personMatch.matchPerson: email, then the name (and the address when two
// people share it). Ambiguous lines wait for a person to pick; unmatched ones
// offer "Create this person". A business customer becomes an organisation.
"use strict";

const { query, run, uuid, withTransaction, withAdvisoryLock, runTx } = require("./db");
const QS = require("./qboSync");
const { matchPerson } = require("./personMatch");

const VENDOR = "quickbooks";
const DAY_WINDOW = 3;
const PAGE = 1000;
const MAX_PAGES = 20;
const SAMPLE = 10;
const PROCESSORS = /\b(stripe|paypal|square|givebutter|zeffy)\b/i;
const BUCKETS = {
  gift: "Becomes a gift",
  ambiguous: "More than one person could be this donor",
  unmatched: "Nobody in Steward matches this donor yet",
  steward_sent: "Steward sent this to QuickBooks itself",
  already_in_steward: "Already in Steward",
  payout: "A processor payout, whose gifts are already in Steward one by one",
  other_account: "Posted to an account that is not a donation account",
  already_read: "Already read from QuickBooks",
  refund: "A refund of a gift Steward read from QuickBooks",
  refund_unmatched: "A refund that matches no gift Steward read from QuickBooks",
  removed: "Voided or deleted in QuickBooks after Steward read it",
};

// ── THE SETTINGS ──────────────────────────────────────────────────────────
// Under `mapping.qbo.read` on the connection, beside the send mapping.
const parseJson = v => { if (!v) return {}; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return {}; } };
function addMonths(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function addDays(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function readSettings(connRow, today) {
  const q = (parseJson(connRow && connRow.mapping).qbo) || {};
  const r = (q.read && typeof q.read === "object") ? q.read : {};
  const accounts = {};
  for (const [id, v] of Object.entries(r.accounts && typeof r.accounts === "object" ? r.accounts : {})) {
    if (!v || typeof v !== "object") continue;
    accounts[String(id)] = { name: v.name ? String(v.name) : String(id), fundId: v.fundId ? String(v.fundId) : null };
  }
  // A ticking made in another company names another company's accounts.
  const otherCompany = !!(r.realmId && connRow && connRow.realm_id && String(r.realmId) !== String(connRow.realm_id));
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(r.from || "")) ? String(r.from) : addMonths(today, -12),
    accounts: otherCompany ? {} : accounts, auto: r.auto === true && !otherCompany,
    firstSavedAt: otherCompany ? null : (r.firstSavedAt || null), otherCompany,
  };
}
// The fund each ticked account lands on by default: the fund already mapped
// to that account for sending, so the two directions agree.
function defaultFundFor(accountId, sendMap) {
  for (const [fundId, v] of Object.entries((sendMap && sendMap.funds) || {}))
    if (v && String(v.accountId) === String(accountId) && fundId !== QS.NO_FUND) return fundId;
  return null;
}

// ── THE LINES (pure) ──────────────────────────────────────────────────────
const cents = v => Math.round(Number(v || 0) * 100);
const isVoided = t => Number(t.TotalAmt || 0) === 0 && /void/i.test(String(t.PrivateNote || ""));
// What she would call the method. QuickBooks' default payment methods are
// Cash, Check and the card brands; anything naming a transfer is a transfer.
function methodOf(name) {
  const s = String(name || "").toLowerCase();
  if (!s) return null;
  if (/cheque|check/.test(s)) return "Check";
  if (/cash/.test(s)) return "Cash";
  if (/ach|eft|wire|transfer|direct deposit|bank/.test(s)) return "Bank transfer";
  if (/visa|master|amex|american express|discover|diners|card|credit|debit/.test(s)) return "Card";
  return String(name).slice(0, 40);
}
// A processor's own transaction id, when the bookkeeper copied it into the
// memo or the reference number: Stripe's pi_/ch_/py_ ids and PayPal's
// seventeen-character ids.
function processorRefs(...texts) {
  const out = new Set();
  for (const t of texts) {
    const s = String(t || "");
    for (const m of s.matchAll(/\b(?:pi|ch|py|txn)_[A-Za-z0-9]{8,}\b/g)) out.add(m[0]);
    for (const m of s.matchAll(/\b[0-9A-Z]{17}\b/g)) if (/\d/.test(m[0]) && /[A-Z]/.test(m[0])) out.add(m[0]);
  }
  return [...out];
}
const lineNoOf = (l, i) => String(l.Id || l.LineNum || i + 1);

// Every line of every transaction, as one shape. Lines on accounts nobody
// ticked come back too (bucket other_account), because "left out" is a number
// that opens its rows like any other.
function linesFrom(data, { realmId, ticked }) {
  const items = new Map((data.Item || []).map(it => [String(it.Id), it.IncomeAccountRef ? String(it.IncomeAccountRef.value) : null]));
  const itemNames = new Map((data.Item || []).map(it => [String(it.Id), it.IncomeAccountRef && it.IncomeAccountRef.name ? String(it.IncomeAccountRef.name) : null]));
  const invoices = new Map((data.Invoice || []).map(iv => [String(iv.Id), iv]));
  const out = [], refunds = [], seen = new Set(), voided = new Set();
  let bankedLines = 0;
  const key = (type, id, line) => `${realmId}:${type}:${id}:${line}`;
  const base = (type, t) => ({ txnType: type, txnId: String(t.Id), date: String(t.TxnDate || "").slice(0, 10),
    customerId: t.CustomerRef ? String(t.CustomerRef.value) : null, customerName: t.CustomerRef ? (t.CustomerRef.name || null) : null,
    docNumber: t.DocNumber || null, privateNote: t.PrivateNote || null });
  const push = x => { x.ticked = ticked.has(String(x.accountId)); out.push(x); };

  for (const t of data.SalesReceipt || []) {
    seen.add(`SalesReceipt:${t.Id}`);
    if (isVoided(t)) { voided.add(`SalesReceipt:${t.Id}`); continue; }
    const b = base("SalesReceipt", t);
    const method = methodOf(t.PaymentMethodRef && t.PaymentMethodRef.name);
    (t.Line || []).forEach((l, i) => {
      if (l.DetailType !== "SalesItemLineDetail" || !(cents(l.Amount) > 0)) return;
      const itemId = l.SalesItemLineDetail && l.SalesItemLineDetail.ItemRef ? String(l.SalesItemLineDetail.ItemRef.value) : null;
      const ln = lineNoOf(l, i);
      push({ ...b, key: key("SalesReceipt", t.Id, ln), lineNo: ln, cents: cents(l.Amount),
        accountId: items.get(itemId) || null, accountName: itemNames.get(itemId) || null, method,
        checkNumber: method === "Check" ? (t.PaymentRefNum || null) : null,
        memo: [l.Description, t.CustomerMemo && t.CustomerMemo.value].filter(Boolean).join(" · ") || null,
        refs: processorRefs(t.PaymentRefNum, t.PrivateNote, l.Description) });
    });
  }
  // A payment pays invoices; the invoice's items say which income account.
  // An invoice split across accounts splits the payment the same way, in
  // cents, with the last account taking the rounding so the parts foot.
  for (const t of data.Payment || []) {
    seen.add(`Payment:${t.Id}`);
    if (isVoided(t)) { voided.add(`Payment:${t.Id}`); continue; }
    const b = base("Payment", t);
    const method = methodOf(t.PaymentMethodRef && t.PaymentMethodRef.name);
    (t.Line || []).forEach((l, i) => {
      const applied = cents(l.Amount);
      if (!(applied > 0)) return;
      const inv = (l.LinkedTxn || []).find(x => x.TxnType === "Invoice");
      const iv = inv ? invoices.get(String(inv.TxnId)) : null;
      const parts = new Map();
      for (const il of (iv && iv.Line) || []) {
        if (il.DetailType !== "SalesItemLineDetail") continue;
        const itemId = il.SalesItemLineDetail && il.SalesItemLineDetail.ItemRef ? String(il.SalesItemLineDetail.ItemRef.value) : null;
        const a = items.get(itemId) || null;
        parts.set(a, (parts.get(a) || 0) + cents(il.Amount));
      }
      const total = [...parts.values()].reduce((s, v) => s + v, 0);
      const entries = total > 0 ? [...parts.entries()] : [[null, applied]];
      let left = applied;
      entries.forEach(([a, c], j) => {
        const share = j === entries.length - 1 ? left : Math.round(applied * c / (total || applied));
        left -= share;
        if (!(share > 0)) return;
        const ln = `${lineNoOf(l, i)}${entries.length > 1 ? `-${a}` : ""}`;
        push({ ...b, key: key("Payment", t.Id, ln), lineNo: ln, cents: share, accountId: a,
          accountName: null, method, checkNumber: method === "Check" ? (t.PaymentRefNum || null) : null,
          memo: t.PrivateNote || null, refs: processorRefs(t.PaymentRefNum, t.PrivateNote) });
      });
    });
  }
  for (const t of data.Deposit || []) {
    seen.add(`Deposit:${t.Id}`);
    if (isVoided(t)) { voided.add(`Deposit:${t.Id}`); continue; }
    const b = base("Deposit", t);
    (t.Line || []).forEach((l, i) => {
      if (!(cents(l.Amount) > 0)) return;
      // A payment or a receipt being banked: the same money as the receipt.
      if ((l.LinkedTxn || []).length) { bankedLines++; return; }
      const d = l.DepositLineDetail || {};
      const ent = d.Entity || null;
      const method = methodOf(d.PaymentMethodRef && d.PaymentMethodRef.name);
      const ln = lineNoOf(l, i);
      const who = ent ? (ent.name || null) : null;
      push({ ...b, key: key("Deposit", t.Id, ln), lineNo: ln, cents: cents(l.Amount),
        accountId: d.AccountRef ? String(d.AccountRef.value) : null, accountName: d.AccountRef ? (d.AccountRef.name || null) : null,
        customerId: ent && /customer/i.test(String(ent.type || "")) ? String(ent.value) : null, customerName: who,
        method, checkNumber: d.CheckNum || null, memo: l.Description || null,
        payout: PROCESSORS.test(`${who || ""} ${l.Description || ""}`),
        refs: processorRefs(d.CheckNum, l.Description, t.PrivateNote) });
    });
  }
  for (const t of data.RefundReceipt || []) {
    const b = base("RefundReceipt", t);
    (t.Line || []).forEach((l, i) => {
      if (l.DetailType !== "SalesItemLineDetail" || !(cents(l.Amount) > 0)) return;
      const itemId = l.SalesItemLineDetail && l.SalesItemLineDetail.ItemRef ? String(l.SalesItemLineDetail.ItemRef.value) : null;
      const a = items.get(itemId) || null;
      if (!ticked.has(String(a))) return;
      const ln = lineNoOf(l, i);
      refunds.push({ ...b, key: key("RefundReceipt", t.Id, ln), lineNo: ln, cents: cents(l.Amount), accountId: a,
        accountName: itemNames.get(itemId) || null, memo: l.Description || null });
    });
  }
  return { lines: out, refunds, seen, voided, bankedLines };
}

// ── TALKING TO QUICKBOOKS: READS ONLY ─────────────────────────────────────
async function readAll(ctx, entity, where) {
  const rows = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const r = await QS.qboQuery(ctx, `select * from ${entity}${where ? ` where ${where}` : ""} startposition ${p * PAGE + 1} maxresults ${PAGE}`);
    if (!r.ok) return r;
    const got = r.rows[entity] || [];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { ok: true, rows };
}
async function readByIds(ctx, entity, ids) {
  const rows = [];
  const list = [...new Set(ids.filter(Boolean).map(String))];
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100).map(x => `'${String(x).replace(/'/g, "")}'`).join(",");
    const r = await QS.qboQuery(ctx, `select * from ${entity} where Id in (${part}) maxresults 1000`);
    if (!r.ok) return r;
    rows.push(...(r.rows[entity] || []));
  }
  return { ok: true, rows };
}
async function fetchCompany(ctx, from) {
  const since = `TxnDate >= '${from}'`;
  const data = {};
  for (const e of ["SalesReceipt", "Payment", "Deposit", "RefundReceipt"]) {
    const r = await readAll(ctx, e, since);
    if (!r.ok) return { ok: false, sentence: QS.plainError(r) };
    data[e] = r.rows;
  }
  const items = await readAll(ctx, "Item", null);
  if (!items.ok) return { ok: false, sentence: QS.plainError(items) };
  data.Item = items.rows;
  const invIds = [];
  for (const p of data.Payment) for (const l of p.Line || []) for (const x of l.LinkedTxn || []) if (x.TxnType === "Invoice") invIds.push(x.TxnId);
  const inv = await readByIds(ctx, "Invoice", invIds);
  if (!inv.ok) return { ok: false, sentence: QS.plainError(inv) };
  data.Invoice = inv.rows;
  const custIds = [];
  for (const e of ["SalesReceipt", "Payment", "RefundReceipt"]) for (const t of data[e]) if (t.CustomerRef) custIds.push(t.CustomerRef.value);
  for (const t of data.Deposit) for (const l of t.Line || []) {
    const ent = l.DepositLineDetail && l.DepositLineDetail.Entity;
    if (ent && /customer/i.test(String(ent.type || ""))) custIds.push(ent.value);
  }
  const cust = await readByIds(ctx, "Customer", custIds);
  if (!cust.ok) return { ok: false, sentence: QS.plainError(cust) };
  data.Customer = cust.rows;
  return { ok: true, data };
}

// A business is a customer with a company name and no person's name.
function customerFacts(c, fallbackName) {
  if (!c) return { name: fallbackName || null, email: null, line1: null, postal: null, business: false };
  const person = [c.GivenName, c.FamilyName].filter(Boolean).join(" ").trim();
  const business = !!(c.CompanyName && !person);
  return {
    name: business ? c.CompanyName : (person || c.DisplayName || c.FullyQualifiedName || fallbackName || null),
    email: c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address ? String(c.PrimaryEmailAddr.Address) : null,
    line1: c.BillAddr ? (c.BillAddr.Line1 || null) : null,
    postal: c.BillAddr ? (c.BillAddr.PostalCode || null) : null,
    city: c.BillAddr ? (c.BillAddr.City || null) : null,
    state: c.BillAddr ? (c.BillAddr.CountrySubDivisionCode || null) : null,
    business,
  };
}

// ── THE PLAN: A READ, WRITTEN TO STEWARD'S OWN RUN TABLES, NEVER TO GIFTS ─
async function planRead({ orgId, conn, today, who, tokenFor, automatic = false }) {
  const settings = readSettings(conn, today);
  const ticked = new Set(Object.keys(settings.accounts));
  if (!ticked.size) return { ok: false, status: 409, error: "no_accounts",
    sentence: "Tick at least one QuickBooks income account as a donation account first. Until then Steward reads nothing." };
  const realmId = String(conn.realm_id || "");
  if (!realmId) return { ok: false, status: 409, error: "no_company", sentence: "Steward does not know which QuickBooks company this is. Connect it again." };
  const ctx = { orgId, realmId, token: conn.credentials_sealed && tokenFor ? force => tokenFor(conn, force) : null };
  const got = await fetchCompany(ctx, settings.from);
  if (!got.ok) return { ok: false, status: 502, error: "read_failed", sentence: got.sentence };
  const { lines, refunds, seen, voided, bankedLines } = linesFrom(got.data, { realmId, ticked });
  const customers = new Map((got.data.Customer || []).map(c => [String(c.Id), c]));
  const sendMap = QS.readMapping(conn);

  // What Steward sent, by QuickBooks id, for this company.
  const sent = await query(
    `SELECT gift_id, txn_type, qbo_id FROM gift_bookkeeping_syncs
      WHERE org_id=? AND vendor=? AND realm_id=? AND status='synced' AND qbo_id IS NOT NULL`, [orgId, VENDOR, realmId]);
  const sentBy = new Map(sent.map(s => [`${s.txn_type}:${s.qbo_id}`, s.gift_id]));
  const docIds = [...new Set(lines.map(l => l.docNumber).filter(x => /^g_/.test(String(x || ""))))];
  const ownDocs = new Set(docIds.length ? (await query(`SELECT id FROM gifts WHERE org_id=? AND id = ANY(?)`, [orgId, docIds])).map(g => g.id) : []);
  const already = new Map((await query(
    `SELECT r.line_key, r.gift_id, r.status FROM qbo_read_gifts r WHERE r.org_id=? AND r.realm_id=?`, [orgId, realmId])).map(r => [r.line_key, r]));
  const funds = new Set((await query(`SELECT id FROM fin_funds WHERE org_id=?`, [orgId])).map(f => f.id));

  const runId = "qbr_" + uuid().replace(/-/g, "").slice(0, 16);
  const claimedGifts = new Set();
  const out = [];
  const matchCache = new Map();
  for (const l of lines) {
    const row = { ...l, bucket: null, reason: null, donorId: null, matchedGiftId: null, candidates: null, business: false, fundId: null };
    out.push(row);
    if (!l.ticked) { row.bucket = "other_account"; row.reason = `Posted to ${l.accountName || "an account"} that is not ticked as a donation account.`; continue; }
    const acct = settings.accounts[String(l.accountId)];
    row.accountName = row.accountName || acct.name;
    row.fundId = acct.fundId && funds.has(acct.fundId) ? acct.fundId : (defaultFundFor(l.accountId, sendMap) || null);
    const prior = already.get(l.key);
    if (prior) { row.bucket = "already_read"; row.matchedGiftId = prior.gift_id; row.reason = "Read from QuickBooks before. Recorded once, not again."; continue; }
    const mine = sentBy.get(`${l.txnType}:${l.txnId}`) || (ownDocs.has(String(l.docNumber)) ? String(l.docNumber) : null);
    if (mine || /via Steward$/.test(String(l.privateNote || "")) || /^Steward payout/.test(String(l.privateNote || ""))) {
      row.bucket = "steward_sent"; row.matchedGiftId = mine || null;
      row.reason = "Steward sent this to QuickBooks itself, so the gift is already in Steward."; continue;
    }
    if (l.payout) { row.bucket = "payout"; row.reason = `A payout from ${(String(l.customerName || l.memo || "").match(PROCESSORS) || ["a processor"])[0]}. Its gifts are already in Steward one by one.`; continue; }
    // Who gave.
    const facts = customerFacts(l.customerId ? customers.get(l.customerId) : null, l.customerName);
    row.customerName = facts.name || l.customerName;
    row.business = facts.business;
    const ck = l.customerId ? `c:${l.customerId}` : `n:${String(facts.name || "").toLowerCase()}`;
    if (!matchCache.has(ck)) matchCache.set(ck, facts.name || facts.email ? await matchPerson(orgId, facts) : { status: "none", candidates: [] });
    const m = matchCache.get(ck);
    row.donorId = m.status === "matched" ? m.id : null;
    row.candidates = m.status === "ambiguous" ? m.candidates : null;
    row.facts = facts;
    // Already in Steward from another door: the processor's id first, then
    // the same person, the same cents, within three days.
    let dup = null;
    if (l.refs && l.refs.length) {
      [dup] = await query(
        `SELECT g.id, g.date, g.payment_method, COALESCE(s.display_name, s.provider) AS src FROM gifts g
           LEFT JOIN giving_sources s ON s.id = g.giving_source_id AND s.org_id = g.org_id
          WHERE g.org_id=? AND g.read_from_vendor IS NULL
            AND (g.stripe_payment_id = ANY(?) OR g.external_id = ANY(?)
                 OR split_part(g.external_id, ':', 2) = ANY(?)) LIMIT 1`, [orgId, l.refs, l.refs, l.refs]);
    }
    if (!dup && row.donorId) {
      const rows = await query(
        `SELECT g.id, g.date, g.payment_method, COALESCE(s.display_name, s.provider) AS src FROM gifts g
           LEFT JOIN giving_sources s ON s.id = g.giving_source_id AND s.org_id = g.org_id
          WHERE g.org_id=? AND g.donor_id=? AND g.read_from_vendor IS NULL AND ROUND(g.amount * 100) = ?
            AND g.date ~ '^\\d{4}-\\d{2}-\\d{2}' AND LEFT(g.date, 10)::date BETWEEN ?::date - ?::int AND ?::date + ?::int
          ORDER BY ABS(LEFT(g.date, 10)::date - ?::date), g.id LIMIT 5`,
        [orgId, row.donorId, l.cents, l.date, DAY_WINDOW, l.date, DAY_WINDOW, l.date]);
      dup = rows.find(g => !claimedGifts.has(g.id)) || null;
    }
    if (dup) {
      claimedGifts.add(dup.id);
      row.bucket = "already_in_steward"; row.matchedGiftId = dup.id;
      const from = dup.src ? `from ${dup.src}` : (dup.payment_method ? `(${dup.payment_method})` : "");
      row.reason = `Matches the gift already in Steward ${from} on ${String(dup.date).slice(0, 10)}.`.replace("  ", " ");
      continue;
    }
    row.bucket = m.status === "matched" ? "gift" : m.status === "ambiguous" ? "ambiguous" : "unmatched";
    row.reason = row.bucket === "gift" ? `Matched by ${m.by}.`
      : row.bucket === "ambiguous" ? `${m.candidates.length} people in Steward could be ${facts.name}. Pick one.`
      : `Nobody in Steward matches ${facts.name || "this donor"}.${facts.business ? " Create them as an organisation." : " Create this person."}`;
  }

  // Refunds: the gift Steward read for the same customer, the same cents, on
  // or before the refund, newest first.
  for (const r of refunds) {
    const row = { ...r, bucket: null, reason: null, donorId: null, matchedGiftId: null, candidates: null, business: false, fundId: null, method: null, checkNumber: null, refs: [] };
    out.push(row);
    if (already.get(r.key)) { row.bucket = "already_read"; row.reason = "This refund was read before. Applied once, not again."; continue; }
    const [g] = await query(
      `SELECT q.gift_id, g.donor_id FROM qbo_read_gifts q JOIN gifts g ON g.id = q.gift_id AND g.org_id = q.org_id
        WHERE q.org_id=? AND q.realm_id=? AND q.status='recorded' AND q.cents=? AND COALESCE(q.customer_id,'') = COALESCE(?, '')
          AND LEFT(g.date, 10) <= ? AND q.txn_type <> 'RefundReceipt'
        ORDER BY g.date DESC LIMIT 1`, [orgId, realmId, r.cents, r.customerId, r.date]);
    if (g) { row.bucket = "refund"; row.matchedGiftId = g.gift_id; row.donorId = g.donor_id;
      row.reason = "Refunded in QuickBooks. Saving marks this gift refunded."; }
    else { row.bucket = "refund_unmatched"; row.reason = "A refund in QuickBooks that matches no gift Steward read from it. Nothing in Steward changes."; }
  }
  // Voided or deleted after Steward read it: a transaction Steward recorded,
  // dated inside the window, that QuickBooks no longer has or has voided.
  const recorded = await query(
    `SELECT q.line_key, q.txn_type, q.txn_id, q.gift_id, q.cents, g.donor_id, LEFT(g.date, 10) AS date
       FROM qbo_read_gifts q JOIN gifts g ON g.id = q.gift_id AND g.org_id = q.org_id
      WHERE q.org_id=? AND q.realm_id=? AND q.status='recorded' AND q.txn_type IN ('SalesReceipt','Payment','Deposit')
        AND LEFT(g.date, 10) >= ?`, [orgId, realmId, settings.from]);
  for (const q of recorded) {
    const k = `${q.txn_type}:${q.txn_id}`;
    const gone = voided.has(k) ? "voided" : !seen.has(k) ? "deleted" : null;
    if (!gone) continue;
    out.push({ key: `${q.line_key}:${gone}`, txnType: q.txn_type, txnId: q.txn_id, date: q.date, cents: Number(q.cents),
      bucket: "removed", reason: `${gone === "voided" ? "Voided" : "Deleted"} in QuickBooks. Saving removes this gift from Steward and notes it on the record.`,
      donorId: q.donor_id, matchedGiftId: q.gift_id, customerName: null, business: false, refs: [] });
  }

  // Write the plan: Steward's own tables, nothing else.
  await run(`INSERT INTO qbo_read_runs (id,org_id,realm_id,status,read_from,automatic,created_by,created_by_name)
             VALUES (?,?,?,'review',?,?,?,?)`, [runId, orgId, realmId, settings.from, automatic, who.id, who.name]);
  for (let i = 0; i < out.length; i += 200) {
    const part = out.slice(i, i + 200);
    const cols = 23;
    const vals = [], ph = [];
    for (const l of part) {
      ph.push(`(${Array(cols).fill("?").join(",")})`);
      vals.push("qbl_" + uuid().replace(/-/g, "").slice(0, 14), orgId, runId, l.key, l.txnType, l.txnId, l.date || null,
        Number(l.cents) || 0, l.accountId || null, l.accountName || null, l.fundId || null, l.customerId || null,
        l.customerName || null, !!l.business, l.method || null, l.checkNumber || null, l.memo ? String(l.memo).slice(0, 2000) : null,
        l.bucket, l.reason, l.donorId || null, l.matchedGiftId || null,
        JSON.stringify({ candidates: l.candidates || null, facts: l.facts || null }), null);
    }
    await run(`INSERT INTO qbo_read_lines (id,org_id,run_id,line_key,txn_type,txn_id,txn_date,cents,account_id,account_name,fund_id,
                 customer_id,customer_name,business,method,check_number,memo,bucket,reason,donor_id,matched_gift_id,candidates,gift_id)
               VALUES ${ph.join(",")}`, vals);
  }
  const summary = await summarize(orgId, runId, { bankedLines });
  await run(`UPDATE qbo_read_runs SET summary=?::jsonb WHERE id=? AND org_id=?`, [JSON.stringify(summary), runId, orgId]);
  return { ok: true, runId, summary };
}

// ── THE REVIEW SCREEN'S NUMBERS: ONE READ OF THE RUN'S LINES ──────────────
async function summarize(orgId, runId, extra = {}) {
  const rows = await query(
    `SELECT bucket, COUNT(*)::int AS n, COUNT(DISTINCT txn_type || ':' || txn_id)::int AS txns, COALESCE(SUM(cents),0)::bigint AS cents
       FROM qbo_read_lines WHERE org_id=? AND run_id=? GROUP BY bucket`, [orgId, runId]);
  const buckets = {};
  for (const k of Object.keys(BUCKETS)) buckets[k] = { count: 0, txns: 0, cents: 0, label: BUCKETS[k] };
  for (const r of rows) buckets[r.bucket] = { count: r.n, txns: r.txns, cents: Number(r.cents), label: BUCKETS[r.bucket] || r.bucket };
  const byAccount = (await query(
    `SELECT account_id, MAX(account_name) AS name, COUNT(*)::int AS n, COALESCE(SUM(cents),0)::bigint AS cents
       FROM qbo_read_lines WHERE org_id=? AND run_id=? AND bucket IN ('gift','ambiguous','unmatched','already_in_steward','steward_sent','payout','already_read')
      GROUP BY account_id ORDER BY 4 DESC`, [orgId, runId])).map(r => ({ accountId: r.account_id, name: r.name || r.account_id, count: r.n, cents: Number(r.cents) }));
  const other = buckets.other_account.txns;
  return {
    buckets, byAccount, bankedLines: extra.bankedLines || 0,
    leftOutSentence: other ? `${other.toLocaleString("en-US")} ${other === 1 ? "transaction" : "transactions"} on other accounts ${other === 1 ? "was" : "were"} left out.` : "Nothing was on other accounts.",
  };
}

// The lines a person reads on the review screen, by bucket.
async function runLines(orgId, runId, bucket, limit = 200) {
  const rows = await query(
    `SELECT l.*, d.name AS donor_name, f.name AS fund_name, md.name AS matched_donor_name,
            mg.date AS matched_date, COALESCE(ms.display_name, ms.provider) AS matched_source, mg.payment_method AS matched_method
       FROM qbo_read_lines l
       LEFT JOIN donors d ON d.id = l.donor_id AND d.org_id = l.org_id
       LEFT JOIN fin_funds f ON f.id = l.fund_id AND f.org_id = l.org_id
       LEFT JOIN gifts mg ON mg.id = l.matched_gift_id AND mg.org_id = l.org_id
       LEFT JOIN donors md ON md.id = mg.donor_id AND md.org_id = mg.org_id
       LEFT JOIN giving_sources ms ON ms.id = mg.giving_source_id AND ms.org_id = mg.org_id
      WHERE l.org_id=? AND l.run_id=? AND (?::text IS NULL OR l.bucket = ?::text)
      ORDER BY l.txn_date DESC NULLS LAST, l.line_key LIMIT ?`, [orgId, runId, bucket, bucket, limit]);
  return rows.map(r => {
    const extra = parseJson(r.candidates);
    return { id: r.id, key: r.line_key, bucket: r.bucket, reason: r.reason, txnType: r.txn_type, txnId: r.txn_id,
      date: r.txn_date, cents: Number(r.cents), amount: Number(r.cents) / 100, account: r.account_name || r.account_id,
      fund: r.fund_name || null, customer: r.customer_name, business: r.business === true, method: r.method,
      checkNumber: r.check_number, memo: r.memo, donorId: r.donor_id, donorName: r.donor_name || null,
      candidates: extra.candidates || null, giftId: r.gift_id || null, matchedGiftId: r.matched_gift_id || null,
      matched: r.matched_gift_id ? { donor: r.matched_donor_name || null, date: r.matched_date ? String(r.matched_date).slice(0, 10) : null,
        source: r.matched_source || r.matched_method || null } : null };
  });
}

// ── SAVE: THE ONE STEP THAT WRITES GIFTS, EACH THROUGH recordGift ─────────
// `picks` is { [lineId]: donorId | "create" }. A matched line needs nothing;
// an ambiguous one takes one of its own candidates; an unmatched one takes
// "create" (or a person already on file). Anything else waits, listed.
async function saveRun({ orgId, runId, picks = {}, who, today, deps }) {
  const { recordGift, recalcDonorSummary, recalcPledgePayment } = deps;
  const [runRow] = await query(`SELECT * FROM qbo_read_runs WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!runRow) return { ok: false, status: 404, error: "not_found", sentence: "That read is not on this organisation." };
  // One save per run: the status flips first, and a second press finds it flipped.
  const claim = await query(`UPDATE qbo_read_runs SET status='saving' WHERE id=? AND org_id=? AND status='review' RETURNING id`, [runId, orgId]);
  if (!claim.length) return { ok: false, status: 409, error: "already_saved", sentence: "This read was already saved. Read again for anything new." };
  const importId = "imp_qbo" + uuid().replace(/-/g, "").slice(0, 12);
  await run(`INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,committed_at,actor_user_id,actor_user_name)
             VALUES (?,?,?,?,?,NOW(),NOW(),?,?)`,
    [importId, orgId, "Read from QuickBooks", null, "qbo_read", /^system:/.test(who.id) ? null : who.id, who.name]);
  const lines = await query(`SELECT * FROM qbo_read_lines WHERE org_id=? AND run_id=? AND bucket IN ('gift','ambiguous','unmatched','refund','removed') ORDER BY txn_date, line_key`, [orgId, runId]);
  const res = { recorded: 0, cents: 0, waiting: 0, created: 0, refunded: 0, removed: 0, already: 0 };
  const touched = new Set();
  const created = new Map();
  for (const l of lines) {
    if (l.bucket === "refund" || l.bucket === "removed") {
      const claimRow = await query(
        `INSERT INTO qbo_read_gifts (org_id,line_key,realm_id,txn_type,txn_id,customer_id,cents,gift_id,run_id,status,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (org_id, line_key) DO NOTHING RETURNING line_key`,
        [orgId, l.line_key, runRow.realm_id, l.txn_type, l.txn_id, l.customer_id, l.cents, l.matched_gift_id, runId,
         l.bucket === "refund" ? "refund_applied" : "removal_applied", who.id, who.name]);
      if (!claimRow.length) { res.already++; continue; }
      const done = await reverseGift(orgId, l.matched_gift_id, {
        cents: l.bucket === "refund" ? Number(l.cents) : null, today, recalcDonorSummary, recalcPledgePayment,
        note: l.bucket === "refund" ? "Refunded in QuickBooks" : `Removed: ${/^Voided/.test(l.reason || "") ? "voided" : "deleted"} in QuickBooks` });
      if (done) {
        await run(`UPDATE qbo_read_gifts SET status=?, updated_at=NOW() WHERE org_id=? AND gift_id=? AND status='recorded'`,
          [l.bucket === "refund" ? (done.full ? "refunded" : "part_refunded") : "removed", orgId, l.matched_gift_id]);
        res[l.bucket === "refund" ? "refunded" : "removed"]++;
      }
      continue;
    }
    let donorId = l.donor_id;
    const pick = picks[l.id];
    const extra = parseJson(l.candidates);
    if (l.bucket === "ambiguous") {
      donorId = pick && (extra.candidates || []).some(c => c.id === pick) ? pick : null;
    } else if (l.bucket === "unmatched") {
      if (pick === "create") {
        const ck = l.customer_id ? `c:${l.customer_id}` : `n:${String(l.customer_name || "").toLowerCase()}`;
        if (!created.has(ck)) created.set(ck, await createPerson(orgId, l, extra.facts || {}, importId, who));
        donorId = created.get(ck);
        res.created += donorId ? 1 : 0;
      } else if (pick) {
        const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [pick, orgId]);
        donorId = d ? d.id : null;
      } else donorId = null;
    }
    if (!donorId) { res.waiting++; continue; }
    // The claim, BEFORE the gift: a second save, an automatic read running at
    // the same moment, or a line read twice finds the key taken.
    const claimed = await query(
      `INSERT INTO qbo_read_gifts (org_id,line_key,realm_id,txn_type,txn_id,customer_id,cents,run_id,status,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,'recorded',?,?) ON CONFLICT (org_id, line_key) DO NOTHING RETURNING line_key`,
      [orgId, l.line_key, runRow.realm_id, l.txn_type, l.txn_id, l.customer_id, l.cents, runId, who.id, who.name]);
    if (!claimed.length) { res.already++; continue; }
    let w;
    try {
      w = await recordGift({
        orgId, donorId, amount: Number(l.cents) / 100, date: l.txn_date, type: "cash",
        notes: l.memo || "", fundId: l.fund_id || null,
        paymentMethod: l.method || "Needs you", checkNumber: l.check_number || null,
        externalId: `qbo:${l.line_key}`, conflict: "external",
        importId, readFromVendor: VENDOR, source: VENDOR,
        actorId: who.id, actorName: who.name,
        ledgerDescription: undefined,
        // A check that came in last week waits for a thank-you, and can start a
        // journey, like any other. A year of history read on the first day
        // opens no year of drafts and starts nothing (FIX-36, historyGifts.js).
        history: true, today,
      });
    } catch (e) {
      await run(`DELETE FROM qbo_read_gifts WHERE org_id=? AND line_key=? AND gift_id IS NULL`, [orgId, l.line_key]);
      throw e;
    }
    if (!w || w.duplicate || !w.gift) {
      await run(`DELETE FROM qbo_read_gifts WHERE org_id=? AND line_key=? AND gift_id IS NULL`, [orgId, l.line_key]);
      res.already++; continue;
    }
    await run(`UPDATE qbo_read_gifts SET gift_id=?, updated_at=NOW() WHERE org_id=? AND line_key=?`, [w.gift.id, orgId, l.line_key]);
    await run(`UPDATE qbo_read_lines SET gift_id=?, donor_id=? WHERE id=? AND org_id=?`, [w.gift.id, donorId, l.id, orgId]);
    touched.add(donorId);
    res.recorded++; res.cents += Number(l.cents);
  }
  await run(`UPDATE imports SET gifts_created=?, donors_created=?, dollars_created=?, rows_in=?, summary_json=?::jsonb WHERE id=? AND org_id=?`,
    [res.recorded, res.created, res.cents / 100, lines.length, JSON.stringify({ qboReadRun: runId, ...res }), importId, orgId]);
  await run(`UPDATE qbo_read_runs SET status='saved', saved_at=NOW(), import_id=? WHERE id=? AND org_id=?`, [importId, runId, orgId]);
  for (const d of touched) await recalcDonorSummary(d, orgId).catch(() => {});
  const money = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts = [`${res.recorded} ${res.recorded === 1 ? "gift" : "gifts"} saved (${money(res.cents)})`];
  if (res.created) parts.push(`${res.created} ${res.created === 1 ? "person" : "people"} created`);
  if (res.refunded) parts.push(`${res.refunded} marked refunded`);
  if (res.removed) parts.push(`${res.removed} removed because QuickBooks voided or deleted ${res.removed === 1 ? "it" : "them"}`);
  if (res.waiting) parts.push(`${res.waiting} still waiting for you to say who gave`);
  if (res.already) parts.push(`${res.already} already in Steward, not saved again`);
  return { ok: true, runId, importId, ...res, sentence: parts.join("; ") + ". Nothing was sent to QuickBooks." };
}

// A person (or an organisation) the bookkeeper's customer names, made only
// because somebody pressed "Create this person". Tagged with the run, so the
// undo takes them back if they have nothing else.
async function createPerson(orgId, l, facts, importId, who) {
  const name = String(facts.name || l.customer_name || "").trim().slice(0, 200);
  if (!name) return null;
  const id = "d_" + uuid().replace(/-/g, "").slice(0, 10);
  await run(
    `INSERT INTO donors (id,org_id,name,email,address,city,state,zip,kind,stage,status,tags,person_types,created_import_id,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,'prospect','active','[]','["donor"]'::jsonb,?,?,?)`,
    [id, orgId, name, facts.email || null, facts.line1 || null, facts.city || null, facts.state || null, facts.postal || null,
     l.business ? "organisation" : null, importId, who.id, who.name]);
  return id;
}

// ── A REFUND OR A VOID IN QUICKBOOKS ──────────────────────────────────────
// The Stripe refund's own shape (routes/webhooks.js charge.refunded), for a
// gift Steward read from the books: a full refund or a removal takes the gift
// out everywhere at once (its ledger line, its pledge link, its active receipt
// voided, its waiting thank-you), a partial one shrinks it, and either way one
// line on the person's timeline says what happened. Never silent.
async function reverseGift(orgId, giftId, { cents = null, note, today, recalcDonorSummary, recalcPledgePayment }) {
  if (!giftId) return null;
  return withAdvisoryLock(`gift:${giftId}`, async () => {
    const [g] = await query(`SELECT * FROM gifts WHERE id=? AND org_id=?`, [giftId, orgId]);
    if (!g) return null;
    const had = Math.round(Number(g.amount) * 100);
    const full = cents == null || cents >= had;
    await withTransaction(async client => {
      if (full) {
        await runTx(client, `UPDATE receipts SET voided_at=NOW(), void_reason=$1, gift_id=NULL
                              WHERE gift_id=$2 AND org_id=$3 AND type='gift' AND voided_at IS NULL`, [note, g.id, orgId]);
        await runTx(client, "UPDATE receipts SET gift_id=NULL WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
        await runTx(client, "UPDATE pledges SET fulfilled_gift_id=NULL, updated_at=NOW() WHERE fulfilled_gift_id=$1 AND org_id=$2", [g.id, orgId]);
        await runTx(client, "UPDATE pledge_installments SET paid_gift_id=NULL, paid_at=NULL WHERE org_id=$1 AND paid_gift_id=$2", [orgId, g.id]);
        await runTx(client, "DELETE FROM thank_you_drafts WHERE org_id=$1 AND gift_id=$2", [orgId, g.id]);
        await runTx(client, "DELETE FROM fin_transactions WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
        await runTx(client, "UPDATE interactions SET gift_id=NULL WHERE gift_id=$1 AND org_id=$2", [g.id, orgId]);
        await runTx(client, "DELETE FROM gifts WHERE id=$1 AND org_id=$2", [g.id, orgId]);
      } else {
        await runTx(client, "UPDATE gifts SET amount=$1 WHERE id=$2 AND org_id=$3", [(had - cents) / 100, g.id, orgId]);
        await runTx(client, "UPDATE fin_transactions SET amount=$1 WHERE gift_id=$2 AND org_id=$3", [(had - cents) / 100, g.id, orgId]);
      }
    });
    if (g.pledge_id && recalcPledgePayment) await recalcPledgePayment(g.pledge_id, orgId).catch(() => {});
    if (g.donor_id) {
      await recalcDonorSummary(g.donor_id, orgId).catch(() => {});
      const m = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,'note',?,?,?,?)`,
        ["i_" + uuid().slice(0, 8), orgId, g.donor_id,
         full ? `${note}: the ${m(had)} gift of ${String(g.date).slice(0, 10)} was taken out of Steward.`
              : `${note}: ${m(cents)} of the ${m(had)} gift of ${String(g.date).slice(0, 10)}. The gift is now ${m(had - cents)}.`,
         today, "system:qbo/read", "Steward (QuickBooks read)"]);
    }
    return { full };
  });
}

// ── UNDO: THE WHOLE READ, IN ONE STEP ─────────────────────────────────────
// Everything this read added: its gifts (with their ledger lines, timeline
// lines and thank-you drafts), the people it created who have nothing else,
// and its once-only keys, so a later read can bring the same lines in again.
// A refund or removal it applied is not reversed: that was QuickBooks' fact.
async function undoRun({ orgId, runId, who, deps }) {
  const { recalcDonorSummary } = deps;
  const [r] = await query(`SELECT * FROM qbo_read_runs WHERE id=? AND org_id=?`, [runId, orgId]);
  if (!r) return { ok: false, status: 404, error: "not_found", sentence: "That read is not on this organisation." };
  if (r.undone_at) return { ok: false, status: 409, error: "already_undone", sentence: "This read was already undone." };
  if (r.status !== "saved" || !r.import_id) {
    await run(`UPDATE qbo_read_runs SET status='discarded', undone_at=NOW() WHERE id=? AND org_id=?`, [runId, orgId]);
    return { ok: true, gifts: 0, donorsRemoved: 0, sentence: "Closed. Nothing from this read had been saved." };
  }
  const flip = await query(`UPDATE qbo_read_runs SET undone_at=NOW() WHERE id=? AND org_id=? AND undone_at IS NULL RETURNING id`, [runId, orgId]);
  if (!flip.length) return { ok: false, status: 409, error: "already_undone", sentence: "This read was already undone." };
  const gifts = await query(`SELECT id, donor_id, pledge_id FROM gifts WHERE org_id=? AND import_id=?`, [orgId, r.import_id]);
  const ids = gifts.map(g => g.id);
  const donorIds = [...new Set(gifts.map(g => g.donor_id))];
  if (ids.length) {
    await run(`UPDATE pledge_installments SET paid_gift_id=NULL, paid_at=NULL WHERE org_id=? AND paid_gift_id = ANY(?)`, [orgId, ids]);
    await run(`DELETE FROM thank_you_drafts WHERE org_id=? AND gift_id = ANY(?)`, [orgId, ids]).catch(() => {});
    await run(`DELETE FROM fin_transactions WHERE org_id=? AND gift_id = ANY(?)`, [orgId, ids]);
    await run(`DELETE FROM interactions WHERE org_id=? AND gift_id = ANY(?)`, [orgId, ids]);
    await run(`UPDATE receipts SET voided_at=COALESCE(voided_at, NOW()), void_reason=COALESCE(void_reason, 'The QuickBooks read was undone'), gift_id=NULL
                WHERE org_id=? AND gift_id = ANY(?)`, [orgId, ids]);
    await run(`DELETE FROM gifts WHERE org_id=? AND id = ANY(?)`, [orgId, ids]);
  }
  await run(`DELETE FROM qbo_read_gifts WHERE org_id=? AND run_id=? AND status='recorded'`, [orgId, runId]);
  const orphans = await query(
    `SELECT d.id FROM donors d WHERE d.org_id=? AND d.created_import_id=?
       AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id)
       AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.donor_id=d.id)`, [orgId, r.import_id]);
  if (orphans.length) {
    await run(`UPDATE qbo_read_lines SET donor_id=NULL WHERE org_id=? AND donor_id = ANY(?)`, [orgId, orphans.map(o => o.id)]);
    await run(`DELETE FROM donors WHERE org_id=? AND id = ANY(?)`, [orgId, orphans.map(o => o.id)]);
  }
  for (const d of donorIds) await recalcDonorSummary(d, orgId).catch(() => {});
  await run(`UPDATE imports SET reversed_at=NOW(), reversed_by=? WHERE id=? AND org_id=?`, [who.name || who.id, r.import_id, orgId]);
  await run(`UPDATE qbo_read_runs SET status='undone' WHERE id=? AND org_id=?`, [runId, orgId]);
  return { ok: true, gifts: ids.length, donorsRemoved: orphans.length,
    sentence: `Undone. ${ids.length} ${ids.length === 1 ? "gift" : "gifts"} read from QuickBooks removed`
      + (orphans.length ? ` and ${orphans.length} ${orphans.length === 1 ? "person" : "people"} this read created` : "")
      + ". Nothing in QuickBooks was touched." };
}

module.exports = {
  VENDOR, BUCKETS, DAY_WINDOW, readSettings, defaultFundFor, methodOf, processorRefs, linesFrom, customerFacts,
  fetchCompany, planRead, summarize, runLines, saveRun, undoRun, reverseGift, addMonths,
};

// qboSync.js, PARITY-2 Part 5. ONE GIFT, ONE SALES RECEIPT, AND NOTHING
// UNTIL A PERSON PRESSES SYNC.
//
// INT-2 built the deposit side of an accounting connection against a stub
// endpoint nobody calls. This is the real QuickBooks Online path: each gift
// becomes a SalesReceipt (or, if the organisation chooses, each payout becomes
// a Deposit), posted to Intuit's v3 API, with the donor matched to a
// QuickBooks customer or created as one, and the result and the QuickBooks id
// kept on the gift.
//
// ── WHAT DECIDES WHERE A GIFT LANDS ───────────────────────────────────────
// The mapping, set once in Settings, chosen from the company's own chart of
// accounts and classes. A gift's CAMPAIGN (an appeal is a campaign) is the
// more specific choice, so a mapped campaign wins; otherwise its FUND; a gift
// with no fund uses the "No fund named" row. Class follows the same order and
// is optional. A gift whose campaign and fund both have no account is NOT
// sent anywhere by default: it stays in Pending and says which mapping is
// missing, because a default here posts restricted money to the wrong place
// and nobody notices until an auditor does.
//
// ── ONCE, AND THE TWO BELTS THAT MAKE IT ONCE ─────────────────────────────
// 1. Steward's own row, `gift_bookkeeping_syncs`, unique on (org, gift,
//    vendor, company), claimed BEFORE the call and kept whatever happened. A
//    synced gift cannot be claimed again, so pressing Sync twice sends nothing
//    new. FIX-20: the COMPANY (Intuit's realmId) is part of the key. A gift
//    sent to one QuickBooks company is not in a different company's books, so
//    a connection moved to another company starts with an empty sent list
//    there, and the first company's list is kept for the day it comes back.
// 2. Intuit's `requestid` query parameter. A retry after a timeout carries the
//    SAME request id, and QuickBooks answers it with the receipt it already
//    made rather than making a second one. Intuit replays the first answer to
//    a request id, failures included, so the id is derived from the payload:
//    a retry after a definite refusal (an inactive account, say) carries a
//    new id once the mapping is fixed; a retry after an UNKNOWN outcome keeps
//    the old one.
//
// ── WHAT IS NEVER DONE ────────────────────────────────────────────────────
// Nothing here moves money; it writes a bookkeeping entry for money that has
// already arrived. Nothing is sent from the demonstration org. Nothing is
// sent unauthenticated except to the local stub a test boot points at
// (TEST_MODE=1). Disconnecting deletes nothing, here or in QuickBooks.
"use strict";

const crypto = require("crypto");
const { query, run, uuid } = require("./db");
const { NON_CASH_TYPES } = require("./depositsFile");

const VENDOR = "quickbooks";
// Intuit retired every minor version below 75 in 2025; 75 is the floor.
const MINOR_VERSION = 75;
const NO_FUND = "__none";
const STALE_SENDING_MINUTES = 10;
const RUN_LIMIT = 100;
// The company the org's live connection points at, as SQL, so every reader of
// the sent list (Pending, its figure, the claim) asks about the same company.
const LIVE_REALM_SQL = `(SELECT COALESCE(bc.realm_id, '') FROM bookkeeping_connections bc
     WHERE bc.org_id = g.org_id AND bc.vendor = '${VENDOR}' AND bc.status <> 'disconnected' LIMIT 1)`;
const NON_CASH_SQL = [...NON_CASH_TYPES].map(t => `'${String(t).replace(/'/g, "''")}'`).join(",");

// ── WHERE INTUIT IS ───────────────────────────────────────────────────────
// INTUIT_API_BASE points the server at the sandbox
// (https://sandbox-quickbooks.api.intuit.com), at production, or at the local
// stub a test boot starts. INT-2 documented it with and without a trailing
// /v3, so both are read as the host.
function apiBase() {
  const raw = String(process.env.INTUIT_API_BASE || "https://quickbooks.api.intuit.com").trim();
  return raw.replace(/\/+$/, "").replace(/\/v3$/, "");
}
function environment() {
  const e = String(process.env.INTUIT_ENVIRONMENT || "").toLowerCase();
  if (e === "production" || e === "sandbox") return e;
  return /^https:\/\/quickbooks\.api\.intuit\.com$/.test(apiBase()) ? "production" : "sandbox";
}
function appHost() {
  return environment() === "production" ? "https://app.qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com";
}
// The link out to the entry in QuickBooks, so a person can see it there.
function txnLink(txnType, id) {
  if (!id) return null;
  return `${appHost()}/app/${txnType === "Deposit" ? "deposit" : "salesreceipt"}?txnId=${encodeURIComponent(String(id))}`;
}

// ── THE MAPPING ───────────────────────────────────────────────────────────
// Kept under `mapping.qbo` on the connection row, beside INT-2's deposit
// mapping, so the two never overwrite each other.
const parseJson = v => { if (!v) return {}; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return {}; } };
const ref = v => (v && typeof v === "object" && v.id) ? { id: String(v.id), name: v.name ? String(v.name) : null } : null;
function readMapping(connRow) {
  const m = parseJson(connRow && connRow.mapping);
  const q = (m && typeof m.qbo === "object" && m.qbo) || {};
  // FIX-20: a mapping is chosen from ONE company's chart of accounts. Account
  // and class ids are that company's own numbers, so another company's "81"
  // is some other account entirely: a mapping made in a different company is
  // not used, and the gifts wait in Pending until this company's is chosen.
  const mappedRealm = q.realmId ? String(q.realmId) : null;
  const otherCompany = !!(mappedRealm && connRow && connRow.realm_id && mappedRealm !== String(connRow.realm_id));
  const clean = obj => {
    const out = {};
    for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
      if (!v || typeof v !== "object") continue;
      out[k] = { accountId: v.accountId ? String(v.accountId) : null, accountName: v.accountName ? String(v.accountName) : null,
                 classId: v.classId ? String(v.classId) : null, className: v.className ? String(v.className) : null };
    }
    return out;
  };
  return {
    mode: q.mode === "deposit" ? "deposit" : "salesreceipt",
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(q.startDate || "")) ? String(q.startDate) : null,
    depositAccount: otherCompany ? null : ref(q.depositAccount),
    feeAccount: otherCompany ? null : ref(q.feeAccount),
    funds: otherCompany ? {} : clean(q.funds), campaigns: otherCompany ? {} : clean(q.campaigns),
    realmId: mappedRealm, otherCompany,
    items: (q.items && typeof q.items === "object") ? q.items : {},
    demo: q.demo === true,
  };
}
// The day Pending starts from. Before it is the history the organisation's
// bookkeeper already entered by hand; sending it again would double it.
function startDateOf(connRow, map) {
  if (map.startDate) return map.startDate;
  const c = connRow && connRow.created_at ? new Date(connRow.created_at) : new Date();
  return (isNaN(c) ? new Date() : c).toISOString().slice(0, 10);
}

// ── WHERE ONE GIFT LANDS (pure) ───────────────────────────────────────────
function landingFor(g, map) {
  if (map.otherCompany) {
    return { ok: false, problem: "other_company",
      sentence: "The mapping was chosen in a different QuickBooks company. Choose this company's accounts in the mapping, then press Retry." };
  }
  const camp = g.campaign_id ? (map.campaigns[g.campaign_id] || null) : null;
  const fund = map.funds[g.fund_id || NO_FUND] || null;
  const acct = camp && camp.accountId ? camp : (fund && fund.accountId ? fund : null);
  const cls = camp && camp.classId ? camp : (fund && fund.classId ? fund : null);
  const fundWords = g.fund_id ? `the fund "${g.fund_name || g.fund_id}"` : "gifts with no fund named";
  if (!acct) {
    const what = g.campaign_id
      ? `Neither ${fundWords} nor the campaign "${g.campaign_name || g.campaign_id}" has a`
      : `${fundWords.charAt(0).toUpperCase()}${fundWords.slice(1)} ${g.fund_id ? "has" : "have"} no`;
    return { ok: false, problem: "unmapped",
      sentence: `${what} QuickBooks account yet. Choose one in the mapping, then press Retry.` };
  }
  if (!map.depositAccount) {
    return { ok: false, problem: "no_deposit_account",
      sentence: "No deposit account is chosen yet, so QuickBooks would not know where this money landed. Choose one in the mapping, then press Retry." };
  }
  return {
    ok: true, accountId: acct.accountId, accountName: acct.accountName || acct.accountId,
    classId: cls ? cls.classId : null, className: cls ? (cls.className || cls.classId) : null,
    by: acct === camp ? "campaign" : "fund",
    sentence: `${acct.accountName || acct.accountId}${cls ? `, class ${cls.className || cls.classId}` : ""}`,
  };
}

// ── PENDING: THE ONE DEFINITION ───────────────────────────────────────────
// The Pending list, the figure above it and the drill-through behind that
// figure all read THIS, so the number and its rows cannot disagree. A gift is
// pending when it is real money (not a sample, not a refund, not stock or
// in-kind, which never reached a bank), dated on or after the start date, and
// has no sync row, a failed one, or one stuck mid-send for ten minutes.
function pendingWhere(orgId, since, { giftIds = null } = {}) {
  const args = [orgId, since];
  let where = `g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0
     AND COALESCE(g.is_sample, false) = false AND g.date >= ?
     AND LOWER(TRIM(COALESCE(g.type, ''))) NOT IN (${NON_CASH_SQL})
     AND (s.id IS NULL OR s.status = 'failed'
          OR (s.status = 'sending' AND s.updated_at < NOW() - INTERVAL '${STALE_SENDING_MINUTES} minutes'))`;
  if (giftIds) { where += ` AND g.id = ANY(?)`; args.push(giftIds); }
  return {
    from: `gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
      LEFT JOIN gift_bookkeeping_syncs s ON s.org_id = g.org_id AND s.gift_id = g.id AND s.vendor = '${VENDOR}'
                                         AND s.realm_id = ${LIVE_REALM_SQL}`,
    where, args,
  };
}
function pendingRowsSql(orgId, since, opts = {}) {
  const p = pendingWhere(orgId, since, opts);
  return {
    sql: `SELECT g.id, g.donor_id, d.name AS donor_name, d.email AS donor_email, g.date,
                 ROUND(g.amount::numeric, 2) AS amount, ROUND(g.amount::numeric * 100)::bigint AS cents,
                 ROUND(COALESCE(g.processor_fee_amount, 0)::numeric * 100)::bigint AS fee_cents,
                 g.fund_id, f.name AS fund_name, g.campaign_id, c.name AS campaign_name,
                 g.deposit_ref, g.deposited_on, g.payment_method,
                 s.status AS sync_status, s.error AS sync_error, s.error_code AS sync_error_code,
                 s.request_id AS sync_request_id, s.attempts AS sync_attempts, s.updated_at AS sync_updated_at
            FROM ${p.from} WHERE ${p.where}
           ORDER BY g.date ASC, g.id ASC`,
    args: p.args,
  };
}

// ── TALKING TO QUICKBOOKS ─────────────────────────────────────────────────
// `ctx.token(force)` is routes/finance.js's accessTokenFor, so the refresh
// rule (five minutes early, once more on a 401) is the one every provider
// already uses. A connection with no sealed token sends unauthenticated ONLY
// on a test boot, to the stub; anywhere else it is "not connected".
async function qboCall(ctx, method, path, { body = null, params = {} } = {}) {
  const qs = new URLSearchParams({ minorversion: String(MINOR_VERSION), ...params });
  const url = `${apiBase()}/v3/company/${encodeURIComponent(ctx.realmId)}/${path}?${qs.toString()}`;
  const send = tok => fetch(url, {
    method,
    headers: { Accept: "application/json",
               ...(body ? { "Content-Type": "application/json" } : {}),
               ...(tok ? { Authorization: "Bearer " + tok } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let tok = ctx.token ? await ctx.token(false) : null;
  if (tok && !tok.ok) return { ok: false, kind: "auth", sentence: tok.body && tok.body.sentence };
  let r;
  try {
    r = await send(tok ? tok.accessToken : null);
    if (r.status === 401 && tok) {
      tok = await ctx.token(true);
      if (!tok.ok) return { ok: false, kind: "auth", sentence: tok.body && tok.body.sentence };
      r = await send(tok.accessToken);
    }
  } catch (e) {
    // A timeout or a dropped connection: Steward cannot know whether it landed.
    return { ok: false, kind: "network", unknown: true, message: e && e.message };
  }
  const json = await r.json().catch(() => null);
  if (r.ok && json && !json.Fault) return { ok: true, status: r.status, body: json };
  if (r.status >= 500) console.error(`[qbo] ${method} ${path} answered ${r.status}`);
  return { ok: false, status: r.status, kind: r.status >= 500 ? "server" : "fault",
           unknown: r.status >= 500, fault: (json && json.Fault) || null };
}
// QuickBooks' query language escapes an apostrophe with a backslash.
const qstr = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function qboQuery(ctx, statement) {
  const r = await qboCall(ctx, "GET", "query", { params: { query: statement } });
  if (!r.ok) return r;
  return { ok: true, rows: (r.body && r.body.QueryResponse) || {} };
}

// ── QUICKBOOKS' REFUSALS, IN PLAIN WORDS ──────────────────────────────────
// A person reads this beside a Retry button. It never shows a status code, a
// fault code or a stack; the code is kept in `error_code` for whoever debugs.
function plainError(res, ctx = {}) {
  if (!res) return "Steward could not finish this one. Press Retry.";
  if (res.kind === "auth")
    return res.sentence || "QuickBooks needs signing in again. Connect it again from this card, then press Retry. Nothing already sent is affected.";
  if (res.kind === "network")
    return "QuickBooks did not answer in time, so Steward cannot tell whether it arrived. Retry sends the very same request, and QuickBooks will not record it twice.";
  if (res.status === 401 || res.status === 403)
    return "QuickBooks refused Steward's sign-in. Connect QuickBooks again from this card, then press Retry.";
  if (res.status === 429)
    return "QuickBooks asked Steward to slow down. Wait a minute, then press Retry.";
  if (res.kind === "server")
    return "QuickBooks had a problem on its side. Retry sends the very same request, so it cannot be recorded twice.";
  const err = ((res.fault && res.fault.Error) || [])[0] || {};
  const code = String(err.code || "");
  const text = `${err.Message || ""} ${err.Detail || ""}`;
  const acct = ctx.accountName ? `the account ${ctx.accountName}` : "the account in the mapping";
  if (code === "610" || /inactive/i.test(text)) {
    if (/class/i.test(text)) return `QuickBooks says the class ${ctx.className || "in the mapping"} is inactive. Pick another class in the mapping, then press Retry.`;
    if (/customer|name/i.test(text) && !/account/i.test(text)) return "QuickBooks says this donor's customer record is inactive. Make it active in QuickBooks, then press Retry.";
    return `QuickBooks says ${acct} is inactive. Pick another account in the mapping, then press Retry.`;
  }
  if (code === "2500" || /invalid reference/i.test(text)) {
    if (/class/i.test(text)) return `QuickBooks no longer has the class ${ctx.className || "in the mapping"}. Pick another class in the mapping, then press Retry.`;
    if (/customer/i.test(text)) return "QuickBooks no longer has the customer Steward matched this donor to. Press Retry and Steward will find or create the customer again.";
    return `QuickBooks no longer has ${acct}. Pick another account in the mapping, then press Retry.`;
  }
  if (code === "6210" || /closed|period/i.test(text))
    return `The books are closed for ${ctx.date || "this date"} in QuickBooks. Ask your bookkeeper to open that period, or skip this gift.`;
  if (code === "6190" || /subscription|company status/i.test(text))
    return "This QuickBooks company is not accepting new entries: its subscription has ended or it is suspended. Sort that out in QuickBooks, then press Retry.";
  if (code === "6240" || /duplicate name/i.test(text))
    return "QuickBooks already has a customer, vendor or employee with this donor's name. Steward will use a slightly different name on Retry.";
  if (code === "6000" && /account/i.test(text) && /type|not valid|invalid/i.test(text))
    return `QuickBooks will not take ${acct} for a gift. Choose an income account in the mapping, then press Retry.`;
  if (code === "5010") return "Someone changed this entry in QuickBooks at the same moment. Press Retry.";
  const detail = String(err.Detail || err.Message || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `QuickBooks did not accept this gift${detail ? `: "${detail}"` : ""}. Check the mapping, then press Retry.`;
}

// ── REQUEST IDS ───────────────────────────────────────────────────────────
// At most 50 characters (Intuit's limit), deterministic, and tied to the
// payload so a fixed mapping is a new request and a timeout is not.
function requestId(orgId, realmId, kind, key, payload) {
  const h = crypto.createHash("sha256")
    .update([orgId, realmId, kind, key, JSON.stringify(payload || null)].join("\u0000")).digest("hex");
  return `stw-${kind}-${h.slice(0, 40)}`;
}

// ── CUSTOMERS AND ITEMS ───────────────────────────────────────────────────
// A QuickBooks display name cannot contain a colon (it is the sub-customer
// separator) or a tab or new line, and is at most 500 characters.
const safeName = (s, max = 100) => String(s || "").replace(/[:\t\r\n]+/g, " - ").replace(/\s+/g, " ").trim().slice(0, max);

async function customerFor(ctx, g) {
  const [known] = await query(
    `SELECT customer_id FROM bookkeeping_customers WHERE org_id=? AND vendor=? AND realm_id=? AND donor_id=?`,
    [ctx.orgId, VENDOR, ctx.realmId, g.donor_id]);
  if (known) return { ok: true, id: known.customer_id };
  const name = safeName(g.donor_name || "Anonymous donor", 400) || "Anonymous donor";
  let found = null, how = null;
  // By email first: it is the one thing that says this is the same person.
  // A company file that will not filter on email is asked by name instead.
  if (g.donor_email) {
    const r = await qboQuery(ctx, `select Id, DisplayName from Customer where PrimaryEmailAddr = '${qstr(g.donor_email)}'`);
    if (r.ok && (r.rows.Customer || []).length) { found = r.rows.Customer[0]; how = "email"; }
  }
  if (!found) {
    const r = await qboQuery(ctx, `select Id, DisplayName from Customer where DisplayName = '${qstr(name)}'`);
    if (!r.ok) return r;
    if ((r.rows.Customer || []).length) { found = r.rows.Customer[0]; how = "name"; }
  }
  if (!found) {
    const create = displayName => qboCall(ctx, "POST", "customer", { body: {
      DisplayName: displayName,
      ...(g.donor_email ? { PrimaryEmailAddr: { Address: String(g.donor_email).slice(0, 100) } } : {}),
    } });
    let r = await create(name);
    // The name is taken by a vendor or an employee: the person is still a
    // donor, so the customer gets a name that says so.
    if (!r.ok && r.fault && ((r.fault.Error || [])[0] || {}).code === "6240") r = await create(safeName(`${name} (donor)`, 400));
    if (!r.ok) return r;
    found = r.body.Customer; how = "created";
  }
  if (!found || !found.Id) return { ok: false, kind: "fault", fault: null };
  await run(
    `INSERT INTO bookkeeping_customers (id,org_id,vendor,realm_id,donor_id,customer_id,customer_name,matched_by,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (org_id, vendor, realm_id, donor_id) DO NOTHING`,
    ["bkcu_" + uuid().slice(0, 10), ctx.orgId, VENDOR, ctx.realmId, g.donor_id, String(found.Id),
     found.DisplayName || name, how, ctx.who.id, ctx.who.name]);
  return { ok: true, id: String(found.Id) };
}

// QuickBooks posts a sales receipt's income through an ITEM, never straight
// to an account: so each mapped income account gets one service item whose
// income account is that account, made once and remembered.
async function itemFor(ctx, landing) {
  const key = `${ctx.realmId}:${landing.accountId}`;
  if (ctx.map.items[key]) return { ok: true, id: String(ctx.map.items[key]) };
  const base = safeName(`Steward gifts - ${landing.accountName || landing.accountId}`, 100);
  let found = null;
  for (const name of [base, safeName(`${base} (${landing.accountId})`, 100)]) {
    const r = await qboQuery(ctx, `select * from Item where Name = '${qstr(name)}'`);
    if (!r.ok) return r;
    const it = (r.rows.Item || [])[0];
    if (!it) {
      const c = await qboCall(ctx, "POST", "item", { body: {
        Name: name, Type: "Service", IncomeAccountRef: { value: landing.accountId } } });
      if (!c.ok) return c;
      found = c.body.Item; break;
    }
    // An item of that name posting somewhere else is somebody's own item;
    // Steward makes its own beside it rather than borrowing it.
    if (it.IncomeAccountRef && String(it.IncomeAccountRef.value) === String(landing.accountId)) { found = it; break; }
  }
  if (!found || !found.Id) return { ok: false, kind: "fault", fault: null };
  ctx.map.items[key] = String(found.Id);
  await run(
    `UPDATE bookkeeping_connections
        SET mapping = jsonb_set(COALESCE(mapping, '{}'::jsonb), '{qbo}',
              COALESCE(mapping->'qbo', '{}'::jsonb)
              || jsonb_build_object('items', COALESCE(mapping->'qbo'->'items', '{}'::jsonb) || jsonb_build_object(?::text, ?::text)))
      WHERE id=? AND org_id=?`, [key, String(found.Id), ctx.connId, ctx.orgId]);
  return { ok: true, id: String(found.Id) };
}

// ── THE TWO ENTRIES (pure) ────────────────────────────────────────────────
const dollars = cents => Math.round(Number(cents) || 0) / 100;
function describe(g) {
  return [g.fund_name ? `Gift to ${g.fund_name}` : "Gift", g.campaign_name || null].filter(Boolean).join(" · ").slice(0, 4000);
}
function buildSalesReceipt(g, landing, { customerId, itemId, depositAccountId }) {
  const amount = dollars(g.cents);
  return {
    TxnDate: String(g.date).slice(0, 10),
    CustomerRef: { value: String(customerId) },
    DepositToAccountRef: { value: String(depositAccountId) },
    PrivateNote: `Steward gift ${g.id}`,
    Line: [{
      Amount: amount, DetailType: "SalesItemLineDetail", Description: describe(g),
      SalesItemLineDetail: { ItemRef: { value: String(itemId) }, Qty: 1, UnitPrice: amount,
        ...(landing.classId ? { ClassRef: { value: String(landing.classId) } } : {}) },
    }],
  };
}
// A payout as one deposit: a line per gift (with the donor as its customer),
// and the processor's fee as ONE negative line, so the deposit equals what
// reached the bank. The sum is asserted in cents before anything is sent.
function buildPayoutDeposit(payoutRef, items, { depositAccountId, feeAccountId }) {
  const lines = items.map(({ g, landing, customerId }) => ({
    Amount: dollars(g.cents), DetailType: "DepositLineDetail", Description: describe(g),
    DepositLineDetail: { AccountRef: { value: String(landing.accountId) },
      ...(landing.classId ? { ClassRef: { value: String(landing.classId) } } : {}),
      Entity: { value: String(customerId), type: "Customer" } },
  }));
  const grossCents = items.reduce((t, x) => t + Number(x.g.cents), 0);
  const feeCents = items.reduce((t, x) => t + Number(x.g.fee_cents || 0), 0);
  if (feeCents > 0) {
    if (!feeAccountId) return { ok: false, sentence: "This payout carries processing fees and no fees account is chosen. Choose one in the mapping, then press Retry." };
    lines.push({ Amount: -dollars(feeCents), DetailType: "DepositLineDetail", Description: "Processing fees",
      DepositLineDetail: { AccountRef: { value: String(feeAccountId) } } });
  }
  const lineCents = lines.reduce((t, l) => t + Math.round(l.Amount * 100), 0);
  if (lineCents !== grossCents - feeCents)
    return { ok: false, sentence: "This deposit's lines do not come to the payout's net, so nothing was sent." };
  const date = items.map(x => String(x.g.deposited_on || x.g.date).slice(0, 10)).sort().pop();
  return { ok: true, netCents: grossCents - feeCents, body: {
    TxnDate: date, DepositToAccountRef: { value: String(depositAccountId) },
    PrivateNote: `Steward payout ${payoutRef}`, Line: lines } };
}

// ── THE CLAIM ─────────────────────────────────────────────────────────────
// The row is the guarantee. An INSERT that conflicts with a synced, skipped
// or freshly-sending row returns nothing, and nothing is sent.
async function claim(ctx, g, landing, txnType) {
  const [prior] = await query(
    `SELECT status, request_id, error_code FROM gift_bookkeeping_syncs WHERE org_id=? AND gift_id=? AND vendor=? AND realm_id=?`,
    [ctx.orgId, g.id, VENDOR, ctx.realmId]);
  const rows = await query(
    `INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,txn_type,
                                        account_id,class_id,amount_cents,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'sending',?,?,?,?,?,?)
     ON CONFLICT (org_id, gift_id, vendor, realm_id) DO UPDATE
        SET status='sending', attempts=gift_bookkeeping_syncs.attempts + 1, updated_at=NOW(),
            connection_id=EXCLUDED.connection_id, txn_type=EXCLUDED.txn_type,
            account_id=EXCLUDED.account_id, class_id=EXCLUDED.class_id, amount_cents=EXCLUDED.amount_cents
      WHERE gift_bookkeeping_syncs.status = 'failed'
         OR (gift_bookkeeping_syncs.status = 'sending'
             AND gift_bookkeeping_syncs.updated_at < NOW() - INTERVAL '${STALE_SENDING_MINUTES} minutes')
     RETURNING id`,
    ["gbs_" + uuid().slice(0, 12), ctx.orgId, g.id, VENDOR, ctx.connId, ctx.realmId, txnType,
     landing ? landing.accountId : null, landing ? landing.classId : null, Number(g.cents), ctx.who.id, ctx.who.name]);
  if (!rows.length) return null;
  // The request id an unknown outcome was sent under is kept: it is the only
  // way to ask QuickBooks "did that one land?" without making a second entry.
  const keepRid = prior && prior.error_code === "outcome_unknown" && prior.request_id ? prior.request_id : null;
  return { keepRid };
}
async function markFailed(ctx, giftIds, sentence, { code = null, requestId: rid = null, reached = false } = {}) {
  await run(
    `UPDATE gift_bookkeeping_syncs SET status='failed', error=?, error_code=?, request_id=COALESCE(?, request_id),
            reached_vendor = reached_vendor OR ?, updated_at=NOW()
      WHERE org_id=? AND vendor=? AND realm_id=? AND gift_id = ANY(?)`,
    [String(sentence).slice(0, 400), code, rid, reached, ctx.orgId, VENDOR, ctx.realmId, giftIds]);
}
async function markSynced(ctx, giftIds, { txnType, qboId, rid, customerIds = {} }) {
  for (const gid of giftIds) {
    await run(
      `UPDATE gift_bookkeeping_syncs SET status='synced', txn_type=?, qbo_id=?, request_id=?, customer_id=?,
              error=NULL, error_code=NULL, reached_vendor=true, synced_at=NOW(), updated_at=NOW()
        WHERE org_id=? AND vendor=? AND realm_id=? AND gift_id=?`,
      [txnType, String(qboId), rid, customerIds[gid] || null, ctx.orgId, VENDOR, ctx.realmId, gid]);
  }
}
// A gift that is not mapped is written as a failed row WITHOUT a call, so it
// stays in Pending with its sentence. A synced or skipped row is never
// overwritten by this.
async function noteUnsendable(ctx, g, sentence, code) {
  await run(
    `INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,error,error_code,
                                        amount_cents,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'failed',?,?,?,?,?)
     ON CONFLICT (org_id, gift_id, vendor, realm_id) DO UPDATE
        SET error=EXCLUDED.error, error_code=EXCLUDED.error_code, updated_at=NOW(),
            attempts=gift_bookkeeping_syncs.attempts + 1
      WHERE gift_bookkeeping_syncs.status = 'failed'`,
    ["gbs_" + uuid().slice(0, 12), ctx.orgId, g.id, VENDOR, ctx.connId, ctx.realmId, sentence, code,
     Number(g.cents), ctx.who.id, ctx.who.name]);
}
const codeOf = res => res.kind === "network" || res.kind === "server" ? "outcome_unknown"
  : res.kind === "auth" ? "auth" : String((((res.fault || {}).Error || [])[0] || {}).code || res.status || "fault");

// ── ONE GIFT AS A SALES RECEIPT ───────────────────────────────────────────
async function syncSalesReceipt(ctx, g) {
  const landing = landingFor(g, ctx.map);
  if (!landing.ok) {
    await noteUnsendable(ctx, g, landing.sentence, landing.problem);
    return { giftId: g.id, status: "needs_mapping", sentence: landing.sentence };
  }
  const claimed = await claim(ctx, g, landing, "SalesReceipt");
  if (!claimed) return { giftId: g.id, status: "already", sentence: "Already sent to QuickBooks, or being sent right now. Steward did not send it again." };
  const cctx = { accountName: landing.accountName, className: landing.className, date: String(g.date).slice(0, 10) };
  const fail = async (res, rid) => {
    const sentence = plainError(res, cctx);
    await markFailed(ctx, [g.id], sentence, { code: codeOf(res), requestId: rid, reached: !!rid });
    return { giftId: g.id, status: "failed", sentence };
  };
  const cust = await customerFor(ctx, g);
  if (!cust.ok) return fail(cust, null);
  const item = await itemFor(ctx, landing);
  if (!item.ok) return fail(item, null);
  const body = buildSalesReceipt(g, landing, { customerId: cust.id, itemId: item.id, depositAccountId: ctx.map.depositAccount.id });
  const rid = claimed.keepRid || requestId(ctx.orgId, ctx.realmId, "sr", g.id, body);
  const r = await qboCall(ctx, "POST", "salesreceipt", { body, params: { requestid: rid } });
  if (!r.ok) {
    // A customer QuickBooks no longer has is forgotten, so Retry finds or
    // makes it again rather than failing the same way forever.
    if (/customer/i.test(JSON.stringify(r.fault || {})) && /2500|610/.test(codeOf(r)))
      await run(`DELETE FROM bookkeeping_customers WHERE org_id=? AND vendor=? AND realm_id=? AND donor_id=?`,
        [ctx.orgId, VENDOR, ctx.realmId, g.donor_id]);
    return fail(r, rid);
  }
  const sr = r.body.SalesReceipt || {};
  if (!sr.Id) return fail({ kind: "server", status: 502 }, rid);
  await markSynced(ctx, [g.id], { txnType: "SalesReceipt", qboId: sr.Id, rid, customerIds: { [g.id]: cust.id } });
  return { giftId: g.id, status: "synced", qboId: String(sr.Id), link: txnLink("SalesReceipt", sr.Id),
           sentence: `Sent to QuickBooks as a sales receipt on ${landing.sentence}.` };
}

// ── ONE PAYOUT AS A DEPOSIT ───────────────────────────────────────────────
async function syncPayout(ctx, payoutRef, gifts) {
  const out = [];
  const ready = [];
  for (const g of gifts) {
    const landing = landingFor(g, ctx.map);
    if (!landing.ok) {
      await noteUnsendable(ctx, g, landing.sentence, landing.problem);
      out.push({ giftId: g.id, status: "needs_mapping", sentence: landing.sentence });
    } else ready.push({ g, landing });
  }
  // A deposit with a gift missing is a deposit that does not match the bank,
  // so one unmapped gift holds the whole payout back, and says so.
  if (out.length) {
    for (const { g } of ready) out.push({ giftId: g.id, status: "held",
      sentence: "Held with the rest of its payout: another gift in it needs a mapping first." });
    return out;
  }
  const claimed = [];
  for (const x of ready) {
    const c = await claim(ctx, x.g, x.landing, "Deposit");
    if (c) claimed.push({ ...x, keepRid: c.keepRid });
    else out.push({ giftId: x.g.id, status: "already", sentence: "Already sent to QuickBooks. Steward did not send it again." });
  }
  if (!claimed.length) return out;
  const ids = claimed.map(x => x.g.id);
  const failAll = async (res, rid, sentenceOverride) => {
    const sentence = sentenceOverride || plainError(res, { accountName: claimed[0].landing.accountName, date: String(claimed[0].g.date).slice(0, 10) });
    await markFailed(ctx, ids, sentence, { code: res ? codeOf(res) : "refused", requestId: rid, reached: !!rid });
    for (const id of ids) out.push({ giftId: id, status: "failed", sentence });
    return out;
  };
  const customerIds = {};
  for (const x of claimed) {
    const cust = await customerFor(ctx, x.g);
    if (!cust.ok) return failAll(cust, null);
    x.customerId = cust.id; customerIds[x.g.id] = cust.id;
  }
  const built = buildPayoutDeposit(payoutRef, claimed, { depositAccountId: ctx.map.depositAccount.id,
    feeAccountId: ctx.map.feeAccount ? ctx.map.feeAccount.id : null });
  if (!built.ok) return failAll(null, null, built.sentence);
  const rid = (claimed.find(x => x.keepRid) || {}).keepRid || requestId(ctx.orgId, ctx.realmId, "dep", payoutRef, built.body);
  const r = await qboCall(ctx, "POST", "deposit", { body: built.body, params: { requestid: rid } });
  if (!r.ok) return failAll(r, rid);
  const dep = r.body.Deposit || {};
  if (!dep.Id) return failAll({ kind: "server", status: 502 }, rid);
  await markSynced(ctx, ids, { txnType: "Deposit", qboId: dep.Id, rid, customerIds });
  for (const id of ids) out.push({ giftId: id, status: "synced", qboId: String(dep.Id), link: txnLink("Deposit", dep.Id),
    sentence: `Sent to QuickBooks in the deposit for payout ${payoutRef}.` });
  return out;
}

// ── THE RUN ───────────────────────────────────────────────────────────────
// `giftIds` null with `all` true is Sync all; otherwise only those gifts. The
// caller is a person (routes/finance.js) or the org's own auto-sync tick, and
// `who` is stamped on every row either way.
async function syncGifts({ orgId, giftIds = null, all = false, who, tokenFor, limit = RUN_LIMIT, runStartedAt = null }) {
  const refuse = (error, sentence, status = 409) => ({ ok: false, status, error, sentence });
  const [org] = await query(`SELECT id, is_demo_org, qbo_sync_enabled FROM orgs WHERE id=?`, [orgId]);
  if (!org || org.qbo_sync_enabled !== true)
    return refuse("not_enabled", "QuickBooks sync is not turned on for this organisation yet.", 403);
  const [conn] = await query(
    `SELECT * FROM bookkeeping_connections WHERE org_id=? AND vendor=? AND status <> 'disconnected'`, [orgId, VENDOR]);
  if (!conn) return refuse("not_connected", "QuickBooks is not connected. Connect it from this card, and nothing is sent until you press Sync.");
  const map = readMapping(conn);
  if (org.is_demo_org === true || map.demo)
    return refuse("demo", "This is the demonstration file's example connection. It shows what would be sent, and sends nothing.");
  if (!conn.credentials_sealed && process.env.TEST_MODE !== "1")
    return refuse("not_signed_in", "QuickBooks is not signed in yet. Connect it from this card, then press Sync.");
  if (!conn.realm_id) return refuse("no_company", "Steward does not know which QuickBooks company this is. Connect it again.");
  if (!all && !(Array.isArray(giftIds) && giftIds.length))
    return refuse("nothing_chosen", "Choose the gifts to send, or press Sync all.", 400);

  // ONE RUN PER ORG AT A TIME. A lease on the connection row, taken with a
  // conditional UPDATE, so a second press waits for nothing and holds no
  // database connection: it is told a run is already going.
  const lease = await query(
    `UPDATE bookkeeping_connections SET sync_lock_until = NOW() + INTERVAL '5 minutes'
      WHERE id=? AND org_id=? AND (sync_lock_until IS NULL OR sync_lock_until < NOW()) RETURNING id`, [conn.id, orgId]);
  if (!lease.length) return refuse("busy", "A sync is already running for this organisation. Steward did not start a second one; look again in a minute.");

  const ctx = { orgId, realmId: String(conn.realm_id), connId: conn.id, map, who,
                token: conn.credentials_sealed && tokenFor ? force => tokenFor(conn, force) : null };
  const results = [];
  let remaining = 0;
  const [{ now: runNow }] = await query(`SELECT NOW() AS now`, []);
  try {
    const since = startDateOf(conn, map);
    const wanted = all ? null : [...new Set(giftIds.map(String))].slice(0, 500);
    const q = pendingRowsSql(orgId, since, { giftIds: wanted });
    const cap = Math.max(1, Math.min(Number(limit) || RUN_LIMIT, 500));
    let pending = await query(q.sql, q.args);
    // FIX-20 Part 3 · SYNC ALL IN BATCHES. A press of Sync all is one RUN,
    // stamped with when it started, and the screen asks for the next batch
    // until nothing is left. A gift that failed during this run is not tried
    // again in it (it would otherwise be the first hundred rows of every
    // batch, forever); in deposit mode its whole payout is held back with it,
    // because a deposit with a gift missing does not match the bank.
    // The run's start is the SERVER's clock, handed back by the first batch
    // and echoed by the screen, so it is compared with times the same database
    // wrote. A continuing batch does not list the gifts still waiting for a
    // payout again; the first batch already said so.
    const continuing = !!(runStartedAt && !isNaN(new Date(runStartedAt)));
    const runStart = continuing ? new Date(runStartedAt) : runNow;
    const failedThisRun = g => runStart && g.sync_status === "failed" && g.sync_updated_at && new Date(g.sync_updated_at) >= runStart;
    if (!wanted && map.mode === "deposit") {
      const heldRefs = new Set(pending.filter(failedThisRun).map(g => g.deposit_ref).filter(Boolean));
      pending = pending.filter(g => !failedThisRun(g) && !(g.deposit_ref && heldRefs.has(g.deposit_ref)));
      // Whole payouts only: the batch takes payouts in order until it holds
      // the cap's worth of gifts, and never splits one across two batches.
      const order = [], byRef = new Map();
      for (const g of pending) {
        if (!g.deposit_ref) continue;
        if (!byRef.has(g.deposit_ref)) { byRef.set(g.deposit_ref, []); order.push(g.deposit_ref); }
        byRef.get(g.deposit_ref).push(g);
      }
      const take = new Set(); let n = 0;
      for (const ref of order) { if (n >= cap) break; take.add(ref); n += byRef.get(ref).length; }
      const waiting = continuing ? [] : pending.filter(g => !g.deposit_ref);
      remaining = order.filter(r => !take.has(r)).reduce((t, r) => t + byRef.get(r).length, 0);
      pending = [...pending.filter(g => g.deposit_ref && take.has(g.deposit_ref)), ...waiting];
    } else if (!wanted) {
      pending = pending.filter(g => !failedThisRun(g));
      remaining = Math.max(0, pending.length - cap);
      pending = pending.slice(0, cap);
    } else {
      pending = pending.slice(0, cap);
    }
    // A gift asked for by id and not pending says why, rather than vanishing.
    if (wanted) {
      const seen = new Set(pending.map(g => g.id));
      const missing = wanted.filter(id => !seen.has(id));
      if (missing.length) {
        const rows = await query(
          `SELECT g.id, s.status, s.qbo_id, s.txn_type FROM gifts g
             LEFT JOIN gift_bookkeeping_syncs s ON s.org_id=g.org_id AND s.gift_id=g.id AND s.vendor=? AND s.realm_id=?
            WHERE g.org_id=? AND g.id = ANY(?)`, [VENDOR, ctx.realmId, orgId, missing]);
        const byId = new Map(rows.map(r => [r.id, r]));
        for (const id of missing) {
          const r = byId.get(id);
          results.push(!r ? { giftId: id, status: "not_found", sentence: "Steward has no such gift in this organisation." }
            : r.status === "synced" ? { giftId: id, status: "already", qboId: r.qbo_id, link: txnLink(r.txn_type, r.qbo_id),
                sentence: "Already in QuickBooks. Steward did not send it again." }
            : r.status === "skipped" ? { giftId: id, status: "skipped", sentence: "Skipped. Put it back in Pending to send it." }
            : r.status === "sending" ? { giftId: id, status: "already", sentence: "Being sent right now. Steward did not send it twice." }
            : { giftId: id, status: "not_pending", sentence: "This gift is not one QuickBooks sync sends (it is before the start date, a refund, a sample, or not cash)." });
        }
      }
    }
    if (map.mode === "deposit") {
      const groups = new Map();
      // In deposit mode the unit is the payout: Sync on one gift sends its
      // whole payout, so the deposit equals what reached the bank.
      let pool_ = pending;
      if (wanted) {
        const refs = [...new Set(pending.map(g => g.deposit_ref).filter(Boolean))];
        if (refs.length) {
          const all_ = pendingRowsSql(orgId, since);
          pool_ = (await query(all_.sql, all_.args)).filter(g => refs.includes(g.deposit_ref) || wanted.includes(g.id));
        }
      }
      for (const g of pool_) {
        if (!g.deposit_ref) {
          results.push({ giftId: g.id, status: "waiting", sentence: "Waiting for its payout: a deposit is made when the gift is matched to the payout it arrived in." });
          continue;
        }
        if (!groups.has(g.deposit_ref)) groups.set(g.deposit_ref, []);
        groups.get(g.deposit_ref).push(g);
      }
      for (const [refKey, gs] of groups) results.push(...await syncPayout(ctx, refKey, gs));
    } else {
      for (const g of pending) results.push(await syncSalesReceipt(ctx, g));
    }
  } finally {
    const [left] = await query(
      `SELECT COUNT(*)::int AS n FROM gift_bookkeeping_syncs WHERE org_id=? AND vendor=? AND realm_id=? AND status='failed'`, [orgId, VENDOR, ctx.realmId]);
    const nFailed = Number(left && left.n) || 0;
    await run(
      `UPDATE bookkeeping_connections SET sync_lock_until=NULL, last_sent_at=NOW(),
              last_error=?, last_error_at=CASE WHEN ? THEN NOW() ELSE last_error_at END, updated_at=NOW()
        WHERE id=? AND org_id=?`,
      [nFailed ? `${nFailed} ${nFailed === 1 ? "gift is" : "gifts are"} waiting in Pending with a problem to fix.` : null,
       nFailed > 0, conn.id, orgId]);
  }
  const count = s => results.filter(r => r.status === s).length;
  const synced = count("synced"), failed = count("failed") + count("needs_mapping"), already = count("already");
  return {
    ok: true, synced, failed, already, results, remaining,
    runStartedAt: runStartedAt && !isNaN(new Date(runStartedAt)) ? new Date(runStartedAt).toISOString() : new Date(runNow).toISOString(),
    batchSize: Math.max(1, Math.min(Number(limit) || RUN_LIMIT, 500)),
    sentence: !results.length ? "Nothing was waiting. Every gift in Pending is already in QuickBooks or skipped."
      : [synced ? `${synced} sent to QuickBooks` : null,
         failed ? `${failed} could not go yet and ${failed === 1 ? "stays" : "stay"} in Pending with the reason` : null,
         already ? `${already} already there, not sent again` : null].filter(Boolean).join("; ") + ".",
  };
}

// ── THE LISTS FOR THE MAPPING SCREEN ──────────────────────────────────────
// The real chart of accounts and classes, asked of the company itself, so
// staff choose from what exists rather than typing an id from memory.
async function fetchLists(ctx) {
  const a = await qboQuery(ctx, "select Id, Name, FullyQualifiedName, AccountType, AccountSubType, Active from Account where Active = true maxresults 1000");
  if (!a.ok) return { ok: false, sentence: plainError(a) };
  // A company with class tracking off answers the class query with nothing
  // or a refusal; either way there are simply no classes to offer.
  const c = await qboQuery(ctx, "select Id, Name, FullyQualifiedName, Active from Class where Active = true maxresults 1000");
  const accounts = (a.rows.Account || []).map(x => ({ id: String(x.Id), name: x.FullyQualifiedName || x.Name,
    type: x.AccountType || null, subType: x.AccountSubType || null }));
  const classes = c.ok ? (c.rows.Class || []).map(x => ({ id: String(x.Id), name: x.FullyQualifiedName || x.Name })) : [];
  const byName = (p, q2) => String(p.name).localeCompare(String(q2.name));
  return { ok: true, accounts: accounts.sort(byName), classes: classes.sort(byName),
    income: accounts.filter(x => /income/i.test(x.type || "")).sort(byName),
    deposit: accounts.filter(x => /^(bank|other current asset)$/i.test(x.type || "")).sort(byName),
    expense: accounts.filter(x => /expense|cost of goods/i.test(x.type || "")).sort(byName) };
}

module.exports = {
  VENDOR, NO_FUND, MINOR_VERSION, apiBase, environment, appHost, txnLink,
  RUN_LIMIT, readMapping, startDateOf, landingFor, pendingWhere, pendingRowsSql, plainError, requestId,
  buildSalesReceipt, buildPayoutDeposit, syncGifts, fetchLists, qboCall, qboQuery, safeName,
};

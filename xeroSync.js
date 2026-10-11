// xeroSync.js, CONNECT-2 Part 3. ONE GIFT, ONE XERO BANK TRANSACTION, AND
// NOTHING UNTIL A PERSON PRESSES SYNC.
//
// The same shape as qboSync.js, because the same promises hold: a gift is a
// bookkeeping entry for money that already arrived, it is sent once, and only
// a person (or the org admin's own auto-sync, once every fund is mapped) sends
// it. In Xero a gift is a RECEIVE BankTransaction: the money lands in the bank
// account the mapping names, on the income account its fund is mapped to,
// with the processing fee (when there is one) as a negative line on the fee
// account, so the transaction totals what reached the bank.
//
// ── ONCE, AND THE TWO BELTS THAT MAKE IT ONCE ─────────────────────────────
// 1. `gift_bookkeeping_syncs`, unique on (org, gift, vendor, tenant), claimed
//    BEFORE the call and kept whatever happened. A synced gift cannot be
//    claimed again, so pressing Sync twice sends nothing new. The Xero
//    organisation (the tenant id) is part of the key, as Intuit's company is.
// 2. Xero's `Idempotency-Key` header. A retry after an unknown outcome (a
//    timeout, a 5xx) carries the SAME key and Xero answers with the
//    transaction it already made. A retry after a definite refusal carries a
//    new key once the mapping changed, because the key is derived from the
//    payload.
//
// ── WHAT IS NEVER DONE ────────────────────────────────────────────────────
// Nothing here moves money. Nothing is sent from the demonstration org.
// Nothing is sent unauthenticated except to the local stand-in a test boot
// points at (TEST_MODE=1). Disconnecting deletes nothing, here or in Xero.
// Donor names go to Xero only if the organisation turned that on: otherwise
// every transaction carries one contact, "Donations via Steward".
"use strict";

const crypto = require("crypto");
const { query, run, uuid } = require("./db");
const { NON_CASH_TYPES } = require("./depositsFile");

const VENDOR = "xero";
const NO_FUND = "__none";
const STALE_SENDING_MINUTES = 10;
const RUN_LIMIT = 100;
const TXN_TYPE = "BankTransaction";
const GENERIC_CONTACT = "Donations via Steward";
const LIVE_TENANT_SQL = `(SELECT COALESCE(bc.realm_id, '') FROM bookkeeping_connections bc
     WHERE bc.org_id = g.org_id AND bc.vendor = '${VENDOR}' AND bc.status <> 'disconnected' LIMIT 1)`;
const NON_CASH_SQL = [...NON_CASH_TYPES].map(t => `'${String(t).replace(/'/g, "''")}'`).join(",");

// XERO_API_BASE is the stand-in seam (tests/connect2/xero.js). Unset in
// production, where Xero's own host wins.
function apiBase() {
  return String(process.env.XERO_API_BASE || "https://api.xero.com/api.xro/2.0").replace(/\/$/, "");
}
function txnLink(id) {
  return id ? `https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=${encodeURIComponent(id)}` : null;
}

// ── THE MAPPING ───────────────────────────────────────────────────────────
// Stored at bookkeeping_connections.mapping.xero. Accounts are referred to by
// CODE (income and fee accounts always have one in Xero) and the bank account
// by its AccountID, because Xero bank accounts often have no code at all.
const parseJson = v => { if (!v) return {}; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return {}; } };
const acct = v => (v && typeof v === "object" && (v.code || v.id))
  ? { code: v.code ? String(v.code).slice(0, 30) : null, id: v.id ? String(v.id).slice(0, 64) : null,
      name: v.name ? String(v.name).slice(0, 200) : null } : null;
function readMapping(connRow) {
  const m = parseJson(connRow && connRow.mapping);
  const x = (m && typeof m.xero === "object" && m.xero) || {};
  // A mapping chosen in one Xero organisation names that organisation's
  // accounts. Another organisation's "200" is some other account, so a
  // mapping from a different tenant is not used.
  const mappedTenant = x.tenantId ? String(x.tenantId) : null;
  const otherTenant = !!(mappedTenant && connRow && connRow.realm_id && mappedTenant !== String(connRow.realm_id));
  const funds = {};
  for (const [k, v] of Object.entries(x.funds && typeof x.funds === "object" ? x.funds : {})) {
    const a = acct(v);
    if (a && a.code) funds[k] = a;
  }
  return {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(x.startDate || "")) ? String(x.startDate) : null,
    bankAccount: otherTenant ? null : acct(x.bankAccount),
    feeAccount: otherTenant ? null : acct(x.feeAccount),
    funds: otherTenant ? {} : funds,
    tenantId: mappedTenant, tenantName: x.tenantName ? String(x.tenantName) : null, otherTenant,
  };
}
function startDateOf(connRow, map) {
  if (map.startDate) return map.startDate;
  const c = connRow && connRow.created_at ? new Date(connRow.created_at) : new Date();
  return (isNaN(c) ? new Date() : c).toISOString().slice(0, 10);
}

// ── WHERE ONE GIFT LANDS (pure) ───────────────────────────────────────────
function landingFor(g, map) {
  if (map.otherTenant)
    return { ok: false, problem: "other_tenant",
      sentence: "The mapping was chosen in a different Xero organisation. Choose this organisation's accounts in the mapping, then press Sync." };
  const fund = map.funds[g.fund_id || NO_FUND] || null;
  if (!fund) {
    const what = g.fund_id ? `The fund "${g.fund_name || g.fund_id}" has` : "Gifts with no fund named have";
    return { ok: false, problem: "unmapped", sentence: `${what} no Xero account yet. Choose one in the mapping, then press Sync.` };
  }
  if (!map.bankAccount)
    return { ok: false, problem: "no_bank_account",
      sentence: "No bank account is chosen yet, so Xero would not know where this money landed. Choose one in the mapping, then press Sync." };
  if (Number(g.fee_cents) > 0 && !(map.feeAccount && map.feeAccount.code))
    return { ok: false, problem: "no_fee_account",
      sentence: "This gift carries a processing fee and no fee account is chosen, so the transaction would not match the bank. Choose a fee account in the mapping, then press Sync." };
  return { ok: true, accountCode: fund.code, accountName: fund.name || fund.code,
           sentence: `${fund.name || fund.code} (${fund.code})` };
}

// ── WHAT IS STILL TO MAP ──────────────────────────────────────────────────
// A press of Sync may go once SOMETHING can land (a bank account and one
// fund). Auto-sync asks more: EVERY fund, including "No fund named".
async function mappingGaps(orgId, map) {
  const funds = await query(
    `SELECT id, name FROM fin_funds WHERE org_id=? AND COALESCE(is_sample,false)=false ORDER BY name`, [orgId]);
  const all = [...funds, { id: NO_FUND, name: "No fund named" }];
  const unmapped = all.filter(f => !map.funds[f.id]).map(f => f.name);
  const noBank = !map.bankAccount;
  const anyMapped = Object.keys(map.funds).length > 0;
  const canSync = !noBank && anyMapped && !map.otherTenant;
  if (!unmapped.length && !noBank) return { ok: !map.otherTenant, canSync, funds: [], bankAccount: true, sentence: null };
  const list = xs => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const parts = [];
  if (unmapped.length) parts.push(`a Xero account for ${list(unmapped.map(n => `"${n}"`))}`);
  if (noBank) parts.push("the bank account the money lands in");
  return { ok: false, canSync, funds: unmapped, bankAccount: !noBank,
    sentence: canSync
      ? `Choose ${parts.join(", and ")} in the mapping. Until then those gifts wait in Pending and auto-sync stays off.`
      : `Before anything is sent, choose ${parts.join(", and ")} in the mapping. Nothing has been sent.` };
}

// ── PENDING: THE ONE DEFINITION ───────────────────────────────────────────
// Real money only (not a sample, a refund, stock or in-kind), dated on or
// after the start date, with no sync row for this Xero organisation, a
// failed one, or one stuck mid-send.
function pendingRowsSql(orgId, since, { giftIds = null } = {}) {
  const args = [orgId, since];
  let where = `g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0
     AND COALESCE(g.is_sample, false) = false AND g.date >= ?
     AND LOWER(TRIM(COALESCE(g.type, ''))) NOT IN (${NON_CASH_SQL})
     AND (s.id IS NULL OR s.status = 'failed'
          OR (s.status = 'sending' AND s.updated_at < NOW() - INTERVAL '${STALE_SENDING_MINUTES} minutes'))`;
  if (giftIds) { where += ` AND g.id = ANY(?)`; args.push(giftIds); }
  return {
    sql: `SELECT g.id, g.donor_id, d.name AS donor_name, g.date,
                 ROUND(g.amount::numeric, 2) AS amount, ROUND(g.amount::numeric * 100)::bigint AS cents,
                 ROUND(COALESCE(g.processor_fee_amount, 0)::numeric * 100)::bigint AS fee_cents,
                 g.fund_id, f.name AS fund_name,
                 s.status AS sync_status, s.error AS sync_error, s.error_code AS sync_error_code,
                 s.request_id AS sync_request_id
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
            LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
            LEFT JOIN gift_bookkeeping_syncs s ON s.org_id = g.org_id AND s.gift_id = g.id AND s.vendor = '${VENDOR}'
                                               AND s.realm_id = ${LIVE_TENANT_SQL}
           WHERE ${where}
           ORDER BY g.date ASC, g.id ASC`,
    args,
  };
}

// ── TALKING TO XERO ───────────────────────────────────────────────────────
async function xeroCall(ctx, method, path, { body = null, idempotencyKey = null } = {}) {
  const url = apiBase() + path;
  const send = tok => fetch(url, {
    method,
    headers: { Accept: "application/json", "xero-tenant-id": ctx.tenantId,
               ...(body ? { "Content-Type": "application/json" } : {}),
               ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
    return { ok: false, kind: "network", unknown: true, message: e && e.message };
  }
  const json = await r.json().catch(() => null);
  if (r.ok && json) return { ok: true, status: r.status, body: json };
  if (r.status >= 500) console.error(`[xero] ${method} ${path} answered ${r.status}`);
  return { ok: false, status: r.status, kind: r.status >= 500 ? "server" : "fault", unknown: r.status >= 500, body: json };
}

// Xero's refusal, in words a person can act on beside a Sync button.
function plainError(res) {
  if (!res) return "Steward could not finish this one. Press Sync again.";
  if (res.kind === "auth")
    return res.sentence || "Xero needs signing in again. Connect it again from this card, then press Sync. Nothing already sent is affected.";
  if (res.kind === "network" || res.kind === "server")
    return "Xero did not answer cleanly, so Steward cannot tell whether it arrived. Sync sends the very same request again, and Xero will not record it twice.";
  if (res.status === 401 || res.status === 403)
    return "Xero refused Steward's sign-in. Connect Xero again from this card, then press Sync.";
  if (res.status === 429) return "Xero asked Steward to slow down. Wait a minute, then press Sync.";
  const b = res.body || {};
  const msgs = [];
  for (const el of (Array.isArray(b.Elements) ? b.Elements : []))
    for (const v of (Array.isArray(el.ValidationErrors) ? el.ValidationErrors : [])) if (v && v.Message) msgs.push(v.Message);
  const detail = String(msgs[0] || b.Message || b.Detail || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (/account code|account.*(not|in)valid|archived/i.test(detail))
    return `Xero will not take the account in the mapping: "${detail}". Choose another account, then press Sync.`;
  if (/lock|period/i.test(detail))
    return `The books are locked for this date in Xero: "${detail}". Ask your bookkeeper, or leave this gift in Pending.`;
  return `Xero did not accept this gift${detail ? `: "${detail}"` : ""}. Check the mapping, then press Sync.`;
}

// At most 128 characters (Xero's limit), tied to the payload.
function idempotencyKey(orgId, tenantId, giftId, payload) {
  const h = crypto.createHash("sha256")
    .update([orgId, tenantId, giftId, JSON.stringify(payload || null)].join("\u0000")).digest("hex");
  return `stw-xero-${h.slice(0, 48)}`;
}

const dollars = cents => Math.round(Number(cents) || 0) / 100;
function buildBankTransaction(g, landing, map, { donorNames = false } = {}) {
  const donor = donorNames && g.donor_name ? String(g.donor_name).replace(/\s+/g, " ").trim().slice(0, 200) : null;
  const fund = g.fund_name || "no fund named";
  const lines = [{
    Description: `Gift from ${donor || "a donor"}, ${fund}, via Steward`.slice(0, 4000),
    Quantity: 1, UnitAmount: dollars(g.cents), AccountCode: landing.accountCode,
  }];
  if (Number(g.fee_cents) > 0)
    lines.push({ Description: "Processing fee", Quantity: 1, UnitAmount: -dollars(g.fee_cents), AccountCode: map.feeAccount.code });
  return {
    Type: "RECEIVE",
    Contact: { Name: donor || GENERIC_CONTACT },
    BankAccount: map.bankAccount.id ? { AccountID: map.bankAccount.id } : { Code: map.bankAccount.code },
    Date: String(g.date instanceof Date ? g.date.toISOString() : g.date).slice(0, 10),
    Reference: String(g.id).slice(0, 255),
    LineAmountTypes: "NoTax",
    LineItems: lines,
  };
}

// ── THE CLAIM ─────────────────────────────────────────────────────────────
async function claim(ctx, g, landing) {
  const [prior] = await query(
    `SELECT status, request_id, error_code FROM gift_bookkeeping_syncs WHERE org_id=? AND gift_id=? AND vendor=? AND realm_id=?`,
    [ctx.orgId, g.id, VENDOR, ctx.tenantId]);
  const rows = await query(
    `INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,txn_type,
                                        account_id,amount_cents,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'sending',?,?,?,?,?)
     ON CONFLICT (org_id, gift_id, vendor, realm_id) DO UPDATE
        SET status='sending', attempts=gift_bookkeeping_syncs.attempts + 1, updated_at=NOW(),
            connection_id=EXCLUDED.connection_id, txn_type=EXCLUDED.txn_type,
            account_id=EXCLUDED.account_id, amount_cents=EXCLUDED.amount_cents
      WHERE gift_bookkeeping_syncs.status = 'failed'
         OR (gift_bookkeeping_syncs.status = 'sending'
             AND gift_bookkeeping_syncs.updated_at < NOW() - INTERVAL '${STALE_SENDING_MINUTES} minutes')
     RETURNING id`,
    ["gbs_" + uuid().slice(0, 12), ctx.orgId, g.id, VENDOR, ctx.connId, ctx.tenantId, TXN_TYPE,
     landing.accountCode, Number(g.cents), ctx.who.id, ctx.who.name]);
  if (!rows.length) return null;
  const keepKey = prior && prior.error_code === "outcome_unknown" && prior.request_id ? prior.request_id : null;
  return { keepKey };
}
async function markFailed(ctx, giftId, sentence, { code = null, key = null, reached = false } = {}) {
  await run(
    `UPDATE gift_bookkeeping_syncs SET status='failed', error=?, error_code=?, request_id=COALESCE(?, request_id),
            reached_vendor = reached_vendor OR ?, updated_at=NOW()
      WHERE org_id=? AND vendor=? AND realm_id=? AND gift_id=?`,
    [String(sentence).slice(0, 400), code, key, reached, ctx.orgId, VENDOR, ctx.tenantId, giftId]);
}
async function noteUnsendable(ctx, g, sentence, code) {
  await run(
    `INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,error,error_code,
                                        amount_cents,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'failed',?,?,?,?,?)
     ON CONFLICT (org_id, gift_id, vendor, realm_id) DO UPDATE
        SET error=EXCLUDED.error, error_code=EXCLUDED.error_code, updated_at=NOW(),
            attempts=gift_bookkeeping_syncs.attempts + 1
      WHERE gift_bookkeeping_syncs.status = 'failed'`,
    ["gbs_" + uuid().slice(0, 12), ctx.orgId, g.id, VENDOR, ctx.connId, ctx.tenantId, sentence, code,
     Number(g.cents), ctx.who.id, ctx.who.name]);
}

async function syncOne(ctx, g) {
  const landing = landingFor(g, ctx.map);
  if (!landing.ok) {
    await noteUnsendable(ctx, g, landing.sentence, landing.problem);
    return { giftId: g.id, status: "needs_mapping", sentence: landing.sentence };
  }
  const claimed = await claim(ctx, g, landing);
  if (!claimed) return { giftId: g.id, status: "already", sentence: "Already sent to Xero, or being sent right now. Steward did not send it again." };
  const txn = buildBankTransaction(g, landing, ctx.map, { donorNames: ctx.donorNames });
  const key = claimed.keepKey || idempotencyKey(ctx.orgId, ctx.tenantId, g.id, txn);
  const res = await xeroCall(ctx, "PUT", "/BankTransactions", { body: { BankTransactions: [txn] }, idempotencyKey: key });
  const made = res.ok && res.body && Array.isArray(res.body.BankTransactions) ? res.body.BankTransactions[0] : null;
  if (!made || !made.BankTransactionID || made.HasValidationErrors === true) {
    const failure = res.ok ? { kind: "fault", status: 400, body: { Elements: [made || {}] } } : res;
    const code = failure.kind === "network" || failure.kind === "server" ? "outcome_unknown"
      : failure.kind === "auth" ? "auth" : String(failure.status || "fault");
    const sentence = plainError(failure);
    await markFailed(ctx, g.id, sentence, { code, key, reached: failure.kind !== "network" && failure.kind !== "auth" });
    return { giftId: g.id, status: "failed", sentence };
  }
  await run(
    `UPDATE gift_bookkeeping_syncs SET status='synced', txn_type=?, qbo_id=?, request_id=?,
            error=NULL, error_code=NULL, reached_vendor=true, synced_at=NOW(), updated_at=NOW()
      WHERE org_id=? AND vendor=? AND realm_id=? AND gift_id=?`,
    [TXN_TYPE, String(made.BankTransactionID), key, ctx.orgId, VENDOR, ctx.tenantId, g.id]);
  return { giftId: g.id, status: "synced", xeroId: made.BankTransactionID, link: txnLink(made.BankTransactionID),
           sentence: `Sent to Xero on ${landing.sentence}.` };
}

// ── THE RUN ───────────────────────────────────────────────────────────────
async function connection(orgId) {
  const [c] = await query(
    `SELECT * FROM bookkeeping_connections WHERE org_id=? AND vendor=? AND status <> 'disconnected'`, [orgId, VENDOR]);
  return c || null;
}
async function syncGifts({ orgId, giftIds = null, all = false, who, tokenFor, limit = RUN_LIMIT, everyFundMapped = false }) {
  const refuse = (error, sentence, status = 409) => ({ ok: false, status, error, sentence });
  const [org] = await query(`SELECT id, is_demo_org FROM orgs WHERE id=?`, [orgId]);
  if (!org) return refuse("not_found", "Steward has no such organisation.", 404);
  const conn = await connection(orgId);
  if (!conn) return refuse("not_connected", "Xero is not connected. Connect it from this card, and nothing is sent until you press Sync.");
  if (org.is_demo_org === true)
    return refuse("demo", "This is the demonstration file. It sends nothing to Xero.");
  if (!conn.credentials_sealed && process.env.TEST_MODE !== "1")
    return refuse("not_signed_in", "Xero is not signed in yet. Connect it from this card, then press Sync.");
  if (!conn.realm_id) return refuse("no_tenant", "Steward does not know which Xero organisation to send to yet. Choose it on this card first.");
  if (!all && !(Array.isArray(giftIds) && giftIds.length))
    return refuse("nothing_chosen", "Choose the gifts to send, or press Sync all.", 400);
  const map = readMapping(conn);
  const gaps = await mappingGaps(orgId, map);
  if (!gaps.ok && (everyFundMapped || !gaps.canSync)) return refuse("needs_mapping", gaps.sentence);

  const lease = await query(
    `UPDATE bookkeeping_connections SET sync_lock_until = NOW() + INTERVAL '5 minutes'
      WHERE id=? AND org_id=? AND (sync_lock_until IS NULL OR sync_lock_until < NOW()) RETURNING id`, [conn.id, orgId]);
  if (!lease.length) return refuse("busy", "A Xero sync is already running for this organisation. Steward did not start a second one; look again in a minute.");

  const ctx = { orgId, tenantId: String(conn.realm_id), connId: conn.id, map, who, donorNames: conn.donor_names === true,
                token: conn.credentials_sealed && tokenFor ? force => tokenFor(conn, force) : null };
  const results = [];
  let remaining = 0;
  try {
    const since = startDateOf(conn, map);
    const wanted = all ? null : [...new Set(giftIds.map(String))].slice(0, 500);
    const q = pendingRowsSql(orgId, since, { giftIds: wanted });
    const cap = Math.max(1, Math.min(Number(limit) || RUN_LIMIT, 500));
    let pending = await query(q.sql, q.args);
    remaining = Math.max(0, pending.length - cap);
    pending = pending.slice(0, cap);
    if (wanted) {
      const seen = new Set(pending.map(g => g.id));
      for (const id of wanted.filter(x => !seen.has(x))) {
        const [r] = await query(
          `SELECT g.id, s.status FROM gifts g
             LEFT JOIN gift_bookkeeping_syncs s ON s.org_id=g.org_id AND s.gift_id=g.id AND s.vendor=? AND s.realm_id=?
            WHERE g.org_id=? AND g.id=?`, [VENDOR, ctx.tenantId, orgId, id]);
        results.push(!r ? { giftId: id, status: "not_found", sentence: "Steward has no such gift in this organisation." }
          : r.status === "synced" || r.status === "sending" ? { giftId: id, status: "already", sentence: "Already in Xero. Steward did not send it again." }
          : { giftId: id, status: "not_pending", sentence: "This gift is not one Xero sync sends (it is before the start date, a refund, a sample, or not cash)." });
      }
    }
    for (const g of pending) results.push(await syncOne(ctx, g));
  } finally {
    const sentNow = results.some(r => r.status === "synced");
    const [left] = await query(
      `SELECT COUNT(*)::int AS n FROM gift_bookkeeping_syncs WHERE org_id=? AND vendor=? AND realm_id=? AND status='failed'`,
      [orgId, VENDOR, ctx.tenantId]);
    const nFailed = Number(left && left.n) || 0;
    await run(
      `UPDATE bookkeeping_connections SET sync_lock_until=NULL,
              last_sent_at=CASE WHEN ? THEN NOW() ELSE last_sent_at END,
              last_error=?, last_error_at=CASE WHEN ? THEN NOW() ELSE last_error_at END, updated_at=NOW()
        WHERE id=? AND org_id=?`,
      [sentNow, nFailed ? `${nFailed} ${nFailed === 1 ? "gift is" : "gifts are"} waiting in Pending with a problem to fix.` : null,
       nFailed > 0, conn.id, orgId]);
  }
  const count = s => results.filter(r => r.status === s).length;
  const synced = count("synced"), failed = count("failed") + count("needs_mapping"), already = count("already");
  return {
    ok: true, synced, failed, already, results, remaining,
    sentence: !results.length ? "Nothing was waiting. Every gift in Pending is already in Xero."
      : [synced ? `${synced} sent to Xero` : null,
         failed ? `${failed} could not go yet and ${failed === 1 ? "stays" : "stay"} in Pending with the reason` : null,
         already ? `${already} already there, not sent again` : null].filter(Boolean).join("; ") + ".",
  };
}

// WHAT WAS SENT: the one count the card and the panel both read.
async function sentSummary(orgId, tenantId) {
  const [r] = await query(
    `SELECT COUNT(*)::int AS gifts, COALESCE(SUM(amount_cents), 0)::bigint AS cents, MAX(synced_at) AS last_at
       FROM gift_bookkeeping_syncs WHERE org_id=? AND vendor=? AND realm_id=? AND status='synced'`,
    [orgId, VENDOR, String(tenantId || "")]);
  return { gifts: Number(r && r.gifts) || 0, cents: Number(r && r.cents) || 0, lastAt: (r && r.last_at) || null };
}

// READ FROM XERO. The organisation's name proves the connection points at the
// right books; its accounts fill the mapping's lists. Reads only.
async function fetchPreview(ctx) {
  const o = await xeroCall(ctx, "GET", "/Organisation");
  if (!o.ok) return { ok: false, sentence: plainError(o) };
  const org = (o.body && Array.isArray(o.body.Organisations) && o.body.Organisations[0]) || {};
  const a = await xeroCall(ctx, "GET", "/Accounts");
  if (!a.ok) return { ok: false, sentence: plainError(a) };
  const live = (a.body && Array.isArray(a.body.Accounts) ? a.body.Accounts : [])
    .filter(x => String(x.Status || "ACTIVE").toUpperCase() === "ACTIVE");
  const shape = x => ({ id: x.AccountID || null, code: x.Code || null, name: x.Name || x.Code || "", type: x.Type || null });
  const income = live.filter(x => String(x.Class || "").toUpperCase() === "REVENUE" && x.Code).map(shape);
  const bank = live.filter(x => String(x.Type || "").toUpperCase() === "BANK").map(shape);
  const expense = live.filter(x => String(x.Class || "").toUpperCase() === "EXPENSE" && x.Code).map(shape);
  return { ok: true, organisation: { name: org.Name || null, id: org.OrganisationID || null }, income, bank, expense };
}

module.exports = {
  VENDOR, NO_FUND, RUN_LIMIT, GENERIC_CONTACT,
  apiBase, txnLink, readMapping, startDateOf, landingFor, mappingGaps, pendingRowsSql,
  buildBankTransaction, idempotencyKey, plainError, connection, syncGifts, sentSummary, fetchPreview,
};

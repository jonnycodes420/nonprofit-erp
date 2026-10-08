// tests/parity2-qbo-sync.test.js, PARITY-2 Part 5. THE ONE GUARD THIS PART EARNED.
//
//     A GIFT ON A MAPPED FUND BECOMES EXACTLY ONE SALES RECEIPT IN QUICKBOOKS,
//     ON THE MAPPED ACCOUNT AND CLASS. SYNCING IT AGAIN CREATES NOTHING. A GIFT
//     ON AN UNMAPPED FUND STAYS IN PENDING WITH A PLAIN SENTENCE.
//
// Two receipts for one gift double a nonprofit's recorded income in its own
// books, and nothing on any screen shows it until somebody reconciles against
// the bank. A gift posted to a default account instead of the one its fund
// maps to is restricted money in the wrong place. Both are money, both are the
// org's books, and both are what this guards.
//
// QUICKBOOKS IS A LOCAL STUB on BOOKKEEPING_MOCK_PORT (the port the server's
// INTUIT_API_BASE names: :5632 in the run-all.sh recipe, api+5 in a shard).
// It speaks the shapes of Intuit's v3 API that Steward uses (query, customer,
// item, salesreceipt) and DOES NOT honour `requestid`: if it forgave a second
// POST, this suite would be testing the stub's manners rather than Steward's
// guarantee. A stub proves Steward's arithmetic and its once-only rule, not
// Intuit's boundary; that is what the sandbox walk in
// docs/integrations/quickbooks.md is for.
//
// WHAT IS ASSERTED:
//   §0  the server reaches the stub, and the mapping lists come from it
//   §1  Pending lists both gifts, and its total foots to its rows to the cent
//   §2  Sync on the mapped gift creates ONE sales receipt, on the mapped
//       account (through its item) and the mapped class, for the right amount
//   §3  the gift keeps the QuickBooks id and a link out, and leaves Pending
//   §4  syncing it again, by id and by Sync all, creates nothing new
//   §5  five simultaneous Sync alls on a new gift create one receipt, and the
//       same donor is ONE customer, not two
//   §6  the unmapped gift is never sent and stays in Pending with a plain
//       sentence naming the fund
//   §7  FIX-20: in deposit-per-payout mode, one payout of two gifts is ONE
//       deposit, its lines foot to the payout's net with the fee as one
//       negative line, and syncing again (all, and by id) sends nothing new.
//       Planted 2026-10-03: letting Pending and the claim take a synced row
//       again sent three deposits for one payout, and §7 went red.
//   §8  INT-PROD-1: "What Steward can see" reads the company's name and its
//       latest customers and payments, and sends QuickBooks nothing. Planted
//       2026-10-07: a POST inside fetchPreview turned §8 red.
//
// HOW IT WOULD GO RED, each one planted and watched (2026-10-02):
//   · the once-only rule has TWO belts, the Pending filter (a synced gift is
//     not pending) and the claim (a synced row cannot be re-claimed). Either
//     alone keeps this green, which is the point of having two; removing both
//     turned §3 and §4 red, with three receipts for two gifts.
//   · dropping ClassRef from the line turned §2 red.
//   · letting an unmapped fund fall through to the first mapped account turned
//     §4 and §6 red: the Roof Appeal gift went to QuickBooks as Donations.
//
// Standard scratch stack (tests/README.md) booted with TEST_MODE=1, plus the
// stub this file starts.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_p2qbo";
const ADMIN = "p2qbo-admin@example.org";
const CONN = "bkc_p2qbo";
const REALM = "9341452998765432";
const STUB_PORT = Number(process.env.BOOKKEEPING_MOCK_PORT || 5632);
const SINCE = "2026-09-01";
const ACCT_DONATIONS = "81", ACCT_PROGRAMS = "82", ACCT_BANK = "35", CLASS_YOUTH = "5000000000000071234";

// ── THE STUB ───────────────────────────────────────────────────────────────
const store = { customers: [], items: [], receipts: [], requestIds: [], deposits: [], writes: [] };
const COMPANY = "Ridgeview Pantry Books";
const PAYMENTS = [{ Id: "7001", TxnDate: "2026-10-01", TotalAmt: 125.5, CustomerRef: { value: "1", name: "Ada Okafor" } }];
const ACCOUNTS = [
  { Id: ACCT_DONATIONS, Name: "Donations", FullyQualifiedName: "Donations", AccountType: "Income", Active: true },
  { Id: ACCT_PROGRAMS, Name: "Program Income", FullyQualifiedName: "Program Income", AccountType: "Income", Active: true },
  { Id: ACCT_BANK, Name: "Checking", FullyQualifiedName: "Checking", AccountType: "Bank", Active: true },
];
const CLASSES = [{ Id: CLASS_YOUTH, Name: "Youth Arts", FullyQualifiedName: "Youth Arts", Active: true }];
const unq = s => String(s).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
function runQuery(stmt) {
  let m;
  if (/^select count\(\*\) from Customer/i.test(stmt)) return { totalCount: store.customers.length };
  if (/^select count\(\*\) from Payment/i.test(stmt)) return { totalCount: PAYMENTS.length };
  if (/from Payment/i.test(stmt)) return { Payment: PAYMENTS };
  if (/from Customer orderby/i.test(stmt)) return { Customer: store.customers.slice(0, 5) };
  if (/from Account/i.test(stmt)) return { Account: ACCOUNTS };
  if (/from Class/i.test(stmt)) return { Class: CLASSES };
  if ((m = stmt.match(/from Customer where PrimaryEmailAddr = '((?:[^'\\]|\\.)*)'/i)))
    return { Customer: store.customers.filter(c => c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address === unq(m[1])) };
  if ((m = stmt.match(/from Customer where DisplayName = '((?:[^'\\]|\\.)*)'/i)))
    return { Customer: store.customers.filter(c => c.DisplayName === unq(m[1])) };
  if ((m = stmt.match(/from Item where Name = '((?:[^'\\]|\\.)*)'/i)))
    return { Item: store.items.filter(i => i.Name === unq(m[1])) };
  return {};
}
let stub;
function startStub() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const u = new URL(req.url, "http://stub");
        if (req.method !== "GET") store.writes.push(req.method + " " + u.pathname);
        if (req.method === "GET" && u.pathname === `/v3/company/${REALM}/companyinfo/${REALM}`) {
          res.end(JSON.stringify({ CompanyInfo: { CompanyName: COMPANY, Country: "US" } })); return;
        }
        const m = u.pathname.match(/^\/v3\/company\/([^/]+)\/(query|customer|item|salesreceipt|deposit)$/);
        if (!m || m[1] !== REALM) { res.statusCode = 404; res.end(JSON.stringify({ Fault: { Error: [{ code: "404", Message: "not here" }] } })); return; }
        const kind = m[2];
        if (req.method === "GET" && kind === "query") {
          res.end(JSON.stringify({ QueryResponse: runQuery(u.searchParams.get("query") || ""), time: new Date().toISOString() }));
          return;
        }
        let body = {}; try { body = JSON.parse(b || "{}"); } catch { /* the stub is not under test */ }
        if (req.method === "POST" && kind === "customer") {
          const c = { ...body, Id: String(100 + store.customers.length) };
          store.customers.push(c); res.end(JSON.stringify({ Customer: c })); return;
        }
        if (req.method === "POST" && kind === "item") {
          const it = { ...body, Id: String(200 + store.items.length) };
          store.items.push(it); res.end(JSON.stringify({ Item: it })); return;
        }
        if (req.method === "POST" && kind === "salesreceipt") {
          // NO requestid dedupe, deliberately. Every POST is a new receipt.
          const sr = { ...body, Id: String(1000 + store.receipts.length) };
          store.receipts.push(sr); store.requestIds.push(u.searchParams.get("requestid"));
          res.end(JSON.stringify({ SalesReceipt: sr })); return;
        }
        if (req.method === "POST" && kind === "deposit") {
          // NO requestid dedupe here either.
          const dep = { ...body, Id: String(5000 + store.deposits.length) };
          store.deposits.push(dep); res.end(JSON.stringify({ Deposit: dep })); return;
        }
        res.statusCode = 400; res.end(JSON.stringify({ Fault: { Error: [{ code: "2020", Message: "unsupported" }] } }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STUB_PORT, () => resolve(srv));
  });
}

const MAPPING = { qbo: {
  mode: "salesreceipt", startDate: SINCE,
  depositAccount: { id: ACCT_BANK, name: "Checking" },
  funds: { fnd_p2_youth: { accountId: ACCT_DONATIONS, accountName: "Donations", classId: CLASS_YOUTH, className: "Youth Arts" } },
  campaigns: {},
} };

async function reset() {
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_customers", "bookkeeping_deposits", "bookkeeping_connections",
                   "gifts", "donors", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled)
           VALUES ($1,'Parity Two Books','parity-two-books',1,'active','team',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_p2qbo',$1,$2,$3,'Parity Books Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_p2_youth',$1,'Youth Arts',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_p2_roof',$1,'Roof Appeal',true)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_p2_wren',$1,'Wren O''Callaghan','wren@example.org')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_p2_ash',$1,'Ash Pemberton','ash@example.org')`, [ORG]);
  const gift = (id, donor, fund, amount, date) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method) VALUES ($1,$2,$3,$4,$5,'online',$6,'card')`,
    [id, ORG, donor, amount, date, fund]);
  await gift("g_p2_mapped", "d_p2_wren", "fnd_p2_youth", 125.5, "2026-09-12");
  await gift("g_p2_unmapped", "d_p2_ash", "fnd_p2_roof", 40, "2026-09-14");
  await gift("g_p2_before", "d_p2_ash", "fnd_p2_youth", 999, "2026-08-01");   // before the start date
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ($1,$2,'quickbooks','active',$3,$4::jsonb,'system:test','p2 qbo suite')`,
    [CONN, ORG, REALM, JSON.stringify(MAPPING)]);
  for (const k of Object.keys(store)) store[k].length = 0;
}

const pending = tok => api("GET", "/qbo/pending", tok);
const sync = (tok, body) => api("POST", "/qbo/sync", tok, body);

(async () => {
  console.log("PARITY-2 Part 5: a mapped gift is one sales receipt, once; an unmapped one waits and says why\n");
  stub = await startStub();
  ok("the QuickBooks stub is listening (without it this suite proves nothing)", !!stub, STUB_PORT);
  await reset();
  const tok = await login(ADMIN);

  // ── §0 · THE SERVER REACHES THE STUB ────────────────────────────────────
  const lists = await api("POST", "/qbo/lists", tok);
  const reachable = lists.status === 200 && (lists.body?.income || []).some(a => a.id === ACCT_DONATIONS);
  ok("§0 the server reaches the stub and the mapping lists are QuickBooks' own accounts (INTUIT_API_BASE and TEST_MODE are set on the server)",
     reachable, { status: lists.status, body: lists.body });
  if (!reachable) { await closeDb(); if (stub) stub.close(); summary(); return; }
  ok("§0 …with the classes too", (lists.body.classes || []).some(c => c.id === CLASS_YOUTH), lists.body.classes);

  // ── §8 · WHAT STEWARD CAN SEE, AND IT SENDS NOTHING ────────────────────
  const writes0 = store.writes.length;
  const seen = await api("POST", "/qbo/preview", tok);
  ok("§8 the preview names the connected company", seen.status === 200 && seen.body?.company?.name === COMPANY, seen.body);
  ok("§8 …with its payments read from QuickBooks", seen.body?.paymentCount === 1 && seen.body?.payments?.[0]?.amount === 125.5
     && seen.body?.payments?.[0]?.customer === "Ada Okafor", seen.body);
  ok("§8 …and QuickBooks received no write at all", store.writes.length === writes0, store.writes.slice(writes0));
  ok("§8 …and says so in its sentence", /nothing was sent to QuickBooks/i.test(seen.body?.sentence || ""), seen.body?.sentence);

  // ── §1 · PENDING, AND ITS TOTAL FOOTS ───────────────────────────────────
  const p1 = await pending(tok);
  const ids1 = (p1.body?.rows || []).map(r => r.giftId).sort();
  ok("§1 Pending lists the two gifts since the start date, and not the one before it",
     JSON.stringify(ids1) === JSON.stringify(["g_p2_mapped", "g_p2_unmapped"]), ids1);
  ok("§1 the Pending total is 16550 cents", p1.body?.total?.cents === 16550, p1.body?.total);
  const fig = await api("GET", `/figures/qbo-pending/rows?since=${SINCE}`, tok);
  const rowCents = (fig.body?.rows || []).reduce((t, r) => t + Math.round(Number(r.amount) * 100), 0);
  ok("§1 …and the rows behind that figure foot to it to the cent",
     fig.status === 200 && fig.body?.cents === 16550 && rowCents === 16550 && fig.body?.totalRows === 2,
     { status: fig.status, cents: fig.body?.cents, rowCents, n: fig.body?.totalRows });
  const mappedRow = (p1.body?.rows || []).find(r => r.giftId === "g_p2_mapped");
  ok("§1 each row says where it will land", /Donations, class Youth Arts/.test(mappedRow?.lands || ""), mappedRow);

  // ── §2 · ONE SYNC, ONE SALES RECEIPT, ON THE MAPPED ACCOUNT AND CLASS ───
  const s1 = await sync(tok, { giftIds: ["g_p2_mapped"] });
  ok("§2 Sync answers that one gift was sent", s1.status === 200 && s1.body?.synced === 1, s1.body);
  ok("§2 QuickBooks has exactly one sales receipt", store.receipts.length === 1, store.receipts.length);
  const sr = store.receipts[0] || {};
  const line = (sr.Line || [])[0] || {};
  const item = store.items.find(i => i.Id === line.SalesItemLineDetail?.ItemRef?.value);
  ok("§2 …whose line's item posts to the MAPPED income account",
     item && item.IncomeAccountRef?.value === ACCT_DONATIONS, { item, line });
  ok("§2 …with the MAPPED class on the line", line.SalesItemLineDetail?.ClassRef?.value === CLASS_YOUTH, line);
  ok("§2 …for the gift's amount, 125.50", line.Amount === 125.5 && (sr.Line || []).length === 1, sr.Line);
  ok("§2 …deposited to the mapped account", sr.DepositToAccountRef?.value === ACCT_BANK, sr.DepositToAccountRef);
  ok("§2 …dated the gift's day", sr.TxnDate === "2026-09-12", sr.TxnDate);
  const wren = store.customers.find(c => c.Id === sr.CustomerRef?.value);
  ok("§2 …with the donor as the customer, apostrophe and all", wren && wren.DisplayName === "Wren O'Callaghan", wren);
  ok("§2 …carrying a request id QuickBooks can deduplicate on", /^stw-sr-[0-9a-f]{40}$/.test(store.requestIds[0] || ""), store.requestIds);

  // ── §3 · THE GIFT KEEPS THE RESULT ──────────────────────────────────────
  const [row] = await q(`SELECT status, qbo_id, txn_type, created_by FROM gift_bookkeeping_syncs WHERE org_id=$1 AND gift_id='g_p2_mapped'`, [ORG]);
  ok("§3 the gift's sync row is synced with QuickBooks' id and the person who pressed Sync",
     row && row.status === "synced" && row.qbo_id === sr.Id && row.txn_type === "SalesReceipt" && row.created_by === "u_p2qbo", row);
  const p2 = await pending(tok);
  ok("§3 the gift has left Pending", !(p2.body?.rows || []).some(r => r.giftId === "g_p2_mapped"), p2.body?.rows);
  const recent = (p2.body?.recent || []).find(r => r.giftId === "g_p2_mapped");
  ok("§3 …and is listed as sent, with a link to the receipt in QuickBooks",
     recent && recent.link === `https://app.sandbox.qbo.intuit.com/app/salesreceipt?txnId=${sr.Id}`, recent);

  // ── §4 · AGAIN, AND NOTHING NEW ─────────────────────────────────────────
  const again = await sync(tok, { giftIds: ["g_p2_mapped"] });
  ok("§4 syncing the same gift again reports it as already there", again.status === 200 && again.body?.synced === 0
     && (again.body?.results || []).some(r => r.giftId === "g_p2_mapped" && r.status === "already"), again.body);
  const all = await sync(tok, { all: true });
  ok("§4 Sync all does not send it either", all.status === 200 && !(all.body?.results || []).some(r => r.giftId === "g_p2_mapped"), all.body);
  ok("§4 …AND QUICKBOOKS STILL HAS EXACTLY ONE SALES RECEIPT", store.receipts.length === 1, store.receipts.map(r => r.Id));

  // ── §5 · FIVE AT ONCE, AND ONE CUSTOMER PER DONOR ───────────────────────
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_p2_second',$1,'d_p2_wren',60,'2026-09-20','online','fnd_p2_youth','card')`, [ORG]);
  const burst = await Promise.all(Array.from({ length: 5 }, () => sync(tok, { all: true })));
  const forSecond = store.receipts.filter(r => r.PrivateNote === "Steward gift g_p2_second");
  ok("§5 five simultaneous Sync alls create ONE receipt for the new gift", forSecond.length === 1,
     { receipts: forSecond.length, answers: burst.map(b => b.status + ":" + (b.body?.error || b.body?.synced)) });
  ok("§5 …and the same donor is one QuickBooks customer, not two",
     store.customers.filter(c => c.DisplayName === "Wren O'Callaghan").length === 1, store.customers);

  // ── §6 · THE UNMAPPED FUND WAITS, AND SAYS WHY ──────────────────────────
  ok("§6 nothing was ever sent for the unmapped gift",
     !store.receipts.some(r => r.PrivateNote === "Steward gift g_p2_unmapped"), store.receipts.map(r => r.PrivateNote));
  const p3 = await pending(tok);
  const un = (p3.body?.rows || []).find(r => r.giftId === "g_p2_unmapped");
  ok("§6 it is still in Pending", !!un, p3.body?.rows);
  ok("§6 …with a plain sentence that names the fund and what to do",
     un && /the fund "Roof Appeal" has no QuickBooks account yet/i.test(un.problem || "") && /Retry/.test(un.problem || ""), un);
  ok("§6 …and no code, status or jargon in it", un && !/\b(fault|error code|4\d\d|5\d\d|null|undefined)\b/i.test(un.problem || ""), un?.problem);
  const unSync = await sync(tok, { giftIds: ["g_p2_unmapped"] });
  ok("§6 pressing Sync on it answers the same sentence and sends nothing",
     (unSync.body?.results || []).some(r => r.giftId === "g_p2_unmapped" && r.status === "needs_mapping" && /Roof Appeal/.test(r.sentence))
     && !store.receipts.some(r => r.PrivateNote === "Steward gift g_p2_unmapped"), unSync.body);

  // ── §7 · DEPOSIT PER PAYOUT: ONE PAYOUT, ONE DEPOSIT, ONCE ─────────────
  await q(`UPDATE bookkeeping_connections SET mapping = jsonb_set(mapping, '{qbo}',
             (mapping->'qbo') || '{"mode":"deposit","feeAccount":{"id":"90","name":"Bank fees"}}'::jsonb) WHERE id=$1`, [CONN]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,deposit_ref,deposited_on,processor_fee_amount)
           VALUES ('g_p2_po_a',$1,'d_p2_wren',50,'2026-09-21','online','fnd_p2_youth','card','po_p2_1','2026-09-23',1.75),
                  ('g_p2_po_b',$1,'d_p2_ash',30.25,'2026-09-22','online','fnd_p2_youth','card','po_p2_1','2026-09-23',1.18)`, [ORG]);
  const dep1 = await sync(tok, { all: true });
  ok("§7 Sync all in deposit mode sends the payout's two gifts", dep1.status === 200
     && (dep1.body?.results || []).filter(r => /^g_p2_po_/.test(r.giftId) && r.status === "synced").length === 2, dep1.body);
  ok("§7 QuickBooks has exactly ONE deposit", store.deposits.length === 1, store.deposits.length);
  const d0 = store.deposits[0] || {};
  const dLines = d0.Line || [];
  const dCents = dLines.reduce((t, l) => t + Math.round(l.Amount * 100), 0);
  ok("§7 …of two gift lines and one fee line, footing to the net 7732 cents (8025 less 293 in fees)",
     dLines.length === 3 && dCents === 7732 && dLines.filter(l => l.Amount < 0).length === 1
       && Math.round(dLines.find(l => l.Amount < 0).Amount * 100) === -293, dLines);
  ok("§7 …dated the day the payout landed, into the mapped bank account",
     d0.TxnDate === "2026-09-23" && d0.DepositToAccountRef?.value === ACCT_BANK, { date: d0.TxnDate, acct: d0.DepositToAccountRef });
  await sync(tok, { all: true });
  await sync(tok, { giftIds: ["g_p2_po_a"] });
  ok("§7 syncing again, all and by id, sends NO second deposit", store.deposits.length === 1, store.deposits.length);
  const [{ n: depRows }] = await q(`SELECT COUNT(*)::int AS n FROM gift_bookkeeping_syncs WHERE org_id=$1 AND gift_id IN ('g_p2_po_a','g_p2_po_b')
                                    AND status='synced' AND txn_type='Deposit' AND qbo_id=$2`, [ORG, d0.Id]);
  ok("§7 …and both gifts keep the one deposit's id", depRows === 2, depRows);

  await reset();
  for (const t of ["fin_funds", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM bookkeeping_connections WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if (stub) stub.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (stub) stub.close(); process.exit(1); });

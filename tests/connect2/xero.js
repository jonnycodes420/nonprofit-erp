// tests/connect2/xero.js, CONNECT-2 Part 3. A GIFT GOES TO XERO ONCE, AND
// ONLY WHEN EVERY PLACE IT COULD LAND HAS BEEN CHOSEN.
//
// Run by tests/connect2-sources.test.js, or alone. Against a stand-in for
// Xero's accounting API (nobody real is contacted; XERO_API_BASE points the
// server at XERO_MOCK_PORT, which tests/shard.sh already sets per shard).
//
// WHAT IS ASSERTED:
//   §X1 with a fund unmapped, Sync is refused, auto-sync cannot be turned on,
//       and Xero receives NO request at all
//   §X2 "Read from Xero" returns the organisation's name and its accounts
//   §X3 every fund mapped: one Sync sends exactly ONE RECEIVE bank
//       transaction, gross on the fund's account, the fee as a negative line,
//       into the chosen bank account, with an Idempotency-Key and the tenant
//   §X4 Sync again sends nothing new, and the gift says it is already there
//   §X5 the old deposit-per-payout send still refuses for Xero
//
// HOW IT WOULD GO RED: drop the mapping-gap refusal in xeroSync.syncGifts
// (§X1 sees a request), or the claim row (§X4 sees a second transaction).
// Proven able to fail (2026-10-11): with the mapping-gap refusal removed, the
// claim bypassed and Pending's sent-gift filter removed, §X1, §X3 and §X4 went
// red (three BankTransactions PUT for one gift); restored, 22 of 22.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, login, api, q } = require("../helpers");

const ORG = "org_c2xero", ADMIN = "c2xero-admin@c2xero-fixture.org";
const CONN = "bkc_c2xero", TENANT = "c2xero-tenant-0001";
const PORT = Number(process.env.XERO_MOCK_PORT || 5633);

const store = { requests: [], txns: [] };
function startStub() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        const path = new URL(req.url, "http://x").pathname.replace(/^\/api\.xro\/2\.0/, "");
        store.requests.push({ method: req.method, path, tenant: req.headers["xero-tenant-id"] || null,
                              key: req.headers["idempotency-key"] || null });
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET" && path === "/Organisation")
          return res.end(JSON.stringify({ Organisations: [{ Name: "C2 Xero Demo Company", OrganisationID: "org-x-1" }] }));
        if (req.method === "GET" && path === "/Accounts")
          return res.end(JSON.stringify({ Accounts: [
            { AccountID: "acc-bank", Code: null, Name: "Business Bank Account", Type: "BANK", Class: "ASSET", Status: "ACTIVE" },
            { AccountID: "acc-200", Code: "200", Name: "Donations", Type: "REVENUE", Class: "REVENUE", Status: "ACTIVE" },
            { AccountID: "acc-210", Code: "210", Name: "Capital gifts", Type: "OTHERINCOME", Class: "REVENUE", Status: "ACTIVE" },
            { AccountID: "acc-404", Code: "404", Name: "Bank fees", Type: "EXPENSE", Class: "EXPENSE", Status: "ACTIVE" }] }));
        if (req.method === "PUT" && path === "/BankTransactions") {
          let body = {}; try { body = JSON.parse(b || "{}"); } catch { /* asserted below */ }
          const t = { ...(body.BankTransactions || [])[0], BankTransactionID: "bt-" + (store.txns.length + 1) };
          store.txns.push(t);
          return res.end(JSON.stringify({ Status: "OK", BankTransactions: [t] }));
        }
        res.statusCode = 404; res.end(JSON.stringify({ Message: "not in the stand-in" }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(PORT, () => resolve(srv));
  });
}

async function clean() {
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_deposits", "gifts", "donors", "fin_transactions", "budgets",
                   "accounts", "fin_funds", "bookkeeping_connections", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function run() {
  console.log("CONNECT-2 Xero: one bank transaction per gift, once, and only when every fund is mapped\n");
  const stub = await startStub();
  ok("§X0 the Xero stand-in is listening (without it this file proves nothing)", !!stub, PORT);
  await clean();
  try {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,'C2 Xero','c2xero',1,'active','team')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_c2xero',$1,$2,$3,'C2 Xero Admin','admin')`,
      [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_c2x_gen',$1,'General Operating',false),
                                                                     ('fnd_c2x_bld',$1,'Building Fund',true)`, [ORG]);
    await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_c2x_ruth',$1,'Ruth Okafor','ruth@c2xero-fixture.org')`, [ORG]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,processor_fee_amount)
             VALUES ('g_c2x_one',$1,'d_c2x_ruth',100,'2026-10-05','online','fnd_c2x_gen','card',3.20)`, [ORG]);
    await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
             VALUES ($1,$2,'xero','active',$3,'{}'::jsonb,'system:test','connect2 xero')`, [CONN, ORG, TENANT]);
    const tok = await login(ADMIN);

    // §X1
    const half = await api("PUT", "/xero/mapping", tok, { startDate: "2026-10-01",
      bankAccount: { id: "acc-bank", name: "Business Bank Account" }, feeAccount: { code: "404", name: "Bank fees" },
      funds: { fnd_c2x_gen: { code: "200", name: "Donations" } } });
    ok("§X1 a half mapping saves", half.status === 200 && half.body?.mappingReady === false, half.body);
    const on = await api("PUT", "/xero/auto-sync", tok, { on: true });
    ok("§X1 auto-sync cannot be turned on while a fund is unmapped",
       on.status === 409 && /Building Fund/.test(on.body?.sentence || ""), on.body);
    const n0 = store.requests.length;
    const tick = await api("POST", "/xero/auto-sync/run", tok);
    ok("§X1 the auto-sync tick's door answers and sends nothing", tick.status === 200 && store.requests.length === n0, tick.body);
    const [{ xero_auto_sync }] = await q(`SELECT xero_auto_sync FROM orgs WHERE id=$1`, [ORG]);
    ok("§X1 auto-sync is still off", xero_auto_sync === false);
    // Remove the bank account too: then not even a press can send.
    await api("PUT", "/xero/mapping", tok, { startDate: "2026-10-01", funds: { fnd_c2x_gen: { code: "200", name: "Donations" } } });
    const s1 = await api("POST", "/xero/sync", tok, { all: true });
    ok("§X1 Sync with no bank account is refused", s1.status === 409 && s1.body?.error === "needs_mapping", s1.body);
    ok("§X1 …and Xero received no request at all", store.requests.length === n0, store.requests.slice(n0));

    // §X2
    const pv = await api("POST", "/xero/preview", tok);
    ok("§X2 Read from Xero names the organisation", pv.status === 200 && pv.body?.organisation?.name === "C2 Xero Demo Company", pv.body);
    ok("§X2 …and lists income and bank accounts", (pv.body?.income || []).length === 2 && (pv.body?.bank || []).length === 1, pv.body);
    ok("§X2 …reading only (two GETs, nothing written to Xero)",
       store.requests.slice(n0).every(r => r.method === "GET") && store.txns.length === 0, store.requests.slice(n0));

    // §X3
    const full = await api("PUT", "/xero/mapping", tok, { startDate: "2026-10-01",
      bankAccount: { id: "acc-bank", name: "Business Bank Account" }, feeAccount: { code: "404", name: "Bank fees" },
      funds: { fnd_c2x_gen: { code: "200", name: "Donations" }, fnd_c2x_bld: { code: "210", name: "Capital gifts" },
               __none: { code: "200", name: "Donations" } } });
    ok("§X3 the full mapping is ready", full.status === 200 && full.body?.mappingReady === true, full.body);
    const s3 = await api("POST", "/xero/sync", tok, { all: true });
    ok("§X3 one Sync sends one", s3.status === 200 && s3.body?.synced === 1 && store.txns.length === 1, s3.body);
    const t = store.txns[0] || {};
    const put = store.requests.find(r => r.method === "PUT") || {};
    ok("§X3 it is a RECEIVE bank transaction into the chosen bank account",
       t.Type === "RECEIVE" && t.BankAccount?.AccountID === "acc-bank" && t.Date === "2026-10-05", t);
    ok("§X3 gross on the fund's account, the fee as a negative line",
       t.LineItems?.length === 2 && t.LineItems[0].AccountCode === "200" && t.LineItems[0].UnitAmount === 100
       && t.LineItems[1].AccountCode === "404" && t.LineItems[1].UnitAmount === -3.2, t.LineItems);
    ok("§X3 donor names stay out of Xero unless the org turned them on",
       t.Contact?.Name === "Donations via Steward" && !/Ruth/.test(JSON.stringify(t)), t.Contact);
    ok("§X3 the request carries the tenant and an Idempotency-Key", put.tenant === TENANT && /^stw-xero-/.test(put.key || ""), put);
    const g3 = await api("GET", "/xero", tok);
    ok("§X3 the panel counts 1 sent, $100, and nothing pending",
       g3.body?.sent?.gifts === 1 && g3.body?.sent?.cents === 10000 && g3.body?.pending?.count === 0, g3.body?.sent);
    const cons = await api("GET", "/connections", tok);
    const card = (cons.body?.cards || []).find(c => c.provider === "xero");
    ok("§X3 the Connections card reads the same one", card && card.connected === true && card.deposits30 === 1 && card.deposits30Cents === 10000, card);
    const on2 = await api("PUT", "/xero/auto-sync", tok, { on: true });
    ok("§X3 auto-sync turns on once every fund is mapped", on2.status === 200 && on2.body?.autoSync === true, on2.body);

    // §X4
    const again = await api("POST", "/xero/sync", tok, { all: true });
    const again2 = await api("POST", "/xero/sync", tok, { giftIds: ["g_c2x_one"] });
    ok("§X4 Sync again sends nothing new", store.txns.length === 1 && again.body?.synced === 0 && again2.body?.synced === 0,
       { txns: store.txns.length, again: again.body, again2: again2.body });
    ok("§X4 …and says the gift is already there", (again2.body?.results || []).some(r => r.giftId === "g_c2x_one" && r.status === "already"), again2.body);

    // §X5
    const legacy = await api("POST", `/bookkeeping/${CONN}/send`, tok, { payouts: [{ payout: { id: "po_c2x", netCents: 100, sourceKey: "stripe" } }] });
    ok("§X5 the deposit-per-payout send still refuses for Xero", legacy.status === 409 && legacy.body?.error === "send_not_available", legacy.body);
  } finally {
    await clean();
    if (stub) stub.close();
  }
}

module.exports = { run };
if (require.main === module) run().then(async () => { await require("../helpers").closeDb(); require("../helpers").summary(); })
  .catch(async e => { console.error(e); process.exit(1); });

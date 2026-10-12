// tests/qboin/standin.js, QBO-IN. THE STAND-IN QUICKBOOKS COMPANY.
//
// One company and one Steward org, shared by tests/qboin-read.test.js and the
// walk (scripts/qboin-walk.js) so the screenshots show exactly what the guard
// asserts. The company answers Intuit's v3 query endpoint in the entity shapes
// of the API reference on developer.intuit.com (SalesReceipt, Payment,
// Invoice, Deposit with DepositLineDetail and LinkedTxn, RefundReceipt, Item
// with IncomeAccountRef, Customer with PrimaryEmailAddr, BillAddr and
// CompanyName). Every request that is not a GET is recorded in `writes`.
const http = require("http");
const bcrypt = require("bcryptjs");
const { q, civilPlusDays, civilToday } = require("../helpers");

const ORG = "org_qboin";
const ADMIN = "qboin-admin@example.org";
const CONN = "bkc_qboin";
const REALM = "4620816365214500";
const STUB_PORT = Number(process.env.BOOKKEEPING_MOCK_PORT || 5632);
const A_CONTRIB = "81", A_FEES = "82", A_BANK = "35";

// Dates relative to today, so the fixture never rots.
const TODAY = civilToday();
const day = n => civilPlusDays(n);

// ── THE STAND-IN COMPANY ───────────────────────────────────────────────────
const writes = [];
const company = {
  Item: [
    { Id: "11", Name: "Donation", Type: "Service", IncomeAccountRef: { value: A_CONTRIB, name: "Contributed income" } },
    { Id: "12", Name: "Swim team registration", Type: "Service", IncomeAccountRef: { value: A_FEES, name: "Program fees" } },
  ],
  Customer: [
    { Id: "1", DisplayName: "Ada Okafor", GivenName: "Ada", FamilyName: "Okafor", PrimaryEmailAddr: { Address: "ada@example.org" } },
    { Id: "2", DisplayName: "Ben Hollis", GivenName: "Ben", FamilyName: "Hollis" },
    { Id: "3", DisplayName: "Sam Rivera", GivenName: "Sam", FamilyName: "Rivera", BillAddr: { Line1: "9 Elm St", PostalCode: "30301" } },
    { Id: "4", DisplayName: "Harbor Hardware LLC", CompanyName: "Harbor Hardware LLC", PrimaryEmailAddr: { Address: "books@harborhardware.example" } },
    { Id: "5", DisplayName: "Cara Lin", GivenName: "Cara", FamilyName: "Lin", PrimaryEmailAddr: { Address: "cara@example.org" } },
    { Id: "6", DisplayName: "Susan La", GivenName: "Susan", FamilyName: "La", PrimaryEmailAddr: { Address: "susan@example.org" } },
  ],
  SalesReceipt: [
    // A check on the donation account: a gift for Ada (by email).
    { Id: "101", TxnDate: day(-5), TotalAmt: 250, CustomerRef: { value: "1", name: "Ada Okafor" },
      PaymentMethodRef: { value: "2", name: "Check" }, PaymentRefNum: "1041", PrivateNote: "",
      Line: [{ Id: "1", Amount: 250, DetailType: "SalesItemLineDetail", Description: "Spring appeal",
               SalesItemLineDetail: { ItemRef: { value: "11", name: "Donation" } } },
             { Amount: 250, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} }] },
    // Swim team registration on Program fees: left out.
    { Id: "102", TxnDate: day(-4), TotalAmt: 85, CustomerRef: { value: "1", name: "Ada Okafor" },
      PaymentMethodRef: { value: "1", name: "Cash" },
      Line: [{ Id: "1", Amount: 85, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "12" } } }] },
    // Cash from Ben (no email: matched by his one name).
    { Id: "103", TxnDate: day(-40), TotalAmt: 100, CustomerRef: { value: "2", name: "Ben Hollis" },
      PaymentMethodRef: { value: "1", name: "Cash" },
      Line: [{ Id: "1", Amount: 100, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
    // Two Sam Riveras in Steward, neither at 9 Elm St: ambiguous.
    { Id: "104", TxnDate: day(-3), TotalAmt: 30, CustomerRef: { value: "3", name: "Sam Rivera" },
      PaymentMethodRef: { value: "2", name: "Check" }, PaymentRefNum: "220",
      Line: [{ Id: "1", Amount: 30, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
    // A business nobody in Steward knows yet.
    { Id: "105", TxnDate: day(-2), TotalAmt: 500, CustomerRef: { value: "4", name: "Harbor Hardware LLC" },
      PaymentMethodRef: { value: "5", name: "ACH" },
      Line: [{ Id: "1", Amount: 500, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
    // Cara's $75 is already in Steward from Stripe two days earlier.
    { Id: "106", TxnDate: day(-8), TotalAmt: 75, CustomerRef: { value: "5", name: "Cara Lin" },
      PaymentMethodRef: { value: "3", name: "Visa" },
      Line: [{ Id: "1", Amount: 75, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
    // Susan La's $10, sent by Steward (FIX-34: the gift id in DocNumber).
    { Id: "900", TxnDate: day(-6), TotalAmt: 10, DocNumber: "g_qi_susan", CustomerRef: { value: "6", name: "Susan La" },
      PrivateNote: "Gift from Susan La, General Operating, via Steward",
      Line: [{ Id: "1", Amount: 10, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
    // Older than the read-from day: never read.
    { Id: "107", TxnDate: day(-500), TotalAmt: 999, CustomerRef: { value: "1", name: "Ada Okafor" },
      Line: [{ Id: "1", Amount: 999, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
  ],
  Invoice: [
    { Id: "301", TxnDate: day(-20), CustomerRef: { value: "1" },
      Line: [{ Id: "1", Amount: 60, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "11" } } }] },
  ],
  Payment: [
    // Ada pays a pledge invoice by check.
    { Id: "401", TxnDate: day(-10), TotalAmt: 60, CustomerRef: { value: "1", name: "Ada Okafor" },
      PaymentMethodRef: { value: "2", name: "Check" }, PaymentRefNum: "1039",
      Line: [{ Amount: 60, LinkedTxn: [{ TxnId: "301", TxnType: "Invoice" }] }] },
  ],
  Deposit: [
    // A Stripe payout, and a check from Ben on the same deposit.
    { Id: "501", TxnDate: day(-7), TotalAmt: 527.2, DepositToAccountRef: { value: A_BANK },
      Line: [
        { Id: "1", Amount: 487.2, DetailType: "DepositLineDetail", Description: "STRIPE TRANSFER",
          DepositLineDetail: { Entity: { value: "77", name: "Stripe", type: "Vendor" }, AccountRef: { value: A_CONTRIB, name: "Contributed income" } } },
        { Id: "2", Amount: 40, DetailType: "DepositLineDetail",
          DepositLineDetail: { Entity: { value: "2", name: "Ben Hollis", type: "Customer" }, AccountRef: { value: A_CONTRIB, name: "Contributed income" },
                               PaymentMethodRef: { value: "2", name: "Check" }, CheckNum: "5521" } },
      ] },
    // Banking Ada's receipt 101: the same money, not a second gift.
    { Id: "502", TxnDate: day(-4), TotalAmt: 250, DepositToAccountRef: { value: A_BANK },
      Line: [{ Id: "1", Amount: 250, LinkedTxn: [{ TxnId: "101", TxnType: "SalesReceipt", TxnLineId: "0" }],
               DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "4" } } }] },
  ],
  RefundReceipt: [],
};
const unq = s => String(s).replace(/\\'/g, "'");
// The chart of accounts, for "Which QuickBooks income accounts are donations?"
const ACCOUNTS = [
  { Id: A_CONTRIB, Name: "Contributed income", FullyQualifiedName: "Contributed income", AccountType: "Income", Active: true },
  { Id: A_FEES, Name: "Program fees", FullyQualifiedName: "Program fees", AccountType: "Income", Active: true },
  { Id: A_BANK, Name: "Checking", FullyQualifiedName: "Checking", AccountType: "Bank", Active: true },
];
function runQuery(stmt) {
  let m;
  if (/ from Account /i.test(stmt)) return { Account: ACCOUNTS };
  if (/ from Class /i.test(stmt)) return { Class: [] };
  if ((m = stmt.match(/^select \* from (\w+) where TxnDate >= '(\d{4}-\d{2}-\d{2})' startposition (\d+) maxresults (\d+)$/i))) {
    const rows = (company[m[1]] || []).filter(t => t.TxnDate >= m[2]);
    return { [m[1]]: rows.slice(Number(m[3]) - 1, Number(m[3]) - 1 + Number(m[4])) };
  }
  if ((m = stmt.match(/^select \* from (\w+) startposition (\d+) maxresults (\d+)$/i)))
    return { [m[1]]: (company[m[1]] || []).slice(Number(m[2]) - 1, Number(m[2]) - 1 + Number(m[3])) };
  if ((m = stmt.match(/^select \* from (\w+) where Id in \(([^)]*)\)/i))) {
    const ids = m[2].split(",").map(x => unq(x.trim()).replace(/^'|'$/g, ""));
    return { [m[1]]: (company[m[1]] || []).filter(x => ids.includes(String(x.Id))) };
  }
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
        if (req.method !== "GET") writes.push(req.method + " " + u.pathname);
        const m = u.pathname.match(/^\/v3\/company\/([^/]+)\/query$/);
        if (req.method === "GET" && m && m[1] === REALM) {
          res.end(JSON.stringify({ QueryResponse: runQuery(u.searchParams.get("query") || ""), time: new Date().toISOString() }));
          return;
        }
        res.statusCode = 400; res.end(JSON.stringify({ Fault: { Error: [{ code: "2020", Message: "unsupported" }] } }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STUB_PORT, () => resolve(srv));
  });
}

async function reset() {
  for (const t of ["qbo_read_lines", "qbo_read_gifts", "qbo_read_runs", "thank_you_drafts", "fin_transactions", "receipts",
                   "gift_bookkeeping_syncs", "bookkeeping_customers", "bookkeeping_connections", "interactions", "threads", "tasks",
                   "journey_enrollments", "sequence_enrollments", "gifts", "imports", "donors", "budgets", "accounts", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled)
           VALUES ($1,'Ridgeview Swim and Sail','ridgeview-swim-sail',1,'active','team',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_qboin',$1,$2,$3,'Ridgeview Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_qi_gen',$1,'General Operating',false)`, [ORG]);
  const donor = (id, name, email, address, zip) => q(
    `INSERT INTO donors (id,org_id,name,email,address,zip,person_types) VALUES ($1,$2,$3,$4,$5,$6,'["donor"]'::jsonb)`,
    [id, ORG, name, email, address, zip]);
  await donor("d_qi_ada", "Ada Okafor", "ada@example.org", null, null);
  await donor("d_qi_ben", "Ben Hollis", null, null, null);
  await donor("d_qi_sam1", "Sam Rivera", null, "14 Oak Ave", "30307");
  await donor("d_qi_sam2", "Sam Rivera", null, "200 Pine Rd", "30318");
  await donor("d_qi_cara", "Cara Lin", "cara@example.org", null, null);
  await donor("d_qi_susan", "Susan La", "susan@example.org", null, null);
  // Cara's gift, already in Steward from Stripe; Susan's, sent by Steward.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,stripe_payment_id)
           VALUES ('g_qi_cara',$1,'d_qi_cara',75,$2,'online','fnd_qi_gen','card','pi_3QboinCaraStripe')`, [ORG, day(-10)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_qi_susan',$1,'d_qi_susan',10,$2,'online','fnd_qi_gen','card')`, [ORG, day(-6)]);
  await q(`UPDATE donors SET total_giving=75, gift_count=1 WHERE id='d_qi_cara'`);
  await q(`UPDATE donors SET total_giving=10, gift_count=1 WHERE id='d_qi_susan'`);
  const mapping = { qbo: { mode: "salesreceipt", startDate: day(-400), realmId: REALM,
    depositAccount: { id: A_BANK, name: "Checking" },
    funds: { fnd_qi_gen: { accountId: A_CONTRIB, accountName: "Contributed income" } }, campaigns: {} } };
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ($1,$2,'quickbooks','active',$3,$4::jsonb,'system:test','qboin suite')`, [CONN, ORG, REALM, JSON.stringify(mapping)]);
  await q(`INSERT INTO gift_bookkeeping_syncs (id,org_id,gift_id,vendor,connection_id,realm_id,status,txn_type,qbo_id,amount_cents,created_by,created_by_name)
           VALUES ('gbs_qi_susan',$1,'g_qi_susan','quickbooks',$2,$3,'synced','SalesReceipt','900',1000,'system:test','qboin suite')`, [ORG, CONN, REALM]);
}


module.exports = { ORG, ADMIN, CONN, REALM, STUB_PORT, A_CONTRIB, A_FEES, A_BANK, TODAY, day, company, writes,
  startStub, reset, stopStub: () => stub && stub.close() };

// tests/fix34/d-books-paypal.js, FIX-34 builder D. NOTHING GOES TO QUICKBOOKS
// THAT A PERSON DID NOT SET UP, AND ONE PAYPAL CONNECTION HAS ONE STATUS.
//
// Run by tests/fix34-thanks.test.js (the lead's runner), or alone.
//
// WHAT IS ASSERTED:
//   §Q1 a new QuickBooks connection with nothing mapped: Sync all is refused
//       with the sentence naming what to map, and QuickBooks gets no request
//   §Q2 one fund mapped, one not, auto-sync left on from before: the hourly
//       tick (its ops door) sends NOTHING, and auto-sync cannot be turned on
//   §Q3 every fund mapped: one Sync sends one receipt, and the QuickBooks card
//       on Connections and the sync panel both count 1
//   §Q4 the receipt's memo is "Gift from <donor>, <fund>, via Steward"; the
//       gift id is in DocNumber, not in the memo
//   §Y1 a PayPal source connected on an org with one general fund defaults to
//       it, and the picker's answer offers the org's funds
//   §Y2 the Connections card and the "Connects directly" reader agree
//
// RED BEFORE THE FIX (c4be904, run 2026-10-08): §Q1 (200, per-gift results),
// §Q2 (the tick sent the mapped fund's gift; auto-sync turned on), §Q3 (the
// card read bookkeeping_deposits: 0), §Q4 (memo "Steward gift g_..."), §Y1
// (no default, no funds in the answer), §Y2 (no `connected` on the source).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, login, api, q } = require("../helpers");

const ORG = "org_fix34d_books", ADMIN = "fix34d-books@example.org";
const PORG = "org_fix34d_pay", PADMIN = "fix34d-pay@example.org";
const CONN = "bkc_fix34d", REALM = "9341000000000000034";
const STUB_PORT = Number(process.env.BOOKKEEPING_MOCK_PORT || 5632);

const store = { requests: [], posts: [], receipts: [], customers: [], items: [] };
const unq = s => String(s).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
function startStub() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        store.requests.push(req.method + " " + req.url);
        res.setHeader("Content-Type", "application/json");
        const u = new URL(req.url, "http://stub");
        const m = u.pathname.match(/^\/v3\/company\/([^/]+)\/(query|customer|item|salesreceipt|deposit)$/);
        if (!m) { res.statusCode = 404; res.end(JSON.stringify({ Fault: { Error: [{ code: "404" }] } })); return; }
        if (req.method === "GET") {
          const st = u.searchParams.get("query") || ""; let mm, out = {};
          if ((mm = st.match(/from Customer where DisplayName = '((?:[^'\\]|\\.)*)'/i)))
            out = { Customer: store.customers.filter(c => c.DisplayName === unq(mm[1])) };
          else if ((mm = st.match(/from Item where Name = '((?:[^'\\]|\\.)*)'/i)))
            out = { Item: store.items.filter(i => i.Name === unq(mm[1])) };
          res.end(JSON.stringify({ QueryResponse: out })); return;
        }
        store.posts.push(m[2]);
        let body = {}; try { body = JSON.parse(b || "{}"); } catch { /* not under test */ }
        if (m[2] === "customer") { const c = { ...body, Id: String(100 + store.customers.length) }; store.customers.push(c); res.end(JSON.stringify({ Customer: c })); return; }
        if (m[2] === "item") { const it = { ...body, Id: String(200 + store.items.length) }; store.items.push(it); res.end(JSON.stringify({ Item: it })); return; }
        const sr = { ...body, Id: String(1000 + store.receipts.length) }; store.receipts.push(sr);
        res.end(JSON.stringify({ SalesReceipt: sr }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STUB_PORT, () => resolve(srv));
  });
}

async function clean() {
  for (const org of [ORG, PORG]) {
    for (const t of ["gift_bookkeeping_syncs", "bookkeeping_customers", "bookkeeping_connections", "giving_sources",
                     "gifts", "donors", "fin_funds", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
}
async function orgWithAdmin(id, name, slug, email, uid, qbo) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled,qbo_auto_sync)
           VALUES ($1,$2,$3,1,'active','team',$4,$4)`, [id, name, slug, qbo]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Fix34 D Admin','admin')`,
    [uid, id, email, bcrypt.hashSync("loadtest1234", 10)]);
}

async function run() {
  console.log("FIX-34 D: QuickBooks sends only what a person set up; PayPal has one status and offers the funds\n");
  const stub = await startStub();
  ok("the QuickBooks stub is listening (without it this file proves nothing)", !!stub, STUB_PORT);
  await clean();
  try {
    // ── QUICKBOOKS ─────────────────────────────────────────────────────────
    // auto-sync is TRUE on the org, as if left on from an earlier connection.
    await orgWithAdmin(ORG, "Fix34 D Books", "fix34d-books", ADMIN, "u_fix34d_b", true);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_f34d_gen',$1,'General Operating',false),
                                                                     ('fnd_f34d_bld',$1,'Building Fund',true)`, [ORG]);
    await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_f34d_susan',$1,'Susan La','susan.la@example.org')`, [ORG]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
             VALUES ('g_f34d_one',$1,'d_f34d_susan',75,'2026-10-05','online','fnd_f34d_gen','card')`, [ORG]);
    await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
             VALUES ($1,$2,'quickbooks','active',$3,'{}'::jsonb,'system:test','fix34 d')`, [CONN, ORG, REALM]);
    const tok = await login(ADMIN);

    // §Q1
    const n0 = store.requests.length;
    const s1 = await api("POST", "/qbo/sync", tok, { all: true });
    ok("§Q1 Sync on a new, unmapped connection is refused", s1.status === 409 && s1.body?.error === "needs_mapping", s1.body);
    ok("§Q1 …with a sentence naming what to map", /General Operating/.test(s1.body?.sentence || "")
       && /Building Fund/.test(s1.body?.sentence || "") && /lands in/.test(s1.body?.sentence || ""), s1.body?.sentence);
    ok("§Q1 …and QuickBooks received nothing", store.requests.length === n0, store.requests.slice(n0));
    const g1 = await api("GET", "/qbo", tok);
    ok("§Q1 the panel says the mapping is not ready, with the same sentence",
       g1.body?.mappingReady === false && g1.body?.mappingGaps?.sentence === s1.body?.sentence, g1.body?.mappingGaps);

    // §Q2
    const half = await api("PUT", "/qbo/mapping", tok, { mode: "salesreceipt", startDate: "2026-10-01",
      depositAccount: { id: "35", name: "Checking" },
      funds: { fnd_f34d_gen: { accountId: "81", accountName: "Donations" } }, campaigns: {} });
    ok("§Q2 a half mapping saves", half.status === 200, half.body);
    const n1 = store.requests.length;
    const tick = await api("POST", "/qbo/auto-sync/run", tok);
    ok("§Q2 the hourly tick's ops door answers", tick.status === 200, tick.body);
    ok("§Q2 THE HOURLY TICK SENDS NOTHING while a fund is unmapped", store.requests.length === n1 && store.receipts.length === 0,
       store.requests.slice(n1));
    const on = await api("PUT", "/qbo/auto-sync", tok, { on: true });
    ok("§Q2 auto-sync cannot be turned on while a fund is unmapped", on.status === 409 && /Building Fund/.test(on.body?.sentence || ""), on.body);

    // §Q3
    await api("PUT", "/qbo/mapping", tok, { mode: "salesreceipt", startDate: "2026-10-01",
      depositAccount: { id: "35", name: "Checking" },
      funds: { fnd_f34d_gen: { accountId: "81", accountName: "Donations" },
               fnd_f34d_bld: { accountId: "82", accountName: "Capital gifts" } }, campaigns: {} });
    const s3 = await api("POST", "/qbo/sync", tok, { all: true });
    ok("§Q3 with every fund mapped, one Sync sends one", s3.status === 200 && s3.body?.synced === 1 && store.receipts.length === 1, s3.body);
    const cons = await api("GET", "/connections", tok);
    const card = (cons.body?.cards || []).find(c => c.provider === "quickbooks");
    ok("§Q3 the Connections card counts 1 sent, $75", card && card.deposits30 === 1 && card.deposits30Cents === 7500, card);
    ok("§Q3 …calls it a sales receipt and says when", card && card.sentLabel === "sales receipt sent" && !!card.lastSentAt, card);
    ok("§Q3 …and says what the code sends", card && /one sales receipt/.test(card.subtitle || "") && !/deposit per payout/.test(card.subtitle || ""), card?.subtitle);
    const g3 = await api("GET", "/qbo", tok);
    ok("§Q3 the panel counts the same 1", g3.body?.sent?.gifts === 1 && g3.body?.sent?.cents === 7500, g3.body?.sent);
    const on2 = await api("PUT", "/qbo/auto-sync", tok, { on: true });
    ok("§Q3 auto-sync turns on once every fund is mapped", on2.status === 200 && on2.body?.autoSync === true, on2.body);

    // §Q4
    const sr = store.receipts[0] || {};
    ok("§Q4 the memo is the plain sentence", sr.PrivateNote === "Gift from Susan La, General Operating, via Steward", sr.PrivateNote);
    ok("§Q4 the gift id is in DocNumber, not the memo", sr.DocNumber === "g_f34d_one" && !/g_f34d/.test(sr.PrivateNote || ""), sr);
    const again = await api("POST", "/qbo/sync", tok, { giftIds: ["g_f34d_one"] });
    ok("§Q4 the sent gift is never sent again", store.receipts.length === 1 && again.body?.synced === 0, again.body);

    // ── PAYPAL ─────────────────────────────────────────────────────────────
    await orgWithAdmin(PORG, "Fix34 D Pay", "fix34d-pay", PADMIN, "u_fix34d_p", false);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_f34d_pgen',$1,'General Operating',false),
                                                                     ('fnd_f34d_proof',$1,'Roof Appeal',true)`, [PORG]);
    const ptok = await login(PADMIN);
    const c1 = await api("POST", "/giving-sources", ptok, { provider: "paypal", credentials: { clientId: "fix34d-id", clientSecret: "fix34d-secret" } });
    ok("§Y1 PayPal connects", c1.status === 200 && !!c1.body?.id, c1.body);
    const gs = await api("GET", "/giving-sources", ptok);
    const src = (gs.body?.sources || []).find(s => s.provider === "paypal" && s.status !== "disconnected");
    ok("§Y1 the picker's answer offers the org's funds",
       ["General Operating", "Roof Appeal"].every(n => (gs.body?.funds || []).some(f => f.name === n)), gs.body?.funds);
    ok("§Y1 gifts default to the single general fund", src && src.defaultFundId === "fnd_f34d_pgen", src);
    const pc = await api("GET", "/connections", ptok);
    const pcard = (pc.body?.cards || []).find(c => c.provider === "paypal");
    ok("§Y2 the card and the tile read one status: both connected",
       !!pcard && src && pcard.connected === true && src.connected === true && pcard.id === src.id, { card: pcard && pcard.connected, tile: src && src.connected });
  } finally {
    await clean();
    if (stub) stub.close();
  }
}

module.exports = { run };
if (require.main === module) run().then(async()=>{await require("../helpers").closeDb();require("../helpers").summary();}).catch(async e=>{console.error(e);process.exit(1);});

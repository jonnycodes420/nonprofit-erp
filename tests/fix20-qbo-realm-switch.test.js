// tests/fix20-qbo-realm-switch.test.js, FIX-20 Test 2. THE SENT LIST BELONGS TO A COMPANY.
//
//     A QUICKBOOKS CONNECTION MOVED TO A DIFFERENT COMPANY SENDS A PREVIOUSLY
//     SENT GIFT AGAIN TO THE NEW COMPANY EXACTLY ONCE, AND NEVER TWICE TO
//     EITHER.
//
// Before FIX-20 the sent list was keyed on (org, gift, vendor). An org that
// reconnected to a new QuickBooks company found every earlier gift already
// "sent", so the new books were silently missing them. Keyed on the company
// (Intuit's realmId) the new company starts empty, and the first company's
// list is kept: moving back to it sends nothing again.
//
// WHAT IS ASSERTED:
//   §1  a gift synced to company A is one sales receipt in A
//   §2  the connection moves to company B: the screen says, before the first
//       sync, that this is a different company and nothing has gone there yet
//   §3  A's mapping (A's account numbers) is not used in B: Sync all sends
//       nothing and the gift waits with a sentence saying why
//   §4  with B's own mapping saved, the gift goes to B exactly once, and a
//       second Sync all and a Sync by id send nothing more
//   §5  moved back to A, nothing is sent to A a second time
//
// HOW IT WOULD GO RED, planted and watched (2026-10-03):
//   · dropping the `s.realm_id = <live company>` condition from
//     qboSync.pendingWhere (the sent list read across companies) turned 8
//     red: §2 to §5, the gift never reached B because it read as already sent.
//   · letting Pending and the claim take a SYNCED row again (Steward forgets
//     what it sent) turned §4 and §5 red: four receipts in B, three in A.
//
// Standard scratch stack (tests/README.md) booted with TEST_MODE=1 and
// INTUIT_API_BASE at BOOKKEEPING_MOCK_PORT, the stub this file starts.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_f20realm";
const ADMIN = "f20realm-admin@example.org";
const CONN = "bkc_f20realm";
const REALM_A = "4620816365000000001", REALM_B = "4620816365000000002";
const STUB_PORT = Number(process.env.BOOKKEEPING_MOCK_PORT || 5632);

// Two companies, each with its own books. Account "81" exists in both and is
// a different account in each, which is exactly why a mapping is per company.
const books = {
  [REALM_A]: { customers: [], items: [], receipts: [] },
  [REALM_B]: { customers: [], items: [], receipts: [] },
};
const unq = s => String(s).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
let stub;
function startStub() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const u = new URL(req.url, "http://stub");
        const m = u.pathname.match(/^\/v3\/company\/([^/]+)\/(query|customer|item|salesreceipt)$/);
        const co = m && books[m[1]];
        if (!co) { res.statusCode = 404; res.end(JSON.stringify({ Fault: { Error: [{ code: "404", Message: "no such company" }] } })); return; }
        const kind = m[2];
        if (req.method === "GET" && kind === "query") {
          const st = u.searchParams.get("query") || ""; let mm, out = {};
          if ((mm = st.match(/from Customer where PrimaryEmailAddr = '((?:[^'\\]|\\.)*)'/i)))
            out = { Customer: co.customers.filter(c => c.PrimaryEmailAddr && c.PrimaryEmailAddr.Address === unq(mm[1])) };
          else if ((mm = st.match(/from Customer where DisplayName = '((?:[^'\\]|\\.)*)'/i)))
            out = { Customer: co.customers.filter(c => c.DisplayName === unq(mm[1])) };
          else if ((mm = st.match(/from Item where Name = '((?:[^'\\]|\\.)*)'/i)))
            out = { Item: co.items.filter(i => i.Name === unq(mm[1])) };
          res.end(JSON.stringify({ QueryResponse: out })); return;
        }
        let body = {}; try { body = JSON.parse(b || "{}"); } catch { /* the stub is not under test */ }
        if (kind === "customer") { const c = { ...body, Id: String(100 + co.customers.length) }; co.customers.push(c); res.end(JSON.stringify({ Customer: c })); return; }
        if (kind === "item") { const it = { ...body, Id: String(200 + co.items.length) }; co.items.push(it); res.end(JSON.stringify({ Item: it })); return; }
        // NO requestid dedupe: every POST is a new receipt.
        const sr = { ...body, Id: String(1000 + co.receipts.length) }; co.receipts.push(sr);
        res.end(JSON.stringify({ SalesReceipt: sr }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STUB_PORT, () => resolve(srv));
  });
}

const mappingBody = (acctName) => ({
  mode: "salesreceipt", startDate: "2026-09-01",
  depositAccount: { id: "35", name: "Checking" },
  funds: { fnd_f20r: { accountId: "81", accountName: acctName } }, campaigns: {},
});

async function clean() {
  for (const t of ["gift_bookkeeping_syncs", "bookkeeping_customers", "bookkeeping_connections", "gifts", "donors", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

const receiptsFor = (realm, gid) => books[realm].receipts.filter(r => r.PrivateNote === `Steward gift ${gid}`).length;

(async () => {
  console.log("FIX-20 Test 2: a different QuickBooks company gets a sent gift once, and neither company gets it twice\n");
  stub = await startStub();
  ok("the two-company QuickBooks stub is listening", !!stub, STUB_PORT);
  await clean();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,qbo_sync_enabled)
           VALUES ($1,'Realm Switch Trust','realm-switch-trust',1,'active','team',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_f20realm',$1,$2,$3,'Realm Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_f20r',$1,'General',false)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email) VALUES ('d_f20r',$1,'Marlo Finch','marlo@example.org')`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_f20r',$1,'d_f20r',212.34,'2026-09-15','online','fnd_f20r','card')`, [ORG]);
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,created_by,created_by_name)
           VALUES ($1,$2,'quickbooks','active',$3,'{}'::jsonb,'system:test','fix20 realm suite')`, [CONN, ORG, REALM_A]);
  const tok = await login(ADMIN);
  const sync = body => api("POST", "/qbo/sync", tok, body);

  // ── §1 · COMPANY A ──────────────────────────────────────────────────────
  const mA = await api("PUT", "/qbo/mapping", tok, mappingBody("Donations (A)"));
  ok("§1 company A's mapping saves", mA.status === 200, mA.body);
  const s1 = await sync({ all: true });
  ok("§1 the gift goes to company A", s1.status === 200 && s1.body?.synced === 1, s1.body);
  ok("§1 …as exactly one receipt in A", receiptsFor(REALM_A, "g_f20r") === 1, books[REALM_A].receipts.length);
  const g0 = await api("GET", "/qbo", tok);
  ok("§1 no different-company sentence while on the company it was sent to", g0.body && g0.body.companySentence === null, g0.body?.companySentence);

  // ── §2 · MOVED TO COMPANY B ─────────────────────────────────────────────
  // What the OAuth reconnect's upsert does: same connection row, new company.
  await q(`UPDATE bookkeeping_connections SET realm_id=$2 WHERE id=$1`, [CONN, REALM_B]);
  const g1 = await api("GET", "/qbo", tok);
  ok("§2 before the first sync the screen says, in one sentence, this company has had nothing yet",
     /different QuickBooks company/.test(g1.body?.companySentence || "") && /nothing has been sent here yet/.test(g1.body?.companySentence || ""),
     g1.body?.companySentence);
  const p1 = await api("GET", "/qbo/pending", tok);
  ok("§2 the gift sent to A is in B's Pending", (p1.body?.rows || []).some(r => r.giftId === "g_f20r"), p1.body?.rows);
  ok("§2 …and the Pending total foots: 21234 cents", p1.body?.total?.cents === 21234, p1.body?.total);

  // ── §3 · A'S ACCOUNT NUMBERS ARE NOT USED IN B ──────────────────────────
  ok("§3 the screen says the mapping was chosen in a different company", g1.body?.mappingOtherCompany === true, g1.body?.mappingOtherCompany);
  const s3 = await sync({ all: true });
  ok("§3 Sync all sends nothing to B on A's mapping", receiptsFor(REALM_B, "g_f20r") === 0 && s3.body?.synced === 0, s3.body);
  ok("§3 …and the gift says why", (s3.body?.results || []).some(r => r.giftId === "g_f20r" && /different QuickBooks company/.test(r.sentence)), s3.body?.results);

  // ── §4 · B'S OWN MAPPING: ONCE, AND ONLY ONCE ───────────────────────────
  await api("PUT", "/qbo/mapping", tok, mappingBody("Contributions (B)"));
  const s4 = await sync({ all: true });
  ok("§4 the gift goes to company B", s4.status === 200 && s4.body?.synced === 1, s4.body);
  ok("§4 …as exactly one receipt in B", receiptsFor(REALM_B, "g_f20r") === 1, books[REALM_B].receipts.length);
  await sync({ all: true });
  await sync({ giftIds: ["g_f20r"] });
  await Promise.all([sync({ all: true }), sync({ all: true }), sync({ giftIds: ["g_f20r"] })]);
  ok("§4 syncing again, all, by id and three at once, sends B nothing more", receiptsFor(REALM_B, "g_f20r") === 1, books[REALM_B].receipts.length);
  ok("§4 …and A still has exactly one", receiptsFor(REALM_A, "g_f20r") === 1, books[REALM_A].receipts.length);
  const g2 = await api("GET", "/qbo", tok);
  ok("§4 once B has had a gift the different-company sentence is gone", g2.body?.companySentence === null, g2.body?.companySentence);

  // ── §5 · BACK TO A: NOTHING TWICE ───────────────────────────────────────
  await q(`UPDATE bookkeeping_connections SET realm_id=$2 WHERE id=$1`, [CONN, REALM_A]);
  await api("PUT", "/qbo/mapping", tok, mappingBody("Donations (A)"));
  const p5 = await api("GET", "/qbo/pending", tok);
  ok("§5 back on A, the gift is not in Pending (A already has it)", !(p5.body?.rows || []).some(r => r.giftId === "g_f20r"), p5.body?.rows);
  await sync({ all: true });
  await sync({ giftIds: ["g_f20r"] });
  ok("§5 …and A never receives it a second time", receiptsFor(REALM_A, "g_f20r") === 1, books[REALM_A].receipts.length);
  const rows = await q(`SELECT realm_id, status FROM gift_bookkeeping_syncs WHERE org_id=$1 AND gift_id='g_f20r' ORDER BY realm_id`, [ORG]);
  ok("§5 one synced row per company, two in all", rows.length === 2 && rows.every(r => r.status === "synced")
     && rows[0].realm_id === REALM_A && rows[1].realm_id === REALM_B, rows);

  await clean();
  if (stub) stub.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (stub) stub.close(); process.exit(1); });

// SECURITY §1 — cross-tenant isolation suite.
// @no-retry (FLAKE-4): a cross-tenant leak that shows one run in two is still a leak.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The whole point of this file: authenticate as ORG A and prove A can neither
// READ nor MUTATE anything belonging to ORG B, across the §1 route class —
// grants / program-grant links, gmail→interactions, finance transactions &
// budgets, plus IDOR (guessing B's row id) on every resource. One green test
// file is the deliverable; the code change is only trusted once this passes.
//
// Isolation invariant under test: org is resolved from the JWT (never body),
// every query is org-constrained, and object-ref ops verify ownership BEFORE
// acting — a cross-org id yields 404/no-op, never a silent cross-tenant action
// and never a foreign label echoed back.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay } = require("./clock");

const A = "org_iso_a", B = "org_iso_b";
const iso = d => d.toISOString().slice(0, 10);
const TODAY = civilDay();

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["fin_audit_log", "program_grants", "fin_transactions", "budgets", "tasks", "interactions", "gifts", "grants", "programs", "fin_funds", "accounts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}

async function seedOrg(o, tag) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`,
    [o, `Iso ${tag}`, `iso-${tag}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [`u_${o}`, o, `${tag}@iso.local`, hash, `Admin ${tag}`]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'mid','cultivate',0,0)`,
    [`d_${o}`, o, `Donor ${tag}`, `donor-${tag}@iso.local`]);
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status) VALUES ($1,$2,$3,'Prog X',50000,'prospecting')`,
    [`gr_${o}`, o, `Funder ${tag}`]);
  await q(`INSERT INTO programs (id,org_id,name) VALUES ($1,$2,$3)`, [`prg_${o}`, o, `Program ${tag}`]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4000',$3,'revenue',TRUE)`,
    [`acct_${o}`, o, `Account ${tag}`]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,$3,FALSE)`, [`fnd_${o}`, o, `Fund ${tag}`]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
    [`g_${o}`, o, `d_${o}`, tag === "b" ? 99999 : 111, TODAY]);
  // A distinctive finance transaction per org (amounts chosen so a cross-org
  // read/summary leak would be unmistakable).
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,account_id,fund_id) VALUES ($1,$2,$3,$4,$5,'income',$6,$7)`,
    [`ft_${o}`, o, TODAY, `Txn ${tag}`, tag === "b" ? 88888 : 222, `acct_${o}`, `fnd_${o}`]);
}

(async () => {
  await reset();
  await seedOrg(A, "a");
  await seedOrg(B, "b");
  // B has a real program↔grant link; A must not be able to delete it.
  await q(`INSERT INTO program_grants (id,org_id,program_id,grant_id,allocated) VALUES ('pg_b',$1,'prg_org_iso_b','gr_org_iso_b',1000)`, [B]);

  const tokenA = await login("a@iso.local");
  const linkCount = async () => (await q(`SELECT COUNT(*)::int AS n FROM program_grants WHERE id='pg_b'`))[0].n;
  const txnExists = async id => (await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE id=$1`, [id]))[0].n === 1;

  // ── Grants class ──────────────────────────────────────────────────────────
  ok("IDOR: A GET /grants/:idB → 404", (await api("GET", "/grants/gr_org_iso_b", tokenA)).status === 404);
  const putB = await api("PUT", "/grants/gr_org_iso_b", tokenA, { funder: "HACKED", program: "x", amount: 1, status: "active" });
  ok("IDOR: A PUT /grants/:idB → 404", putB.status === 404);
  const grBAfter = (await q(`SELECT funder FROM grants WHERE id='gr_org_iso_b'`))[0].funder;
  ok("B's grant unchanged after A's PUT", grBAfter === "Funder b", grBAfter);
  ok("A GET /grants list excludes B's grant", !((await api("GET", "/grants", tokenA)).body || []).some(g => g.id === "gr_org_iso_b"));

  // link: A cannot attach B's grant to A's program, nor target B's program
  ok("A link B's grant to A's program → 404",
    (await api("POST", "/programs/prg_org_iso_a/grants", tokenA, { grantId: "gr_org_iso_b" })).status === 404);
  ok("A link A's grant to B's program → 404",
    (await api("POST", "/programs/prg_org_iso_b/grants", tokenA, { grantId: "gr_org_iso_a" })).status === 404);
  // delete: A's org-scoped delete must not remove B's link row
  const before = await linkCount();
  await api("DELETE", "/programs/prg_org_iso_b/grants/gr_org_iso_b", tokenA);
  ok("A cannot delete B's program↔grant link (row survives)", (await linkCount()) === before && before === 1);

  // ── Interactions / gmail class ────────────────────────────────────────────
  const gsend = await api("POST", "/gmail/send", tokenA, { donorId: "d_org_iso_b", to: "x@x.com", subject: "s", body: "b" });
  ok("A gmail/send to B's donor → 404 (guard before any send/insert)", gsend.status === 404);
  ok("no cross-org interaction planted on B's donor",
    (await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE donor_id='d_org_iso_b'`))[0].n === 0);
  ok("IDOR: A GET /donors/:idB → 404 (gates the org-scoped interactions read)",
    (await api("GET", "/donors/d_org_iso_b", tokenA)).status === 404);

  // ── BUILD-45 D-1 deep-link route /donors/:donorId (matrix coverage) ───────
  // The new client route /donors/:donorId (main.jsx) is a RequireOnboarded SPA
  // shell that, on mount, opens the donor via GET /donors/:id — so the ROUTE's
  // entire cross-tenant surface IS that API. Pin it here permanently: a foreign
  // id yields 404 (never 200 = a leak, never 500 = the id reached logic), and
  // the same route serves A's OWN donor (the deep-link must still work).
  const dlForeign = await api("GET", "/donors/d_org_iso_b", tokenA);
  ok("D-1 deep-link: A opening /donors/:idB resolves to GET /donors/:id → 404 (not 200/500)",
    dlForeign.status === 404, dlForeign.status);
  const dlOwn = await api("GET", "/donors/d_org_iso_a", tokenA);
  ok("D-1 deep-link: A opening /donors/:idA (own donor) → 200 (route not over-blocked)",
    dlOwn.status === 200 && dlOwn.body && dlOwn.body.id === "d_org_iso_a", dlOwn.status);

  // ── Tasks class (BUILD-13 resurfacing — donorId is now RENDERED) ──────────
  // A foreign donorId on a task would leak the donor's name/link cross-org, so
  // POST/PUT /tasks verify ownership before acting.
  const taskIdor = await api("POST", "/tasks", tokenA, { title: "leak", donorId: "d_org_iso_b" });
  ok("A POST /tasks with B's donorId → 404 (orgOwns guard)", taskIdor.status === 404, taskIdor.status);
  ok("no cross-org task planted with B's donor",
    (await q(`SELECT COUNT(*)::int AS n FROM tasks WHERE donor_id='d_org_iso_b'`))[0].n === 0);
  const taskOk = await api("POST", "/tasks", tokenA, { title: "ok", donorId: "d_org_iso_a" });
  ok("A CAN create a task on its OWN donor → 201", taskOk.status === 201, taskOk.status);
  await q(`DELETE FROM tasks WHERE org_id=$1`, [A]).catch(() => {});

  // ── Households / designations class (BUILD-14) ────────────────────────────
  // Household membership and designations carry a client-supplied donorId that
  // is joined/rendered — a foreign id would plant a cross-tenant household or
  // leak a donor. Both run through orgOwns / org-scoped membership checks.
  const hhIdor = await api("POST", "/households", tokenA, { memberIds: ["d_org_iso_a", "d_org_iso_b"] });
  ok("A POST /households incl. B's donor → 404 (no cross-tenant household)", hhIdor.status === 404, hhIdor.status);
  ok("no household planted with B's donor",
    (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE id='d_org_iso_b' AND household_id IS NOT NULL`))[0].n === 0);
  const dsgIdor = await api("POST", "/donors/d_org_iso_b/designations", tokenA, { kind: "estate" });
  ok("A POST designation on B's donor → 404 (orgOwns guard)", dsgIdor.status === 404, dsgIdor.status);
  ok("no designation planted on B's donor",
    (await q(`SELECT COUNT(*)::int AS n FROM donor_designations WHERE donor_id='d_org_iso_b'`))[0].n === 0);
  ok("A GET soft-credit on B's donor → 404", (await api("GET", "/donors/d_org_iso_b/soft-credit", tokenA)).status === 404);
  ok("A PUT color on B's user → 404", (await api("PUT", "/portfolio/officers/u_org_iso_b/color", tokenA, { color: "#1a6b4a" })).status === 404);

  // ── Finance class ─────────────────────────────────────────────────────────
  const txnsA = (await api("GET", "/finance/transactions", tokenA)).body || [];
  ok("A GET /finance/transactions excludes B's txn", !txnsA.some(t => t.id === "ft_org_iso_b"));
  ok("A GET /finance/transactions includes A's own", txnsA.some(t => t.id === "ft_org_iso_a"));

  ok("IDOR: A POST /finance/transactions with B's account → 404",
    (await api("POST", "/finance/transactions", tokenA, { date: TODAY, description: "x", amount: 5, type: "income", accountId: "acct_org_iso_b" })).status === 404);
  ok("IDOR: A POST /finance/transactions with B's fund → 404",
    (await api("POST", "/finance/transactions", tokenA, { date: TODAY, description: "x", amount: 5, type: "income", fundId: "fnd_org_iso_b" })).status === 404);
  ok("IDOR: A POST /finance/transactions with B's donor → 404",
    (await api("POST", "/finance/transactions", tokenA, { date: TODAY, description: "x", amount: 5, type: "income", donorId: "d_org_iso_b" })).status === 404);
  ok("IDOR: A POST /finance/budgets with B's account → 404",
    (await api("POST", "/finance/budgets", tokenA, { accountId: "acct_org_iso_b", year: 2026, amount: 100 })).status === 404);
  ok("IDOR: A PUT /gifts/:idA with B's fund_id → 404",
    (await api("PUT", "/gifts/g_org_iso_a", tokenA, { fund_id: "fnd_org_iso_b" })).status === 404);

  // delete: A's org-scoped delete must not remove B's transaction
  await api("DELETE", "/finance/transactions/ft_org_iso_b", tokenA);
  ok("A cannot delete B's transaction (row survives)", await txnExists("ft_org_iso_b"));

  // summary: A's cash-on-hand is its own ledger only (B's 88888 never leaks in)
  const sum = (await api("GET", "/finance/summary", tokenA)).body || {};
  ok("A /finance/summary cashOnHand = A's ledger only (B's amount absent)",
    Number(sum.cashOnHand) === 222, sum.cashOnHand);

  // ── Positive controls — the guard must NOT over-block A's own refs ─────────
  const good = await api("POST", "/finance/transactions", tokenA, { date: TODAY, description: "ok", amount: 5, type: "income", accountId: "acct_org_iso_a", fundId: "fnd_org_iso_a", donorId: "d_org_iso_a" });
  ok("A CAN post a txn with its OWN account/fund/donor → 201", good.status === 201, good.status);
  ok("A CAN link its OWN grant to its OWN program → 200",
    (await api("POST", "/programs/prg_org_iso_a/grants", tokenA, { grantId: "gr_org_iso_a" })).status === 200);

  await q(`DELETE FROM fin_transactions WHERE org_id=$1 AND description='ok'`, [A]).catch(() => {});
  await reset();
  // ── SALES-1 · the sales_ tables are on this suite's allowlist: no org_id, and no org route reads them ──
  const SALES_ALLOWLIST = /^sales_/;   // Steward's own sales CRM (/ops → Sales): no org's data
  const salesTables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  const withOrg = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  ok("SALES-1: the sales_ tables exist and none carries an org_id", salesTables.length >= 10 && salesTables.every(t => SALES_ALLOWLIST.test(t)) && withOrg.length === 0, { salesTables, withOrg });
  // Only server/admin/sales/ and its DDL name a sales_ table: no org route, export, seed or tenant query does.
  const fs = require("fs"), path = require("path");
  const ROOT = path.join(__dirname, "..");
  const readers = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "client", "tests", "docs", ".git", "dist", ".generated"].includes(e.name)) walk(p); }
    else if (/\.js$/.test(e.name) && /\bsales_(orgs|contacts|deals|links|activities|activity_links|pipelines|stages|stage_history|views|merges|imports|settings|properties|mailboxes|emails|email_links|partners|partner_terms|deal_partners|payouts|lists|list_members|cadences|cadence_enrollments|referral_links|quotes|customer_proof|nurture)\b/.test(fs.readFileSync(p, "utf8"))) readers.push(path.relative(ROOT, p));
  } };
  walk(ROOT);
  const allowed = f => f.startsWith("server/admin/sales/") || f === "server/db/ddl/sales1.js" || f === "server/db/ddl/sales1b.js" || f === "server/db/ddl/sales2.js" || f === "server/db/ddl/sales2b.js" || f === "server/db/ddl/sales3.js" || f === "server/db/ddl/sales3b.js" || f === "scripts/ops/staging-seed.js" || f.startsWith("scripts/ops/sales");
  ok("SALES-1: only the /ops sales routes, their DDL and the staging seed name a sales_ table", readers.every(allowed), readers.filter(f => !allowed(f)));
  await q(`INSERT INTO sales_orgs (id,name,domain,created_by,created_by_name) VALUES ('sor_iso_sentinel','Sentinel Sales Prospect','sentinel-iso.example.org','system:test','test') ON CONFLICT (id) DO NOTHING`);
  for (const p of ["/ops/sales/list/org", "/ops/sales/search?q=Sentinel", "/ops/sales/export/org", "/ops/sales/rec/org/sor_iso_sentinel", "/ops/sales/plans", "/ops/sales/deals/sde_iso_none/quotes", "/ops/sales/customers", "/ops/sales/health"]) {   // SALES-3: the quote routes too
    const r = await api("GET", p, tokenA);
    ok(`SALES-1: org admin A gets 404 on GET ${p}`, r.status === 404 && !/Sentinel Sales Prospect/.test(JSON.stringify(r.body || "")), r.status);
  }
  for (const p of ["/search?q=Sentinel", "/donors?search=Sentinel", "/export/all"]) {
    const r = await api("GET", p, tokenA);
    ok(`SALES-1: no org route shows a sales record (GET ${p})`, !/Sentinel Sales Prospect|sentinel-iso/.test(typeof r.body === "string" ? r.body : JSON.stringify(r.body || "")), r.status);
  }
  await q(`DELETE FROM sales_orgs WHERE id = 'sor_iso_sentinel'`);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

// tests/int2-send-once.test.js — INT-2. THE ONE GUARD THIS BUILD EARNED.
//
//     SENDING THE SAME PAYOUT TWICE CREATES EXACTLY ONE DEPOSIT IN THE
//     ACCOUNTING SYSTEM.
//
// A daily scheduled send, a person pressing Send, and a retry after a timeout
// are three things that happen to one payout on one afternoon. Two deposits
// for one payout DOUBLES a nonprofit's recorded revenue in its own books —
// which is worse than sending nothing, because nothing is visible and a
// doubled month is not until somebody reconciles against the bank.
//
// THE ACCOUNTING SYSTEM IS A LOCAL MOCK on :PORT, the same seam Stripe and
// Resend already use. It COUNTS every deposit it is asked to create and does
// no deduplication of its own, deliberately: if the mock forgave a second
// send, this suite would be testing the mock's manners rather than Steward's
// guarantee.
//
// WHAT IS ASSERTED:
//   §1  a payout whose lines do not foot to the bank is REFUSED, not rounded
//   §2  one send creates one deposit
//   §3  the same payout sent again creates NO second deposit, and says so
//   §4  ten concurrent sends of one payout still create one
//   §5  a send that FAILS at the vendor is not retried into a second deposit
//   §6  event and shop takings go as revenue lines, never as donations
//   §7  donor names are off by default and only appear when turned on
//
// HOW IT WOULD GO RED: drop the unique index on (org, vendor, payout); delete
// the ledger row when a send fails, which is what turns one deposit into two on
// the retry; or call the vendor before claiming the row. Verified by deleting
// the ledger row on failure, which turns §5 red.
//
// Standard scratch stack (tests/README.md), plus the mock this file starts.

const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_int2";
const ADMIN = "int2-admin@example.org";
const CONN = "bkc_int2";
const MOCK_PORT = Number(process.env.BOOKKEEPING_MOCK_PORT || 5632);

// The accounting system. It counts and it forgives nothing.
const created = [];
let mock;
function startMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/deposits")) {
          if (process.env.INT2_MOCK_FAIL === "1") { res.statusCode = 500; res.end(JSON.stringify({ error: "the accounting system fell over" })); return; }
          let body = {}; try { body = JSON.parse(b || "{}"); } catch { /* the mock is not the thing under test */ }
          const id = "QBD-" + (created.length + 1);
          created.push({ id, idempotencyKey: req.headers["idempotency-key"] || null, body });
          res.end(JSON.stringify({ id }));
          return;
        }
        if (req.method === "GET" && req.url.startsWith("/deposits")) {
          res.end(JSON.stringify({ deposits: created.map(c => ({ id: c.id, payoutId: c.body?.payoutId, netCents: c.body?.netCents })) }));
          return;
        }
        res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(MOCK_PORT, () => resolve(srv));
  });
}

const PAYOUT = { id: "po_int2_1", arrivedOn: "2026-09-20", netCents: 97000, sourceKey: "stripe" };
const GIFTS = [
  { id: "g_int2_1", donorName: "Perpetua Callowfield", fundId: "fnd_int2_gen", fundName: "General", amountCents: 50000, feeCents: 1500 },
  { id: "g_int2_2", donorName: "Caspian Threlfall", fundId: "fnd_int2_boat", fundName: "Boat", amountCents: 50000, feeCents: 1500 },
];
const MAPPING = {
  funds: { fnd_int2_gen: "acct_donations", fnd_int2_boat: "acct_boat" },
  classes: { fnd_int2_boat: "class_boat" },
  revenueAccounts: { raffle: "acct_event_income" },
  feeAccountId: "acct_fees",
  depositAccounts: { stripe: "bank_operating" },
};

// SEC-1 — THE FLAKE. reset() deletes and re-creates the admin, and a new
// users row's sessions_valid_after defaults to NOW(), so the token from the
// first sign-in is revoked by the suite's own reset whenever the run has
// crossed two seconds. On a quiet machine it had not; on a loaded CI shard it
// had, and §7 read session_revoked. Every reset now signs in again.
async function reset() {
  for (const t of ["bookkeeping_deposits", "bookkeeping_connections", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Int Two Trust','int-two',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_int2',$1,$2,$3,'Int Two Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_int2_gen',$1,'General',false)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_int2_boat',$1,'Boat',true)`, [ORG]);
  await q(`INSERT INTO bookkeeping_connections (id,org_id,vendor,status,realm_id,mapping,donor_names,created_by,created_by_name)
           VALUES ($1,$2,'quickbooks','active','realm-1',$3::jsonb,false,'system:test','int2 suite')`,
    [CONN, ORG, JSON.stringify(MAPPING)]);
  created.length = 0;
}

const send = (tok, payouts) => api("POST", `/bookkeeping/${CONN}/send`, tok, { payouts });
const ledger = () => q(`SELECT payout_id, status, COUNT(*)::int AS n FROM bookkeeping_deposits
                         WHERE org_id=$1 GROUP BY payout_id, status`, [ORG]);

(async () => {
  console.log("INT-2 — sending the same payout twice creates exactly one deposit\n");
  mock = await startMock();
  ok("the accounting-system mock is listening (without it this suite proves nothing)", !!mock, MOCK_PORT);
  process.env.INTUIT_API_BASE = `http://localhost:${MOCK_PORT}`;
  await reset();
  let tok = await login(ADMIN);

  // The server reads INTUIT_API_BASE from ITS OWN environment, so a suite that
  // only set it here would be sending nowhere. The boot recipe sets it; this
  // leg proves the server can actually reach the mock, and fails loudly rather
  // than passing quietly if it cannot.
  const probe = await send(tok, [{ payout: { ...PAYOUT, id: "po_int2_probe" }, gifts: GIFTS }]);
  const reachable = probe.status === 200 && (probe.body?.results || [])[0]?.status === "sent";
  ok("the server can reach the accounting system (INTUIT_API_BASE is set on the server)",
     reachable, probe.body);
  if (!reachable) { await closeDb(); if (mock) mock.close(); summary(); return; }
  await reset(); tok = await login(ADMIN);

  // ── §1 · A DEPOSIT THAT DOES NOT FOOT IS REFUSED ────────────────────────
  const wrong = await send(tok, [{ payout: { ...PAYOUT, netCents: 96000 }, gifts: GIFTS }]);
  ok("§1 a deposit whose lines do not match the bank is refused",
     wrong.status === 200 && wrong.body?.refused === 1 && wrong.body?.sent === 0, wrong.body);
  ok("§1 …and the refusal states the difference rather than rounding it",
     /does not|cannot account for|\$10/.test(wrong.body?.results?.[0]?.sentence || ""), wrong.body?.results?.[0]);
  ok("§1 …and nothing reached the accounting system", created.length === 0, created.length);

  // ── §2 · ONE SEND, ONE DEPOSIT ──────────────────────────────────────────
  const first = await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  ok("§2 the payout is sent", first.status === 200 && first.body?.sent === 1, first.body);
  ok("§2 …and the accounting system has exactly one deposit", created.length === 1, created.map(c => c.id));
  ok("§2 …carrying Steward's idempotency key, derived from the payout",
     created[0]?.idempotencyKey === "steward:payout:po_int2_1", created[0]?.idempotencyKey);
  ok("§2 …and its lines net to what arrived in the bank",
     created[0]?.body?.lines?.reduce((t, l) => t + l.amountCents, 0) === 97000, created[0]?.body?.lines);
  ok("§2 …with the fee as a NEGATIVE line, not a missing one",
     created[0]?.body?.lines?.some(l => l.kind === "fee" && l.amountCents === -3000), created[0]?.body?.lines);
  ok("§2 …and the restricted fund carrying its class",
     created[0]?.body?.lines?.some(l => l.fundId === "fnd_int2_boat" && l.classId === "class_boat"), created[0]?.body?.lines);

  // ── §3 · THE SAME PAYOUT AGAIN ──────────────────────────────────────────
  const second = await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  ok("§3 the second send reports it as already sent", second.body?.alreadySent === 1 && second.body?.sent === 0, second.body);
  ok("§3 …AND THE ACCOUNTING SYSTEM STILL HAS EXACTLY ONE DEPOSIT",
     created.length === 1, created.map(c => c.id));
  const rows = await ledger();
  ok("§3 …with one ledger row for the payout, not two",
     rows.filter(r => r.payout_id === PAYOUT.id).reduce((t, r) => t + r.n, 0) === 1, rows);

  // ── §4 · TEN AT ONCE ────────────────────────────────────────────────────
  // A scheduled run and a person pressing Send at the same moment.
  await reset(); tok = await login(ADMIN);
  const burst = await Promise.all(Array.from({ length: 10 }, () => send(tok, [{ payout: PAYOUT, gifts: GIFTS }])));
  const sentCount = burst.filter(r => r.body?.sent === 1).length;
  ok("§4 ten simultaneous sends of one payout create ONE deposit",
     created.length === 1, { deposits: created.length, sends: sentCount });
  ok("§4 …and exactly one of the ten reports it sent it",
     sentCount === 1, burst.map(r => r.body?.sent));

  // ── §5 · A SEND THAT FAILED IS NOT RETRIED INTO A SECOND DEPOSIT ────────
  await reset(); tok = await login(ADMIN);
  process.env.INT2_MOCK_FAIL = "1";
  const failed = await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  process.env.INT2_MOCK_FAIL = "";
  ok("§5 a vendor failure is reported, not swallowed",
     failed.body?.refused === 1 && failed.body?.results?.[0]?.status === "failed", failed.body);
  const afterFail = await ledger();
  ok("§5 …and the ledger row is KEPT, because a failure is not proof nothing landed",
     afterFail.some(r => r.payout_id === PAYOUT.id), afterFail);
  const retry = await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  ok("§5 …so the retry is the SAME payout, not a second one",
     retry.body?.alreadySent === 1 && created.length === 0, { retry: retry.body, deposits: created.length });

  // ── §6 · EVENT AND SHOP TAKINGS ARE NOT DONATIONS ──────────────────────
  await reset(); tok = await login(ADMIN);
  const withRevenue = await send(tok, [{
    payout: { id: "po_int2_2", arrivedOn: "2026-09-21", netCents: 7500, sourceKey: "stripe" },
    gifts: [], revenue: [{ category: "raffle", amountCents: 7500, eventName: "Harbor Gala" }] }]);
  ok("§6 register takings send", withRevenue.body?.sent === 1, withRevenue.body);
  const revLines = created[0]?.body?.lines || [];
  ok("§6 …as a revenue line", revLines.some(l => l.kind === "revenue" && l.accountId === "acct_event_income"), revLines);
  ok("§6 …and NOT to the donations account, ever",
     !revLines.some(l => l.accountId === "acct_donations"), revLines);

  // ── §7 · DONOR NAMES ARE OFF UNTIL SOMEBODY TURNS THEM ON ──────────────
  await reset(); tok = await login(ADMIN);
  await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  const off = JSON.stringify(created[0]?.body?.lines || []);
  ok("§7 by default no donor's name leaves for the accounting system",
     !off.includes("Perpetua") && !off.includes("Threlfall"), off.slice(0, 200));
  await reset(); tok = await login(ADMIN);
  const turnedOn = await api("PUT", `/bookkeeping/${CONN}/mapping`, tok, { mapping: MAPPING, donorNames: true });
  ok("§7 the organisation can turn them on", turnedOn.status === 200 && turnedOn.body?.donorNames === true, turnedOn.body);
  await send(tok, [{ payout: PAYOUT, gifts: GIFTS }]);
  ok("§7 …and then they do", JSON.stringify(created[0]?.body?.lines || []).includes("Perpetua"),
     created[0]?.body?.lines);

  await reset(); tok = await login(ADMIN);
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); if (mock) mock.close(); process.exit(1); });

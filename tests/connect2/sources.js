// tests/connect2/sources.js: CONNECT-2 Part 1. GIVEBUTTER, SQUARE AND ZEFFY
// MEET THE BAR A FIRST REAL ORGANISATION NEEDS.
//
// Against stand-ins shaped like each provider's documented list response
// (Givebutter GET /v1/transactions, Square GET /v2/payments, Zeffy GET
// /api/v1/payments), driven through the real connect route and the real
// "Check now" route:
//   §1  Each provider records ONE gift with the gross, the fee and the net,
//       on the fund the org chose; a second read records nothing new.
//   §2  ONE BAD ROW NEVER BREAKS THE RUN. A Givebutter row the database
//       refuses, and one with a date nobody can read, are skipped and LISTED
//       with the reason; the good rows around them still land and the run
//       reports success.
//   §3  A gift already on file from Steward's own Stripe is never written a
//       second time when it also arrives through Givebutter: it becomes the
//       one question to answer.
//       Nor is a payment already imported from the provider's own export
//       file (bare id, same amount): the API's key joins that gift.
//   §4  The donor is matched by email, then by name: a Zeffy row with no
//       email lands on the one person of that name, not on a new record.
//   §5  "Ask me each time" is real: a source with no fund leaves the gift
//       without one and the card lists it to choose; choosing sets it.
//   §6  Disconnect keeps every gift already read.
//
// HOW IT GOES RED (each was run against main first): without the per-row
// catch in syncSource the NUL-byte row fails the whole run (§2); without the
// Stripe arm of findCrossSourceGift the Givebutter copy is a second gift (§3);
// without the name arm of resolveSourceDonor Harriet becomes two people (§4).

const http = require("http");
const bcrypt = require("bcryptjs");

const ORG = "org_c2src";
const ADMIN = "admin@c2src-fixture.org";
const DOMAIN = "c2src-fixture.org";
const E = n => `${n}@${DOMAIN}`;
const TABLES = ["merge_proposals", "data_health_dismissals", "data_health_runs", "gift_duplicate_questions", "giving_recurring", "imports", "threads", "tasks", "interactions",
                "fin_transactions", "gifts", "giving_sources", "donors", "budgets", "accounts", "fin_funds", "users"];

const civil = d => d.toISOString().slice(0, 10);
const DAY = civil(new Date(Date.now() - 3 * 86400000));
const ISO = `${DAY}T15:04:05Z`;

// ── THE STAND-INS ──────────────────────────────────────────────────────────
// Shapes from each provider's own documentation (named in docs/connect-2/).
const seen = [];
const GIVEBUTTER = [
  // The database refuses a NUL byte in text. Before CONNECT-2 this one row
  // failed the whole run, and every gift after it was never read.
  { id: "gbt_nul", amount: 30, fee: 1.17, donated: 28.83, status: "succeeded", created_at: ISO,
    first_name: "Nora", last_name: "Vance", email: E("nora"), campaign_title: "Fall\u0000drive" },
  { id: "gbt_1", amount: 50, fee: 2.05, fee_covered: 0, donated: 50, payout: 47.95, status: "succeeded",
    transacted_at: ISO, created_at: ISO, transactions: [{ id: "gbt_1a", amount: 50, refunded: null, captured: true }],
    first_name: "Ada", last_name: "Brooks", email: E("ada"), campaign_title: "Fall drive" },
  // A date nobody can read: refused, never guessed.
  { id: "gbt_baddate", amount: 20, fee: 0.88, status: "succeeded", created_at: "10/05/2026",
    first_name: "Ben", last_name: "Cole", email: E("ben") },
  // Already on file from Steward's own Stripe (same donor, amount and day).
  { id: "gbt_stripe_copy", amount: 75, fee: 2.48, status: "succeeded", created_at: ISO,
    first_name: "Cleo", last_name: "Diaz", email: E("cleo") },
];
// Zeffy's documented payment: `amount` in CENTS, `created` in unix seconds,
// no fee field. Read as dollars this is a $4,000 gift.
const ZEFFY = [
  { id: "zf_1", object: "payment", created: Math.floor(Date.parse(ISO) / 1000), amount: 4000, currency: "usd",
    status: "succeeded", type: "online", refund_status: "none", description: "Fall drive",
    buyer: { first_name: "Harriet", last_name: "Lowe" }, recurring: { is_recurring: false } },
  // Already imported from Zeffy's Payments export, under the bare id.
  { id: "zf_2", object: "payment", created: Math.floor(Date.parse(ISO) / 1000), amount: 3000, currency: "usd",
    status: "succeeded", refund_status: "none", buyer: { email: E("ines"), first_name: "Ines", last_name: "Park" } },
];
const SQUARE = [
  { id: "sq_1", location_id: "LOC_GIVING", status: "COMPLETED", created_at: ISO, source_type: "CARD",
    total_money: { amount: 2500, currency: "USD" }, amount_money: { amount: 2500, currency: "USD" },
    processing_fee: [{ amount_money: { amount: 103, currency: "USD" } }],
    buyer_email_address: E("sam"), note: "Donation" },
  // A lesson fee at another location is not a gift.
  { id: "sq_lesson", location_id: "LOC_SHOP", status: "COMPLETED", created_at: ISO, source_type: "CARD",
    total_money: { amount: 4500, currency: "USD" }, buyer_email_address: E("lesson") },
];

function mock(req, res) {
  const url = new URL(req.url, "http://x");
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  seen.push(`${req.method} ${url.pathname}`);
  if (req.method !== "GET") return send(405, { message: "read only" });
  const p = url.pathname;
  if (p === "/givebutter/v1/transactions")
    return send(200, { data: GIVEBUTTER, links: { next: null }, meta: { current_page: 1, last_page: 1, per_page: 100 } });
  if (p === "/givebutter/v1/plans") return send(200, { data: [], meta: { last_page: 1 } });
  if (p === "/zeffy/api/v1/payments") return send(200, { object: "list", data: ZEFFY, has_more: false, next_cursor: null });
  if (p === "/square/v2/payments") return send(200, { payments: SQUARE });
  return null;
}

// Data health runs after every import (CLEAN-1) and lands a moment after the
// check answers, so the org row is retried rather than left behind.
async function reset(q) {
  for (let i = 0; i < 6; i++) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) return;
    await new Promise(r => setTimeout(r, 300));
  }
}

async function run({ ok, login, api, q, mockPort }) {
  const server = http.createServer((req, res) => { if (mock(req, res) === null) { res.writeHead(404); res.end("{}"); } });
  await new Promise((r, j) => server.once("error", j).listen(mockPort, r));
  try {
    await reset(q);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,'C2 Sources','c2-sources',1,'active','team')`, [ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ('u_c2src',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_c2_gen',$1,'General',false),
             ('ff_c2_bld',$1,'Building',true)`, [ORG]);
    // §3's Stripe gift, as the donation webhook leaves it: no source, a payment id.
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,created_by,created_by_name)
             VALUES ('d_c2_cleo',$1,'Cleo Diaz',$2,'active','steward',75,1,'system:test','test'),
                    ('d_c2_harriet',$1,'Harriet Lowe',NULL,'active','steward',0,0,'system:test','test')`, [ORG, E("cleo")]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,stripe_payment_id,created_by,created_by_name)
             VALUES ('g_c2_stripe',$1,'d_c2_cleo',75,$2,'cash','pi_c2_cleo','system:test','test')`, [ORG, DAY]);
    // §3b's gift, as the file import leaves it: the provider's bare id.
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,created_by,created_by_name)
             VALUES ('d_c2_ines',$1,'Ines Park',$2,'active','steward',30,1,'system:test','test')`, [ORG, E("ines")]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,external_id,created_by,created_by_name)
             VALUES ('g_c2_file',$1,'d_c2_ines',30,$2,'cash','zf_2','system:test','test')`, [ORG, DAY]);
    const tok = await login(ADMIN);

    // ── connect all three through the real route ───────────────────────────
    const connect = async (provider, credentials, config) =>
      (await api("POST", "/giving-sources", tok, { provider, credentials, defaultFundId: "ff_c2_gen", config })).body;
    const gb = await connect("givebutter", { apiKey: "gb_test_key" });
    const zf = await connect("zeffy", { apiKey: "zf_test_key" });
    const sq = await connect("square", { accessToken: "sq_test_token" }, { locationIds: ["LOC_GIVING"] });
    ok("§0 all three connect", gb.id && zf.id && sq.id, JSON.stringify({ gb, zf, sq }));
    // §5: Zeffy is set to "Ask me each time".
    await api("PATCH", `/giving-sources/${zf.id}`, tok, { defaultFundId: null });

    const check = async id => (await api("POST", `/giving-sources/${id}/sync`, tok, {})).body;
    const gb1 = await check(gb.id), zf1 = await check(zf.id), sq1 = await check(sq.id);

    // ── §2 one bad row never breaks the run ────────────────────────────────
    ok("§2 the Givebutter run succeeds despite two bad rows", gb1.ok === true, JSON.stringify(gb1).slice(0, 400));
    const skipped = gb1.skipped || [];
    ok("§2 the NUL-byte row is listed with a reason", skipped.some(s => s.externalId === "gbt_nul" && s.reason),
      JSON.stringify(skipped));
    ok("§2 the unreadable date is listed with a reason", skipped.some(s => s.externalId === "gbt_baddate" && /date/i.test(s.reason)),
      JSON.stringify(skipped));
    const [nul] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND external_id='givebutter:gbt_nul'`, [ORG]);
    ok("§2 the bad row wrote nothing", nul.n === 0);

    // ── §1 one gift each, gross, fee, net, fund ────────────────────────────
    const gift = async key => (await q(
      `SELECT ROUND(amount::numeric*100)::int AS gross, ROUND(processor_fee_amount::numeric*100)::int AS fee,
              fund_id, donor_id FROM gifts WHERE org_id=$1 AND external_id=$2`, [ORG, key]));
    const [g1] = await gift("givebutter:gbt_1");
    ok("§1 Givebutter: one gift, $50.00 gross, $2.05 fee, $47.95 net, General",
      g1 && g1.gross === 5000 && g1.fee === 205 && g1.gross - g1.fee === 4795 && g1.fund_id === "ff_c2_gen", JSON.stringify(g1));
    const [s1] = await gift("square:sq_1");
    ok("§1 Square: one gift, $25.00 gross (minor units), $1.03 fee, $23.97 net",
      s1 && s1.gross === 2500 && s1.fee === 103 && s1.gross - s1.fee === 2397 && s1.fund_id === "ff_c2_gen", JSON.stringify(s1));
    const [lesson] = await gift("square:sq_lesson");
    ok("§1 Square: the lesson fee at the shop location is not a gift", !lesson);
    const [z1] = await gift("zeffy:zf_1");
    ok("§1 Zeffy: one gift, $40.00 gross, no fee (Zeffy takes none), $40.00 net",
      z1 && z1.gross === 4000 && z1.fee === 0, JSON.stringify(z1));
    ok("§1 Square and Zeffy runs succeed", sq1.ok === true && zf1.ok === true, JSON.stringify({ sq1, zf1 }).slice(0, 300));

    const gb2 = await check(gb.id), zf2 = await check(zf.id), sq2 = await check(sq.id);
    const [{ n: total }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND giving_source_id IS NOT NULL`, [ORG]);
    ok("§1 a second read records nothing new", gb2.giftsCreated === 0 && zf2.giftsCreated === 0 && sq2.giftsCreated === 0 && total === 3,
      JSON.stringify({ gb2: gb2.giftsCreated, zf2: zf2.giftsCreated, sq2: sq2.giftsCreated, total }));

    // ── §3 also arriving through Stripe ────────────────────────────────────
    const [{ n: cleoGifts }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id='d_c2_cleo'`, [ORG]);
    ok("§3 the Stripe gift is not written a second time", cleoGifts === 1, `Cleo has ${cleoGifts} gifts`);
    const [dq] = await q(`SELECT existing_gift_id, sentence FROM gift_duplicate_questions WHERE org_id=$1 AND external_key='givebutter:gbt_stripe_copy'`, [ORG]);
    ok("§3 it becomes the one question, naming Stripe", dq && dq.existing_gift_id === "g_c2_stripe" && /Stripe/.test(dq.sentence),
      JSON.stringify(dq));

    const [{ n: inesGifts }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id='d_c2_ines'`, [ORG]);
    ok("§3 a Zeffy payment already imported from Zeffy's export is not written again", inesGifts === 1, `Ines has ${inesGifts} gifts`);

    // ── §4 email, then name: one record per person ─────────────────────────
    const harriets = await q(`SELECT id FROM donors WHERE org_id=$1 AND lower(name)='harriet lowe' AND deleted_at IS NULL`, [ORG]);
    ok("§4 the Zeffy gift lands on the Harriet Lowe already on file", harriets.length === 1 && z1 && z1.donor_id === "d_c2_harriet",
      JSON.stringify({ harriets, donor: z1 && z1.donor_id }));

    // ── §5 ask me each time ────────────────────────────────────────────────
    ok("§5 the 'ask' source left the fund empty", z1 && z1.fund_id === null, JSON.stringify(z1));
    const list = (await api("GET", "/giving-sources", tok)).body;
    const zrow = (list.sources || []).find(s => s.id === zf.id) || {};
    ok("§5 the card lists the gift waiting for a fund", (zrow.needsFund || []).some(x => x.externalId === "zf_1"),
      JSON.stringify(zrow.needsFund));
    ok("§5 the picker lists the org's funds", (list.funds || []).map(f => f.id).sort().join() === "ff_c2_bld,ff_c2_gen",
      JSON.stringify(list.funds));
    const giftId = ((zrow.needsFund || [])[0] || {}).giftId;
    const chose = await api("POST", `/giving-sources/${zf.id}/fund`, tok, { giftId, fundId: "ff_c2_bld" });
    const [z2] = await gift("zeffy:zf_1");
    ok("§5 choosing a fund sets it on the gift", chose.status === 200 && z2 && z2.fund_id === "ff_c2_bld", JSON.stringify(chose.body));
    const other = await api("POST", `/giving-sources/${zf.id}/fund`, tok, { giftId: "g_c2_stripe", fundId: "ff_c2_bld" });
    ok("§5 a gift from another source cannot be set through this card", other.status === 404, String(other.status));

    // ── the card says what it found ────────────────────────────────────────
    const grow = (list.sources || []).find(s => s.id === gb.id) || {};
    ok("§1 the card carries the last read time and what it found",
      grow.lastSyncedAt && /read/i.test(grow.lastRun?.sentence || "") && (grow.lastRun?.skipped || []).length >= 2,
      JSON.stringify(grow.lastRun));

    // ── §6 disconnect keeps what was read ──────────────────────────────────
    const del = await api("DELETE", `/giving-sources/${gb.id}`, tok);
    const [{ n: kept }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND giving_source_id=$2`, [ORG, gb.id]);
    ok("§6 disconnect keeps every gift already read", del.status === 200 && kept === 1, `kept ${kept}`);

    ok("§0 Steward only ever read from the providers", seen.length > 0 && seen.every(s => s.startsWith("GET ")), seen.join(", "));
  } finally {
    await new Promise(r => server.close(r));
    await reset(q);
  }
}

module.exports = { run };

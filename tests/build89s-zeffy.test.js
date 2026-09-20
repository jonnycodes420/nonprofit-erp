// BUILD-89S 89c — ZEFFY. Run: node tests/build89s-zeffy.test.js
//
//   §1  THE FIELD TABLE. The exact field names on a Zeffy payment could not be
//       read without an account, so the adapter declares its candidates in one
//       table and this section proves EVERY candidate resolves. When a real
//       payload arrives, a wrong guess fails here by name instead of arriving
//       as a silently empty donor.
//   §2  WHAT IS NOT A GIFT. Money out, a pending payment, a refund, a payment
//       with no id — each dropped with its reason named.
//   §3  THE CURSOR. Every payment comes back exactly once across pages, and a
//       page whose cursor is absent ends the walk.
//   §4  429 IS SLOWED DOWN, NOT SURFACED. The run should pause, not stop.
//   §5  ZERO NON-GET REQUESTS. Zeffy's public API is read-only by its own
//       documentation; Steward's guarantee does not depend on that staying so.
//   §6  THE CONNECT SCREEN.

const { ok, summary } = require("./helpers");
const reg = require("../sources");
const z = require("../sources/zeffy.js");

const CREDS = { apiKey: "zk_live_testkey_0123456789" };
const http = f => reg.readOnlyHttp("zeffy", { fetchImpl: f });
// The suite must not actually wait out the 650ms pacing gap on every request.
const nosleep = async () => {};

// A fake Zeffy: a cursor->page table, every request recorded, and an optional
// run of 429s before the first good answer.
function fakeZeffy({ pages = {}, rateLimitTimes = 0, fail = null } = {}) {
  const seen = [];
  let limited = 0;
  const fetchImpl = async (url, init = {}) => {
    seen.push({ method: (init.method || "GET").toUpperCase(), url: String(url), auth: init.headers?.Authorization });
    if (fail) return new Response(JSON.stringify(fail.body), { status: fail.status });
    if (limited < rateLimitTimes) {
      limited++;
      return new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 });
    }
    const u = new URL(String(url));
    const cur = u.searchParams.get(z.CURSOR_PARAM) || "";
    const page = pages[cur] || { payments: [], has_more: false, next_cursor: null };
    return new Response(JSON.stringify(page), { status: 200 });
  };
  return { fetchImpl, seen };
}

// Every candidate spelling in FIELD_MAP, used to build one payment per
// spelling so §1 can prove the table is real rather than decorative.
function paymentUsing(spellings) {
  const p = {};
  const set = (path, v) => {
    const parts = path.split(".");
    let cur = p;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ||= {});
    cur[parts[parts.length - 1]] = v;
  };
  set(spellings.externalId, "zp_00001");
  set(spellings.occurredAt, "2026-08-14T10:30:00.000Z");
  set(spellings.amount, 125);
  set(spellings.donorEmail, "rosa@example.org");
  return p;
}

(async () => {
  // ══ §1 · THE FIELD TABLE IS REAL ═════════════════════════════════════════
  console.log("\n— §1 · every candidate spelling in the table resolves —");
  const canonical = {
    id: "zp_00001",
    createdAtUtc: "2026-08-14T10:30:00.000Z",
    amount: 125,
    feeAmount: 3.92,
    currency: "USD",
    buyer: { firstName: "Rosa", lastName: "Alvarez", email: "Rosa@Example.org" },
    recurringPaymentId: "rp_9f2",
    status: "succeeded",
    campaignName: "Autumn appeal",
  };
  const m = z.mapPayment(canonical);
  ok("a canonical payment becomes a contract row",
    m.row?.externalId === "zp_00001" && m.row.amountCents === 12500, m);
  ok("the fee is read and stored in cents", m.row.feeCents === 392, m.row.feeCents);
  ok("the date is the civil day", m.row.occurredAt === "2026-08-14", m.row.occurredAt);
  ok("first and last name are joined", m.row.donorName === "Rosa Alvarez", m.row.donorName);
  ok("Zeffy's own recurring id is carried", m.row.recurringRef === "rp_9f2");
  ok("the campaign name becomes the memo", m.row.memo === "Autumn appeal");

  // THE PROPERTY THIS SECTION EXISTS FOR: the table is not decoration. Each
  // declared candidate must actually be read by the mapper.
  let tableProven = 0, tableFailed = [];
  for (const field of ["externalId", "occurredAt", "amount", "donorEmail"]) {
    for (const spelling of z.FIELD_MAP[field]) {
      const p = paymentUsing({
        externalId: field === "externalId" ? spelling : "id",
        occurredAt: field === "occurredAt" ? spelling : "createdAtUtc",
        amount: field === "amount" ? spelling : "amount",
        donorEmail: field === "donorEmail" ? spelling : "buyer.email",
      });
      const out = z.mapPayment(p);
      if (out.row && out.row.externalId === "zp_00001" && out.row.amountCents === 12500
          && out.row.occurredAt === "2026-08-14" && out.row.donorEmail === "rosa@example.org") tableProven++;
      else tableFailed.push(`${field}.${spelling}`);
    }
  }
  ok(`every declared candidate for id, date, amount and email is actually read (${tableProven})`,
    tableFailed.length === 0, tableFailed);

  // The alternate name shapes.
  ok("an organisation's whole name is used when there is no first/last pair",
    z.mapPayment({ ...canonical, buyer: { name: "Harbor Music School", email: "x@y.org" } }).row.donorName
      === "Harbor Music School");
  ok("money may arrive as a decimal string and still lands in exact cents",
    z.mapPayment({ ...canonical, amount: "1,250.75" }).row.amountCents === 125075);
  ok("...or as an object carrying its own amount",
    z.mapPayment({ ...canonical, amount: { amount: 40, currency: "USD" } }).row.amountCents === 4000);
  ok("a recurring FLAG with no id is not an identity — no ref is invented",
    z.mapPayment({ ...canonical, recurringPaymentId: undefined, isRecurring: true }).row.recurringRef === null);

  // ══ §2 · WHAT IS NOT A GIFT ══════════════════════════════════════════════
  console.log("\n— §2 · not every payment row is a gift —");
  ok("a payment with no id is refused — it could never de-duplicate",
    z.mapPayment({ amount: 10 }).drop === "no_external_id");
  ok("money out is refused", z.mapPayment({ ...canonical, amount: -50 }).drop === "not_money_in");
  ok("a zero payment is refused", z.mapPayment({ ...canonical, amount: 0 }).drop === "not_money_in");
  ok("a pending payment is held for the next sync, not written",
    z.mapPayment({ ...canonical, status: "pending" }).drop === "pending");
  ok("an unreadable amount is refused rather than guessed",
    z.mapPayment({ ...canonical, amount: "n/a" }).drop === "bad_amount");
  ok("an unreadable date is refused — a guess is the wrong tax year",
    z.mapPayment({ ...canonical, createdAtUtc: "14/08/2026" }).drop === "bad_date");
  ok("a refunded payment comes back marked refunded for 89a to count and name",
    z.mapPayment({ ...canonical, status: "refunded" }).row.status === "refunded");
  ok("...and so does one marked only by a refund timestamp",
    z.mapPayment({ ...canonical, refundedAt: "2026-08-20T00:00:00Z" }).row.status === "refunded");
  ok("a failed payment is failed, not a gift",
    z.mapPayment({ ...canonical, status: "declined" }).row.status === "failed");

  // ══ §3 · THE CURSOR ══════════════════════════════════════════════════════
  console.log("\n— §3 · every payment once, across pages —");
  const mk = (n, i) => ({ ...canonical, id: `zp_${String(i).padStart(5, "0")}`, amount: n });
  const zz = fakeZeffy({
    pages: {
      "": { payments: [mk(10, 1), mk(20, 2)], has_more: true, next_cursor: "cur_A" },
      cur_A: { payments: [mk(30, 3), mk(40, 4)], has_more: true, next_cursor: "cur_B" },
      cur_B: { payments: [mk(50, 5)], has_more: false, next_cursor: null },
    },
  });
  const h3 = http(zz.fetchImpl);
  let cursor = null, done = false, guard = 0;
  const seenIds = [];
  while (!done && guard++ < 10) {
    const out = await z.fetchRows({ credentials: CREDS, cursor, http: h3, today: "2026-08-20", backfill: true, sleep: nosleep });
    seenIds.push(...out.rows.map(r => r.externalId));
    cursor = out.cursor; done = out.done;
  }
  ok("the walk ends by itself, in one call per page", done && guard === 3, { guard, done });
  ok("five payments came back", seenIds.length === 5, seenIds);
  ok("every payment came back EXACTLY once", new Set(seenIds).size === 5, seenIds);
  ok("the cursor was actually sent on the second and third requests",
    zz.seen.filter(r => r.url.includes(`${z.CURSOR_PARAM}=cur_`)).length === 2,
    zz.seen.map(r => r.url));
  ok("a page with no cursor ends the walk rather than looping on itself",
    zz.seen.length === 3, zz.seen.length);
  // The response field casing is not confirmed, so both spellings are read.
  ok("camelCase paging fields are read too (the casing is not confirmed)",
    z.readCursor({ hasMore: true, nextCursor: "c1" }).more === true
    && z.readCursor({ has_more: true, next_cursor: "c1" }).next === "c1");
  ok("a page whose items ride a different key is still read",
    z.readItems({ data: [1, 2] }).length === 2 && z.readItems({ payments: [1] }).length === 1
    && z.readItems([1, 2, 3]).length === 3);

  // ══ §4 · 429 ═════════════════════════════════════════════════════════════
  console.log("\n— §4 · a rate limit slows the run down; it does not stop it —");
  const z4 = fakeZeffy({
    rateLimitTimes: 2,
    pages: { "": { payments: [mk(10, 1)], has_more: false, next_cursor: null } },
  });
  const out4 = await z.fetchRows({ credentials: CREDS, cursor: null, http: http(z4.fetchImpl), today: "2026-08-20", sleep: nosleep });
  ok("two 429s are retried and the page is read", out4.rows.length === 1, out4);
  ok("...and it took three requests to get there", z4.seen.length === 3, z4.seen.length);

  const z4b = fakeZeffy({ rateLimitTimes: 99, pages: {} });
  let limitErr = null;
  try { await z.fetchRows({ credentials: CREDS, cursor: null, http: http(z4b.fetchImpl), today: "2026-08-20", sleep: nosleep }); }
  catch (e) { limitErr = e; }
  ok("a provider that keeps refusing eventually throws, rather than retrying forever",
    !!limitErr && limitErr.status === 429, limitErr?.message);
  ok("and it stopped after the declared number of retries",
    z4b.seen.length === z.RATE_LIMIT_RETRIES + 1, z4b.seen.length);

  // ══ §5 · READ ONLY ═══════════════════════════════════════════════════════
  console.log("\n— §5 · zero non-GET requests —");
  const everySeen = [...zz.seen, ...z4.seen, ...z4b.seen];
  ok("every request this adapter made was a GET",
    everySeen.length > 0 && everySeen.every(r => r.method === "GET"),
    everySeen.filter(r => r.method !== "GET").map(r => `${r.method} ${r.url}`));
  ok("the key rode the Authorization header as a Bearer token, never the query string",
    everySeen.every(r => r.auth === `Bearer ${CREDS.apiKey}` && !r.url.includes(CREDS.apiKey)));
  // Steward's guarantee is Steward's, not Zeffy's current endpoint list.
  let wrote = "allowed";
  try { await http(zz.fetchImpl)("https://api.zeffy.com/api/v1/payments/zp_1", { method: "DELETE" }); }
  catch (e) { wrote = e.code; }
  ok("and the handle refuses a write even though Zeffy has no write endpoint to hit",
    wrote === "PROVIDER_WRITE_REFUSED", wrote);

  // ══ §6 · THE CONNECT SCREEN ══════════════════════════════════════════════
  console.log("\n— §6 · Test reads seven days and writes nothing —");
  const z6 = fakeZeffy({
    pages: { "": { payments: [mk(10, 1), mk(20, 2), { ...canonical, id: "zp_r", status: "refunded" }], has_more: false } },
  });
  const t = await z.testCredentials({ credentials: CREDS, http: http(z6.fetchImpl), today: "2026-08-20", sleep: nosleep });
  ok("it counts only what actually came in", t.ok && t.count === 2 && t.totalCents === 3000, t);
  ok("it asked for the last seven days",
    z6.seen[0].url.includes("from=2026-08-13") && z6.seen[0].url.includes("to=2026-08-20"), z6.seen[0].url);

  const z6b = fakeZeffy({ fail: { status: 401, body: { message: "Invalid API key" } } });
  let keyErr = null;
  try { await z.testCredentials({ credentials: CREDS, http: http(z6b.fetchImpl), today: "2026-08-20", sleep: nosleep }); }
  catch (e) { keyErr = e; }
  ok("a refused key THROWS rather than reporting a quiet week",
    !!keyErr && keyErr.status === 401, keyErr?.message);

  const lib = await import("../shared/givingSources.js");
  ok("the connect screen tells an admin exactly where the key lives",
    /Settings.*Integrations.*API/i.test(lib.PROVIDERS.zeffy.help), lib.PROVIDERS.zeffy.help);

  summary();
})();

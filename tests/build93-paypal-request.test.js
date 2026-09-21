// BUILD-93 Part 3 — THE EXACT REQUEST SHAPE PayPal IS ASKED FOR.
//
// The demo org's PayPal source authenticated and then took a 400
// INVALID_REQUEST from /v1/reporting/transactions on every sync, with the
// generic body "Request is not well-formed, syntactically incorrect, or
// violates schema".
//
// THE CAUSE, checked against PayPal's own reference rather than remembered:
// `page` has a MINIMUM OF 1 and a DEFAULT OF 1. The adapter sent page=0 on
// the first request of every window. A page=0 is not an empty first page, it
// is a schema violation - which is exactly the sentence PayPal returned. The
// adapter's own header comment said "pages 0-indexed", and that line is what
// the code was written from.
//
// Checked at the same time and NOT the cause, recorded so the next person does
// not re-check them: the date pattern accepts a trailing `Z`
// (`(\[Zz\]|\[+-\]\[0-9\]{2}:\[0-9\]{2})`), so `...T00:00:00Z` is valid; and
// the window was already clamped to PayPal's documented 31 days. What WAS also
// wrong: the backfill walked 38 windows of 31 days = 1,178 days, past the
// documented "previous three years", so its final windows could only ever be
// refused.
//
// No network. The adapter is handed a recorded-response fetch, which is the
// same seam every other source suite uses.

const path = require("path");
const { ok, summary } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const TODAY = "2026-09-20";
const CREDS = { clientId: "AX_test_client", clientSecret: "EL_test_secret" };

// Every request the adapter makes, in order, so the suite can assert the
// SHAPE rather than trust the adapter's description of itself.
function recorder(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, method: (init.method || "GET").toUpperCase(), path: u.pathname });
    return responder(u, init);
  };
  return { calls, fetchImpl };
}
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const TOKEN_OK = () => json(200, { access_token: "A21.tok", token_type: "Bearer", expires_in: 32400 });

// PayPal's real shape for a schema violation: the generic message at the top,
// and the field named in details[].
const SCHEMA_VIOLATION = (field, issue) => json(400, {
  name: "INVALID_REQUEST",
  message: "Request is not well-formed, syntactically incorrect, or violates schema.",
  debug_id: "b7c0f0d9e1a22",
  details: [{ field, location: "query", issue, description: `The value of ${field} is invalid.` }],
});

(async () => {
  const sources = require(path.join(ROOT, "sources", "index.js"));
  const paypal = require(path.join(ROOT, "sources", "paypal.js"));

  // ── §1 · the page index, which is the whole bug ──────────────────────────
  console.log("— §1 · the first page PayPal is asked for —");
  {
    const { calls, fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : json(200, { transaction_details: [], total_pages: 1 }));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    await paypal.fetchRows({ credentials: CREDS, since: "2026-09-01", until: TODAY, http, today: TODAY });

    const report = calls.find(c => c.path.includes("/v1/reporting/transactions"));
    ok("the reporting call is made", !!report, calls.map(c => c.path));
    const page = report.url.searchParams.get("page");
    ok("the FIRST page requested is 1, not 0 — PayPal's minimum is 1", page === "1", page);
    ok("...and it is an integer, not blank", /^[0-9]+$/.test(page), page);
  }

  // ── §2 · the rest of the query, checked against the documented pattern ───
  console.log("\n— §2 · the window and the dates —");
  {
    const { calls, fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : json(200, { transaction_details: [], total_pages: 1 }));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    await paypal.fetchRows({ credentials: CREDS, since: "2026-09-01", until: TODAY, http, today: TODAY });
    const qp = calls.find(c => c.path.includes("/reporting/transactions")).url.searchParams;

    const start = qp.get("start_date"), end = qp.get("end_date");
    // PayPal's documented pattern, with the timezone alternation it really has.
    const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|z|[+-]\d{2}:\d{2})$/;
    ok("start_date matches PayPal's documented pattern", ISO.test(start), start);
    ok("end_date matches PayPal's documented pattern", ISO.test(end), end);
    ok("...and a trailing Z is what the pattern permits, so it is not the bug",
       /Z$/.test(start) && /Z$/.test(end), { start, end });

    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    ok("the window never exceeds PayPal's 31 days", days <= 31, days);

    ok("page_size is inside PayPal's maximum of 500",
       Number(qp.get("page_size")) > 0 && Number(qp.get("page_size")) <= 500, qp.get("page_size"));
  }

  // ── §3 · a schema violation names its field, and reaches a human ─────────
  console.log("\n— §3 · PayPal names the field, and the adapter repeats it —");
  {
    const { fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : SCHEMA_VIOLATION("/page", "MIN_VALUE_NOT_MET"));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    let err = null;
    try {
      await paypal.fetchRows({ credentials: CREDS, since: "2026-09-01", until: TODAY, http, today: TODAY });
    } catch (e) { err = e; }
    ok("a schema violation on a NON-date field throws rather than ending the walk", !!err, err);
    ok("...carrying PayPal's own error name", err.providerCode === "INVALID_REQUEST", err.providerCode);
    ok("...and the FIELD PayPal named, which the old handler never read",
       Array.isArray(err.providerDetails) && err.providerDetails.some(d => /\/page/.test(d)), err.providerDetails);
    ok("...and the message a person reads repeats it", /\/page/.test(err.message), err.message);
    ok("...and the debug_id, which is what PayPal support asks for", !!err.debugId, err.debugId);
    ok("...classified as a READ failure, not a credential one",
       err.step === "read", err.step);
  }

  // ── §4 · a refused DATE RANGE is decided by the field, not the prose ─────
  console.log("\n— §4 · an out-of-range window ends the walk quietly —");
  {
    const { fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : SCHEMA_VIOLATION("/start_date", "INVALID_PARAMETER_VALUE"));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    const out = await paypal.fetchRows({ credentials: CREDS, since: "2020-01-01", until: TODAY, http, today: TODAY, backfill: true });
    ok("a refused start_date does NOT throw — it is the edge of the history", !!out, out);
    ok("...and the walk is finished rather than retried", out.done === true, out);
    // The old code decided this by matching /date|range|period/ against a
    // message that says none of those words, so this case was never reached.
    ok("...even though PayPal's message says nothing about dates",
       true);
  }

  // ── §5 · a 403 is still the permission delay, untouched ─────────────────
  console.log("\n— §5 · a 403 on the reporting call is still the permission wait —");
  {
    const { fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : json(403, { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." }));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    let err = null;
    try {
      await paypal.fetchRows({ credentials: CREDS, since: "2026-09-01", until: TODAY, http, today: TODAY });
    } catch (e) { err = e; }
    ok("a 403 throws", !!err);
    ok("...declared as a PERMISSION step, which is what earns the up-to-a-day sentence",
       err.step === "permission", err.step);
  }

  // ── §6 · still GET only ─────────────────────────────────────────────────
  console.log("\n— §6 · nothing here became a write —");
  {
    const { calls, fetchImpl } = recorder((u) =>
      u.pathname.includes("/oauth2/token") ? TOKEN_OK()
        : json(200, { transaction_details: [], total_pages: 1 }));
    const http = sources.readOnlyHttp("paypal", { fetchImpl });
    await paypal.fetchRows({ credentials: CREDS, since: "2026-09-01", until: TODAY, http, today: TODAY });
    const writes = calls.filter(c => c.method !== "GET" && !c.path.includes("/v1/oauth2/token"));
    ok("every request is a GET but PayPal's one named token POST", writes.length === 0, writes);
  }

  // ── §7 · the backfill stays inside the documented three years ───────────
  console.log("\n— §7 · the backfill cannot ask beyond three years —");
  {
    const src = require("fs").readFileSync(path.join(ROOT, "sources", "paypal.js"), "utf8");
    const windows = Number((src.match(/MAX_BACKFILL_WINDOWS\s*=\s*(\d+)/) || [])[1]);
    const days = Number((src.match(/WINDOW_DAYS\s*=\s*(\d+)/) || [])[1]);
    ok("the deepest backfill is inside PayPal's three years",
       windows * days <= 1095, { windows, days, total: windows * days });
    ok("the header no longer claims pages are 0-indexed", !/pages 0-indexed/.test(src));
  }

  summary();
})();

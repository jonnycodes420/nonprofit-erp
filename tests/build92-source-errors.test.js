// BUILD-92 A2 — GIVING-SOURCE ERRORS THAT TELL THE TRUTH.
//
// FOUND 20 SEPTEMBER, by Jonathan, on his own PayPal account: a plain
// authentication failure was shown as
//   "Steward could not finish reading this source. The next check will try
//    again."
// which is the sentence for a network blip. He was told to wait for something
// that was never going to happen, and the key he had pasted was never going to
// start working.
//
// The cause: sources/paypal.js throws
//   new Error("PayPal refused the credentials: Client Authentication failed")
// with { status: 401 } attached, and sourceErrorSentence tested
//   /401|403|unauthor|invalid_client|permission/i
// against the MESSAGE ONLY. That message contains none of those tokens, so it
// fell through to the generic last line while `e.status` sat there unread.
//
// FIVE ITEMS, ONE SUITE:
//   §1  The status and the provider's own code are stored beside last_error.
//   §2  Authentication is SPLIT from permission, per provider, and the "can
//       take up to a day" promise is ONLY made for a 403 on PayPal's
//       reporting call - never for a refused Client ID and Secret.
//   §3  Connect runs the provider's own test BEFORE saving and refuses a
//       credential the provider has already rejected. A permissions-pending
//       result still saves.
//   §4  Every pasted credential is trimmed before it is sealed, so a secret
//       with a trailing newline authenticates.
//   §5  The API returns ONE error per source, a lastTriedAt, and NEVER the
//       combination of "never checked" with an error - proven able to fail.
//
// HOW IT RUNS WITHOUT TOUCHING A REAL PROVIDER: the suite starts a mock that
// speaks all four providers' shapes, then spawns a CHILD Steward server whose
// PAYPAL_API_BASE / ZEFFY_API_BASE / STRIPE_SOURCE_API_BASE /
// GIVEBUTTER_API_BASE point at it. That child verifies on connect exactly the
// way production does (see verifyBeforeSaving in server.js) - which is what
// makes §3 a real proof rather than a source scan.

const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const ORG = "org_b92se";

// The credentials the mock accepts. Anything else is refused.
const GOOD = { clientId: "AXgood_client_id", clientSecret: "EXgood_secret", apiKey: "key_good" };

// ── the provider mock ───────────────────────────────────────────────────────
// `mode` is flipped between cases: "ok" | "permission". The AUTH verdict is
// always decided by the credential itself, never by the mode, because that is
// how a real provider behaves and the whole point of this suite is that the
// two are different things.
const state = { mode: "ok", seenBasic: [], seenKeys: [] };

function readBasic(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Basic ")) return null;
  return Buffer.from(h.slice(6), "base64").toString("utf8");
}
function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
function send(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

function startMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = req.url || "";
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        // ── PayPal ──────────────────────────────────────────────────────────
        if (url.startsWith("/v1/oauth2/token")) {
          const basic = readBasic(req);
          state.seenBasic.push(basic);
          const [id, secret] = String(basic || "").split(":");
          // THE TOKEN STEP. A wrong id/secret is invalid_client, 401 - the
          // exact shape PayPal returned to Jonathan.
          if (id !== GOOD.clientId || secret !== GOOD.clientSecret) {
            return send(res, 401, { error: "invalid_client", error_description: "Client Authentication failed" });
          }
          return send(res, 200, { access_token: "tok_live_x", token_type: "Bearer", expires_in: 32400 });
        }
        if (url.startsWith("/v1/reporting/transactions")) {
          if (bearer(req) !== "tok_live_x") return send(res, 401, { name: "AUTHENTICATION_FAILURE", message: "bad token" });
          // THE REPORTING CALL. 403 here is the Transaction Search permission,
          // which genuinely can take a day - the ONE case the delay sentence
          // is allowed to describe.
          if (state.mode === "permission") {
            return send(res, 403, { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." });
          }
          return send(res, 200, { transaction_details: [], total_pages: 1 });
        }
        // ── Zeffy / Stripe / Givebutter — one key, so the STATUS is the split ─
        const keyed = (prefix, okBody) => {
          const k = bearer(req);
          state.seenKeys.push(k);
          if (k !== GOOD.apiKey) return send(res, 401, { message: "Invalid API key provided.", code: "invalid_api_key" });
          if (state.mode === "permission") return send(res, 403, { message: "This key is not permitted to read payments.", code: "insufficient_scope" });
          return send(res, 200, okBody);
        };
        if (url.startsWith("/zeffy/payments")) return keyed("zeffy", { data: [], hasMore: false });
        if (url.startsWith("/stripe/v1/charges")) {
          const k = bearer(req);
          state.seenKeys.push(k);
          if (k !== GOOD.apiKey) return send(res, 401, { error: { message: "Invalid API Key provided.", code: "invalid_api_key" } });
          if (state.mode === "permission") return send(res, 403, { error: { message: "The provided key does not have the required permissions.", code: "permission_error" } });
          return send(res, 200, { data: [], has_more: false });
        }
        if (url.startsWith("/givebutter/transactions")) return keyed("gb", { data: [], links: {}, meta: {} });
        send(res, 404, { error: "not_found", url });
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ── the child Steward server, pointed at the mock ──────────────────────────
async function startChild(mockPort) {
  const port = await freePort();
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0",
      JWT_SECRET: "local-test-secret",
      RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:1",
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_localtest",
      STEWARD_CREDENTIAL_KEY: process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789",
      // THE SEAMS. With these set, verifyBeforeSaving() is true for all four
      // providers and the child verifies on connect exactly as production does.
      PAYPAL_API_BASE: `http://127.0.0.1:${mockPort}`,
      ZEFFY_API_BASE: `http://127.0.0.1:${mockPort}/zeffy`,
      STRIPE_SOURCE_API_BASE: `http://127.0.0.1:${mockPort}/stripe`,
      GIVEBUTTER_API_BASE: `http://127.0.0.1:${mockPort}/givebutter`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", d => { log += d.toString(); });
  child.stderr.on("data", d => { log += d.toString(); });
  let up = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const h = await fetch(`http://localhost:${port}/health`); if (h.ok) { up = true; break; } } catch { }
    if (child.exitCode !== null) break;
  }
  return { child, port, up, log: () => log };
}

const CHILD_TABLES = ["giving_recurring", "giving_sources", "thank_you_drafts", "threads",
  "digest_sends", "notification_sends", "imports", "gifts", "interactions", "donors",
  "fin_transactions", "budgets", "accounts", "fin_funds", "users"];

async function seedOrg() {
  for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => { });
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => { });
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'B92 Sources','b92se',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,'b92se@t.local',$3,'Ada Admin','admin')`,
    [`u_${ORG}`, ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${ORG}`, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffgen_${ORG}`, ORG]);
}

// ── THE SENTENCES, pinned as literals ──────────────────────────────────────
// The brief specifies the PayPal one exactly. The rest are pinned so they
// cannot drift into "the key was refused" - which is the sentence that sent
// Jonathan to look at four boxes without knowing which one was wrong.
const PAYPAL_AUTH = "PayPal did not accept this Client ID and Secret. Copy them again from your PayPal app and make sure the app is on Live.";
const PAYPAL_DELAY = "PayPal has not allowed this yet. A newly enabled Transaction Search permission can take up to a day. Steward will keep trying.";

(async () => {
  console.log("BUILD-92 A2 — giving-source errors that tell the truth\n");

  const { srv, port: mockPort } = await startMock();
  const { child, port, up, log } = await startChild(mockPort);
  ok("a child server boots with all four provider seams pointed at the mock", up, log().slice(-600));
  if (!up) { srv.close(); child.kill("SIGKILL"); await closeDb(); summary(); return; }

  const B = `http://localhost:${port}`;
  const call = async (method, p, token, body) => {
    const r = await fetch(B + p, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed = text; try { parsed = JSON.parse(text); } catch { }
    return { status: r.status, body: parsed };
  };

  try {
    await seedOrg();
    const login = await call("POST", "/auth/login", null, { email: "b92se@t.local", password: "loadtest1234" });
    const tok = login.body?.token;
    ok("the org's admin can sign in to the child", !!tok, login.body);

    // ══ §2 · authentication is not permission ════════════════════════════════
    console.log("\n— §2 · authentication split from permission —");
    state.mode = "ok";

    const ppBad = await call("POST", "/giving-sources/test", tok, {
      provider: "paypal", credentials: { clientId: "AXwrong", clientSecret: "EXwrong" },
    });
    ok("a refused PayPal Client ID and Secret reads as EXACTLY the credential sentence",
      ppBad.body?.message === PAYPAL_AUTH, ppBad.body?.message);
    ok("...and it does NOT tell her to wait a day for a permission",
      ppBad.body?.message !== PAYPAL_DELAY && !/take up to a day/.test(String(ppBad.body?.message)));
    ok("...and it is not the generic blip sentence that shipped",
      !/could not finish reading this source/.test(String(ppBad.body?.message)), ppBad.body?.message);

    // §1 — the two facts that used to be thrown away
    console.log("\n— §1 · the status and the provider's own code are kept —");
    ok("the test reports the HTTP status the provider answered with", ppBad.body?.errorStatus === 401, ppBad.body);
    ok("...and PayPal's own error code, which was sitting unread on the error",
      ppBad.body?.errorProviderCode === "invalid_client", ppBad.body);

    state.mode = "permission";
    const ppPerm = await call("POST", "/giving-sources/test", tok, {
      provider: "paypal", credentials: { clientId: GOOD.clientId, clientSecret: GOOD.clientSecret },
    });
    ok("a 403 on the REPORTING call is the one case that earns the day sentence",
      ppPerm.body?.message === PAYPAL_DELAY, ppPerm.body?.message);
    ok("...and it carries the 403, not the 401", ppPerm.body?.errorStatus === 403, ppPerm.body);

    // The same split for the other three, each in its own words.
    for (const [provider, field, wrongWord, permWord] of [
      ["zeffy", "apiKey", /did not accept this API key/i, /not allowed it to read payments/i],
      ["stripe", "apiKey", /did not accept this restricted key/i, /read access to Charges/i],
      ["givebutter", "apiKey", /did not accept this API key/i, /not allowed it to read transactions/i],
    ]) {
      state.mode = "ok";
      const bad = await call("POST", "/giving-sources/test", tok, { provider, credentials: { [field]: "key_wrong" } });
      state.mode = "permission";
      const perm = await call("POST", "/giving-sources/test", tok, { provider, credentials: { [field]: GOOD.apiKey } });
      ok(`${provider}: a WRONG key names the key`, wrongWord.test(String(bad.body?.message)), bad.body?.message);
      ok(`${provider}: a NOT-YET-ALLOWED key says something DIFFERENT`,
        permWord.test(String(perm.body?.message)) && perm.body?.message !== bad.body?.message,
        { wrong: bad.body?.message, pending: perm.body?.message });
      ok(`${provider}: neither sentence promises a day's wait (that promise is PayPal's alone)`,
        !/take up to a day/.test(String(bad.body?.message)) && !/take up to a day/.test(String(perm.body?.message)));
      ok(`${provider}: the statuses are 401 and 403, kept apart`,
        bad.body?.errorStatus === 401 && perm.body?.errorStatus === 403,
        { bad: bad.body?.errorStatus, perm: perm.body?.errorStatus });
    }

    // ══ §3 · connect asks the provider first ═════════════════════════════════
    console.log("\n— §3 · a refused credential is never saved —");
    state.mode = "ok";
    const before = await q(`SELECT COUNT(*)::int n FROM giving_sources WHERE org_id=$1`, [ORG]);
    const refused = await call("POST", "/giving-sources", tok, {
      provider: "paypal", credentials: { clientId: "AXwrong", clientSecret: "EXwrong" },
    });
    ok("connecting a credential PayPal has already refused is a 400, not a saved source",
      refused.status === 400 && refused.body?.error === "credentials_refused", refused.body);
    ok("...and the refusal is the same sentence the Test button gives",
      refused.body?.message === PAYPAL_AUTH, refused.body?.message);
    const after = await q(`SELECT COUNT(*)::int n FROM giving_sources WHERE org_id=$1`, [ORG]);
    ok("...and NOTHING was written", after[0].n === before[0].n, { before: before[0].n, after: after[0].n });

    // A permissions-pending result MAY still save - PayPal's Transaction
    // Search switch really does take time, and refusing there would make the
    // product impossible to set up.
    state.mode = "permission";
    const pending = await call("POST", "/giving-sources", tok, {
      provider: "paypal", credentials: { clientId: GOOD.clientId, clientSecret: GOOD.clientSecret },
    });
    ok("a PERMISSIONS-PENDING result still saves the source", pending.status === 200 && !!pending.body?.id, pending.body);
    const SRC = pending.body?.id;

    // ══ §4 · a secret with a trailing newline authenticates ══════════════════
    console.log("\n— §4 · whitespace on a pasted credential —");
    state.mode = "ok";
    await q(`DELETE FROM giving_sources WHERE org_id=$1`, [ORG]);
    state.seenBasic.length = 0;
    const padded = await call("POST", "/giving-sources", tok, {
      provider: "paypal",
      // Exactly what a copy out of a browser or a password manager gives you.
      credentials: { clientId: `  ${GOOD.clientId}\n`, clientSecret: `${GOOD.clientSecret}\n` },
    });
    ok("a Client ID and Secret with leading spaces and trailing newlines CONNECTS",
      padded.status === 200 && !!padded.body?.id, padded.body);
    ok("...because what reached PayPal was the trimmed pair, not the newline",
      state.seenBasic.some(b => b === `${GOOD.clientId}:${GOOD.clientSecret}`),
      state.seenBasic.map(b => JSON.stringify(b)));
    const SRC2 = padded.body?.id;

    // And the SEALED bag holds the trimmed value: the next sync must use the
    // credential that was proven to work, not the one that was pasted.
    state.mode = "ok";
    state.seenBasic.length = 0;
    const syncOk = await call("POST", `/giving-sources/${SRC2}/sync`, tok, {});
    ok("the stored credential is the trimmed one — the next sync authenticates too",
      syncOk.body?.ok === true && state.seenBasic.some(b => b === `${GOOD.clientId}:${GOOD.clientSecret}`),
      { ok: syncOk.body?.ok, seen: state.seenBasic });

    // ══ §5 · one error, a lastTriedAt, never "never checked" with an error ═══
    console.log("\n— §5 · one error per source, and a time it was last tried —");
    const listOk = await call("GET", "/giving-sources", tok);
    const rowOk = (listOk.body?.sources || []).find(r => r.id === SRC2);
    ok("after a clean run the source carries no error at all",
      rowOk && rowOk.lastError === null && rowOk.lastErrorStatus === null && rowOk.lastErrorProviderCode === null, rowOk);
    ok("...and it has been checked", rowOk?.everChecked === true && !!rowOk?.lastTriedAt, rowOk);

    // Now break it at the reporting call and re-sync.
    state.mode = "permission";
    const syncPerm = await call("POST", `/giving-sources/${SRC2}/sync`, tok, {});
    ok("a permission failure on sync reports the day sentence", syncPerm.body?.message === PAYPAL_DELAY, syncPerm.body);
    const listErr = await call("GET", "/giving-sources", tok);
    const rowErr = (listErr.body?.sources || []).find(r => r.id === SRC2);
    ok("the row carries exactly ONE error sentence", typeof rowErr?.lastError === "string" && rowErr.lastError === PAYPAL_DELAY, rowErr?.lastError);
    ok("...with the provider's status beside it", rowErr?.lastErrorStatus === 403, rowErr);
    ok("...and the provider's own code", rowErr?.lastErrorProviderCode === "NOT_AUTHORIZED", rowErr);
    ok("...and a lastTriedAt, so it never reads 'never checked' next to an error",
      !!rowErr?.lastTriedAt && rowErr?.everChecked === true, rowErr);

    // THE INVARIANT, over every row the API returns.
    const violates = rows => rows.filter(r => r.lastError && (!r.lastTriedAt || r.everChecked !== true))
      .map(r => r.id);
    ok("no source anywhere reports an error without a time it was tried",
      violates(listErr.body?.sources || []).length === 0, violates(listErr.body?.sources || []));

    // PROVEN ABLE TO FAIL (CLAUDE.md: a guard never seen failing is not known
    // to guard). The same predicate, fed the exact shape it exists to catch.
    const synthetic = [{ id: "synthetic", lastError: "something went wrong", lastTriedAt: null, everChecked: false }];
    ok("...and that check REPORTS a row shaped like the defect", violates(synthetic).length === 1, violates(synthetic));
    ok("...while leaving a healthy row alone",
      violates([{ id: "fine", lastError: null, lastTriedAt: null, everChecked: false }]).length === 0);

  } finally {
    child.kill("SIGKILL");
    srv.close();
    for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => { });
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => { });
    await closeDb();
  }
  summary();
})().catch(e => { console.error(e); process.exit(1); });

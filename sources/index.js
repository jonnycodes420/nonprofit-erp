// sources/index.js — BUILD-89S. THE PROVIDER ADAPTER REGISTRY, AND THE GUARD
// THAT MAKES "STEWARD NEVER WRITES TO A PROVIDER" A FACT RATHER THAN A PROMISE.
//
// ── THE SHAPE OF AN ADAPTER ────────────────────────────────────────────────
// One file per provider, each exporting:
//
//   key           — the provider key in shared/givingSources.js PROVIDERS
//   testCredentials({ credentials, http, today })
//                 → { ok, count, totalCents, error? } for the Connect screen's
//                   "Test" button. Reads the last seven days and writes
//                   nothing, anywhere, ever.
//   fetchRows({ credentials, since, until, cursor, http, today })
//                 → { rows, cursor, done, notices }
//                   `rows` are RAW; shared/givingSources.js normalizeRow makes
//                   them contract rows. The adapter's whole job is to turn one
//                   provider's vocabulary into that shape and to DROP anything
//                   that is not money coming in — a bank transfer, a payout, a
//                   fee billed as its own line, a purchase.
//
// An adapter never touches the database, never sees an org id, and cannot
// write a gift. It is handed an `http` and can reach the network through
// nothing else.
//
// ── THE GUARD ──────────────────────────────────────────────────────────────
// Zeffy's public API can record AND DELETE payments. Stripe's can refund.
// Givebutter's can create. Every one of these keys could move somebody's
// money, and the only thing standing between "read-only integration" and a
// very bad afternoon is that Steward never forms the request.
//
// So the adapters do not get `fetch`. They get `readOnlyHttp(provider)`, which
// REFUSES any request that is not a GET unless it is named in
// READ_ONLY_EXCEPTIONS (today: PayPal's OAuth token POST, and nothing else).
// The refusal throws — it does not warn and proceed — and every request is
// recorded on the handle so a suite can assert the whole conversation after
// the fact. That assertion is what each adapter's one test asserts.

const REQUEST_TIMEOUT_MS = 20000;

async function shape() { return import("../shared/givingSources.js"); }

class ProviderWriteRefused extends Error {
  constructor(provider, method, url) {
    super(`refused a ${method} to ${String(url).split("?")[0]} — Steward reads ${provider}, it never writes to it`);
    this.name = "ProviderWriteRefused";
    this.code = "PROVIDER_WRITE_REFUSED";
  }
}

// readOnlyHttp(provider, { fetchImpl }) → an http handle.
//
//   http(url, init)     → Response (throws ProviderWriteRefused on a write)
//   http.json(url,init) → { status, body, headers } with the body parsed
//   http.requests       → [{ method, url, at }] — every attempt, in order
//
// `fetchImpl` is injectable for the same reason geocode.js injects one: the
// per-adapter suites drive recorded fixture responses and never open a socket.
function readOnlyHttp(provider, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const requests = [];
  let allowed = null;   // resolved lazily from the ESM shape module

  const call = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (!allowed) allowed = (await shape()).requestAllowed;
    requests.push({ method, url: String(url), at: Date.now() });
    if (!allowed(provider, method, url)) throw new ProviderWriteRefused(provider, method, url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetchImpl(String(url), { ...init, method, signal: ctl.signal });
    } finally { clearTimeout(timer); }
  };

  call.json = async (url, init) => {
    const res = await call(url, init);
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, body, text, headers: res.headers };
  };
  call.requests = requests;
  call.provider = provider;
  return call;
}

// The registry. Required lazily so a syntax error in one adapter cannot stop
// the server booting for orgs that use a different provider.
const ADAPTER_FILES = {
  paypal: "./paypal.js",
  zeffy: "./zeffy.js",
  stripe: "./stripeSource.js",
  givebutter: "./givebutter.js",
};

const loaded = new Map();
function getAdapter(provider) {
  const key = String(provider || "");
  if (loaded.has(key)) return loaded.get(key);
  const file = ADAPTER_FILES[key];
  if (!file) return null;
  let mod = null;
  try { mod = require(file); }
  catch (e) { console.error(`[sources] adapter ${key} failed to load:`, e.message); }
  loaded.set(key, mod);
  return mod;
}

function adapterAvailable(provider) { return !!getAdapter(provider); }

// A fake adapter, exported from the product rather than the suite, so the
// runner's own test drives the EXACT code path a real provider drives. A
// fixture that runs through a parallel implementation proves nothing about
// the implementation that ships.
function fakeAdapter(rowsByCall = []) {
  let call = 0;
  return {
    key: "fake",
    async testCredentials() {
      const rows = rowsByCall[0] || [];
      return { ok: true, count: rows.length, totalCents: rows.reduce((s, r) => s + (r.amountCents || 0), 0) };
    },
    async fetchRows() {
      const rows = rowsByCall[call] || [];
      call++;
      return { rows, cursor: null, done: call >= rowsByCall.length, notices: [] };
    },
  };
}

module.exports = {
  readOnlyHttp, ProviderWriteRefused, getAdapter, adapterAvailable, fakeAdapter,
  ADAPTER_FILES, REQUEST_TIMEOUT_MS,
};

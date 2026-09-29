// shared/oauth.js — INT-OAUTH. ONE OAUTH MODULE, NOT FOUR.
//
// INT-1, INT-POS and INT-2 each shipped the data side of a connection and
// stopped at the handshake, because the handshake needed a developer account
// nobody had yet. The accounts exist now. What did not exist was a single
// place that knows how to ask for consent, so this is it: one registry, one
// authorize-URL builder, one state format, one token exchange shape. A fifth
// provider is an entry below and nothing else.
//
// ── WHAT THE STATE HAS TO DO, AND WHY IT IS NOT A NONCE ───────────────────
// The callback is a GET from the provider, landing on a public URL, carrying
// a code anybody could replay. `state` is the only thing tying that request
// back to the person who started it, so it carries THREE facts and is signed:
//
//     the org it was started for · the admin who started it · a random nonce
//
// The org matters most. Without it, an admin of org A could start a flow,
// hand the callback URL to org B, and have B's tokens land on A's row (or the
// reverse). The route re-checks that the signed-in user is still that admin
// of that org before it stores anything, so a stale or copied callback stores
// nothing at all. That is the property the one test pins.
//
// ── PKCE WHERE THE PROVIDER SUPPORTS IT ───────────────────────────────────
// Xero and Square both accept PKCE, so the code is useless to anybody who
// intercepts it without the verifier. Intuit's docs do not offer it for the
// server-side authorization-code flow, so `pkce: false` there says so rather
// than sending a challenge that gets ignored.
//
// Pure: no DB, no network, no crypto, no clock. The HMAC over the state and
// the SHA-256 of the verifier are the route's job, because shared/ is bundled
// into the browser and node:crypto is not.

export const PROVIDERS = {
  xero: {
    key: "xero", label: "Xero", kind: "bookkeeping", vendor: "xero",
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    // Xero's NEW apps use granular scopes. These are the minimum INT-2 needs:
    // write the deposits it builds, and read the chart of accounts and the
    // tracking categories the mapping screen offers. `offline_access` is what
    // makes a refresh token exist at all; `openid profile email` is Xero's
    // required identity trio. Nothing here can read a contact or a bank feed.
    scopes: ["openid", "profile", "email", "offline_access",
             "accounting.transactions", "accounting.settings.read"],
    pkce: true,
    // A Xero login can hold several organisations. Which one is chosen after
    // consent, from the connections endpoint, never guessed.
    tenantStep: "https://api.xero.com/connections",
    sandboxNote: "Connect the Xero demo company first: it is a real tenant with fake books.",
  },
  intuit: {
    key: "intuit", label: "QuickBooks Online", kind: "bookkeeping",
    // INT-2 named this vendor "quickbooks" in shared/bookkeeping.js; Intuit
    // names the OAuth app "intuit". They are the same connection, so the key
    // the rest of the product stores is spelled out here rather than left for
    // each caller to guess, which is how a connection ends up filed under a
    // vendor no screen reads.
    vendor: "quickbooks",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    pkce: false,
    // Intuit calls the company id a realmId and returns it on the callback,
    // not in the token response. It is stored with the tokens because every
    // later call needs it.
    realmParam: "realmId",
    sandboxNote: "Sandbox until Intuit's review is finished. INTUIT_API_BASE picks the environment.",
  },
  square: {
    key: "square", label: "Square", kind: "source", vendor: "square",
    authorizeUrl: "https://connect.squareup.com/oauth2/authorize",
    tokenUrl: "https://connect.squareup.com/oauth2/token",
    // FIVE READ-ONLY SCOPES AND NOTHING ELSE. INT-POS reads a register; it
    // never takes a payment, never refunds one and never edits a catalogue.
    // Anything with WRITE in its name is a scope this product has no use for,
    // and asking for one would be asking a nonprofit to trust us with their
    // till for no reason.
    scopes: ["PAYMENTS_READ", "ORDERS_READ", "ITEMS_READ", "CUSTOMERS_READ", "MERCHANT_PROFILE_READ"],
    pkce: true,
    sandboxNote: "Sandbox first. The same five scopes apply to the live app.",
  },
  // PayPal is deliberately ABSENT as an OAuth provider. Its native onboarding
  // (Partner Referrals / Log in with PayPal for a merchant's transactions) is
  // behind an approved partner account, which is an application and a review.
  // Until that exists, an org connects PayPal with its own REST app client id
  // and secret, which works today, and the webhook path INT-1 built works
  // alongside it. `PAYPAL_WAITING` is the sentence the card says instead of
  // offering a button that opens a page nobody can complete.
};
export const PROVIDER_KEYS = Object.keys(PROVIDERS);
export const isProvider = k => PROVIDER_KEYS.includes(k);
// The key the REST of the product stores for this connection.
export const vendorKeyOf = k => PROVIDERS[k]?.vendor || k;

export const PAYPAL_WAITING =
  "PayPal's one-click connection is waiting on their partner programme. Until it is approved you connect PayPal with your own client id and secret, which works the same way, and Steward already listens for PayPal's webhooks.";

// Every Railway variable this module expects a provider to have, named once so
// the report and the admin check read the same list rather than two lists that
// drift.
export const ENV_VARS = {
  xero: { clientId: "XERO_CLIENT_ID", clientSecret: "XERO_CLIENT_SECRET",
          redirectUri: "XERO_REDIRECT_URI", apiBase: "XERO_API_BASE" },
  intuit: { clientId: "INTUIT_CLIENT_ID", clientSecret: "INTUIT_CLIENT_SECRET",
            redirectUri: "INTUIT_REDIRECT_URI", apiBase: "INTUIT_API_BASE" },
  square: { clientId: "SQUARE_APP_ID", clientSecret: "SQUARE_APP_SECRET",
            redirectUri: "SQUARE_REDIRECT_URI", webhookKey: "SQUARE_WEBHOOK_SIGNATURE_KEY" },
};

// ── THE STATE ──────────────────────────────────────────────────────────────
// `<orgId>.<userId>.<nonce>` base64url-encoded, with the signature appended by
// the route. Encoding is here so both halves of the flow read one format.
export function encodeState({ orgId, userId, nonce }) {
  const raw = [orgId, userId, nonce].map(x => String(x || "")).join("\u0000");
  return b64url(new TextEncoder().encode(raw));
}
export function decodeState(s) {
  try {
    const bytes = unb64url(String(s || ""));
    const [orgId, userId, nonce] = new TextDecoder().decode(bytes).split("\u0000");
    if (!orgId || !userId || !nonce) return null;
    return { orgId, userId, nonce };
  } catch { return null; }
}

/**
 * The consent URL. Every value is escaped, and the scopes come from the
 * registry rather than the caller: a route cannot widen what is asked for.
 */
export function authorizeUrl(providerKey, { clientId, redirectUri, state, codeChallenge }) {
  const p = PROVIDERS[providerKey];
  if (!p) return null;
  const q = new URLSearchParams({
    client_id: String(clientId || ""),
    response_type: "code",
    redirect_uri: String(redirectUri || ""),
    scope: p.scopes.join(" "),
    state: String(state || ""),
  });
  if (p.pkce && codeChallenge) {
    q.set("code_challenge", String(codeChallenge));
    q.set("code_challenge_method", "S256");
  }
  return `${p.authorizeUrl}?${q.toString()}`;
}

// The token-exchange body, per provider. Square wants JSON with its app secret
// in the body; Xero and Intuit want form-encoded with HTTP Basic auth.
export function tokenRequest(providerKey, { code, redirectUri, clientId, clientSecret, codeVerifier, refreshToken }) {
  const p = PROVIDERS[providerKey];
  if (!p) return null;
  const refreshing = !!refreshToken;
  if (providerKey === "square") {
    return { url: p.tokenUrl, headers: { "Content-Type": "application/json", "Square-Version": "2025-01-23" },
      body: JSON.stringify(refreshing
        ? { client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }
        : { client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code",
            code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) }) };
  }
  const form = new URLSearchParams(refreshing
    ? { grant_type: "refresh_token", refresh_token: refreshToken }
    : { grant_type: "authorization_code", code: String(code || ""), redirect_uri: String(redirectUri || "") });
  if (p.pkce && codeVerifier && !refreshing) form.set("code_verifier", codeVerifier);
  return { url: p.tokenUrl, basic: `${clientId}:${clientSecret}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString() };
}

// A token response, normalised. `expiresAt` is computed by the caller from its
// own clock; this only says how long the provider claimed.
export function readTokens(body) {
  if (!body || typeof body !== "object") return null;
  const access = body.access_token || null;
  if (!access) return null;
  return {
    accessToken: access,
    refreshToken: body.refresh_token || null,
    expiresInSeconds: Number(body.expires_in) || null,
    merchantId: body.merchant_id || null,        // Square names the account here
    scope: body.scope || null,
  };
}

// Refresh BEFORE expiry, not after: a token that expires mid-send turns one
// deposit into a retry, and INT-2's whole safety model is about not retrying
// into a second deposit.
export const REFRESH_MARGIN_SECONDS = 300;
export function needsRefresh(expiresAt, now) {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt), n = Date.parse(now || new Date().toISOString());
  if (!Number.isFinite(t) || !Number.isFinite(n)) return true;
  return t - n <= REFRESH_MARGIN_SECONDS * 1000;
}

const b64url = bytes => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = s => {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export default { PROVIDERS, PROVIDER_KEYS, isProvider, vendorKeyOf, ENV_VARS, PAYPAL_WAITING,
                 encodeState, decodeState, authorizeUrl, tokenRequest, readTokens,
                 needsRefresh, REFRESH_MARGIN_SECONDS };

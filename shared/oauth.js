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
    // FIX-10 D — the note a CUSTOMER reads. It used to name the Railway
    // variable that picks the environment, which is a sentence about our
    // deployment in the middle of her Connections screen.
    sandboxNote: "Sandbox until Intuit's review is finished.",
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
  // ── INT-3 · THE TWO EMAIL TOOLS ─────────────────────────────────────────
  // `kind: "email"` is a third kind beside "bookkeeping" and "source". It
  // reads and writes a mailing list; it never touches money, and it is never
  // a giving source, so a card for it is built from its own table rather than
  // from `giving_sources`.
  mailchimp: {
    key: "mailchimp", label: "Mailchimp", kind: "email", vendor: "mailchimp",
    authorizeUrl: "https://login.mailchimp.com/oauth2/authorize",
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
    // MAILCHIMP HAS NO SCOPES. Its OAuth grant is the whole account, which is
    // not a choice Steward gets to make narrower, so the empty array is the
    // honest answer and `authorizeUrl` omits the parameter entirely rather
    // than sending `scope=`. The card says what the grant actually covers so
    // an org is not told it approved less than it did.
    scopes: [],
    scopeSentence: "Mailchimp does not let an app ask for part of an account, so this grants Steward read and write access to your Mailchimp audiences. Steward only ever reads campaigns and writes the contacts you map.",
    pkce: false,
    // Mailchimp wants the client id and secret in the FORM BODY, not in an
    // Authorization header. Sending Basic auth here returns invalid_client.
    tokenStyle: "body",
    // The access token never expires and there is no refresh token, so
    // `needsRefresh` is never true for it and a break can only be a
    // revocation in Mailchimp.
    neverExpires: true,
    // THE API HOST IS NOT FIXED. Every Mailchimp account lives in a data
    // centre ("us14", "us2") and the API host is that prefix. It comes from
    // the metadata endpoint AFTER the exchange, and it is stored beside the
    // token. An integration that hardcodes a prefix works for exactly one
    // customer.
    metadataUrl: "https://login.mailchimp.com/oauth2/metadata",
    sandboxNote: "A free Mailchimp account is enough to connect and test.",
  },
  constantcontact: {
    key: "constantcontact", label: "Constant Contact", kind: "email", vendor: "constantcontact",
    authorizeUrl: "https://authz.constantcontact.com/oauth2/default/v1/authorize",
    // NOT the authz host. Constant Contact serves the token endpoint from a
    // different domain, and pointing this at authz.constantcontact.com is a
    // 404 that reads like a bad client id.
    tokenUrl: "https://idfed.constantcontact.com/as/token.oauth2",
    // The minimum for what INT-3 does: read and write contacts and lists,
    // read campaign activity, and a refresh token so a daily pull survives.
    // Nothing here can send a campaign.
    scopes: ["contact_data", "campaign_data", "offline_access"],
    // Constant Contact documents PKCE only for its public-client flow. Steward
    // is a confidential client using the server flow with Basic auth, which is
    // their documented pairing, so no challenge is sent rather than one that
    // may be ignored or rejected.
    pkce: false,
    // Basic auth, which is the default shape below and what their refresh
    // request requires.
    tokenStyle: "basic",
    sandboxNote: "Connect a Constant Contact developer account first. Its access token lasts a day and Steward refreshes it.",
  },
  // ── INT-4 · THE TWO MAILBOXES ────────────────────────────────────────────
  // `kind: "mailbox"` is the fourth kind, and the only one that belongs to a
  // PERSON rather than to an organisation. Dana connects Dana's mailbox; it is
  // her consent, her tokens and her switch to turn off, and an admin cannot
  // connect it for her. That is why the stored row is keyed by user.
  //
  // READ-ONLY, AND NARROWLY. Neither scope below can send, delete or modify a
  // message, and there is no code path in Steward that could use one if it
  // were granted. The product's whole promise is that a human sends; a CRM
  // holding send access to a fundraiser's personal mailbox is the opposite of
  // that promise, and it is also the difference between a Google review that
  // asks for a security assessment and one that does not.
  google: {
    key: "google", label: "Gmail", kind: "mailbox", vendor: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // `gmail.readonly` is the narrowest scope that can read headers and bodies.
    // There is no narrower Gmail read scope: `metadata` returns headers only,
    // which cannot produce the body the record needs.
    //
    // NOTE what is NOT here: `gmail.send`, which the first Gmail integration
    // asked for. Nothing in INT-4 sends, so asking for it bought a permission
    // this product must never exercise.
    //
    // INT-BUILD-1 — AND THE CALENDAR, ON THE SAME CONSENT. `calendar.events`
    // reads events and creates one when she presses "Book a visit"; it is the
    // one Google scope that does both, and it is "sensitive", not
    // "restricted". It cannot read or change her calendar settings or
    // sharing, and Steward only ever reads the six fields shared/calendarLog.js
    // names. It is the one write in this registry, and it writes only to her
    // own calendar, only when she presses the button.
    scopes: ["https://www.googleapis.com/auth/gmail.readonly",
             "https://www.googleapis.com/auth/calendar.events", "openid", "email"],
    pkce: true,
    tokenStyle: "body",
    // Google needs these two or a refresh token never arrives, and a mailbox
    // connection without one stops working in an hour. `include_granted_scopes`
    // lets somebody who connected mail under INT-4 add the calendar without
    // losing what she already granted.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    restricted: true,
    reviewNote: "Gmail read scopes are restricted: Google requires app verification and an independent security assessment before more than 100 people can connect. Testing mode is capped at 100 users.",
    sandboxNote: "Google testing mode allows up to 100 connected accounts before verification.",
  },
  microsoft: {
    key: "microsoft", label: "Outlook", kind: "mailbox", vendor: "microsoft",
    // The `common` tenant so both a work account and a personal one can
    // connect. A single-tenant URL would refuse every customer but ours.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Mail.Read is read-only. `offline_access` is what makes a refresh token
    // exist. Nothing here is Mail.Send or Mail.ReadWrite.
    // INT-BUILD-1 — Calendars.ReadWrite reads her events and creates the one
    // she books from a profile. Microsoft has no narrower scope that can create.
    scopes: ["offline_access", "openid", "email", "User.Read", "Mail.Read", "Calendars.ReadWrite"],
    pkce: true,
    tokenStyle: "body",
    restricted: true,
    reviewNote: "Microsoft requires publisher verification, and an organisation's own admin may need to grant consent before its staff can connect.",
    sandboxNote: "Connect a Microsoft developer tenant first.",
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

// FIX-10 D — THE ACTION LEADS; THE REASON IS BEHIND A DISCLOSURE. The one
// sentence PayPal's card used to say opened with somebody else's partner
// programme and buried what the reader can actually do today. Those are two
// different sentences with two different jobs, so they are two exports: the
// card says PAYPAL_ACTION, and PAYPAL_WHY is what a "Why?" reveals.
export const PAYPAL_ACTION =
  "Connect with your PayPal client ID and secret.";
export const PAYPAL_WHY =
  "PayPal's one-click connection is waiting on their partner programme. Connecting with your own client ID and secret works the same way, and Steward already listens for PayPal's webhooks.";
// Kept as the two sentences joined, for anything that wants one string.
export const PAYPAL_WAITING = `${PAYPAL_ACTION} ${PAYPAL_WHY}`;

// FIX-10 D — WHAT A CUSTOMER READS WHEN A PROVIDER HAS NO APP CREDENTIALS ON
// THIS DEPLOYMENT. It used to be the list of Railway variable names:
//
//   "Steward cannot open Square's consent screen yet: SQUARE_APP_ID,
//    SQUARE_APP_SECRET, SQUARE_REDIRECT_URI are not set."
//
// Nothing in that sentence is hers to act on, and the three words in the
// middle are our deployment's internals on her screen. The variable names are
// still reported, in `missing`, for the admin check and the ops report; the
// sentence a customer reads says only what is true for her. One function, so
// a fifth provider cannot grow a fifth wording.
export const providerUnavailableSentence = label =>
  `${label} isn't available yet. We'll let you know when it is.`;

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
  mailchimp: { clientId: "MAILCHIMP_CLIENT_ID", clientSecret: "MAILCHIMP_CLIENT_SECRET",
               redirectUri: "MAILCHIMP_REDIRECT_URI" },
  constantcontact: { clientId: "CONSTANT_CONTACT_CLIENT_ID", clientSecret: "CONSTANT_CONTACT_CLIENT_SECRET",
                     redirectUri: "CONSTANT_CONTACT_REDIRECT_URI" },
  // INT-4 — Google's variables already existed for the first Gmail
  // integration, so the SAME names are reused rather than a second pair
  // introduced beside them.
  google: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET",
            redirectUri: "GOOGLE_REDIRECT_URI" },
  microsoft: { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET",
               redirectUri: "MICROSOFT_REDIRECT_URI" },
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
    state: String(state || ""),
  });
  // A provider with no scopes (Mailchimp grants the whole account and offers
  // nothing narrower) gets NO scope parameter. Sending `scope=` is not the
  // same as omitting it, and some authorization servers reject the empty one.
  if (p.scopes.length) q.set("scope", p.scopes.join(" "));
  if (p.pkce && codeChallenge) {
    q.set("code_challenge", String(codeChallenge));
    q.set("code_challenge_method", "S256");
  }
  // A provider that needs fixed extra parameters declares them in the
  // registry. Google needs access_type=offline and prompt=consent or it never
  // issues a refresh token, and a mailbox connection without one dies in an
  // hour. They come from the registry, never from the caller, for the same
  // reason the scopes do.
  for (const [k, v] of Object.entries(p.extraAuthParams || {})) q.set(k, String(v));
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
  // Mailchimp wants the credentials in the body and refuses Basic auth, so the
  // style is a registry fact rather than a special case at the call site. The
  // redirect_uri rides along on Mailchimp's refresh-less exchange too.
  if (p.tokenStyle === "body") {
    form.set("client_id", String(clientId || ""));
    form.set("client_secret", String(clientSecret || ""));
    return { url: p.tokenUrl,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString() };
  }
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

export default { PROVIDERS, PROVIDER_KEYS, isProvider, vendorKeyOf, ENV_VARS,
                 PAYPAL_WAITING, PAYPAL_ACTION, PAYPAL_WHY, providerUnavailableSentence,
                 encodeState, decodeState, authorizeUrl, tokenRequest, readTokens,
                 needsRefresh, REFRESH_MARGIN_SECONDS };

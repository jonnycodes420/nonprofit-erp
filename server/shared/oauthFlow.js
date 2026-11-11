// server/shared/oauthFlow.js · the OAuth pieces two flows share: the org
// connections (routes/finance.js) and the sales mailbox (server/admin/sales/,
// SALES-1). Moved verbatim from routes/finance.js; nothing here knows an org.
"use strict";
const crypto = require("crypto");

// The state is signed with the server's own secret. The signature is what
// makes a state we did not issue useless; the row in oauth_states is what
// makes one we DID issue single-use.
function signState(raw) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(String(raw)).digest("base64url");
}
function stateMatches(raw, sig) {
  const a = Buffer.from(signState(raw)), b = Buffer.from(String(sig || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function oauthEnv(provider, ENV) {
  const names = ENV[provider] || {};
  const out = {};
  for (const [k, name] of Object.entries(names)) out[k] = process.env[name] || null;
  return { values: out, names };
}
// Asked of the provider, never taken from the browser. A connection whose
// address Steward cannot establish is refused rather than stored under a guess:
// the address is how every later message is judged inbound or outbound, and a
// wrong one silently mislabels every line on every record.
async function mailboxAddress(providerKey, accessToken) {
  try {
    const url = providerKey === "google"
      ? `${process.env.GMAIL_API_BASE || "https://gmail.googleapis.com"}/gmail/v1/users/me/profile`
      : `${process.env.GRAPH_API_BASE || "https://graph.microsoft.com"}/v1.0/me`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" } });
    if (!r.ok) { console.error(`[mailbox] ${providerKey} profile answered ${r.status}`); return null; }
    const b = await r.json();
    const addr = providerKey === "google" ? b.emailAddress : (b.mail || b.userPrincipalName);
    return addr ? String(addr).trim().toLowerCase() : null;
  } catch (e) { console.error(`[mailbox] ${providerKey} profile failed:`, e.message); return null; }
}

module.exports = { signState, stateMatches, oauthEnv, mailboxAddress };

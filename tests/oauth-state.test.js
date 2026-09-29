// tests/oauth-state.test.js — INT-OAUTH. THE ONE GUARD THIS BUILD EARNED.
//
//     A CALLBACK WITH A MISSING OR MISMATCHED STATE IS REFUSED AND STORES NO
//     TOKEN, AND TOKENS FOR ORG A CAN NEVER BE READ OR USED FOR ORG B.
//
// The callback is a GET landing on a public URL, carrying a code anybody could
// replay, and what it does on success is write write-access credentials for
// somebody's accounting system. `state` is the only thing tying that request
// back to the person who started it, so this suite is about state and about
// the seal.
//
// WHAT IS ASSERTED:
//   §1  no state, an unsigned state, and a state signed with the wrong key are
//       each refused, and the oauth_states row is untouched
//   §2  a state issued for ORG A, replayed by an admin of ORG B, is refused
//   §3  a state issued for one ADMIN, replayed by a colleague in the same org,
//       is refused
//   §4  a valid state is single use: the second callback is refused
//   §5  an expired state is refused
//   §6  after every refusal, NO connection row and NO token exists anywhere
//   §7  the seal is bound to the org: org A's sealed tokens will not open with
//       org B's binding, so a row copied between tenants is unreadable rather
//       than useful
//
// HOW IT WOULD GO RED: compare the state without its signature; drop the
// org/user check and trust the signature alone (which a replay still carries);
// make the state re-usable by checking `used_at` after the write instead of
// claiming it in the UPDATE; or seal the tokens without the org as AAD.
// Verified by removing the org/user check, which turns §2 and §3 red.
//
// NO REAL PROVIDER IS CONTACTED. Every request here is refused before the
// token exchange, which is the point: a refusal must cost nothing and reach
// nobody.
//
// Standard scratch stack (tests/README.md).

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_oauthA", B = "org_oauthB";
const PW = bcrypt.hashSync("loadtest1234", 10);

const sign = raw => crypto.createHmac("sha256", process.env.JWT_SECRET || "local-test-secret")
  .update(String(raw)).digest("base64url");

async function reset() {
  for (const o of [A, B]) {
    for (const t of ["oauth_states", "bookkeeping_deposits", "bookkeeping_connections", "giving_sources", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [o, `OAuth ${o}`, `oauth-${o}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin','admin')`, [`u_${o}`, o, `${o}@oauth.local`, PW]);
  }
  // A second admin inside org A, for the "somebody else started it" leg.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Colleague','admin')`, [`u_${A}_two`, A, `two-${A}@oauth.local`, PW]);
}

const tokensAnywhere = async () => {
  const [bk] = await q(`SELECT COUNT(*)::int n FROM bookkeeping_connections WHERE org_id = ANY($1) AND credentials_sealed IS NOT NULL`, [[A, B]]);
  const [gs] = await q(`SELECT COUNT(*)::int n FROM giving_sources WHERE org_id = ANY($1) AND credentials_sealed IS NOT NULL`, [[A, B]]);
  return Number(bk.n) + Number(gs.n);
};
// A state this suite mints directly, exactly as the start route would, plus a
// row so it is one we "issued". The provider is never contacted because every
// leg below is refused before the exchange.
async function issue({ org, user, provider = "xero", minutes = 15 }) {
  const raw = Buffer.from([org, user, crypto.randomBytes(8).toString("hex")].join("\u0000"))
    .toString("base64url");
  const state = `${raw}.${sign(raw)}`;
  await q(`INSERT INTO oauth_states (state,org_id,user_id,provider,code_verifier,redirect_uri,expires_at)
           VALUES ($1,$2,$3,$4,'verifier','https://x/cb', NOW() + ($5 || ' minutes')::interval)`,
    [state, org, user, provider, String(minutes)]);
  return state;
}
// The provider lands the person on the APP; the app finishes the job with
// this authenticated POST. That is the request this suite attacks.
const cb = (tok, state, code = "the-code") =>
  api("POST", "/oauth/xero/complete", tok, { state, code });

(async () => {
  console.log("INT-OAUTH — a callback that cannot prove who started it connects nothing\n");
  await reset();
  const tokA = await login(`${A}@oauth.local`);
  const tokA2 = await login(`two-${A}@oauth.local`);
  const tokB = await login(`${B}@oauth.local`);
  const before = await tokensAnywhere();

  // ── §1 · NO STATE, UNSIGNED, WRONGLY SIGNED ─────────────────────────────
  const none = await api("POST", "/oauth/xero/complete", tokA, { code: "the-code" });
  ok("§1 a callback with no state is refused", none.status === 400 && none.body?.error === "bad_state", none.body);

  const rawOnly = Buffer.from([A, `u_${A}`, "n"].join("\u0000")).toString("base64url");
  const unsigned = await cb(tokA, rawOnly);
  ok("§1 an unsigned state is refused", unsigned.status === 400 && unsigned.body?.error === "bad_state", unsigned.body);

  const forged = await cb(tokA, `${rawOnly}.${crypto.createHmac("sha256", "not-the-key").update(rawOnly).digest("base64url")}`);
  ok("§1 a state signed with the wrong key is refused",
     forged.status === 400 && forged.body?.error === "bad_state", forged.body);

  // ── §2 · ORG A'S STATE, REPLAYED BY ORG B ───────────────────────────────
  // The signature is VALID here. Only the org check stops it, which is the
  // whole reason the org is in the state.
  const stateA = await issue({ org: A, user: `u_${A}` });
  const crossOrg = await cb(tokB, stateA);
  ok("§2 a validly signed state from another org is refused",
     crossOrg.status === 400 && crossOrg.body?.error === "state_mismatch", crossOrg.body);
  const [stillUnused] = await q(`SELECT used_at FROM oauth_states WHERE state=$1`, [stateA]);
  ok("§2 …and it did not even consume the state", stillUnused && stillUnused.used_at === null, stillUnused);

  // ── §3 · THE RIGHT ORG, THE WRONG ADMIN ─────────────────────────────────
  const crossUser = await cb(tokA2, stateA);
  ok("§3 a colleague in the same org cannot finish somebody else's sign-in",
     crossUser.status === 400 && crossUser.body?.error === "state_mismatch", crossUser.body);

  // ── §4 · SINGLE USE ─────────────────────────────────────────────────────
  // The right admin, the right org: this one gets past the state wall and
  // fails at the exchange, because no provider credentials are configured on
  // the scratch server. Either way the state is SPENT, and the second attempt
  // must say so rather than try again.
  const firstUse = await cb(tokA, stateA);
  ok("§4 the rightful admin gets past the state wall",
     firstUse.status !== 400 || firstUse.body?.error !== "state_mismatch", firstUse.body);
  const secondUse = await cb(tokA, stateA);
  ok("§4 the same state a second time is refused as spent",
     secondUse.status === 400 && secondUse.body?.error === "state_spent", secondUse.body);

  // ── §5 · EXPIRED ────────────────────────────────────────────────────────
  const stale = await issue({ org: A, user: `u_${A}`, minutes: -1 });
  const expired = await cb(tokA, stale);
  ok("§5 an expired state is refused", expired.status === 400 && expired.body?.error === "state_spent", expired.body);

  // ── §6 · AND NOTHING WAS STORED ─────────────────────────────────────────
  const after = await tokensAnywhere();
  ok("§6 after every refusal, no token is stored anywhere", after === before, { before, after });
  const [conns] = await q(`SELECT COUNT(*)::int n FROM bookkeeping_connections WHERE org_id = ANY($1)`, [[A, B]]);
  ok("§6 …and no connection row was created", Number(conns.n) === 0, conns);

  // ── §7 · THE SEAL IS BOUND TO THE ORG ───────────────────────────────────
  // A sealed blob is not a secret somebody can move. Copying org A's row into
  // org B's must fail to OPEN, not hand over org A's books.
  // The org binding is a property of the SEALER, not of this server's
  // configuration, so the suite supplies its own key rather than depending on
  // one being set for the whole battery. A suite that skipped here when the
  // key was missing would be claiming a property it never checked, so this
  // leg is red if the sealer cannot run at all.
  process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY
    || "oauth-suite-credential-key-0123456789";
  const { sealBag, openBag } = await import("../shared/secretBox.js");
  let sealed = null, crossOrgOpen = "did not throw";
  try {
    sealed = sealBag({ accessToken: "a-real-looking-token", refreshToken: "r" }, { aad: A });
    ok("§7 tokens seal for org A", typeof sealed === "string" && sealed.startsWith("v1."), String(sealed).slice(0, 12));
    const mine = openBag(sealed, { aad: A });
    ok("§7 …and open again for org A", mine.accessToken === "a-real-looking-token");
    try { openBag(sealed, { aad: B }); } catch (e) { crossOrgOpen = "threw"; }
    ok("§7 …and REFUSE to open for org B, so a copied row is unreadable rather than useful",
       crossOrgOpen === "threw", crossOrgOpen);
  } catch (e) {
    // No STEWARD_CREDENTIAL_KEY would make this leg impossible, and a suite
    // that skipped here would be claiming a property it never checked.
    ok("§7 the sealer is configured on this server (without it the seal cannot be tested)", false, e.message);
  }
  const plain = String(sealed || "");
  ok("§7 the sealed envelope contains no readable token",
     !plain.includes("a-real-looking-token"), plain.slice(0, 40));

  for (const o of [A, B]) {
    for (const t of ["oauth_states", "bookkeeping_deposits", "bookkeeping_connections", "giving_sources", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

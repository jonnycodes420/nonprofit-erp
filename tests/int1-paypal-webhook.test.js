// tests/int1-paypal-webhook.test.js — INT-1. THE ONE GUARD THIS BUILD EARNED.
//
// /paypal/webhook is a PUBLIC, UNAUTHENTICATED endpoint that exists so PayPal
// can tell Steward money arrived. Anybody on the internet can POST JSON to it
// claiming a $10,000 gift. The only thing between that and a gift row is the
// signature, so the signature is what this suite is about:
//
//     A PAYPAL WEBHOOK WITH A BAD SIGNATURE IS REFUSED AND RECORDS NOTHING.
//
// "Records nothing" is asserted as a snapshot of the WHOLE org before and
// after: gifts, donors, the source row and its webhook columns, byte for byte.
// A refusal that still wrote a "we saw something" marker would be a refusal
// that leaked the existence of the account to a stranger, and would be caught
// here.
//
// THE FORGERIES, each a real thing somebody would try:
//   §2  no signature headers at all
//   §3  a valid signature over a DIFFERENT body (the classic replay-and-edit)
//   §4  a certificate URL on a host the attacker controls — THE attack, because
//       the cert URL comes out of the request, and whoever picks the
//       certificate can sign whatever they like
//   §5  an algorithm Steward does not use
//   §6  a signature that is simply wrong
//   §7  INT-PROD-1: a genuinely signed event for a DIFFERENT webhook (another
//       app's, or a sandbox one replayed at live). PayPal puts the webhook id
//       in the signed string, so Steward must verify against PAYPAL_WEBHOOK_ID
//       and nothing else. Planted 2026-10-07: taking the webhook id from a
//       request header before PAYPAL_WEBHOOK_ID turned §7 red.
//
// AND ONE THAT PASSES (§1), because a suite that can only produce invalid
// requests proves everything is refused, which is not the same thing at all.
// The scratch server boots with a throwaway public key as
// PAYPAL_WEBHOOK_TEST_CERT (tests/fixtures/paypal-webhook-test-key.js) exactly
// as it boots with whsec_localtest for Stripe.
//
// HOW IT WOULD GO RED: accept an unsigned request; verify against a cert from
// any host; compare the signature over a re-serialised body instead of the raw
// bytes; or write anything at all before the verify returns true. Verified by
// removing the cert-host check, which turns §4 red.
//
// Standard scratch stack (tests/README.md).

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const KEY = require("./fixtures/paypal-webhook-test-key");

const ORG = "org_int1pp";
const SOURCE = "gsrc_int1pp";
const MERCHANT = "MERCHANT-INT1-TEST";

// The event PayPal would send for a completed capture, with this org's
// merchant id on it — so a request that got through WOULD be attributed and
// WOULD act. An unattributable body would make every refusal below vacuous.
const EVENT = {
  id: "WH-EVT-INT1-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAPTURE-1", amount: { value: "10000.00", currency_code: "USD" },
              payee: { merchant_id: MERCHANT } },
};

function post(body, headers) {
  return fetch(BASE + "/paypal/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

// PayPal signs transmissionId|transmissionTime|webhookId|crc32(rawBody).
function sign(rawBody, { id = "TX-1", time = "2026-09-29T00:00:00Z", webhookId = KEY.WEBHOOK_ID } = {}) {
  const TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const b = Buffer.from(rawBody);
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  const crc = (c ^ 0xFFFFFFFF) >>> 0;
  const s = crypto.createSign("RSA-SHA256");
  s.update([id, time, webhookId, crc].join("|"));
  s.end();
  return { sig: s.sign(KEY.PRIVATE_PEM, "base64"), id, time };
}

const headersFor = (rawBody, opts = {}) => {
  const { sig, id, time } = sign(rawBody, opts);
  return {
    "paypal-transmission-id": id,
    "paypal-transmission-time": time,
    "paypal-transmission-sig": opts.forgedSig || sig,
    "paypal-cert-url": opts.certUrl || "https://api.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-auth-algo": opts.algo || "SHA256withRSA",
  };
};

async function snapshot() {
  const [g] = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS t FROM gifts WHERE org_id=$1`, [ORG]);
  const [d] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  const [s] = await q(`SELECT webhook_seen_at, webhook_pending, last_error FROM giving_sources WHERE id=$1`, [SOURCE]);
  return JSON.stringify({ gifts: g.n, dollars: g.t, donors: d.n,
    seen: s?.webhook_seen_at || null, pending: s?.webhook_pending || false, err: s?.last_error || null });
}

async function reset() {
  for (const t of ["gifts", "gift_duplicate_questions", "giving_sources", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Int One Trust','int-one',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_int1pp',$1,'int1pp@test.local',$2,'Int Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,provider_account_id,backfilled_at,
                                       created_by,created_by_name)
           VALUES ($1,$2,'paypal','PayPal','active',$3,NOW(),'system:test','int1 suite')`, [SOURCE, ORG, MERCHANT]);
}

(async () => {
  console.log("INT-1 — a PayPal webhook with a bad signature is refused and records nothing\n");
  await reset();
  const raw = JSON.stringify(EVENT);
  const before = await snapshot();

  // ── §1 · A GENUINELY SIGNED REQUEST IS ACCEPTED ─────────────────────────
  // Without this leg, every assertion below would pass on a server that
  // refused everything, including PayPal.
  const good = await post(raw, headersFor(raw));
  ok("§1 a request signed with the configured key is accepted",
     good.status === 200 && good.body?.received === true, good);
  ok("§1 …and it is attributed to the org whose merchant id is on it",
     good.body?.acted === true && good.body?.kind === "payment", good.body);
  const [afterGood] = await q(`SELECT webhook_pending FROM giving_sources WHERE id=$1`, [SOURCE]);
  ok("§1 …and it NUDGES the reader rather than writing a gift itself",
     afterGood?.webhook_pending === true, afterGood);
  const [giftsAfterGood] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§1 …so even a VALID webhook writes no gift: one gift path, and this is not it",
     Number(giftsAfterGood.n) === 0, giftsAfterGood);

  await reset();
  const clean = await snapshot();

  // ── §2 · NO SIGNATURE AT ALL ────────────────────────────────────────────
  const bare = await post(raw, {});
  ok("§2 an unsigned request is refused", bare.status === 400 && bare.body?.error === "missing_headers", bare);

  // ── §3 · A VALID SIGNATURE OVER A DIFFERENT BODY ────────────────────────
  // Sign the real event, then send a body that says $99,000 instead. This is
  // the forgery that works whenever a server re-serialises the JSON before
  // checking, instead of hashing the bytes it received.
  const tampered = JSON.stringify({ ...EVENT, resource: { ...EVENT.resource, amount: { value: "99000.00", currency_code: "USD" } } });
  const replay = await post(tampered, headersFor(raw));
  ok("§3 a signature over a different body is refused",
     replay.status === 400 && replay.body?.error === "bad_signature", replay);

  // ── §4 · A CERTIFICATE FROM A HOST THE ATTACKER CONTROLS ────────────────
  const evil = await post(raw, headersFor(raw, { certUrl: "https://paypal.evil.example/certs/CERT-1" }));
  ok("§4 a certificate URL off PayPal's own domains is refused",
     evil.status === 400 && evil.body?.error === "bad_cert_host", evil);
  const evilLookalike = await post(raw, headersFor(raw, { certUrl: "https://api.paypal.com.evil.example/c.pem" }));
  ok("§4 …including a host that merely STARTS with PayPal's",
     evilLookalike.status === 400 && evilLookalike.body?.error === "bad_cert_host", evilLookalike);
  const httpCert = await post(raw, headersFor(raw, { certUrl: "http://api.paypal.com/c.pem" }));
  ok("§4 …and one fetched over plain http", httpCert.status === 400 && httpCert.body?.error === "bad_cert_host", httpCert);

  // ── §5 · AN ALGORITHM STEWARD DOES NOT USE ──────────────────────────────
  const algo = await post(raw, headersFor(raw, { algo: "SHA1withRSA" }));
  ok("§5 an unexpected signing algorithm is refused", algo.status === 400 && algo.body?.error === "bad_algo", algo);

  // ── §6 · A SIGNATURE THAT IS SIMPLY WRONG ───────────────────────────────
  const junk = await post(raw, headersFor(raw, { forgedSig: Buffer.from("not a signature").toString("base64") }));
  ok("§6 a junk signature is refused", junk.status === 400 && junk.body?.error === "bad_signature", junk);

  // ── §7 · SIGNED, BUT FOR SOMEBODY ELSE'S WEBHOOK ────────────────────────
  // The forger also names their webhook in a header, as anybody can.
  const otherHook = await post(raw, { ...headersFor(raw, { webhookId: "WH-SOMEONE-ELSES-WEBHOOK" }),
    "paypal-webhook-id": "WH-SOMEONE-ELSES-WEBHOOK" });
  ok("§7 a real signature made for a different webhook id is refused",
     otherHook.status === 400 && otherHook.body?.error === "bad_signature", otherHook);

  // ── THE POINT OF ALL OF IT ──────────────────────────────────────────────
  const after = await snapshot();
  ok("every refusal recorded NOTHING: no gift, no donor, and not even a mark on the source",
     after === clean, { before: clean, after });

  await reset();
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

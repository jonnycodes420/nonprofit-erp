// BUILD-63 Part 2 — the Stripe event manifest agrees with the handler.
//
// OFFLINE (source scan, no server/DB). Isolates each webhook handler block in
// server.js, extracts every `event.type === "..."` literal it dispatches on, and
// asserts the set equals the declared manifest in stripeEvents.js — BOTH ways:
//   - a handler `case` with no manifest entry FAILS (the manifest can't lag the
//     code — the BUILD-58 "shipped code, subscribed nothing" class starts with a
//     handler nobody wrote down);
//   - a manifest entry with no handler `case` FAILS (the manifest can't claim an
//     event the code doesn't actually process).
// So the manifest is DERIVED-and-enforced, never hand-maintained beside the code.

const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");
const { DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff } = require("../stripeEvents");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// The event.type literals the handler mounted at `route` dispatches on, taken
// from the block between that app.post(...) and the NEXT app.post(...).
function handlerEvents(route) {
  const start = src.indexOf(`app.post("${route}"`);
  if (start < 0) throw new Error(`route ${route} not found in server.js`);
  const rest = src.slice(start + `app.post("${route}"`.length);
  const nextPost = rest.indexOf("app.post(");
  const block = nextPost >= 0 ? rest.slice(0, nextPost) : rest;
  const set = new Set();
  for (const m of block.matchAll(/event\.type === "([^"]+)"/g)) set.add(m[1]);
  return set;
}

function assertAgree(label, handledSet, manifest) {
  const man = new Set(manifest);
  const missingFromManifest = [...handledSet].filter(e => !man.has(e)).sort();  // handler case, no manifest entry
  const missingFromHandler = [...man].filter(e => !handledSet.has(e)).sort();   // manifest entry, no handler case
  ok(`${label}: every handled event.type is in the manifest (no undeclared case)`,
    missingFromManifest.length === 0, missingFromManifest);
  ok(`${label}: every manifest entry has a handler case (no phantom entry)`,
    missingFromHandler.length === 0, missingFromHandler);
  // exact set equality, stated once more as the single load-bearing invariant
  ok(`${label}: manifest EXACTLY equals the handler's dispatch set`,
    missingFromManifest.length === 0 && missingFromHandler.length === 0
    && handledSet.size === man.size,
    { handled: [...handledSet].sort(), manifest: [...man].sort() });
}

(() => {
  assertAgree("donation (/stripe/webhook)", handlerEvents("/stripe/webhook"), DONATION_WEBHOOK_EVENTS);
  assertAgree("billing (/billing/webhook)", handlerEvents("/billing/webhook"), BILLING_WEBHOOK_EVENTS);

  // The manifest genuinely covers the BUILD-58 handlers that started this — a
  // regression here would mean refund/dispute reversal fell out of the manifest.
  for (const e of ["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
    ok(`donation manifest includes ${e} (BUILD-58 handler, must be tracked)`, DONATION_WEBHOOK_EVENTS.includes(e));
  }

  // webhookEventDiff — the primitive the live-subscription check + /health use.
  const d1 = webhookEventDiff(
    ["a", "b", "c", "d"],
    ["a", "b"]);
  ok("diff: handled-but-unsubscribed shows as `missing`", JSON.stringify(d1.missing) === JSON.stringify(["c", "d"]) && d1.extra.length === 0, d1);
  const d2 = webhookEventDiff(["a", "b"], ["a", "b", "z"]);
  ok("diff: subscribed-but-unhandled shows as `extra`", JSON.stringify(d2.extra) === JSON.stringify(["z"]) && d2.missing.length === 0, d2);
  const d3 = webhookEventDiff(["a", "b"], ["*"]);
  ok("diff: a Stripe wildcard subscription means nothing is missing", d3.wildcard === true && d3.missing.length === 0, d3);
  const d4 = webhookEventDiff(["a", "b"], ["a", "b"]);
  ok("diff: an exactly-matching subscription is clean", d4.missing.length === 0 && d4.extra.length === 0, d4);

  // The known real-world diff (documented in FINDINGS): the four BUILD-58 events
  // are exactly what a 6-event live endpoint is missing.
  const liveSubscribedNow = [
    "payment_intent.succeeded", "checkout.session.completed",
    "invoice.payment_failed", "invoice.payment_succeeded",
    "customer.subscription.updated", "customer.subscription.deleted",
  ];
  const live = webhookEventDiff(DONATION_WEBHOOK_EVENTS, liveSubscribedNow);
  ok("diff vs the pre-BUILD-63 live donation endpoint = the 4 BUILD-58 events",
    JSON.stringify(live.missing) === JSON.stringify(
      ["charge.dispute.closed", "charge.dispute.created", "charge.dispute.updated", "charge.refunded"]),
    live);

  summary();
})();

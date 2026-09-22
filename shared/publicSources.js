// shared/publicSources.js — BUILD-91 91i. WHO STEWARD IS ALLOWED TO NAME ON A
// PAGE A STRANGER READS, AND THE THREE THINGS THAT HAVE TO BE TRUE FIRST.
//
// ── WHY THIS IS A MODULE AND NOT A LIST IN A COMPONENT ─────────────────────
// The in-app page (BUILD-92 B2, Settings → Where giving comes in) shows every
// provider the product HAS an adapter for, because the person reading it has
// signed up, is holding their own key, and finds out within a minute whether
// the thing works. The landing page is read by somebody who has not signed up
// and cannot check. A tile there is a claim made to a stranger.
//
// So the two pages do NOT share a list. The public row is driven by one
// allowlist, here, and a source enters it only when all three of these are
// true:
//
//   1. its adapter is merged and green,
//   2. Jonathan has walked it on a REAL account on prod — not a sandbox, not
//      a fixture, a real gift from a real person's card,
//   3. its row in client/src/assets/sources/SOURCES.md is marked cleared by
//      him, meaning he has read that company's brand terms himself.
//
// Condition 2 is the one that is nearly always the blocker and it is the one
// that matters. An adapter that authenticates and returns zero rows has told
// us nothing about whether the mapping is right; it has only told us the
// password was accepted. PayPal is in exactly that state as this ships.
//
// ── EMPTY BY DEFAULT, AND THAT IS THE POINT ────────────────────────────────
// The failure this design is built against is not "we forgot to add Square".
// It is "Square appeared on the marketing page the day its adapter merged,
// three weeks before anyone ran a dollar through it." Adding a name here is a
// deliberate act with a person's initials on it. Forgetting to add one costs
// a line of marketing copy. Forgetting to REMOVE one costs a prospect who
// signed up for a connection that does not work.
//
// Pure: no DB, no network, no clock, no JSX. Imported by the landing page, by
// scripts/landing-prod-verify.js, and by tests/build91-public-sources.test.js.

// ── WHY THIS FILE DOES NOT IMPORT THE PROVIDER REGISTRY ────────────────────
// shared/givingSources.js is the registry and would be the obvious import.
// It cannot be one: it imports ../orgTime.js, which is CommonJS, and Rollup
// refuses it when the client bundles a module that reaches it. (That is also
// why Settings.jsx keeps its own DIRECT_ORDER and UPLOAD_ORDER rather than
// reading PROVIDERS — an undocumented workaround that cost this build a
// failed vite build to rediscover, so it is written down here.)
//
// The answer is NOT to duplicate the registry quietly. It is to mirror the
// three facts the public page needs — key, label, and whether the provider has
// an API that reads an account — and to pin the mirror to the real registry
// with a Node-side test that fails the build the moment the two disagree.
// tests/build91-public-sources.test.js is that test. Add a provider to the
// registry without adding it here and the suite goes red.
export const PUBLIC_SOURCES = {
  paypal:     { label: "PayPal",     mode: "api"  },
  zeffy:      { label: "Zeffy",      mode: "api"  },
  stripe:     { label: "Stripe",     mode: "api"  },
  givebutter: { label: "Givebutter", mode: "api"  },
  cashapp:    { label: "Cash App",   mode: "file" },
  venmo:      { label: "Venmo",      mode: "file" },
};

const FILE_PROVIDERS = Object.keys(PUBLIC_SOURCES).filter(k => PUBLIC_SOURCES[k].mode === "file");
const providerLabel = key => PUBLIC_SOURCES[key]?.label || String(key || "");

// ── THE ALLOWLIST ──────────────────────────────────────────────────────────
// Empty. Not a placeholder, not a TODO: this is the correct value on
// 21 September 2026, because no source has met all three conditions.
//
// PayPal is the closest and is still short by two of the three: it has never
// read a real payment (NEEDS JONATHAN item 4 — send the business account $1
// from a personal one and confirm it shows once at $1.00 gross with the fee
// beside it), and its SOURCES.md row is not cleared.
//
// To add one: do the walk, mark the row, then put the key here — in that
// order, never any other.
export const PUBLIC_SOURCE_ALLOWLIST = [];

// The order a cleared source would appear in, if it were cleared. Kept in step
// with DIRECT_ORDER on the in-app page so the two rows cannot disagree about
// sequence once they both have something in them.
export const PUBLIC_DIRECT_ORDER = ["paypal", "zeffy", "stripe", "givebutter"];

// ── THE LINE UNDER THE ROW ─────────────────────────────────────────────────
// One sentence, and both halves of it are load-bearing. The first half is what
// the row is for. The second is the promise the whole section exists to make,
// and it is repeated here rather than referenced because a person reading a
// row of other companies' names is exactly the person who needs telling that
// Steward is not one of them.
export const ROW_PROMISE = "Steward reads your gifts from these. It never holds or moves a dollar.";

export const DIRECT_HEADING = "Connects directly";
export const UPLOAD_HEADING = "Upload a statement";

// ── THE GUARD ──────────────────────────────────────────────────────────────
// Cash App and Venmo have no API that reads an account. Neither may EVER
// appear under "Connects directly", and the guard against that is not the
// verifier — a gate that only runs against prod is a gate that tells you after
// you have shipped. It is here, in the function that builds the row, and it
// throws rather than filters: a build that silently drops a bad entry hides
// the mistake that put it there.
export class DirectClaimRefused extends Error {
  constructor(key, why) {
    super(`refused to show ${providerLabel(key)} as a direct connection — ${why}`);
    this.name = "DirectClaimRefused";
    this.code = "DIRECT_CLAIM_REFUSED";
  }
}

// publicSourceRow({ allowlist, logos }) → { direct, upload, promise }
//
// `logos` maps a provider key to an imported asset URL, for the sources whose
// official file is in the repo AND whose row is cleared. A source with no
// cleared logo is NOT hidden: it shows its name in type. Nothing here draws,
// traces, recolours or approximates anybody's mark.
//
// The upload group is not allowlisted, and the asymmetry is deliberate. A tile
// saying "Cash App — once a month, drop the statement in" claims no connection
// to Cash App at all. There is nothing in it that could turn out to be false,
// so there is nothing for a clearance to protect against.
export function publicSourceRow({ allowlist = PUBLIC_SOURCE_ALLOWLIST, logos = {} } = {}) {
  const seen = new Set();
  const direct = [];
  for (const key of allowlist) {
    const meta = PUBLIC_SOURCES[key];
    if (!meta) throw new DirectClaimRefused(key, "there is no such provider in the registry");
    if (meta.mode !== "api") {
      throw new DirectClaimRefused(key, "it has no API that reads an account, so it can only ever be a statement upload");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    direct.push(tile(key, logos));
  }
  direct.sort((a, b) => orderOf(a.key) - orderOf(b.key));

  const upload = FILE_PROVIDERS.map(key => tile(key, logos));
  return { direct, upload, promise: ROW_PROMISE };
}

function orderOf(key) {
  const i = PUBLIC_DIRECT_ORDER.indexOf(key);
  return i === -1 ? PUBLIC_DIRECT_ORDER.length : i;
}

function tile(key, logos) {
  const logo = logos && logos[key] ? logos[key] : null;
  return { key, label: providerLabel(key), logo, inType: !logo };
}

// What a suite or the verifier asserts against: the exact set of names the
// public page is allowed to show as a direct connection right now. Exported so
// the gate counts what the config says rather than what somebody typed twice.
export function allowedDirectNames(allowlist = PUBLIC_SOURCE_ALLOWLIST) {
  return publicSourceRow({ allowlist }).direct.map(t => t.label);
}

export function uploadNames() {
  return publicSourceRow({ allowlist: [] }).upload.map(t => t.label);
}

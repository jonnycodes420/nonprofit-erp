// Canonical email base URL — guard suite (FIX 2026-08-04).
// Pure Node, no deps, no DB. Run: node tests/email-links.test.js
//
// Found live: the password-reset email linked to client-five-tau-13.vercel.app
// (a Vercel deployment domain) instead of stewardapp.dev — a real user
// correctly smells phishing. The unsubscribe + card-update links had the same
// class of problem on the raw railway.app API host.
//
// What this enforces, forever:
//   • publicUrl.js is the ONE resolver: canonical https://www.stewardapp.dev
//     fallback, deployment hosts (vercel.app / railway.app) REJECTED even when
//     the env is set to one, http→https upgrade, localhost only via explicit
//     env (local dev).
//   • server.js reads FRONTEND_URL nowhere itself — every link derives from
//     publicAppUrl(). No request-derived hosts (req.headers.host etc.), no
//     localhost, no vercel.app outside the CORS allowlist entry.
//   • buildUnsubscribeUrl / buildCardUpdateUrl use the canonical domain (the
//     vercel.json proxy rewrites make those backend routes reachable there),
//     not BACKEND_URL. BACKEND_URL survives ONLY for the invisible tracking
//     pixel.
//   • The boot check + /health.publicUrl exposure exist (the post-deploy
//     verification that prod links carry stewardapp.dev).
//   • vercel.json proxies /unsubscribe and /recurring/update-card to the
//     backend BEFORE the SPA catch-all.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg, detail) => {
  if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg + (detail ? ` — ${detail}` : "")); }
};
const read = p => fs.readFileSync(path.join(root, p), "utf8");

// ── 1. The pure resolver ──
const { CANONICAL_APP_URL, resolvePublicAppUrl } = require(path.join(root, "publicUrl"));

ok(CANONICAL_APP_URL === "https://www.stewardapp.dev", "canonical URL is https://www.stewardapp.dev");

const cases = [
  // [env, expected url, expected fromEnv, label]
  [{}, CANONICAL_APP_URL, false, "unset env → canonical fallback"],
  [{ FRONTEND_URL: "https://client-five-tau-13.vercel.app" }, CANONICAL_APP_URL, false, "vercel.app env value REJECTED → canonical"],
  [{ FRONTEND_URL: "https://something.vercel.app" }, CANONICAL_APP_URL, false, "any *.vercel.app REJECTED"],
  [{ FRONTEND_URL: "https://nonprofit-erp-production.up.railway.app" }, CANONICAL_APP_URL, false, "railway API host REJECTED"],
  [{ FRONTEND_URL: "https://www.stewardapp.dev" }, "https://www.stewardapp.dev", true, "canonical env honored"],
  [{ FRONTEND_URL: "https://www.stewardapp.dev/" }, "https://www.stewardapp.dev", true, "trailing slash stripped"],
  [{ FRONTEND_URL: "http://stewardapp.dev" }, "https://stewardapp.dev", true, "http upgraded to https"],
  [{ FRONTEND_URL: "stewardapp.dev" }, "https://stewardapp.dev", true, "bare domain gets https"],
  [{ FRONTEND_URL: "http://localhost:4173" }, "http://localhost:4173", true, "explicit localhost honored (local dev)"],
  [{ CORS_ORIGIN: "http://localhost:4173,https://other" }, "http://localhost:4173", true, "CORS_ORIGIN first origin is the local-dev fallback"],
  [{ FRONTEND_URL: "not a valid url at all" }, CANONICAL_APP_URL, false, "garbage env value → canonical fallback"],
];
for (const [env, url, fromEnv, label] of cases) {
  const r = resolvePublicAppUrl(env);
  ok(r.url === url && r.fromEnv === fromEnv, `resolver: ${label}`, `got ${r.url} fromEnv=${r.fromEnv}`);
}
const rej = resolvePublicAppUrl({ FRONTEND_URL: "https://client-five-tau-13.vercel.app" });
ok(rej.rejected === "https://client-five-tau-13.vercel.app", "resolver reports the rejected value (for the boot log)");

// ── 2. server.js source guard ──
const server = read("server.js");
const serverLines = server.split("\n");

// The one env read lives in publicUrl.js; server.js derives everything.
ok(!server.includes("process.env.FRONTEND_URL"), "server.js never reads FRONTEND_URL directly (publicUrl.js is the one resolver)");
ok(!server.includes("process.env.PUBLIC_APP_URL"), "no second base-URL env var was invented");
ok(!server.includes("VERCEL_URL"), "no VERCEL_URL anywhere in server.js");

// vercel.app may appear ONLY as the CORS allowlist entry (an allowed origin is
// not a link a donor sees).
const vercelLines = serverLines.filter(l => l.includes("vercel.app"));
ok(vercelLines.length === 1 && vercelLines[0].includes("DEFAULT_CORS_ORIGINS"),
  "vercel.app appears in server.js only on the CORS allowlist line", `found ${vercelLines.length} line(s)`);

// No request-derived hosts anywhere near link building — banned outright.
for (const pat of ['req.headers.host', 'req.get("host")', "req.get('host')", "req.hostname", "x-forwarded-host"]) {
  ok(!server.includes(pat), `no request-derived host in server.js (${pat})`);
}

// No localhost can ever leak into a production link.
ok(!/localhost/.test(server), "server.js contains no localhost reference at all");

// The two donor-visible backend links ride the canonical domain now.
const unsubFn = server.slice(server.indexOf("function buildUnsubscribeUrl"), server.indexOf("function buildUnsubscribeUrl") + 500);
ok(/publicAppUrl\(\)/.test(unsubFn) && !/BACKEND_URL/.test(unsubFn), "buildUnsubscribeUrl derives from publicAppUrl(), not BACKEND_URL");
const cardFn = server.slice(server.indexOf("function buildCardUpdateUrl"), server.indexOf("function buildCardUpdateUrl") + 500);
ok(/publicAppUrl\(\)/.test(cardFn) && !/BACKEND_URL/.test(cardFn), "buildCardUpdateUrl derives from publicAppUrl(), not BACKEND_URL");

// BACKEND_URL survives ONLY for the invisible tracking pixel (not a link).
const backendUrlLines = serverLines.filter(l => l.includes("BACKEND_URL"));
ok(backendUrlLines.length === 2 && backendUrlLines.some(l => l.includes("open.gif")),
  "BACKEND_URL remains only for the tracking pixel (definition + open.gif)",
  `found ${backendUrlLines.length} line(s): ${backendUrlLines.join(" | ").slice(0, 160)}`);

// The reset + invite links (the two observed/most-clicked leaks) derive from
// the resolver.
ok(/const resetLink = `\$\{frontendUrl\}\/reset-password\?token=/.test(server), "password-reset link derives from the resolved base");
const frontendAssigns = serverLines.filter(l => /(const|let|var)\s+frontendUrl\s*=/.test(l));
ok(frontendAssigns.length > 0 && frontendAssigns.every(l => l.includes("publicAppUrl()")),
  "every frontendUrl assignment in server.js is publicAppUrl()",
  frontendAssigns.filter(l => !l.includes("publicAppUrl()")).join(" | "));
ok(/const inviteLink = `\$\{publicAppUrl\(\)\}\/invite\//.test(server), "team-invite link derives from publicAppUrl()");

// Boot check + /health exposure (the post-deploy verification hooks).
ok(server.includes("[public-url]"), "boot check logs the resolved public URL loudly");
ok(/publicUrl:\s*\{\s*url:\s*pu\.url,\s*fromEnv:\s*pu\.fromEnv\s*\}/.test(server), "/health exposes publicUrl {url, fromEnv}");

// ── 3. Email template constants carry no off-canonical host ──
// (defense in depth: even hardcoded template bodies must never name a
// deployment host — the DEFAULT_* templates and drip bodies live in server.js,
// already covered by the whole-file greps above; re-assert the class.)
ok(!/vercel\.app/.test(server.replace(vercelLines[0] || "", "")), "no email template body references vercel.app");

// ── 4. vercel.json proxies the two backend link routes on the canonical domain ──
const vj = JSON.parse(read("vercel.json"));
const rw = vj.rewrites || [];
const unsubRw = rw.findIndex(r => r.source === "/unsubscribe");
const cardRw = rw.findIndex(r => r.source === "/recurring/update-card");
const spaRw = rw.findIndex(r => r.destination === "/index.html");
ok(unsubRw >= 0 && /nonprofit-erp-production\.up\.railway\.app\/unsubscribe/.test(rw[unsubRw]?.destination || ""),
  "vercel.json proxies /unsubscribe to the backend");
ok(cardRw >= 0 && /nonprofit-erp-production\.up\.railway\.app\/recurring\/update-card/.test(rw[cardRw]?.destination || ""),
  "vercel.json proxies /recurring/update-card to the backend");
ok(spaRw > unsubRw && spaRw > cardRw, "backend proxies come BEFORE the SPA catch-all rewrite");

// ── 5. Deploy gate: Vercel git auto-build stays OFF for main ──
// Go-live cutover (887bf2e, 2026-08-12): the frontend deploys ONLY via the
// deploy-vercel Actions job (green tests → vercel deploy → SHA-verified poll).
// Re-enabling git auto-build here would let a red-test push ship the client —
// a deliberate decision if ever, never a casual edit. (The ignored-build-step
// alternative was rejected; see BLOCKED-vercel-gate.md.)
ok(vj.git?.deploymentEnabled?.main === false,
  "vercel.json keeps git auto-build DISABLED for main (Actions-only frontend deploys)");

console.log(`\nemail-links: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

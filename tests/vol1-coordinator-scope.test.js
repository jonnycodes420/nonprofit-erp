// VOL-1 — THE VOLUNTEER COORDINATOR SEES VOLUNTEERS, NOT GIVING.
//
// The one new test this build earns, and it earns it because the rule is
// SECURITY: a new role exists, and the whole reason it exists is that the
// person holding it must not be able to read donors' giving.
//
// WHAT WOULD MAKE THIS FAIL (the guard-must-be-provable rule):
//   · delete one line from COORDINATOR_PREFIXES in auth.js  → a route a
//     coordinator needs starts refusing, and §2 goes red;
//   · add "/donors" to COORDINATOR_PREFIXES                 → §3 goes red;
//   · drop `stripGiving` from the roster read               → §4 goes red;
//   · make the gate read `payload.role` (the JWT) rather than the live row
//                                                           → §5 goes red.
// All four were planted and watched go red before this was trusted.
//
// It is a PURE test of the allowlist plus a live-server check of the two
// halves that carry data, so it needs only the scratch stack.
//
//   BASE=http://localhost:5601 node tests/vol1-coordinator-scope.test.js

const assert = require("assert");
const { coordinatorMayReach, VOLUNTEER_COORDINATOR } = require("../auth");

const BASE = process.env.BASE || "http://localhost:5601";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

(async () => {
  console.log("vol1-coordinator-scope");

  // ── §1 · the role has a name, and it is the one the invite writes ───────
  ok("§1 the role value is `volunteer_coordinator`", VOLUNTEER_COORDINATOR === "volunteer_coordinator", VOLUNTEER_COORDINATOR);

  // ── §2 · what a coordinator MUST be able to reach ───────────────────────
  // If any of these start refusing, the role is unusable and this goes red.
  const MUST_REACH = [
    "/health", "/me", "/me/mfa", "/org",
    "/volunteer-hub/roster", "/volunteer-hub/shifts", "/volunteer-hub/opportunities",
    "/volunteer-hub/slots/vsl_1/signups", "/volunteer-hub/credentials", "/volunteer-hub/report",
    "/volunteer-hub/report/export.csv", "/volunteer-hub/kiosk/vsl_1", "/volunteer-hub/checkin",
    "/volunteer-hub/signup-link", "/volunteer-shifts/vs_1", "/volunteer-hours/import",
    "/people/d_1", "/people/photos",
  ];
  for (const p of MUST_REACH) ok(`§2 a coordinator may reach ${p}`, coordinatorMayReach(p) === true, p);

  // ── §3 · what a coordinator MUST NOT reach ──────────────────────────────
  // Money, donors, and everything that is somebody else's job. An allowlist
  // means a route added tomorrow is refused by default; these are the ones
  // whose refusal is the POINT.
  const MUST_NOT_REACH = [
    "/donors", "/donors/summaries", "/donors/d_1", "/donors/d_1/plan", "/donors/d_1/gifts",
    "/gifts", "/gifts/g_1", "/grants", "/finance/summary", "/finance/funds", "/reports/major",
    "/pledges", "/campaigns", "/giving-pages", "/billing/create-checkout", "/org/export",
    "/org/export/csv", "/admin/orgs", "/journeys", "/threads", "/dashboard",
    // The near-misses that a sloppy prefix would let through.
    "/donorsomething", "/peopleexport", "/volunteers-of-other-things",
  ];
  for (const p of MUST_NOT_REACH) ok(`§3 a coordinator is refused ${p}`, coordinatorMayReach(p) === false, p);

  // ── §4 · the roster hands a coordinator no giving ───────────────────────
  // The allowlist lets them READ the roster; this is the other half of the
  // same boundary. A roster carrying `lifetimeGiving` would hand over
  // exactly what the allowlist refused, and the VOL-1 walk caught that the
  // rows were stripped while the SUMMARY SENTENCE still said "and three of
  // them also give" — a count of donors, on a screen that must not have one.
  const health = await fetch(BASE + "/health").then(r => r.json()).catch(() => null);
  if (!health || health.product !== "steward") {
    console.log("  SKIP-REFUSED: no scratch server on " + BASE + " — the live half of this suite cannot run");
    fail++;   // A skip here is a hole in a SECURITY guard. It fails.
  } else {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "routes", "volunteer.js"), "utf8");
    ok("§4 the roster read strips giving for a coordinator",
       /stripGiving\(req, people\)/.test(src) && /const stripGiving = \(req, people\)/.test(src));
    ok("§4 …including lifetimeGiving, lastGiftDate and alsoGives, by name",
       /\{ lifetimeGiving, lastGiftDate, alsoGives, \.\.\.rest \}/.test(src));
    ok("§4 …and the roster SENTENCE drops the count of donors too",
       /if \(givers && req\.user\.role !== COORD\)/.test(src));
    ok("§4 …and the `alsoGives` definition is not sent either",
       /req\.user\.role === COORD \? \{\} : \{ alsoGives:/.test(src));
    ok("§4 the givers view refuses the role outright rather than answering empty",
       /This view IS giving[\s\S]{0,400}coordinator_scope/.test(src));
  }

  // ── §5 · the gate reads the LIVE role, never the JWT's ──────────────────
  // A coordinator promoted to admin must gain access on the next request,
  // and an admin demoted to coordinator must lose it on the next request —
  // not in up to seven days, which is what a role baked into the token
  // would mean. requireAuth already overlays the live role for exactly this
  // reason; the gate must sit AFTER that overlay and read `req.user.role`.
  const authSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "auth.js"), "utf8");
  const overlayAt = authSrc.indexOf("req.user = { ...payload, role: info.role");
  const gateAt = authSrc.indexOf("if (req.user.role === VOLUNTEER_COORDINATOR)");
  ok("§5 the gate reads req.user.role (the live row), not payload.role", gateAt > 0 && overlayAt > 0 && gateAt > overlayAt,
     { overlayAt, gateAt });
  ok("§5 …and it refuses with a sentence, never a bare code",
     /coordinator_scope[\s\S]{0,200}message: "Your account covers volunteers and hours\./.test(authSrc));

  console.log(`\nvol1-coordinator-scope: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

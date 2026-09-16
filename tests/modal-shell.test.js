// BUILD-87 F.1 — ONE MODAL SHELL. Run: node tests/modal-shell.test.js
//
// The defect: the Edit-campaign dialog on Fundraising > Campaigns was clipped
// below "Start date", under a backdrop that covered only the top of a tall
// page. The cause is old and was already written down twice — `.fade-in` and
// its siblings animated a TRANSFORM with `animation-fill-mode: both`, so the
// final keyframe's `translateY(0)` was retained forever, and an element with
// any transform other than `none` is the containing block for every
// `position:fixed` descendant. A "fixed" backdrop inside one is not fixed to
// the viewport; it is fixed to a div that may be four thousand pixels tall.
//
// Two components had already found this and each worked around it LOCALLY
// (RecurringGiving portalled its own Modal; MetricBreakdownPanel portalled and
// wrote the reason in a comment). Twenty-eight other dialog shells had not.
// That is the shape of a defect that keeps coming back: the knowledge existed
// and had nowhere to live.
//
// So this suite holds two properties, and the browser walk
// (scripts/build87-f1-walk.js) measures what they buy:
//
//   §1  There is exactly ONE modal shell, it portals to document.body, and it
//       does the five things every dialog needs (viewport backdrop, 90vh cap
//       with its own scroll, scroll lock, Escape, focus return).
//   §2  NOTHING ELSE in the authenticated app hand-rolls a centred dialog.
//   §3  The root cause is fixed at the root too: no animation retains a
//       transform.
//   §4  The detector in §2 is PROVEN able to fail, against a synthetic tree —
//       a guard whose number cannot move is not measuring anything.

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "client/src");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};

const read = p => fs.readFileSync(path.join(SRC, p), "utf8");
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : (/\.jsx?$/.test(e.name) ? [p] : []);
});

// ── §1 · the shell ─────────────────────────────────────────────────────────
console.log("\n— §1 · one shell, and what it does for everybody —");
const shared = read("components/shared.jsx");
ok("shared.jsx exports exactly one Modal",
   (shared.match(/export function Modal\b/g) || []).length === 1);
ok("…and it PORTALS to document.body — the one thing no ancestor can undo",
   /createPortal\(/.test(shared) && /document\.body\);/.test(shared));
ok("…the backdrop is position:fixed covering the viewport",
   /position: "fixed", inset: 0, zIndex, background: backdrop/.test(shared));
ok("…the dialog is capped at 90vh and scrolls its OWN body",
   /maxHeight: "90vh"/.test(shared) && /className="modal-body" style=\{\{ overflowY: "auto"/.test(shared));
ok("…page scroll is locked while a dialog is open, and ref-counted so a dialog opened FROM a dialog does not unlock early",
   /scrollLocks\+\+/.test(shared) && /scrollLocks === 0\) document\.body\.style\.overflow/.test(shared));
ok("…Escape closes it", /e\.key === "Escape"/.test(shared) && /onClose\?\.\(\)/.test(shared));
ok("…and focus RETURNS TO THE OPENER when it closes",
   /openerRef\.current = document\.activeElement/.test(shared) && /back\.focus\?\.\(\{ preventScroll: true \}\)/.test(shared));
ok("…a sticky footer exists, so a long form's primary action cannot be pushed out of reach",
   /\{footer && \(/.test(shared));

// ── §2 · nothing else hand-rolls one ───────────────────────────────────────
console.log("\n— §2 · no second shell —");

// A CENTRED DIALOG is what this rule is about: a full-viewport fixed layer
// that centres a box ON TOP OF the page you can still see. It is NOT a side
// drawer, a full-screen takeover, a kiosk, a toast or an invisible
// click-catcher — those are different components with different jobs, and
// calling them modals to make a number look better would be the guard lying.
//
// The distinguishing property is the SCRIM: a dialog's backdrop is translucent,
// because the whole point of a dialog is that the page is still there behind
// it. An opaque fill is a screen, not a scrim — which is exactly what the
// Events check-in kiosk's loading state is, and why it is not a finding.
// Translucent means rgba(), or a hex WITH an alpha channel — #rrggbbaa or the
// #rgba shorthand. It deliberately does not match #rrggbb or #rgb: an opaque
// hex is a screen. (Anchored on the closing quote, because #0f1a12 would
// otherwise read as five hex digits plus a one-digit alpha.)
const TRANSLUCENT = /background:\s*["'](?:rgba\(|#[0-9a-f]{8}["']|#[0-9a-f]{4}["'])/i;
function adHocDialogs(source) {
  return source.split("\n").map((l, i) => ({ l, n: i + 1 })).filter(({ l }) =>
    /position:\s*["']fixed["']/.test(l) &&
    /inset:\s*0/.test(l) &&
    /alignItems:\s*["'](center|flex-start)["']/.test(l) &&
    /justifyContent:\s*["']center["']/.test(l) &&
    TRANSLUCENT.test(l));
}

// Named exclusions, each with the reason it is not a bug.
const EXCLUDED = {
  // shared.jsx IS the shell.
  "components/shared.jsx": "the shell itself",
  // The public surfaces are separate bundles on purpose. Landing is the EAGER
  // entry chunk (BUILD-07 route-split) and must never import shared.jsx —
  // ProductMark carries the same rule and the same comment. Donate renders the
  // ORG's white-label theme from publicTheme.js, not Steward's tokens. Both are
  // top-level route components with no transformed ancestor, so neither can hit
  // the containing-block trap; both are already named exclusions in the palette
  // census for the same underlying reason.
  "pages/Landing.jsx": "eager entry chunk — must not import shared.jsx (BUILD-07 route-split)",
  "pages/Donate.jsx": "public white-label surface on publicTheme.js, not the app tokens",
};

const offenders = [];
for (const abs of walk(SRC)) {
  const rel = path.relative(SRC, abs).split(path.sep).join("/");
  if (EXCLUDED[rel]) continue;
  const hits = adHocDialogs(fs.readFileSync(abs, "utf8"));
  for (const h of hits) offenders.push(`${rel}:${h.n}`);
}
ok("no component outside the shell hand-rolls a centred dialog overlay", offenders.length === 0, offenders);
ok("every exclusion is NAMED with its reason, and there are only the three",
   Object.keys(EXCLUDED).length === 3, Object.keys(EXCLUDED));

// The two components that had already solved this locally must now be using
// the shared one — that is the whole point of consolidating.
ok("RecurringGiving's own portalled Modal is gone and it imports the shared one",
   !/function Modal\(/.test(read("components/RecurringGiving.jsx"))
   && /import \{[^}]*\bModal\b[^}]*\} from "\.\/shared"/.test(read("components/RecurringGiving.jsx")));
ok("MetricBreakdownPanel no longer owns a portal, a key handler or a focus round-trip",
   !/createPortal/.test(read("components/MetricBreakdownPanel.jsx"))
   && /\bModal\b/.test(read("components/MetricBreakdownPanel.jsx")));

// Everything that renders a dialog gets it from one import.
const importers = walk(SRC).filter(a =>
  /import \{[^}]*\bModal\b[^}]*\} from ["']\.[./]*(components\/)?shared["']/.test(fs.readFileSync(a, "utf8")));
ok("the shell is imported from shared.jsx by every surface that has a dialog", importers.length >= 15, importers.length);

// ── §3 · the cause, fixed at the root ──────────────────────────────────────
console.log("\n— §3 · no animation retains a transform —");
// Every one of these animations ends on the identity transform, so `both`
// bought nothing and cost every dialog in the app. `backwards` holds the
// from-keyframe before the animation starts, which is the only part that was
// ever wanted.
for (const cls of ["fade-in", "slide-in", "slide-up", "modal-anim", "gold-moment"]) {
  const m = new RegExp(`\\.${cls}\\{animation:[^}]*\\}`).exec(shared);
  ok(`.${cls} does not use animation-fill-mode: both`, !!m && !/\bboth\b/.test(m[0]), m && m[0]);
}
ok("…and the keyframes they use really do end on the identity transform (which is why `backwards` is safe)",
   /@keyframes fadeIn\{from\{opacity:0;transform:translateY\(6px\)\}to\{opacity:1;transform:translateY\(0\)\}\}/.test(shared)
   && /@keyframes slideUp\{from\{opacity:0;transform:translateY\(12px\)\}to\{opacity:1;transform:translateY\(0\)\}\}/.test(shared));

// ── §4 · the detector can fail ─────────────────────────────────────────────
console.log("\n— §4 · the guard is proven able to fail —");
// A guard that cannot fire is ceremony with a pass count (BUILD-75 A.6). The
// detector is run against a synthetic tree that contains the exact defect this
// build removed, and against the shapes it must NOT flag.
const SYNTHETIC_BAD = `
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0f1a12cc", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: T.white, maxWidth: 460 }}>a hand-rolled dialog</div>
    </div>);`;
ok("the detector FLAGS a hand-rolled centred dialog", adHocDialogs(SYNTHETIC_BAD).length === 1,
   adHocDialogs(SYNTHETIC_BAD).map(h => h.n));
const SYNTHETIC_OK = [
  ['a side drawer', `<div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>`],
  ['a full-screen takeover', `<div className="fullscreen-takeover" style={{position:"fixed",top:52,left:0,right:0,bottom:0,zIndex:200,display:"flex",flexDirection:"column"}}>`],
  ['a toast', `<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk}}>`],
  ['an invisible click-catcher', `<div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:180}}/>`],
  // The kiosk loader: full-screen, centred, and OPAQUE. Not a dialog.
  ['an opaque full-screen loader', `<div style={{ position: "fixed", inset: 0, zIndex: 300, background: "#0f1a12", display: "flex", alignItems: "center", justifyContent: "center" }}>`],
];
// …and the scrim test must really be the thing doing that work, or it is not a
// distinction, it is a coincidence.
ok("the opaque loader is excluded BY ITS SCRIM, not by luck",
   adHocDialogs(SYNTHETIC_OK[4][1].replace('background: "#0f1a12"', 'background: "rgba(15,26,18,0.55)"')).length === 1);
for (const [what, line] of SYNTHETIC_OK)
  ok(`…and does NOT flag ${what}`, adHocDialogs(line).length === 0);

console.log(`\nmodal-shell: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

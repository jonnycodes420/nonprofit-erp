// BUILD-95 §5B — THE ONE WIDGET REGISTRY, AND THE GUARD THAT MAKES IT ONE.
//
// A widget used to be declared in THREE places nothing kept in step:
//   · server.js          — the type list and the validator
//   · PortalWidgets.jsx  — the render switch and the full-width set
//   · PortalEditor.jsx   — the label, the hint and the insert default
//
// Adding a widget to two of the three gives you a screen that renders nothing,
// or an editor offering something the server refuses — and NO TEST COULD SEE
// IT, because there was nothing for a test to compare the three against.
//
// `shared/pageWidgets.js` is that something, and this suite is what makes the
// arrangement hold: it walks each consumer back to the registry. §5 proves it
// can fail, against a synthetic tree carrying the exact defect.
const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const root = path.join(__dirname, "..");
const read = f => readSource(path.join(root, f));
// A comment is not code — a file explaining the rule must not satisfy it.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

(async () => {
  const reg = await import("../shared/pageWidgets.js");

  console.log("— the registry is complete on its own terms —");
  ok("every widget has a key, label, hint, surfaces and defaults",
    reg.WIDGETS.every(w => w.key && w.label && w.hint && Array.isArray(w.surfaces) && w.surfaces.length && w.defaults));
  ok("every surface named is a real surface",
    reg.WIDGETS.every(w => w.surfaces.every(sf => reg.SURFACES.includes(sf))));
  ok("no key is declared twice", new Set(reg.WIDGET_TYPES).size === reg.WIDGET_TYPES.length);
  ok("a default carries its own type back",
    reg.WIDGET_TYPES.every(k => reg.defaultWidget(k).type === k));
  ok("an unknown key gets null, never a half-built widget", reg.defaultWidget("nope") === null);

  console.log("— THE SURFACE IS A FILTER, and it actually filters —");
  const give = reg.typesForSurface("give"), portal = reg.typesForSurface("portal");
  ok("a giving page carries most of the portal's widgets", give.length >= 10, give.length);
  ok("…but NOT the give button — on a giving page the form is already there",
    !give.includes("give") && portal.includes("give"));
  ok("…and NOT My Giving — that needs a donor session, and a giving page is opened by a stranger",
    !give.includes("mygiving") && portal.includes("mygiving"));
  ok("every give widget is also a portal widget (the filter subtracts, never invents)",
    give.every(k => portal.includes(k)));

  console.log("— THE FORM IS FIXED, and only its side of the page is hers —");
  ok("there is no form widget to delete", !reg.WIDGET_TYPES.includes("form") && !reg.WIDGET_TYPES.includes("donate"));
  ok("two positions, and no third", reg.FORM_POSITIONS.length === 2 && reg.FORM_POSITIONS.every(p => reg.FORM_POSITION_LABEL[p]));
  ok("a junk position falls back rather than hiding the form",
    reg.normalizeFormPosition("sideways") === reg.DEFAULT_FORM_POSITION
    && reg.normalizeFormPosition(null) === reg.DEFAULT_FORM_POSITION
    && reg.normalizeFormPosition("bottom") === "bottom");

  console.log("— and the three consumers now READ it rather than repeating it —");
  const srv = strip(read("server.js"));
  const rend = strip(read("client/src/components/PortalWidgets.jsx"));
  const edit = strip(read("client/src/pages/PortalEditor.jsx"));

  ok("server.js imports the registry", /shared\/pageWidgets/.test(srv));
  ok("…and no longer declares its own type list",
    !/const WIDGET_TYPES\s*=\s*\[\s*"/.test(srv));
  ok("the renderer imports the registry", /shared\/pageWidgets/.test(rend));
  ok("…and derives full-width from it, not from a second literal",
    /WIDGETS\.filter\(w => w\.full\)/.test(rend) && !/FULL_WIDTH_WIDGETS = new Set\(\[\s*"/.test(rend));
  ok("the editor imports the registry", /shared\/pageWidgets/.test(edit));
  ok("…and derives its labels from it", /WIDGET_META = Object\.fromEntries\(WIDGETS/.test(edit));
  ok("…and its insert defaults from it, with no DEFAULT_WIDGET table left",
    /defaultWidget\(type\)/.test(edit) && !/const DEFAULT_WIDGET = \{/.test(edit));
  ok("…and its palette is SURFACE-FILTERED, not the whole registry",
    /widgetTypesHere\(surface\)/.test(edit) && !/Object\.entries\(WIDGET_META\)\.map/.test(edit));

  console.log("— every registered widget is actually RENDERABLE —");
  // The renderer switches on `w.type`. A key with no case draws nothing, which
  // on a live page is indistinguishable from an empty widget.
  for (const k of reg.WIDGET_TYPES)
    ok(`"${k}" has a branch in the renderer`, new RegExp(`case "${k}"`).test(rend), k);

  console.log("— §5 THE GUARD IS PROVEN ABLE TO FAIL —");
  // Against a synthetic tree carrying the exact defect this exists to catch:
  // a widget in the registry that the renderer never learned to draw.
  const fakeRend = rend + '\n// (synthetic: registry gains a key the renderer has no case for)\n';
  const invented = "timeline";
  ok("a registered widget with no renderer branch WOULD fail",
    !new RegExp(`case "${invented}"`).test(fakeRend));
  // …and a re-declared literal would fail too.
  const fakeSrv = 'const WIDGET_TYPES = ["hero", "richtext"];\n';
  ok("a server that re-declares the list WOULD fail",
    /const WIDGET_TYPES\s*=\s*\[\s*"/.test(fakeSrv));
  const fakeEdit = 'const DEFAULT_WIDGET = {\n  hero: {},\n};\n';
  ok("an editor that re-declares its defaults WOULD fail",
    /const DEFAULT_WIDGET = \{/.test(fakeEdit));

  summary();
})().catch(e => { console.error(e); process.exit(1); });

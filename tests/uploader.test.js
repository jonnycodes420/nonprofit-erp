// Uploader redesign source guard (2026-08-15) — the ONE shared uploader
// renders all six states ITSELF (empty drop target · filled image/file tile ·
// drag-over · uploading · inline error · file tile for CSV), and every call
// site passes its current value in via `preview`/`fileMeta` instead of
// rendering sibling preview/Remove markup.
//
// Pure Node, no deps, no DB. Run: node tests/uploader.test.js
// Assertions are grep-robust source markers, never line numbers.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const read = p => fs.readFileSync(path.join(root, p), "utf8");

const uploader = read("client/src/components/Uploader.jsx");
const settings = read("client/src/components/Settings.jsx");
const donors = read("client/src/components/Donors.jsx");
const fundraising = read("client/src/components/Fundraising.jsx");
const portalEditor = read("client/src/pages/PortalEditor.jsx");

// ── 1) The component defines the six states ────────────────────────────────

// FILLED (image): `preview` prop → the image IS the control, crop shapes.
ok(/preview = null/.test(uploader), "Uploader has a `preview` prop (filled image state)");
ok(/filled = !!\(preview \|\| fileMeta\)/.test(uploader), "filled state derives from preview/fileMeta");
ok(/shape = "auto"/.test(uploader), "Uploader has a `shape` prop");
ok(/banner: "1200 \/ 300"/.test(uploader), "banner crop ratio (~1200/300) defined");
ok(/wide: "16 \/ 9"/.test(uploader), "wide crop ratio (16/9) defined");
ok(/aspectRatio: "1 \/ 1"/.test(uploader), "square crop (1/1) defined");
ok(/objectFit: "cover"/.test(uploader), "filled image renders objectFit cover in its crop shape");

// Replace / Remove control bar — hover/focus reveal, always visible on touch.
ok(/onRemove = null/.test(uploader), "Uploader has an `onRemove` prop");
ok(/aria-label="Remove"/.test(uploader), "Remove is a real labeled <button>");
ok(/aria-label="Replace"/.test(uploader), "Replace is a real labeled <button>");
ok(/\.uploader-tile:hover \.uploader-actions/.test(uploader), "actions reveal on hover");
ok(/\.uploader-tile:focus-within \.uploader-actions/.test(uploader), "actions reveal on focus-within (keyboard)");
ok(/@media \(hover: none\)/.test(uploader), "actions always visible on touch (@media hover:none)");
ok(uploader.includes("uploader-zone"), "keeps the `uploader-zone` class hook");

// FILLED (file tile): `fileMeta` for CSV/non-image — glyph, name, size, detail.
ok(/fileMeta = null/.test(uploader), "Uploader has a `fileMeta` prop (file tile state)");
ok(uploader.includes("▤"), "file tile uses the monochrome document glyph (no emoji)");
ok(/humanFileSize/.test(uploader), "file tile renders a human-readable size");
ok(/truncateMiddle/.test(uploader), "file name middle-truncates");

// DRAG-OVER: calm gold shift on empty AND filled — no animation/transform.
ok(/active \? T\.gold500 : T\.bg3/.test(uploader), "drag-over shifts the border to gold (both states)");
ok(/T\.gold100/.test(uploader), "drag-over uses the gold100 wash");
ok(!/transform|scale\(|bounce/i.test(uploader.replace(/animation: uploader-indet[^;]*/g, "")),
  "no bounce/transform animation on drag-over");

// UPLOADING: inline progress ON the tile — determinate + indeterminate bar.
ok(/progress = null/.test(uploader), "Uploader has a `progress` prop (0..1)");
ok(/uploader-bar-indet/.test(uploader), "indeterminate inline bar class exists");
ok(/@keyframes uploader-indet/.test(uploader), "indeterminate bar animation defined locally");
ok(/prefers-reduced-motion/.test(uploader), "indeterminate animation disabled under reduced motion");
ok(/typeof progress === "number"/.test(uploader), "determinate width comes from the progress prop");

// ERROR: inline on the tile — the error REPLACES the constraint/hint line.
ok(/\{error \|\| hintText\}/.test(uploader), "empty state: error replaces the hint line");
ok(/error \? T\.terra700 : T\.ink3/.test(uploader), "error renders in T.terra700 in the hint slot");
ok(/error &&[\s\S]{0,120}T\.terra700[\s\S]{0,200}\{error\}/.test(uploader),
  "filled state: inline error strip inside the tile");
// The OLD pattern — a red sentence floating below the control — is gone.
ok(!/\{error && <div style=\{\{ marginTop: 6/.test(uploader),
  "old below-the-tile error div is gone");

// EMPTY: real drop target — dashed hairline, instruction + quiet constraint.
ok(/dashed \$\{active \? T\.gold500 : T\.bg3\}/.test(uploader), "empty state is a dashed T.bg3 drop area");
ok(/hint = ""/.test(uploader), "Uploader has a `hint` prop (constraint line override)");
ok(/hint\s*\|\|\s*acceptLabel/.test(uploader) || /const hintText = hint/.test(uploader),
  "constraint line defaults from hint/acceptLabel/maxBytes");
ok(/Drag an image here, or browse/.test(uploader), "default instruction line present");

// Keyboard + a11y unchanged: whole zone is a button, Enter/Space browse, paste.
ok(/role="button"/.test(uploader), "zone stays a keyboard target (role=button)");
ok(/e\.key === "Enter" \|\| e\.key === " "/.test(uploader), "Enter/Space opens browse");
ok(/onPaste/.test(uploader), "paste-from-clipboard kept");

// T tokens only — no raw hex literals in the component (T.* + alpha suffixes on T.ink only).
ok(!/#[0-9a-fA-F]{3,8}/.test(uploader), "Uploader carries no raw hex color literals (T tokens only)");

// No pictographic emoji anywhere in the component (BUILD-20 standing rule).
ok(!/[\u{1F000}-\u{1FAFF}\u{FE0F}]/u.test(uploader), "no emoji in the component");

// ── 2) ONE uploader: no other <input type="file"> anywhere in client/src ──
const offenders = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(jsx|js)$/.test(e.name)) {
      if (full.endsWith(path.join("components", "Uploader.jsx"))) continue;
      if (fs.readFileSync(full, "utf8").includes('type="file"')) offenders.push(path.relative(root, full));
    }
  }
})(path.join(root, "client", "src"));
ok(offenders.length === 0,
  'no `type="file"` input outside Uploader.jsx — offenders: ' + offenders.join(", "));

// ── 3) Every call site uses the component's own states ─────────────────────
// Each <Uploader occurrence must pass `preview` (single image), `fileMeta`
// (file tile / CSV), or be a documented multi-photo (`multiple`, children
// thumbnail strip) or any-file site (donor materials → uploadMaterial).
const CALLERS = [
  "client/src/components/Settings.jsx",
  "client/src/components/Donors.jsx",
  "client/src/components/Fundraising.jsx",
  "client/src/pages/PortalEditor.jsx",
];
for (const rel of CALLERS) {
  const src = read(rel);
  let idx = 0, site = 0;
  while ((idx = src.indexOf("<Uploader", idx)) !== -1) {
    site++;
    const slice = src.slice(idx, idx + 1500);
    const okSite = /\bpreview=/.test(slice) || /\bfileMeta=/.test(slice)
      || /\bmultiple\b/.test(slice) || /uploadMaterial/.test(slice);
    ok(okSite, `${rel} <Uploader> site #${site} passes preview/fileMeta or is a documented multiple/any-file site`);
    idx += 9;
  }
  ok(site > 0, `${rel} still uses the shared Uploader`);
}

// ── 4) Specific call-site contracts ────────────────────────────────────────

// Settings › Branding logo: square filled state, no separate preview box/Remove.
ok(/shape="square" preview=\{logo\|\|null\}/.test(settings), "Settings logo: shape=square + preview wired");
ok(!/width:64,height:64,borderRadius:12,border:"1px dashed "/.test(settings),
  "Settings logo: old 64px sibling preview box deleted");

// PortalEditor Design mode: portal logo square, header banner (landscape
// validate kept; the banner-shaped filled state IS the crop preview).
ok(/shape="square" preview=\{logoSrc \|\| null\}/.test(portalEditor), "PortalEditor logo: square + preview");
ok(/shape="banner" preview=\{headerSrc \|\| null\}/.test(portalEditor), "PortalEditor header: banner + preview");
ok(/img\.height >= img\.width/.test(portalEditor), "PortalEditor header keeps the landscape validate");
ok(!portalEditor.includes('"1200 / 250"'), "PortalEditor: separate banner-crop preview div deleted");
ok(/shape="wide" preview=\{value/.test(portalEditor), "PortalEditor widget imgUploader: wide + preview + onRemove");

// Fundraising campaign hero: wide filled state, children preview gone.
ok(/shape="wide" preview=\{dfHero/.test(fundraising), "Fundraising dfHero: shape=wide + preview");
ok(/onRemove=\{\(\) => \{ setDfHero\(""\)/.test(fundraising), "Fundraising dfHero: onRemove clears the value");
ok(!fundraising.includes("</Uploader>"), "Fundraising: no children preview markup left");

// CSV import file-tile: every import COMPONENT that reads a spreadsheet must
// show the filled file tile (fileMeta from the parsed file). There are TWO such
// components — `DonorImport` (which serves BOTH the "Import donors only" and the
// "Import + History" menu entries via its `withHistory` prop; the tile is gated
// on `srcFile && (parsed || xlsxSheets || bothMode)`, NOT on withHistory, so all
// three user-facing entry points show it) and `GiftHistoryImport`. The legacy
// `CombinedImport` third component was DELETED in BUILD-58 — so the count is 2,
// not 3. (Verified 2026-08-21: all three entry points genuinely pass fileMeta;
// this was a stale count, not a missing site.)
const csvMetaCount = (donors.match(/fileMeta=\{srcFile \? \{/g) || []).length;
ok(csvMetaCount === 2, `Donors.jsx: both CSV import components pass fileMeta (found ${csvMetaCount})`);
ok(/transaction ledger|shapeLabel\(effectiveShape\)/.test(donors),
  "Donors CSV fileMeta detail carries rows + detected shape");

// Request-Gift modal: labeled link pattern, never a raw URL as visible text.
ok(donors.includes("Open link ↗"), "Request-Gift: 'Open link ↗' button-style <a> present");
ok(!/>\{url\}</.test(donors), "Request-Gift: no raw payment-link URL rendered as text");

console.log(`\nuploader: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

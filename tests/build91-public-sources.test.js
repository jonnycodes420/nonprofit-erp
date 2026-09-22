// BUILD-91 91i — THE PUBLIC SOURCE ROW, AND THE THREE THINGS THAT GATE IT.
// Run: node tests/build91-public-sources.test.js
//
// THE SENTENCE THIS PART HAS TO MAKE TRUE:
//   A stranger reading the landing page is never shown a company Steward has
//   not actually read a real person's money out of.
//
// The in-app page may show every provider there is an adapter for: the person
// reading it has signed up, holds their own key, and learns within a minute
// whether it works. The landing page is read by somebody who cannot check
// anything, so a tile there is a claim, and it waits for evidence.
//
//   §1  THE MIRROR. shared/publicSources.js cannot import the registry (the
//       registry reaches ../orgTime.js, which is CommonJS, and the client
//       bundle refuses it). So it mirrors three facts, and THIS section is
//       the thing that stops the mirror drifting from the registry.
//   §2  THE ALLOWLIST. Empty today, and empty is the correct value, not an
//       oversight. Nothing appears by accident.
//   §3  THE GUARD. Cash App and Venmo can never be shown as a direct
//       connection, and the refusal THROWS rather than filtering, because a
//       build that silently drops a bad entry hides the mistake that put it
//       there.
//   §4  THE LOGOS. No file ships, every tile is a name in type, and a source
//       with no cleared logo is shown rather than hidden.
//   §5  SOURCES.md. The clearance ledger exists, has a row per source, and
//       not one of them is cleared.
//   §6  THE PAGE. Landing.jsx renders the row through the module, and the
//       voice rules that apply to the section apply to what the row adds.
//
// Pure and offline: no DB, no server, no network.

const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");

const ROOT = path.join(__dirname, "..");

(async () => {
  const pub = await import("../shared/publicSources.js");
  const reg = await import("../shared/givingSources.js");

  // ── §1 · THE MIRROR CANNOT DRIFT ────────────────────────────────────────
  console.log("\n— §1 · the mirror is pinned to the registry —");

  const mirrorKeys = Object.keys(pub.PUBLIC_SOURCES).sort();
  const regKeys = reg.PROVIDER_KEYS.slice().sort();
  ok("every provider in the registry is mirrored, and no extra one is invented",
    JSON.stringify(mirrorKeys) === JSON.stringify(regKeys),
    { mirror: mirrorKeys, registry: regKeys });

  const labelDrift = regKeys.filter(k => pub.PUBLIC_SOURCES[k]?.label !== reg.PROVIDERS[k].label);
  ok("every mirrored label is the registry's own label, to the character",
    labelDrift.length === 0, labelDrift.map(k => ({ k, mirror: pub.PUBLIC_SOURCES[k]?.label, reg: reg.PROVIDERS[k].label })));

  const modeDrift = regKeys.filter(k => pub.PUBLIC_SOURCES[k]?.mode !== reg.PROVIDERS[k].mode);
  ok("every mirrored mode agrees with the registry about api versus file",
    modeDrift.length === 0, modeDrift.map(k => ({ k, mirror: pub.PUBLIC_SOURCES[k]?.mode, reg: reg.PROVIDERS[k].mode })));

  // The mirror exists so the client can bundle this module. If that ever
  // stops being true the mirror is dead weight, so the reason is asserted
  // rather than only commented.
  const src = fs.readFileSync(path.join(ROOT, "shared/publicSources.js"), "utf8");
  ok("publicSources.js imports nothing, so the client bundle cannot reach a CommonJS module through it",
    !/^\s*import\s/m.test(src), (src.match(/^\s*import\s.*$/m) || [])[0]);

  // ── §2 · THE ALLOWLIST IS EMPTY, ON PURPOSE ─────────────────────────────
  console.log("\n— §2 · the allowlist —");

  ok("the allowlist is empty, so no source is claimed as a direct connection",
    Array.isArray(pub.PUBLIC_SOURCE_ALLOWLIST) && pub.PUBLIC_SOURCE_ALLOWLIST.length === 0,
    pub.PUBLIC_SOURCE_ALLOWLIST);

  const row = pub.publicSourceRow();
  ok("the direct group has no tiles", row.direct.length === 0, row.direct);
  ok("the page names no company as a direct connection",
    pub.allowedDirectNames().length === 0, pub.allowedDirectNames());

  // PayPal is the one that will go in first, so the thing being asserted is
  // that it is NOT in yet. It connects and reads zero, which is not evidence
  // the mapping is right.
  ok("PayPal is not in the allowlist, because it has never read a real payment",
    !pub.PUBLIC_SOURCE_ALLOWLIST.includes("paypal"));

  // And the row still works the moment one is added, in the right order.
  const withTwo = pub.publicSourceRow({ allowlist: ["stripe", "paypal"] });
  ok("a source added to the allowlist appears, in the row's own order rather than the allowlist's",
    withTwo.direct.map(t => t.key).join(",") === "paypal,stripe", withTwo.direct.map(t => t.key));

  // ── §3 · THE GUARD THROWS ───────────────────────────────────────────────
  console.log("\n— §3 · Cash App and Venmo can never be a direct connection —");

  for (const key of ["cashapp", "venmo"]) {
    let threw = null;
    try { pub.publicSourceRow({ allowlist: [key] }); } catch (e) { threw = e; }
    ok(`${pub.PUBLIC_SOURCES[key].label} in the allowlist REFUSES the build rather than being quietly dropped`,
      !!threw && threw.code === "DIRECT_CLAIM_REFUSED", threw && threw.message);
  }

  let unknown = null;
  try { pub.publicSourceRow({ allowlist: ["square"] }); } catch (e) { unknown = e; }
  ok("a provider that does not exist refuses too, rather than rendering an empty tile",
    !!unknown && unknown.code === "DIRECT_CLAIM_REFUSED", unknown && unknown.message);

  // The upload group is NOT allowlisted, and the asymmetry is the point: a
  // tile saying "once a month, drop the statement in" claims no relationship
  // with the company, so there is nothing in it that could turn out false.
  ok("Cash App and Venmo are both shown, under the upload heading",
    row.upload.map(t => t.label).join(",") === "Cash App,Venmo", row.upload.map(t => t.label));

  // ── §4 · THE LOGOS ──────────────────────────────────────────────────────
  console.log("\n— §4 · no mark is drawn, traced or recoloured —");

  ok("every tile on the page today is a name in type",
    [...row.direct, ...row.upload].every(t => t.inType === true && t.logo === null),
    [...row.direct, ...row.upload].map(t => ({ k: t.key, logo: t.logo })));

  const assetDir = path.join(ROOT, "client/src/assets/sources");
  const assetFiles = fs.readdirSync(assetDir).filter(f => f !== "SOURCES.md");
  ok("the source asset directory holds no image file, because none has been cleared",
    assetFiles.length === 0, assetFiles);

  // A source whose logo IS cleared keeps its tile and swaps type for the file;
  // a source without one is shown in type rather than hidden.
  const mixed = pub.publicSourceRow({ allowlist: ["paypal", "zeffy"], logos: { paypal: "/assets/paypal.svg" } });
  ok("a cleared logo replaces the type on its own tile and on no other",
    mixed.direct[0].logo === "/assets/paypal.svg" && mixed.direct[0].inType === false
    && mixed.direct[1].logo === null && mixed.direct[1].inType === true,
    mixed.direct);

  // ── §5 · THE CLEARANCE LEDGER ───────────────────────────────────────────
  console.log("\n— §5 · SOURCES.md —");

  const ledgerPath = path.join(assetDir, "SOURCES.md");
  ok("SOURCES.md exists, in the asset directory the in-app page already points at",
    fs.existsSync(ledgerPath));
  const ledger = fs.readFileSync(ledgerPath, "utf8");

  const missingRow = Object.values(pub.PUBLIC_SOURCES).map(v => v.label).filter(l => !ledger.includes(l));
  ok("every source has a row in the ledger", missingRow.length === 0, missingRow);
  ok("QuickBooks has a row too, so the strictest brand terms are not discovered late",
    /QuickBooks/.test(ledger));

  // The column that gates everything. Not one row is cleared, and the suite
  // says so out loud rather than leaving it to be noticed.
  // The Cleared column is the gate, so this reads it rather than looking for
  // a word anywhere in the file. Every data row in the table must say exactly
  // "no" in its last cell. The first cut of this assertion searched the split
  // cell for a leading "|" that split() had already removed, so it could never
  // match and passed against a row marked "JA 2026-09-21". It is asserted
  // against a known-cleared row below, because a gate nobody has watched fail
  // is not a gate.
  const clearedIn = md => md.split("\n")
    .filter(l => /^\s*\|/.test(l) && l.split("|").length >= 7 && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map(l => l.split("|").slice(1, -1).map(c => c.trim()))
    .filter(cells => cells[0] !== "Source")
    .filter(cells => cells[cells.length - 1].toLowerCase() !== "no");

  ok("no row is marked cleared, which is why the allowlist is empty",
    clearedIn(ledger).length === 0, clearedIn(ledger));
  ok("and the reader that says so would actually catch a cleared row",
    clearedIn(ledger.replace(/\| no \|$/m, "| JA 2026-09-21 |")).length === 1);
  ok("every source row was read, rather than the table being missed entirely",
    ledger.split("\n").filter(l => /^\s*\|/.test(l) && l.split("|").length >= 7).length >= 8);

  ok("the ledger says plainly that no logo file has been fetched",
    /No logo file has been fetched/i.test(ledger));

  // ── §6 · THE PAGE ───────────────────────────────────────────────────────
  console.log("\n— §6 · the landing page renders the row through the module —");

  const landing = fs.readFileSync(path.join(ROOT, "client/src/pages/Landing.jsx"), "utf8");
  ok("Landing.jsx builds the row from shared/publicSources rather than from a list of its own",
    /from "\.\.\/\.\.\/\.\.\/shared\/publicSources"/.test(landing) && /publicSourceRow\(\)/.test(landing));
  ok("no provider name is hardcoded into the row's markup",
    !/SourceTile[\s\S]{0,400}(PayPal|Zeffy|Givebutter|Cash App|Venmo)/.test(landing));
  ok("the row carries the promise, both halves of it",
    /never holds or moves a dollar/.test(pub.ROW_PROMISE) && /reads your gifts from these/.test(pub.ROW_PROMISE),
    pub.ROW_PROMISE);

  // The section's standing voice rules apply to anything the row adds to it.
  const rowText = [pub.DIRECT_HEADING, pub.UPLOAD_HEADING, pub.ROW_PROMISE,
    ...row.upload.map(t => t.label)].join(" ");
  ok("nothing the row adds says live, real time or instantly about a six-hourly read",
    !reg.FORBIDDEN_FRESHNESS_WORDS.some(w => rowText.toLowerCase().includes(w)), rowText);
  ok("no em dash in anything the row adds (the standing voice rule)",
    !rowText.includes("—"), rowText);

  summary();
})();

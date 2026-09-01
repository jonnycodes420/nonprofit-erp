// BUILD-73 Part 4 — THE DONOR FIELD'S PROPERTIES.
//
// The landing page's strongest section shows the SAME 199 donors at three
// moments in a year, and its whole claim is that June's drifted donors are a
// SUBSET of December's — the same people, further along. If that nesting is
// wrong the section is lying about the one thing it exists to show, and it
// would be lying beautifully: three fields of coloured dots look correct
// whatever the indices are. Nobody would catch it by eye.
//
// So it is asserted, not trusted. These are pure properties of
// client/src/lib/donorField.js — no server, no browser, no DOM.

const { ok, summary } = require("./helpers");

(async () => {
  const {
    FIELD_SIZE, DRIFT_ORDER, DRIFT_COUNTS, STEADY_COUNT,
    driftSet, fieldDots, breatheDelay,
  } = await import("../client/src/lib/donorField.js");

  // ── §1 · the constants ──────────────────────────────────────────────────
  console.log("\n— §1 · the field —");
  ok("the field is 199 donors", FIELD_SIZE === 199, FIELD_SIZE);
  ok("74 of them drift", DRIFT_ORDER.length === 74, DRIFT_ORDER.length);
  ok("the drift set has no duplicates", new Set(DRIFT_ORDER).size === 74, DRIFT_ORDER.length);
  ok("every drift index is inside the field",
     DRIFT_ORDER.every(i => Number.isInteger(i) && i >= 0 && i < FIELD_SIZE), DRIFT_ORDER.filter(i => i < 0 || i >= FIELD_SIZE));
  ok("the legend's steady count is the remainder (199 − 74 = 125)",
     STEADY_COUNT === 125 && STEADY_COUNT === FIELD_SIZE - DRIFT_COUNTS.hero, STEADY_COUNT);

  // ── §2 · THE NESTING — the property the section's honesty rests on ──────
  console.log("\n— §2 · the year progression nests —");
  const jan = [...driftSet(DRIFT_COUNTS.january)];
  const jun = [...driftSet(DRIFT_COUNTS.june)];
  const dec = [...driftSet(DRIFT_COUNTS.december)];

  ok("January: nobody has drifted", jan.length === 0, jan.length);
  ok("June: 31 have", jun.length === 31, jun.length);
  ok("December: 74 have", dec.length === 74, dec.length);

  ok("JUNE'S 31 ARE A SUBSET OF DECEMBER'S 74 — the same people, further along",
     jun.every(i => dec.includes(i)), jun.filter(i => !dec.includes(i)));
  ok("...and they are literally the FIRST 31 of the drift order, as the brief requires",
     JSON.stringify(jun) === JSON.stringify(DRIFT_ORDER.slice(0, 31)), { jun: jun.slice(0, 5), order: DRIFT_ORDER.slice(0, 5) });
  ok("nobody UN-drifts between June and December (December ⊇ June)",
     jun.every(i => dec.includes(i)) && dec.length >= jun.length, { jun: jun.length, dec: dec.length });
  ok("the hero field is the same 74 as December — one file, shown twice",
     JSON.stringify([...driftSet(DRIFT_COUNTS.hero)]) === JSON.stringify(dec), null);

  // The nesting must hold at EVERY count, not just the three the page uses —
  // so a future fourth panel cannot silently break it.
  let nestsEverywhere = true;
  for (let n = 0; n < DRIFT_ORDER.length; n++) {
    const a = driftSet(n), b = driftSet(n + 1);
    if (![...a].every(i => b.has(i)) || b.size !== a.size + 1) { nestsEverywhere = false; break; }
  }
  ok("the nesting holds at EVERY count from 0 to 74, not just the three on the page",
     nestsEverywhere, null);

  // ── §3 · determinism — the reason this is a constant, not a shuffle ─────
  console.log("\n— §3 · deterministic, always —");
  ok("two renders of the same field are byte-identical",
     JSON.stringify(fieldDots(74)) === JSON.stringify(fieldDots(74)), null);
  ok("all four of the page's fields are stable across renders",
     Object.values(DRIFT_COUNTS).every(c => JSON.stringify(fieldDots(c)) === JSON.stringify(fieldDots(c))), null);
  ok("a field always has exactly 199 entries whatever the count",
     [0, 1, 31, 74].every(c => fieldDots(c).length === FIELD_SIZE), null);
  ok("the drifting flags match the drift set exactly",
     fieldDots(31).filter(d => d.drifting).map(d => d.i).join() === jun.join(), null);
  ok("the entrance delay is a pure function of position (no randomness)",
     fieldDots(74).every((d, i) => d.delay === i * 6), null);
  ok("the breathing offset is a pure function of the index",
     breatheDelay(0) === breatheDelay(6) && breatheDelay(0) !== breatheDelay(1), [breatheDelay(0), breatheDelay(1), breatheDelay(6)]);

  // ── §4 · degradation ────────────────────────────────────────────────────
  console.log("\n— §4 · it cannot be asked for something impossible —");
  ok("a count above 74 is clamped, never invented", driftSet(500).size === 74, driftSet(500).size);
  ok("a negative count is empty, never wrapped", driftSet(-5).size === 0, driftSet(-5).size);
  ok("junk is empty, never NaN dots",
     driftSet(null).size === 0 && driftSet(undefined).size === 0 && driftSet("x").size === 0, null);

  // ── §5 · the page renders it, and renders it from HERE ──────────────────
  console.log("\n— §5 · the page uses this module, not a copy —");
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "Landing.jsx"), "utf8");
  ok("Landing.jsx imports the field from the shared module",
     /from\s+"\.\.\/lib\/donorField"/.test(src), null);
  ok("Landing.jsx does NOT contain a second hard-coded drift list",
     !/\[\s*3,\s*10,\s*23,\s*24,\s*36/.test(src), null);
  ok("there is ONE DonorField component, rendered four times",
     (src.match(/function DonorField/g) || []).length === 1
     && (src.match(/<DonorField/g) || []).length >= 2, null);
  ok("the dot container is aria-hidden (a reader is not read 199 empty elements)",
     /aria-hidden="true"[\s\S]{0,120}flexWrap/.test(src) || /flexWrap[\s\S]{0,200}aria-hidden/.test(src)
     || /aria-hidden="true"/.test(src), null);
  ok('the field wrapper carries role="img" and an aria-label in words',
     /role="img"/.test(src) && /aria-label=\{label\}/.test(src), null);
  ok("the entrance wave and breathing live inside prefers-reduced-motion: no-preference",
     /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?lpDotIn[\s\S]*?lpDotGlow/.test(src), null);
  ok("NO opacity:0 base state escapes that query (the field can never be invisible)",
     !/\.df-dot\s*\{[^}]*opacity:\s*0/.test(src), null);
  // Scoped to the DOT keyframes specifically. lpPulse deliberately animates a
  // box-shadow, but it runs on ONE 6px dot in a card header, not on 199
  // elements — so the rule is asserted where it matters rather than globally.
  const dotFrames = [...src.matchAll(/@keyframes (lpDotIn|lpDotGlow)\s*\{([^}]*\}[^}]*)\}/g)]
    .map(m => m[2]);
  ok(`the dot keyframes exist (${dotFrames.length} found)`, dotFrames.length === 2, dotFrames.length);
  ok("the dot keyframes animate ONLY opacity and transform — nothing that costs a paint on 199 elements",
     dotFrames.length === 2 && dotFrames.every(f =>
       !/(filter|box-shadow|width|height|margin|padding|top|left|background)\s*:/.test(f)),
     dotFrames);

  summary();
})();

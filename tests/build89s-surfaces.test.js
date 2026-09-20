// BUILD-89S 89f — WHERE SHE SEES IT. Run: node tests/build89s-surfaces.test.js
//
// The build's whole claim is one sentence, and it is said on four surfaces:
// "Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a
// dollar." A promise said in four places is four places it can quietly stop
// being true, so this suite holds all four to the same words.
//
//   §1  THE VOICE. No em dashes, no "live", no "real time", no promise Steward
//       cannot keep, on the Settings page or the landing section.
//   §2  NEVER "LIVE". Steward polls every six hours and PayPal itself takes up
//       to three hours to publish. Every freshness word is banned by name, and
//       the screen says when it last LOOKED.
//   §3  THE SETTINGS PAGE says what the brief asked it to say, and its error
//       state is a sentence with what to do rather than a code.
//   §4  THE LANDING names only sources that are actually merged and green, and
//       says plainly that Steward never holds or moves money.
//   §5  THE LEGAL COPY carries the same line, and every provider is named with
//       what Steward reads from it.
//   §6  ONE SENTENCE, THREE SURFACES. The donor record, the recurring
//       dashboard and the Thread label are built by the SAME phrase builder,
//       so they cannot drift apart.

const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");

const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");

// The rendered strings of a JSX file: what a human would actually read. Comments
// are stripped first, because a comment is not a screen (CLAUDE.md's own
// recurring lesson) and this build's files explain their rules by name.
function renderedText(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  // Text between JSX tags, and the string literals a screen renders.
  for (const m of noComments.matchAll(/>([^<>{}]{4,})</g)) out.push(m[1]);
  for (const m of noComments.matchAll(/["'`]([^"'`\n]{12,})["'`]/g)) out.push(m[1]);
  return out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// The chunk of a file between two markers — so the guards read the section
// this build added, not the whole of a page somebody else wrote.
function chunk(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = endMarker ? src.indexOf(endMarker, a) : -1;
  if (a < 0) return "";
  return b > a ? src.slice(a, b) : src.slice(a);
}

(async () => {
  const settingsSrc = read("client/src/components/Settings.jsx");
  const landingSrc = read("client/src/pages/Landing.jsx");
  const gsSection = chunk(settingsSrc, "// ── BUILD-89S 89f — WHERE GIVING COMES IN", "const SETTINGS_TABS=[");
  const lpSection = chunk(landingSrc, 'id="keep-giving"', "</section>");
  const lib = await import("../shared/givingSources.js");

  ok("the Settings page exists to be guarded", gsSection.length > 500, gsSection.length);
  ok("the landing section exists to be guarded", lpSection.length > 400, lpSection.length);

  // ══ §1 · THE VOICE ═══════════════════════════════════════════════════════
  console.log("\n— §1 · her words, on both surfaces —");
  const gsText = renderedText(gsSection);
  const lpText = renderedText(lpSection);
  const allText = [...gsText, ...lpText];
  ok("there is text to read on both", allText.length > 8, allText.length);

  const emDashes = allText.filter(t => t.includes("—"));
  ok("no em dash reaches either screen (the standing voice rule)", emDashes.length === 0, emDashes);

  // The words this product does not use about money or work.
  const BANNED = [
    ["effortless", /\beffortless\b/i], ["seamless", /\bseamless\b/i],
    ["simply", /\bsimply\b/i], ["just click", /\bjust click\b/i],
    ["powerful", /\bpowerful\b/i], ["revolutionary", /\brevolutionar/i],
    ["best-in-class", /\bbest[- ]in[- ]class\b/i], ["unlock", /\bunlock\b/i],
  ];
  const usedBanned = BANNED.filter(([, re]) => allText.some(t => re.test(t))).map(([w]) => w);
  ok("no marketing filler on either surface", usedBanned.length === 0, usedBanned);

  // ══ §2 · NEVER "LIVE" ════════════════════════════════════════════════════
  console.log("\n— §2 · Steward checks; it is not live —");
  // The module names the words, so the ban and the code cannot disagree.
  ok("the shared module names the freshness words that are forbidden",
    Array.isArray(lib.FORBIDDEN_FRESHNESS_WORDS) && lib.FORBIDDEN_FRESHNESS_WORDS.includes("live")
    && lib.FORBIDDEN_FRESHNESS_WORDS.includes("real time"), lib.FORBIDDEN_FRESHNESS_WORDS);

  const freshnessHits = [];
  for (const word of lib.FORBIDDEN_FRESHNESS_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\\\s]")}\\b`, "i");
    for (const t of allText) if (re.test(t)) freshnessHits.push(`${word}: ${t}`);
  }
  ok('neither surface says "live", "real time" or "instantly"', freshnessHits.length === 0, freshnessHits);

  // And the screen says when it last LOOKED, which is the honest alternative.
  ok("the Settings row reports when Steward last checked, with a time on it",
    /checkedPhrase/.test(gsSection) && /not checked yet/.test(gsSection));
  ok("the phrase is built from the real timestamp, not a static word",
    /toLocaleTimeString/.test(gsSection) && /hour.*ago|minutes ago/.test(gsSection));

  // ══ §3 · THE SETTINGS PAGE ═══════════════════════════════════════════════
  console.log("\n— §3 · what the page has to say —");
  ok("it is called Where giving comes in", /Where giving comes in/.test(settingsSrc));
  ok("...and it is a section of Settings, reachable forever after",
    /\{id:"sources",label:"Where giving comes in"\}/.test(settingsSrc));
  ok("the page states the promise in her own screen, not only on the landing",
    gsText.some(t => /never holds or moves a dollar/i.test(t)), gsText.slice(0, 4));
  ok("every row can be checked now", /data-testid="gs-check-now"/.test(gsSection) && /Check now/.test(gsSection));
  ok("every row can be disconnected", /data-testid="gs-disconnect"/.test(gsSection));

  // DISCONNECT KEEPS EVERY GIFT, and the confirm says so rather than asking a
  // frightening question about deletion that is not what happens.
  ok("the disconnect confirm says the gifts stay",
    /stay on your records/.test(gsSection) && /Stop checking/.test(gsSection));
  ok("an error is shown as the server's own sentence, never a code",
    /data-testid="gs-row-error"/.test(gsSection) && /\{s\.lastError\}/.test(gsSection));
  ok("a fund nobody has chosen reads as a question, not as General",
    /a question for you/.test(gsSection));
  ok("the file-only providers are named as file-only rather than quietly missing",
    /data-testid="gs-file-note"/.test(gsSection) && /no way for Steward to read an account/.test(gsSection));
  ok("Test shows her own numbers before anything is stored",
    /data-testid="gs-test-result"/.test(gsSection) && /in the last seven days/.test(gsSection));
  ok("with no credential key on the server, connecting is off and SAYS so",
    /data-testid="gs-unavailable"/.test(gsSection) && /cannot store a provider key safely/.test(gsSection));
  // A secret must never be a text input that a browser offers to remember.
  ok("a secret field is a password field with autocomplete off",
    /type=\{f\.secret\?"password":"text"\}/.test(gsSection) && /autoComplete="off"/.test(gsSection));

  // ══ §4 · THE LANDING ═════════════════════════════════════════════════════
  console.log("\n— §4 · the landing says the same thing —");
  ok("the section is Keep how people give", /KEEP HOW PEOPLE GIVE/.test(lpSection));
  ok("it says plainly that Steward never holds or moves money",
    /never holds or moves your money/.test(lpSection));
  ok("it says the access is read-only and switchable off",
    /switch off at any time/.test(landingSrc));

  // ONLY NAME A SOURCE ONCE ITS PART IS MERGED AND GREEN. The registry is the
  // authority, so the page cannot name a provider the product does not have.
  const connectedOnPage = ["PayPal", "Zeffy", "Stripe", "Givebutter"];
  const fileOnPage = ["Cash App", "Venmo"];
  const connectedLine = (lpSection.match(/Connected:<\/strong>([^<]*)/) || [])[1] || "";
  const statementLine = (lpSection.match(/Statement upload:<\/strong>([^<]*)/) || [])[1] || "";
  ok("the connected four are named as connected",
    connectedOnPage.every(n => connectedLine.includes(n)), connectedLine);
  ok("Cash App and Venmo are named as statement upload, not as connected",
    fileOnPage.every(n => statementLine.includes(n) && !connectedLine.includes(n)), { connectedLine, statementLine });

  // THE PAGE CANNOT OUTRUN THE PRODUCT: every provider the page calls
  // connected must be mode "api" in the registry, and every one it calls a
  // statement upload must be mode "file".
  const byLabel = Object.fromEntries(Object.values(lib.PROVIDERS).map(p => [p.label, p]));
  const wrongMode = [
    ...connectedOnPage.filter(n => byLabel[n]?.mode !== "api"),
    ...fileOnPage.filter(n => byLabel[n]?.mode !== "file"),
  ];
  ok("and the registry agrees with the page about every one of them",
    wrongMode.length === 0, wrongMode);
  // Proven able to fail: a provider the page named that the registry does not
  // know at all would land in the same bucket.
  ok("a provider the product does not have would fail that check",
    ["Donorbox"].filter(n => byLabel[n]?.mode !== "api").length === 1);

  // ══ §5 · THE LEGAL COPY ══════════════════════════════════════════════════
  console.log("\n— §5 · the same line where it is a commitment —");
  const dataDoc = read("steward-data-handling.md");
  const dataFlatEarly = dataDoc.replace(/\s+/g, " ");
  ok("the data-handling document carries the same sentence",
    /never holds or moves your money/i.test(dataFlatEarly));
  // The document wraps its lines, so the sentence is checked as a sentence
  // rather than as a run of bytes that happens to avoid a line break.
  ok("it says the access is read-only and can be switched off",
    /read-only access you can switch off at any time/i.test(dataFlatEarly));
  for (const p of [...connectedOnPage, ...fileOnPage]) {
    ok(`${p} is named with what Steward reads from it`, dataDoc.includes(p), p);
  }
  ok("it says Steward CANNOT write to a provider, not merely that it does not",
    /cannot write to any of them/i.test(dataFlatEarly) && /Not "does not"/i.test(dataFlatEarly));
  ok("it says what happens to a stored key on disconnect",
    /destroys the stored key and keeps every gift/i.test(dataFlatEarly));
  ok("the landing's own data section carries the money line too",
    /data-testid="lp-data-money"/.test(landingSrc));

  // ══ §6 · ONE SENTENCE, THREE SURFACES ════════════════════════════════════
  console.log("\n— §6 · the record, the dashboard and the Thread cannot disagree —");
  const provider = { confidence: lib.CONFIDENCE.PROVIDER, amountCents: 5000, interval: "month" };
  const inferred = { confidence: lib.CONFIDENCE.INFERRED, amountCents: 5000, interval: "month" };
  ok("a provider-named commitment is stated as a fact",
    lib.recurringPhrase(provider, { provider: "paypal" }) === "Gives $50 monthly through PayPal");
  ok("an inferred one is stated as a reading",
    lib.recurringPhrase(inferred, { provider: "paypal" }) === "Looks like $50 monthly through PayPal");
  ok("the two are never the same sentence",
    lib.recurringPhrase(provider, { provider: "paypal" }) !== lib.recurringPhrase(inferred, { provider: "paypal" }));

  const serverSrc = read("server.js");
  ok("the donor record builds its line from that ONE builder, not its own string",
    /recurringPhrase\(\{ amountCents: Number\(r\.amount_cents\)/.test(serverSrc)
    && /source_recurring/.test(serverSrc));
  ok("the recurring dashboard builds its line from the same builder",
    (serverSrc.match(/recurringPhrase\(/g) || []).length >= 2,
    (serverSrc.match(/recurringPhrase\(/g) || []).length);
  ok("the Thread label is built by missedPhrase, beside it in the same module",
    /missedPhrase\(/.test(serverSrc) && typeof lib.missedPhrase === "function");
  ok("and the client renders the server's sentence rather than composing its own",
    /donor\.sourceRecurring\.phrase/.test(read("client/src/components/Donors.jsx")));
  ok("the adapted donor actually carries it (the BUILD-89 adaptDonor trap)",
    /sourceRecurring: d\.source_recurring/.test(read("client/src/api.js")));

  // NO NUMBER WITHOUT A DEFINITION, on the dashboard this build extended.
  const dash = await import("../shared/dashboards.js");
  const recurringDash = (dash.DASHBOARDS || dash.default || []).find(d => d.key === "recurring");
  const sourceMetrics = (recurringDash?.metrics || []).filter(m => m.key.startsWith("sourceRecurring"));
  ok("the recurring dashboard gained the provider-neutral figures", sourceMetrics.length === 2, sourceMetrics.map(m => m.key));
  ok("each carries its own definition", sourceMetrics.every(m => (m.definition || "").length > 30), sourceMetrics);
  ok('and the definition explains what "looks monthly" means, in the numbers it actually uses',
    sourceMetrics.some(m => /27 to 34 days/.test(m.definition) && /nobody has confirmed it/.test(m.definition)),
    sourceMetrics.map(m => m.definition));

  summary();
})();

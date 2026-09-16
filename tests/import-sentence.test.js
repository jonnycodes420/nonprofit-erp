// BUILD-87 Part 2 — THE MOMENT AFTER IMPORT. Run: node tests/import-sentence.test.js
//
// The sentence is asserted on the FAMILY of decision types, never on one
// string. What would have to break for this to fail:
//
//   §1  EVERY DECISION FAMILY REACHES THE SENTENCE. Each of the four kinds
//       (exclusion flag · gift type · date convention · duplicates review) is
//       driven alone and must contribute its own clause with its own number.
//       Drop a family from the builder and its row here goes red.
//   §2  NEVER A TEMPLATE WITH HOLES. A family with nothing in it contributes
//       NOTHING — no "0 rows", no dangling "and". Asserted over every subset
//       of the four families, so a hole cannot hide in a combination.
//   §3  THE PLAINEST TRUE THING. No decisions at all → the totals sentence,
//       and it claims "all of it accounted for" ONLY when the equation
//       actually balances.
//   §4  HER WORDS. With a vocabulary the sentence says her noun and says
//       "donor" nowhere; with none it is byte-identical to today's strings.
//   §5  THE ADAPTER READS THE SUBMISSION, not the data — a real
//       buildWorkbookSubmission-shaped object yields the right decision list,
//       and an absent choice yields no decision.
//   §6  VOICE. No emoji, no em dash, no exclamation mark, no congratulation,
//       and the money is formatted from INTEGER CENTS.
//
// Pure module: no server, no browser, no clock.

const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");
const root = path.join(__dirname, "..");

// One decision per family, each with an unmistakable number so a clause that
// goes missing cannot be mistaken for another one.
const FAMILY = {
  exclusion:       { kind: "exclusion", label: "deceased", rows: 41 },
  gift_type:       { kind: "gift_type", label: "trip support", gifts: 243 },
  date_convention: { kind: "date_convention", convention: "dd/mm", rows: 1207 },
  duplicates:      { kind: "duplicates", merged: 269 },
};
const MARK = { exclusion: "41", gift_type: "243", date_convention: "1,207", duplicates: "269" };
const KINDS = Object.keys(FAMILY);

const TOTALS = { donors: 4112, gifts: 90523, cents: 101010639 };

(async () => {
  const S = await import("../shared/importSentence.js");
  const V = await import("../shared/vocabulary.js");

  // ── §1 · every family reaches the sentence, alone ────────────────────────
  console.log("\n— §1 · each decision family contributes its own clause —");
  for (const k of KINDS) {
    const line = S.importLeadSentence({ decisions: [FAMILY[k]], totals: TOTALS });
    ok(`the ${k} decision reaches the sentence with its own number`,
       line.includes(MARK[k]) && line.length > 0, line);
    ok(`…and the ${k} clause ends in a full stop, not a fragment`, /\.$/.test(line.trim()), line);
  }
  // A set-aside family says so; a reading family must NOT claim a set-aside.
  ok("an exclusion says it is set aside as you asked",
     /set aside as you asked/.test(S.importLeadSentence({ decisions: [FAMILY.exclusion] })));
  ok("a gift type routed off cash says the same",
     /set aside as you asked/.test(S.importLeadSentence({ decisions: [FAMILY.gift_type] })));
  ok("A FOLD IS NOT A SET-ASIDE — the duplicates clause never says 'set aside'",
     !/set aside/.test(S.importLeadSentence({ decisions: [FAMILY.duplicates] })),
     S.importLeadSentence({ decisions: [FAMILY.duplicates] }));
  ok("…nor does the date convention", !/set aside/.test(S.importLeadSentence({ decisions: [FAMILY.date_convention] })));

  // The brief's own example, assembled from its own two decisions.
  const brief = S.importLeadSentence({ decisions: [
    { kind: "gift_type", label: "trip support", gifts: 240 },
    { kind: "exclusion", label: "deceased", rows: 40 }] });
  ok("the brief's example assembles from the brief's decisions",
     brief === "Your file marks 240 gifts as trip support and 40 rows as deceased. Both are set aside as you asked.", brief);
  ok("'Both' is only used for exactly two — one says 'That is'",
     /^That is set aside/.test(S.importLeadSentence({ decisions: [FAMILY.exclusion] }).split(". ")[1] + ""),
     S.importLeadSentence({ decisions: [FAMILY.exclusion] }));
  ok("…and three says 'All three'",
     /All three are set aside/.test(S.importLeadSentence({ decisions: [
       FAMILY.exclusion, FAMILY.gift_type, { kind: "gift_type", label: "in-kind gifts", gifts: 7 }] })));

  // ── §2 · never a template with holes, over every subset ──────────────────
  console.log("\n— §2 · a family with nothing in it contributes nothing —");
  let holes = [];
  for (let mask = 0; mask < 16; mask++) {
    const picked = KINDS.filter((_, i) => mask & (1 << i));
    const line = S.importLeadSentence({ decisions: picked.map(k => FAMILY[k]), totals: TOTALS });
    // Every picked family's number is present; every unpicked family's is absent.
    for (const k of KINDS) {
      const want = picked.includes(k);
      if (line.includes(MARK[k]) !== want) holes.push(`${mask}:${k}`);
    }
    if (/\b0 (rows|gifts|duplicate)/.test(line)) holes.push(`${mask}:zero-clause`);
    if (/ and \.|,\s*\.|\s{2,}|and and/.test(line)) holes.push(`${mask}:dangling`);
    if (!/\.$/.test(line.trim())) holes.push(`${mask}:unterminated`);
  }
  ok("all 16 subsets of the four families render with no holes and no dangling joins",
     holes.length === 0, holes.slice(0, 8));

  // A decision that carries a zero is the same as no decision at all.
  ok("a family whose count is ZERO is not mentioned",
     S.importLeadSentence({ decisions: [{ kind: "exclusion", label: "deceased", rows: 0 }], totals: TOTALS })
       === S.importLeadSentence({ decisions: [], totals: TOTALS }));
  ok("…and a decision with no label is not mentioned either",
     !/undefined|null/.test(S.importLeadSentence({ decisions: [{ kind: "exclusion", rows: 5 }], totals: TOTALS })));
  ok("an unknown decision kind contributes nothing rather than guessing a phrasing",
     S.importLeadSentence({ decisions: [{ kind: "haruspicy", label: "entrails", rows: 3 }], totals: TOTALS })
       === S.importLeadSentence({ decisions: [], totals: TOTALS }));

  // ── §3 · the plainest true thing ─────────────────────────────────────────
  console.log("\n— §3 · no decisions → the plainest true thing —");
  const plain = S.importLeadSentence({ decisions: [], totals: TOTALS });
  ok("no decisions gives the brief's plain sentence",
     plain === "4,112 donors and 90,523 gifts, $1,010,106.39, all of it accounted for.", plain);
  ok("the money is exact to the cent, formatted from integer cents",
     S.formatCents(101010639) === "$1,010,106.39" && S.formatCents(1) === "$0.01" && S.formatCents(0) === "$0.00");
  ok("…and a hundredth of a cent cannot appear — cents are integers",
     S.formatCents(33.9) === "$0.33", S.formatCents(33.9));
  const unbalanced = S.importLeadSentence({ decisions: [], totals: { ...TOTALS, unaccountedCents: 1 } });
  ok("NEVER CLAIM A BALANCE YOU CANNOT BACK — one cent short drops the claim",
     !/all of it accounted for/.test(unbalanced) && /\$0\.01 is not yet accounted for/.test(unbalanced), unbalanced);
  ok("…and a balanced run still makes it", /all of it accounted for/.test(plain));
  ok("one gift reads 'gift', not 'gifts'",
     /1 gift,/.test(S.importLeadSentence({ decisions: [], totals: { donors: 1, gifts: 1, cents: 100 } })));

  // ── §4 · her words ───────────────────────────────────────────────────────
  console.log("\n— §4 · the sentence is in the org's own vocabulary —");
  const t = V.makeT({ giver_singular: "sponsor", giver_plural: "sponsors" });
  const her = S.importLeadSentence({ decisions: [], totals: TOTALS }, t);
  ok("the plain sentence speaks her noun", /4,112 sponsors/.test(her), her);
  ok("…and says 'donor' NOWHERE", !/donor/i.test(her), her);
  const herFold = S.importLeadSentence({ decisions: [FAMILY.duplicates] }, t);
  ok("the fold clause speaks her noun too", /folded into the sponsors you kept/.test(herFold), herFold);
  ok("…and an org that answered nothing is byte-identical to today's strings",
     S.importLeadSentence({ decisions: [], totals: TOTALS }, V.makeT(null)) === plain);

  // ── §5 · the adapter reads the SUBMISSION, not the data ──────────────────
  console.log("\n— §5 · the decisions come from the submission —");
  const submission = {
    exclusionSummary: { deceased: 41, doNotContact: 3, doNotMail: 0, fromHidden: 2, total: 44 },
    routed: { pledges: new Array(243).fill(0), softCredits: [], inKind: new Array(7).fill(0), refunds: [], reversals: [] },
    conventions: [{ sheet: "Gifts", convention: "dmy", dayFirstEvidence: 12, monthFirstEvidence: 0, slashCells: 1207 }],
    merges: new Array(269).fill(0),
  };
  const d = S.decisionsFromSubmission(submission, { semantics: { counts: { merges: 269 } } });
  const kinds = d.map(x => x.kind);
  ok("all four families are found in a real submission",
     KINDS.every(k => kinds.includes(k)), kinds);
  ok("a zero-count exclusion flag yields no decision",
     !d.some(x => x.kind === "exclusion" && x.label === "do not mail"), d.filter(x => x.kind === "exclusion"));
  ok("…and the flags that ARE set are named in words, not camelCase keys",
     d.some(x => x.label === "deceased") && d.some(x => x.label === "do not contact")
       && !d.some(x => /[A-Z]/.test(String(x.label))), d.map(x => x.label));
  ok("routed gift types are counted by their own arrays",
     d.find(x => x.kind === "gift_type" && x.label === "pledge commitments").gifts === 243
       && d.find(x => x.kind === "gift_type" && x.label === "in-kind gifts").gifts === 7);
  ok("the date convention carries the file's own slash-cell count",
     d.find(x => x.kind === "date_convention").rows === 1207);
  ok("the fold count comes from what the WRITE stored, not what was proposed",
     S.decisionsFromSubmission(submission, { semantics: { counts: { merges: 5 } } })
       .find(x => x.kind === "duplicates").merged === 5);
  // An absent choice is not a decision.
  const noChoice = S.decisionsFromSubmission({
    exclusionSummary: { deceased: 0, doNotContact: 0 },
    routed: { pledges: [], softCredits: [], inKind: [], refunds: [], reversals: [] },
    conventions: [{ sheet: "Gifts", convention: "default-mdy", dayFirstEvidence: 0, monthFirstEvidence: 0, slashCells: 0 }],
    merges: [],
  }, {});
  ok("a file that needed no judgement yields NO decisions", noChoice.length === 0, noChoice);
  ok("…so its receipt leads with the plainest true thing",
     S.importLeadSentence({ decisions: noChoice, totals: TOTALS }) === plain);
  ok("'default-mdy' is an absence of evidence, never claimed as a choice",
     !noChoice.some(x => x.kind === "date_convention"));
  ok("the adapter survives an empty submission rather than throwing",
     S.decisionsFromSubmission(null, null).length === 0);

  // ── §6 · voice, and where the sentence is used ───────────────────────────
  console.log("\n— §6 · voice, and the receipt that renders it —");
  const everything = S.importLeadSentence({ decisions: KINDS.map(k => FAMILY[k]), totals: TOTALS }, t);
  ok("no em dash", !/—/.test(everything), everything);
  ok("no exclamation mark — Steward reports, it does not congratulate", !/!/.test(everything));
  ok("no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(everything));
  ok("no congratulation vocabulary",
     !/congratulat|well done|great job|amazing|success!/i.test(everything), everything);

  const src = fs.readFileSync(path.join(root, "client/src/components/WorkbookImport.jsx"), "utf8");
  const head = src.slice(src.indexOf('data-testid="wb-result"'));
  const at = s2 => head.indexOf(s2);
  ok("the receipt renders the sentence", at('data-testid="wb-lead-sentence"') > 0);
  ok("THE SENTENCE COMES BEFORE THE THREE NUMBERS",
     at('data-testid="wb-lead-sentence"') < at('data-testid="wb-headline-numbers"'));
  ok("…and the three numbers come before the balance line",
     at('data-testid="wb-headline-numbers"') < at('data-testid="wb-result-balance"'));
  ok("…and the balance line comes before the set-aside table",
     at('data-testid="wb-result-balance"') < at('data-testid="wb-result-refusals"'));
  ok("the three numbers are donors, gifts, dollars",
     at('data-testid="wb-head-donors"') > 0 && at('data-testid="wb-head-gifts"') > 0 && at('data-testid="wb-head-dollars"') > 0);
  ok("ONE primary action, and it opens Home", /"Open Home"/.test(head), head.slice(-400));
  // A COMMENT IS NOT A SCREEN (BUILD-86 C.1's lesson, paid for three times).
  // This file's own note says "no confetti"; a guard that cannot tell a note
  // from a render is a guard that forbids writing down why.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
                  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  ok("no confetti and no new animation on the receipt",
     !/confetti|@keyframes|animation:/i.test(code), (code.match(/confetti|@keyframes|animation:/i) || [])[0]);
  ok("the receipt reads the sentence from the shared module, not from copy in the component",
     /importLeadSentence/.test(src) && /shared\/importSentence/.test(src));
  ok("the stored summary carries the same sentence, so the run reopens saying it",
     /leadSentence: leadSentenceFor\(/.test(src));

  summary();
})().catch(e => { console.error(e); process.exit(1); });

// FIX-3 finding 11 — THE SUNRISE SUGGESTION.
//
// The walk (27 September): the profile's Suggested panel on Sunrise read
// "When to make it is now… What to say is… What it is for is…", and it spoke
// of "underserved NYC youth" and "the cycle deadline approaching". The prompt
// asked the model for "the move to make, when to make it, what to say, and
// what it is for", and the model echoed the labels back as sentences. And the
// FIX-1 validator only checked NAMES (capitalised words — "NYC" is all caps,
// so it was never even looked at), NUMBERS and capacity language: a claim
// about who the gift serves or a deadline the world set passed untouched.
//
//   §1 the validator: a claim about who is served, where, or a deadline must
//      be on the record, or the line is refused and counted — and the same
//      words ARE allowed when the record carries them (not a blanket ban).
//   §2 the template: a structured suggestion (when / what to say / what it is
//      for) comes out as three short plain sentences, with every off-record
//      claim refused and none of the "X is Y" scaffolding.
//   §3 the source: the profile builds its suggestion through that template.
//
// Pure: no stack, no model. The model's reply is a recorded fixture.

const path = require("path");
const root = path.join(__dirname, "..");
const { readSource } = require("../scripts/lib/readSource");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};
const SCAFFOLD = /\b(the move to make|when to make it|what to say|what it is for)\b/i;

// Sunrise, as a fixture: nothing on it about NYC, youth or any deadline.
const record = {
  donor: { id: "d_fx3d_sun", name: "Sunrise Foundation", total_giving: 25000, gift_count: 1,
           last_gift_amount: 25000, last_gift_date: "2026-03-02" },
  orgName: "Harbor Arts Weekly art classes for the neighbourhood.",
  names: ["Steward", "foundation"],
  rows: [
    { id: "g1", amount: 25000, date: "2026-03-02", fund: "Arts Program" },
    { id: "i1", date: "2026-05-10", type: "meeting", label: "Met at the spring open studio" },
  ],
};

(async () => {
  console.log("fix3-d-suggestion");
  const G = await import("../shared/suggestionGuard.js");
  const N = await import("../shared/nextMove.js").catch(e => ({ __missing: String(e.message || e) }));

  console.log("\n— §1 · every claim goes through the validator —");
  const nyc = G.guardSuggestion("Mention the work with underserved NYC youth.", record);
  ok("§1 \"underserved NYC youth\" is refused when the record says nothing about NYC or youth",
     nyc.kept.length === 0 && nyc.dropped === 1, nyc);
  const dl = G.guardSuggestion("Call them now, with the cycle deadline approaching.", record);
  ok("§1 \"the cycle deadline approaching\" is refused when the record has no deadline", dl.kept.length === 0 && dl.dropped === 1, dl);
  ok("§1 …and the reason names the claim", /deadline|cycle/.test(dl.reasons[0] || "") && /NYC|youth|underserved/i.test(nyc.reasons[0] || ""), [dl.reasons, nyc.reasons]);
  const onRecord = { ...record, orgName: "CREO Arts Transformative arts education for underserved NYC youth",
    rows: [...record.rows, { id: "gr1", date: "2026-10-15", type: "deadline", label: "Grant cycle deadline" }] };
  const nyc2 = G.guardSuggestion("Mention the work with underserved NYC youth.", onRecord);
  const dl2 = G.guardSuggestion("Call them now, with the cycle deadline approaching.", onRecord);
  ok("§1 the same words are kept when the record carries them (a check, not a blanket ban)",
     nyc2.kept.length === 1 && dl2.kept.length === 1, [nyc2, dl2]);
  // Sunrise as it really is on the fixture org: its note says the next grant
  // cycle opens in September. That is on the record; a deadline is not.
  const withNote = { ...record, donor: { ...record.donor, notes: "Next grant cycle opens September." } };
  const cy = G.guardSuggestion("Call them before the grant cycle opens in September. The cycle deadline is approaching.", withNote);
  ok("§1 her note grounds \"the grant cycle opens in September\"; \"the cycle deadline\" is still refused",
     cy.kept.length === 1 && /opens in September/.test(cy.kept[0].text) && cy.dropped === 1, cy);
  const plain = G.guardSuggestion("Thank them for the $25,000 gift to the Arts Program.", record);
  ok("§1 a true line still survives", plain.kept.length === 1 && plain.dropped === 0, plain);

  console.log("\n— §2 · three plain sentences —");
  ok("§2 shared/nextMove.js exports composeNextMove", typeof N.composeNextMove === "function", N.__missing);
  if (typeof N.composeNextMove === "function") {
    // The recorded model reply: structured, but the model has echoed the
    // prompt's labels into its values and slipped in two claims of its own.
    const reply = JSON.stringify({
      when: "When to make it is now, before the spring open studio. The cycle deadline is approaching.",
      say: "What to say is thank them for the $25,000 gift in March.",
      for: "What it is for is the arts program. It serves underserved NYC youth.",
    });
    const out = N.composeNextMove(reply, record);
    const text = out.sentences.join(" ");
    ok("§2 both off-record claims are refused", !/deadline|NYC|youth|underserved/i.test(text) && out.dropped === 2, out);
    // HOTFIX-1 — counted for the LOG, never for the panel.
    ok("§2 …and counted for the log, with nothing about it on the screen",
       /^\[suggestion\] 2 lines left out: /.test(out.log) && !/left out/.test(out.text), [out.log, out.text]);
    ok("§2 the output is three sentences", out.sentences.length === 3, out.sentences);
    ok("§2 …one each: when, what to say, what it is for",
       /^Reach out now\b/.test(out.sentences[0] || "") && /^Thank them\b/.test(out.sentences[1] || "") && /^It is for the arts program\.$/.test(out.sentences[2] || ""), out.sentences);
    ok("§2 none of the scaffolding phrases survive", !SCAFFOLD.test(out.text), out.text);
    ok("§2 no sentence is a field label (\"X is Y\")", !out.sentences.some(s => /^(When|What|The move)\b[^.]*\bis\b/i.test(s)), out.sentences);
    ok("§2 each is a plain sentence: a capital, an end stop, no markdown",
       out.sentences.every(s => /^[A-Z$]/.test(s) && /[.!?]$/.test(s) && !/\*|#|_/.test(s)), out.sentences);

    // What the walk actually saw: prose, labels and all.
    const prose = "When to make it is now, with the cycle deadline approaching. What to say is that their support kept the doors open. What it is for is underserved NYC youth.";
    const p = N.composeNextMove(prose, record);
    ok("§2 the walk's prose: the two claims are refused", p.dropped === 2 && !/deadline|NYC|youth/i.test(p.sentences.join(" ")), p);
    ok("§2 …and what is left reads as a plain sentence", p.sentences.length === 1 && /^Say that their support kept the doors open\.$/.test(p.sentences[0]), p.sentences);
    ok("§2 …with no scaffolding", !SCAFFOLD.test(p.text), p.text);

    // HOTFIX-1 — nothing left, and nothing open: the panel shows NOTHING.
    const none = N.composeNextMove("", record);
    ok("§2 an empty reply with nothing open shows nothing at all",
       none.sentences.length === 0 && none.text === "", none);
  }

  console.log("\n— §3 · the profile builds its suggestion through the template —");
  const donors = readSource("client/src/components/Donors.jsx");
  const getAI = (donors.match(/const getAI=async\(donor,type[^)]*\)=>\{[\s\S]*?\n  \};/) || [""])[0];
  ok("§3 the next-move suggestion goes through composeNextMove", /composeNextMove\(/.test(getAI) && /nextMove\.js/.test(donors), getAI.slice(-600));
  const prompt = (getAI.match(/nextmove:`[\s\S]*?`,/) || [""])[0];
  ok("§3 the prompt no longer hands the model the field labels to echo", prompt && !/when to make it|what it is for/i.test(prompt), prompt.slice(-300));
  ok("§3 the prompt asks for the three fields", /"when"/.test(prompt) && /"say"/.test(prompt) && /"for"/.test(prompt), prompt.slice(-300));

  done();
})().catch(e => { console.error(e); process.exit(1); });

function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

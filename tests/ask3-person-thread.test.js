// tests/ask3-person-thread.test.js — ASK-3 test 1. A NAME IS READ AGAINST THE THREAD.
//
//     After the Lantern Appeal answer, "what can I do to get Flavia to give
//     more" is about Flavia Testwater (named in that answer) and nobody else,
//     and every number in the answer opens her rows and foots to them.
//
// The fixture (tests/fixtures/ask3-fixture.js) has a SECOND Flavia, in no
// appeal. So:
//   §1 the appeal answer names Flavia Testwater.
//   §2 the follow-up, sent with the thread, answers about her only: the
//      template sentence is exactly where she stands, worked out by hand.
//   §3 every reason's figure opens rows that are all hers and foot to it.
//   §4 the same words with no thread ask which Flavia, and answer nothing.
//      This is the leg that proves §2 came from the thread.
//
// HOW IT WOULD GO RED: resolve the name against the org before the thread
// (§2 becomes a "which one" question), or route "give more" to Room to give
// for everyone (§2 answers about other people). Proven able to fail: ignoring
// `context` in resolvePerson turned §2 red with kind "choose".
//
// AI is off for the fixture org, so the sentence is the template. Standard
// scratch stack (tests/README.md).
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const fixture = require("./fixtures/ask3-fixture");

const ORG = "org_ask3person";
const cents = v => Math.round(Number(v || 0) * 100);

(async () => {
  const F = await fixture(q, ORG, { ai: false });
  try {
    const login = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: F.email, password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const post = async (u, b) => (await fetch(BASE + u, { method: "POST", headers: H, body: JSON.stringify(b) })).json();
    const get = async u => (await fetch(BASE + u, { headers: H })).json();

    // §1
    const appeal = await post("/why/ask", { key: "appeal", campaign: F.now });
    const named = (appeal.who || []).map(w => w.donorId);
    ok("§1 the appeal answer names Flavia Testwater", appeal.answered && named.includes(F.flavia) && !named.includes(F.other), { named, sentence: appeal.sentence });

    // §2 — the rail sends the people the last answer named, and its appeal.
    const context = { people: (appeal.who || []).map(w => ({ id: w.donorId, name: w.name })), lastPerson: null, campaign: F.now };
    const a = await post("/ask", { text: "what can I do to get Flavia to give more", context });
    ok("§2 the follow-up is about Flavia Testwater", a.answered === true && a.donor && a.donor.id === F.flavia && a.question.key === "person", { kind: a.kind, donor: a.donor, sentence: a.sentence });
    ok("§2 it is about her only", (a.who || []).length === 1 && a.who[0].donorId === F.flavia, a.who);
    ok("§2 the sentence says where she stands",
      String(a.sentence).startsWith(`Flavia Testwater gave $1,000 to ${F.campaignLast} and nothing yet to ${F.campaignNow}.`) && !/Otherway/.test(a.sentence), a.sentence);

    // §3
    let footed = 0;
    for (const r of a.reasons || []) {
      const p = new URLSearchParams({ ...r.source.params, page: "1", pageSize: "200" });
      const b = await get(`/figures/${r.source.key}/rows?${p}`);
      const rows = b.rows || [];
      const value = r.measure === "count" ? rows.length : rows.reduce((s, x) => s + cents(x.amount), 0);
      const want = r.measure === "count" ? r.count : r.cents;
      const hers = rows.length > 0 && rows.every(x => x.donorId === F.flavia);
      if (hers && value === want) footed++;
      else ok(`§3 reason "${r.label}" opens her rows and foots`, false, { want, value, rows: rows.map(x => [x.donorId, x.amount]) });
    }
    ok(`§3 every reason (${(a.reasons || []).length}) opens only her rows, to the cent`, (a.reasons || []).length >= 2 && footed === a.reasons.length, { footed });
    ok("§3 the campaign reason is her $1,000", (a.reasons || []).some(r => r.key === "campaign" && r.cents === 100000), a.reasons);

    // §4
    const cold = await post("/ask", { text: "what can I do to get Flavia to give more" });
    const ids = (cold.candidates || []).map(c => c.donorId).sort();
    ok("§4 with no thread, Steward asks which Flavia and answers nothing", cold.answered === false && cold.kind === "choose"
      && ids.length === 2 && ids.includes(F.flavia) && ids.includes(F.other) && !cold.reasons, { kind: cold.kind, ids });
  } finally {
    await closeDb();
  }
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

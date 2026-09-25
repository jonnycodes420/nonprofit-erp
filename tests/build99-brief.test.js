// BUILD-99 (major gifts) Part 4 — THE PROSPECT BRIEF.
//
// ── WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT ─────────────
// The brief's guarantee is NOT "the prompt asks the model nicely". It is three
// things, and all three are provable with no API key in the room:
//
//   §1  THE SCHEMA HAS NO PLACE TO PUT A NUMBER. Walked structurally: no numeric
//       field anywhere, and no key named anything capacity-shaped. A model that
//       wanted to assert "$50,000 capacity" has nowhere to say it.
//   §2  THE VALIDATOR DROPS WHAT IT CANNOT TRACE — a sentence citing a row on
//       somebody else's file, a sentence citing nothing, capacity language with
//       no digit in it, and a numeric RULE the constants module does not hold.
//       Each defect is driven through as hand-authored model output.
//   §3  THE ROWS ARE STEWARD'S OWN CODE and are checked directly: the reference
//       set is exactly this person's rows, a pledge is labelled a promise, a soft
//       credit is labelled recognition, and the org's vocabulary is in there.
//   §4  the PDF renders on the org's letterhead, on one page;
//   §5  with no key configured the route says the control is UNAVAILABLE — never
//       a 500 and never an invented brief;
//   §6  org A can read none of org B's briefs or rows.
//
// WHETHER A REAL MODEL WRITES A GOOD BRIEF IS NOT DRILLED HERE, ON PURPOSE. That
// needs a real key, a real person's file and a human reading the page — and a mock
// answering for it is the BUILD-57 mistake exactly (three builds proven against a
// mock that lied in seven load-bearing ways). `scripts/build99-brief-drill.js` is
// that drill; until it runs, the REFUSALS are proven and the writing is not.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const zlib = require("zlib");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

// pdfkit Flate-compresses its streams and writes text as hex inside TJ arrays,
// so a raw-byte search finds nothing and an assertion built on one is vacuous.
// Same extractor tests/dashboards.test.js and tests/legal-entity.test.js use —
// copied rather than shared because a test helper that three suites import is a
// shared dependency between suites, and these three are deliberately independent.
function pdfText(buf) {
  const chunks = []; let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i); if (s < 0) break;
    let p = s + 6; if (buf[p] === 13) p++; if (buf[p] === 10) p++;
    const e = buf.indexOf("endstream", p); if (e < 0) break;
    try { chunks.push(zlib.inflateSync(buf.slice(p, e)).toString("latin1")); } catch {}
    i = e + 9;
  }
  const all = chunks.join("\n"); const out = [];
  for (const m of all.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let t = "";
    for (const h of m[1].matchAll(/<([0-9A-Fa-f]*)>/g)) t += Buffer.from(h[1], "hex").toString("latin1");
    if (t.trim()) out.push(t);
  }
  for (const m of all.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    const t = m[1].replace(/\\([()\\])/g, "$1"); if (t.trim()) out.push(t);
  }
  return out.join("\n");
}

const ORG = "b99_br", OTHER = "b99_br2";
const ME = "b99br@example.org", THEM = "b99br-other@example.org";
const PW = "loadtest1234";

const CHILD = ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions",
  "cultivation_plan_steps", "cultivation_plans", "cultivation_templates",
  "gift_soft_credits", "pledge_installments", "fin_transactions", "interactions", "threads",
  "tasks", "opportunities", "moves", "gifts", "pledges", "donors", "households", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, extra = {}) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,
                     legal_name,receipt_address,brand_accent,vocabulary_json)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW(),$3,$4,$5,$6)
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active',
     legal_name=EXCLUDED.legal_name, receipt_address=EXCLUDED.receipt_address,
     brand_accent=EXCLUDED.brand_accent, vocabulary_json=EXCLUDED.vocabulary_json`,
  [id, id.replace(/_/g, "-"), extra.legal || "Barn Buddies Incorporated",
   extra.addr || "1 Main St, Lexington, KY 40507", extra.accent || "#0d5c3a",
   JSON.stringify(extra.vocab || { giver_singular: "sponsor", giver_plural: "sponsors" })]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);

(async () => {
  console.log("build99-brief");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER, { legal: "Somebody Else Inc" });
  await mkUser("u_b99br", ORG, ME, "Allie Barnett");
  await mkUser("u_b99br2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO households (id,org_id,name) VALUES ('hh_br',$1,'The Ruiz household')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ('f_br',$1,'Capital campaign')`, [ORG]);
  await q(
    `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count,first_gift_date,last_gift_date,
                         notes,household_id,assigned_to,assigned_to_name)
     VALUES ('db_marg',$1,'Margaret Ruiz','m@x.org','person','cultivate',12500,5,'2019-03-04','2026-04-12',
             'Rides on Tuesdays. Her late husband built the first arena.','hh_br','u_b99br','Allie Barnett')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,kind,household_id) VALUES ('db_hal',$1,'Hal Ruiz','h@x.org','person','hh_br')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,kind) VALUES ('db_daf',$1,'Schwab Charitable','s@x.org','organisation')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,kind) VALUES ('db_other',$1,'Not Yours','n@x.org','person')`, [OTHER]);
  const tok = await login(ME), tok2 = await login(THEM);

  const B = await import("../shared/briefShape.js");
  const TH = await import("../shared/thresholds.js");

  // ── §1 · THE SCHEMA HAS NO PLACE TO PUT A NUMBER ────────────────────────
  console.log("\n— §1 · the guarantee is the schema, not the prompt —");
  const numeric = B.schemaNumericFields();
  ok("§1 THERE IS NO NUMERIC FIELD ANYWHERE IN THE BRIEF SCHEMA", numeric.length === 0, numeric);
  const forbidden = B.schemaForbiddenKeys();
  ok("§1 …and no key named anything capacity-shaped", forbidden.length === 0, forbidden);
  ok("§1 strict tool use: nothing may be added", B.BRIEF_SCHEMA.additionalProperties === false
     && B.BRIEF_SCHEMA.properties.sections.items.additionalProperties === false
     && B.BRIEF_SCHEMA.properties.sections.items.properties.sentences.items.additionalProperties === false);
  ok("§1 every sentence MUST carry at least one citation — the schema requires it",
     B.BRIEF_SCHEMA.properties.sections.items.properties.sentences.items.required.includes("cites")
     && B.BRIEF_SCHEMA.properties.sections.items.properties.sentences.items.properties.cites.minItems === 1);
  ok("§1 the sections are a closed set", Array.isArray(B.BRIEF_SCHEMA.properties.sections.items.properties.key.enum)
     && B.BRIEF_SCHEMA.properties.sections.items.properties.key.enum.length === B.SECTION_KEYS.length);
  // PROVEN ABLE TO FAIL: the structural walkers must see a planted defect.
  ok("§1 the numeric-field walker bites on a planted number field",
     B.schemaNumericFields({ type: "object", properties: { capacityCents: { type: "integer" } } }).length === 1);
  ok("§1 the forbidden-key walker bites on a planted capacity key",
     B.schemaForbiddenKeys({ type: "object", properties: { capacity: { type: "string" } } }).length === 1);

  // ── §2 · THE VALIDATOR DROPS WHAT IT CANNOT TRACE ───────────────────────
  console.log("\n— §2 · every sentence cites a row, or it does not print —");
  const rows = ["person:db_marg", "gift:g1", "gift:g2", "pledge:p1", "conversation:i1", "proposal:o1", "note:db_marg"];
  const ungrounded = (t, o) => TH.ungroundedClaims(t, o);
  const grounded = [12500, 5, 2500];
  const good = B.validateBrief({
    headline: "Margaret Ruiz, before Thursday's visit",
    sections: [
      { key: "giving", sentences: [{ text: "She has given every March since 2019.", cites: ["gift:g1", "gift:g2"] }] },
      { key: "notes", sentences: [{ text: "Rides on Tuesdays; her late husband built the first arena.", cites: ["note:db_marg"] }] },
    ],
  }, { rows, ungrounded, groundedValues: grounded });
  ok("§2 a clean brief survives whole", good.sections.length === 2 && good.sentenceCount === 2 && good.dropped.length === 0, good.dropped);
  ok("§2 …and keeps its headline", good.headline === "Margaret Ruiz, before Thursday's visit");

  const noCite = B.validateBrief({ headline: "x", sections: [{ key: "giving", sentences: [{ text: "She is generous.", cites: [] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2 a sentence citing NOTHING is dropped and counted",
     noCite.sentenceCount === 0 && noCite.dropped.some(d => /cites nothing/.test(d.why)), noCite.dropped);
  const foreignCite = B.validateBrief({ headline: "x", sections: [{ key: "giving", sentences: [{ text: "She gave in March.", cites: ["gift:g_somebody_else"] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2 a sentence citing a row NOT on this person's file is dropped",
     foreignCite.sentenceCount === 0 && foreignCite.dropped.some(d => /cites no row on this person/.test(d.why)), foreignCite.dropped);
  const bogusForm = B.validateBrief({ headline: "x", sections: [{ key: "giving", sentences: [{ text: "She gave.", cites: ["just some words"] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2 a citation that is not even a row reference is dropped", bogusForm.sentenceCount === 0);
  ok("§2 a section nobody defined is dropped",
     B.validateBrief({ headline: "x", sections: [{ key: "wealth", sentences: [{ text: "y", cites: ["gift:g1"] }] }] },
       { rows, ungrounded, groundedValues: grounded }).dropped.some(d => /not a section of a brief/.test(d.why)));
  ok("§2 the surviving sections come back in the order she reads them",
     B.validateBrief({ headline: "x", sections: [
       { key: "notes", sentences: [{ text: "a", cites: ["note:db_marg"] }] },
       { key: "giving", sentences: [{ text: "b", cites: ["gift:g1"] }] }] },
       { rows, ungrounded, groundedValues: grounded }).sections.map(s => s.key).join(",") === "giving,notes");

  console.log("\n— §2b · capacity language, with or without a digit —");
  for (const phrase of ["Her capacity is clearly higher than this.",
                        "She could afford considerably more.",
                        "Her net worth suggests a larger gift.",
                        "She is good for a lead gift.",
                        "The ask amount should be higher."]) {
    const r = B.validateBrief({ headline: "x", sections: [{ key: "giving", sentences: [{ text: phrase, cites: ["gift:g1"] }] }] },
      { rows, ungrounded, groundedValues: grounded });
    ok(`§2b refused: "${phrase.slice(0, 38)}…"`, r.sentenceCount === 0, r.dropped);
  }
  // AND THE OTHER DIRECTION: the phrase list must not eat a legitimate sentence.
  for (const phrase of ["It was a worthwhile visit and she enjoyed it.",
                        "She was unable to give last year.",
                        "The arena is worth showing her."]) {
    const r = B.validateBrief({ headline: "x", sections: [{ key: "notes", sentences: [{ text: phrase, cites: ["note:db_marg"] }] }] },
      { rows, ungrounded, groundedValues: grounded });
    ok(`§2b kept: "${phrase.slice(0, 38)}…"`, r.sentenceCount === 1, r.dropped);
  }
  ok("§2b a figure in the HEADLINE is refused — the headline names the occasion, not a fact",
     B.validateBrief({ headline: "Margaret Ruiz, a $25,000 prospect", sections: [] }, { rows, ungrounded, groundedValues: grounded }).headline === "");

  console.log("\n— §2c · a numeric RULE nothing here defines —");
  const rule = B.validateBrief({ headline: "x", sections: [{ key: "giving",
    sentences: [{ text: "Donors like her usually lapse after 75 days without contact.", cites: ["gift:g1"] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2c THE BUILD-97 ONE: 'lapse after 75 days' is refused", rule.sentenceCount === 0 && /states a rule/.test(rule.dropped[0].why), rule.dropped);
  const declared = B.validateBrief({ headline: "x", sections: [{ key: "giving",
    sentences: [{ text: "Nothing since April, and this organisation calls a sponsor lapsed after 365 days.", cites: ["gift:g1"] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2c …and a number the constants module DOES hold survives", declared.sentenceCount === 1, declared.dropped);
  const ownFigure = B.validateBrief({ headline: "x", sections: [{ key: "giving",
    sentences: [{ text: "She has given $12,500 over 5 gifts.", cites: ["gift:g1"] }] }] },
    { rows, ungrounded, groundedValues: grounded });
  ok("§2c …and HER OWN figures survive — data is not a claim", ownFigure.sentenceCount === 1, ownFigure.dropped);
  ok("§2c the drop is said out loud, never silent", /could not be traced to a row/.test(B.droppedSentence(rule.dropped)), B.droppedSentence(rule.dropped));
  ok("§2c the footer says Steward has not estimated her means",
     /has not estimated this person's means and cannot/.test(B.BRIEF_FOOTER), B.BRIEF_FOOTER);

  // ── §3 · THE ROWS ───────────────────────────────────────────────────────
  console.log("\n— §3 · the rows are Steward's own, and they are labelled —");
  const g1 = await api("POST", "/donors/db_marg/gifts", tok, { amount: 2500, date: "2026-04-12", fundId: "f_br", idempotencyKey: "br-g1" });
  ok("§3 a gift is on file", g1.status === 201 || g1.status === 200, JSON.stringify(g1.body).slice(0, 160));
  await api("POST", "/donors/db_marg/pledges", tok, { amount: 5000, dueDate: "2026-12-31", notes: "Capital pledge" });
  const daf = await api("POST", "/donors/db_daf/gifts", tok, {
    amount: 1000, date: "2026-05-01", type: "daf", idempotencyKey: "br-daf",
    softCredits: [{ donorId: "db_marg", role: "recommender" }] });
  ok("§3 a soft credit is on file", daf.status === 201 || daf.status === 200, JSON.stringify(daf.body).slice(0, 160));
  await api("POST", "/donors/db_marg/proposals", tok, {
    purpose: "Lead gift for the new barn", askAmount: 25000, expectedClose: "2026-11-15",
    stage: "asked", probability: 75, fundId: "f_br", notes: "Wants the arena named." });
  await api("POST", "/donors/db_marg/conversations", tok, {
    touch: "visit", line: "Walked the arena with her; she asked who else is in", nextStep: { skipped: true } });

  const br = await api("GET", "/donors/db_marg/brief-rows", tok);
  ok("§3 the rows load with no API key configured at all", br.status === 200, JSON.stringify(br.body).slice(0, 200));
  const refs = br.body.refs, text = br.body.lines.join("\n");
  ok("§3 the person themselves is a row", refs.includes("person:db_marg"));
  ok("§3 the gift is a row", refs.some(r => r.startsWith("gift:")));
  ok("§3 the pledge is a row", refs.some(r => r.startsWith("pledge:")));
  ok("§3 the soft credit is a row", refs.some(r => r.startsWith("softcredit:")));
  ok("§3 the proposal is a row", refs.some(r => r.startsWith("proposal:")));
  ok("§3 the conversation is a row", refs.some(r => r.startsWith("conversation:")));
  ok("§3 the household is a row", refs.some(r => r.startsWith("household:")));
  ok("§3 her note is a row", refs.includes("note:db_marg"));
  // EVERY reference must be a well-formed citation, or the validator will drop
  // sentences that cited them correctly.
  ok("§3 every reference is a well-formed citation", refs.every(r => B.isCitation(r)), refs.filter(r => !B.isCitation(r)));
  ok("§3 A PLEDGE IS LABELLED A PROMISE, not money received", /A pledge is a promise, not money received/.test(text));
  ok("§3 A SOFT CREDIT IS LABELLED RECOGNITION, not their own giving", /recognition, not their own giving/.test(text));
  ok("§3 the conversation is QUOTED, not summarised", /Walked the arena with her/.test(text));
  ok("§3 the org's OWN WORD for a giver is in the rows", /a sponsor/.test(text), text.slice(0, 200));
  ok("§3 the officer's note on the proposal is there", /Wants the arena named/.test(text));
  ok("§3 her own note is there", /built the first arena/.test(text));
  ok("§3 the grounded values include her own figures",
     br.body.groundedValues.includes(2500) && br.body.groundedValues.includes(5), br.body.groundedValues.slice(0, 10));
  // NOBODY ELSE'S ROWS. The DAF's own gift is the DAF's, not hers.
  ok("§3 no row belongs to anybody else", !/Not Yours/.test(text) && !/Somebody Else/.test(text));

  // ── §4 · THE PAGE SHE PRINTS ────────────────────────────────────────────
  // The PDF is rendered from a STORED brief, which is the shape the route writes.
  // That is deliberate: it proves the renderer without pretending a mock wrote
  // the words (the BUILD-95 rule).
  console.log("\n— §4 · the PDF, on the org's letterhead —");
  const stored = {
    headline: "Margaret Ruiz, before Thursday's visit",
    sections: [
      { key: "giving", title: "Their giving", sentences: [{ text: "She has given $2,500 to the Capital campaign this April.", cites: ["gift:" + (g1.body.gift?.id || "g")] }] },
      { key: "notes", title: "What you wrote", sentences: [{ text: "Rides on Tuesdays; her late husband built the first arena.", cites: ["note:db_marg"] }] },
    ],
    dropped: [{ where: "giving", text: "She could afford more.", why: 'says "could afford"' }],
    sentenceCount: 2,
  };
  const runId = "arun_b99br1";
  await q(`INSERT INTO agent_runs (id,org_id,status,finished_at,plan,read_summary,actions)
           VALUES ($1,$2,'done',NOW(),$3,'8 rows on Margaret Ruiz',$4)`,
    [runId, ORG, JSON.stringify({ kind: "prospect_brief", donorId: "db_marg" }),
     JSON.stringify({ brief: stored, donorId: "db_marg" })]);
  const read = await api("GET", `/briefs/${runId}`, tok);
  ok("§4 a stored brief reads back", read.status === 200 && read.body.sections.length === 2, JSON.stringify(read.body).slice(0, 200));
  ok("§4 …and says what was left out", /1 line was left out/.test(read.body.droppedSentence), read.body.droppedSentence);
  ok("§4 …and carries the footer", /has not estimated/.test(read.body.footer));
  const pdf = await fetch((process.env.BASE || "http://localhost:5601") + `/briefs/${runId}/pdf`, { headers: { Authorization: "Bearer " + tok } });
  ok("§4 the PDF streams", pdf.status === 200 && /application\/pdf/.test(pdf.headers.get("content-type") || ""), pdf.status);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  ok("§4 …as real PDF bytes", bytes.slice(0, 5).toString() === "%PDF-", bytes.slice(0, 8).toString());
  ok("§4 …of a sensible size for one page", bytes.length > 900 && bytes.length < 400000, bytes.length);
  // The letterhead: the org's LEGAL name and its receipt address, the same block
  // the acknowledgment letters use. Read out of the DECOMPRESSED text, because
  // the first cut of this searched the raw bytes, found nothing, and was written
  // with an `|| true` escape — which is a vacuous assertion, not a check.
  // pdfkit wraps a long line, so the extracted text carries newlines mid-sentence
  // ("…this person's \nmeans and cannot."). Match against a whitespace-flattened
  // copy or a line break becomes a false failure.
  const txt = pdfText(bytes);
  const flatTxt = txt.replace(/\s+/g, " ");
  ok("§4 the org's LEGAL name is on the letterhead", txt.includes("Barn Buddies Incorporated"), txt.slice(0, 300));
  ok("§4 …and its address", txt.includes("Lexington"), txt.slice(0, 300));
  ok("§4 the person's name is the title", txt.includes("Margaret Ruiz"));
  ok("§4 the headline is there", /before Thursday/.test(txt));
  ok("§4 each section's title prints", /THEIR GIVING/.test(txt) && /WHAT YOU WROTE/.test(txt), txt.slice(0, 400));
  ok("§4 the sentences print", /Capital campaign this April/.test(flatTxt) && /built the first arena/.test(flatTxt));
  ok("§4 the footer prints, so the reader knows what this is",
     /has not estimated this person's means and cannot/.test(flatTxt), flatTxt.slice(-260));
  ok("§4 the dropped line is admitted on the page too", /1 line was left out/.test(flatTxt), flatTxt.slice(-320));
  ok("§4 AND THE REFUSED SENTENCE IS NOWHERE ON IT", !/could afford/.test(flatTxt));
  const flat = bytes.toString("latin1");
  ok("§4 it is ONE page", (flat.match(/\/Type\s*\/Page[^s]/g) || []).length === 1, (flat.match(/\/Type\s*\/Page[^s]/g) || []).length);
  ok("§4 the filename is the person's, not a run id",
     /filename="brief-margaret-ruiz\.pdf"/.test(pdf.headers.get("content-disposition") || ""), pdf.headers.get("content-disposition"));

  // ── §5 · NO KEY IS AN HONEST ABSENCE ────────────────────────────────────
  console.log("\n— §5 · with nothing configured, the control is unavailable —");
  const noKey = await api("POST", "/donors/db_marg/brief", tok, {});
  if (process.env.ANTHROPIC_API_KEY) {
    ok("§5 SKIPPED — a key is configured in this environment, so the refusal path is not the one under test", true);
  } else {
    ok("§5 the route says UNAVAILABLE, never 500", noKey.status === 503, { status: noKey.status, body: JSON.stringify(noKey.body).slice(0, 200) });
    ok("§5 …and names WHY", noKey.body.reason === "agent_unavailable" || noKey.body.reason === "ai_no_key", noKey.body);
    ok("§5 …and no brief was invented",
       (await q("SELECT COUNT(*)::int c FROM agent_runs WHERE org_id=$1 AND id<>$2", [ORG, runId]))[0].c === 0);
  }

  // ── §6 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §6 · another org's brief and rows —");
  ok("§6 a foreign donor's rows are 404", (await api("GET", "/donors/db_marg/brief-rows", tok2)).status === 404);
  ok("§6 a foreign brief is 404", (await api("GET", `/briefs/${runId}`, tok2)).status === 404);
  const foreignPdf = await fetch((process.env.BASE || "http://localhost:5601") + `/briefs/${runId}/pdf`, { headers: { Authorization: "Bearer " + tok2 } });
  ok("§6 …and so is its PDF", foreignPdf.status === 404, foreignPdf.status);
  ok("§6 a brief cannot be asked for on a foreign donor",
     [404, 503].includes((await api("POST", "/donors/db_marg/brief", tok2, {})).status));
  ok("§6 …and nothing was planted", (await q("SELECT COUNT(*)::int c FROM agent_runs WHERE org_id=$1", [OTHER]))[0].c === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

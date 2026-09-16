// BUILD-86 Part B — HER WORDS. Run: node tests/vocabulary.test.js
//
//   §1  THE DEFAULTS ARE TODAY'S STRINGS. With nothing stored, every surface
//       renders byte-identical to before this build existed. That is what
//       makes the whole thing safe, so it is asserted first and on the FAMILY
//       of surfaces, not on one.
//   §2  HER WORDS REACH THE STAFF SURFACES. With Sparrow-style vocabulary the
//       enumerated surfaces say "sponsors" and say "monthly donor"/"sustainer"
//       NOWHERE.
//   §3  NEVER WHAT A DONOR RECEIVES. The receipt, the year-end statement and
//       the donor portal are out of this module's reach — a §170 acknowledgment
//       is a legal document. Asserted, not remembered.
//   §4  PRESENTATION ONLY: no column, id, API field or route moves.
//   §5  The fiscal-year answer moves the boundary through the ONE date seam,
//       and July stays July by default.
//   §6  Org A's vocabulary never appears in org B's render; the first run is
//       offered once, and a skip is a decision.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b86v", ORG2 = "org_b86v2";
const root = path.join(__dirname, "..");

// Sparrow's words, and the brief's own example of a shop that says something else.
const SPARROW = {
  giver_singular: "sponsor", giver_plural: "sponsors",
  monthly_giver_singular: "sponsor", monthly_giver_plural: "sponsors",
  fund_singular: "designation", fund_plural: "designations",
  fiscal_year_start_month: 7, season_name: "Spring Campaign", season_date: "2027-06-30",
};

const TABLES = ["threads", "recurring_subscriptions", "digest_sends", "tasks", "interactions",
  "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];

(async () => {
  const V = await import("../shared/vocabulary.js");
  const M = await import("../client/src/lib/morningSentence.js");
  const NOW = Date.parse("2026-09-16T12:00:00Z");

  // ── §1 · the defaults are today's strings ────────────────────────────────
  console.log("\n— §1 · an org that answers nothing sees no change —");
  const d = V.normalizeVocabulary(null);
  ok("nothing stored → today's strings", d.giver_plural === "donors" && d.monthly_giver_plural === "monthly donors" && d.fund_plural === "funds", d);
  ok("…including the fiscal year the product hardcoded before this", d.fiscal_year_start_month === 7);
  ok("garbage degrades to the defaults rather than throwing",
     V.normalizeVocabulary("{{{").giver_plural === "donors" && V.normalizeVocabulary([1, 2]).giver_plural === "donors");
  ok("an unknown key cannot be set — a hostile payload invents nothing",
     V.normalizeVocabulary({ giver_plural: "sponsors", evil: "x" }).evil === undefined);
  ok("a blank answer falls back rather than blanking a screen",
     V.normalizeVocabulary({ giver_plural: "   " }).giver_plural === "donors");

  // ONLY the difference is stored, so a later default change still reaches an
  // org that never chose anything.
  ok("storing an all-default answer stores NOTHING",
     Object.keys(V.vocabularyToStore(V.VOCAB_DEFAULTS)).length === 0, V.vocabularyToStore(V.VOCAB_DEFAULTS));
  ok("…and storing a real answer stores only what differs",
     JSON.stringify(V.vocabularyToStore({ ...V.VOCAB_DEFAULTS, giver_plural: "sponsors" })) === '{"giver_plural":"sponsors"}');

  // The morning note with no vocabulary is exactly what Part A shipped.
  const drift = { list: [{ donorName: "Margaret Chen" }, { donorName: "Otis Grange" }] };
  const atRisk = [{ donor_name: "Rob Delaney", first_failed_at: new Date(NOW - 86400000).toISOString() },
                  { donor_name: "Ana Diaz", first_failed_at: new Date(NOW - 2 * 86400000).toISOString() }];
  ok("the morning note with NO vocabulary is byte-identical to Part A's",
     M.morningSentence({ drift, atRisk }, NOW) === "Two donors have gone quiet, two donors' cards failed.",
     M.morningSentence({ drift, atRisk }, NOW));

  // ── §2 · her words reach the staff surfaces ──────────────────────────────
  console.log("\n— §2 · the surfaces speak her language —");
  const t = V.makeT(SPARROW);
  ok("t() reads the pairs by count", t("giver", 1) === "sponsor" && t("giver", 2) === "sponsors");
  ok("…and returns null for an unknown key, never the key name", t("nope", 1) === null);
  ok("THE PLURAL IS STORED, NEVER COMPUTED — a word that does not take an 's' survives",
     V.makeT({ giver_singular: "clergy", giver_plural: "clergy" })("giver", 4) === "clergy");

  const sparrowNote = M.morningSentence({ drift, atRisk }, NOW, t);
  ok("the morning note is in her words", sparrowNote === "Two sponsors have gone quiet, two sponsors' cards failed.", sparrowNote);
  ok("…and says 'monthly donor' and 'sustainer' NOWHERE",
     !/monthly donor|sustainer/i.test(sparrowNote), sparrowNote);
  ok("a plural that does not end in s gets the right possessive",
     M.possessivePlural("clergy") === "clergy's" && M.possessivePlural("sponsors") === "sponsors'");

  // ── §3 · NEVER what a donor receives ─────────────────────────────────────
  console.log("\n— §3 · a receipt is a legal document —");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const receiptFns = ["renderReceiptPdf", "sendReceiptEmail", "issueYearEndStatement"];
  for (const fn of receiptFns) {
    const i = server.indexOf(`function ${fn}`);
    ok(`${fn} exists to be checked`, i > 0);
    const body = server.slice(i, i + 9000);
    ok(`${fn} reads NO vocabulary — a §170 acknowledgment keeps its own words`,
       !/makeT\(|vocabulary/i.test(body), (body.match(/vocabulary\w*/gi) || []).slice(0, 3));
  }
  const portal = fs.readFileSync(path.join(root, "client/src/pages/Portal.jsx"), "utf8");
  ok("the donor portal imports no vocabulary — its audience is the donor, not the staff",
     !/shared\/vocabulary/.test(portal));
  const statementSurfaces = fs.readFileSync(path.join(root, "client/src/pages/GivingDashboard.jsx"), "utf8");
  ok("the donor's own giving dashboard imports none either", !/shared\/vocabulary/.test(statementSurfaces));

  // ── §4 · presentation only ───────────────────────────────────────────────
  console.log("\n— §4 · nothing is renamed —");
  const vocabSrc = fs.readFileSync(path.join(root, "shared/vocabulary.js"), "utf8");
  ok("the vocabulary module issues no SQL and touches no column",
     !/SELECT|UPDATE |INSERT |ALTER /i.test(vocabSrc));
  ok("every settable key is on the fixed list", V.VOCAB_KEYS.length === 9 && V.VOCAB_KEYS.includes("giver_plural"));

  // ── §5 · the fiscal answer moves ONE boundary ────────────────────────────
  console.log("\n— §5 · when her year starts —");
  const orgTime = require("../orgTime.js");
  const base = { timezone: "America/New_York" };
  const at = new Date("2026-09-16T12:00:00Z");
  const julyDefault = orgTime.orgPeriodBounds(base, "fiscal_year", 0, at);
  ok("with nothing set, the fiscal year is July — exactly what was hardcoded",
     julyDefault.start === "2026-07-01" && julyDefault.end === "2027-06-30", julyDefault);
  const jan = orgTime.orgPeriodBounds({ ...base, vocabulary_json: JSON.stringify({ fiscal_year_start_month: 1 }) }, "fiscal_year", 0, at);
  ok("a January answer moves the boundary", jan.start === "2026-01-01" && jan.end === "2026-12-31", jan);
  const oct = orgTime.orgPeriodBounds({ ...base, vocabulary_json: JSON.stringify({ fiscal_year_start_month: 10 }) }, "fiscal_year", 0, at);
  ok("…and an October answer puts today in the PREVIOUS fiscal year",
     oct.start === "2025-10-01" && oct.end === "2026-09-30", oct);
  ok("a malformed month degrades to July rather than throwing",
     orgTime.orgPeriodBounds({ ...base, vocabulary_json: '{"fiscal_year_start_month":"banana"}' }, "fiscal_year", 0, at).start === "2026-07-01");
  const orgTimeSrc = fs.readFileSync(path.join(root, "orgTime.js"), "utf8");
  // ONE PLACE DECIDES THE BOUNDARY. This caught a real second source of truth:
  // orgReportYear still used the hardcoded constant, so a January-fiscal org
  // would have got the right period bounds and the WRONG year label on the
  // same report. Nothing may READ the old constant any more.
  const readers = orgTimeSrc.split("\n").filter(l =>
    /FISCAL_START_MONTH\b/.test(l) && !/FISCAL_START_MONTH_DEFAULT/.test(l)
    && !/^\s*\/\//.test(l) && !/^const FISCAL_START_MONTH = /.test(l.trim()) && !/module\.exports|DEFAULT_TZ, FISCAL_START_MONTH/.test(l));
  ok("there is ONE place the boundary is decided — nothing reads the old constant",
     readers.length === 0, readers);
  const janLabel = orgTime.orgReportYear({ ...base, vocabulary_json: JSON.stringify({ fiscal_year_start_month: 1 }) }, "fiscal", at);
  const julyLabel = orgTime.orgReportYear(base, "fiscal", at);
  ok("the report YEAR LABEL follows the same answer as the period bounds",
     julyLabel === 2027 && janLabel === 2027, { julyLabel, janLabel });
  const octLabel = orgTime.orgReportYear({ ...base, vocabulary_json: JSON.stringify({ fiscal_year_start_month: 10 }) }, "fiscal", at);
  ok("…and an October year labels today's FY by its own boundary", octLabel === 2026, octLabel);

  // A season is only worth a clause while it is ahead and near.
  ok("a season 20 days out is mentionable", V.seasonDaysAway({ season_name: "Banquet", season_date: "2026-10-06" }, "2026-09-16") === 20);
  ok("…one 90 days out is not", V.seasonDaysAway({ season_name: "Banquet", season_date: "2026-12-15" }, "2026-09-16") === null);
  ok("…and one in the past is not", V.seasonDaysAway({ season_name: "Banquet", season_date: "2026-09-01" }, "2026-09-16") === null);

  // ── §6 · live: storage, the one-time offer, tenancy ──────────────────────
  console.log("\n— §6 · stored, offered once, and never crossing an org —");
  for (const o of [ORG, ORG2]) {
    for (const tb of TABLES) await q(`DELETE FROM ${tb} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, name, slug, email] of [[ORG, "Sparrow Missions", "b86v", "b86v@test.local"], [ORG2, "Plain Org", "b86v2", "b86v2@test.local"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, ["u_" + id, id, email, hash]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_b86v',$1,'Kitui Church Partners',false)`, [ORG]);

  const tok = await login("b86v@test.local"), tok2 = await login("b86v2@test.local");
  const before = (await api("GET", "/org/vocabulary", tok)).body;
  ok("an org that has answered nothing reports no setAt", before.setAt === null, before.setAt);
  ok("…and is offered its own file's fund names as evidence",
     before.evidence.funds.includes("Kitui Church Partners"), before.evidence.funds);
  ok("…and the five questions, in order", before.questions.length === 5 && before.questions[0].id === "giver", before.questions.map(x => x.id));

  const put = await api("PUT", "/org/vocabulary", tok, SPARROW);
  ok("saving her words returns them normalised", put.status === 200 && put.body.vocabulary.giver_plural === "sponsors", put.body);
  const after = (await api("GET", "/org/vocabulary", tok)).body;
  ok("…they are stored", after.vocabulary.fund_plural === "designations", after.vocabulary);
  ok("…and the first run is now answered, so it is never offered again", !!after.setAt);
  ok("only the DIFFERENCE is stored", after.stored.fiscal_year_start_month === undefined, after.stored);

  // The org read path carries it to the client.
  const orgRead = (await api("GET", "/org", tok)).body;
  ok("GET /org carries the vocabulary to the client", !!orgRead.vocabulary_json, orgRead.vocabulary_json);

  // Tenancy.
  const other = (await api("GET", "/org/vocabulary", tok2)).body;
  ok("ORG B SEES ITS OWN WORDS, never org A's",
     other.vocabulary.giver_plural === "donors" && other.setAt === null, other.vocabulary);
  ok("…and org B's fund evidence is its own (empty)", other.evidence.funds.length === 0, other.evidence.funds);

  // A skip is a DECISION.
  const skipped = await api("PUT", "/org/vocabulary", tok2, { skip: true });
  ok("a skip is accepted", skipped.status === 200 && skipped.body.skipped === true, skipped.body);
  const afterSkip = (await api("GET", "/org/vocabulary", tok2)).body;
  ok("…it stamps the decision, so the first run never nags", !!afterSkip.setAt);
  ok("…and leaves the product on today's strings", afterSkip.vocabulary.giver_plural === "donors", afterSkip.vocabulary);

  // Gating: it changes what everyone in the org sees.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b86v_staff',$1,'b86vstaff@test.local',$2,'Staff','staff')`, [ORG, hash]);
  const staffTok = await login("b86vstaff@test.local");
  const staffPut = await api("PUT", "/org/vocabulary", staffTok, { giver_plural: "whatever" });
  ok("a staff member cannot rewrite the org's vocabulary (403)", staffPut.status === 403, staffPut.status);
  await q(`UPDATE orgs SET subscription_status='trial_expired' WHERE id=$1`, [ORG]);
  const ro = await api("PUT", "/org/vocabulary", tok, SPARROW);
  ok("a lapsed org cannot either (402), and can still read", ro.status === 402
     && (await api("GET", "/org/vocabulary", tok)).status === 200, ro.status);
  await q(`UPDATE orgs SET subscription_status='active' WHERE id=$1`, [ORG]);

  for (const o of [ORG, ORG2]) {
    for (const tb of TABLES) await q(`DELETE FROM ${tb} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

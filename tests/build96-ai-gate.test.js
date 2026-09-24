// BUILD-96 Part 3 — THE MODEL IS A SUBPROCESSOR, AND IT IS GATED.
//
// Two features send an organisation's own data to a third party:
//
//   · Cheque reading sends a PHOTOGRAPH OF A CHEQUE — a name, an amount, a
//     bank, an account number and a signature. It is the most sensitive image
//     this product will ever hold.
//   · The BUILD-97 agent sends the instruction, the org's vocabulary and the
//     rows Steward selected for it.
//
// Neither was recorded anywhere a customer could read, and neither had an off
// switch. This suite asserts the gate that fixes that, and the disclosure that
// has to exist for the gate to mean anything.
//
// THE THREE STATES, and what each one must look like:
//   §1  no key            → the controls are ABSENT, not broken, and nothing leaves
//   §2  key + switch off  → the same, by the org's own choice, said differently
//   §3  key + switch on   → the routes are reachable and still write nothing
//
// §4  the disclosure: data-handling, the agreement's subprocessor table, the
//     line in Settings, and the manual step with its spend cap
//
// The scratch server runs with NO ANTHROPIC_API_KEY, which is the interesting
// state and the one production is in today. The legs that need a key say so
// and skip rather than passing quietly.
//
// Standard scratch stack (tests/README.md).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b96ai";
const ADMIN = "b96ai-admin@example.org";
const STAFF = "b96ai-staff@example.org";
const HAVE_KEY = !!process.env.ANTHROPIC_API_KEY;

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

async function reset() {
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

// A 1×1 PNG. Enough to be a well-formed image the route will accept as far as
// the gate; the gate is what this suite is about, and no byte of it should
// ever reach a network.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

(async () => {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'AI Gate Org','b96ai',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b96ai_a',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b96ai_s',$1,$2,$3,'Staff','staff')`, [ORG, STAFF, hash]);

  const adminTok = await login(ADMIN);
  const staffTok = await login(STAFF);

  // ── §0 · the column, and its direction ───────────────────────────────────
  console.log("\n— §0 · the switch defaults ON, and every existing org keeps the features —");

  const [col] = await q(
    `SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name='orgs' AND column_name='ai_enabled'`);
  ok("orgs.ai_enabled exists", !!col, col);
  ok("...defaulting TRUE — a NULL-means-off column would switch this off for everybody on deploy",
     col && /true/i.test(col.column_default || ""), col && col.column_default);
  ok("...and no org was left NULL by the migration",
     (await q(`SELECT COUNT(*)::int AS c FROM orgs WHERE ai_enabled IS NULL`))[0].c === 0);

  // ── §1 · no key ──────────────────────────────────────────────────────────
  console.log("\n— §1 · with no key: absent, not broken —");

  const status = await api("GET", "/org/ai-status", adminTok);
  ok("the status route answers", status.status === 200, status.body);
  ok("it reports the two facts SEPARATELY — Steward's key, and the org's choice",
     "configured" in status.body && "enabled" in status.body, status.body);
  ok("...and names the provider, so the screen never has to hardcode it",
     status.body.provider === "Anthropic", status.body);

  if (!HAVE_KEY) {
    ok("no key: configured is false", status.body.configured === false, status.body);
    ok("...but the ORG is not told it switched something off it never touched",
       status.body.enabled === true, status.body);
    ok("...cheque reading is off", status.body.chequeReading === false, status.body);
    ok("...and so is agent drafting", status.body.agentDrafting === false, status.body);

    const read503 = await api("POST", "/deposits/read-cheques", adminTok,
      { cheques: [{ line: 1, image: PIXEL }] });
    ok("the cheque-read route refuses", read503.status === 503, read503.status);
    ok("...naming the key as the reason, not the org", read503.body.reason === "ai_no_key", read503.body);

    const daily = await api("GET", "/agent/daily-line", adminTok);
    ok("the Home agent box is told it is unavailable", daily.body.available === false, daily.body);
    ok("...with the exact sentence the brief specifies",
       daily.body.message === "Not enabled for this organization yet.", daily.body.message);
    ok("...and NO daily line, rather than a template with holes in it",
       daily.body.line === null, daily.body);
  } else {
    console.log("  (ANTHROPIC_API_KEY is set in this environment — §1's no-key legs are not exercised)");
  }

  // ── §2 · key present, org switch off ─────────────────────────────────────
  console.log("\n— §2 · the org's own switch, and what it says when it is off —");

  const staffFlip = await api("PATCH", "/org/ai-settings", staffTok, { enabled: false });
  ok("a non-admin cannot flip it", staffFlip.status === 403, staffFlip.status);

  const badFlip = await api("PATCH", "/org/ai-settings", adminTok, { enabled: "no" });
  ok("a non-boolean is refused rather than coerced", badFlip.status === 400, badFlip.status);

  const off = await api("PATCH", "/org/ai-settings", adminTok, { enabled: false });
  ok("an admin switches it off", off.status === 200 && off.body.enabled === false, off.body);
  ok("...and it is persisted on the org",
     (await q(`SELECT ai_enabled FROM orgs WHERE id=$1`, [ORG]))[0].ai_enabled === false);

  const offStatus = await api("GET", "/org/ai-status", adminTok);
  ok("the status says the ORG turned it off", offStatus.body.enabled === false, offStatus.body);
  ok("...and both features are off together — one gate, never two",
     offStatus.body.chequeReading === false && offStatus.body.agentDrafting === false, offStatus.body);

  const offRead = await api("POST", "/deposits/read-cheques", adminTok,
    { cheques: [{ line: 1, image: PIXEL }] });
  ok("the cheque route refuses while off", offRead.status === 503, offRead.status);
  if (HAVE_KEY) {
    ok("...blaming the ORG's switch, not a missing key", offRead.body.reason === "ai_disabled", offRead.body);
    const offDaily = await api("GET", "/agent/daily-line", adminTok);
    ok("...and the agent box says it is this organisation's choice",
       offDaily.body.reason === "ai_disabled", offDaily.body);
  }

  // ── §3 · back on ─────────────────────────────────────────────────────────
  console.log("\n— §3 · switched back on —");

  const on = await api("PATCH", "/org/ai-settings", adminTok, { enabled: true });
  ok("an admin switches it back on", on.status === 200 && on.body.enabled === true, on.body);
  const onStatus = await api("GET", "/org/ai-status", adminTok);
  ok("the org is enabled again", onStatus.body.enabled === true, onStatus.body);
  ok("...and whether the feature actually runs still depends on the key",
     onStatus.body.chequeReading === (HAVE_KEY && true), onStatus.body);

  // Whatever the gate says, a read may never POST a gift. This is the BUILD-95
  // guarantee and it is re-asserted here because Part 3 moved the gate.
  const giftsBefore = (await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [ORG]))[0].c;
  await api("POST", "/deposits/read-cheques", adminTok, { cheques: [{ line: 1, image: PIXEL }] });
  ok("READING WRITES NOTHING — not a gift, in any gate state",
     (await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [ORG]))[0].c === giftsBefore);

  const empty = await api("POST", "/deposits/read-cheques", adminTok, { cheques: [] });
  ok("an empty request is a 400 before the gate is even consulted", empty.status === 400, empty.status);

  // ── §4 · the disclosure ──────────────────────────────────────────────────
  console.log("\n— §4 · what a customer can actually read —");

  const dh = read("steward-data-handling.md");
  ok("data handling names Anthropic as a subprocessor", /\*\*Anthropic\*\*/.test(dh) && /subprocessor/.test(dh), true);
  ok("...with its location", /United States/.test(dh), true);
  ok("...saying records are not retained for training",
     /not retained by the provider for training/.test(dh), true);
  ok("...and saying what is NOT sent — no name lookup outside the org",
     /no name lookup/.test(dh) && /matched against your records \*\*afterwards, inside Steward\*\*/.test(dh), true);
  ok("...and that photographs still happen with no key",
     /still photographs the cheques/.test(dh), true);

  const terms = read("client/src/pages/TermsPage.jsx");
  ok("the agreement has a subprocessor table", /Service Providers \(Subprocessors\)/.test(terms), true);
  ok("...naming Anthropic", /<strong>Anthropic<\/strong>/.test(terms), true);
  ok("...with the brief's purpose wording, verbatim",
     /reading amounts from cheque photographs an organization chooses to upload/.test(terms) &&
     /drafting text from an organization&apos;s own records on its instruction/.test(terms), true);
  ok("...and Resend too — it has held donor names since BUILD-88c and was never named",
     /<strong>Resend<\/strong>/.test(terms), true);

  // A numbered agreement with two section 16s is a document nobody can cite.
  const nums = [...terms.matchAll(/<h2 style=\{S\.h2\}>(\d+)\./g)].map(m => parseInt(m[1], 10));
  ok("the Terms' section numbers are unique and in order",
     nums.length > 0 && nums.every((n, i) => n === i + 1), nums);

  const settings = read("client/src/components/Settings.jsx");
  ok("Settings carries the one line, verbatim",
     settings.includes("Cheque photographs are read by Anthropic to suggest an amount") &&
     settings.includes("Nothing is entered or sent until you confirm it."), true);
  ok("...with a switch beside it", /data-testid="settings-ai-toggle"/.test(settings), true);
  ok("...shown only when a key is configured — a switch for something Steward cannot do means nothing",
     /aiStatus&&aiStatus\.configured&&/.test(settings), true);

  const deposit = read("client/src/components/DepositSheet.jsx");
  ok("the deposit sheet still photographs when reading is off",
     /attachCheques/.test(deposit) && /canRead \? readCheques : attachCheques/.test(deposit), true);

  const ms = read("MANUAL-STEPS.md");
  ok("the manual step names the key", /ANTHROPIC_API_KEY/.test(ms), true);
  ok("...and REQUIRES a monthly spend cap", /spend cap/i.test(ms) && /Usage limits/.test(ms), true);
  ok("...explaining why: twenty photographs in one press",
     /twenty photographs in one press/.test(ms), true);

  const rec = read("claude/BUILD-95.md");
  ok("BUILD-95.md still says reading is unproven — the drill has not run",
     /unproven/.test(rec), true);

  await reset();
  await closeDb();
  summary();
})();

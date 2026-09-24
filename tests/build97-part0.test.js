// BUILD-97 Part 0 — WHAT BUILD-96 LEFT, AND THE FILE grep COULD NOT SEE.
//
// Two unrelated-looking things, one shape: a guarantee the code already made
// and nothing on the outside could observe.
//
//   §1  THE NUL BYTE. `shared/importShape.js` carried two literal NUL bytes as
//       a join separator. `grep` reads a file containing a NUL as BINARY and
//       SILENTLY SKIPS IT — so the largest mapper module in the repo (4,180
//       lines, 60+ exports) was invisible to every tree-wide search ever run,
//       including safety sweeps. That is the mechanism, exactly, that let
//       `steward-messy-2500-v2.csv` and its 440 real mailbox addresses survive
//       a scan reporting the tree clean on 22 September. The byte-level guard
//       lives in tests/script-guards.test.js; what is pinned HERE is that the
//       separator still works, because a one-character change to a comparison
//       used by every spreadsheet import is not a change to make on faith.
//
//   §2  THE DEMO BANNER. Since the incident, `orgMaySendEmail()` has refused a
//       whole org marked `is_demo_org` and `donorMailDecision()` has refused an
//       `is_sample` donor. Both work. NEITHER IS VISIBLE. An organisation full
//       of fiction looked exactly like one full of customers — which is how
//       25,034 invented donors sat in production for twelve days.
//
//       TWO STATES, TWO SENTENCES, because the two gates are different
//       guarantees and saying the wrong one is a promise the product cannot
//       keep:
//         · the ORG is demo      → nothing leaves this organisation at all
//         · sample rows, org not → those people get no mail; everyone else does
//
//       Asserted IN A BROWSER, because the flags already crossed the wire and
//       were thrown away by adaptData's whitelist — the BUILD-89 adaptDonor
//       trap — so every server assertion would have been green on a screen
//       that said nothing.
//
// Standard scratch stack (tests/README.md) + the :4173 preview for §3.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

const root = path.join(__dirname, "..");
const DEMO = "org_b97demo", SAMP = "org_b97samp", PLAIN = "org_b97plain";
const PASS = "loadtest1234";
const U_DEMO = "demo@b97.example.org", U_SAMP = "samp@b97.example.org", U_PLAIN = "plain@b97.example.org";

async function reset() {
  for (const o of [DEMO, SAMP, PLAIN]) {
    for (const t of ["gifts", "donors", "users", "fin_funds", "accounts"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name, opts = {}) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,
                     emails_enabled,is_demo_org)
   VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507',$4,$5)`,
  [id, name, id.replace(/_/g, "-"), opts.emails !== false, opts.demo === true]);
const mkUser = (id, org, email) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Tester','admin')`,
  [id, org, email, bcrypt.hashSync(PASS, 4)]);
const mkDonor = (id, org, name, email, sample) => q(
  `INSERT INTO donors (id,org_id,name,email,is_sample,total_giving,stage)
   VALUES ($1,$2,$3,$4,$5,100,'cultivate')`,
  [id, org, name, email, sample]);

(async () => {
  console.log("build97-part0");
  await reset();
  await mkOrg(DEMO,  "Fiction Works (Demo)", { demo: true, emails: false });
  await mkOrg(SAMP,  "Half Real Arts");
  await mkOrg(PLAIN, "Nothing Invented Here");
  await mkUser("u_b97d", DEMO, U_DEMO);
  await mkUser("u_b97s", SAMP, U_SAMP);
  await mkUser("u_b97p", PLAIN, U_PLAIN);
  // The sample org holds BOTH kinds of person — that is the whole point of the
  // second sentence. Three invented, one real.
  await mkDonor("d_b97s1", SAMP, "Invented One",   "one@example.com",   true);
  await mkDonor("d_b97s2", SAMP, "Invented Two",   "two@example.com",   true);
  await mkDonor("d_b97s3", SAMP, "Invented Three", "three@example.com", true);
  await mkDonor("d_b97s4", SAMP, "Real Person",    "real@example.com",  false);
  await mkDonor("d_b97p1", PLAIN, "Also Real",     "also@example.com",  false);
  await mkDonor("d_b97d1", DEMO,  "Demo Donor",    "demo@example.com",  false);

  // ── §1 · THE FILE grep COULD NOT SEE ─────────────────────────────────────
  console.log("\n— §1 · importShape.js is text, and the separator still works —");
  const bytes = fs.readFileSync(path.join(root, "shared", "importShape.js"));
  ok("shared/importShape.js contains no raw NUL byte", !bytes.includes(0x00),
     { nuls: bytes.filter ? [...bytes].filter(b => b === 0).length : "?" });
  // The observable consequence, stated as the thing a person actually does:
  // a tree-wide grep now finds a symbol that is DEFINED only in this file.
  const src = bytes.toString("utf8");
  ok("…and the separator is written as an escape, not typed as a byte",
     /const SEP = "\\u0000";/.test(src), null);
  ok("…with the reason recorded beside it", /grep/.test(src.slice(src.indexOf("const SEP") - 900, src.indexOf("const SEP"))), null);

  // The behaviour the separator is load-bearing for: a page-break re-print of
  // the header row inside the body must still be recognised as chrome, not
  // imported as a donor called "Name".
  const shape = await import("../shared/importShape.js");
  const header = ["Name", "Email", "Amount"];
  ok("a repeated header row is still classified as chrome",
     shape.classifyBodyRow(["Name", "Email", "Amount"], header)?.kind === "repeated_header",
     shape.classifyBodyRow(["Name", "Email", "Amount"], header));
  ok("…and a real data row is still a data row",
     shape.classifyBodyRow(["Ada Lovelace", "ada@example.org", "50"], header) === null,
     shape.classifyBodyRow(["Ada Lovelace", "ada@example.org", "50"], header));
  // The separator must not be confusable with anything a cell can hold: two
  // DIFFERENT header shapes that would collide under a naive join (",") must
  // not be read as equal.
  ok("cells that would collide under a comma join do not collide under SEP",
     shape.classifyBodyRow(["a,b", "c"], ["a", "b,c"]) === null,
     shape.classifyBodyRow(["a,b", "c"], ["a", "b,c"]));

  // ── §2 · THE FLAGS REACH THE CLIENT ──────────────────────────────────────
  console.log("\n— §2 · the two flags cross the wire AND survive the adapter —");
  const demoTok = await login(U_DEMO, PASS);
  const sampTok = await login(U_SAMP, PASS);
  const plainTok = await login(U_PLAIN, PASS);

  const orgDemo = await api("GET", "/org", demoTok);
  ok("GET /org reports is_demo_org for a demo org", orgDemo.body.is_demo_org === true, orgDemo.body.is_demo_org);
  ok("…and emails_enabled false", orgDemo.body.emails_enabled === false, orgDemo.body.emails_enabled);
  const orgPlain = await api("GET", "/org", plainTok);
  ok("an ordinary org reports neither", orgPlain.body.is_demo_org === false && orgPlain.body.emails_enabled === true,
     { d: orgPlain.body.is_demo_org, e: orgPlain.body.emails_enabled });

  // THE TRAP. `GET /org` is SELECT *, so these already crossed the wire before
  // this build — adaptData's whitelist dropped them, exactly as it once dropped
  // assignedTo (BUILD-89). A source assertion is the only place to pin it,
  // because a field that is silently absent renders as "not a demo org".
  const apiSrc = fs.readFileSync(path.join(root, "client", "src", "api.js"), "utf8");
  ok("adaptData names isDemoOrg", /isDemoOrg:\s*org\.is_demo_org === true/.test(apiSrc), null);
  ok("adaptData names emailsEnabled", /emailsEnabled:\s*org\.emails_enabled !== false/.test(apiSrc), null);

  // ── §3 · THE TWO STATES ARE TWO DIFFERENT ANSWERS ────────────────────────
  console.log("\n— §3 · sample-data status, and org isolation on it —");
  const stSamp = await api("GET", "/org/sample-data-status", sampTok);
  ok("the sample org reports its invented donors", stSamp.body.hasSampleData === true && stSamp.body.sampleDonorCount === 3, stSamp.body);
  const stPlain = await api("GET", "/org/sample-data-status", plainTok);
  ok("an org with none reports none", stPlain.body.hasSampleData === false && stPlain.body.sampleDonorCount === 0, stPlain.body);
  const stDemo = await api("GET", "/org/sample-data-status", demoTok);
  ok("a DEMO org is not the same thing as an org holding sample rows",
     stDemo.body.hasSampleData === false, stDemo.body);

  // ── §4 · THE GATES THEMSELVES STILL REFUSE ───────────────────────────────
  // Restated here rather than assumed: the banner is a claim about behaviour,
  // and a banner whose claim is false is worse than no banner.
  console.log("\n— §4 · the banner's claim is true —");
  const gate = await api("POST", "/admin/orgs/" + DEMO + "/email-switch", demoTok, { emailsEnabled: true });
  ok("a non-super-admin cannot flip a demo org's mail back on", gate.status === 403, gate.status);

  // ── §5 · THE BROWSER: IT SAYS SO, AND IT SAYS THE RIGHT ONE ──────────────
  console.log("\n— §5 · the browser: the banner, and which sentence —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const signIn = async (email) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
      const lr = await page.request.post(BASE + "/auth/login", { data: { email, password: PASS } });
      const lj = await lr.json();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(d => {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
      }, lj);
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      return page;
    };

    const pDemo = await signIn(U_DEMO);
    const bDemo = pDemo.locator('[data-testid="demo-data-banner"]');
    ok("a DEMO org shows the banner", await bDemo.count() === 1, await bDemo.count());
    const tDemo = (await bDemo.count()) ? await bDemo.innerText() : "";
    ok("…and it says nothing leaves this organisation AT ALL",
       /demonstration organisation/i.test(tDemo) && /will not send email to anyone here/i.test(tDemo), tDemo.slice(0, 200));
    ok("…and it is not dismissible", await pDemo.locator('[data-testid="demo-data-banner"] button:has-text("✕")').count() === 0, null);
    await pDemo.close();

    const pSamp = await signIn(U_SAMP);
    const bSamp = pSamp.locator('[data-testid="demo-data-banner"]');
    ok("an org holding SAMPLE ROWS shows the banner too", await bSamp.count() === 1, await bSamp.count());
    const tSamp = (await bSamp.count()) ? await bSamp.innerText() : "";
    ok("…and it says the OTHER sentence: only those people are unreachable",
       /3 sample donors are loaded/i.test(tSamp) && /Everyone else in this organisation still receives mail/i.test(tSamp),
       tSamp.slice(0, 260));
    ok("…and it does NOT claim the whole organisation is silent",
       !/demonstration organisation/i.test(tSamp), tSamp.slice(0, 200));

    // The clear action, from the banner itself.
    const clear = pSamp.locator('[data-testid="demo-banner-clear"]');
    ok("the banner carries the clear action", await clear.count() === 1, null);
    await clear.click();
    await pSamp.waitForTimeout(2500);
    const left = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND is_sample=true`, [SAMP]);
    ok("clearing from the banner removes the invented donors", left[0].n === 0, left[0]);
    const kept = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [SAMP]);
    ok("…and leaves the real one alone", kept[0].n === 1, kept[0]);
    await pSamp.close();

    const pPlain = await signIn(U_PLAIN);
    ok("an ordinary org shows NO banner",
       await pPlain.locator('[data-testid="demo-data-banner"]').count() === 0, null);
    await pPlain.close();
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

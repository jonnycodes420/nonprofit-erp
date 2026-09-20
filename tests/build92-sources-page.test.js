// BUILD-92 B2 — WHERE GIFTS COME IN. Run: node tests/build92-sources-page.test.js
//
// This is the page Jonathan shares his screen on during every onboarding hour,
// so the things that can go wrong on it are the things a stranger watching
// would notice: a source promised that Steward cannot actually connect to, a
// tile with no name, the same error paragraph printed twice so it reads as two
// faults, an em dash, and a banner arguing with the page it sits above.
//
//   §1  THE SOURCE. Two groups, a step for every provider, the logo slot
//       switched off behind ONE flag, and the onboarding step that never
//       blocks.
//   §2  RENDERED. Both groups on the screen; Cash App and Venmo in the upload
//       group and NOWHERE else; every tile with an accessible name; one error
//       sentence per failed source and never the same sentence twice; never
//       "not checked yet" beside a failure; zero em dashes; and the "no
//       platform fee" banner gone from this page.
//
// §2 skips cleanly without Playwright, a dist built against this API, or an
// app served at APP_URL (default :4173) — never a false pass.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const ORG = "org_b92_src", ADMIN = "b92src@example.org";

// The same error sentence on two different sources: the page must say it once.
const SHARED_ERROR = "That key was refused. Create a new key and paste it in again.";
const WAITING_ERROR = "PayPal has not allowed transaction search on this account yet.";

function renderedText(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  for (const m of noComments.matchAll(/>([^<>{}]{4,})</g)) out.push(m[1]);
  for (const m of noComments.matchAll(/["'`]([^"'`\n]{12,})["'`]/g)) out.push(m[1]);
  return out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function chunk(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return "";
  const b = endMarker ? src.indexOf(endMarker, a) : -1;
  return b > a ? src.slice(a, b) : src.slice(a);
}

// Opening the app in a browser touches a great deal of the product, and some
// of it writes: a chart of accounts heals itself, a thread is built, a task is
// stamped. A hand-kept delete list therefore goes stale and the org survives
// its own teardown, which shows up on the NEXT run as a duplicate key. So the
// teardown asks the schema which tables point at orgs and clears all of them.
async function reset() {
  const refs = await q(
    `SELECT DISTINCT tc.table_name AS t, kcu.column_name AS c
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'orgs'`).catch(() => []);
  // Several passes, because those tables reference each other too.
  for (let pass = 0; pass < 4; pass++) {
    for (const r of refs) await q(`DELETE FROM "${r.t}" WHERE "${r.c}"=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(e => console.log("  note  teardown left the org behind: " + e.message));
}

(async () => {
  // ══ §1 · THE SOURCE ══════════════════════════════════════════════════════
  console.log("— §1 · two groups, the steps, the flag, the way out —");
  const settings = read("client/src/components/Settings.jsx");
  const gs = chunk(settings, "// ── BUILD-89S 89f — WHERE GIVING COMES IN", "const SETTINGS_TABS=[");
  const welcome = read("client/src/pages/WelcomePage.jsx");
  const lib = await import("../shared/givingSources.js");

  ok("the page exists to be guarded", gs.length > 2000, gs.length);
  ok("the two groups are named in plain words",
     /Connects directly/.test(gs) && /Upload a statement/.test(gs));

  // THE REGISTRY DECIDES, NOT THE PAGE. A file-mode provider may never appear
  // in the group that says Steward connects to it.
  const direct = (gs.match(/const DIRECT_ORDER=\[([^\]]*)\]/) || [])[1] || "";
  const upload = (gs.match(/const UPLOAD_ORDER=\[([^\]]*)\]/) || [])[1] || "";
  const keys = t => t.split(",").map(x => x.trim().replace(/["']/g, "")).filter(Boolean);
  ok("the direct group is exactly the four providers with an API",
     keys(direct).join(",") === "paypal,zeffy,stripe,givebutter", keys(direct));
  ok("...and every one of them is mode api in the registry",
     keys(direct).every(k => lib.PROVIDERS[k] && lib.PROVIDERS[k].mode === "api"),
     keys(direct).filter(k => lib.PROVIDERS[k]?.mode !== "api"));
  ok("Cash App and Venmo are in the upload group",
     keys(upload).join(",") === "cashapp,venmo", keys(upload));
  ok("...and they are mode file, which is WHY they are there",
     keys(upload).every(k => lib.PROVIDERS[k] && lib.PROVIDERS[k].mode === "file"));
  ok("neither is in the direct group",
     !keys(direct).includes("cashapp") && !keys(direct).includes("venmo"));
  ok("the bank is a tile of its own, named the way a person would say it",
     /Zelle, cheques, anything else/.test(gs));
  ok("every upload tile says what the month looks like",
     /Once a month, drop the statement in\./.test(gs));

  // THE PAYPAL STEPS, in the order Jonathan actually hit them.
  const pp = lib.PROVIDERS.paypal.steps || [];
  ok("PayPal has numbered steps", pp.length === 7, pp.length);
  const order = ["Developer", "Sandbox", "Apps and Credentials", "Create App", "Transaction search", "Save Changes", "Client ID"];
  ok("...in the order they are hit on a real PayPal account",
     order.every((needle, i) => (pp[i] || "").includes(needle)),
     order.filter((needle, i) => !(pp[i] || "").includes(needle)));
  ok("...and the Payouts permission is turned OFF, explicitly",
     /untick Payouts/i.test(pp[4] || ""), pp[4]);
  ok("the wait is explained BEFORE the steps, so a refusal reads as normal",
     /up to a day/.test(lib.PROVIDERS.paypal.waitNote || "")
     && /keeps trying and nothing is wrong/.test(lib.PROVIDERS.paypal.waitNote || ""),
     lib.PROVIDERS.paypal.waitNote);
  ok("the panel renders the steps and the note", /gs-steps/.test(gs) && /waitNote/.test(gs));
  ok("the panel is the ONE modal shell, not a thirtieth one",
     /<Modal onClose=\{\(\)=>setConnect\(null\)\}/.test(gs) && !/position:"fixed",inset:0/.test(gs));

  // LOGOS: the slot is built, the marks are not drawn, and one flag turns
  // official files on once somebody has read the brand terms.
  ok("there is a logo slot behind exactly ONE flag",
     /const SOURCE_LOGOS_ENABLED=false/.test(gs)
     && (gs.match(/SOURCE_LOGOS_ENABLED/g) || []).length >= 2);
  ok("no company's mark is drawn in code here",
     !/<svg/i.test(gs) && !/<path\b/i.test(gs), "an inline vector in this section would be a traced logo");

  // THE TYPED NAME IS RECORDED, and the import that follows is the ordinary one.
  ok("Something else records the typed name on the org",
     /\/giving-sources\/other/.test(gs) && /giving-sources\/other/.test(read("server.js")));
  ok("...and then opens the ordinary import, with the seam marked",
     /<DonorImport/.test(gs) && /SEAM \(BUILD-92, Track A in parallel\)/.test(gs));

  // ONBOARDING NEVER BLOCKS.
  ok("onboarding gained the step, straight after the donor file",
     /"import", "sources", "goal"/.test(welcome), (welcome.match(/"import",[^\]]*\]/) || [])[0]);
  ok("...and it is the SAME component as the Settings page",
     /import \{ GivingSourcesManager \} from "\.\.\/components\/Settings"/.test(welcome));
  ok("...and there is always a way past it", /I&apos;ll do this later/.test(welcome));

  // THE VOICE, unchanged: no em dash, and never a claim of freshness.
  const text = renderedText(gs);
  ok("no em dash reaches the page", text.filter(t => t.includes("—")).length === 0,
     text.filter(t => t.includes("—")).slice(0, 3));
  const fresh = [];
  for (const w of lib.FORBIDDEN_FRESHNESS_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`, "i");
    for (const t of text) if (re.test(t)) fresh.push(`${w}: ${t}`);
  }
  ok('the page still never says "live" or "real time"', fresh.length === 0, fresh.slice(0, 3));

  // THE BANNER IS GONE FROM THIS PAGE (and nowhere else).
  ok("the platform-fee banner is suppressed on this section",
     /\{impact&&section!=="sources"&&/.test(settings));
  ok("...and still shown on the others", /No platform fee/.test(settings));

  // ══ the fixture ══════════════════════════════════════════════════════════
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'B92 Sources','b92-sources',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b92_src',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, hash]);
  // Four sources, one per state the tiles have to tell apart. The two failed
  // ones carry the SAME sentence on purpose: that is the defect being guarded.
  const mk = (id, provider, name, extra) => q(
    `INSERT INTO giving_sources (id,org_id,provider,display_name,status,credentials_sealed,last_synced_at,last_error,last_error_at)
     VALUES ($1,$2,$3,$4,$5,'v1.fixture',$6,$7,$8)`,
    [id, ORG, provider, name, extra.status, extra.synced, extra.error, extra.errorAt]);
  await mk("gs_b92_pp", "paypal", "PayPal", { status: "active", synced: new Date(Date.now() - 40 * 60000), error: null, errorAt: null });
  await mk("gs_b92_ze", "zeffy", "Zeffy", { status: "error", synced: null, error: SHARED_ERROR, errorAt: new Date() });
  await mk("gs_b92_st", "stripe", "Stripe", { status: "error", synced: null, error: SHARED_ERROR, errorAt: new Date() });
  await mk("gs_b92_gb", "givebutter", "Givebutter", { status: "error", synced: null, error: WAITING_ERROR, errorAt: new Date() });
  // The WHOLE login response, never a hand-built one: main.jsx sends an org
  // without `onboarding_complete` straight back to /welcome, and the symptom
  // is a Settings button that never appears.
  const authRes = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: "loadtest1234" }),
  });
  const auth = await authRes.json();
  ok("the fixture admin can sign in", !!auth.token && !!auth.org, auth && auth.error);

  // ══ §2 · ON THE SCREEN ═══════════════════════════════════════════════════
  console.log("\n— §2 · what a stranger watching the screen would see —");
  const APP = process.env.APP_URL || "http://localhost:4173";
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  const DIST = path.join(root, "client", "dist");
  const note = why => console.log("  SKIP  browser checks: " + why);
  await (async () => {
    if (!fs.existsSync(path.join(DIST, "index.html"))) return note("client/dist not built");
    const origin = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(origin)))
      return note(`client/dist not built against ${BASE} (VITE_API_URL)`);
    let chromium;
    try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
    catch { return note("Playwright not found (set PLAYWRIGHT_DIR)"); }
    try { const r = await fetch(APP + "/", { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(); }
    catch { return note(`nothing serving ${APP} (set APP_URL; the API's CORS allowlist must cover that origin)`); }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errs = [];
      page.on("pageerror", e => errs.push("pageerror: " + e.message));
      await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate(a => {
        localStorage.setItem("npe_token", a.token);
        localStorage.setItem("npe_user", JSON.stringify(a.user));
        localStorage.setItem("npe_org", JSON.stringify(a.org));
      }, auth);
      await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      // .first(): the app renders a sidebar AND a mobile bottom bar, so a bare
      // text selector is two nodes and Playwright refuses to guess.
      await page.locator('button:has-text("Settings")').first().click();
      await page.waitForTimeout(700);
      await page.locator('button:has-text("Where giving comes in")').first().click();
      await page.waitForSelector('[data-testid="gs-page"]', { timeout: 8000 });
      await page.waitForTimeout(900);

      const seen = await page.evaluate(() => {
        const page = document.querySelector('[data-testid="gs-page"]');
        const group = which => document.querySelector(`[data-gs-group="${which}"]`);
        const namesIn = el => el ? [...el.querySelectorAll('[data-testid="gs-name"]')].map(n => n.textContent.trim()) : null;
        const tiles = [...document.querySelectorAll('[data-testid="gs-tile"]')];
        return {
          boundary: /Something went wrong|Try reloading/i.test(document.body.innerText),
          headings: [...document.querySelectorAll('[data-gs-group] h3')].map(h => h.textContent.trim()),
          directNames: namesIn(group("direct")),
          uploadNames: namesIn(group("upload")),
          tileCount: tiles.length,
          // An accessible name is what a screen reader announces. Every tile
          // opens something, so every tile's control must have one.
          unnamed: tiles.filter(t => {
            const b = t.querySelector('[data-testid="gs-connect-btn"]');
            if (!b) return true;
            const label = (b.getAttribute("aria-label") || "").trim() || b.innerText.trim();
            return label.length < 3;
          }).length,
          errors: [...document.querySelectorAll('[data-testid="gs-row-error"]')].map(e => e.innerText.trim()),
          errorsPerRow: [...document.querySelectorAll('[data-testid="gs-row"]')]
            .map(r => r.querySelectorAll('[data-testid="gs-row-error"]').length),
          // A failed tile's status line, to prove it never reads "not checked yet".
          failedStatus: [...document.querySelectorAll('[data-testid="gs-row"]')]
            .filter(r => r.querySelector('[data-testid="gs-row-error"]'))
            .map(r => r.querySelector('[data-testid="gs-checked"]')?.innerText.trim() || ""),
          waitingTile: (() => {
            const t = [...document.querySelectorAll('[data-testid="gs-tile"]')]
              .find(t => /Givebutter/.test(t.innerText));
            return t ? t.innerText.replace(/\s+/g, " ") : "";
          })(),
          pageText: page ? page.innerText : "",
          bodyText: document.body.innerText,
        };
      });

      ok("the page renders rather than landing in an error boundary", seen.boundary === false);
      ok("both groups are on the screen, with plain headings",
         seen.headings.join(" | ") === "Connects directly | Upload a statement", seen.headings);
      ok("the four direct sources are tiles in the first group",
         ["PayPal", "Zeffy", "Stripe", "Givebutter"].every(n => (seen.directNames || []).includes(n)), seen.directNames);
      ok("Cash App and Venmo are tiles in the UPLOAD group",
         ["Cash App", "Venmo"].every(n => (seen.uploadNames || []).includes(n)), seen.uploadNames);
      ok("...and appear NOWHERE in the group that connects directly",
         !(seen.directNames || []).some(n => /Cash App|Venmo/.test(n)), seen.directNames);
      ok("the bank and Something else are tiles too",
         (seen.uploadNames || []).some(n => /My bank/.test(n)) && (seen.uploadNames || []).includes("Something else"),
         seen.uploadNames);
      ok("every tile has an accessible name", seen.unnamed === 0, seen.unnamed);
      ok("there are at least eight tiles on the page", seen.tileCount >= 8, seen.tileCount);

      // ONE ERROR, ONCE. Two sources refused by the same key are one problem.
      ok("no failed source shows more than one error sentence",
         seen.errorsPerRow.every(n => n <= 1), seen.errorsPerRow);
      ok("and the same error sentence is never printed twice on the page",
         new Set(seen.errors).size === seen.errors.length, seen.errors);
      ok("...though both failures are real, so at least one is shown",
         seen.errors.length >= 1, seen.errors.length);
      ok('a failure never sits beside "not checked yet"',
         seen.failedStatus.length > 0 && seen.failedStatus.every(t => !/not checked yet/i.test(t)), seen.failedStatus);
      ok("...it says when Steward TRIED instead",
         seen.failedStatus.every(t => /^Tried /.test(t)), seen.failedStatus);
      ok("a provider that has not switched the permission on yet reads as waiting, not as broken",
         // innerText, not source: the state label is uppercased in CSS, so the
         // DOM reads WAITING ON THE PROVIDER. Match the words, not the case.
         /waiting on the provider/i.test(seen.waitingTile), seen.waitingTile.slice(0, 140));

      ok("zero em dashes on the page", !seen.pageText.includes("—"),
         (seen.pageText.match(/.{0,40}—.{0,40}/g) || []).slice(0, 2));
      ok("the no-platform-fee banner is not on this page",
         !/platform fee/i.test(seen.bodyText) && !/donor tip/i.test(seen.bodyText),
         (seen.bodyText.match(/.{0,60}platform fee.{0,60}/i) || [])[0]);

      // THE TYPED NAME REALLY LANDS ON THE ORG.
      await page.click('[data-testid="gs-tile"]:has-text("Something else") [data-testid="gs-connect-btn"]');
      await page.waitForSelector('[data-testid="gs-other-name"]', { timeout: 5000 });
      await page.fill('[data-testid="gs-other-name"]', "Donorbox");
      await page.click('[data-testid="gs-other-save"]');
      await page.waitForTimeout(1200);
      const org = await q(`SELECT other_giving_sources FROM orgs WHERE id=$1`, [ORG]);
      const stored = org[0] && org[0].other_giving_sources;
      const list = Array.isArray(stored) ? stored : JSON.parse(stored || "[]");
      ok("a typed name is recorded on the organization", list.includes("Donorbox"), list);

      ok("no page error anywhere in the flow", errs.length === 0, errs.slice(0, 3));
    } finally { await browser.close(); }
  })();

  await reset();
  await closeDb();
  summary();
})();

// BUILD-80 verification walk — the same fixture, back through the REAL UI on
// a FRESH org, at 1440 and 390: money conventions, dd/mm inference, encoding,
// exclusions, semantic rows, identity, organisations, sustainers, the caveat
// machinery, and every drift sentence dumped beside the truth file.
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build80-capture.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED) — scratch stack
// on :5601/:4173 per tests/README.md + scripts/build-local-dist.sh.
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "build79", "steward-messy-2500-v2.csv");
const TRUTH = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "build79", "donor-truth.json"), "utf8"));
const OUT = path.join(__dirname, "..", "docs", "build80");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 300)));
  if (!cond) failures++;
};
const shoot = async (page, name) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.waitForTimeout(400);
};

(async () => {
  const stamp = Date.now().toString(36);
  const EMAIL = `b80walk_${stamp}@test.local`;
  let r = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "B80 Walk " + stamp, userName: "B80 Walker", email: EMAIL, password: "loadtest1234" }) }).then(r => r.json());
  if (!r.token) { console.error("register failed", r); process.exit(1); }
  await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.token }, body: "{}" });
  r.org.onboarding_complete = 1;
  const token = r.token;
  const j = p => fetch(API + p, { headers: { Authorization: "Bearer " + token } }).then(x => x.json());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  page.on("pageerror", e => {
    if (/Unexpected token '<'/.test(e.message)) return;
    console.log("  [pageerror]", e.message); failures++;
  });
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [token, JSON.stringify(r.user), JSON.stringify(r.org)]);

  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Import & tools")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Import + History")');
  await page.waitForTimeout(800);
  await (await page.$('input[type="file"]')).setInputFiles(FIXTURE);
  await page.waitForTimeout(6000);

  // ── the mapper: conventions said BEFORE the write ────────────────────────
  let body = await page.innerText("body");
  console.log("— mapper —");
  ok("dd/mm inference stated with the impossible-count", /1,583 dates use/.test(body) && /day\/month\/year/.test(body) && /832/.test(body));
  ok("double-encoding repairs named (李 among them)", /double-encoded from the source system/.test(body));
  ok("refusal line carries DOLLARS before the write", /rows will be refused \(\$/.test(body));
  ok("semantic rows named as ROUTED, not refused", /route to their own surfaces/.test(body));
  ok("2,500 rows — the one count", /2,500 rows/.test(body) && !/2,853/.test(body));
  await shoot(page, "01-mapper");

  // decide every proposed column (discard-all, the hurried-ED path)
  for (let pass = 0; pass < 3; pass++) {
    const cards = await page.$$("[data-cf-col]");
    for (const card of cards) {
      const discard = await card.$('button:has-text("Discard")');
      if (discard) {
        const txt = (await discard.textContent()).trim();
        if (/^Discard$/.test(txt)) { await discard.click().catch(() => {}); await page.waitForTimeout(120); }
      }
    }
    body = await page.innerText("body");
    if (!/still needs? a decision/i.test(body)) break;
  }
  const findImportBtn = async () => {
    for (const b of await page.$$("button")) {
      const t = ((await b.textContent()) || "").trim();
      if (/^Import [\d,]+ donor/.test(t) || /^Importing/.test(t)) return b;
    }
    return null;
  };
  const importBtn = await findImportBtn();
  ok("import button armed after decisions", importBtn && await importBtn.isEnabled());
  await importBtn.click();
  await page.waitForTimeout(45000);
  await page.waitForLoadState("networkidle").catch(() => {});

  // ── the summary: money, conventions, semantics, identity, conflicts ──────
  console.log("— summary —");
  body = await page.innerText("body");
  fs.writeFileSync(OUT + "/summary-text.txt", body);
  ok("import completed", /Import complete|Imported — with gaps/.test(body));
  ok("'In your file' shows the convention-correct dollars ($2,293,751.22)", /\$2,293,751\.22/.test(body));
  ok("comma-decimal convention line (4 amounts)", /4 amounts used a comma decimal/.test(body));
  ok("space-thousands convention line (8 amounts)", /8 amounts used a space between thousands/.test(body));
  ok("dd/mm line on the summary too", /1,583 dates use day\/month\/year/.test(body));
  ok("the largest-gifts panel leads with the $150,000 estate bequest", /The five largest gifts/i.test(body) && /\$150,000/.test(body) && /Estate of Aisha Ivester/.test(body));
  ok("nothing on the panel above $150,000 (the hundredfold is dead)", !/\$200,000|\$3,856,421/.test(body));
  ok("rows-that-are-not-gifts block: soft credits 60 · $35,016.60", /Soft credits/.test(body) && /60 · \$35,016\.6/.test(body));
  ok("pledges 12 · $184,000 — never in totals", /12 · \$184,000/.test(body));
  ok("in-kind 25 · $38,900 — never cash", /25 · \$38,900/.test(body));
  ok("matching on the corporations 29 · $18,096.61", /29 · \$18,096\.61/.test(body));
  ok("anonymous holding line (15 rows)", /Anonymous gifts/.test(body) && /15 · \$13,650/.test(body));
  ok("the merge review list is on screen with reasons", /rows we merged into one donor/i.test(body));
  ok("household candidates surfaced, not merged", /household candidates for you to join/.test(body));
  ok("shared-ID conflicts surfaced", /shared by different people/.test(body));
  ok("column conflicts shown: Status vs Notes, deceased kept", /Status says Active, Notes say deceased\. We set deceased\./.test(body));
  ok("stale Frequency flags shown: file says monthly, gifts say yearly", /file says monthly, gifts say yearly/.test(body));
  ok("the file's own TOTAL row reconciled", /says \$2,035,978\.52/.test(body));
  ok("non-gift rows downloadable, refusals split from routed", /Download the .* rows that are not gift rows/.test(body));
  const refusedMatch = body.match(/\((\d+) refused · (\d+) routed/);
  ok(`true refusals UNDER 60 on the download line (${refusedMatch && refusedMatch[1]})`, refusedMatch && parseInt(refusedMatch[1]) < 60, refusedMatch && refusedMatch[0]);
  await shoot(page, "02-summary");
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(2500);

  // the semantics call ran from the UI — pledges/links/in-kind landed
  console.log("— DB truth —");
  const ih = await j("/org/import-health");
  ok("import health persisted from the UI walk (2,500 rows, largest gifts)", ih?.stats?.rows === 2500 && (ih.stats.largestGifts || []).length === 5, ih?.stats);
  ok("refusals under the 5% caveat line — no caveat on this import", ih?.caveat === null, ih?.caveat);

  const dr = await j("/drift?includeMedium=1&all=1");
  const dlist = dr.list || [];
  const high = dlist.filter(x => x.confidence === "high");
  ok(`drift list is a real list (${high.length} high-confidence, target 30–45, never 6)`, high.length >= 30 && high.length <= 45, high.length);
  const excludedNames = Object.values(TRUTH).filter(t => (t.deceased || t.doNotSolicit || t.doNotContact) && !t.estate).map(t => t.name);
  const onAsk = excludedNames.filter(nm => { const parts = nm.split(" "); return dlist.some(x => parts.every(p => x.donorName.includes(p))); });
  ok(`zero of the ${excludedNames.length} exclusion names on the ask surface`, onAsk.length === 0, onAsk);
  ok("Paul Ó Briain absent (gave January 2026)", !dlist.some(x => /Paul/.test(x.donorName) && /Briain/.test(x.donorName)), null);
  ok("Kenneth Kensington absent (gave May 2026)", !dlist.some(x => /Kenneth/.test(x.donorName) && /Kensington/.test(x.donorName)), null);
  ok("no organisation drifts", !dlist.some(x => /Foundation|Charitable|Church|Bank|Trust|Estate of/.test(x.donorName)), dlist.filter(x => /Foundation|Charitable/.test(x.donorName)).map(x => x.donorName));
  ok("institutional list carries NCF/Schwab/Fidelity", ["National Christian Foundation", "Schwab Charitable", "Fidelity Charitable"].every(n => (dr.institutional || []).some(i => i.name === n)), (dr.institutional || []).map(i => i.name).slice(0, 5));
  ok("25 sustainers excluded to the recurring/recovery surface", dr.excluded?.unlinkedSustainer === 25, dr.excluded);

  // every drift sentence, dumped beside the truth for the read-aloud
  const lines = ["# BUILD-80 — every drift sentence, read against donor-truth.json", ""];
  for (const x of dlist) {
    const truthHit = Object.values(TRUTH).find(t => { const parts = t.name.split(" "); return parts.every(p => x.donorName.includes(p)); });
    const truthLabel = truthHit
      ? (truthHit.drift === "high" ? `truth: SHOULD drift (${truthHit.driftKind})`
        : truthHit.drift === "none" ? `truth: should NOT drift (${truthHit.lapsed ? "lapsed" : truthHit.driftKind})`
        : truthHit.drift === "medium_at_most" ? "truth: MEDIUM at most (erratic)"
        : "truth: (no drift call)")
      : "truth: filler donor (no entry)";
    lines.push(`- **${x.donorName}** [${x.confidence}] — "${x.reason}" · ${truthLabel}`);
  }
  fs.writeFileSync(OUT + "/drift-sentences.md", lines.join("\n") + "\n");
  const wrongHigh = dlist.filter(x => {
    const t = Object.values(TRUTH).find(t2 => t2.name.split(" ").every(p => x.donorName.includes(p)));
    return t && (t.drift === "none" || t.drift === "medium_at_most") && x.confidence === "high" && !t.deceased && !t.doNotSolicit;
  });
  ok("no truth-says-not / truth-says-medium donor carries a HIGH drift call", wrongHigh.length === 0, wrongHigh.map(x => x.donorName));

  const sm = await j("/metrics/stewardship-summary");
  ok("retention carries NO sector average anywhere", sm?.retentionRate && sm.retentionRate.sectorAverage === undefined, sm?.retentionRate && Object.keys(sm.retentionRate));

  // ── donors list + home, both widths ──────────────────────────────────────
  await page.goto(APP + "/donors", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Donors")').catch(() => {});
  await page.waitForTimeout(2500);
  await shoot(page, "03-donorlist");
  await page.goto(APP + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  body = await page.innerText("body");
  ok("home shows no sector-average sentence", !/sector average/i.test(body), null);
  ok("institutional-giving block renders with grant-cycle language", /institutional giving/i.test(body) && /Grant cycles run on their own calendars/.test(body));
  await shoot(page, "04-home");

  // ── export still green ───────────────────────────────────────────────────
  const ex = await fetch(API + "/donors/export/csv", { headers: { Authorization: "Bearer " + token } });
  ok("GET /donors/export/csv → 200 on the imported org", ex.status === 200, ex.status);

  console.log(`\nbuild80-capture: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"} — screenshots + drift-sentences.md in docs/build80/`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})();

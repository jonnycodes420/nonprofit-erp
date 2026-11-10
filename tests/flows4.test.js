// tests/flows4.test.js: FLOWS-4. SEARCH, JOURNEY DAYS, RE-ENGAGE, MERGE, THE
// GIVING-LEVEL TAG, THE NOTES BANNER AND THE TRASH DO THE RIGHT THING.
// Guards donor data: the QA fleet (9 Nov 2026) pressed Enter on "Jonathan A"
// and opened Jonathan Atkinson, read "Day 2" beside Dec 3, saw Re-engage drop
// the Directory's filters, kept the wrong record in a merge, read a stale
// "Mid-level" tag, read "hasn't given yet" above $36,750 of gifts, and could
// not find the Trash.
//
// API leg:
//   §1 search ranks the exact full name first, then starts-with, then
//      contains, ties by recent activity (W-1109-Volunteers-27)
//   §2 "Day N" is dated start + (N-1) days (W-1109-Fundraising-24X)
//   §4 the compare keeps the record it was started from (W-1109-Donors-44X)
// Browser leg (real clicks on the built client):
//   §1 Enter opens the exact match; the two "Jonathan A" rows carry a type chip
//   §2 the journey builder's step label and its date agree
//   §3 Re-engage carries the Directory's filters, with "Filtered: 3 filters"
//      and Clear (W-1109-Donors-18X)
//   §4 More → Merge with… from B, pick A: "Keeping B, folding in A"
//   §5 the level tag follows Settings → Giving levels after a save and a save
//      back (W-1109-Atlas-11X)
//   §6 the Notes banner says what she has given; the stored note is dated
//      (W-1109-Atlas-02X)
//   §7 Settings → Trash (n), and the links to it from the Donors list and
//      Your Data (W-1107-Finance-35)
//
// The volunteer and event half (tests/lib/flows4Volunteers.js) runs at the end.
//
// Planted defects (FLOWS-4 report): search ranked by recency first turns §1
// red; hours counted per program row turns the volunteer half red.
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays, browserLegOrSkip, SINK_PORT } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_flows4";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

const sink = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"re_sink"}'); }); });

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Flows Four Larkspur Trust',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`UPDATE orgs SET onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ines Larkin','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, { types = "donor", city = null, state = null, notes = null, created = null } = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,city,state,notes,assigned_to,assigned_to_name,created_by,created_by_name,created_at)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5::jsonb,$6,$7,$8,$9,'Ines Larkin','system:test/flows4','FLOWS-4 test',COALESCE($10::timestamptz,NOW()))`,
  [P(id), ORG, name, `${id}@flows4.example.org`, JSON.stringify([types]), city, state, notes, ME, created]);

const runVolunteers = () => {
  let half; try { half = require("./lib/flows4Volunteers"); } catch { return Promise.resolve(); }
  return half().catch(e => ok("volunteer half ran to its end", false, String((e && e.message) || e)));
};

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r));
  const tok = await freshOrg();
  const gift = async (who, back, amt) => {
    const g = await api("POST", `/donors/${P(who)}/gifts`, tok, { amount: amt, date: civilPlusDays(-back), type: "cash" });
    if (g.status >= 300) ok(`fixture gift for ${who} -${back}`, false, g.body);
  };

  // ── §1 · SEARCH RANKS THE EXACT NAME FIRST ─────────────────────────────────
  // Atkinson gave most and most recently; recency-first or giving-first puts
  // him on top. The two "Jonathan A" records are the exact match.
  await person("jatk", "Jonathan Atkinson");
  await person("ja1", "Jonathan A");
  await person("ja2", "Jonathan A", { types: "contact" });
  await person("mjon", "Mary Jonathan Abel");
  await gift("jatk", 2, 5000); await gift("ja1", 300, 40); await gift("mjon", 1, 20);
  const s1 = await api("GET", "/search?q=" + encodeURIComponent("Jonathan A"), tok);
  const people = ((s1.body && s1.body.results) || []).filter(r => r.kind === "person").map(r => r.id);
  ok("§1 search \"Jonathan A\": both exact matches first (the one with recent activity first), then starts-with, then contains",
    JSON.stringify(people) === JSON.stringify([P("ja1"), P("ja2"), P("jatk"), P("mjon")]), people);

  // ── §2 · DAY N IS START + (N-1) ────────────────────────────────────────────
  const anchor = civilPlusDays(23);
  const step = (label, offsetDays) => ({ type: "follow_up", label, offsetDays });
  const jDate = await api("POST", "/journeys", tok, { name: "Larkspur letter day", trigger: "yearly_date", enabled: true,
    triggerFilters: { month: +anchor.slice(5, 7), day: +anchor.slice(8, 10), who: "everyone" }, steps: [step("Letter day: call", 0), step("Letter day: note", 2)] });
  const JS = await import("../shared/journeyShape.js");
  const pv = await api("GET", `/journeys/${jDate.body.id}/preview`, tok);
  const due2 = pv.body && pv.body.steps && pv.body.steps[1] && String(pv.body.steps[1].dueDate || "").slice(0, 10);
  const label2 = JS.timingWord({ from: "trigger", value: 2, unit: "days" }, 2);
  const n2 = Number((label2.match(/^Day (\d+)$/) || [])[1]);
  ok("§2 a step two days after the start is labelled with the day its date falls on (Day N = start + N-1)",
    !!due2 && n2 > 0 && JS.dayOfJourney && JS.dayOfJourney(anchor, n2) === due2 && due2 === civilPlusDays(25),
    { label2, due2, anchor, helper: typeof JS.dayOfJourney });

  // ── §3 · RE-ENGAGE FIXTURE ─────────────────────────────────────────────────
  for (const [id, name, city, state] of [["ely1", "Petra Vance", "Ely", "NC"], ["ely2", "Quentin Rowe", "Ely", "NC"], ["bos", "Sabine Holt", "Boston", "MA"]]) {
    await person(id, name, { city, state });
    await gift(id, 500, 75); await gift(id, 420, 75);
  }

  // ── §4 · MERGE KEEPS THE RECORD YOU STARTED FROM ───────────────────────────
  await person("mA", "Hollis Brandt");                     // A: more gifts, so the old default kept A
  await person("mB", "Hollis Brandt", { types: "donor" }); // B: where she started
  await q(`UPDATE donors SET email='hollis.b@flows4.example.org' WHERE id=$1`, [P("mB")]);
  await gift("mA", 40, 50); await gift("mA", 20, 50); await gift("mB", 10, 25);
  const pair = await api("GET", `/data-health/pair?a=${P("mB")}&b=${P("mA")}&keep=${P("mB")}`, tok);
  ok("§4 the compare started from B keeps B", pair.status === 200 && pair.body.keptId === P("mB"), { status: pair.status, kept: pair.body && pair.body.keptId });

  // ── §5 · THE LEVEL TAG ─────────────────────────────────────────────────────
  await person("wend", "Wendell Ashby");
  await gift("wend", 30, 2000);   // $2,000 in the last 12 months: Mid at $1,000 / $10,000

  // ── §6 · THE NOTES BANNER ──────────────────────────────────────────────────
  await person("renee", "Renee Okonjo", { notes: "Researching giving capacity. Attended an info session, hasn't given yet.", created: "2025-03-14T15:00:00Z" });
  await q(`UPDATE donors SET notes_at='2025-03-14T15:00:00Z' WHERE id=$1`, [P("renee")]).catch(() => {});
  for (const [back, amt] of [[200, 20000], [90, 16750]]) await gift("renee", back, amt);

  // ── §7 · THE TRASH ─────────────────────────────────────────────────────────
  for (const id of ["t1", "t2", "t3"]) { await person(id, "Trashed " + id.toUpperCase()); await api("DELETE", `/donors/${P(id)}`, tok); }
  const tr = await api("GET", "/trash/people?limit=1", tok);
  ok("§7 fixture: three people are in the trash", tr.status === 200 && tr.body.inTrash === 3, tr.body);

  const why = (() => {
    if (!optional(PW)) return "(playwright is not installed at " + PW + ")";
    if (!fs.existsSync(path.join(DIST, "index.html")) && !fs.existsSync(path.join(DIST, "app.html"))) return "(no client dist at " + DIST + ")";
    return null;
  })();
  if (browserLegOrSkip(why, "(browser leg)")) { await runVolunteers(); sink.close(); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const open = async url => { await page.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const text1 = async sel => ((await page.locator(sel).first().textContent({ timeout: 8000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const shot = async name => { if (process.env.FLOWS4_SHOTS) await page.screenshot({ path: path.join(process.env.FLOWS4_SHOTS, name + ".png") }).catch(() => {}); };
  const profileHead = async (id) => { await open(`/donors/${id}`); await page.locator('[data-testid="dp-head"]').first().waitFor({ timeout: 30000 }).catch(() => shot("no-head-" + id)); };
  const levelTag = async () => { await page.waitForTimeout(800); return (await page.locator('[data-testid="dp-head-tags"]').first().innerText({ timeout: 8000 }).catch(() => "")).replace(/\s+/g, " "); };

  try {
    // §1 · Enter opens the exact match; the same-name rows say which is which
    await open(`/home`);
    const box = page.locator('input[placeholder^="Search people"]').first();
    await box.click();
    await box.fill("Jonathan A");
    await page.locator('[data-testid="search-type-chip"], [data-testid="search-result"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    const chips = await page.locator('[data-testid="search-type-chip"]').allInnerTexts().catch(() => []);
    await shot("s1-search");
    await box.press("Enter");
    await page.waitForURL(u => /\/donors\//.test(String(u)), { timeout: 15000 }).catch(() => {});
    ok("§1 browser: Enter on \"Jonathan A\" opens the exact match, not Jonathan Atkinson", page.url().includes(`/donors/${P("ja1")}`), page.url());
    ok("§1 browser: the two \"Jonathan A\" rows carry a type chip, Donor and Contact",
      chips.length === 2 && chips.some(t => /^Donor$/.test(t.trim())) && chips.some(t => /^Contact$/.test(t.trim())), chips);

    // §2 · the builder's label and date agree
    await open(`/app/journeys?journey=${jDate.body.id}`);
    await page.locator('[data-testid="jb-node-1"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    const aria = (await page.locator('[data-testid="jb-node-1"]').first().getAttribute("aria-label").catch(() => "")) || "";
    const chainDate = await page.locator('[data-testid="jb-spine"]').first().innerText().catch(() => "");
    await shot("s2-builder");
    const dn = Number((aria.match(/Day (\d+)/) || [])[1]);
    ok(`§2 browser: the second step reads "Day ${dn || "?"}" and is dated ${day(civilPlusDays(25))}, start + (N-1)`,
      dn === 3 && chainDate.includes(day(civilPlusDays(25))), { aria, chainDate: chainDate.replace(/\s+/g, " ").slice(0, 200) });

    // §3 · Re-engage carries the Directory's filters
    const where = encodeURIComponent(JSON.stringify({ join: "and", conditions: [{ field: "city", op: "is", value: "Ely" }, { field: "state", op: "is", value: "NC" }] }));
    await open(`/donors?view=reengage&owner=${ME}&where=${where}`);
    await page.locator('text=Petra Vance').first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const reText = await page.locator("body").first().innerText().catch(() => "");
    const chip = await text1('[data-testid="reengage-filtered"]');
    await shot("s3-reengage");
    ok("§3 browser: Re-engage with the Directory's filters in the address shows the two Ely people, not Sabine in Boston",
      /Petra Vance/.test(reText) && /Quentin Rowe/.test(reText) && !/Sabine Holt/.test(reText), { has: ["Petra Vance", "Quentin Rowe", "Sabine Holt"].map(n => [n, reText.includes(n)]) });
    ok("§3 browser: the chip reads \"Filtered: 3 filters\" with Clear", /^Filtered: 3 filters/.test(chip) && /Clear/.test(chip), { chip });
    if (chip) {
      await page.locator('[data-testid="reengage-filtered-clear"]').first().click();
      await page.locator('text=Sabine Holt').first().waitFor({ timeout: 15000 }).catch(() => {});
      const after = await page.locator("body").first().innerText().catch(() => "");
      ok("§3 browser: Clear shows everyone Re-engage names again", /Sabine Holt/.test(after) && !/Filtered:/.test(after), {});
    }

    // §4 · merge from B
    await profileHead(P("mB"));
    await page.locator("#dp-more-btn").first().click();
    await page.locator('[data-testid="dp-merge-with"]').first().click();
    await page.fill('[data-testid="mw-search"]', "Hollis");
    await page.locator('[data-testid="mw-pick"]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-testid="mw-pick"]').first().click();
    await page.locator('[data-testid="dh-merge-confirm"]').first().waitFor({ timeout: 15000 });
    const head = await text1('[data-testid="merge-headline"]');
    const sentence = await text1('[data-testid="merge-sentence"]');
    await shot("s4-merge");
    ok("§4 browser: started from B, the compare keeps B and folds in A, and the swap link is there",
      sentence.includes(`is merged into Hollis Brandt (${P("mB")})`) && /^Keeping Hollis Brandt/.test(head) && /folding in Hollis Brandt/.test(head)
        && (await page.locator('text=Keep the other record instead').count()) === 1, { head, sentence });
    await page.keyboard.press("Escape");

    // §5 · the level tag follows the setting, both ways
    await profileHead(P("wend"));
    const t0 = await levelTag();
    const saveLevels = async (mid, major) => {
      await open(`/app/settings?section=giving`);
      await page.locator('[aria-label="Mid starts at"]').first().waitFor({ timeout: 20000 });
      await page.fill('[aria-label="Mid starts at"]', String(mid));
      await page.fill('[aria-label="Major starts at"]', String(major));
      await page.locator('[data-testid="settings-giving-levels"] button:has-text("Save")').first().click();
      await page.locator('[data-testid="settings-giving-levels"] :text("Saved.")').first().waitFor({ timeout: 10000 }).catch(() => {});
    };
    // What Atlas and the Major rung read: the stored Insights (TEST_MODE reads wait for a queued build).
    const rung = async () => { const r = await api("GET", `/insights/donor/${P("wend")}`, tok); return (JSON.stringify(r.body || {}).match(/"rung":"(\w+)"/) || [])[1] || null; };
    const r0 = await rung();
    await saveLevels(1500, 1800);   // $2,000 is Major now
    await profileHead(P("wend"));
    const t1 = await levelTag();
    const r1 = await rung();
    await saveLevels(5000, 20000);  // General
    await profileHead(P("wend"));
    const t2 = await levelTag();
    const r2 = await rung();
    await saveLevels(1000, 10000);  // back: Mid
    await profileHead(P("wend"));
    const t3 = await levelTag();
    await shot("s5-level");
    ok("§5 browser: Wendell's tag follows each save (Mid, Major, General, Mid)",
      /Mid-level donor/.test(t0) && /Major donor/.test(t1) && !/Mid-level|Major/.test(t2) && /Mid-level donor/.test(t3), { t0, t1, t2, t3 });
    ok("§5 the stored Insights (Atlas, the Major rung) follow each save too: not Major, Major, not Major",
      !!r0 && r0 !== "major" && r1 === "major" && !!r2 && r2 !== "major", { r0, r1, r2 });

    // §6 · the Notes banner
    await profileHead(P("renee"));
    await page.locator('[role="tab"]:has-text("Notes"), button:has-text("Notes")').first().click();
    await page.locator('[data-testid="dp-record-notes"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    const banner = await text1('[data-testid="dp-record-notes"]');
    await shot("s6-notes");
    ok("§6 browser: the Notes banner says what Renee has given ($36,750), and her stored note is dated \"Mar 2025 note:\"",
      /\$36,750/.test(banner) && /Mar 2025 note: Researching giving capacity/.test(banner) && !/^Researching/.test(banner), { banner });

    // §7 · the Trash has its own place
    await open(`/app/settings`);
    const tabTxt = await page.locator('.settings-tabbar').first().innerText().catch(() => "");
    ok("§7 browser: Settings has a Trash section with its count", /Trash \(3\)/.test(tabTxt), { tabTxt: tabTxt.replace(/\s+/g, " ") });
    await open(`/app/settings?section=trash`);
    await page.locator('[data-testid="trash-row"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    ok("§7 browser: Settings → Trash lists them and holds Empty trash", (await page.locator('[data-testid="trash-row"]').count()) === 3 && (await page.locator('[data-testid="empty-trash"]').count()) === 1, {});
    await open(`/app/settings?section=imports`);
    await page.waitForTimeout(800);
    ok("§7 browser: Imports links to the Trash and no longer holds it",
      (await page.locator('[data-testid="trash-link"]').count()) >= 1 && (await page.locator('[data-testid="trash-list"]').count()) === 0, {});
    await open(`/app/settings?section=data`);
    const dataLink = await text1('[data-testid="trash-link"]');
    ok("§7 browser: Your Data links to the Trash with its count", /Trash \(3\)/.test(dataLink), { dataLink });
    await open(`/donors`);
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 }).catch(() => {});
    const foot = await text1('[data-testid="trash-link"]');
    ok("§7 browser: the foot of the Donors list links to Trash (3)", /Trash \(3\)/.test(foot), { foot });
    if (foot) {
      await page.locator('[data-testid="trash-link"]').first().click();
      await page.locator('[data-testid="trash-row"]').first().waitFor({ timeout: 15000 }).catch(() => {});
      ok("§7 browser: the link opens Settings → Trash", (await page.locator('[data-testid="trash-row"]').count()) === 3, page.url());
    }
    await open(`/home`);
    const box2 = page.locator('input[placeholder^="Search people"]').first();
    const found = [];
    for (const w of ["trash", "deleted", "restore"]) {
      await box2.click(); await box2.fill(w); await page.waitForTimeout(900);
      found.push([w, (await page.locator('[data-testid="search-result"]:has-text("Trash")').count()) > 0]);
    }
    ok("§7 browser: searching for trash, deleted or restore finds the Trash", found.every(([, f]) => f), found);
  } finally {
    await browser.close();
  }
  await runVolunteers();
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); sink.close(); await closeDb().catch(() => {}); process.exit(1); });

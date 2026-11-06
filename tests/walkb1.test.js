// tests/walkb1.test.js: WALKB-1. WHAT A STRANGER WOULD NOTICE.
// Guards donor data and what reaches a donor: Muse's Walk B (5 Nov 2026) found
// a live giving page reading Steward's own prompt ("Write two or three
// sentences here…") and a placeholder EIN, a form step promising to save an
// email it only kept as a started gift, "1 students", lists that went stale
// after a change, and a name on Home that the Donors search could not find.
//
//   §1 a campaign template's story publishes without its hint; a page whose
//      story and blocks still hold a hint publishes without them; the editor's
//      preview still names the hint.
//   §2 a placeholder EIN (47-1234567) is off the giving page, the org's page
//      and a receipt; a real EIN is on all three.
//   §3 step 2's sentence matches what continuing does: a started gift is kept,
//      no person record is made.
//   §4 "1 student" (shared/countWords.js impactSentence, the Settings example).
//   §5 a search result says why it matched, names first; a person Home names
//      (archived, and an organization) is found by the Donors search.
//   §6 Brand kit: with no signer saved, the signed-in person's name; saved, says so.
//   §7 the browser: hours logged by Atlas move the Volunteers header and Recent
//      shifts, and a group removed elsewhere leaves the Groups list, with no reload.
//
// Proven able to fail: run against origin/main (its own server, database and
// client) 22 of these checks went red, one or more for every item; on this
// build all pass.
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_walkb1";
const SLUG = "walkb1-harbor";
const EMAIL = `${ORG}@test.local`;
const P = s => `${ORG}_${s}`;
const SYS = `'system:test/walkb1','WALKB-1 test'`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const HINT = /Write two or three sentences here|Say what this page is for, in your own words/;
// A module this build adds reads as {} before it (so a run against main says which checks fail).
const imp = async (...parts) => { try { return await import(path.join(__dirname, "..", ...parts)); } catch { return {}; } };
const call = (fn, ...a) => { try { return typeof fn === "function" ? fn(...a) : undefined; } catch { return undefined; } };

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_account_id,stripe_connected,
                             receipts_enabled,legal_name,ein,receipt_address)
           VALUES ($1,'Lanternmoor Harbor Trust',$2,1,'active','team','America/New_York','acct_walkb1',true,
                   true,'Lanternmoor Harbor Trust, Inc.','47-1234567','4 Quay Lane, Salem, MA 01970')`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,sign_title) VALUES ($1,$2,$3,$4,'Odile Farrant','admin','Executive Director')`,
    ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, f = {}) => q(
  `INSERT INTO donors (id,org_id,name,email,stage,status,person_types,household_id,archived_at,kind,created_by,created_by_name)
   VALUES ($1,$2,$3,$4,'cultivate','active',$5::jsonb,$6,$7,$8,${SYS})`,
  [P(id), ORG, name, f.email === undefined ? `${id}@walkb1.example.org` : f.email, JSON.stringify(f.types || ["donor"]), f.household || null,
   f.archived ? civilPlusDays(0) : null, f.kind || null]);

(async () => {
  const tok = await freshOrg();
  ok("§0 signed in", !!tok);

  // ── §1 a hint is never published ─────────────────────────────────────────
  const made = await api("POST", "/campaigns/from-template", tok, { template: "yearend" });
  ok("§1 the year-end template stands up its page", made.status === 201 && made.body.slug, made.body);
  const pub = await api("GET", `/org/${SLUG}/giving-page/${made.body.slug}/public`, null);
  ok("§1 the template's public page carries no hint", pub.status === 200 && !HINT.test(JSON.stringify(pub.body)), (JSON.stringify(pub.body).match(/.{40}Write two or three.{40}/) || [])[0]);
  ok("§1 …and keeps its own words", /last chance to give/.test(JSON.stringify(pub.body)));
  const [tp] = await q(`SELECT story, published FROM giving_pages WHERE org_id=$1 AND id=$2`, [ORG, made.body.pageId]);
  ok("§1 the hint is not saved as the page's words", !HINT.test(tp.story) && !HINT.test(JSON.stringify((tp.published || []).map(w => w.blocks || []))), tp.story);

  // A page from before this build: the hint saved in its story and as a block of its own.
  const legacy = [{ id: "wid_0000000a", type: "hero", heading: "Spring on the water", sub: "", image: null, size: "standard" },
    { id: "wid_0000000b", type: "richtext", blocks: [{ type: "p", text: "Say what this page is for, in your own words." }] },
    { id: "wid_0000000c", type: "richtext", blocks: [{ type: "p", text: "Forty children learned to row this year." },
      { type: "p", text: "Write two or three sentences here about what this year made possible and what next year needs." }] }];
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,story,status,published,draft,created_by,created_by_name)
           VALUES ($1,$2,'spring-row','Spring on the water',$3,'active',$4::jsonb,$4::jsonb,${SYS})`,
    [P("gp_old"), ORG, "Forty children learned to row this year.\n\nWrite two or three sentences here about what this year's gifts will pay for.", JSON.stringify(legacy)]);
  const old = await api("GET", `/org/${SLUG}/giving-page/spring-row/public`, null);
  const oldStory = old.body && old.body.givingPage ? old.body.givingPage.story : null;
  ok("§1 a story still holding the hint publishes without that paragraph", oldStory === "Forty children learned to row this year.", oldStory);
  const blocks = ((old.body && old.body.givingPage && old.body.givingPage.page) || []).filter(w => w.type === "richtext");
  ok("§1 a block that is only the hint is left off; the other keeps its real words", blocks.length === 1 && blocks[0].blocks.length === 1 && /Forty children/.test(blocks[0].blocks[0].text), blocks);
  const pv = await api("GET", `/giving-pages/${P("gp_old")}/page/preview`, tok);
  ok("§1 the editor's preview names what is still a hint", pv.status === 200 && Array.isArray(pv.body.hintsLeft) && pv.body.hintsLeft.length === 3, pv.body.hintsLeft);

  // ── §2 a placeholder EIN never reaches a stranger ───────────────────────
  const PH = await imp("shared", "placeholderCopy.js");
  ok("§2 the placeholder shapes are caught, a real EIN is not", ["47-1234567", "12-3456789", "00-0000000", "99-9999999", "123456789"].every(e => call(PH.isPlaceholderEin, e) === true)
    && call(PH.isPlaceholderEin, "83-2741956") === false && call(PH.isPlaceholderEin, "") === false);
  const facts = b => (b && b.org && b.org.facts) || {};
  ok("§2 the giving page leaves the placeholder EIN off", facts(pub.body).ein === "", facts(pub.body));
  const orgPage = await api("GET", `/org/${SLUG}/public`, null);
  ok("§2 …and the org's own page", orgPage.status === 200 && facts(orgPage.body).ein === "", facts(orgPage.body));
  await person("rec", "Benedikt Ashlund", { email: null });
  const receiptEin = async gid => {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,250,$4,'cash',${SYS})`, [gid, ORG, P("rec"), civilPlusDays(-2)]);
    const r = await api("POST", `/gifts/${gid}/receipt`, tok, { send: false });
    const [row] = await q(`SELECT snapshot FROM receipts WHERE org_id=$1 AND gift_id=$2`, [ORG, gid]);
    return { status: r.status, ein: row ? (typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot).orgEin : undefined };
  };
  const r1 = await receiptEin(P("g1"));
  ok("§2 a receipt leaves the placeholder EIN off", r1.status < 300 && r1.ein === "", r1);
  await q(`UPDATE orgs SET ein='83-2741956' WHERE id=$1`, [ORG]);
  const r2 = await receiptEin(P("g2"));
  const pub2 = await api("GET", `/org/${SLUG}/giving-page/${made.body.slug}/public`, null);
  ok("§2 a real EIN is on the receipt and the page", r2.ein === "83-2741956" && facts(pub2.body).ein === "83-2741956", { r2, page: facts(pub2.body).ein });

  // ── §3 step 2 says what continuing does ─────────────────────────────────
  const GS = await imp("shared", "giftStartWords.js");
  const sentence = String(call(GS.emailStepSentence, "Lanternmoor Harbor Trust") || "");
  const src = f => fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", f), "utf8");
  ok("§3 both forms read the one sentence, and neither says the email is saved", ["GiveSteps.jsx", "Donate.jsx"].every(f => /emailStepSentence\(/.test(src(f)) && !/is saved when you/.test(src(f))));
  const start = await api("POST", `/give/${SLUG}/started`, null, { startToken: "walkb1start01", email: "pell.ostrander@walkb1.example.org", firstName: "Pell", lastName: "Ostrander", amount: 40, frequency: "once" });
  const [gsRow] = await q(`SELECT id FROM gift_starts WHERE org_id=$1 AND LOWER(email)='pell.ostrander@walkb1.example.org'`, [ORG]);
  const [made1] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND LOWER(email)='pell.ostrander@walkb1.example.org'`, [ORG]);
  ok("§3 continuing keeps a started gift and makes no person record, as the sentence says", start.status === 201 && !!gsRow && made1.n === 0
    && /started/.test(sentence) && /only when a gift goes through/.test(sentence), { status: start.status, start: !!gsRow, people: made1.n, sentence });

  // ── §4 plurals ──────────────────────────────────────────────────────────
  const IE = await imp("client", "src", "lib", "impactExample.js");
  const CW = await imp("shared", "countWords.js");
  ok("§4 \"1 student\", \"1 after-school arts workshop\"",
    IE.impactExample("Your ${amount} has provided art supplies kits for {n} students", 50) === "Your $50 has provided art supplies kits for 1 student"
    && IE.impactExample("Your ${amount} has funded {n} after-school arts workshops", 300) === "Your $300 has funded 1 after-school arts workshop",
    IE.impactExample("Your ${amount} has funded {n} after-school arts workshops", 300));
  ok("§4 …and more than one stays plural", call(CW.impactSentence, "{n} meals served", { n: 40, amount: 100 }) === "40 meals served");

  // ── §5 search explains itself and finds everyone Home names ────────────
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'The Marlowe Hart household',${SYS})`, [P("hh"), ORG]);
  await person("hm", "Harriet Marlowe");
  await person("ic", "Ines Colebrook", { email: "ines.marlowe@walkb1.example.org" });
  await person("tf", "Tobias Fenwright", { household: P("hh") });
  const list = (await api("GET", "/donors?limit=50&offset=0&role=auto&search=Marlowe", tok)).body;
  const why = id => ((list.donors || []).find(d => d.id === P(id)) || {}).match_why;
  ok("§5 each result says why it matched", why("hm") === "name" && why("ic") === "email: ines.marlowe@walkb1.example.org" && why("tf") === "household: The Marlowe Hart household",
    (list.donors || []).map(d => [d.name, d.match_why]));
  ok("§5 a name match ranks first", (list.donors || [])[0] && list.donors[0].id === P("hm"), (list.donors || []).map(d => d.name));
  const top = (await api("GET", "/search?q=Marlowe", tok)).body;
  const tWhy = id => ((top.results || []).find(r => r.kind === "person" && r.id === P(id)) || {}).why;
  ok("§5 the top bar says why too", tWhy("hm") === "name" && /^household: /.test(tWhy("tf") || ""), (top.results || []).filter(r => r.kind === "person").map(r => [r.title, r.why]));

  // Home names a person who drifted: $1,500 every four months for two years,
  // and nothing for the last two hundred days. One is archived (THREAD-3: still
  // counted where money is), one is an organization.
  const days = [-200, -320, -440, -560, -680, -800];
  for (const [id, name, f] of [["qw", "Qadir Whitcombe", { archived: true }], ["ot", "Orrin Tidewell Foundation", { kind: "organization" }]]) {
    await person(id, name, f);
    for (const [k, d] of days.entries()) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,1500,$4,'cash',${SYS})`,
      [P(`${id}_g${k}`), ORG, P(id), civilPlusDays(d)]);
    await q(`UPDATE donors SET total_giving=9000, gift_count=6, last_gift_date=$2, last_gift_amount=1500, first_gift_date=$3 WHERE id=$1`, [P(id), civilPlusDays(-200), civilPlusDays(-800)]);
  }
  const drift = (await api("GET", "/drift?all=1&includeMedium=1", tok)).body;
  const homeNames = new Map();
  (function walk(o) { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk);
    if (o.donorId && o.donorName) homeNames.set(o.donorId, o.donorName); Object.values(o).forEach(walk); })(drift);
  ok("§5 Home names the archived person who drifted", homeNames.has(P("qw")), [...homeNames.values()]);
  const notFound = [];
  for (const [id, name] of homeNames) {
    const r = (await api("GET", `/donors?limit=50&offset=0&role=auto&search=${encodeURIComponent(name)}`, tok)).body;
    if (!(r.donors || []).some(d => d.id === id)) notFound.push(name);
  }
  ok("§5 every name Home shows is found by the Donors search", homeNames.size > 0 && notFound.length === 0, notFound);
  const found = (await api("GET", `/donors?limit=50&offset=0&role=auto&search=Qadir`, tok)).body;
  const qd = (found.donors || []).find(d => d.id === P("qw"));
  ok("§5 …and an archived person found by search says so", qd && qd.archived === true, qd && { archived: qd.archived });
  const orgFound = (await api("GET", `/donors?limit=50&offset=0&role=auto&search=Tidewell`, tok)).body;
  ok("§5 an organization is found by the Donors search", (orgFound.donors || []).some(d => d.id === P("ot")), (orgFound.donors || []).map(d => d.name));

  // ── §6 the signer is the person signed in until one is saved ────────────
  const kit = (await api("GET", "/brand-kit", tok)).body;
  ok("§6 with no signer saved, Brand kit offers the signed-in person's name and title", kit.signatureSaved === false && kit.signatureDefault
    && kit.signatureDefault.name === "Odile Farrant" && kit.signatureDefault.title === "Executive Director", { saved: kit.signatureSaved, d: kit.signatureDefault });
  const saved = (await api("PUT", "/brand-kit", tok, { signatureName: "Odile Farrant", signatureTitle: "Executive Director" })).body;
  ok("§6 a saved signer says it is saved", saved.signatureSaved === true && saved.signatureName === "Odile Farrant", saved.signatureSaved);

  // ── §7 the browser: lists move after a change made elsewhere ────────────
  const why7 = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why7, "(browser leg)")) {
    await person("va", "Wren Halloway", { types: ["volunteer"] });
    await person("vb", "Sol Merriden", { types: ["volunteer"] });
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,via,created_by,created_by_name) VALUES ($1,$2,$3,$4,2,'Boat crew','staff',${SYS})`,
      [P("sh1"), ORG, P("va"), civilPlusDays(-6)]).catch(e => ok("§7 a shift on file", false, e.message));
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", msg => { if (msg.type() === "error" && !NOISE.test((msg.location() || {}).url || "") && !/Download the React DevTools|404 \(Not Found\)/.test(msg.text())) errors.push(msg.text()); });
    page.on("response", r => { if (r.status() >= 500 && !NOISE.test(r.url())) errors.push(r.status() + " " + r.url()); });
    await page.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    // Atlas logs hours on the server, then tells the page (AtlasNote: told()).
    const atlasDid = async (fn) => { await fn(); await page.evaluate(() => window.dispatchEvent(new CustomEvent("steward:told", { detail: {} }))); };
    await page.goto(`${APP}/app/volunteers`, { waitUntil: "networkidle", timeout: 60000 });
    const hub = page.locator('[data-testid="volunteers-hub"]');
    await hub.waitFor({ timeout: 20000 }).catch(() => {});
    await page.getByRole("tab", { name: /Records/ }).first().click().catch(() => {});
    await page.locator('[data-testid="vol-shift-row"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    const header = async () => (await hub.innerText().catch(() => "")).match(/[\d.,]+ hours? given so far/) || [""];
    const h0 = (await header())[0];
    await atlasDid(() => api("POST", `/donors/${P("vb")}/volunteer-hours`, tok, { date: civilPlusDays(-1), hours: "5", role: "Dock" }));
    await page.waitForFunction(() => /Sol Merriden/.test((document.querySelector('[data-testid="vol-shift-row"]') || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const top1 = (await page.locator('[data-testid="vol-shift-row"]').first().textContent().catch(() => "")) || "";
    ok("§7 Recent shifts shows the hours Atlas logged, with no reload", /Sol Merriden/.test(top1) && /5 h/.test(top1), top1);
    await page.waitForFunction(([was]) => { const m = (document.querySelector('[data-testid="volunteers-hub"]') || {}).innerText || ""; const n = (m.match(/[\d.,]+ hours? given so far/) || [""])[0]; return n && n !== was; }, [h0], { timeout: 15000 }).catch(() => {});
    const h1 = (await header())[0];
    ok("§7 …and the Volunteers header moves from 2 hours to 7", /^(2|two) hours/i.test(h0) && /^(7|seven) hours/i.test(h1), { before: h0, after: h1 });

    const g = (await api("POST", "/groups", tok, { name: "Boat crew families", kind: "static" })).body;
    await page.goto(`${APP}/app/groups`, { waitUntil: "networkidle", timeout: 60000 });
    const card = page.locator('[data-testid="group-card"]', { hasText: "Boat crew families" });
    await card.first().waitFor({ timeout: 15000 }).catch(() => {});
    const c0 = await card.count();
    await atlasDid(() => api("POST", `/removals/group/${encodeURIComponent(g.id)}`, tok, {}));
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="group-card"]')].some(e => /Boat crew families/.test(e.textContent)), null, { timeout: 15000 }).catch(() => {});
    const c1 = await card.count();
    ok("§7 a group removed elsewhere leaves the Groups list, with no reload", c0 === 1 && c1 === 0, { before: c0, after: c1 });
    ok("§7 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

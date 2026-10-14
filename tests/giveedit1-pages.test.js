// GIVE-EDIT-1 — THE ONE TEST. Every giving page is edited in one place, and an
// edit never reaches a donor until somebody publishes it.
//
// It earns its place under CLAUDE.md's one-test rule because a giving page is
// the most donor-facing thing Steward makes, and it guards donor data and
// money: a draft that leaked onto the live page would put half-typed words and
// amounts in front of a stranger holding a card, and an editor that touched a
// Stripe or receipt setting would move money nobody agreed to move.
//
// ── WHAT WOULD MAKE IT FAIL (the guard-must-be-able-to-fail rule) ──────────
//   1. Write the settings straight to the live columns on save → §2 goes red
//      (the public page shows the draft headline and amounts before publish).
//   2. Let publish regenerate the slug from the new headline → §3 goes red.
//   3. Stamp a version without its actor → §4 goes red ("who published").
//   4. Restore only the widgets and not the page's own fields → §5 goes red.
//   5. Let any edit write to orgs (fees, Stripe account, receipts) → §9 red.
//   6. Put /volunteer/join sign-ups back on the roster → §10 goes red.
//   7. Lower-case the first word of "Meridian Foundation" → §11 goes red.
// 1, 2, 4 and 6 were planted and watched go red before this suite was trusted.
// On main the whole suite is red: the routes and the fields do not exist.
//
// Runs against the scratch server + scratch Postgres, never production.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");

const ORG = "org_ge1pages", SLUG = "ge1-harbor-test";
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");

async function reset() {
  const CHILD = ["giving_page_versions", "volunteer_applications", "volunteer_page_signups", "gift_soft_credits", "p2p_teams",
    "peer_fundraisers", "form_events", "giving_pages", "portal_settings", "fin_audit_log", "fin_transactions", "gifts", "asset_pointer_history"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,
                             stripe_account_id,stripe_connected,cover_fees_enabled)
           VALUES ($1,'Harbor Pages Trust',$2,1,'active','growth','America/New_York','acct_ge1test',true,true)`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Edit Admin','admin')`,
    ["u_ge1pages", ORG, "ge1pages@example.org", bcrypt.hashSync("demo1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_ge1gen',$1,'General Operating',false), ('ff_ge1sch',$1,'Scholarships',true)`, [ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype) VALUES ('acc_ge1',$1,'4010','Individual Contributions','revenue','contributions')`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,created_by,created_by_name) VALUES ('camp_ge1',$1,'Spring Paddle',20000,'system:test','Test')`, [ORG]).catch(e => console.log("campaign insert:", e.message));
  // Two pages as they exist today: an unbuilt one with no form set up (the
  // original one-step form) and one already built with blocks.
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,story,status,created_by,created_by_name)
           VALUES ('gp_ge1plain',$1,'spring-paddle','Spring Paddle',5000,'Paddle the bay with us.','active','system:test','Test')`, [ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,story,status,draft,published,published_at,created_by,created_by_name)
           VALUES ('gp_ge1built',$1,'year-end','Year-end',' ','active',$2::jsonb,$2::jsonb,NOW(),'system:test','Test')`,
    [ORG, JSON.stringify([{ id: "wid_ge1hero1", type: "hero", heading: "Close the year with us", sub: "", image: null, size: "standard" }])]);
}

// Everything on the org row that decides how money moves: the Stripe account,
// fees and receipts. No page edit may change any of it.
async function moneyRow() {
  const [o] = await q(`SELECT * FROM orgs WHERE id=$1`, [ORG]);
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!/updated_at|last_|_seen|_at$/.test(k)) out[k] = v;
  return JSON.stringify(out);
}
const pub = slug => api("GET", `/org/${SLUG}/giving-page/${slug}/public`, null);

(async () => {
  await reset();
  const tok = (await api("POST", "/auth/login", null, { email: "ge1pages@example.org", password: "demo1234" })).body.token;
  ok("§0 signed in", !!tok);
  const money0 = await moneyRow();

  // §1 — the editor reads a giving page's own fields.
  const p0 = await api("GET", "/giving-pages/gp_ge1plain/page", tok);
  ok("§1 the editor reads the page's settings", p0.status === 200 && p0.body.settings && p0.body.settings.title === "Spring Paddle", p0.status);
  ok("§1 …with no draft waiting", p0.body.draftSettings === null, p0.body.draftSettings);
  ok("§1 …and the link it will keep", p0.body.publicUrl === `/give/${SLUG}/spring-paddle`, p0.body.publicUrl);

  // §2 — a draft does not reach the live page.
  const live0 = await pub("spring-paddle");
  const d = await api("PUT", "/giving-pages/gp_ge1plain/page/settings", tok,
    { settings: { title: "Paddle for a scholarship", story: "Twenty kids on the water this summer.", showGoal: false,
                  form: { amountsCents: [3000, 6000, 12000], defaultFrequency: "annual", offerAnnual: true, showCoverFee: false,
                          thankYou: { message: "Thank you, truly.", redirectUrl: "" } } } });
  ok("§2 the draft saves", d.status === 200 && d.body.draftSettings && d.body.draftSettings.title === "Paddle for a scholarship", d.body);
  const bad = await api("PUT", "/giving-pages/gp_ge1plain/page/settings", tok, { settings: { title: "", form: { amountsCents: [0] } } });
  ok("§2 a bad edit is refused, every field named", bad.status === 400 && Array.isArray(bad.body.errors) && bad.body.errors.length >= 2, bad.body);
  const live1 = await pub("spring-paddle");
  ok("§2 the live headline is unchanged by a draft", live1.body.givingPage.title === "Spring Paddle", live1.body.givingPage.title);
  ok("§2 the live form is unchanged by a draft (still the original form)", live1.body.givingPage.form.configured === false
     && JSON.stringify(live1.body.givingPage.form.amount) === JSON.stringify(live0.body.givingPage.form.amount), live1.body.givingPage.form.amount);
  ok("§2 the live goal bar is unchanged by a draft", live1.body.givingPage.showGoal === true, live1.body.givingPage.showGoal);
  const list1 = await api("GET", "/giving-pages", tok);
  const card1 = (list1.body || []).find(p => p.id === "gp_ge1plain");
  ok("§2 the card says a draft is waiting", card1 && card1.has_draft === true, card1 && card1.has_draft);
  ok("§2 the card's gifts and views open their rows", card1 && card1.gifts_source && card1.gifts_source.key === "page-gifts" && card1.views_source && card1.views_source.key === "page-views", card1);

  // §3 — publish makes it live and keeps the link.
  const pubd = await api("POST", "/giving-pages/gp_ge1plain/page/publish", tok, {});
  ok("§3 publish answers with the version it made", pubd.status === 200 && pubd.body.version && pubd.body.version.number >= 2, pubd.body);
  const live2 = await pub("spring-paddle");
  ok("§3 the same link serves the published page", live2.status === 200, live2.status);
  ok("§3 the headline is live", live2.body.givingPage.title === "Paddle for a scholarship", live2.body.givingPage.title);
  ok("§3 the amounts are live", JSON.stringify(live2.body.givingPage.form.amount.amountsCents) === "[3000,6000,12000]", live2.body.givingPage.form.amount);
  ok("§3 it opens on a yearly gift", live2.body.givingPage.form.amount.defaultFrequency === "annual" && live2.body.givingPage.form.amount.frequencies.includes("annual"), live2.body.givingPage.form.amount);
  ok("§3 the fee box and the goal bar are off", live2.body.givingPage.form.showCoverFee === false && live2.body.givingPage.showGoal === false, [live2.body.givingPage.form.showCoverFee, live2.body.givingPage.showGoal]);
  const [slugRow] = await q(`SELECT slug, draft_settings FROM giving_pages WHERE id='gp_ge1plain'`);
  ok("§3 the slug never changed", slugRow.slug === "spring-paddle", slugRow.slug);
  ok("§3 the draft is cleared once live", slugRow.draft_settings === null, slugRow.draft_settings);

  // §4 — history says who published, and keeps what was there before.
  const h = await api("GET", "/giving-pages/gp_ge1plain/page/history", tok);
  const vs = (h.body && h.body.versions) || [];
  ok("§4 two versions: what was there before, and this publish", vs.length === 2, vs);
  ok("§4 the newest says who published it", vs[0] && vs[0].byName === "Edit Admin", vs[0]);
  const [vrow] = await q(`SELECT created_by FROM giving_page_versions WHERE org_id=$1 AND page_id='gp_ge1plain' ORDER BY number DESC LIMIT 1`, [ORG]);
  ok("§4 the version row carries the actor", vrow && vrow.created_by === "u_ge1pages", vrow);

  // §5 — restore puts the earlier version back in one step.
  const base = vs.find(v => v.number === 1);
  const r = await api("POST", `/giving-pages/gp_ge1plain/page/history/${base && base.id}/restore`, tok, {});
  ok("§5 restore answers with a new version that names its source", r.status === 200 && r.body.version && r.body.version.restoredFrom === 1, r.body);
  const live3 = await pub("spring-paddle");
  ok("§5 the old headline is back", live3.body.givingPage.title === "Spring Paddle", live3.body.givingPage.title);
  ok("§5 the original one-step form is back", live3.body.givingPage.form.configured === false, live3.body.givingPage.form.configured);
  ok("§5 the goal bar is back", live3.body.givingPage.showGoal === true, live3.body.givingPage.showGoal);

  // §5b — a built page: blocks and fields publish together.
  await api("PUT", "/giving-pages/gp_ge1built/page/draft", tok, { widgets: [{ id: "wid_ge1hero1", type: "hero", heading: "Close the year strong", sub: "", image: null, size: "standard" }] });
  const builtLive = await pub("year-end");
  ok("§5b a block draft does not reach the live page", JSON.stringify(builtLive.body.givingPage.page).includes("Close the year with us") && !JSON.stringify(builtLive.body.givingPage.page).includes("strong"), builtLive.body.givingPage.page);
  await api("POST", "/giving-pages/gp_ge1built/page/publish", tok, {});
  const builtLive2 = await pub("year-end");
  ok("§5b publish makes the block live", JSON.stringify(builtLive2.body.givingPage.page).includes("Close the year strong"), builtLive2.body.givingPage.page);

  // §6 — a page from each template opens in the editor, in real words.
  const t = await api("GET", "/giving-page-templates", tok);
  const keys = ((t.body && t.body.templates) || []).map(x => x.key);
  ok("§6 five templates", ["givingtuesday", "yearend", "event", "tribute", "monthly"].every(k => keys.includes(k)), keys);
  for (const key of keys) {
    const made = await api("POST", "/giving-pages", tok, { template: key });
    const pg = made.body && made.body.id ? await api("GET", `/giving-pages/${made.body.id}/page`, tok) : { status: 0, body: {} };
    const st = pg.body.settings || {};
    ok(`§6 ${key}: opens in the editor with its own words`, made.status === 201 && pg.status === 200 && st.title && st.story.length > 40, { status: made.status, st });
    ok(`§6 ${key}: no placeholder text`, !/lorem|ipsum|placeholder|\[|\{\{/i.test(st.title + st.story + JSON.stringify(st.form.thankYou)), st);
    if (key === "monthly") ok("§6 monthly opens on a monthly gift", st.form.defaultFrequency === "monthly", st.form.defaultFrequency);
    if (key === "tribute") ok("§6 tribute asks who the gift honors", st.form.showTribute === true, st.form.showTribute);
  }

  // §7 — the org-wide donation form, the same way.
  const o0 = await api("GET", `/org/${SLUG}/public`, null);
  const ladder0 = o0.body.org && o0.body.org.theme && o0.body.org.theme.onetimeAmounts;
  const od = await api("PUT", "/org-form/page/settings", tok, { settings: { onetimeAmounts: [20, 40, 80, 160] } });
  ok("§7 the donation form's draft saves", od.status === 200, od.body);
  const o1 = await api("GET", `/org/${SLUG}/public`, null);
  ok("§7 the draft does not reach /give", JSON.stringify(o1.body.org.theme.onetimeAmounts) === JSON.stringify(ladder0), o1.body.org.theme.onetimeAmounts);
  const op = await api("POST", "/org-form/page/publish", tok, {});
  const o2 = await api("GET", `/org/${SLUG}/public`, null);
  ok("§7 publish makes it live", op.status === 200 && JSON.stringify(o2.body.org.theme.onetimeAmounts) === "[20,40,80,160]", o2.body.org.theme.onetimeAmounts);
  const oh = await api("GET", "/org-form/page/history", tok);
  ok("§7 its history says who published", oh.body.versions && oh.body.versions[0] && oh.body.versions[0].byName === "Edit Admin", oh.body);

  // §8 — an id that is not this org's page is refused.
  // (Foreign tokens are the tenant matrix's job; this is the suite's own 404.)
  const foreign = await api("POST", `/giving-pages/gp_doesnotexist/page/publish`, tok, {});
  ok("§8 an unknown page is a 404, never a false success", foreign.status === 404, foreign.status);

  // §9 — no edit moved money.
  ok("§9 no Stripe, fee or receipt setting changed after any edit", (await moneyRow()) === money0);

  // §10 — the standing volunteer link waits in Pending applications.
  const link = await api("GET", "/volunteer-hub/signup-link", tok);
  const token = new URL(String(link.body.url || link.body.standing || "http://x/?token=")).searchParams.get("token");
  const [{ n: before }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  const jr = await fetch(`${BASE}/volunteer/join`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, name: "Robin Sato", email: "robin.ge1@example.org", phone: "", availability: "Saturdays" }).toString() });
  const [{ n: after }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  const [appRow] = await q(`SELECT status, answers FROM volunteer_applications WHERE org_id=$1 AND email='robin.ge1@example.org'`, [ORG]);
  ok("§10 the join link answers", jr.status === 200, jr.status);
  ok("§10 nobody is added to the roster by the link", after === before, { before, after });
  ok("§10 the sign-up waits in Pending applications", appRow && appRow.status === "pending", appRow);
  ok("§10 what they said about when they can help is kept", appRow && JSON.stringify(appRow.answers).includes("Saturdays"), appRow && appRow.answers);

  // §11 — names in a next-step line keep their casing.
  const { stepInSentence } = await import("../shared/stepCase.js");
  ok("§11 Meridian Foundation keeps its capital", stepInSentence("Meridian Foundation grant report", ["Meridian Foundation"]) === "Meridian Foundation grant report");
  ok("§11 a step still reads mid-sentence", stepInSentence("Send the proposal", ["Ana Ruiz"]) === "send the proposal");
  ok("§11 Home uses it", fs.readFileSync(path.join(ROOT, "client/src/components/Dashboard.jsx"), "utf8").includes("stepInSentence(t.nextStep.label"));

  // §12 — every card has the same four buttons (browser leg).
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const login = await api("POST", "/auth/login", null, { email: "ge1pages@example.org", password: "demo1234" });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [login.body.token, JSON.stringify(login.body.user), JSON.stringify(login.body.org)]);
    await page.goto(`${APP}/app/fundraising?fr=pages`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="page-card"]', { timeout: 20000 }).catch(() => {});
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="page-card"],[data-testid="volunteer-page-card"],[data-testid="org-donation-share"]')]
      .map(c => [...c.querySelectorAll('[data-testid="page-action"]')].map(b => b.textContent.trim())));
    const want = JSON.stringify(["Edit in editor", "Open page", "Copy link", "QR and embed"]);   // FIX-39: one label everywhere
    const [{ n: cards }] = await q(`SELECT COUNT(*)::int AS n FROM giving_pages WHERE org_id=$1 AND status='active'`, [ORG]);
    ok("§12 a card for every page, and one for the donation form", rows.length === cards + 1, { rows: rows.length, cards });
    ok("§12 every card has the same four buttons", rows.length > 0 && rows.every(r => JSON.stringify(r) === want), rows);
    await browser.close();
  }

  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); summary(); await closeDb(); });

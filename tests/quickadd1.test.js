// tests/quickadd1.test.js: QUICKADD-1. ADD A PERSON AND THEIR GIFT IN ONE GO.
// Guards donor data and money: a gift entered with a new person must land on
// that person, with the campaign and fundraiser she chose, and a refused gift
// must add nobody.
//
// A beta customer (10 Nov): six Good Giving Challenge
// donors took four screens each (add, search, open giving, record the gift).
//
// API leg:
//   §A1 POST /gifts/new-person with no person: the gift is refused, nothing written
//   §A2 a new person and a gift in one write: person (actor-stamped), gift on
//       them, with campaign, appeal and giving page; Everyone +1
//   §A3 the same name again: 409 "… is already on file. Use that record?";
//       useExistingId puts the gift on them and adds nobody
//   §A4 a gift refused after the checks (a foreign appeal) adds nobody
//   §A5 six new donors on one deposit sheet, each line with the campaign and
//       fundraiser: six people, six gifts carrying both, Everyone +6
// Browser leg (real clicks on the built client):
//   §B1 Add person, Save: lands on their profile
//   §B2 Save and record a gift: the profile, with Record a gift open
//   §B3 Save and add another: the form stays, emptied, with "Added … Open"
//   §B4 Record a gift → "+ New person: '…'" → saves person and gift; the
//       campaign made inline ("+ New campaign: …") is on the gift; a second
//       gift shows the campaign as "Same as last"
//   §B5 the deposit sheet: six new names, line 1's campaign and fundraiser
//       carried down as "Same as last"; all six gifts carry them; Everyone +6
//   §B6 the next Save and record a gift starts from the last gift's campaign
//
// Planted defect (QUICKADD-1 report): the client drops `person` from the
// inline create, and §A1's refusal is what §B4 meets: red.
"use strict";
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, browserLegOrSkip, SINK_PORT } = require("./helpers");
const { DIST } = require("./lib/dist");

const PASSWORD = "loadtest1234";
const ORG = "org_quickadd1";
const EMAIL = `${ORG}@test.local`;
const ME = "u_" + ORG;
const OTHER = "org_quickadd1b";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const optional = f => { try { return require(f); } catch { return null; } };

const sink = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"re_sink"}'); }); });

async function wipe(org) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function freshOrg() {
  await wipe(ORG); await wipe(OTHER);
  for (const [id, name] of [[ORG, "Quick Add Wrenfield Trust"], [OTHER, "Quick Add Other Org"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
    await q(`UPDATE orgs SET onboarded_at=NOW() WHERE id=$1`, [id]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Holloway','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ('f_qa1_gen',$1,'General Operating')`, [ORG]);
  await q(`UPDATE orgs SET default_fund_id='f_qa1_gen' WHERE id=$1`, [ORG]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title) VALUES ('gp_qa1_ggc',$1,'ggc-qa1','Good Giving Challenge page')`, [ORG]);
  await q(`INSERT INTO appeals (id,org_id,name,created_by,created_by_name) VALUES ('apl_qa1_other',$1,'Not yours','system:test/quickadd1','QUICKADD-1 test')`, [OTHER]);
  return login(EMAIL, PASSWORD);
}
const everyone = async tok => { const r = await api("GET", "/donors/counts", tok); return Number(r.body && (r.body.total ?? r.body.everyone)) || 0; };
const giftCount = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]))[0].n);
const donorNamed = async name => (await q(`SELECT * FROM donors WHERE org_id=$1 AND name=$2 AND deleted_at IS NULL`, [ORG, name]));

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r)).catch(() => {});
  const tok = await freshOrg();
  const today = civilToday();

  // ── §A1 · NO PERSON, NO GIFT ───────────────────────────────────────────────
  const g0 = await giftCount();
  const a1 = await api("POST", "/gifts/new-person", tok, { amount: 40, date: today, type: "cash", payment_method: "Check" });
  ok("§A1 a new-person gift with no person is refused (400 no_person) and nothing is written",
    a1.status === 400 && a1.body.code === "no_person" && (await giftCount()) === g0, { status: a1.status, body: a1.body });

  // ── §A2 · PERSON AND GIFT IN ONE WRITE ─────────────────────────────────────
  const camp = await api("POST", "/gift-attribution/campaign", tok, { name: "Good Giving Challenge" });
  const campAgain = await api("POST", "/gift-attribution/campaign", tok, { name: "good giving challenge" });
  ok("§A2 \"+ New campaign\" makes one campaign; the same name again hands it back",
    camp.status === 201 && campAgain.status === 200 && campAgain.body.id === camp.body.id, { camp: camp.body, again: campAgain.body });
  const appeal = await api("POST", "/gift-attribution/appeal", tok, { name: "Match day", campaignId: camp.body.id });
  const pages = await api("GET", "/gift-attribution/page?q=good", tok);
  const page = (pages.body.rows || []).find(r => r.givingPageId === "gp_qa1_ggc");
  const before = await everyone(tok);
  const a2 = await api("POST", "/gifts/new-person", tok, {
    person: { firstName: "Ana", lastName: "Whitfield", email: "ana.whitfield@qa1.example.org", phone: "", address: "12 Fern Row", city: "Ely", state: "NC", zip: "27001" },
    amount: 75, date: today, type: "cash", payment_method: "Check", fund_id: "f_qa1_gen",
    campaign_id: camp.body.id, appealId: appeal.body.id, givingPageId: page && page.givingPageId, idempotencyKey: "qa1-a2" });
  const [ana] = await donorNamed("Ana Whitfield");
  const anaGifts = ana ? await q(`SELECT * FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, ana.id]) : [];
  ok("§A2 one request adds the person (actor-stamped, address kept) and records the gift on them",
    a2.status === 201 && a2.body.created === true && !!ana && ana.created_by === ME && ana.city === "Ely"
      && anaGifts.length === 1 && Number(anaGifts[0].amount) === 75 && a2.body.person.id === ana.id,
    { status: a2.status, body: a2.body && (a2.body.error || a2.body.code), ana: ana && { id: ana.id, by: ana.created_by }, gifts: anaGifts.length });
  ok("§A2 the gift carries the campaign, the appeal and the giving page",
    anaGifts[0] && anaGifts[0].campaign_id === camp.body.id && anaGifts[0].appeal_id === appeal.body.id && anaGifts[0].giving_page_id === "gp_qa1_ggc",
    anaGifts[0] && { c: anaGifts[0].campaign_id, a: anaGifts[0].appeal_id, p: anaGifts[0].giving_page_id });
  ok("§A2 Everyone goes up by one", (await everyone(tok)) === before + 1, { before, after: await everyone(tok) });

  // ── §A3 · THE SAME NAME OFFERS THE PERSON ON FILE ──────────────────────────
  const dup = await api("POST", "/gifts/new-person", tok, { person: { firstName: "ana", lastName: "whitfield" }, amount: 20, date: today, type: "cash" });
  ok("§A3 the same name again: 409, naming the person on file and asking to use them",
    dup.status === 409 && dup.body.code === "possible_duplicate" && dup.body.matches[0].id === (ana && ana.id)
      && /^Ana Whitfield is already on file.*Use that record\?$/.test(dup.body.sentence || ""), dup.body);
  const nBefore = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]))[0].n;
  const use = await api("POST", "/gifts/new-person", tok, { useExistingId: ana && ana.id, amount: 20, date: today, type: "cash", idempotencyKey: "qa1-a3" });
  const nAfter = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]))[0].n;
  ok("§A3 \"Use that record\" puts the gift on them and adds nobody",
    use.status === 201 && use.body.gift && use.body.gift.donor_id === (ana && ana.id) && nAfter === nBefore, { status: use.status, nBefore, nAfter });

  // ── §A4 · A REFUSED GIFT ADDS NOBODY ───────────────────────────────────────
  const refused = await api("POST", "/gifts/new-person", tok, { person: { firstName: "Corin", lastName: "Ashdown" }, amount: 30, date: today, appealId: "apl_qa1_other" });
  ok("§A4 another org's appeal refuses the gift, and Corin Ashdown is not added",
    refused.status === 404 && (await donorNamed("Corin Ashdown")).length === 0, { status: refused.status });

  // ── §A5 · SIX NEW DONORS ON ONE DEPOSIT SHEET ──────────────────────────────
  const six = ["Bea Lindqvist", "Cyrus Pemberton", "Dalia Okonkwo", "Elio Marchetti", "Fern Abernathy", "Gus Halvorsen"];
  const paste = six.map((n, i) => `${n}\t${25 * (i + 1)}`).join("\n");
  const slip = six.reduce((s, _, i) => s + 25 * (i + 1), 0);
  const before5 = await everyone(tok);
  const plan = await api("POST", "/deposits/plan", tok, { paste, depositDate: today, slipTotal: slip });
  const lines = ((plan.body && plan.body.lines) || []).map(l => ({ line: l.line, campaignId: camp.body.id, givingPageId: "gp_qa1_ggc",
    person: l.line === 1 ? { email: "bea@qa1.example.org" } : undefined }));
  const commit = await api("POST", "/deposits/commit", tok, { paste, depositDate: today, slipTotal: slip, lines });
  const sixGifts = await q(`SELECT d.name, d.email, g.campaign_id, g.giving_page_id FROM gifts g JOIN donors d ON d.id=g.donor_id
                             WHERE g.org_id=$1 AND d.name = ANY($2::text[])`, [ORG, six]);
  ok("§A5 the deposit sheet records six new donors' gifts, each with the campaign and the fundraiser page",
    commit.status < 300 && sixGifts.length === 6 && sixGifts.every(g => g.campaign_id === camp.body.id && g.giving_page_id === "gp_qa1_ggc"),
    { status: commit.status, err: commit.body && (commit.body.error || commit.body.message), n: sixGifts.length });
  ok("§A5 the email typed on a new person's line is on their record",
    sixGifts.some(g => g.name === "Bea Lindqvist" && g.email === "bea@qa1.example.org"), sixGifts.map(g => g.email));
  ok("§A5 Everyone goes up by 6", (await everyone(tok)) === before5 + 6, { before5, after: await everyone(tok) });

  // ── BROWSER LEG ────────────────────────────────────────────────────────────
  const pw = optional(PW);
  const why = !pw ? "playwright not installed" : !require("fs").existsSync(path.join(DIST, "index.html")) ? "no client dist" : null;
  if (browserLegOrSkip(why, "(browser leg)")) { sink.close(); await closeDb(); summary(); return; }
  const { chromium } = pw;
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const me = (await api("GET", "/me", tok)).body;
  await pg.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [tok, JSON.stringify(me.user || me), JSON.stringify(me.org || {})]);
  const consoleErrors = [];
  pg.on("pageerror", e => consoleErrors.push(String(e && e.message || e)));
  const open = async url => { await pg.goto(`${APP}${url}`, { waitUntil: "networkidle", timeout: 60000 }); };
  const shot = async name => { if (process.env.QUICKADD1_SHOTS) await pg.screenshot({ path: path.join(process.env.QUICKADD1_SHOTS, name + ".png"), fullPage: false }).catch(() => {}); };
  const tid = id => pg.locator(`[data-testid="${id}"]`).first();
  const addPerson = async (name, button) => {
    await open("/donors");
    await pg.getByRole("button", { name: "+ Add" }).first().click({ timeout: 20000 });
    await tid("add-name").fill(name);
    await shot(`add-${button}`);
    await pg.locator(`[data-testid="add-${button}"]`).first().click({ timeout: 5000 })
      .catch(() => pg.getByRole("button", { name: "Save", exact: true }).first().click({ timeout: 5000 }));
  };

  try {
    // §B1 · Save lands on the profile
    await addPerson("Hollis Brightwater", "save");
    await pg.waitForURL(u => /\/donors\/d_/.test(String(u)), { timeout: 15000 }).catch(() => {});
    const [hollis] = await donorNamed("Hollis Brightwater");
    await tid("dp-head").waitFor({ timeout: 20000 }).catch(() => {});
    await shot("b1-profile");
    ok("§B1 Add person → Save opens their new profile",
      !!hollis && pg.url().includes(`/donors/${hollis.id}`) && await tid("dp-head").isVisible().catch(() => false), pg.url());

    // §B2 · Save and record a gift opens the gift form on the profile
    await addPerson("Imogen Sallow", "save-gift");
    await pg.waitForURL(u => /\/donors\/d_/.test(String(u)), { timeout: 15000 }).catch(() => {});
    const [imogen] = await donorNamed("Imogen Sallow");
    await tid("dp-add-gift-form").waitFor({ timeout: 20000 }).catch(() => {});
    await shot("b2-gift-open");
    ok("§B2 Save and record a gift opens their profile with Record a gift open",
      !!imogen && pg.url().includes(`/donors/${imogen.id}`) && await tid("dp-add-gift-form").isVisible().catch(() => false), pg.url());
    const noneCarried = await pg.locator('[data-testid="dp-add-gift-form"] [data-testid$="-same"]').count().catch(() => -1);
    ok("§B2 with no gift typed yet this session, nothing reads \"Same as last\"", noneCarried === 0, noneCarried);

    // §B3 · Save and add another stays, emptied, and says who was added
    await addPerson("Jasper Quillon", "save-another");
    await tid("add-toast").waitFor({ timeout: 15000 }).catch(() => {});
    const toast = ((await tid("add-toast").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    const nameNow = await tid("add-name").inputValue().catch(() => "gone");
    await shot("b3-another");
    ok("§B3 Save and add another keeps the form, empty, with \"Added Jasper Quillon. Open\"",
      (await donorNamed("Jasper Quillon")).length === 1 && nameNow === "" && /Added Jasper Quillon\.\s*Open/.test(toast), { toast, nameNow });

    // §B4 · + New person inside Record a gift
    await open("/donors");
    await tid("donors-record-gift").click({ timeout: 20000 });
    await tid("record-gift-who").fill("Kit Ravensworth");
    await tid("record-gift-new-person").click({ timeout: 10000 });
    await tid("record-gift-np-email").fill("kit@qa1.example.org");
    await tid("record-gift-amount").fill("60");
    await tid("record-gift-campaign").fill("Spring Lantern Night");
    await tid("record-gift-campaign-create").click({ timeout: 10000 });
    await tid("record-gift-campaign-picked").waitFor({ timeout: 10000 }).catch(() => {});
    await shot("b4-new-person");
    await tid("record-gift-save-another").click();
    await pg.waitForTimeout(1500);
    const [kit] = await donorNamed("Kit Ravensworth");
    const kitGifts = kit ? await q(`SELECT g.*, c.name AS cname FROM gifts g LEFT JOIN campaigns c ON c.id=g.campaign_id WHERE g.org_id=$1 AND g.donor_id=$2`, [ORG, kit.id]) : [];
    ok("§B4 Record a gift → + New person saves the person and the gift together, with the campaign made inline",
      !!kit && kit.email === "kit@qa1.example.org" && kitGifts.length === 1 && Number(kitGifts[0].amount) === 60 && kitGifts[0].cname === "Spring Lantern Night",
      { kit: !!kit, gifts: kitGifts.length, c: kitGifts[0] && kitGifts[0].cname, err: await tid("record-gift").innerText().catch(() => "") });
    const sticky = ((await tid("record-gift-campaign-same").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    await shot("b4-sticky");
    ok("§B4 the next gift shows the campaign as \"Same as last\"", /Same as last/.test(sticky) && /Spring Lantern Night/.test(sticky), sticky);
    // FLOWS-7 (W-1112-Volunteers-03X): the From box shows the person on file
    // among its matches, above "+ New person", and choosing New for a name
    // that is exactly someone's asks first. Planted: the From search hiding an
    // exact match (match=person dropped) turns the first check red.
    await tid("record-gift-who").fill("kit ravensworth");
    await tid("record-gift-match").first().waitFor({ timeout: 10000 }).catch(() => {});
    const matchNames = await pg.locator('[data-testid="record-gift-match"]').allInnerTexts().catch(() => []);
    const order = await pg.evaluate(() => { const m = document.querySelector('[data-testid="record-gift-matches"]'), n = document.querySelector('[data-testid="record-gift-new-person"]');
      return m && n ? !!(m.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
    await shot("b4-matches");
    ok("§B4 FLOWS-7 a full name typed finds the person on file, listed above + New person",
      matchNames.some(t => /Kit Ravensworth/.test(t)) && order === true, { matchNames, order });
    await tid("record-gift-new-person").click({ timeout: 10000 }).catch(() => {});
    await tid("record-gift-already").waitFor({ timeout: 10000 }).catch(() => {});
    const alreadyText = ((await tid("record-gift-already").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    await shot("b4-already");
    ok("§B4 FLOWS-7 choosing New for a name on file asks first", /There's already a Kit Ravensworth\. Use that record\?/.test(alreadyText), alreadyText);
    await tid("record-gift-already-use").click().catch(() => {});
    await tid("record-gift-amount").fill("15");
    await tid("record-gift-save").click();
    await pg.waitForTimeout(1500);
    const kitAll = kit ? await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, kit.id]) : [{ n: 0 }];
    ok("§B4 \"Use that record\" puts the gift on Kit, and no second Kit is added",
      kitAll[0].n === 2 && (await donorNamed("Kit Ravensworth")).length === 1, kitAll[0]);

    // §B5 · the deposit sheet, six new names, sticky campaign and fundraiser
    const names = ["Lark Penhallow", "Milo Tregarth", "Nell Ashcombe", "Otto Brannagh", "Pia Underhill", "Quin Farrowby"];
    const before6 = await everyone(tok);
    await open("/app/fundraising?fr=deposits");
    await tid("add-a-deposit").click({ timeout: 20000 });
    await tid("deposit-paste").fill(names.map((n, i) => `${n}\t${10 * (i + 1)}`).join("\n"));
    await tid("deposit-slip-total").fill(String(names.reduce((s, _, i) => s + 10 * (i + 1), 0)));
    await tid("deposit-read").click();
    await pg.locator('[data-deposit-line="6"]').waitFor({ timeout: 20000 }).catch(() => {});
    await tid("deposit-campaign-1").fill("Good Giving");
    await pg.locator('[data-testid="deposit-campaign-1-opt"]').first().click({ timeout: 10000 }).catch(() => {});
    await tid("deposit-page-1").fill("Good Giving");
    await pg.locator('[data-testid="deposit-page-1-opt"]').first().click({ timeout: 10000 }).catch(() => {});
    await pg.waitForTimeout(500);
    const chips = await pg.locator('[data-testid$="-same"]').allInnerTexts().catch(() => []);
    await shot("b5-sheet");
    ok("§B5 lines 2 to 6 show the campaign and the fundraiser as \"Same as last\"",
      chips.filter(t => /Same as last/.test(t)).length >= 10, chips.length);
    await tid("deposit-commit").click({ timeout: 10000 }).catch(() => {});
    await pg.waitForTimeout(2500);
    const sheetGifts = await q(`SELECT g.campaign_id, g.giving_page_id FROM gifts g JOIN donors d ON d.id=g.donor_id
                                 WHERE g.org_id=$1 AND d.name = ANY($2::text[])`, [ORG, names]);
    await shot("b5-done");
    ok("§B5 all six new donors have gifts carrying the campaign and the fundraiser",
      sheetGifts.length === 6 && sheetGifts.every(g => g.campaign_id === camp.body.id && g.giving_page_id === "gp_qa1_ggc"), sheetGifts);
    ok("§B5 Everyone goes up by 6", (await everyone(tok)) === before6 + 6, { before6, after: await everyone(tok) });
    // §B6 · the next person through Save and record a gift starts from the last gift
    await addPerson("Rowan Tilby", "save-gift");
    await tid("dp-add-gift-form").waitFor({ timeout: 20000 }).catch(() => {});
    await tid("dp-gift-campaign-same").waitFor({ timeout: 10000 }).catch(() => {});
    const carried = ((await tid("dp-gift-campaign-same").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    await pg.locator('[data-testid="dp-add-gift-form"] input[placeholder="Amount ($)"]').first().fill("45");
    await shot("b6-carried");
    await tid("dp-add-gift-save").click();
    await pg.waitForTimeout(1500);
    const rowan = (await donorNamed("Rowan Tilby"))[0];
    const rg = rowan ? await q(`SELECT c.name AS cname, g.amount FROM gifts g LEFT JOIN campaigns c ON c.id=g.campaign_id WHERE g.org_id=$1 AND g.donor_id=$2`, [ORG, rowan.id]) : [];
    ok("§B6 Save and record a gift carries the last gift's campaign as \"Same as last\", and the gift saves with it",
      /Same as last: Spring Lantern Night/.test(carried) && rg.length === 1 && rg[0].cname === "Spring Lantern Night", { carried, rg });
    ok("browser: no page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3));
  } catch (e) {
    await shot("crash");
    ok("browser leg ran to its end", false, String((e && e.message) || e));
  }
  await browser.close();
  sink.close(); await closeDb(); summary();
})().catch(async e => { console.error(e); ok("suite ran", false, String(e && e.message)); await closeDb().catch(() => {}); summary(); });

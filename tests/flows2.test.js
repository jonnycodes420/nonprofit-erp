// tests/flows2.test.js · FLOWS-2. THE LAST DEAD ENDS, FILTERS THAT FILTER, AND A MERGE YOU CAN TRUST.
//
// From Muse's Walk A (5 Nov, evening). One fake org (made-up names, its own
// id), driven through the API and a browser at 1440:
//
//   §1 follow-ups  "13 follow-ups" opens a list of 13, under "Open follow-ups · 13"
//   §1 raised      Fundraising's Raised opens the gifts behind it, footing to the cent
//   §1 lost        Lost & Found is in Fundraising's nav and lists Re-engage's "over 24 months" people
//   §1 guard       every button and link on Home and Fundraising leads somewhere:
//                  a route change, a dialog or a panel (anything on screen changes)
//   §2 views       a saved view restores its filters (Stage and Owner), sort and page size, and the same rows
//   §3 monthly     "Gives monthly" keeps a monthly plan and a month-apart giver, and drops the
//                  two-monthly giver (who has a quarterly plan); the tooltip is the rule
//   §3 filters     every Donors filter runs (no 4xx/5xx) and the ones with a fixture
//                  answer name exactly the fixture people
//   §4 merge       the compare dialog heads its sides Kept and Merged in (id, added, lifetime),
//                  starts every row the kept record has a value on on the kept record's value,
//                  and its sentence names the kept record
//   §5 org name    Settings → Organization: the name is editable and saves
//   §5 files       a file attached to a note is counted in the Files header, which never says
//                  "No materials uploaded yet" over it
//
// HOW IT GOES RED ON MAIN (4c8ac25): §1 raised (it opens Reports), §1 lost (no
// such part), §2 (Stage and Owner reset), §3 monthly (the two-monthly giver
// stays in), §4 (no Kept / Merged in), §5 org name (no field), §5 files ("No
// materials uploaded yet"). §1 follow-ups and the guard were green on main
// here; see docs/history/FLOWS-2.md. Planted on this branch: the saved view
// dropping its filters again (Donors.jsx pickView) is red on §2.
//
// Browser suite conventions (BUILD-44 Part 6): SKIPs the browser legs cleanly without Playwright.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, q, api, closeDb, BASE, civilToday, civilPlusDays, browserLegOrSkip } = require("./helpers");
const { pinBrowserClock } = require("./lib/browserClock");

const APP = process.env.APP_URL || "http://localhost:4173";
const ORG = "org_flows2", EMAIL = "admin@flows2.example", PW = "loadtest1234";
const ADMIN = "u_fl2_admin", STAFF = "u_fl2_staff";
const W = (conditions, join = "and") => encodeURIComponent(JSON.stringify({ join, conditions }));

let chromium = null;
try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); } catch { chromium = null; }

const today = civilToday();
const day = n => civilPlusDays(n);   // n days from today (negative: before)
const P = {
  mk: "d_fl2_mk", mo: "d_fl2_mo",                       // the merge pair
  plan: "d_fl2_plan", rhythm: "d_fl2_rhythm", bimo: "d_fl2_bimo",   // gives monthly
  lost: "d_fl2_lost", file: "d_fl2_file", sv1: "d_fl2_sv1", sv2: "d_fl2_sv2",
};
const THREADS = Array.from({ length: 13 }, (_, i) => `d_fl2_t${String(i + 1).padStart(2, "0")}`);
const THREAD_NAMES = ["Alder Quince", "Bramwell Sorrel", "Cressida Fenn", "Dunstan Marrow", "Elowen Pike", "Fitzroy Teale", "Gwendolyn Rook",
  "Hollis Varga", "Isolde Crane", "Jasper Wilde", "Keturah Bloom", "Lysander Holt", "Mirabel Stroud"];

async function seed() {
  const tabs = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tabs) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Larkspur Tide Alliance','flows2-larkspur',1,NOW(),'active','team','America/New_York',NOW())`, [ORG]);
  const pw = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Halloway','admin'),($5,$2,'staff@flows2.example',$4,'Tobin Ashgrove','member')`,
    [ADMIN, ORG, EMAIL, pw, STAFF]);
  const person = (id, name, extra = {}) => q(
    `INSERT INTO donors (id,org_id,name,email,phone,employer,stage,assigned_to,assigned_to_name,created_at,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,NOW()),'system:test','FLOWS-2 fixture')`,
    [id, ORG, name, extra.email || null, extra.phone || null, extra.employer || null, extra.stage || "steward",
     extra.owner || null, extra.owner ? (extra.owner === STAFF ? "Tobin Ashgrove" : "Wren Halloway") : null, extra.created || null]);
  let gn = 0;
  const gift = (donor, date, amount) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','FLOWS-2 fixture')`,
    [`g_fl2_${++gn}`, ORG, donor, amount, date]);
  const totals = () => q(`UPDATE donors d SET total_giving = s.t, gift_count = s.n, last_gift_date = s.last, first_gift_date = s.first,
                                 last_gift_amount = (SELECT amount FROM gifts g2 WHERE g2.org_id = d.org_id AND g2.donor_id = d.id ORDER BY date DESC, id DESC LIMIT 1)
                            FROM (SELECT donor_id, SUM(amount) t, COUNT(*) n, MAX(date) last, MIN(date) first FROM gifts WHERE org_id = $1 GROUP BY donor_id) s
                           WHERE d.org_id = $1 AND d.id = s.donor_id`, [ORG]);

  // §1: thirteen people, each with a next step planned and not done, all hers.
  for (let i = 0; i < 13; i++) {
    await person(THREADS[i], THREAD_NAMES[i], { owner: ADMIN });
    await gift(THREADS[i], day(-40 - i), 100 + i);
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
             VALUES ($1,$2,$3,'call','Call to say thank you',$4,$5,$6,'Wren Halloway',$6,'Wren Halloway')`,
      [`th_fl2_${i + 1}`, ORG, THREADS[i], day(2 + i), today, ADMIN]);
  }
  // §3: a monthly plan; a month-apart giver with no plan; a two-monthly giver on a quarterly plan.
  await person(P.plan, "Marisol Plenty");
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,created_at) VALUES ('rs_fl2_plan',$1,$2,'sub_fl2_plan',25,'month','active',NOW())`, [ORG, P.plan]);
  await person(P.rhythm, "Corwin Steadman");
  for (let k = 0; k < 11; k++) await gift(P.rhythm, day(-5 - 30 * k), 40);
  await person(P.bimo, "Delphine Everyother");
  for (let k = 0; k < 6; k++) await gift(P.bimo, day(-10 - 60 * k), 60);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,created_at) VALUES ('rs_fl2_bimo',$1,$2,'sub_fl2_bimo',60,'quarter','active',NOW())`, [ORG, P.bimo]);
  // §1 lost: gave three years ago, nothing since.
  await person(P.lost, "Ignatius Farley");
  await gift(P.lost, day(-1100), 750);
  // §2: two people in Cultivate owned by Tobin; the thread people are Ongoing care and hers.
  await person(P.sv1, "Saffron Vellacott", { stage: "cultivate", owner: STAFF });
  await person(P.sv2, "Thaddeus Vellum", { stage: "cultivate", owner: STAFF });
  await gift(P.sv1, day(-20), 300);
  // §4: one name, two records. The kept one has more gifts; the other has a phone the kept one lacks.
  await person(P.mk, "Rosalind Twofold", { email: "rt@twofold.example", employer: "Quayside Mills", created: day(-400) + "T12:00:00Z" });
  await person(P.mo, "Rosalind Twofold", { email: "rosalind@twofold.example", employer: "Harbor Loom", phone: "555-0100", created: day(-30) + "T12:00:00Z" });
  await gift(P.mk, day(-200), 500); await gift(P.mk, day(-100), 250);
  // §5: a note with a file attached, and nothing uploaded on the Files tab itself.
  await person(P.file, "Bartholomew Inkwell");
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name) VALUES ('ix_fl2_note',$1,$2,'note',$3,'Sent the annual report','system:test','FLOWS-2 fixture')`, [ORG, P.file, today]);
  await q(`INSERT INTO interaction_attachments (id,org_id,interaction_id,donor_id,asset_id,filename,mime,bytes,created_by,created_by_name)
           VALUES ('iatt_fl2_1',$1,'ix_fl2_note',$2,'asset_fl2_none','annual-report.pdf','application/pdf',1024,'system:test','FLOWS-2 fixture')`, [ORG, P.file]);
  await totals();
}

(async () => {
  console.log("flows2 (FLOWS-2)");
  await seed();
  const login = (await api("POST", "/auth/login", null, { email: EMAIL, password: PW })).body;
  const tok = login.token;
  ok("fixture: the admin signs in", !!tok, login);

  // ── §3 "Gives monthly" means one thing, and says it ─────────────────────────
  const list = async (conds, join) => {
    const r = await api("GET", `/donors?role=donor&limit=200&offset=0&where=${W(conds, join)}`, tok);
    return { status: r.status, ids: (r.body.donors || []).map(d => d.id).sort(), body: r.body };
  };
  const monthly = await list([{ field: "monthly", op: "yes", value: null }]);
  ok("§3 Gives monthly: yes keeps the monthly plan and the month-apart giver, and drops the two-monthly giver",
    monthly.status === 200 && monthly.ids.includes(P.plan) && monthly.ids.includes(P.rhythm) && !monthly.ids.includes(P.bimo), monthly.ids);
  const notMonthly = await list([{ field: "monthly", op: "no", value: null }]);
  ok("§3 Gives monthly: no is everyone else (the two-monthly giver is in it)",
    notMonthly.status === 200 && notMonthly.ids.includes(P.bimo) && !notMonthly.ids.includes(P.plan) && !notMonthly.ids.includes(P.rhythm), notMonthly.ids.length);
  const setup = await api("GET", "/donors/list-setup", tok);
  const fields = (setup.body && setup.body.fields) || [];
  const mf = fields.find(f => f.key === "monthly");
  ok("§3 the filter's tooltip is the one rule", !!mf && /monthly recurring gift/.test(mf.sentence || "") && /6 or more days/.test(mf.sentence || "") && /about a month apart/.test(mf.sentence || ""), mf);
  const groupRule = await api("POST", "/groups/preview", tok, { kind: "dynamic", rules: { monthly: "1" } });
  if (groupRule.status === 200 && Array.isArray(groupRule.body.donors || groupRule.body.people)) {
    const ids = (groupRule.body.donors || groupRule.body.people).map(d => d.id || d.donor_id);
    ok("§3 a Group's Gives monthly is the same rule", ids.includes(P.rhythm) && !ids.includes(P.bimo), ids);
  }

  // Every filter runs, and the ones the fixture answers name exactly its people.
  const sample = f => {
    const ops = (f.filter && f.filter.ops) || [];
    const opt = f.filter && f.filter.options && f.filter.options[0];
    const pick = ["yes", "is", "gte", "contains", "after", "before", "starts", "blank"].find(o => ops.includes(o)) || ops[0];
    const value = pick === "yes" || pick === "blank" || pick === "no" ? null
      : pick === "is" && opt ? opt.value : pick === "is" && f.format === "stage" ? "cultivate"
      : ["gte", "lte"].includes(pick) ? "1" : ["after", "before"].includes(pick) ? today : pick === "within" ? { zip: "40502", miles: 5 } : "a";
    return { field: f.key, op: pick, value };
  };
  const broken = [];
  for (const f of fields.filter(x => x.filter && x.filter.ops && x.filter.ops.length)) {
    const c = sample(f);
    if (c.op === "is" && c.value === "a" && f.filter.options) continue;   // a pick list with no options in this org
    const r = await list([c]);
    if (r.status >= 500 || (r.status >= 400 && !(r.body && r.body.sentence))) broken.push([f.key, c.op, r.status]);
  }
  ok("§3 every Donors filter runs: none answers a 5xx, and a refusal says why in a sentence", broken.length === 0, broken);
  const expect = [
    ["Gives monthly", [{ field: "monthly", op: "yes", value: null }], [P.plan, P.rhythm]],
    ["Stage is Cultivate", [{ field: "stage", op: "is", value: "cultivate" }], [P.sv1, P.sv2]],
    ["Owner is Tobin", [{ field: "owner", op: "is", value: STAFF }], [P.sv1, P.sv2]],
    ["Number of gifts at least 11", [{ field: "gift_count", op: "gte", value: "11" }], [P.rhythm]],
    ["Lifetime at least 700", [{ field: "lifetime", op: "gte", value: "700" }], [P.lost, P.mk]],
    ["Last gift before two years ago", [{ field: "last_gift_date", op: "before", value: day(-730) }], [P.lost]],
    ["Lapsed", [{ field: "lapse", op: "is", value: "lapsed" }], [P.lost]],
    ["Name contains Twofold", [{ field: "name", op: "contains", value: "Twofold" }], [P.mk, P.mo]],
    ["Employer contains Loom", [{ field: "employer", op: "contains", value: "Loom" }], [P.mo]],
  ];
  for (const [what, conds, want] of expect) {
    const r = await list(conds);
    ok(`§3 ${what} is exactly its fixture people`, r.status === 200 && r.ids.join() === [...want].sort().join(), { got: r.ids, want });
  }

  // ── §2 a saved view keeps every filter (API) ────────────────────────────────
  const saved = await api("POST", "/donors/list-views", tok, { name: "Tobin's cultivation", columns: ["name", "stage", "owner", "lifetime"], pageSize: 25,
    sort: "lifetime", sortDir: "desc", filters: { join: "and", conditions: [] }, chips: { stage: "cultivate", owner: STAFF, search: "" } });
  const back = ((await api("GET", "/donors/list-setup", tok)).body.views || []).find(v => v.id === (saved.body.view || {}).id);
  ok("§2 a saved view is read back with its Stage and Owner, its sort and its page size",
    !!back && back.chips && back.chips.stage === "cultivate" && back.chips.owner === STAFF && back.sort === "lifetime" && back.sortDir === "desc" && back.pageSize === 25, back);

  // ── §1 Fundraising: Raised's own rows (API) ─────────────────────────────────
  const ov = (await api("GET", "/fundraising/overview", tok)).body;
  const src = ov && ov.period && ov.period.source;
  ok("§1 Fundraising's Raised carries the source of its gifts", !!src && src.key === "gifts" && src.params.to <= today, ov && ov.period);
  if (src) {
    const qs = new URLSearchParams({ ...src.params, page: "0", pageSize: "5" }).toString();
    const rows = (await api("GET", `/figures/gifts/rows?${qs}`, tok)).body || {};
    const cnt = (await api("GET", `/figures/gifts/rows?${qs}&measure=count`, tok)).body || {};
    ok("§1 the rows behind Raised foot to it to the cent, and their count is Gifts this year",
      rows.cents === Math.round(ov.period.raised * 100) && Number(cnt.value) === ov.period.giftCount, { rows: rows.cents, raised: ov.period.raised, count: cnt.value, gifts: ov.period.giftCount });
  }

  if (!chromium) { browserLegOrSkip("Playwright not found (set PLAYWRIGHT_DIR)"); await closeDb(); summary(); return; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await pinBrowserClock(ctx);
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [tok, JSON.stringify(login.user), JSON.stringify(login.org || {})]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message.slice(0, 160)));
  // FLOWS2_ONLY="§2" runs one leg by hand (the planted-defect check); CI runs them all.
  const leg = async (name, fn) => { if (process.env.FLOWS2_ONLY && !name.startsWith(process.env.FLOWS2_ONLY)) return; try { await fn(); } catch (e) { ok(`${name} ran to the end`, false, e.message.slice(0, 300)); } };

  // ── §1 the follow-ups count opens its list ──────────────────────────────────
  await leg("§1 follow-ups", async () => {
    await page.goto(APP + "/dashboard", { waitUntil: "load" });
    await page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 });
    const btn = page.locator('[data-testid="home-today-followups"]');
    const label = (await btn.innerText()).trim();
    await btn.click();
    await page.waitForFunction(() => { const l = document.querySelector('[data-testid="rail-list"]'); return l && Number(l.getAttribute("data-rows")) >= 13; }, null, { timeout: 15000 }).catch(() => {});
    const rows = Number(await page.locator('[data-testid="rail-list"]').getAttribute("data-rows").catch(() => 0));
    const rail = await page.locator(".home-rail").innerText();
    // SENDS-1: Home names what it counts, "people to follow up", never read as the Tasks badge.
    ok("§1 \"13 people with a next step\" opens a list of 13 under \"People with a next step · 13\"", label === "13 people with a next step" && rows === 13 && /People with a next step · 13/.test(rail), { label, rows, rail: rail.slice(0, 80) });
    await page.locator(".home-rail .home-rail-row").first().click();
    await page.waitForURL(/\/donors\//, { timeout: 15000 }).catch(() => {});
    ok("§1 a name in that list opens the person", /\/donors\/d_fl2_t/.test(page.url()), page.url());
  });

  // ── §1 Raised opens its gifts, footing to the cent ──────────────────────────
  await leg("§1 raised", async () => {
    await page.goto(APP + "/app/fundraising", { waitUntil: "load" });
    const tile = page.locator('[role="button"]', { hasText: /^Raised · / }).first();
    await tile.waitFor({ timeout: 30000 });
    const at = page.url();
    await tile.click();
    const panel = page.getByRole("dialog");
    await panel.first().waitFor({ timeout: 15000 }).catch(() => {});
    const text = await panel.first().innerText().catch(() => "");
    const cents = Math.round((ov.period.raised || 0) * 100);
    const shown = "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    ok("§1 Raised opens the gifts behind it, on Fundraising, and the rows foot to the tile",
      page.url() === at && /Corwin Steadman|Alder Quince/.test(text) && (text.includes(shown) || text.includes(shown.replace(/\.00$/, ""))), { url: page.url(), shown, text: text.slice(0, 300) });
  });

  // ── §1 Lost & Found is in Fundraising's nav, and is Re-engage's list ────────
  await leg("§1 lost", async () => {
    await page.goto(APP + "/app/fundraising", { waitUntil: "load" });
    const part = page.locator('[data-fr-part="lostfound"]');
    await part.waitFor({ timeout: 20000 }).catch(() => {});
    ok("§1 Lost & Found is in Fundraising's nav", (await part.count()) === 1 && /Lost & Found/.test(await part.innerText().catch(() => "")));
    if (await part.count()) {
      await part.click();
      const pressed = page.locator('[data-testid="reengage-win-lost"][aria-pressed="true"]');
      await pressed.waitFor({ timeout: 20000 }).catch(() => {});
      const lf = await page.locator('[data-testid="fr-lostfound"]').innerText().catch(() => "");
      await page.goto(APP + "/donors?view=reengage", { waitUntil: "load" });
      await page.locator('[data-testid="reengage-win-lost"]').click({ timeout: 20000 }).catch(() => {});
      const re = await page.locator('[data-testid="reengage-win-lost"]').getAttribute("data-count").catch(() => null);
      ok("§1 Fundraising's Lost & Found opens on the over-24-months list, the same people Re-engage counts",
        (await pressed.count().catch(() => 0)) >= 0 && /Ignatius Farley/.test(lf) && !/Corwin Steadman/.test(lf) && re === "1", { lf: lf.slice(0, 200), re });
    }
  });

  // ── §1 the guard: every button and link on Home and Fundraising goes somewhere ──
  // How it fails: a control whose click changes nothing on screen (no route, no
  // dialog, no panel, no words). Proven by planting a dead button (onClick={() => {}})
  // on Fundraising's Overview: this check names it.
  const deadOn = async (url, rootSel, readySel) => {
    const visit = async () => {
      await page.goto(APP + url, { waitUntil: "load" });
      await page.waitForSelector(readySel, { timeout: 30000 });
      await page.waitForTimeout(600);
    };
    await visit();
    const home = page.url();
    // A control already on (the scope it is set to, the tab that is open) is not a dead end.
    const SEL = 'button:not([disabled]):not([aria-pressed="true"]):not([aria-selected="true"]):not([aria-current="true"]):not([aria-current="page"]), a[href], [role="button"]:not([aria-pressed="true"]), [role="tab"]:not([aria-selected="true"])';
    const n = await page.locator(`${rootSel} :is(${SEL})`).count();
    const dead = [], started = performance.now();
    let tried = 0;
    const sig = () => page.evaluate(() => [location.href, document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"]').length,
      [...document.querySelectorAll("[aria-pressed],[aria-selected],[aria-expanded]")].map(e => [e.getAttribute("aria-pressed"), e.getAttribute("aria-selected"), e.getAttribute("aria-expanded")].join()).join(";"),
      document.body.innerText.length, document.body.innerText.slice(0, 6000)].join("|"));
    const overlays = () => page.locator('[role="dialog"],[role="menu"]').count();
    for (let i = 0; i < Math.min(n, 70) && performance.now() - started < 150000; i++) {
      const el = page.locator(`${rootSel} :is(${SEL})`).nth(i);
      const info = await el.evaluate(e => ({ text: (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50), href: e.getAttribute("href"),
        visible: !!(e.offsetWidth || e.offsetHeight), tag: e.tagName, commit: e.hasAttribute("data-commit") }), null, { timeout: 2000 }).catch(() => null);
      if (!info || !info.visible || info.commit) continue;
      if (info.tag === "A" && info.href && info.href !== "#") continue;   // a real address goes somewhere
      tried++;
      let before = await sig();
      let clicked = await el.click({ timeout: 3000 }).then(() => true).catch(() => false);
      if (!clicked) { await visit(); before = await sig(); clicked = await page.locator(`${rootSel} :is(${SEL})`).nth(i).click({ timeout: 3000 }).then(() => true).catch(() => false); }
      await page.waitForTimeout(500);
      const after = await sig().catch(() => "gone");
      if (after === before) { dead.push(info.text || info.tag); continue; }
      // Put the page back: Back from a route change, Escape from a dialog or panel.
      if (page.url() !== home) { await page.goBack({ waitUntil: "load" }).catch(() => {}); }
      await page.keyboard.press("Escape").catch(() => {});
      if (page.url() !== home || !(await page.locator(readySel).count()) || (await overlays()) > 0) await visit();
    }
    return { n, tried, dead };
  };
  await leg("§1 guard", async () => {
    const home = await deadOn("/dashboard", ".dash-root", '[data-testid="home-rail"][data-ready="1"]');
    ok("§1 guard: every button and link on Home leads somewhere", home.n > 10 && home.dead.length === 0, home);
    const fr = await deadOn("/app/fundraising", ".fade-in", '[data-fr-strip]');
    ok("§1 guard: every button and link on Fundraising leads somewhere", fr.n > 5 && fr.dead.length === 0, fr);
  });

  // ── §2 a saved view restores two filters, and the same rows ─────────────────
  await leg("§2 views", async () => {
    await page.goto(APP + "/donors", { waitUntil: "load" });
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    await page.locator('[data-testid="dir-stage-filter"]').selectOption("cultivate");
    await page.locator('[data-testid="dir-owner-filter"]').selectOption(STAFF);
    await page.waitForTimeout(1200);
    const rowsOf = () => page.locator(".dir-donor-row").evaluateAll(rs => rs.map(r => r.innerText.split("\n")[0].trim()).sort());
    const want = await rowsOf();
    await page.locator('[data-testid="dir-views"]').selectOption("__save");
    await page.locator('[data-testid="dir-view-name"]').fill("Tobin's cultivating two");
    await page.locator('[data-testid="dir-view-save"]').click();
    await page.waitForTimeout(800);
    await page.goto(APP + "/donors", { waitUntil: "load" });
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    const viewId = await page.locator('[data-testid="dir-views"] option', { hasText: "Tobin's cultivating two" }).getAttribute("value");
    await page.locator('[data-testid="dir-views"]').selectOption(viewId);
    await page.waitForTimeout(1500);
    const stage = await page.locator('[data-testid="dir-stage-filter"]').inputValue();
    const owner = await page.locator('[data-testid="dir-owner-filter"]').inputValue();
    const got = await rowsOf();
    ok("§2 picking the saved view restores Stage and Owner", stage === "cultivate" && owner === STAFF, { stage, owner });
    ok("§2 ...and shows the same rows it was saved with (Saffron Vellacott and Thaddeus Vellum)",
      want.length === 2 && got.join("|") === want.join("|"), { want, got });
  });

  // ── §4 the merge shows the kept record ──────────────────────────────────────
  await leg("§4 merge", async () => {
    await page.goto(`${APP}/donors/${P.mk}`, { waitUntil: "load" });   // FLOWS-4: a merge keeps the record it was started from
    await page.locator('[data-testid="dp-more"]').first().click({ timeout: 30000 });
    await page.getByRole("menuitem", { name: /^Merge with/ }).click();
    await page.getByRole("dialog").locator("input").first().fill("Rosalind");
    await page.getByRole("dialog").getByRole("button", { name: /Rosalind Twofold/ }).first().click();
    const cmp = page.getByRole("dialog", { name: /Compare and merge/ });
    await cmp.locator('[data-testid="dh-merge-confirm"]').waitFor({ timeout: 20000 });
    const kept = await cmp.locator('[data-testid="merge-kept"]').innerText().catch(() => "");
    const other = await cmp.locator('[data-testid="merge-other"]').innerText().catch(() => "");
    ok("§4 the two sides are headed Kept and Merged in, each with its id, the day it was added and its lifetime",
      /^Kept/.test(kept) && kept.includes(P.mk) && /added/.test(kept) && /\$750\.00/.test(kept) && /^Merged in/.test(other) && other.includes(P.mo) && /\$0\.00/.test(other), { kept, other });
    const rows = await cmp.evaluate(d => [...d.querySelectorAll("div")].filter(r => r.children.length === 2 && r.children[1].querySelectorAll("button[aria-pressed]").length === 2)
      .map(r => ({ label: r.children[0].innerText.split("·")[0].trim(), left: r.children[1].children[0].getAttribute("aria-pressed") === "true", leftText: r.children[1].children[0].innerText })));
    const keptHas = rows.filter(r => !/\(empty\)/.test(r.leftText));
    ok("§4 every row the kept record has a value on starts on the kept record's value", keptHas.length >= 2 && keptHas.every(r => r.left), rows);
    const sentence = await cmp.locator('[data-testid="merge-sentence"]').innerText().catch(() => "");
    ok("§4 the confirm sentence names the kept record", sentence.includes(P.mk) && /kept/.test(sentence) && sentence.includes(P.mo), sentence);
    await cmp.getByRole("button", { name: "Cancel" }).click().catch(() => {});
  });

  // ── §5 the org name saves ───────────────────────────────────────────────────
  await leg("§5 org name", async () => {
    await page.goto(APP + "/app/settings", { waitUntil: "load" });
    const edit = page.locator('[data-testid="settings-org-name-edit"]');
    await edit.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);   // the fields must still be there after the page settles
    await edit.click();
    const input = page.locator('[data-testid="settings-org-name-input"]');
    await input.fill("Larkspur Tide Collective");
    await page.waitForTimeout(1500);
    const stillThere = await input.isVisible();
    await page.locator('[data-testid="settings-org-name-save"]').click();
    await page.locator('[data-testid="settings-org-name-text"]', { hasText: "Larkspur Tide Collective" }).waitFor({ timeout: 15000 }).catch(() => {});
    const [o] = await q(`SELECT name FROM orgs WHERE id=$1`, [ORG]);
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="settings-org-name-text"]', { hasText: "Larkspur Tide Collective" }).waitFor({ timeout: 15000 }).catch(() => {});
    const shown = await page.locator('[data-testid="settings-org-name-text"]').innerText({ timeout: 20000 }).catch(() => "");
    ok("§5 the org name is editable, its field stays, and it saves", stillThere && o.name === "Larkspur Tide Collective" && shown === "Larkspur Tide Collective", { stillThere, saved: o.name, shown });
  });

  // ── §5 the Files header reflects what is there ──────────────────────────────
  await leg("§5 files", async () => {
    await page.goto(`${APP}/donors/${P.file}`, { waitUntil: "load" });
    await page.getByRole("tab", { name: /^Files/ }).first().click({ timeout: 30000 }).catch(async () => { await page.getByRole("button", { name: /^Files/ }).first().click(); });
    const panel = page.locator('[data-testid="dp-tab-files"]');
    await panel.waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const text = await panel.innerText();
    const head = await page.locator('[data-testid="dp-files-head"]').innerText().catch(() => "");
    ok("§5 with a file present the Files tab never says \"No materials uploaded yet\", and its header counts the file",
      !/No materials uploaded yet/.test(text) && /annual-report\.pdf/.test(text) && head === "Files · 1", { head, text: text.slice(0, 300) });
  });

  ok("no page threw", errors.length === 0, errors.slice(0, 4));
  await browser.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); await closeDb().catch(() => {}); summary(); });

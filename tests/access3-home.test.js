// tests/access3-home.test.js · ACCESS-3. A CABINET MEMBER'S HOME THAT FEELS MADE FOR THEM.
//
// Jonathan walked Home as a Campaign cabinet member (10 Nov): a large empty
// band between the Atlas box and the Thread, a rail holding one line, the
// org's name and the greeting run together above the date, and Export CSV on
// the Donors list for someone whose export is off. A fake org (made-up names,
// its own id), against the running server (BASE) and the built app (APP):
//
//   §card     GET /home/portfolio for the cabinet member is their people only,
//             each figure equal to shared/numbers read over exactly their
//             people (count, given this fiscal year, overdue, top 5, the
//             next touches on their Top 100 rows); nobody outside is named
//   §empty    someone with no one assigned gets the sentence, no figures
//   §admin    an admin gets no portfolio card ({ scoped: false })
//   §export   the cabinet member's export is a 403; the admin's a 200
//   §band     in a browser at 1440, their Home's work column has no empty
//             band: no vertical gap over 64 px between things on screen, and
//             the Thread sits under the Atlas box
//   §rail     the rail is "Your portfolio" with the API's own figures, the
//             top five each opening their profile; the empty one its sentence
//   §head     the date is the headline, the greeting its own line under it,
//             the org's name small under the greeting
//   §button   their Donors list has no Export CSV button
//   §same     an admin's Home has the shape it had on main (a snapshot taken
//             from main's build: tests/fixtures/access3-admin-home.json)
//
// HOW IT GOES RED ON MAIN (a23fc65): §card (no route: 404), §export (404),
// §band (a 155 px gap under Ask), §rail (one "Today" line), §head (org and
// greeting on one line above the date), §button (the button is there).
// Planted on this branch: the card read org-wide (visible dropped in
// server/home/portfolioCard.js) is red on §card and §rail.
//
// Browser suite conventions (BUILD-44 Part 6): the browser legs SKIP cleanly
// without Playwright; the API checks always run. CAPTURE=1 writes §same's
// snapshot from whatever build APP serves (run it against main's).
"use strict";
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, BASE, browserLegOrSkip } = require("./helpers");
const { pinBrowserClock } = require("./lib/browserClock");
const { civilDay } = require("./clock");
const N = require("../shared/numbers");

const APP = process.env.APP_URL || "http://localhost:4173";
const ORG = "org_acc3home";
const PW = "loadtest1234";
const SNAP = path.join(__dirname, "fixtures", "access3-admin-home.json");
const U = {
  admin: ["u_acc3h_admin", "acc3h-admin@example.org", "Ada Zzadmin", "admin", "everyone", true],
  cab:   ["u_acc3h_cab", "acc3h-cab@example.org", "Sam Zzcabinet", "staff", "assigned", false],
  empty: ["u_acc3h_empty", "acc3h-empty@example.org", "Eli Zzempty", "staff", "assigned", false],
};
// Their people: five they own, a household whose main person they own, and its
// other member (owned by nobody, theirs through the household). One of theirs
// is in the trash and gave this year: never counted.
const MINE = ["d3h_amara", "d3h_bram", "d3h_celine", "d3h_dov", "d3h_esme", "d3h_head", "d3h_member"];
const OUTSIDE = ["d3h_xavier", "d3h_yara"];
const MARKS = ["zzoutside", "d3h_xavier", "d3h_yara", "zzhidden", "d3h_trash", "zztrash"];

// shared/numbers takes `?` placeholders; the suite's pool takes $n.
const query = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), args); };
const day = n => { const d = new Date(civilDay() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function wipe() {
  const ids = Object.values(U).map(u => u[0]);
  await q(`DELETE FROM user_sessions WHERE user_id = ANY($1)`, [ids]).catch(() => {});
  for (const t of ["tasks", "threads", "gifts", "interactions", "care_plans", "portfolio_members", "portfolio_lists"])
    await q(`DELETE FROM ${t} WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`UPDATE donors SET household_id = NULL WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM households WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id = $1`, [ORG]).catch(() => {});
  await q(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(() => {});
}

async function seed() {
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Zzwren Valley Arts Trust','acc3-home',1,'team','active')
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [ORG]);
  await q(`UPDATE orgs SET org_kind='fixture' WHERE id=$1`, [ORG]).catch(() => {});
  const hash = bcrypt.hashSync(PW, 8);
  for (const [id, email, name, role, sees, canExport] of Object.values(U)) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ORG, email, hash, name, role]);
    await q(`UPDATE users SET sees=$2, can_export=$3, can_wealth=$3 WHERE id=$1`, [id, sees, canExport]);
  }
  const cab = U.cab[0], admin = U.admin[0];
  // [id, name, owner, gifts [days ago, amount]]: one this year and one long before for Amara.
  const people = [
    ["d3h_amara", "Amara Zzokafor", cab, [[-20, 2500], [-800, 900]]],
    ["d3h_bram", "Bram Zzholloway", cab, [[-5, 400]]],
    ["d3h_celine", "Celine Zzmarchetti", cab, [[-60, 1200], [-30, 300.55]]],
    ["d3h_dov", "Dov Zzpereira", cab, []],
    ["d3h_esme", "Esme Zzlindqvist", cab, [[-90, 50]]],
    ["d3h_head", "Ines Zzhouse", cab, [[-15, 75]]],
    ["d3h_member", "Paulo Zzhouse", null, [[-14, 610]]],
    ["d3h_trash", "Tobin Zztrash", cab, [[-3, 999]]],
    ["d3h_xavier", "Xavier Zzoutside", admin, [[-10, 88000]]],
    ["d3h_yara", "Yara Zzoutside", null, [[-12, 5400]]],
  ];
  for (const [id, name, owner, gifts] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active','cultivate',$5,$6,$7,$8,'system:test','ACCESS-3 fixture')`,
      [id, ORG, name, id + "@example.org", gifts.reduce((s, g) => s + g[1], 0), gifts.length, owner, owner === cab ? U.cab[2] : owner ? U.admin[2] : null]);
    let i = 0;
    for (const [n, amt] of gifts) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','system:test','ACCESS-3 fixture')`,
      [`g3h_${id}_${i++}`, ORG, id, amt, day(n)]);
  }
  await q(`UPDATE donors SET deleted_at = NOW() WHERE id = 'd3h_trash'`);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id) VALUES ('h3h_mine',$1,'The Zzhouse household','d3h_head')`, [ORG]);
  await q(`UPDATE donors SET household_id='h3h_mine' WHERE id = ANY($1)`, [["d3h_head", "d3h_member"]]);
  // Follow-ups: Amara's overdue, Celine's ahead; Xavier's (outside) overdue.
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name) VALUES
    ('th3h_amara',$1,'d3h_amara','call','call Amara about the spring visit',$2,$2,$4,'Sam Zzcabinet'),
    ('th3h_celine',$1,'d3h_celine','email','send Celine the season brochure',$3,$2,$4,'Sam Zzcabinet'),
    ('th3h_xavier',$1,'d3h_xavier','call','call Xavier zzhidden',$2,$2,$5,'Ada Zzadmin')`, [ORG, day(-4), day(6), cab, admin]);
  // The Top 100: Xavier (outside), Amara and Bram, with planned touches.
  await q(`INSERT INTO portfolio_lists (id,org_id,name,created_by,created_by_name) VALUES ('pfl3h',$1,'Top 100','system:test','ACCESS-3 fixture')`, [ORG]);
  await q(`INSERT INTO portfolio_members (id,list_id,org_id,donor_id,rank,created_by,created_by_name) VALUES
    ('pm3h_x','pfl3h',$1,'d3h_xavier',1,'system:test','ACCESS-3 fixture'),('pm3h_a','pfl3h',$1,'d3h_amara',2,'system:test','ACCESS-3 fixture'),
    ('pm3h_b','pfl3h',$1,'d3h_bram',3,'system:test','ACCESS-3 fixture')`, [ORG]);
  await q(`INSERT INTO care_plans (id,org_id,donor_id,goal,created_by,created_by_name) VALUES ('cp3h_a',$1,'d3h_amara','Gala lead gift','system:test','ACCESS-3 fixture'),
    ('cp3h_b',$1,'d3h_bram','Renew at $1,000','system:test','ACCESS-3 fixture'),('cp3h_x',$1,'d3h_xavier','zzhidden plan','system:test','ACCESS-3 fixture')`, [ORG]);
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,assigned_to,assigned_to_name,care_plan_id,touch_type,created_by,created_by_name) VALUES
    ('t3h_a1',$1,'d3h_amara','Tour the studio with Amara',$2,$5,'Sam Zzcabinet','cp3h_a','visit','system:test','ACCESS-3 fixture'),
    ('t3h_b1',$1,'d3h_bram','Send Bram the impact note',$3,$5,'Sam Zzcabinet','cp3h_b','email','system:test','ACCESS-3 fixture'),
    ('t3h_a2',$1,'d3h_amara','Ask Amara for the lead gift',$4,$5,'Sam Zzcabinet','cp3h_a','ask','system:test','ACCESS-3 fixture'),
    ('t3h_x1',$1,'d3h_xavier','zzhidden touch Xavier',$2,$6,'Ada Zzadmin','cp3h_x','call','system:test','ACCESS-3 fixture')`,
    [ORG, day(3), day(9), day(30), cab, admin]);
}

async function signIn(email) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const b = await r.json();
  if (!b.token) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return b;
}
const get = (tok, p) => fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
const leaked = t => MARKS.filter(m => String(t || "").toLowerCase().includes(m));

// What the card must say, from shared/numbers over exactly their people (the
// fixture's own list, never the route's predicate).
async function expected() {
  const only = { sql: " AND d.id = ANY(?)", args: [MINE] };
  const [org] = await query("SELECT * FROM orgs WHERE id = ?", [ORG]);
  const fy = N.fiscalYear.fiscalYearToDate(org);
  const [people] = await query(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = ? AND ${N.everyone.EVERYONE("d")}${only.sql}`, [ORG, ...only.args]);
  const given = await N.givingBetween.givingBetween(query, ORG, { from: fy.from, to: fy.to, today: fy.today, visible: only });
  const top = await N.givingBetween.givingBetweenByPerson(query, ORG, { from: fy.from, to: fy.to, today: fy.today, visible: only, limit: 5 });
  const overdue = await N.nextSteps.peopleWithStepOverdue(query, ORG, fy.today, only);
  return { people: people.n, givenCents: given.cents, top, overdue, fy };
}

// The admin's Home, as a shape: what is in the header and in what rows, the
// work column's blocks, the Ask rows' reserved heights, and the rail's cards.
function adminShape() {
  const top = el => el ? Math.round(el.getBoundingClientRect().top) : null;
  const org = document.querySelector('[data-testid="home-greeting"] span[title]');
  const line = document.querySelector('[data-testid="home-greeting-line"]');
  const h1 = document.querySelector("h1.home-day");
  const rail = document.querySelector('[data-testid="home-rail"]');
  const tries = document.querySelector('[data-testid="ask-tries"]'), under = document.querySelector('[data-testid="ask-under"]');
  return {
    orgAndGreetingOneRow: !!org && !!line && Math.abs(top(org) - top(line)) <= 4,
    dateUnderGreeting: !!h1 && !!line && top(h1) > top(line),
    workBlocks: [...document.querySelectorAll(".home-shell-main > *")].map(e => e.className || e.tagName.toLowerCase()),
    askRows: { tries: tries ? Math.round(tries.getBoundingClientRect().height) : null, under: under ? Math.round(under.getBoundingClientRect().height) : null },
    moves: !!document.querySelector('[data-testid="home-moves"], .moves-deck, .moves-card'),
    railCards: rail ? [...rail.children].map(c => c.getAttribute("data-testid") || c.className || c.tagName.toLowerCase()) : null,
    portfolioCard: !!document.querySelector('[data-testid="home-portfolio"]'),
  };
}

(async () => {
  await seed();
  const cab = await signIn(U.cab[1]), empty = await signIn(U.empty[1]), admin = await signIn(U.admin[1]);
  const want = await expected();
  ok("fixture: their people gave this year, and outside people gave more", want.givenCents > 0 && want.top.length === 5 && want.people === MINE.length, want);

  // §card
  const r = await get(cab.token, "/home/portfolio");
  const text = await r.text();
  let card = null; try { card = JSON.parse(text); } catch { /* not JSON */ }
  ok("§card the cabinet member's card answers 200, scoped", r.status === 200 && card && card.scoped === true && card.empty === false, { status: r.status, body: text.slice(0, 160) });
  card = card || {};
  ok("§card their count is Everyone over their people (the household's member in, the trash out)", card.people === want.people, { got: card.people, want: want.people });
  ok("§card given this fiscal year is shared/numbers over their people, to the cent", card.givenCents === want.givenCents, { got: card.givenCents, want: want.givenCents });
  ok("§card people with a next step overdue is theirs (Amara; Xavier's is outside)", card.overdue === want.overdue && want.overdue === 1, { got: card.overdue, want: want.overdue });
  ok("§card the top five are theirs, by this year's giving, each to the cent",
    JSON.stringify((card.top || []).map(t => [t.id, t.cents])) === JSON.stringify(want.top.map(t => [t.id, t.cents])), { got: card.top, want: want.top });
  const next = card.next || [];
  ok("§card the next three are the soonest open touches and follow-ups on their Top 100 rows, with dates, one line per step",
    next.length === 3 && next.every(n => /^\d{4}-\d{2}-\d{2}$/.test(n.due || "") && MINE.includes(n.donorId))
      && next.map(n => n.label).join("|") === "call Amara about the spring visit|Tour the studio with Amara|Send Bram the impact note",
    next);
  ok("§card nobody outside their portfolio is named anywhere in it", !leaked(text).length, leaked(text));

  // §empty / §admin
  const e = await get(empty.token, "/home/portfolio").then(x => x.json());
  ok("§empty no one assigned: the sentence, and no figures", e.scoped === true && e.empty === true && e.sentence === "No one is assigned to you yet. Ask your admin to assign donors." && e.givenCents === undefined && e.people === undefined, e);
  const a = await get(admin.token, "/home/portfolio").then(x => x.json());
  ok("§admin an admin gets no portfolio card", a && a.scoped === false && a.givenCents === undefined, a);

  // §export
  const xc = await get(cab.token, "/donors/export/csv"), xa = await get(admin.token, "/donors/export/csv");
  const xcText = await xc.text();
  ok("§export the cabinet member's export is refused 403 (a capability), naming nobody", xc.status === 403 && !leaked(xcText).length, { status: xc.status, body: xcText.slice(0, 120) });
  ok("§export an admin's export still downloads", xa.status === 200, xa.status);

  // ── The browser legs ──
  let chromium = null;
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); } catch { /* below */ }
  if (browserLegOrSkip(chromium ? null : "Playwright not found (set PLAYWRIGHT_DIR)")) { await closeDb(); summary(); return; }
  const browser = await chromium.launch();
  const open = async (who, pathName = "/dashboard") => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await pinBrowserClock(ctx);
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [who.token, JSON.stringify(who.user), JSON.stringify(who.org || {})]);
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", x => errors.push(x.message));
    await page.goto(APP + pathName, { waitUntil: "load" });
    return { ctx, page, errors };
  };
  const homeReady = page => page.waitForSelector('[data-testid="home-rail"][data-ready="1"]', { timeout: 30000 }).then(() => page.waitForTimeout(1200));

  // §same first: the admin's Home has main's shape.
  {
    const { ctx, page } = await open(admin);
    await homeReady(page);
    const shape = await page.evaluate(adminShape);
    if (process.env.CAPTURE === "1") { fs.writeFileSync(SNAP, JSON.stringify(shape, null, 2) + "\n"); console.log("  captured", SNAP); }
    const snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, "utf8")) : null;
    ok("§same an admin's Home has the shape it had on main", !!snap && JSON.stringify(shape) === JSON.stringify(snap), { now: shape, main: snap });
    await ctx.close();
  }

  // §band, §rail, §head
  {
    const { ctx, page, errors } = await open(cab);
    await homeReady(page);
    await page.waitForSelector('[data-testid="home-portfolio"]', { timeout: 15000 }).catch(() => {});
    const m = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const col = document.querySelector(".home-shell-main");
      // Every leaf on screen in the work column, top to bottom.
      const leaves = col ? [...col.querySelectorAll("*")].filter(el => {
        if (el.children.length && [...el.children].some(c => box(c).height > 0)) return false;
        const r = box(el), cs = getComputedStyle(el);
        return r.height > 0 && r.width > 0 && cs.visibility !== "hidden" && (el.innerText || "").trim() || ["INPUT", "BUTTON", "IMG", "svg"].includes(el.tagName) && r.height > 0;
      }).map(el => { const r = box(el); return { t: Math.round(r.top), b: Math.round(r.bottom), what: (el.innerText || el.tagName).slice(0, 40) }; }).sort((x, y) => x.t - y.t) : [];
      let gap = 0, at = null, reach = leaves.length ? leaves[0].b : 0;
      for (const l of leaves) { if (l.t - reach > gap) { gap = l.t - reach; at = l.what; } reach = Math.max(reach, l.b); }
      const ask = document.querySelector("form.ask-hero-box"), threadHead = [...document.querySelectorAll(".home-shell-main *")].find(el => el.children.length === 0 && /^The Thread$/.test((el.textContent || "").trim()));
      const h1 = document.querySelector("h1.home-day"), line = document.querySelector('[data-testid="home-greeting-line"]'), org = document.querySelector('[data-testid="home-org-name"]');
      const card = document.querySelector('[data-testid="home-portfolio"]');
      const rail = document.querySelector('[data-testid="home-rail"]');
      return { gap, at, askToThread: ask && threadHead ? Math.round(box(threadHead).top - box(ask).bottom) : null,
        h1: h1 ? { t: box(h1).top, b: box(h1).bottom, size: parseFloat(getComputedStyle(h1).fontSize) } : null,
        line: line ? { t: box(line).top, b: box(line).bottom, text: line.innerText, size: parseFloat(getComputedStyle(line).fontSize) } : null,
        org: org ? { t: box(org).top, text: org.innerText, size: parseFloat(getComputedStyle(org).fontSize) } : null,
        card: card ? card.innerText : null, railCards: rail ? rail.children.length : 0,
        topLinks: card ? [...card.querySelectorAll('[data-testid="portfolio-top"] button, [data-testid="portfolio-top"] a')].map(b => b.innerText) : [] };
    });
    ok("§band no empty band in the work column (no gap over 64 px between things on screen)", m.gap <= 64, { gap: m.gap, before: m.at });
    ok("§band the Thread sits under the Atlas box", m.askToThread != null && m.askToThread <= 72, m.askToThread);
    const money = c => "$" + Math.round(c / 100).toLocaleString("en-US");
    const cardText = m.card || "";
    ok("§rail the rail is one card, Your portfolio", m.railCards === 1 && /^Your portfolio/.test(cardText), { cards: m.railCards, text: cardText.slice(0, 80) });
    ok("§rail its figures are the route's: people, given this year, overdue",
      cardText.includes(`${want.people} people`) && cardText.includes(money(want.givenCents)) && cardText.includes(`${want.overdue} with a next step overdue`), cardText);
    ok("§rail the top five by this year's giving, in order", JSON.stringify(m.topLinks.map(x => x.split("\n")[0])) === JSON.stringify(want.top.map(t => t.name)), { got: m.topLinks, want: want.top.map(t => t.name) });
    ok("§rail the next touches show with their dates", next.every(n => cardText.includes(n.label)), cardText);
    ok("§rail nobody outside their portfolio is on Home", !leaked(cardText).length, leaked(cardText));
    ok("§head the date is the headline, the greeting its own line under it, the org's name small under that",
      m.h1 && m.line && m.org && m.line.t >= m.h1.b - 1 && m.org.t >= m.line.b - 1 && m.org.size < m.line.size + 0.01 && m.org.size <= 13 && /Sam$/.test(m.line.text) && m.org.text === "Zzwren Valley Arts Trust", m);
    // The top five open their profiles.
    await page.locator('[data-testid="portfolio-top"] button').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    ok("§rail a name in the top five opens their profile", /Amara Zzokafor/.test(await page.locator("h1, h2").allInnerTexts().then(t => t.join("|")).catch(() => "")) || /donors/.test(page.url()), page.url());
    ok("§band their Home threw no error", !errors.length, errors);
    // §button
    await page.goto(APP + "/donors", { waitUntil: "load" });
    await page.waitForSelector("text=Everyone", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const exportBtn = await page.locator("button", { hasText: "Export CSV" }).count();
    const listed = await page.locator("text=Amara Zzokafor").count();
    ok("§button their Donors list has no Export CSV button", listed > 0 && exportBtn === 0, { exportBtn, listed });
    await ctx.close();
  }

  // §rail, empty
  {
    const { ctx, page } = await open(empty);
    await homeReady(page);
    await page.waitForSelector('[data-testid="home-portfolio"]', { timeout: 15000 }).catch(() => {});
    const t = await page.locator('[data-testid="home-portfolio"]').innerText().catch(() => "");
    ok("§rail an empty portfolio says so, with no zeros", t.includes("No one is assigned to you yet. Ask your admin to assign donors.") && !/\$0\b|\b0 people/.test(t), t);
    await ctx.close();
  }

  await browser.close();
  await wipe();
  await closeDb();
  summary();
})().catch(async err => { console.error(err); ok("suite ran to the end", false, err.message); await closeDb().catch(() => {}); summary(); });

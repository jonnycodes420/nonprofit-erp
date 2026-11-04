#!/usr/bin/env node
// LIST-2 · THE DONORS LIST SHOWS WHAT YOU ASKED FOR.
//
// Guards donor data: a list that says "Tag, Cultivate, Bo Owner" must hold
// exactly those people, a money filter must read the profile's own figure,
// a sort must sort by its column, search must open the person, and Data
// health's counts must be counts. Driven through the real screens on a
// fixture of 1,000 made-up people, reading the rows and the count line she
// sees (not only the API):
//
//   §1 a tag chip, a stage and an owner from the filter bar show exactly the
//      matching people, and the count line counts the rows shown; a reload
//      keeps the filters (the URL holds them); clearing one widens the list
//   §2 Lifetime at least $20,000 excludes a $19,500 donor (whose stored total
//      is stale) and includes a $20,000 one: the profile's figure decides
//   §3 Last gift sorts by the last gift's date, both ways, no-gift people last;
//      Name sorts by last name, then first
//   §4 the top bar searches as she types and Enter opens the top match; the
//      profile opened from Cmd+K never reads "undefined" while it loads; a
//      missing person says so; search matches accents, households and orgs
//   §5 Data health: People and their businesses is people + organizations,
//      each once; Review pairs finishes in under 5 s
//   §6 the filtered list's first rows come in under a second at 20 ms latency
//
// Against a booted server at $BASE and the client dist at $APP_URL.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip, civilToday } = require("./helpers");
const { DIST } = require("./lib/dist");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const ORG = "org_list2", SLUG = "list2-test";
const A = { id: "u_list2a", email: "list2-admin@example.org", name: "Ada Listwell" };
const B = { id: "u_list2b", email: "list2-owner@example.org", name: "Bo Ownersby" };
const sys = "'system:test','test'";
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const FIRST = ["Arden", "Bexley", "Calla", "Dorian", "Elowen", "Fenwick", "Galen", "Hollis", "Isadora", "Jasper", "Kestrel", "Linnea", "Merritt", "Nerys",
  "Orrin", "Perpetua", "Quill", "Rosalind", "Soren", "Tamsin", "Ulric", "Verity", "Wren", "Xanthe", "Yorick", "Zelda", "Ansel", "Briony", "Caspian", "Delphine",
  "Emrys", "Florian", "Ginevra", "Hartley", "Ione", "Jory", "Keziah", "Leander", "Mireille", "Niall"];
const LAST = ["Abernook", "Bramblecote", "Corriveau", "Dunsmore", "Eversholt", "Fairweather", "Gallowglass", "Hawksmoor", "Ingleby", "Jessamine", "Kettleburn",
  "Larkspur", "Mortlake", "Nethercott", "Oakhurst", "Penhallow", "Quenby", "Rookwood", "Saltmarsh", "Tregarthen", "Underhill", "Vanstone", "Whitlock", "Yarrowby", "Zennor"];

async function reset(org) {
  const first = ["data_health_dismissals", "donor_relationships", "gifts", "households", "donor_list_views", "donor_list_layouts", "interactions", "tasks", "donors", "user_sessions", "users"];
  for (const t of first) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

(async () => {
  console.log("list2-list-shows (LIST-2)");
  const today = civilToday();
  const plus = d => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  await reset(ORG);
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,onboarded_at,vocabulary_json)
           VALUES ($1,'List Two Harbor',$2,1,'active','team','America/New_York',NOW(),NOW(),'{"fiscal_year_start_month":1}')`, [ORG, SLUG]);
  for (const [u, role] of [[A, "admin"], [B, "staff"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [u.id, ORG, u.email, pw, u.name, role]);

  // ── §0 The fixture: 1,000 made-up people ──
  // i = 0..999. Every tenth person is an organization (100). Everyone, the
  // organizations too, has an email at one shared placeholder domain, the
  // shape that multiplied Data health's businesses count. Gifts: person i
  // gives (i % 7 + 1) gifts unless i % 9 === 0 (no gift at all). The last
  // gift's date and the lifetime are unrelated, so the two sorts differ.
  const people = [];
  for (let i = 0; i < 1000; i++) {
    const org = i % 10 === 9;
    const last = LAST[i % 25], first = FIRST[Math.floor(i / 25)];
    const name = org ? `${first} ${last} Trust` : `${first} ${last}`;
    people.push({ id: `d_l2_${i}`, i, name, last, first, org, stage: STAGES[i % 6],
      owner: i % 4 === 0 ? B.id : i % 4 === 1 ? A.id : null, tag: i % 5 === 0, gifts: i % 9 === 0 ? 0 : (i % 7) + 1,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@sharedmail.example` });
  }
  // The named people the checks read.
  const named = {
    rhea: { name: "Rhea Thornquist", lifetime: 19500, stale: 20500 },    // stored total stale above $20,000
    silas: { name: "Silas Thornquist", lifetime: 20000 },
    juno: { name: "Juno Marchetti", lifetime: 16250 },
    zoe: { name: "Zoë Ångström", lifetime: 300 },
    ivo: { name: "Ivo Pemberley", lifetime: 500, household: "The Calloway household" },
    tess: { name: "Tess Quarrington", lifetime: 900, linkedOrg: "Brightwater Mills" },
  };
  let n = 1000;
  for (const [k, v] of Object.entries(named)) {
    const [first, ...rest] = v.name.split(" ");
    people.push({ id: `d_l2_${k}`, i: n++, name: v.name, last: rest.join(" "), first, org: false, stage: "cultivate", owner: B.id, tag: false, gifts: 0,
      email: `${k}@example.org`, ...v });
  }
  // Five true person/business pairs (a last name in the organization's name and a shared
  // address), and one work email at an organization's own domain: 6 people + 6 organizations.
  const links = [["Hawksmoor", "1 Quay Lane"], ["Larkspur", "2 Quay Lane"], ["Mortlake", "3 Quay Lane"], ["Oakhurst", "4 Quay Lane"], ["Rookwood", "5 Quay Lane"]];
  links.forEach(([last, addr], j) => {
    people.push({ id: `d_l2_bp${j}`, i: n++, name: `Petra ${last}`, last, first: "Petra", org: false, stage: "qualify", owner: null, tag: false, gifts: 0, email: `petra${j}@example.net`, address: addr });
    people.push({ id: `d_l2_bo${j}`, i: n++, name: `${last} Joinery Ltd`, last, first: "", org: true, stage: "qualify", owner: null, tag: false, gifts: 0, email: `office${j}@example.com`, address: addr });
  });
  people.push({ id: "d_l2_wp", i: n++, name: "Wendell Yarby", last: "Yarby", first: "Wendell", org: false, stage: "qualify", owner: null, tag: false, gifts: 0, email: "wendell@brightwatermills.example" });
  people.push({ id: "d_l2_wo", i: n++, name: "Brightwater Mills", last: "", first: "", org: true, stage: "qualify", owner: null, tag: false, gifts: 0, email: "hello@brightwatermills.example" });
  // Twelve duplicate pairs: the same email, a second record with a middle initial.
  for (let j = 0; j < 12; j++) {
    const p = people[j * 7 + 1];
    if (p.org) continue;
    people.push({ ...p, id: `d_l2_dup${j}`, i: n++, name: `${p.first} Q. ${p.last}`, tag: false, gifts: 0, owner: null, lifetime: undefined, stale: undefined });
  }

  const hh = "hh_l2_calloway";
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,$3,${sys})`, [hh, ORG, named.ivo.household]);
  // Insert set-wise: one statement for the donors, one for the gifts.
  const rows = people.map(p => [p.id, p.name, p.email, p.org ? "organization" : "person", p.stage, p.owner, p.owner === A.id ? A.name : p.owner === B.id ? B.name : null,
    p.tag ? JSON.stringify(["Board prospect"]) : null, p.address || null, p.household ? hh : null, p.address ? "Port Wren" : null, p.address ? "04999" : null]);
  const col = k => rows.map(r => (r[k] == null ? null : String(r[k])));
  await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,assigned_to,assigned_to_name,tags,address,household_id,city,zip,person_types,created_by,created_by_name)
           SELECT u.id, $1, u.name, u.email, u.kind, u.stage, u.owner, u.owner_name, u.tags, u.address, u.hh, u.city, u.zip,
                  CASE WHEN u.kind = 'organization' THEN '["donor","organization"]'::jsonb ELSE '["donor"]'::jsonb END, 'system:test', 'test'
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[])
                  AS u(id, name, email, kind, stage, owner, owner_name, tags, address, hh, city, zip)`,
  [ORG, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(col)]);
  const [{ c: inserted }] = await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1`, [ORG]);
  ok("§0 the fixture holds at least 1,000 made-up people", inserted >= 1000 && inserted === people.length, `${inserted} of ${people.length}`);
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,created_by,created_by_name)
           VALUES ('drel_l2_tess',$1,'d_l2_tess','d_l2_wo','employee',${sys})`, [ORG]);
  // Gifts: (id, donor, amount, date).
  const gifts = [];
  for (const p of people) {
    if (p.lifetime) { gifts.push([`g_l2_${p.id}_1`, p.id, p.lifetime, plus(-(40 + p.i % 300))]); continue; }
    for (let k = 0; k < p.gifts; k++) gifts.push([`g_l2_${p.id}_${k}`, p.id, 25 * ((p.i * 13 + k * 7) % 40 + 1), plus(-((p.i * 37 + k * 101) % 1400) - 1)]);
  }
  for (let s = 0; s < gifts.length; s += 500) {
    const part = gifts.slice(s, s + 500);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
             SELECT u.id, $1, u.donor, u.amount, u.date, 'check', 'system:test', 'test'
               FROM unnest($2::text[], $3::text[], $4::numeric[], $5::text[]) AS u(id, donor, amount, date)`,
    [ORG, part.map(g => g[0]), part.map(g => g[1]), part.map(g => g[2]), part.map(g => g[3])]);
  }
  const { query: dbq } = require("../db");
  await require("../afterChange").recalcDonorSummaryBatch(dbq, people.map(p => p.id), ORG);
  // Rhea's stored total is stale (a gift recorded above the line, then refunded off the file
  // without a recompute): the profile reads her gifts, $19,500.
  await q(`UPDATE donors SET total_giving=$2 WHERE org_id=$1 AND id='d_l2_rhea'`, [ORG, named.rhea.stale]);
  await q(`ANALYZE donors`); await q(`ANALYZE gifts`);

  // The independent key: what each check should show, from the fixture, not the app.
  const byName = new Map(people.map(p => [p.name, p]));
  const lastGift = new Map(), lifetime = new Map();
  for (const g of gifts) {
    lastGift.set(g[1], [lastGift.get(g[1]), g[3]].filter(Boolean).sort().pop());
    lifetime.set(g[1], (lifetime.get(g[1]) || 0) + g[2]);
  }
  const tok = await login(A.email);
  ok("the admin signs in", !!tok);

  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (process.env.LIST2_FIXTURE_ONLY === "1") { await closeDb(); summary(); return; }
  if (browserLegOrSkip(why, "(browser leg)")) { await reset(ORG); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: A.email, password: "loadtest1234" });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await ctx.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  // 100 rows a page, so every match of §1 is on screen at once.
  await api("PUT", "/donors/list-layout", tok, { columns: ["name", "stage", "owner", "lifetime", "last_gift_date"], pageSize: 100 });
  const page = await ctx.newPage();
  const settle = async () => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(400); };
  // The rows she sees, by name (each fixture name is unique), and the count line.
  const shownNames = async () => page.locator(".dir-donor-row").evaluateAll(rs => rs.filter(r => r.offsetParent !== null)
    .map(r => (r.querySelector(".dir-m-name, [data-testid='dir-name']") || r).innerText.split("\n").map(s => s.trim()).filter(Boolean)));
  const rowNames = async () => (await shownNames()).map(lines => lines.find(l => byName.has(l)) || lines.find(l => byName.has(l.replace(/\s+·.*$/, ""))) || lines[0]);
  const countLine = async () => {
    const t = await page.locator("body").innerText();
    const m = t.match(/([\d,]+) (?:people match|person matches)/) || t.match(/\n([\d,]+) (?:donors|donor|people|person)\n/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const addChip = async (search, key, value, op) => {
    await page.locator('[data-testid="dir-add-filter"]').click();
    await page.locator('[data-testid="filter-field-search"]').fill(search);
    await page.locator(`[data-testid="filter-field-${key}"]`).click();
    if (op) await page.locator('[data-testid="filter-op"]').selectOption(op);
    const v = page.locator('[data-testid="filter-value"]');
    if ((await v.evaluate(el => el.tagName)) === "SELECT") await v.selectOption(value); else await v.fill(value);
    await page.locator('[data-testid="filter-apply"]').click();
    await settle();
  };

  // ── §1 tag + stage + owner ──
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
  ok("§1 the list opens on everyone", (await countLine()) === people.length, await countLine());
  await addChip("Tags", "tags", "Board prospect");
  await page.locator("select", { has: page.locator("option", { hasText: "All stages" }) }).first().selectOption("cultivate");
  await settle();
  await page.locator("select", { has: page.locator("option", { hasText: "All owners" }) }).first().selectOption(B.id);
  await settle();
  const want1 = people.filter(p => p.tag && p.stage === "cultivate" && p.owner === B.id).map(p => p.name).sort();
  const got1 = (await rowNames()).sort();
  ok("§1 tag + stage + owner shows exactly the matching people", JSON.stringify(got1) === JSON.stringify(want1) && want1.length > 5, `want ${want1.length} ${want1.slice(0, 4)} got ${got1.length} ${got1.slice(0, 4)}`);
  ok("§1 the count line is the count of the rows shown", (await countLine()) === want1.length, `${await countLine()} vs ${want1.length}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 }).catch(() => {});
  await settle();
  const got1r = (await rowNames()).sort();
  ok("§1 a reload keeps every filter (the URL holds them)", JSON.stringify(got1r) === JSON.stringify(want1) && (await page.locator('[data-testid="filter-chip"]').count()) === 1,
    `${got1r.length} rows after reload, ${page.url()}`);
  await page.locator("select", { has: page.locator("option", { hasText: "All owners" }) }).first().selectOption("");
  await settle();
  const want1b = people.filter(p => p.tag && p.stage === "cultivate").length;
  ok("§1 clearing the owner widens the list", (await countLine()) === want1b && want1b > want1.length, `${await countLine()} vs ${want1b}`);

  // ── §2 Lifetime at least $20,000 ──
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle" });
  await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
  await page.locator('text=Clear filters').click().catch(() => {});
  await settle();
  await addChip("Lifetime", "lifetime", "20000", "gte");
  const got2 = await rowNames();
  const want2 = people.filter(p => (lifetime.get(p.id) || 0) >= 20000).map(p => p.name).sort();
  ok("§2 Lifetime at least $20,000 includes the $20,000 donor", got2.includes(named.silas.name), got2.slice(0, 6));
  ok("§2 and excludes the $19,500 donor (stored total stale) and the $16,250 one", !got2.includes(named.rhea.name) && !got2.includes(named.juno.name), got2.slice(0, 6));
  ok("§2 the rows are exactly the people whose gifts add to $20,000 or more", JSON.stringify([...got2].sort()) === JSON.stringify(want2), `want ${want2.length} got ${got2.length}`);

  // ── §3 sorts ──
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle" });
  await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
  await page.locator('text=Clear filters').click().catch(() => {});
  await settle();
  const header = k => page.locator(`[data-testid="dir-col-head-${k}"]`).first();
  const pageDates = async () => (await rowNames()).map(nm => lastGift.get((byName.get(nm) || {}).id) || "");
  await header("last_gift_date").click(); await settle();
  const d1 = await pageDates();
  const desc = d1.filter(Boolean);
  ok("§3 Last gift (first click) orders by the last gift's date, newest first", desc.length > 50 && desc.every((d, i) => i === 0 || desc[i - 1] >= d) && d1.indexOf("") === -1,
    d1.slice(0, 8).join(","));
  await header("last_gift_date").click(); await settle();
  const d2 = await pageDates();
  ok("§3 again: oldest first", d2.filter(Boolean).every((d, i, a) => i === 0 || a[i - 1] <= d) && d2[0] !== "", d2.slice(0, 8).join(","));
  // The last page holds the people with no gift, last either way.
  const noGift = people.filter(p => !lastGift.has(p.id)).length;
  const r3 = await api("GET", `/donors?role=donor&limit=100&offset=${people.length - 100}&sort=last_gift_date&dir=asc`, tok);
  const tail = (r3.body.donors || []).map(d => lastGift.get(d.id) || "");
  ok("§3 people with no gift sort last, oldest-first too", noGift > 50 && tail.slice(-Math.min(noGift, 100)).every(x => x === ""), tail.slice(-5).join(","));
  const r3b = await api("GET", `/donors?role=donor&limit=100&offset=${people.length - 100}&sort=lifetime&dir=asc`, tok);
  ok("§3 and lowest-lifetime-first too", (r3b.body.donors || []).slice(-Math.min(noGift, 100)).every(d => !lastGift.has(d.id)), (r3b.body.donors || []).slice(-3).map(d => d.name));
  await header("name").click(); await settle();
  const names = await rowNames();
  const key = nm => { const p = byName.get(nm) || { last: nm, first: "" }; return (p.org ? p.name : `${p.last} ${p.first}`).toLowerCase(); };
  const sortedNames = [...names].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  ok("§3 Name sorts by last name, then first", names.length > 50 && JSON.stringify(names) === JSON.stringify(sortedNames), names.slice(0, 6));
  const p1 = await api("GET", `/donors?role=donor&limit=50&offset=0&sort=name&dir=asc`, tok), p2 = await api("GET", `/donors?role=donor&limit=50&offset=50&sort=name&dir=asc`, tok);
  const both = [...(p1.body.donors || []), ...(p2.body.donors || [])].map(d => d.id);
  ok("§3 paging keeps the order: page two continues page one, no one twice", new Set(both).size === 100);

  // ── §4 search ──
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  const box = page.locator('[data-testid="global-search"]').first();
  await box.click();
  await box.pressSequentially("Quarrington", { delay: 30 });
  await page.locator('[data-testid="search-result"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  const drop = await page.locator('[data-testid="search-dropdown"]').innerText().catch(() => "");
  ok("§4 the top bar shows results as she types a last name", drop.includes(named.tess.name), drop.slice(0, 200));
  await box.fill("");
  await box.pressSequentially("Thornqu", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/donors\/d_l2_/, { timeout: 8000 }).catch(() => {});
  ok("§4 Enter opens the top match's profile, even before the answer has landed", /\/donors\/d_l2_(rhea|silas)$/.test(new URL(page.url()).pathname), page.url());
  // Cmd+K, with the profile's own read held back 1.5 s: no "undefined" while it loads.
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.route(/\/donors\/d_l2_juno$/, async r => { await new Promise(res => setTimeout(res, 1500)); await r.continue(); });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.keyboard.type("Marchetti", { delay: 20 });
  await page.locator('[data-testid="search-result"]', { hasText: named.juno.name }).first().click({ timeout: 8000 });
  let sawUndefined = "", sawLoading = false;
  for (let t = 0; t < 12; t++) {
    const txt = await page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[aria-label],[title],[alt]")]
      .map(e => [e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("alt")].filter(Boolean).join(" ")).join(" "));
    if (/undefined/.test(txt)) sawUndefined = txt.match(/.{0,40}undefined.{0,20}/)[0];
    if (/Loading/.test(txt)) sawLoading = true;
    await page.waitForTimeout(200);
  }
  await page.getByText(named.juno.name).first().waitFor({ timeout: 8000 }).catch(() => {});
  ok("§4 the profile opened from Cmd+K never reads \"undefined\"", !sawUndefined, sawUndefined);
  ok("§4 while it loads it shows the loading state, then the person", sawLoading && (await page.locator("body").innerText()).includes(named.juno.name));
  ok("§4 Cmd+K opens the same profile route a list click opens", new URL(page.url()).pathname === "/donors/d_l2_juno", page.url());
  await page.unroute(/\/donors\/d_l2_juno$/);
  await page.goto(`${APP}/donors/d_l2_nobody`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const missing = await page.locator("body").innerText();
  ok("§4 a missing person reads \"We couldn't find this person\"", /We couldn.t find this person/.test(missing) && !/undefined/.test(missing), missing.slice(0, 200));
  const find = async term => ((await api("GET", `/search?q=${encodeURIComponent(term)}`, tok)).body.results || []).filter(r => r.kind === "person").map(r => r.title);
  ok("§4 search ignores accents and case (\"zoe angstrom\")", (await find("zoe angstrom")).includes(named.zoe.name));
  ok("§4 search by first and last name together", (await find("Silas Thornquist")).includes(named.silas.name));
  ok("§4 search by email", (await find("tess@example.org")).includes(named.tess.name));
  ok("§4 search by household name finds its members", (await find("Calloway")).includes(named.ivo.name));
  ok("§4 search by organization name finds the person linked to it", (await find("Brightwater")).includes(named.tess.name));

  // ── §5 Data health ──
  const t5 = performance.now();
  await page.goto(`${APP}/donors?view=health`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  const line = page.locator('[data-testid="dh-line-businesses"]');
  await line.waitFor({ timeout: 30000 }).catch(() => {});
  const lineText = await line.innerText().catch(() => "");
  const wantBiz = links.length * 2 + 2;   // 6 people + 6 organizations, each once
  ok("§5 People and their businesses counts each person and organization once", new RegExp(`\\b${wantBiz}\\b`).test(lineText) && !/\d{3},\d{3}/.test(lineText), lineText.slice(0, 200));
  const dup = page.locator('[data-testid="dh-line-duplicates"]');
  await dup.locator("button", { hasText: "Review pairs" }).first().click({ timeout: 10000 }).catch(() => dup.click().catch(() => {}));
  const done5 = await page.locator('[data-testid="dh-duplicates"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const panel = await page.locator('[data-testid="dh-duplicates"]').innerText().catch(() => "");
  ok("§5 Review pairs finishes in under 5 s with the pairs to review", done5 && /\d+ possible duplicates?/.test(panel), `${Math.round(performance.now() - t5)}ms ${panel.slice(0, 80)}`);

  // ── §6 timing: the filtered list at 20 ms added latency ──
  const slow = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await slow.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const sp = await slow.newPage();
  await sp.route(/localhost:\d+\/(?!assets)/, async r => { await new Promise(res => setTimeout(res, 20)); await r.continue(); });
  await sp.goto(`${APP}/donors`, { waitUntil: "networkidle" });
  await sp.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
  const sel = sp.locator("select", { has: sp.locator("option", { hasText: "All stages" }) }).first();
  const t6 = performance.now();
  const resp = sp.waitForResponse(r => /\/donors\?.*stage=solicit/.test(r.url()), { timeout: 10000 });
  await sel.selectOption("solicit");
  await resp;
  await sp.waitForFunction(() => [...document.querySelectorAll(".dir-donor-row")].length > 0 && /Solicit/.test(document.querySelector(".dir-donor-row").innerText), null, { timeout: 10000 }).catch(() => {});
  const ms6 = performance.now() - t6;
  console.log(`  filtered Donors list, first rows at 20 ms latency: ${Math.round(ms6)}ms`);
  ok("§6 the filtered list's first rows come in under a second at 20 ms latency", ms6 < 1000, `${Math.round(ms6)}ms`);
  await slow.close();

  // ── §7 straight after an import ──
  // The 4 Nov prod read: GET /donors took 146 s on a fresh 6,395-person org
  // right after its import. The list's drift step wrote its answers back
  // (INSERT ... ON CONFLICT on donor_drift) and waited on the row locks of
  // the post-import job's own drift transaction. (a) is that wait, made
  // certain: one connection holds the first page's donor_drift rows, as the
  // job does, while the list is read. (b) is the real thing: a fresh org, a
  // 6,400-person file through the importer, and the list at once.
  const { Client } = require("pg");
  const holder = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
  await holder.connect();
  const first = await api("GET", "/donors?role=donor&limit=50&offset=0", tok);
  const pageIds = (first.body.donors || []).map(d => d.id);
  await q(`UPDATE donor_drift SET computed_for = '2000-01-01' WHERE org_id = $1 AND donor_id = ANY($2)`, [ORG, pageIds]);
  await holder.query("BEGIN");
  await holder.query(`SELECT 1 FROM donor_drift WHERE org_id = $1 AND donor_id = ANY($2) FOR UPDATE`, [ORG, pageIds]);
  const t7 = performance.now();
  const locked = await Promise.race([api("GET", "/donors?role=donor&limit=50&offset=0", tok), new Promise(r => setTimeout(() => r({ status: "timeout" }), 8000))]);
  const ms7 = performance.now() - t7;
  await holder.query("ROLLBACK").catch(() => {});
  await holder.end();
  console.log(`  the list while another transaction holds its people's drift rows: ${Math.round(ms7)}ms`);
  ok("§7a the list never waits on another transaction's drift rows (a GET writes nothing)", locked.status === 200 && ms7 < 1000, `${locked.status} ${Math.round(ms7)}ms`);

  const IMP = "org_list2_imp", impEmail = "list2-imp@example.org";
  await reset(IMP);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'List Two Import','list2-imp',1,'active','team','America/New_York')`, [IMP]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_list2imp',$1,$2,$3,'Ada Import','admin')`, [IMP, impEmail, pw]);
  const itok = await login(impEmail);
  const sheets = [{ name: "Gifts", grid: require("./lib/bigSheet").bigGiftRows(6400, 25000) }];
  const und = await api("POST", "/sheet-import/understand", itok, { fileName: "gifts.csv", sheets, useModel: false });
  const com = await api("POST", "/sheet-import/commit", itok, { fileName: "gifts.csv", sheets, useModel: false, previewOrgId: IMP, background: true });
  let jobEnd = null;
  for (const t0i = performance.now(); performance.now() - t0i < 240000;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(com.body.importId)}`, itok);
    if (j.status === 200 && j.body.status !== "running") { jobEnd = j.body.status; break; }
    await new Promise(z => setTimeout(z, 500));
  }
  const [{ n: impPeople }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [IMP]);
  ok("§7b a 6,400-person file imports", und.status === 200 && com.status === 202 && jobEnd === "done" && impPeople === 6400, `${und.status} ${com.status} ${jobEnd} ${impPeople}`);
  const ilg = await api("POST", "/auth/login", null, { email: impEmail, password: "loadtest1234" });
  const ictx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ictx.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [ilg.body.token, JSON.stringify(ilg.body.user), JSON.stringify(ilg.body.org)]);
  const ip = await ictx.newPage();
  await ip.route(/localhost:\d+\/(?!assets)/, async r => { await new Promise(res => setTimeout(res, 20)); await r.continue(); });
  let listMs = null;
  ip.on("response", r => { if (listMs === null && /\/donors\?/.test(r.url()) && r.status() === 200) listMs = r.request().timing().responseEnd; });
  await ip.goto(`${APP}/donors`, { waitUntil: "domcontentloaded" });
  const t7b = performance.now();
  await ip.locator(".dir-donor-row").first().waitFor({ timeout: 180000 }).catch(() => {});
  const rowsMs = performance.now() - t7b;
  console.log(`  6,400 people straight after the import: the list's first rows ${Math.round(rowsMs)}ms after the page loaded (the read itself ${listMs === null ? "?" : Math.round(listMs)}ms)`);
  ok("§7b straight after the import, the list's first rows come in under a second", rowsMs < 1000 && (await ip.locator(".dir-donor-row").count()) > 0, `${Math.round(rowsMs)}ms`);
  await ictx.close();
  if (process.env.LIST2_KEEP !== "1") await reset(IMP);

  // ── §8 Done on the import receipt goes to the Donors list ──
  const csvPath = path.join(require("os").tmpdir(), `list2-done-${process.pid}.csv`);
  fs.writeFileSync(csvPath, "First Name,Last Name,Email\nMirabel,Ostrander,mirabel.ostrander@example.org\nCosimo,Ferrante,cosimo.ferrante@example.org\n");
  await page.goto(`${APP}/donors`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Import & tools/ }).click();
  await page.getByRole("menuitem", { name: /Import a spreadsheet/ }).first().click();
  await page.locator('[data-testid="sheet-file"]').setInputFiles(csvPath);
  await page.locator('[data-testid="sheet-import-go"]').click({ timeout: 30000 });
  await page.locator('[data-testid="sheet-done"]').waitFor({ timeout: 60000 });
  const before8 = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.locator('[data-testid="sheet-done"]').click();
  await page.waitForTimeout(1500);
  const u8 = new URL(page.url());
  const onList = u8.pathname === "/donors" && !/view=/.test(u8.search) && (await page.locator('[data-testid="dir-table"]').count()) === 1
    && (await page.locator('[data-testid="sheet-import"], [data-testid="sheet-result"]').count()) === 0;
  ok("§8 Done on the import receipt goes to the Donors list", onList, `${before8} → ${u8.pathname}${u8.search}`);
  fs.unlinkSync(csvPath);

  await browser.close();
  if (process.env.LIST2_KEEP !== "1") await reset(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });

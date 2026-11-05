#!/usr/bin/env node
// TABLE-1 · THE DONORS TABLE READS CLEANLY, AND STAYS CLEAN WHEN YOU MOVE OR RESIZE COLUMNS.
//
// Guards donor data as she reads it: a Lifetime that runs into the next
// column's words ("$40,709No owner") is a wrong number on screen. Driven in a
// browser on 40 made-up people, with Jonathan's 4 Nov column order (Lifetime
// before Owner, Phone and Stage at the end), reading the boxes the words
// actually take on screen:
//
//   §1 at 1440, 1280 and 1024 px: in every row, no two cells' words come
//      within 8 px of each other (touching is the defect, not only overlap);
//      every heading's edges are within 2 px of its column's cells, and its
//      words sit where the cells' words sit (left, right or centred); a
//      heading is one line; no row has words in a column with no heading
//   §2 every cell says one kind of thing: Engagement is a score and a word on
//      every row ("42 Warm", "— Quiet"); Phone is one format; the two-line
//      columns (Donor, Last gift) are two lines on every row, the rest one
//   §3 every column resized to the narrowest it allows: §1 holds, no column
//      is narrower than its min, and the table scrolls sideways instead
//   §4 Owner dragged before Lifetime: header and cells move together, the
//      width she gave Owner travels with it, both survive a reload; Reset
//      columns brings the default back, and the default fits at 1440
//   §5 a phone width shows the card list, never the squeezed table
//
// Against a booted server at $BASE and the client dist at $APP_URL.
// TABLE1_SHOTS=<dir> saves the before/after screenshots for the report.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const SHOTS = process.env.TABLE1_SHOTS || "";
const ORG = "org_table1", SLUG = "table1-test";
const A = { id: "u_table1a", email: "table1-admin@example.org", name: "Marisol Quenneville-Ashdown" };
const B = { id: "u_table1b", email: "table1-staff@example.org", name: "Teo Brandvold" };
const sys = "'system:test','test'";
// Jonathan's screen: Lifetime before Owner, the scores, then Phone and Stage.
const COLUMNS = ["name", "lifetime", "owner", "last_gift_date", "engagement", "generosity", "phone", "stage"];
// Where each column's words sit (the brief: text left, money right, badges centred).
const ALIGN = { name: "left", lifetime: "right", owner: "left", last_gift_date: "right", engagement: "left", generosity: "center", phone: "left", stage: "left" };
const TWO_LINES = new Set(["name", "last_gift_date"]);
const GAP = 8;   // px: closer than this, two columns' words read as one
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const FIRST = ["Bartholomew", "Wilhelmina", "Ana", "Jo", "Maximiliano", "Persephone", "Kit", "Evangeline"];
const LAST = ["Featherstonehaugh-Whittingham", "Lee", "Abernathy", "Oyelaran-Castellanos", "Ng", "Delacroix-Montgomery"];

async function reset(org) {
  for (const t of ["donor_scores", "gifts", "donor_list_layouts", "donor_list_views", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  const rest = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`).catch(() => []);
  for (let pass = 0; pass < 2; pass++) for (const r of rest) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}

// In the page: every column's boxes, per row. A cell's "words" are the boxes
// of its text and of its marks (an avatar, a badge), cut to what is visible
// (the cell's own clip and the table's).
function measure() {
  const table = document.querySelector('[data-testid="dir-table"]');
  const tbox = table.getBoundingClientRect();
  const clip = (r, c) => ({ left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) });
  const visible = r => r.right - r.left > 0.5 && r.bottom - r.top > 0.5;
  function words(cell) {
    const out = [];
    const clipOf = el => {
      let c = { left: tbox.left, right: tbox.right, top: -1e9, bottom: 1e9 };
      for (let n = el; n && n !== cell.parentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== "visible") c = clip(c, n.getBoundingClientRect());
      }
      return c;
    };
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) { walker.nextSibling(); continue; }
        const marked = n.tagName === "IMG" || n.tagName === "svg" || n.tagName === "INPUT" || (n !== cell && ((cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || parseFloat(cs.borderLeftWidth) > 0));
        if (marked && n.getAttribute("role") !== "separator") { const r = clip(n.getBoundingClientRect(), clipOf(n)); if (visible(r)) out.push(r); }
      } else if (n.nodeValue.trim()) {
        const range = document.createRange(); range.selectNodeContents(n);
        const c = clipOf(n.parentElement);
        let inMark = false;
        for (let e = n.parentElement; e && e !== cell; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { inMark = true; break; } }
        for (const r of range.getClientRects()) { const k = clip(r, c); if (visible(k)) out.push({ ...k, text: !inMark, line: Math.round(r.top) }); }
      }
    }
    return out;
  }
  const union = rs => rs.length ? { left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)), top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) } : null;
  const head = document.querySelector(".dir-header-row");
  const heads = [...head.children].map(h => {
    const ws = words(h), b = h.getBoundingClientRect();
    return { key: (h.getAttribute("data-testid") || "").replace("dir-col-head-", ""), left: b.left, right: b.right, width: b.width,
      text: h.innerText.trim(), content: union(ws), lines: new Set(ws.filter(w => w.text).map(w => w.line)).size };
  });
  const rows = [...document.querySelectorAll(".dir-donor-row")].filter(r => r.offsetParent !== null).map(r => [...r.children].map(c => {
    const ws = words(c), b = c.getBoundingClientRect();
    return { left: b.left, right: b.right, text: c.innerText.trim(), boxes: ws, content: union(ws), lines: new Set(ws.filter(w => w.text).map(w => w.line)).size };
  }));
  return { heads, rows, scrolls: table.scrollWidth > table.clientWidth + 1, tableRight: tbox.right };
}

// The checks of §1 and §2 on one measurement.
function checkLayout(m, label) {
  const keys = m.heads.map(h => h.key);
  // §1 words never touch: every pair of cells in a row, side by side on screen.
  const touching = [];
  m.rows.forEach((cells, ri) => {
    const boxes = cells.map((c, ci) => ({ ci, b: c.content })).filter(x => x.b && x.ci > 0);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, b = boxes[j].b;
      if (a.bottom <= b.top || b.bottom <= a.top) continue;
      const gap = a.right <= b.left ? b.left - a.right : b.right <= a.left ? a.left - b.right : -Math.min(a.right - b.left, b.right - a.left);
      if (gap < GAP) touching.push(`row ${ri}: ${keys[boxes[i].ci]} "${cells[boxes[i].ci].text.slice(0, 24)}" and ${keys[boxes[j].ci]} "${cells[boxes[j].ci].text.slice(0, 24)}" ${gap.toFixed(1)}px apart`);
    }
  });
  ok(`§1 ${label}: no two columns' words touch in any row (at least ${GAP}px apart)`, m.rows.length > 0 && touching.length === 0, touching.slice(0, 6));
  // §1 the heading's edges are its column's edges, and its words sit where the cells' words sit.
  const edges = [], aligned = [], wrapped = [], stray = [];
  m.heads.forEach((h, ci) => {
    if (!h.key) {   // the checkbox, or a column with no heading
      if (ci > 0) m.rows.forEach((cells, ri) => { if (cells[ci] && cells[ci].text) stray.push(`row ${ri} has "${cells[ci].text}" under no heading`); });
      return;
    }
    const al = ALIGN[h.key];
    if (h.lines > 1) wrapped.push(`${h.key} heading takes ${h.lines} lines`);
    m.rows.forEach((cells, ri) => {
      const c = cells[ci];
      if (!c) { edges.push(`row ${ri} has no cell under ${h.key}`); return; }
      if (Math.abs(c.left - h.left) > 2 || Math.abs(c.right - h.right) > 2) edges.push(`${h.key} row ${ri}: heading ${h.left.toFixed(0)}–${h.right.toFixed(0)}, cell ${c.left.toFixed(0)}–${c.right.toFixed(0)}`);
      if (!al || !h.content || !c.content) return;
      const hc = h.content, cc = c.content;
      // Only the words inside the table's view can be compared.
      if (hc.right > m.tableRight - 1 || cc.right > m.tableRight - 1) return;
      const off = al === "left" ? cc.left - hc.left : al === "right" ? cc.right - hc.right : (cc.left + cc.right) / 2 - (hc.left + hc.right) / 2;
      if (Math.abs(off) > 2) aligned.push(`${h.key} (${al}) row ${ri}: words ${off.toFixed(1)}px off the heading's`);
    });
  });
  ok(`§1 ${label}: every heading's left and right edge is within 2px of its column's cells`, edges.length === 0, edges.slice(0, 6));
  ok(`§1 ${label}: every heading's words sit where its cells' words sit (left, right or centred)`, aligned.length === 0, aligned.slice(0, 6));
  ok(`§1 ${label}: every heading is one line`, wrapped.length === 0, wrapped);
  ok(`§1 ${label}: no row has words in a column with no heading`, stray.length === 0, stray.slice(0, 4));
  // §2 one shape per column.
  const ci = k => keys.indexOf(k);
  const col = k => m.rows.map(cells => cells[ci(k)]).filter(Boolean);
  const eng = col("engagement").map(c => c.text.replace(/\s+/g, " "));
  const badEng = eng.filter(t => !/^(\d{1,3}|—) [A-Z][a-z]+( [a-z]+)?$/.test(t));
  ok(`§2 ${label}: Engagement is a score and a word on every row`, eng.length > 0 && badEng.length === 0, badEng.slice(0, 5));
  const phones = col("phone").map(c => c.text).filter(Boolean);
  const badPhone = phones.filter(t => !/^\(\d{3}\) \d{3}-\d{4}$/.test(t));
  ok(`§2 ${label}: every phone number is in one format`, phones.length > 0 && badPhone.length === 0, badPhone.slice(0, 5));
  const lineBad = [];
  for (const k of COLUMNS) {
    const want = TWO_LINES.has(k) ? 2 : 1;
    col(k).forEach((c, ri) => { if (c.lines && c.lines !== want) lineBad.push(`${k} row ${ri}: ${c.lines} lines ("${c.text.replace(/\n/g, " / ").slice(0, 40)}")`); });
  }
  ok(`§2 ${label}: Donor and Last gift are two lines on every row, every other column one`, lineBad.length === 0, lineBad.slice(0, 6));
}

(async () => {
  console.log("table1-columns-clean (TABLE-1)");
  await reset(ORG);
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,onboarded_at,vocabulary_json)
           VALUES ($1,'Table One Harbor',$2,1,'active','team','America/New_York',NOW(),NOW(),'{"fiscal_year_start_month":1}')`, [ORG, SLUG]);
  for (const [u, role] of [[A, "admin"], [B, "staff"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [u.id, ORG, u.email, pw, u.name, role]);

  // ── §0 40 made-up people, shaped to crowd the columns: long and short
  // names, long emails, owners and none, phones typed three ways, a score of
  // nothing, of something and none at all, big and no lifetimes.
  const people = [];
  for (let i = 0; i < 40; i++) {
    const first = FIRST[i % FIRST.length], last = LAST[i % LAST.length];
    const d = String(2125550100 + i);
    people.push({ id: `d_t1_${i}`, name: `${first} ${last}`, email: i % 5 === 4 ? null : `${first.toLowerCase()}.${last.toLowerCase()}.${i}@longplaceholderdomain.example`,
      phone: i % 3 === 0 ? d : i % 3 === 1 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : `1-${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
      stage: STAGES[i % 6], owner: i % 3 === 0 ? A : i % 3 === 1 ? B : null,
      gift: i % 7 === 6 ? 0 : (i % 4 === 0 ? 40709 : 25 * (i + 1)),
      engagement: i % 4 === 0 ? 0 : i % 4 === 1 ? null : 10 + (i * 7) % 90, generosity: i % 7 === 6 ? null : (i * 11) % 100 });
  }
  const col = k => people.map(p => (p[k] == null ? null : String(p[k])));
  await q(`INSERT INTO donors (id,org_id,name,email,phone,kind,stage,assigned_to,assigned_to_name,person_types,created_by,created_by_name)
           SELECT u.id, $1, u.name, u.email, u.phone, 'person', u.stage, u.owner, u.owner_name, '["donor"]'::jsonb, 'system:test', 'test'
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(id, name, email, phone, stage, owner, owner_name)`,
  [ORG, col("id"), col("name"), col("email"), col("phone"), col("stage"), people.map(p => p.owner && p.owner.id), people.map(p => p.owner && p.owner.name)]);
  const gifts = people.filter(p => p.gift > 0);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           SELECT 'g_' || u.donor, $1, u.donor, u.amount, '2026-03-14', 'check', ${sys} FROM unnest($2::text[], $3::numeric[]) AS u(donor, amount)`,
  [ORG, gifts.map(p => p.id), gifts.map(p => p.gift)]);
  const { query: dbq } = require("../db");
  await require("../afterChange").recalcDonorSummaryBatch(dbq, people.map(p => p.id), ORG);
  const scored = people.filter(p => p.engagement != null);
  await q(`DELETE FROM donor_scores WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO donor_scores (org_id,donor_id,engagement,generosity,band,created_by,created_by_name)
           SELECT $1, u.donor, u.e, COALESCE(u.g, 0), CASE WHEN u.e >= 60 THEN 'close' WHEN u.e >= 25 THEN 'warm' ELSE 'distant' END, ${sys}
             FROM unnest($2::text[], $3::int[], $4::int[]) AS u(donor, e, g)`,
  [ORG, scored.map(p => p.id), scored.map(p => p.engagement), scored.map(p => p.generosity)]);
  const [{ c: inserted }] = await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1`, [ORG]);
  ok("§0 the fixture holds 40 made-up people", inserted === 40, inserted);
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
  if (browserLegOrSkip(why, "(browser leg)")) { await reset(ORG); await closeDb(); summary(); return; }

  const lg = await api("POST", "/auth/login", null, { email: A.email, password: "loadtest1234" });
  const { chromium } = require(PW);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([tk, u, o]) => {
    localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    localStorage.setItem("steward_dir_density", "comfortable");
  }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
  const r0 = await api("PUT", "/donors/list-layout", tok, { columns: COLUMNS, widths: {}, pageSize: 50 });
  ok("her layout is Jonathan's column order", r0.status === 200, r0.status);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const open = async () => {
    await page.goto(`${APP}/donors`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator(".dir-donor-row").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
  };
  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); } };
  const headWidth = async k => page.locator(`[data-testid="dir-col-head-${k}"]`).evaluate(el => el.getBoundingClientRect().width);

  // ── §1 and §2 at three laptop widths ──
  for (const w of [1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await open();
    checkLayout(await page.evaluate(measure), `${w}px`);
    if (w !== 1280) await shot(`table-${w}`);
  }

  // ── §3 every column dragged to the narrowest it allows (at 1024) ──
  const wide = {};
  for (const k of COLUMNS) wide[k] = Math.round(await headWidth(k));
  for (const k of COLUMNS) {
    const h = page.locator(`[data-testid="dir-col-resize-${k}"]`);
    // In the middle of the window, clear of the sticky top bar.
    await h.evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
    const b = await h.boundingBox();
    if (!b) continue;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    // Never past the window's left edge: a move off the page is not a move.
    await page.mouse.move(Math.max(2, b.x - 600), b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  await page.locator('[data-testid="dir-table"]').evaluate(el => { el.scrollLeft = 0; });
  const narrow = await page.evaluate(measure);
  checkLayout(narrow, "1024px, every column at its narrowest");
  const mins = {};
  for (const k of COLUMNS) mins[k] = Math.round(await headWidth(k));
  const tooNarrow = Object.entries(mins).filter(([, v]) => v < 88);
  const notMoved = COLUMNS.filter(k => mins[k] >= wide[k]);
  ok("§3 every column was dragged narrower", notMoved.length === 0, { notMoved, wide, mins });
  ok("§3 no column goes narrower than its min (at least 88px for every column here)", tooNarrow.length === 0, mins);
  await shot("table-1024-narrowest");

  // ── §4 Owner dragged before Lifetime ──
  await api("DELETE", "/donors/list-layout", tok);
  await api("PUT", "/donors/list-layout", tok, { columns: COLUMNS, widths: { owner: 230 }, pageSize: 50 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open();
  const ownerBefore = await headWidth("owner");
  await page.locator('[data-testid="dir-col-head-owner"]').dragTo(page.locator('[data-testid="dir-col-head-lifetime"]'));
  await page.waitForTimeout(800);
  const order = async () => page.locator(".dir-header-row [data-testid^='dir-col-head-']").evaluateAll(hs => hs.map(h => h.getAttribute("data-testid").replace("dir-col-head-", "")));
  const after = await order();
  ok("§4 Owner moved before Lifetime", after.indexOf("owner") >= 0 && after.indexOf("owner") < after.indexOf("lifetime"), after);
  const moved = await page.evaluate(measure);
  checkLayout(moved, "1440px, after Owner moved before Lifetime");
  ok("§4 Owner's width travelled with it", Math.abs((await headWidth("owner")) - ownerBefore) <= 1 && Math.abs(ownerBefore - 230) <= 1, { before: ownerBefore, after: await headWidth("owner") });
  await shot("table-1440-owner-moved");
  await open();
  ok("§4 the order and the width are still hers after a reload", (await order()).join() === after.join() && Math.abs((await headWidth("owner")) - 230) <= 1, await order());
  const reset1 = await api("DELETE", "/donors/list-layout", tok);
  await open();
  ok("§4 Reset columns brings back the default order and widths", reset1.status === 200 && (await order()).join() === (reset1.body.layout.columns || []).join() && !Object.keys(reset1.body.layout.widths || {}).length,
    { order: await order(), layout: reset1.body.layout });
  const def = await page.evaluate(measure);
  ok("§4 at 1440 the default columns fit without scrolling sideways", !def.scrolls, def.heads.map(h => `${h.key}:${Math.round(h.width)}`));
  await shot("table-1440-default");

  // ── §5 a phone width ──
  await api("PUT", "/donors/list-layout", tok, { columns: COLUMNS, widths: {}, pageSize: 50 });
  await page.setViewportSize({ width: 390, height: 844 });
  await open().catch(() => {});
  await page.locator(".dir-row-mobile").first().waitFor({ timeout: 30000 }).catch(() => {});
  const phone = await page.evaluate(() => ({
    table: [...document.querySelectorAll(".dir-donor-row, .dir-header-row")].some(r => r.offsetParent !== null),
    cards: [...document.querySelectorAll(".dir-row-mobile")].filter(r => r.offsetParent !== null).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  ok("§5 at 390px the list is cards, never the squeezed table, and the page does not scroll sideways", !phone.table && phone.cards > 0 && !phone.overflow, phone);
  ok("no page error on the Donors list", errors.length === 0, errors.slice(0, 3));

  await browser.close();
  await reset(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });

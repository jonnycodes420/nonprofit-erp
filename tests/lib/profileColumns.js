// tests/lib/profileColumns.js (PROFILE-3): the donor profile's grid, its
// columns that scroll on their own, and empty as calm. Run by
// tests/smoke-walk.test.js against its walked org; not a suite of its own.
"use strict";

// ── PROFILE-3 · THE PROFILE'S GRID, ITS COLUMNS, AND EMPTY AS CALM ─────────
// Jonathan, 1 Nov, on a new person: "The name and the tabs are not lined up.
// The right rail needs to scroll on its own and the big left window on its
// own. It's fine if it's empty ... it just needs to look better." Held here:
//   §grid at 1440 and 1280: the back link, the avatar, the numbers' first
//     column, the first tab and the timeline start on one left edge (±1px),
//     40px from the sidebar; the name and the tags share a second edge; the
//     actions are centred on the name's row (±2px).
//   §columns at 1440 and 1280: a wheel over the main column moves only it, a
//     wheel over the rail moves only the rail, the window never moves, and the
//     last thing in each column can be scrolled into view; the header band and
//     tabs stay pinned. At 390 the page scrolls as one (everyPageScrolls).
//   §empty: a person with nothing logged shows no "0" tab pill, no sentence in
//     the numbers (an em dash), the start card, and no empty rail section
//     (no Household and related, Contact, Engagement or "Unassigned"); a person
//     with gifts has every money tile filled and the timeline by month.
// HOW IT GOES RED ON MAIN: the back link is at 28px and the tabs at 27px (no
// common edge); the profile is one page (the window scrolls, the columns do
// not); the empty person reads "No giving yet." and "Giving 0", and the rail
// draws "No one linked yet." and "Unassigned".
async function profileColumnsScroll(pw, auth, { ok, APP }) {
  const { q } = require("../helpers");
  const orgId = auth.org && auth.org.id;
  const [rich] = await q("SELECT donor_id FROM gifts WHERE org_id=$1 AND donor_id IS NOT NULL GROUP BY donor_id ORDER BY count(*) DESC LIMIT 1", [orgId]);
  // a person with nothing logged: made here, so the walked org always has one
  const EMPTY = "d_p3_empty_" + String(orgId).slice(-8);
  await q("DELETE FROM donors WHERE id=$1 AND org_id=$2", [EMPTY, orgId]).catch(() => {});
  await q(`INSERT INTO donors (id,org_id,name,person_types,created_by,created_by_name) VALUES ($1,$2,'Harold Pennick','["donor"]','system:test','test')`, [EMPTY, orgId]);
  const br = await pw.chromium.launch();
  const open = async (w, h, id) => {
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/donors/${id}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.locator("[data-testid=dp-band]").waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { ctx, page };
  };
  for (const w of [1440, 1280]) {
    for (const [who, id] of [["full", rich && rich.donor_id], ["empty", EMPTY]]) {
      if (!id) continue;
      const { ctx, page } = await open(w, 900, id);
      const g = await page.evaluate(() => {
        const L = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, top: r.top, bottom: r.bottom, h: r.height }; };
        const side = document.querySelector("[data-testid=dp-main-column]").getBoundingClientRect().left;
        const tl = document.querySelector("[data-testid=dp-timeline]") || document.querySelector("[data-testid=dp-start-card]");
        const avatar = document.querySelector("[data-testid=dp-avatar]");
        const av = avatar && (avatar.querySelector("img,[data-testid],div,button") || avatar).getBoundingClientRect();
        return { side, back: L(".dph-back"), avatar: av && Math.round(av.left * 10) / 10, avatarBox: L("[data-testid=dp-avatar]"), fig: L("[data-testid=dp-fig-lifetime]"),
          tab: L("[data-testid=dp-tabs] [role=tab]"), timeline: tl && Math.round(tl.getBoundingClientRect().left * 10) / 10,
          name: L("[data-testid=dp-name]"), tags: L("[data-testid=dp-head-tags]"), contact: L("[data-testid=dp-contact-line]"), actions: L("[data-testid=dp-actions]") };
      });
      const edges = { back: g.back && g.back.x, avatar: g.avatarBox && g.avatarBox.x, numbers: g.fig && g.fig.x, tab: g.tab && g.tab.x, timeline: g.timeline };
      const vals = Object.values(edges);
      ok(`§grid ${w} ${who}: back link, avatar, numbers, first tab and timeline share one left edge`, vals.every(v => v != null) && Math.max(...vals) - Math.min(...vals) <= 1, edges);
      ok(`§grid ${w} ${who}: that edge is 40px from the sidebar`, edges.back != null && Math.abs(edges.back - g.side - 40) <= 1, { side: g.side, back: edges.back });
      const second = [g.name && g.name.x, g.tags && g.tags.x, g.contact && g.contact.x].filter(v => v != null);
      ok(`§grid ${w} ${who}: the name, the tags and the contact line share one edge`, second.length >= 2 && Math.max(...second) - Math.min(...second) <= 1, { name: g.name, tags: g.tags, contact: g.contact });
      const nameMid = g.name && (g.name.top + g.name.bottom) / 2, actMid = g.actions && (g.actions.top + g.actions.bottom) / 2;
      ok(`§grid ${w} ${who}: the actions are centred on the name`, nameMid != null && actMid != null && Math.abs(nameMid - actMid) <= 2, { nameMid, actMid });

      // §columns
      const col = async sel => page.evaluate(s => { const e = document.querySelector(s); return { top: e.scrollTop, can: e.scrollHeight - e.clientHeight }; }, sel);
      const box = async sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 }; }, sel);
      const docFits = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, vh: innerHeight }));
      ok(`§columns ${w} ${who}: the page itself does not scroll`, docFits.doc <= docFits.vh + 1, docFits);
      for (const [name, sel, other] of [["main column", "[data-testid=dp-main-column]", "[data-testid=dp-right-rail]"], ["rail", "[data-testid=dp-right-rail]", "[data-testid=dp-main-column]"]]) {
        const c0 = await col(sel), o0 = await col(other);
        if (c0.can <= 4) { console.log(`  SKIP  §columns ${w} ${who} ${name} — shorter than the window, nothing to scroll`); continue; }
        const b = await box(sel);
        await page.mouse.move(b.x, b.y);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(350);
        const c1 = await col(sel), o1 = await col(other), wy = await page.evaluate(() => window.scrollY);
        ok(`§columns ${w} ${who}: the wheel over the ${name} scrolls only it`, c1.top > c0.top && o1.top === o0.top && wy === 0, { c0, c1, o0, o1, wy });
        await page.evaluate(s => { const e = document.querySelector(s); e.scrollTop = e.scrollHeight; }, sel);
        await page.waitForTimeout(250);
        const last = await page.evaluate(s => {
          const e = document.querySelector(s), r = e.getBoundingClientRect();
          let low = 0; for (const k of e.querySelectorAll("*")) { const q = k.getBoundingClientRect(); if (q.width && q.height && (!k.checkVisibility || k.checkVisibility())) low = Math.max(low, q.bottom); }
          return { low: Math.round(low), bottom: Math.round(r.bottom) };
        }, sel);
        ok(`§columns ${w} ${who}: the ${name}'s last item can be reached`, last.low <= last.bottom + 1, last);
        if (name === "main column") {
          const pin = await page.evaluate(() => { const t = document.querySelector("[data-testid=dp-tabs]").getBoundingClientRect(), m = document.querySelector("[data-testid=dp-main-column]").getBoundingClientRect(); return { tabs: t.top, main: m.top }; });
          ok(`§columns ${w} ${who}: the tabs stay pinned while the column scrolls`, pin.tabs >= pin.main && pin.tabs < pin.main + 420, pin);
        }
        await page.evaluate(s => { document.querySelector(s).scrollTop = 0; }, sel);
      }

      // §empty / §full
      const e = await page.evaluate(() => ({
        pills: [...document.querySelectorAll("[data-tab-count]")].map(x => x.innerText.trim()),
        tiles: [...document.querySelectorAll("[data-testid=dp-header-figures] .dp3-tile")].map(t => t.innerText.replace(/\s+/g, " ").trim()),
        start: !!document.querySelector("[data-testid=dp-start-card]"),
        rail: [...document.querySelectorAll("[data-testid=dp-right-rail] [data-rail-section]")].map(x => x.dataset.testid),
        railText: (document.querySelector("[data-testid=dp-right-rail]") || {}).innerText || "",
        months: document.querySelectorAll("[data-testid=dp-timeline] .tl-month").length,
      }));
      if (who === "empty") {
        ok(`§empty ${w}: no tab says 0`, e.pills.every(p => p !== "0"), e.pills);
        ok(`§empty ${w}: the numbers are em dashes, never a sentence`, e.tiles.length === 4 && e.tiles.every(t => /—$/.test(t) && t.split(" ").length <= 4), e.tiles);
        ok(`§empty ${w}: the start card shows`, e.start, e);
        ok(`§empty ${w}: no empty rail section is drawn`, !e.rail.some(t => ["dp-rail-related", "dp-rail-contact", "dp-rail-groups"].includes(t))
          && !/No one linked yet|Unassigned|Nothing logged yet|Nothing yet/.test(e.railText), { rail: e.rail, text: e.railText.slice(0, 300) });
        ok(`§empty ${w}: Next step, Journeys and About are there`, ["dp-rail-journeys", "dp-rail-about"].every(t => e.rail.includes(t)) && /Next step/i.test(e.railText), e.rail);
      } else {
        ok(`§full ${w}: Lifetime and Last gift are filled`, e.tiles.length === 4 && !/—$/.test(e.tiles[0]) && !/—$/.test(e.tiles[2]), e.tiles);
        ok(`§full ${w}: no start card, and the timeline is grouped by month`, !e.start && e.months >= 1, e);
      }
      await ctx.close();
    }
  }
  await br.close();
  await q("DELETE FROM donors WHERE id=$1 AND org_id=$2", [EMPTY, orgId]).catch(() => {});
}

module.exports = { profileColumnsScroll };

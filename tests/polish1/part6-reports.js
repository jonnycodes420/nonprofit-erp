// POLISH-1 Part 6 — REPORTS READ CLEANLY.
//   §sticky  the 3-year comparison holds its column headers and its first
//            column in place while it scrolls (computed position: sticky on
//            every header cell and on each row's first cell, inside a frame
//            that scrolls), at 1440 and at 390;
//   §empty   a column empty on every row is not drawn: "Assigned to" when
//            nobody is assigned;
//   §online  "Online" counts gifts paid through a giving page or a connected
//            giving source, not only Stripe, and a zero says why in one line;
//   §drift   the Drift count can move at midnight with nothing new, so
//            /drift names who crossed since yesterday.
// HOW IT GOES RED: drop `sticky` from the 3-year ReportTable, or
// `hideWhenEmpty` from its Assigned-to column; put the online filter back to
// stripe_payment_id only; drop the yesterday pass in computeDriftForDonors.
// Proven red on 21a4644 (the PR says how).
const path = require("path");
const { build, wipe, ORG } = require("./fixture-p567");
const B = require("./browser-p567");
const driftEngine = require(path.join(__dirname, "..", "..", "drift.js"));
const orgTime = require(path.join(__dirname, "..", "..", "orgTime.js"));

module.exports = async function part6(h) {
  const { ok, api, q } = h;
  const f = await build(h);
  try {
    // §drift — a person whose first drifting day is today: eight gifts sixty
    // days apart, the last one exactly as far back as drift.js says crosses.
    const D = driftEngine.DRIFT;
    const cross = Math.max(Math.floor(60 * D.DRIFT_THRESHOLD) + 1, 60 + D.MIN_OVERDUE_DAYS);
    const dates = Array.from({ length: 8 }, (_, k) => orgTime.addDays(f.today, -(cross + k * 60)));
    await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
             VALUES ('d_p567_crosser',$1,'Crossing Today','crosser@polish1-p567.test','steward','system:test','test')`, [ORG]);
    for (const [k, d] of dates.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,fund_id,created_by,created_by_name)
               VALUES ($1,$2,'d_p567_crosser',250,$3,'Card',NULL,'system:test','test')`, [`g_p567_cross_${k}`, ORG, d]);
    const g = dates.map(date => ({ date, amount: 250 }));
    const nowA = driftEngine.assessDrift(g, f.today), thenA = driftEngine.assessDrift(g, orgTime.addDays(f.today, -1));
    ok("§drift the fixture crosses today by drift.js's own rule", nowA.state === "drifting" && nowA.confidence === "high" && thenA.state === "ok",
      { now: [nowA.state, nowA.confidence], then: thenA.state });
    const dr = await api("GET", "/drift?all=1&includeMedium=1", f.tok);
    const crossed = ((dr.body && dr.body.sinceYesterday && dr.body.sinceYesterday.crossed) || []).map(x => x.donorName);
    ok("§drift /drift names who crossed since yesterday", crossed.includes("Crossing Today"), dr.body && dr.body.sinceYesterday);
    ok("§drift …and only them: nobody else in the fixture moved overnight", crossed.length === 1, crossed);

    // §online — one gift through a connected giving source counts as online.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,giving_source_id,created_by,created_by_name)
             VALUES ('g_p567_paypal',$1,'d_p567_6',40.00,$2,'PayPal','gs_p567_fake','system:test','test')`, [ORG, f.lastMonth.mid]);
    const gs = await api("GET", `/reports/giving-summary?from=${f.lastMonth.from}&to=${f.lastMonth.to}`, f.tok);
    ok("§online a gift read from a giving source is online", gs.status === 200 && gs.body.onlineCount === 1 && Number(gs.body.onlineTotal) === 40,
      gs.body && { onlineCount: gs.body.onlineCount, onlineTotal: gs.body.onlineTotal, status: gs.status });
    ok("§online …and online plus offline foot to the period's total",
      gs.body && Math.round((Number(gs.body.onlineTotal) + Number(gs.body.offlineTotal)) * 100) === Math.round(Number(gs.body.total) * 100),
      gs.body && [gs.body.onlineTotal, gs.body.offlineTotal, gs.body.total]);
    await q(`DELETE FROM gifts WHERE id='g_p567_paypal'`);

    // §sticky + §empty — the screen.
    const b = await B.open(h, "§sticky");
    if (!b) return;
    try {
      for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const { ctx, page } = await b.signedIn(f.ADMIN, vp);
        await page.goto(b.APP + "/app/reports?report=three-year", { waitUntil: "domcontentloaded", timeout: 45000 });
        const table = page.locator('[data-testid="report-table"]').first();
        await table.waitFor({ timeout: 30000 });
        const st = await table.evaluate(t => {
          const pos = el => getComputedStyle(el).position;
          const ths = [...t.querySelectorAll("thead th")];
          const firsts = [...t.querySelectorAll("tbody tr")].slice(0, 5).map(tr => tr.cells[0]);
          const wrap = t.parentElement, ws = getComputedStyle(wrap);
          return { heads: ths.map(x => x.innerText.trim()), headSticky: ths.length > 0 && ths.every(x => pos(x) === "sticky"),
            firstSticky: firsts.length > 0 && firsts.every(x => pos(x) === "sticky" && getComputedStyle(x).left === "0px"),
            frameScrolls: /auto|scroll/.test(ws.overflowY) && ws.maxHeight !== "none" };
        });
        ok(`§sticky at ${vp.width}: every column header is sticky`, st.headSticky, st);
        ok(`§sticky at ${vp.width}: the first column is sticky`, st.firstSticky, st);
        ok(`§sticky at ${vp.width}: the table scrolls inside its own frame, so the headers have something to stick to`, st.frameScrolls, st);
        ok(`§empty at ${vp.width}: "Assigned to" is not drawn when nobody is assigned`, st.heads.length >= 4 && !st.heads.some(x => /assigned/i.test(x)), st.heads);
        await ctx.close();
      }
    } finally { await b.browser.close(); }
  } finally { await wipe(q); }
};

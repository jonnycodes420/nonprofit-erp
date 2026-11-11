// tests/truth6-counts.test.js — TRUTH-6. ONE GIFT COUNT EVERYWHERE, FUTURE GIFTS ONE WAY, DRAFTS QUOTE THE RIGHT GIFT.
//
// The QA fleet (7–10 Nov) read a headline of 503 gifts over a monthly table of
// 502 and Finance's months summing to 505; a $0 gift still carrying a $200
// receipt; a hand-entered postdated gift in Lifetime and Last gift while an
// import set the same kind aside (a 1,000-row file short its 76 future rows);
// the first-gift thank-you quoting the latest gift; a group campaign saying "0
// can get this email" beside a group of 1,217; Last FY moving gifts but not
// goals or pledges; and Finance's totals with no stated basis. One org shaped
// like that (tests/lib/truth6Fixture.js: a $0 gift, a split gift, a refund in
// full, a future-dated gift by hand and by import, a group, two FYs):
//   §1 counts: Reports' header = its monthly rows = Finance's months (a split
//      gift is one gift; a $0 row, a refund and the refunded gift are none)
//   §2 the $0 gift's receipt says "Void this receipt"
//   §3 a future-dated gift by hand: scheduled, out of Lifetime, Last gift,
//      FY totals and counts, listed "Scheduled, Dec 15"
//   §4 a future-dated gift by import: scheduled, never set aside, the file
//      foots "imported $X + scheduled $Y"
//   §5 merge fields: first, last and largest gift; the first-gift thank-you
//   §6 audiences: the group's members minus who can't be emailed, with why;
//      All donors is the Donors count
//   §7 Last FY moves the goal, and says what can't move; Finance names each
//      basis and one line goes from Fundraising's figure to Finance's
//   §8 the browser: the same, on the screens
//
// HOW IT GOES RED (planted, see the PR): Finance's month counting LINES (a
// join to gift_fund_lines) instead of gifts turns §1 red (the split gift is two).
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { buildTruth6Org } = require("./lib/truth6Fixture");
const orgTime = require("../orgTime");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");

(async () => {
  console.log("truth6-counts (TRUTH-6)");
  const f = await buildTruth6Org();
  const tok = f.token, ids = f.ids;
  const month = f.today.slice(0, 7);

  // ── §1 one gift count ────────────────────────────────────────────────────
  const gs = (await api("GET", `/reports/giving-summary?from=${f.fy.from}&to=${f.today}`, tok)).body || {};
  const mSum = (gs.monthly || []).reduce((n, m) => n + m.gifts, 0);
  const repMonth = (gs.monthly || []).find(m => m.month === month) || {};
  const fin = (await api("GET", "/finance/overview", tok)).body || {};
  const finMonth = (fin.byMonth || []).find(m => m.month === month) || {};
  const finInFy = (fin.byMonth || []).filter(m => m.month >= f.fy.from.slice(0, 7) && m.month <= month).reduce((n, m) => n + m.gifts, 0);
  ok("§1 Reports' header count is its monthly rows' sum (a gift refunded in full is not a gift)", gs.giftCount === mSum && mSum > 0, { header: gs.giftCount, rows: mSum });
  ok("§1 Finance's month counts what Reports' month counts, at the same dollars", finMonth.gifts === repMonth.gifts && Math.round(finMonth.cents) === Math.round(repMonth.total * 100), { finance: [finMonth.gifts, finMonth.cents], reports: [repMonth.gifts, repMonth.total] });
  ok("§1 …and Finance's months this FY sum to Reports' header", finInFy === gs.giftCount, { finInFy, header: gs.giftCount });
  const drill = (await api("GET", `/finance/overview/month?month=${month}`, tok)).body || {};
  ok("§1 the month's rows say the count and label what is not a gift", drill.count === finMonth.gifts && (drill.rows || []).filter(r => !r.counted).every(r => !!r.label) && /not a gift/.test(drill.sentence || ""), { count: drill.count, sentence: drill.sentence });
  const odile = (await api("GET", `/donors/${ids.odile}`, tok)).body || {};
  const ledCnt = (await api("GET", "/finance/summary?yearMode=fiscal", tok)).body || {};
  ok("§1 the split gift is one gift with two lines", (odile.gifts || []).filter(g => Number(g.amount) > 0).length === 1 && ((odile.gifts || [])[0].fund_lines || []).length === 2, odile.gifts && odile.gifts.map(g => [g.amount, (g.fund_lines || []).length]));

  // ── §2 a $0 gift has no receipt ──────────────────────────────────────────
  const rec = (await api("GET", `/donors/${ids.marlowe}/receipts`, tok));
  const rlist = (rec.body && (rec.body.receipts || rec.body)) || [];
  const onZero = (Array.isArray(rlist) ? rlist : []).find(r => r.gift_id === ids.gifts.marloweZero || r.giftId === ids.gifts.marloweZero) || {};
  ok("§2 the $200 receipt on the gift now $0 says Void this receipt", !!ids.receiptOnZero && onZero.drift && onZero.drift.action === "Void this receipt" && /a \$0 gift can't carry a receipt\. Void this receipt\.$/.test(onZero.drift.sentence), { status: rec.status, drift: onZero.drift, id: ids.receiptOnZero });

  // ── §3 a future-dated gift by hand ───────────────────────────────────────
  const ines = (await api("GET", `/donors/${ids.ines}`, tok)).body || {};
  const fut = (ines.gifts || []).find(g => g.id === ids.gifts.future) || {};
  const [stored] = await q("SELECT scheduled_on FROM gifts WHERE id=$1", [ids.gifts.future]);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `Scheduled, ${MON[Number(ids.futureDate.slice(5, 7)) - 1]} ${Number(ids.futureDate.slice(8, 10))}`;
  ok("§3 the hand-entered postdated gift is stored scheduled", stored && stored.scheduled_on === ids.futureDate, stored);
  ok("§3 …listed on the profile as \"Scheduled, <day>\"", fut.scheduled === true && String(fut.scheduled_label || "").startsWith(label), [fut.scheduled, fut.scheduled_label]);
  ok("§3 …and not in Lifetime ($150) or Last gift (the $150)", ines.figures && ines.figures.lifetime.cents === 15000 && ines.figures.lastGift.cents === 15000, ines.figures && [ines.figures.lifetime.cents, ines.figures.lastGift.cents]);
  const gsFy = (await api("GET", `/reports/giving-summary?from=${f.fy.from}&to=${f.fy.to}`, tok)).body || {};
  ok("§3 …nor in the whole FY's total or count", gsFy.giftCount === gs.giftCount && Math.round(gsFy.total * 100) === Math.round(gs.total * 100), { fy: [gsFy.giftCount, gsFy.total], toToday: [gs.giftCount, gs.total] });
  ok("§3 Reports says the scheduled gifts in a row of their own", gsFy.scheduled && gsFy.scheduled.n === 1 && gsFy.scheduled.cents === 100000 && /^Scheduled: 1 gift, \$1,000, dated after today/.test(gsFy.scheduled.sentence), gsFy.scheduled);

  // ── §4 a future-dated gift by import ─────────────────────────────────────
  const day = n => orgTime.addDays(f.today, n);
  const grid = [["Date", "Donor", "Email", "Amount"],
    [day(-30), "Rowan Thistle", `rowan-${f.run}@truth6.invalid`, "250"], [day(-25), "Sable Marchetti", `sable-${f.run}@truth6.invalid`, "400"],
    [day(-10), "Wren Okonjo", `wren-${f.run}@truth6.invalid`, "125"],
    [day(40), "Linus Farrow", `linus-${f.run}@truth6.invalid`, "700"], [day(55), "Mira Castellane", `mira-${f.run}@truth6.invalid`, "325"]];
  const body = { fileName: "truth6-future.csv", sheets: [{ name: "Sheet1", grid }] };
  await api("POST", "/sheet-import/understand", tok, body);
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  for (let i = 0; i < 400 && c.status === 202; i++) { const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok); if (j.body.status !== "running") break; await new Promise(r => setTimeout(r, 150)); }
  const imp = ((await api("GET", `/imports/${c.body.importId}`, tok)).body || {}).import || {};
  ok("§4 the import foots: \"File $1,800 = imported $775 + scheduled $1,025 + set aside $0\"", imp.footing && imp.footing.balanced === true && /^File \$1,800 = imported \$775 \+ scheduled \$1,025 \+ set aside \$0 ✓$/.test(imp.footing.dollarsSentence), imp.footing && imp.footing.dollarsSentence);
  ok("§4 …every row written, none set aside", imp.footing && imp.footing.rowsSentence === "5 rows in the file = 5 written + 0 set aside ✓", imp.footing && imp.footing.rowsSentence);
  const [linus] = await q("SELECT g.scheduled_on, d.id FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.name='Linus Farrow'", [f.org]);
  const lp = linus ? (await api("GET", `/donors/${linus.id}`, tok)).body || {} : {};
  ok("§4 the imported postdated gift is scheduled, the same rule as by hand", linus && linus.scheduled_on === day(40) && lp.figures && !lp.figures.lifetime.cents && (lp.gifts || []).every(g => g.scheduled === true), { linus, life: lp.figures && lp.figures.lifetime });

  // ── §5 merge fields ──────────────────────────────────────────────────────
  const fields = "{{first_gift_amount}} {{first_gift_date}} | {{last_gift_amount}} {{last_gift_date}} | {{largest_gift_amount}} {{largest_gift_date}}";
  const mf = (await api("POST", "/templates/thanks_first/preview", tok, { donorId: ids.petra, body: fields })).body || {};
  const parts = String(mf.body || "").split(" | ");
  ok("§5 first gift is the earliest ($100)", /^\$100 September 14, \d{4}$/.test(parts[0] || ""), parts[0]);
  ok("§5 last gift is the latest ($40)", /^\$40 /.test(parts[1] || ""), parts[1]);
  ok("§5 largest gift is the largest ($2,500)", /^\$2,500 February 11, \d{4}$/.test(parts[2] || ""), parts[2]);
  const tf = (await api("POST", "/templates/thanks_first/preview", tok, { donorId: ids.petra })).body || {};
  ok("§5 the first-gift thank-you quotes the first gift, never the latest", /your first gift to Truth Six Collective, \$100 on September 14, \d{4}\./.test(tf.body || "") && !/\$40/.test(tf.body || ""), String(tf.body || "").split("\n")[2]);
  const old = (await api("POST", "/templates/thanks_first/preview", tok, { donorId: ids.petra, body: "{{gift_amount}} on {{gift_date}}" })).body || {};
  ok("§5 …and a saved first-gift letter written with {{gift_amount}} reads the first gift too", /^\$100 on September 14, \d{4}$/.test(old.body || ""), old.body);

  // ── §6 audiences ─────────────────────────────────────────────────────────
  const grpAud = (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "audience", audienceId: ids.group } })).body || {};
  const GR = require("../groups");
  const grpN = (await GR.memberIds(f.org, await GR.groupById(f.org, ids.group))).length;
  const leftOut = (grpAud.audience && grpAud.audience.groups || []).reduce((n, g) => n + g.count, 0);
  ok("§6 a group campaign counts the group's members, and every one who can't get it is in a named reason", grpAud.audience && grpAud.audience.total === grpN && grpAud.audience.sendable + leftOut === grpN && (grpAud.audience.groups || []).some(g => g.reason === "no_email"), { line: grpAud.audience && grpAud.audience.line, members: grpN });
  const hub = (await api("GET", "/audiences", tok)).body || {};
  const all = (hub.audiences || []).find(a => a.id === "builtin:donors") || {};
  const counts = (await api("GET", "/donors/counts", tok)).body || {};
  ok("§6 All donors is the Donors count, and says who can't get it and why", all.members === counts.total && /^\d+ people · \d+ can get this email(: .*has no email address.*)?\./.test(all.sentence || ""), { members: all.members, donors: counts.total, sentence: all.sentence });

  // ── §7 the period switch and Finance's bases ─────────────────────────────
  const frThis = (await api("GET", "/fundraising/overview", tok)).body || {};
  const frLast = (await api("GET", "/fundraising/overview?period=last_fy", tok)).body || {};
  ok("§7 This FY shows this FY's goal", frThis.goal && frThis.goal.label === "Annual fund" && (frThis.periodNotes || []).length === 0, frThis.goal && frThis.goal.label);
  ok("§7 Last FY moves the goal (none was set) and says so, naming the year goals are set for", !frLast.goal && (frLast.periodNotes || []).some(n => n.key === "goal" && /No goal was set for FY \d{4}–\d{2}\. Goals are set for .* \(FY \d{4}–\d{2}\)\./.test(n.sentence)), frLast.periodNotes);
  ok("§7 …and says pledges are today's, not the period's", (frLast.periodNotes || []).some(n => n.key === "pledges" && /Pledges are what is open today/.test(n.sentence)), frLast.periodNotes);
  const fsum = (await api("GET", "/finance/summary?yearMode=fiscal", tok)).body || {};
  const gsNow = (await api("GET", `/reports/giving-summary?from=${f.fy.from}&to=${f.today}`, tok)).body || {};   // after §4's import
  const b = fsum.basis || {};
  ok("§7 Finance names each basis", /^Posted to the ledger \(deposit batches\)/.test(b.posted || "") && /^Waiting to post/.test(b.waiting || "") && /^Income in the ledger dated in this period/.test(b.revenue || ""), b);
  ok("§7 one line goes from Fundraising's FY to Finance's FY revenue, and its parts foot", b.fundraisingCents === Math.round(gsNow.total * 100)
    && b.fundraisingCents - b.waitingCents + b.otherIncomeCents + b.scheduledCents + b.elsewhereCents === Math.round(fsum.ytdRevenue * 100)
    && /^Fundraising \$[\d,.]+ [+−] pledges, grants and other income \$[\d,.]+ = Finance \$[\d,.]+\.$/.test(b.line || ""), { line: b.line, sentence: b.sentence });

  // ── §8 the browser ───────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const lg = await api("POST", "/auth/login", null, { email: f.owner, password: f.password });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const NOISE = /\/_vercel\/|fonts\.googleapis|\/favicon|\/ai\/stream/;
    page.on("console", m => { if (m.type() === "error" && !NOISE.test((m.location() || {}).url || "") && !/Download the React DevTools/.test(m.text())) errors.push(m.text()); });
    page.on("response", x => { if (x.status() >= 500 && !NOISE.test(x.url())) errors.push(x.status() + " " + x.url()); });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const shot = n => process.env.TRUTH6_SHOTS ? page.screenshot({ path: path.join(process.env.TRUTH6_SHOTS, n + ".png"), fullPage: true }) : null;

    await page.goto(`${APP}/donors/${ids.ines}`, { waitUntil: "networkidle", timeout: 60000 });
    const life = ((await page.locator('[data-testid="dp-fig-lifetime"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    const last = ((await page.locator('[data-testid="dp-fig-lastGift"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    ok("§8 Ines's profile: Lifetime $150 and Last gift $150, the postdated $1,000 in neither", /\$150\b/.test(life) && !/1,150/.test(life) && /\$150\b/.test(last) && !/1,000/.test(last), { life, last });
    await page.getByRole("tab", { name: /^Giving/ }).first().click({ timeout: 10000 }).catch(() => {});
    const sch = ((await page.locator('[data-testid="dp-gift-scheduled"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    ok("§8 …and her Giving tab lists it \"Scheduled, <day>, not counted yet\"", sch.startsWith(label) && /not counted yet/.test(sch), sch);
    await shot("ines");

    await page.goto(`${APP}/app/fundraising?frPeriod=last_fy`, { waitUntil: "networkidle", timeout: 60000 });
    const goalNote = ((await page.locator('[data-testid="fr-period-note-goal"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    const plNote = ((await page.locator('[data-testid="fr-period-note-pledges"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    ok("§8 Fundraising Last FY says the goal and the pledges can't move with it", /No goal was set for FY/.test(goalNote) && /Pledges are what is open today/.test(plNote), { goalNote, plNote });
    await shot("fundraising-last-fy");

    await page.goto(`${APP}/app/finance`, { waitUntil: "networkidle", timeout: 60000 });
    const recon = ((await page.locator('[data-testid="finance-reconcile"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    const revBasis = await page.locator('[data-testid="fin-revenue-basis"]').first().getAttribute("title", { timeout: 20000 }).catch(() => "");
    const posted = ((await page.locator('[data-testid="ledger-status-posted"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    ok("§8 Finance: the reconciling line, FY revenue's basis on hover, Posted named for its basis", /^Fundraising \$[\d,.]+ [+−] pledges, grants and other income/.test(recon) && /^Income in the ledger dated in this period/.test(revBasis || "") && /Posted to the ledger \(deposit batches\)/.test(posted), { recon, revBasis, posted: posted.slice(0, 80) });
    await shot("finance");

    await page.goto(`${APP}/app/communications`, { waitUntil: "networkidle", timeout: 60000 });
    const aud = ((await page.locator('[data-testid="aud-sentence-builtin:donors"]').first().innerText({ timeout: 20000 }).catch(() => "")) || "");
    ok("§8 Communications: All donors says its people and why each can't get it", new RegExp(`${counts.total} people · \\d+ can get this email`).test(aud) && /has no email address/.test(aud), aud);
    await shot("communications");
    ok("§8 no console error or 5xx on the walk", errors.length === 0, errors.slice(0, 4));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

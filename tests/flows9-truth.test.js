// tests/flows9-truth.test.js · FLOWS-9. TIER 1 FROM THE LEAD, 13 NOV: REFUNDS
// COUNTED ONE WAY, A PREVIEW THAT TELLS THE TRUTH, THREE REPEATS CLOSED.
//
// Each section is one W-ID, checked against a key worked out by hand here,
// never against the app's own SQL. Planted defects, each red:
//   §1 Volunteers-19   the team row counting differently from Tasks (a task whose
//      `done` is unset is open in Tasks and was left out of the row); the footer
//      saying "the morning email is on" when the setting is off.
//   §2 Fundraising-19  an in-app video link that passes the check while its page
//      says "That video is not here" (a cut token, a recording gone from the
//      store); such a draft held out of "Send all reviewed".
//   §3 Fundraising-05  mixed periods on Fundraising with no line saying so.
//   §4 Fundraising-01 / Finance-27X  any surface counting a gift refunded in full:
//      the Giving summary, the Fundraising card, Gifts by fund (the report
//      builder), the gift dialog's count line, the profile's By year, What they
//      support, givers, and the soft-credit box beside Lifetime.
//   §5 Fundraising-36  the preview showing amounts the editor doesn't have.
//   §6 Volunteers-06X  an archived event in the header count or a picker.
//   §B (browser)       the preview's Cover fees box toggles and the total moves
//      ($500 a month → $515.25); the periods line and "1 archived" are on screen;
//      an admin sees Tasks' One person's tasks filter (it never rendered).
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, civilToday, browserLegOrSkip } = require("./helpers");

const ORG = "org_flows9", SLUG = "flows-nine", EMAIL = "admin@flows9.local", PASSWORD = "loadtest1234";
const U = { admin: "u_flows9_admin", dana: "u_flows9_dana" };
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");   // CI-2: this shard's own built client
const optional = p => { try { return require(p); } catch { return null; } };

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Flows Nine','${SLUG}',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ari Admin','admin'), ($5,$2,'dana@flows9.local',$4,'Dana Field','member')`,
    [U.admin, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4), U.dana]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, extra = {}) => {
  const cols = { id, org_id: ORG, name, email: `${id}@flows9.example`, created_by: "test:flows9", created_by_name: "FLOWS-9 test", ...extra };
  const k = Object.keys(cols);
  return q(`INSERT INTO donors (${k.join(",")}) VALUES (${k.map((_, i) => "$" + (i + 1)).join(",")})`, k.map(x => cols[x]));
};
const gift = async (tok, donor, amount, extra = {}) => {
  const r = await api("POST", `/donors/${donor}/gifts`, tok, { amount, date: civilToday(), type: "cash", payment_method: "Check", ...extra });
  return (r.body && (r.body.id || (r.body.gift && r.body.gift.id))) || null;
};

(async () => {
  const tok = await freshOrg();
  const today = civilToday();

  // ── §1 W-1112-Volunteers-19 · the team row is Tasks', the footer is her setting ──
  {
    const T = (id, title, due, who, done = 0) => q(`INSERT INTO tasks (id,org_id,title,due,assigned_to,done) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ORG, title, due, who, done]);
    for (let i = 1; i <= 3; i++) await T(`t_f9_d${i}`, `Dana overdue ${i}`, civilPlusDays(-i), U.dana);
    await T("t_f9_d4", "Dana later", civilPlusDays(40), U.dana);
    await T("t_f9_d5", "Dana done", civilPlusDays(-2), U.dana, 1);
    // A task written with no `done` at all: Tasks reads it as open (every view but done).
    await q(`INSERT INTO tasks (id,org_id,title,due,assigned_to,done) VALUES ('t_f9_d6',$1,'Dana unset',$2,$3,NULL)`, [ORG, civilPlusDays(-4), U.dana]);
    await T("t_f9_a1", "Ari overdue", civilPlusDays(-1), U.admin);
    // By hand: Dana open = d1, d2, d3, d4, d6 = 5; overdue = d1, d2, d3, d6 = 4.
    const dana = (await api("GET", `/tasks/counts?staff=${U.dana}`, tok)).body || {};
    ok("§1 Tasks filtered to Dana: 5 open, 4 overdue (the key)", dana.open === 5 && dana.overdue === 4, JSON.stringify(dana));
    await q(`UPDATE users SET brief_sections = NULL, notify_thread_nudge = true WHERE org_id = $1`, [ORG]);
    const on = (await api("GET", "/me/morning-email", tok)).body || {};
    const html = String(on.html || "").replace(/\s+/g, " ");
    const row = /Dana Field<span[^>]*> · (\d+) open(?: · (\d+) overdue)?/.exec(html);
    ok("§1 the team row's Dana is Tasks' Dana: 5 open, 4 overdue",
      !!row && Number(row[1]) === 5 && Number(row[2] || 0) === 4, row ? row[0] : html.slice(html.indexOf("across the team"), html.indexOf("across the team") + 400));
    ok("§1 with the email on, the footer says it is on", /You get this because the morning email is on/.test(html) && !/This is a preview/.test(html), html.slice(-600));
    await q(`UPDATE users SET notify_thread_nudge = false WHERE id = $1`, [U.admin]);
    const off = (await api("GET", "/me/morning-email", tok)).body || {};
    const offHtml = String(off.html || "").replace(/\s+/g, " ");
    ok("§1 with the email off, the footer never says it is on, and says this is a preview and the email is off",
      !/You get this because the morning email is on/.test(offHtml) && /This is a preview\. Your morning email is off/.test(offHtml) && off.why === "opted_out",
      JSON.stringify({ why: off.why, tail: offHtml.slice(-400) }));
    await q(`UPDATE users SET notify_thread_nudge = true WHERE id = $1`, [U.admin]);
  }

  // ── §2 W-1112-Fundraising-19 · an in-app video link resolves against the video row ──
  {
    const host = ((await api("GET", "/health")).body || {}).publicUrl || {};
    const base = String(host.url || "http://localhost:4173").replace(/\/+$/, "");
    await person("d_f9_h", "Hana Heard");
    await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data) VALUES
             ('pa_f9_real',$1,'video_thanks','video/webm',10,'db','AAAA'), ('pa_f9_gone',$1,'video_thanks','video/webm',10,'db','AAAA')`, [ORG]);
    await q(`UPDATE portal_assets SET deleted_at = NOW() WHERE id = 'pa_f9_gone'`);
    await q(`INSERT INTO video_thanks (id,org_id,donor_id,asset_id,mime,bytes,duration_seconds,token,created_by,created_by_name) VALUES
             ('vt_f9_real',$1,'d_f9_h','pa_f9_real','video/webm',10,3,'realTokenFlows9realTokenFlows9AB','test:flows9','FLOWS-9 test'),
             ('vt_f9_gone',$1,'d_f9_h','pa_f9_gone','video/webm',10,3,'goneAssetFlows9goneAssetFlows9CD','test:flows9','FLOWS-9 test')`, [ORG]);
    const draft = (id, link) => q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name,reviewed_at)
             VALUES ($1,$2,'d_f9_h',$1,'A thank-you',$3,'pending_review','milestone','test:flows9','FLOWS-9 test',NOW())`,
      [id, ORG, `Dear Hana,\n\nI recorded a short video to say thank you. You can watch it here:\n\n${link}\n\nWith gratitude`]);
    await draft("md_f9_cut", `${base}/v/realTokenFlows9`);                          // the token cut short: the page says not here
    await draft("md_f9_gone", `${base}/v/goneAssetFlows9goneAssetFlows9CD`);         // a row whose recording is gone from the store
    await draft("md_f9_real", `${base}/v/realTokenFlows9realTokenFlows9AB`);
    const rows = (await api("GET", "/milestone-drafts", tok)).body || [];
    const by = id => rows.find(r => r.id === id) || {};
    ok("§2 a cut video link is broken, named in the brass line",
      by("md_f9_cut").linkCheck && by("md_f9_cut").linkCheck.ok === false && /not here/.test(by("md_f9_cut").linkCheck.sentence || ""), JSON.stringify(by("md_f9_cut").linkCheck));
    ok("§2 a link to a video whose recording is gone is broken", by("md_f9_gone").linkCheck && by("md_f9_gone").linkCheck.ok === false, JSON.stringify(by("md_f9_gone").linkCheck));
    ok("§2 the real, playable video's draft carries no warning", by("md_f9_real").linkCheck && by("md_f9_real").linkCheck.ok === true, JSON.stringify(by("md_f9_real").linkCheck));
    // Only the broken ones are marked reviewed: "Send all reviewed" must hold both and send nothing.
    await q(`UPDATE milestone_drafts SET reviewed_at = NULL WHERE id = 'md_f9_real'`);
    const sr = (await api("POST", "/milestone-drafts/send-reviewed", tok, {})).body || {};
    const status = (await q(`SELECT id, status FROM milestone_drafts WHERE org_id = $1 ORDER BY id`, [ORG])).map(r => r.status);
    ok("§2 a draft whose video isn't there is never sent as ready: Send all reviewed holds both, nothing sends",
      sr.sent === 0 && (sr.failed || []).length === 2 && status.every(s => s === "pending_review"), JSON.stringify({ sr, status }));
    await q(`DELETE FROM milestone_drafts WHERE org_id = $1`, [ORG]);
  }

  // ── §3 W-1112-Fundraising-05 · mixed periods get one line ─────────────────
  {
    const before = (await api("GET", "/fundraising/overview", tok)).body || {};
    ok("§3 with no campaign card, no periods line", before.periodsDiffer == null, before.periodsDiffer);
    await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,status,start_date,end_date,goal_category) VALUES
      ('c_f9_cal',$1,'Calendar Push',10000,'active',$2,$3,'project')`, [ORG, civilPlusDays(-30), civilPlusDays(30)]);
    const ov = (await api("GET", "/fundraising/overview?bust=1", tok)).body || {};
    ok("§3 a campaign on its own dates beside Raised on the fiscal year: the line, word for word",
      ov.periodsDiffer === "Campaigns count their own dates. Raised counts your fiscal year, Jul 1 to Jun 30.", JSON.stringify({ line: ov.periodsDiffer, start: ov.period && ov.period.start }));
  }

  // ── §4 W-1113-Fundraising-01 / Finance-27X · a refund is counted one way ──
  {
    await person("d_f9_r", "Rory Refund");
    await person("d_f9_s", "Sol Spouse");
    await person("d_f9_x", "Xan Extra");
    const full = await gift(tok, "d_f9_r", 100);          // refunded in full: no gift, $0
    const part = await gift(tok, "d_f9_r", 200);          // $50 back: one gift, $150
    const keep = await gift(tok, "d_f9_x", 25);           // untouched: one gift, $25
    const soft = await gift(tok, "d_f9_s", 40);           // Sol's, soft-credited to Rory, refunded in full
    await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ('sc_f9_1',$1,$2,'d_f9_r',40,'spouse','test:flows9','FLOWS-9 test')`, [ORG, soft]);
    const r1 = await api("POST", `/gifts/${full}/refund`, tok, { amount: 100, date: today, reason: "charged twice" });
    const r2 = await api("POST", `/gifts/${part}/refund`, tok, { amount: 50, date: today, reason: "part back" });
    const r3 = await api("POST", `/gifts/${soft}/refund`, tok, { amount: 40, date: today, reason: "event cancelled" });
    ok("§4 the three refunds are recorded", [r1, r2, r3].every(r => r.status < 300), [r1, r2, r3].map(r => r.status + " " + JSON.stringify(r.body).slice(0, 120)));
    // By hand, today: gifts counted = part ($150 net) + keep ($25) = 2; net = $175; givers = Rory, Xan = 2.
    const KEY = { gifts: 2, net: 175, givers: 2 };
    const from = civilPlusDays(-1), to = today;
    const fig = async (params) => (await api("GET", `/figures/gifts/rows?from=${from}&to=${to}${params}`, tok)).body || {};
    const sum = await fig(""), cnt = await fig("&measure=count");
    ok("§4 the gift dialog: its count line says 2 gifts over rows that net to $175, the refund rows listed and marked",
      sum.giftCount === KEY.gifts && Math.round(Number(sum.value)) === KEY.net && (sum.rows || []).filter(r => r.detail === "Refund").length === 3
      && (sum.rows || []).some(r => /^Refunded in full/.test(r.detail || "")), JSON.stringify({ giftCount: sum.giftCount, value: sum.value, details: (sum.rows || []).map(r => r.detail) }));
    ok("§4 the count figure: 2", Number(cnt.value) === KEY.gifts, JSON.stringify({ value: cnt.value }));
    const gs = (await api("GET", `/reports/giving-summary?from=${from}&to=${to}`, tok)).body || {};
    const gsF = gs.figures || {};
    ok("§4 the Giving summary: 2 gifts, $175, 2 donors", Number(gs.giftCount) === KEY.gifts && Math.round(Number(gs.total)) === KEY.net
      && Number(gsF.uniqueDonors && gsF.uniqueDonors.value) === KEY.givers, JSON.stringify({ giftCount: gs.giftCount, total: gs.total, donors: gsF.uniqueDonors && gsF.uniqueDonors.value }));
    ok("§4 the Giving summary's average is over the 2 gifts at their net: ($150 + $25) ÷ 2 = $87.50",
      Math.abs(Number(gsF.avgGift && gsF.avgGift.value) - 87.5) < 0.01, JSON.stringify(gsF.avgGift && gsF.avgGift.value));
    const ov = (await api("GET", "/fundraising/overview?bust=2", tok)).body || {};
    ok("§4 the Fundraising card: 2 gifts, $175, 2 donors (all today, inside this fiscal year)",
      ov.period && ov.period.giftCount === KEY.gifts && Math.round(ov.period.raised) === KEY.net && ov.period.donorCount === KEY.givers,
      JSON.stringify(ov.period && { n: ov.period.giftCount, raised: ov.period.raised, donors: ov.period.donorCount }));
    const rb = (await api("POST", "/report-builder/run", tok, { definition: { entity: "gifts", columns: [], groupBy: "fund" } })).body || {};
    const rbCount = (rb.rows || []).reduce((n, r) => n + (Number(r.count) || 0), 0);
    ok("§4 Gifts by fund (the report builder): 2 gifts across the funds", rb.grouped === true && rbCount === KEY.gifts,
      JSON.stringify({ grouped: rb.grouped, rows: rb.rows, err: rb.error }));
    const bg = (await api("GET", `/reports/by-group?from=${from}&to=${to}&groupBy=funds`, tok)).body || {};
    ok("§4 Reports' Gifts by fund: its total counts 2 gifts", Number(bg.figures && bg.figures.grandCount && bg.figures.grandCount.value) === KEY.gifts,
      JSON.stringify({ grand: bg.figures && bg.figures.grandCount, rows: (bg.rows || []).map(r => [r.name, r.giftCount]) }));
    // The profile: Rory has one gift ($150 net) and $0 from the refunded $100.
    const by = (await api("GET", "/donors/d_f9_r/by-year", tok)).body || {};
    const yr = (by.years || []).find(y => today >= y.from && today <= y.to) || {};
    ok("§4 the profile's By year: 1 gift, $150", yr.giftCount === 1 && Math.round(Number(yr.total)) === 150, JSON.stringify({ n: yr.giftCount, total: yr.total }));
    const fa = (await api("GET", "/donors/d_f9_r/fund-affinity", tok)).body || {};
    const faCount = (fa.affinity || []).reduce((n, f) => n + (Number(f.giftCount ?? f.gift_count ?? f.count) || 0), 0);
    ok("§4 the profile's What they support: 1 gift in all", faCount === 1, JSON.stringify(fa).slice(0, 400));
    const prof = (await api("GET", "/donors/d_f9_r", tok)).body || {};
    const listed = (prof.gifts || []).filter(g => Number(g.amount) > 0 && !g.refunded_in_full && !g.refund_of).length;
    ok("§4 the profile's Gift History counts 1 (the refund rows and the refunded $100 listed, not counted)", listed === 1, (prof.gifts || []).map(g => `${g.amount}:${g.refunded_in_full}`));
    const sc = (await api("GET", "/donors/d_f9_r/soft-credit", tok)).body || {};
    const life = (await api("GET", "/figures/donor-lifetime/rows?donor=d_f9_r", tok)).body || {};
    ok("§4 the soft-credit box's Their own giving is Lifetime: $150 both", Math.round(Number(sc.ownGiving)) === 150 && Math.round(Number(life.value)) === 150,
      JSON.stringify({ own: sc.ownGiving, life: life.value }));
    const sol = (await api("GET", "/donors/d_f9_s/by-year", tok)).body || {};
    const solYr = (sol.years || []).find(y => today >= y.from && today <= y.to) || {};
    ok("§4 Sol's refunded-in-full gift: 0 gifts, $0 in the year", solYr.giftCount === 0 && Math.round(Number(solYr.total)) === 0, JSON.stringify({ n: solYr.giftCount, total: solYr.total }));
    // Taking the $100 refund back un-marks the gift, so it counts again: Rory 2 gifts, $250.
    const [rf] = await q(`SELECT id FROM gifts WHERE org_id = $1 AND refund_of = $2`, [ORG, full]);
    const del = await api("DELETE", `/gifts/${rf && rf.id}`, tok);
    const by2 = (await api("GET", "/donors/d_f9_r/by-year", tok)).body || {};
    const yr2 = (by2.years || []).find(y => today >= y.from && today <= y.to) || {};
    ok("§4 a refund taken back: the gift is a gift again (2 gifts, $250 in the year)", del.status < 300 && yr2.giftCount === 2 && Math.round(Number(yr2.total)) === 250,
      JSON.stringify({ del: del.status, n: yr2.giftCount, total: yr2.total }));
  }

  // ── §5 W-1113-Fundraising-36 · the preview renders the saved editor config ──
  {
    const made = (await api("POST", "/giving-pages", tok, { title: "Spring Appeal", slug: "spring-appeal-f9" })).body || {};
    const pageId = made.id || (made.page && made.page.id);
    const cfg = { amountsCents: [2500, 5000, 10000, 25000], smartAmounts: true };
    await q(`UPDATE giving_pages SET form_config = COALESCE(form_config, '{}'::jsonb) || $1::jsonb, status = 'active' WHERE id = $2 AND org_id = $3`, [JSON.stringify(cfg), pageId, ORG]);
    // Ten gifts of $500 on file: enough for the live page's own suggestions to differ.
    await person("d_f9_g", "Gale Ladder");
    for (let i = 0; i < 10; i++) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,'d_f9_g',500,$3,'cash','test:flows9','FLOWS-9 test')`,
      [`g_f9_l${i}`, ORG, civilPlusDays(-20 - i)]);
    const pv = (await api("GET", `/giving-pages/${pageId}/page/preview`, tok)).body || {};
    const amt = (pv.givingPage && pv.givingPage.form && pv.givingPage.form.amount) || (pv.form && pv.form.amount) || {};
    ok("§5 the preview shows exactly the editor's amounts, in her order: $25, $50, $100, $250",
      JSON.stringify(amt.amountsCents) === JSON.stringify(cfg.amountsCents), JSON.stringify({ amounts: amt.amountsCents, keys: Object.keys(pv) }));
    ok("§5 with Suggest amounts on, the preview says what the live page offers instead",
      /This preview shows the amounts you set\. Suggest amounts from your giving is on/.test(amt.liveSentence || ""), amt.liveSentence);
    await q(`UPDATE giving_pages SET form_config = form_config || '{"smartAmounts":false}'::jsonb WHERE id = $1`, [pageId]);
    const pv2 = (await api("GET", `/giving-pages/${pageId}/page/preview`, tok)).body || {};
    const amt2 = (pv2.givingPage && pv2.givingPage.form && pv2.givingPage.form.amount) || {};
    ok("§5 with it off, the preview and its amounts carry no such line", JSON.stringify(amt2.amountsCents) === JSON.stringify(cfg.amountsCents) && !amt2.liveSentence, JSON.stringify(amt2));
    globalThis.__f9page = pageId;
  }

  // ── §6 W-1113-Volunteers-06X · an archived event is counted and offered nowhere ──
  {
    const year = today.slice(0, 4);
    const ev = (id, name, date) => q(`INSERT INTO events (id,org_id,name,event_type,date,status,created_by,created_by_name) VALUES ($1,$2,$3,'gala',$4,'upcoming','test:flows9','FLOWS-9 test')`, [id, ORG, name, date]);
    await ev("e_f9_1", "Lantern Supper", `${year}-03-10`);
    await ev("e_f9_2", "River Walk", `${year}-06-02`);
    await ev("e_f9_3", "Old Barn Dance", `${year}-04-20`);
    await person("d_f9_e", "Eli Eventgoer");
    await gift(tok, "d_f9_e", 30, { eventId: "e_f9_3" });
    const arch = await api("POST", "/events/e_f9_3/archive", tok, {});
    const head = (await api("GET", `/figures/events-year-events/rows?from=${year}-01-01&to=${year}-12-31`, tok)).body || {};
    ok("§6 the Events header counts 2, the archived one out (by hand: 3 events, 1 archived)", arch.status < 300 && Number(head.value) === 2, JSON.stringify({ arch: arch.status, value: head.value }));
    const choices = ((await api("GET", "/event-choices", tok)).body || {}).events || [];
    ok("§6 Record a gift's Event picker leaves the archived event out", choices.length === 2 && !choices.some(e => e.id === "e_f9_3"), choices.map(e => e.name));
    const auc = ((await api("GET", "/auctions", tok)).body || {}).events || [];
    ok("§6 the auction's Part of an event picker leaves it out", !auc.some(e => e.id === "e_f9_3"), auc.map(e => e.name));
    const kept = (await q(`SELECT event_id FROM gifts WHERE org_id = $1 AND donor_id = 'd_f9_e'`, [ORG]))[0] || {};
    ok("§6 the gift already on the archived event keeps it", kept.event_id === "e_f9_3", kept);
  }

  // ── §B the browser: cover fees toggle in the preview; the lines on screen ──
  const pw = optional(PW);
  const why = !pw ? "playwright not installed" : !require("fs").existsSync(path.join(DIST, "index.html")) ? "no client dist" : null;
  if (browserLegOrSkip(why, "(browser leg)")) { await closeDb(); summary(); return; }
  const browser = await pw.chromium.launch();
  try {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const me = (await api("GET", "/me", tok)).body;
    await pg.addInitScript(([tk, u, o]) => {
      localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [tok, JSON.stringify(me.user || me), JSON.stringify(me.org || {})]);
    const errors = [];
    pg.on("pageerror", e => errors.push(String(e && e.message || e)));
    const tid = id => pg.locator(`[data-testid="${id}"]`).first();
    const shots = process.env.FLOWS9_SHOTS;
    const shot = async n => { if (shots) await pg.screenshot({ path: path.join(shots, n + ".png") }).catch(() => {}); };

    // Fundraising: the periods line under the cards.
    await pg.goto(`${APP}/app/fundraising`, { waitUntil: "networkidle", timeout: 60000 });
    await tid("fr-periods-differ").waitFor({ timeout: 20000 }).catch(() => {});
    const line = await tid("fr-periods-differ").innerText().catch(() => "");
    await shot("b1-fundraising");
    ok("§B Fundraising shows the periods line under the cards", line === "Campaigns count their own dates. Raised counts your fiscal year, Jul 1 to Jun 30.", line);

    // Events: the header says 2 and "1 archived", which opens the Archived tab.
    await pg.goto(`${APP}/app/events`, { waitUntil: "networkidle", timeout: 60000 });
    await tid("events-archived-link").waitFor({ timeout: 20000 }).catch(() => {});
    const archText = await tid("events-archived-link").innerText().catch(() => "");
    await tid("events-archived-link").click({ timeout: 5000 }).catch(() => {});
    await pg.waitForTimeout(400);
    const body = await pg.evaluate(() => document.body.innerText);
    await shot("b2-events-archived");
    ok("§B Events: \"1 archived\" under the header opens the Archived tab with Old Barn Dance", archText === "1 archived" && /Old Barn Dance/.test(body), archText);

    // Tasks: an admin can open one person's tasks (the team row's lines are that view).
    await pg.goto(`${APP}/app/tasks`, { waitUntil: "networkidle", timeout: 60000 });
    await tid("tasks-staff").waitFor({ timeout: 15000 }).catch(() => {});
    ok("§B Tasks shows an admin the One person's tasks filter", await tid("tasks-staff").isVisible().catch(() => false), "no tasks-staff select");

    // The giving page editor's preview: $500 a month with fees covered is $515.25.
    await q(`UPDATE giving_pages SET form_config = form_config || '{"amountsCents":[2500,50000,100000],"defaultFrequency":"monthly","showCoverFee":true}'::jsonb WHERE id = $1`, [globalThis.__f9page]);
    await q(`UPDATE orgs SET cover_fees_enabled = true WHERE id = $1`, [ORG]).catch(() => {});
    await pg.goto(`${APP}/portal-editor?page=${encodeURIComponent(globalThis.__f9page)}`, { waitUntil: "networkidle", timeout: 60000 });
    const form = pg.locator(".give-steps").first();
    await form.waitFor({ timeout: 30000 }).catch(() => {});
    const amounts = await form.locator(".give-amt button, button.give-amt").allInnerTexts().catch(() => []);
    await form.locator("button", { hasText: /^\$500$/ }).first().click({ timeout: 5000 }).catch(() => {});
    await form.locator("button.give-next").first().click({ timeout: 5000 }).catch(() => {});
    await form.locator(".give-first").fill("Pat", { timeout: 5000 }).catch(() => {});
    await form.locator(".give-last").fill("Preview", { timeout: 5000 }).catch(() => {});
    await form.locator(".give-email").fill("pat@flows9.example", { timeout: 5000 }).catch(() => {});
    await form.locator("button.give-next").last().click({ timeout: 5000 }).catch(() => {});
    const cover = form.locator(".give-cover input[type=checkbox]").first();
    const pay = form.locator("button.give-pay").first();
    await cover.waitFor({ timeout: 10000 }).catch(() => {});
    const t0 = await pay.innerText().catch(() => "");
    await cover.click({ timeout: 5000 }).catch(() => {});
    await pg.waitForTimeout(300);
    const t1 = await pay.innerText().catch(() => ""), on1 = await cover.isChecked().catch(() => null);
    await cover.click({ timeout: 5000 }).catch(() => {});
    await pg.waitForTimeout(300);
    const t2 = await pay.innerText().catch(() => ""), on2 = await cover.isChecked().catch(() => null);
    await shot("b3-preview-cover");
    ok("§B the preview's Cover fees toggles on and off, and the total moves $500 → $515.25 → $500 a month",
      /\$500(\.00)? a month/.test(t0) && /\$515\.25 a month/.test(t1) && on1 === true && on2 === false && /\$500(\.00)? a month/.test(t2),
      JSON.stringify({ amounts, t0, t1, on1, t2, on2 }));
    ok("§B no page error on the way", errors.length === 0, errors.slice(0, 3));
  } finally { await browser.close(); }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });

// tests/polish1/part1-footing.js · POLISH-1 Part 1. THE DONOR PROFILE FOOTS.
//
// One donor with three gifts, a refund, a soft credit on somebody else's gift
// and an open pledge. Every number the profile shows is checked against the
// gifts table itself:
//   Lifetime     = SUM(gifts.amount) for the person (the refund comes off)
//   gift count   = the rows above zero (a refund is not a gift)
//   Average      = Lifetime / count, to the cent, and its words name the refund
//   the drawer   = the average opens rows that foot to the figure
//   soft credit and pledge are in none of them
//   Room to give = its trend sentence reads the chart's calendar-year bars
//   engagement   = a meeting only BOOKED is never "1 meeting" beside Last met
//   phone        = "7315061544" shows as (731) 506-1544 and dials tel:+1…
//
// HOW IT WENT RED ON MAIN: the average was the mean of the gifts above zero
// ($2,000.00 of 3 gifts) beside a $5,500.00 Lifetime; the trend said "in the
// last twelve months" over windows the chart does not draw; a booked meeting
// read "1 meeting in the last 24 months" beside Last met's "Not met yet"; and
// shared/phone.js did not exist.
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const ORG = "org_pol1foot";
const A = "d_pol1foot_a", B = "d_pol1foot_b", C = "d_pol1foot_c";
const ADMIN = `admin@${ORG}.test`;

module.exports = async function partOne(h) {
  const { ok, q, BASE } = h;
  const del = async () => {
    for (const t of ["person_photos", "gift_soft_credits", "pledges", "interactions", "threads", "donor_scores", "fin_transactions", "gifts", "tasks"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    }
    await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  };
  await del();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Polish Footing Test','polish-footing-test',1,'active','team','America/New_York') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Foot Admin','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`, [`u_${ORG}`, ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const who = [`u_${ORG}`, "Foot Admin"];
  const [{ today }] = await q(`SELECT to_char((NOW() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS today`);
  const Y = Number(today.slice(0, 4));
  for (const [id, name, phone] of [[A, "Fern Footing", "7315061544"], [B, "Basil Other", null]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,phone,status,stage,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'active','steward','["donor"]'::jsonb,$6,$7)`, [id, ORG, name, `${id}@example.org`, phone, ...who]);
  }
  // Rising by calendar year, net of the refund: 1,000 / 2,000 / 3,000 - 500.
  const gifts = [[`g_${ORG}_1`, A, 1000, `${Y - 3}-03-02`], [`g_${ORG}_2`, A, 2000, `${Y - 2}-04-03`],
    [`g_${ORG}_3`, A, 3000, `${Y - 1}-05-04`], [`g_${ORG}_r`, A, -500, `${Y - 1}-06-05`], [`g_${ORG}_b`, B, 4000, `${Y - 1}-07-06`]];
  for (const [id, d, amt, date] of gifts) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'Check',$7,$8)`, [id, ORG, d, amt, date, amt < 0 ? "refund" : "check", ...who]);
  }
  await q(`UPDATE donors d SET total_giving = (SELECT SUM(amount) FROM gifts g WHERE g.donor_id = d.id) WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,4000,'other',$5,$6)`,
    [`sc_${ORG}`, ORG, `g_${ORG}_b`, A, ...who]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ($1,$2,$3,10000,$4,'open',$5,$6)`,
    [`pl_${ORG}`, ORG, A, `${Y + 1}-01-15`, ...who]);
  // A meeting BOOKED for next week (the calendar sync's booking line), none held.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name)
           VALUES ($1,$2,$3,'note','Meeting booked: coffee',$4,$5::jsonb,'system:calendar','Steward')`,
    [`i_${ORG}_bk`, ORG, A, today, JSON.stringify({ kind: "meeting_booked", meeting_day: today })]);

  const tok = (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: "loadtest1234" }) })).json()).token;
  ok("§1 the fixture admin signs in", !!tok);
  const get = async p => (await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } })).json();
  const cents = v => Math.round(Number(v) * 100);

  const [{ sum, n, refunds }] = await q(`SELECT SUM(amount)::text AS sum, (COUNT(*) FILTER (WHERE amount > 0))::int AS n,
      (-COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0))::text AS refunds FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, A]);
  const profile = await get(`/donors/${A}`);
  const status = await get(`/donors/${A}/status`);
  const life = profile.figures && profile.figures.lifetime;
  const avg = status.glance && status.glance.average;
  ok("§1 Lifetime is the gifts table, the refund taken off ($5,500.00)", life && cents(life.value) === cents(sum) && cents(sum) === 550000, { life, sum });
  ok("§1 the gift count is the rows above zero (3, not 4 rows)", avg && avg.count === n && n === 3, { count: avg && avg.count, n });
  ok("§1 Lifetime / count = Average, to the cent", avg && Math.round(cents(sum) / n) === cents(avg.value), { avg: avg && avg.value, expect: Math.round(cents(sum) / n) / 100 });
  ok("§1 the average names the refund it took off", avg && avg.refunds === 1 && avg.refundCents === cents(refunds), avg);
  ok("§1 nothing imported as a total, so nothing else is left out", avg && avg.importedCents === 0, avg);
  ok("§1 the soft credit and the pledge are in neither number", cents(sum) === 550000 && avg && cents(avg.value) === 183333);
  const drawer = await get(`/figures/donor-average-gift/rows?donor=${A}&pageSize=50`);
  const rowSum = (drawer.rows || []).reduce((s, r) => s + cents(r.amount), 0);
  ok("§1 the average opens rows that foot: their total over the gifts is the figure",
    drawer.giftCount === 3 && Math.round(rowSum / drawer.giftCount) === cents(avg && avg.value) && rowSum === cents(sum), { giftCount: drawer.giftCount, rowSum });
  const listed = (profile.gifts || []).filter(g => Number(g.amount) > 0).length;
  const chartSum = (profile.gifts || []).reduce((s, g) => s + cents(g.amount), 0);
  ok("§1 the Gifts tab and the Giving by year chart read the same rows (3 gifts, $5,500.00)", listed === 3 && chartSum === cents(sum), { listed, chartSum });

  const room = await get(`/donors/${A}/room-to-give`);
  const rising = (room.reasons || []).find(r => /three years running/.test(r.text));
  ok("§1 Room to give's trend is the chart's own bars, by calendar year",
    rising && rising.text === `Giving up three years running ($1,000 in ${Y - 3}, $2,000 in ${Y - 2}, then $2,500 in ${Y - 1})`, room.reasons);

  await fetch(BASE + "/scores/recompute", { method: "POST", headers: { Authorization: "Bearer " + tok } });
  const sc = await get(`/donors/${A}/scores`);
  const lastMet = profile.figures && profile.figures.lastMet;
  ok("§1 Last met reads no meeting held (only one booked)", lastMet && lastMet.value === null, lastMet);
  ok("§1 the engagement line never calls a booking a meeting held", sc.reason && !/\b1 meeting in\b/.test(sc.reason) && /meeting booked/.test(sc.reason), sc.reason);

  let P = null;
  try { P = await import("../../shared/phone.js"); } catch { P = null; }
  ok("§1 a bare phone number shows formatted and dials", P && P.phoneDisplay("7315061544") === "(731) 506-1544" && P.phoneHref("7315061544") === "tel:+17315061544");
  ok("§1 a number with an extension is shown as typed, and the link dials the number",
    P && P.phoneDisplay("731.506.1544 ext 4") === "731.506.1544 ext 4" && P.phoneHref("731.506.1544 ext 4") === "tel:+17315061544");

  // §1h THE HEADER IS THE SAME WITH A PHOTO (Jonathan, 13 Oct). A second
  // person gets a photo through the real upload route; at 1440 and 390 the
  // name's left edge and top, and the mark's box, match the person without one.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,person_types,created_by,created_by_name)
           VALUES ($1,$2,'Pia Photograph',$3,'active','cultivate','["donor"]'::jsonb,$4,$5)`, [C, ORG, `${C}@example.org`, ...who]);
  const img = "data:image/jpeg;base64," + fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "demo-assets", "demo-impact-studio.jpg")).toString("base64");
  const up = await fetch(BASE + `/donors/${C}/photo`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ image: img }) });
  ok("§1h the photo is stored through the upload route", up.status === 200, up.status);
  const why = browserWhy(BASE);
  if (!h.browserLegOrSkip(why, "§1h")) {
    const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
    const APP = process.env.APP_URL || "http://localhost:4173";
    const login = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN, password: "loadtest1234" }) })).json();
    const b = await chromium.launch();
    for (const w of [1440, 390]) {
      const box = {};
      for (const id of [A, C]) {
        const pg = await b.newPage({ viewport: { width: w, height: 900 } });
        await pg.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
          [login.token, JSON.stringify(login.user), JSON.stringify(login.org)]);
        await pg.goto(`${APP}/donors/${id}`, { waitUntil: "domcontentloaded" });
        await pg.waitForSelector('[data-testid="dp-name"]', { timeout: 30000 }).catch(() => {});
        await pg.waitForTimeout(1500);
        const photo = await pg.locator('[data-testid="dp-identity"] img[data-testid="person-mark"]').count();
        const n = await pg.locator('[data-testid="dp-name"]').first().boundingBox({ timeout: 4000 }).catch(() => null);
        const m = await pg.locator('[data-testid="donor-photo-drop"]').first().boundingBox({ timeout: 4000 }).catch(() => null);
        box[id] = { photo, n, m };
        await pg.close();
      }
      const [a, c] = [box[A], box[C]];
      const near = (x, y) => x && y && Math.abs(x - y) <= 1;
      ok(`§1h @${w} the photo really renders on one and not the other`, a.photo === 0 && c.photo === 1, { a: a.photo, c: c.photo });
      ok(`§1h @${w} the name starts at the same left edge and top, photo or not`,
        a.n && c.n && near(a.n.x, c.n.x) && near(a.n.y, c.n.y), { without: a.n, with: c.n });
      ok(`§1h @${w} the mark is the same box, top-aligned with the name`,
        a.m && c.m && near(a.m.x, c.m.x) && near(a.m.y, c.m.y) && near(a.m.width, c.m.width) && Math.abs(c.m.y - c.n.y) <= 8, { without: a.m, with: c.m, name: c.n });
    }
    await b.close();
  }

  await del();
};

// The same reasons smoke-walk gives for not driving a browser.
function browserWhy(BASE) {
  const DIST = path.join(__dirname, "..", "..", "client", "dist");
  if (!fs.existsSync(path.join(DIST, "index.html"))) return "client/dist not built";
  const assets = path.join(DIST, "assets");
  const origin = BASE.replace(/^https?:\/\//, "");
  const js = fs.existsSync(assets) ? fs.readdirSync(assets).filter(f => f.endsWith(".js")) : [];
  if (!js.some(f => fs.readFileSync(path.join(assets, f), "utf8").includes(origin))) return "client/dist not built against the local API";
  try { require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright")); }
  catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
  return null;
}

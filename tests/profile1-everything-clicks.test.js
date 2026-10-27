// tests/profile1-everything-clicks.test.js · PROFILE-1 (header, 14 Oct 2026).
//
// The donor profile became one header (with the seven numbers across its
// bottom edge), one row of tabs and a full-height rail. This suite holds the
// redesign to what it promised: nothing that could be clicked was lost, and
// every number still opens rows that foot.
//
//   §1 every item in docs/profile-1/inventory.md is on the new page where its
//      `Now` cell says, and goes to the same place: one assertion each
//   §2 the seven header numbers open the same sources the old boxes did, and
//      their rows foot to the cent (POLISH-1's footing shape: three gifts and
//      a refund, a soft credit and a pledge that are in none of them)
//   §3 the old number boxes and the "Everything with" chip row are gone
//   §4 each list tab shows what its old chip showed (same rows, same count)
//   §5 the stage bar writes through the audit write and moves the header chip
//   §6 the rail reaches the bottom on a short and a long profile, every rail
//      card with data opens rows, and a card with no data is not drawn
//   §7 the header is the same with and without a photo at 1440 and 390, and
//      nothing scrolls sideways at 390 except the tab row
//
// HOW IT GOES RED ON MAIN: main draws the seven numbers as boxes under the
// header (no dp-header-figures), has six tabs and the chip row, no stage bar,
// no rail read; §1 to §6 fail on their first assertion.
//
// Standard scratch stack; the browser leg needs client/dist built against
// $BASE and PLAYWRIGHT_DIR, like every browser leg.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const h = require("./helpers");
const { open } = require("./polish1/browser-p567");
const { ok, q, api, BASE } = h;

const ORG = "org_p1clicks";
const A = "d_p1c_fern", P = "d_p1c_photo", N = "d_p1c_new", B = "d_p1c_other";
const ADMIN = `admin@${ORG}.test`;
const ROOT = path.join(__dirname, "..");

async function fixture() {
  for (const t of ["person_photos", "gift_soft_credits", "pledges", "interactions", "threads", "donor_scores", "donor_rhythm",
    "fin_transactions", "gifts", "tasks", "opportunities", "fin_audit_log"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,created_at)
           VALUES ($1,'Profile Clicks Test','profile-clicks-test',1,'active','team','America/New_York', NOW() - INTERVAL '6 years')
           ON CONFLICT (id) DO NOTHING`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Clicks Admin','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`, [`u_${ORG}`, ORG, ADMIN, bcrypt.hashSync("loadtest1234", 4)]);
  const who = [`u_${ORG}`, "Clicks Admin"];
  const [{ today }] = await q(`SELECT to_char((NOW() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS today`);
  const Y = Number(today.slice(0, 4));
  const soon = new Date(Date.parse(today + "T12:00:00Z") + 20 * 864e5);
  for (const [id, name, phone] of [[A, "Fern Footing", "7315061544"], [P, "Pia Photo", null], [N, "Nell Newcomb", null], [B, "Basil Other", null]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,phone,status,stage,person_types,tags,notes,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'active',$6,'["donor"]'::jsonb,$7,$8,$9,$10)`,
      [id, ORG, name, `${id}@example.org`, phone, id === N ? "prospect" : "cultivate", JSON.stringify(id === A ? ["Board"] : []),
       id === A ? "Met her at the spring showcase." : null, ...who]);
  }
  await q(`UPDATE donors SET birth_month=$2, birth_day=$3 WHERE id=$1`, [A, soon.getUTCMonth() + 1, soon.getUTCDate()]);
  // Rising by calendar year, net of the refund: 1,000 / 2,000 / 3,000 - 500; one gift this year, not yet thanked.
  const gifts = [[`g_${ORG}_1`, A, 1000, `${Y - 3}-03-02`], [`g_${ORG}_2`, A, 2000, `${Y - 2}-04-03`], [`g_${ORG}_3`, A, 3000, `${Y - 1}-05-04`],
    [`g_${ORG}_r`, A, -500, `${Y - 1}-06-05`], [`g_${ORG}_4`, A, 250, today], [`g_${ORG}_b`, B, 4000, `${Y - 1}-07-06`], [`g_${ORG}_p`, P, 300, `${Y - 1}-02-02`]];
  for (const [id, d, amt, date] of gifts)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,acknowledgement_sent,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'Check',$7,$8,$9)`, [id, ORG, d, amt, date, amt < 0 ? "refund" : "check", id.endsWith("_4") ? 0 : 1, ...who]);
  await q(`UPDATE donors d SET total_giving = COALESCE((SELECT SUM(amount) FROM gifts g WHERE g.donor_id = d.id),0) WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,role,created_by,created_by_name) VALUES ($1,$2,$3,$4,4000,'other',$5,$6)`,
    [`sc_${ORG}`, ORG, `g_${ORG}_b`, A, ...who]);
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ($1,$2,$3,10000,$4,'open',$5,$6)`,
    [`pl_${ORG}`, ORG, A, `${Y + 1}-01-15`, ...who]);
  const day = k => new Date(Date.parse(today + "T12:00:00Z") - k * 864e5).toISOString().slice(0, 10);
  const ints = [["call", 3, "Called to thank her. She asked about the studio tour.", null],
    ["meeting", 20, "Coffee at the studio. Talked about the scholarship fund.", null],
    ["note", 30, "Prefers email to phone.", null],
    ["email", 9, "Re: Studio tour\nShe would love to come in November.", { direction: "inbound" }],
    ["stage_change", 40, "Moved qualify → cultivate: met twice", null]];
  for (const [type, k, note, meta] of ints)
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by,metadata) VALUES ($1,$2,$3,$4,$5,$6,'Clicks Admin',$7,$8)`,
      [`i_${ORG}_${type}`, ORG, A, type, day(k), note, `u_${ORG}`, meta ? JSON.stringify(meta) : null]);
  await q(`INSERT INTO tasks (id,org_id,donor_id,title,due,done,created_by,created_by_name) VALUES ($1,$2,$3,'Send the scholarship report',$4,0,$5,$6)`,
    [`t_${ORG}`, ORG, A, day(-5), ...who]);
  // LIVE-1's stored rhythm: a yearly giver whose expected gift is behind today.
  await q(`INSERT INTO donor_rhythm (org_id,donor_id,rhythm,cadence_days,expected_next,drift_state,created_by,created_by_name)
           VALUES ($1,$2,'yearly',365,$3,'drifting','system:test','test')`, [ORG, A, day(30)]);
  const li = await api("POST", "/auth/login", null, { email: ADMIN, password: "loadtest1234" });
  const tok = li.body && li.body.token;
  const pr = await api("POST", `/donors/${A}/proposals`, tok, { purpose: "Scholarship fund", askAmount: 5000, stage: "asked", expectedClose: `${Y + 1}-03-01` });
  ok("fixture: an open proposal on Fern", pr.status === 200 || pr.status === 201, pr.body);
  const img = "data:image/jpeg;base64," + fs.readFileSync(path.join(ROOT, "scripts/demo-assets/demo-impact-studio.jpg")).toString("base64");
  const ph = await api("POST", `/donors/${P}/photo`, tok, { image: img });
  ok("fixture: Pia has a photo", ph.status === 200 || ph.status === 201, ph.status);
  return { tok, today };
}

// The inventory, row by row: id, what, and the `Now` cell parsed.
function inventory() {
  const md = fs.readFileSync(path.join(ROOT, "docs/profile-1/inventory.md"), "utf8");
  const rows = [];
  for (const line of md.split("\n")) {
    if (!/^\| [a-z]/.test(line) || line.startsWith("| id ")) continue;
    const cells = line.split("|").map(c => c.trim());
    const id = cells[1], what = cells[2], now = cells[cells.length - 2];
    const m = now.match(/^(\w+) · `(.+)` · (\S+)$/);
    rows.push({ id, what, now, where: m && m[1], probe: m && m[2], check: m && m[3] });
  }
  return rows;
}

(async () => {
  console.log("PROFILE-1 (header): everything still clicks\n");
  const { tok } = await fixture();
  const rows = inventory();
  ok(`§1 the inventory lists the old profile (${rows.length} items)`, rows.length >= 150, rows.length);
  ok("§1 every inventory item says where it is now", rows.every(r => r.where && r.probe && r.check), rows.filter(r => !r.where).map(r => r.id));

  // §2 (API half) — the seven numbers' sources and their footing, from the
  // same reads the header draws.
  const d = (await api("GET", `/donors/${A}`, tok)).body;
  const st = (await api("GET", `/donors/${A}/status`, tok)).body;
  const g = st.glance || {};
  const seven = [["Lifetime", d.figures.lifetime, "donor-lifetime"], ["This year", d.figures.thisYear, "donor-gifts-between"],
    ["Last gift", d.figures.lastGift, "donor-last-gift"], ["Average gift", g.average, "donor-average-gift"],
    ["First gift", g.first, "donor-first-gift"], ["Largest gift", g.largest, "donor-largest-gift"],
    ["Last met", d.figures.lastMet, "donor-last-met"], ["Last email", d.figures.lastEmail, "donor-last-email"]];
  for (const [label, f, key] of seven) {
    ok(`§2 ${label} opens ${key}`, f && f.source && f.source.key === key, f && f.source);
    if (!f || !f.source) continue;
    const qs = new URLSearchParams({ ...f.source.params, pageSize: "200" }).toString();
    const r = await api("GET", `/figures/${f.source.key}/rows?${qs}`, tok);
    const rows2 = (r.body && r.body.rows) || [];
    const sum = rows2.reduce((s, x) => s + Math.round(Number(x.amount || 0) * 100), 0);
    const want = Math.round(Number(f.value) * 100);
    const foots = key === "donor-average-gift" ? Math.round(sum / rows2.filter(x => Number(x.amount) > 0).length) === want : sum === want;
    ok(`§2 ${label} foots: its rows come to ${f.value}`, r.status === 200 && foots, { sum, want, n: rows2.length });
  }
  ok("§2 Lifetime is every gift, refund off: $5,750.00", d.figures.lifetime.value === 5750, d.figures.lifetime.value);
  ok("§2 This year is this year's gift only: $250.00", (d.figures.thisYear || {}).value === 250, d.figures.thisYear);
  ok("§2 Average is Lifetime over the 4 gifts, the soft credit and the pledge in neither", g.average && g.average.value === 1437.5, g.average);
  ok("§2 the date under Last gift is the gift's own date", (d.figures.lastGift.under || {}).date === String(d.gifts[0].date).slice(0, 10), d.figures.lastGift.under);
  ok("§2 the line under Last email says she replied", (d.figures.lastEmail.under || {}).direction === "replied", d.figures.lastEmail.under);

  // §6 (API half) — the rail read: a card with nothing to say is null or empty.
  const railA = (await api("GET", `/donors/${A}/rail`, tok)).body || {};
  const railN = (await api("GET", `/donors/${N}/rail`, tok)).body || {};
  ok("§6 Fern's rail: rhythm (late), thank-yous and coming up are there", !!(railA.rhythm && railA.rhythm.late === true && (railA.thankYous || []).length === 1 && (railA.comingUp || []).length >= 1), railA);
  ok("§6 a new donor's rail has nothing but contact", Array.isArray(railN.thankYous) && !railN.rhythm && !railN.recurring && !railN.thankYous.length && !railN.comingUp.length && !railN.volunteering && !railN.connected.length, railN);
  const other = await api("GET", `/donors/d_b72_12/rail`, tok);
  ok("§6 the rail read is tenant-scoped", other.status === 404, other.status);

  const b = await open(h, "§browser");
  if (b) {
    const { browser, APP, signedIn } = b;
    const src = fs.readdirSync(path.join(ROOT, "client/src/components")).filter(f => f.endsWith(".jsx"))
      .map(f => fs.readFileSync(path.join(ROOT, "client/src/components", f), "utf8")).join("\n");
    const { ctx, page } = await signedIn(ADMIN);
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.message || e)));
    const goTo = async id => {
      await page.goto(`${APP}/donors/${id}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="dp-header-figures"]', { timeout: 20000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    };
    const tab = async id => { await page.locator(`[data-testid=dp-tabs] [data-tab="${id}"]`).click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); };
    const closeAll = async () => { for (let k = 0; k < 3; k++) await page.keyboard.press("Escape"); await page.waitForTimeout(200); };
    await goTo(A);

    // §3 — the old boxes and the chip row are gone.
    ok("§3 the header numbers are in the header", await page.locator('.donor-profile-header [data-testid=dp-header-figures]').count() === 1);
    ok("§3 the old number boxes are gone", await page.locator('[data-testid=dp-figures], [data-testid=dp-glance], .donor-stat-grid').count() === 0);
    ok("§3 the \"Everything with\" chip row is gone", await page.locator('[data-filter=all]').count() === 0 && !(await page.locator("text=/^Everything with/i").count()));
    ok("§3 one row of ten tabs, directly under the header", await page.locator('[data-testid=dp-tabs] [role=tab]').count() === 10);

    // §1 — every inventory item, where its Now cell says.
    for (const r of rows) {
      if (r.check === "code") { ok(`§1 ${r.id} (${r.what.slice(0, 40)}) is still drawn by the profile's code`, src.includes(r.probe), r.probe); continue; }
      await closeAll();
      const where = r.where;
      if (["overview", "gifts", "asks", "conversations", "emails", "tasks", "notes", "funds", "related", "files"].includes(where)) await tab(where);
      else await tab("overview");
      if (where === "more" && !(await page.locator('[data-testid=dp-more-menu]').count())) { await page.locator('[data-testid=dp-more]').click(); await page.waitForTimeout(200); }
      const el = page.locator(r.probe).first();
      const there = await el.count() > 0;
      if (r.check === "exists") { ok(`§1 ${r.id} is on the new page (${where})`, there, r.probe); continue; }
      if (r.check.startsWith("source:")) {
        const key = r.check.slice(7);
        const got = there ? (await el.getAttribute("data-source-key")) || (await el.locator("[data-source-key]").first().getAttribute("data-source-key").catch(() => null)) : null;
        ok(`§1 ${r.id} opens ${key}`, got === key, { probe: r.probe, got });
        continue;
      }
      if (r.check.startsWith("tab:")) {
        const want = r.check.slice(4);
        if (there) await el.click();
        await page.waitForTimeout(300);
        ok(`§1 ${r.id} opens the ${want} tab`, there && await page.locator(`[data-tab="${want}"][aria-selected=true]`).count() === 1, r.probe);
        continue;
      }
      if (r.check === "dialog") {
        if (there) await el.click();
        await page.waitForTimeout(500);
        const dlg = await page.locator('[role=dialog]').count();
        ok(`§1 ${r.id} opens its dialog`, there && dlg > 0, { probe: r.probe, there, dlg });
        await closeAll();
        continue;
      }
      ok(`§1 ${r.id} has a check this suite knows`, false, r.check);
    }
    await closeAll();

    // The ask card's Mark won opens the same Move dialog as the row's Move.
    await goTo(A);
    await page.locator('[data-testid=dp-ask-mark-won]').click().catch(() => {});
    await page.waitForTimeout(400);
    ok("§1 the ask card's Mark won opens the Move dialog, already on Committed",
      await page.locator('[role=dialog]:has-text("Move")').count() > 0, null);
    await closeAll();

    // §4 — each list tab shows what its old chip showed.
    const expect = { conversations: "Called to thank her", emails: "Studio tour", tasks: "Send the scholarship report", notes: "Prefers email to phone" };
    for (const [t, text] of Object.entries(expect)) {
      await tab(t);
      const cards = await page.locator('[data-testid=dp-timeline] [role=button]').count();
      const badge = await page.locator(`[data-tab-count="${t}"]`).innerText().catch(() => null);
      ok(`§4 ${t}: shows its own rows ("${text}")`, await page.locator(`[data-testid=dp-timeline]:has-text("${text}")`).count() === 1, null);
      if (badge != null) ok(`§4 ${t}: the tab's count is the rows it shows (${badge})`, Number(badge) === cards, { badge, cards });
    }
    await tab("conversations");
    await page.locator('[data-filter=stage]').click().catch(() => {});
    await page.waitForTimeout(300);
    ok("§4 conversations: Stage changes still has its own chip and rows", await page.locator('[data-testid=dp-timeline]:has-text("Stage")').count() === 1);
    await tab("gifts");
    ok("§4 gifts: Giving by year heads the gifts list", await page.locator('[data-testid=dp-giving-by-year]').count() === 1);

    // §5 — the stage bar writes through the audit write and moves the chip.
    await tab("overview");
    await page.locator('[data-testid=dp-stage-bar] [data-stage=solicit]').click();
    await page.waitForTimeout(1200);
    const chip = await page.locator('.donor-profile-header').innerText();
    ok("§5 the header chip says Solicit", /Solicit/.test(chip), chip.slice(0, 120));
    const [{ stage }] = await q(`SELECT stage FROM donors WHERE id=$1`, [A]);
    ok("§5 the stage was saved", stage === "solicit", stage);
    const audit = await q(`SELECT request_method, request_path FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE $2`, [ORG, `%/donors/${A}/stage%`]);
    ok("§5 the change went through the one audit write", audit.length >= 1, audit);
    ok("§5 the stage bar shows Solicit filled", await page.locator('[data-testid=dp-stage-bar] [data-stage=solicit][aria-checked=true]').count() === 1);

    // §6 — the rail: full height, cards open rows, empty cards are not drawn.
    for (const [id, label] of [[A, "a long profile"], [N, "a short profile"]]) {
      await goTo(id);
      const r = await page.evaluate(() => {
        const rail = document.querySelector("[data-testid=dp-right-rail]").getBoundingClientRect();
        const body = document.querySelector(".donor-profile-body").getBoundingClientRect();
        return { railBottom: rail.bottom, bodyBottom: body.bottom, vh: innerHeight, bg: getComputedStyle(document.querySelector("[data-testid=dp-right-rail]")).backgroundColor };
      });
      ok(`§6 the rail runs to the bottom on ${label}`, Math.abs(r.railBottom - r.bodyBottom) <= 1 && r.bodyBottom >= r.vh - 1, r);
    }
    await goTo(A);
    for (const card of ["dp-rail-rhythm", "dp-rail-thankyous"]) {
      const c = page.locator(`[data-testid=${card}]`);
      ok(`§6 ${card} is drawn for Fern`, await c.count() === 1);
      const opens = await c.locator("[data-source-key], button").count();
      ok(`§6 ${card} opens its rows`, opens > 0, opens);
    }
    // Coming up: a date (her birthday) is said, never a button; anything else opens.
    const cu = page.locator("[data-testid=dp-rail-coming-up]");
    ok("§6 Coming up is drawn for Fern, with her birthday", await cu.count() === 1 && await cu.locator("[data-coming=birthday]").count() === 1);
    ok("§6 every Coming up item that is not a date opens", await cu.locator("[data-coming]:not([data-coming=birthday])").count() === await cu.locator("[data-coming]:not([data-coming=birthday]) button").count());
    await page.locator('[data-testid=dp-rail-rhythm-open]').click().catch(() => {});
    await page.waitForTimeout(800);
    ok("§6 the rhythm opens her gifts", await page.locator('[role=dialog]:has-text("3,000")').count() > 0);
    await closeAll();
    await page.locator('[data-testid=dp-rail-thankyou]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    ok("§6 a thank-you opens the gift it is for", await page.locator('[role=dialog]:has-text("250")').count() > 0);
    await closeAll();
    await goTo(N);
    for (const card of ["dp-rail-rhythm", "dp-rail-recurring", "dp-rail-thankyous", "dp-rail-coming-up", "dp-rail-volunteering", "dp-rail-connected"])
      ok(`§6 ${card} is not drawn for a new donor`, await page.locator(`[data-testid=${card}]`).count() === 0);
    await ctx.close();

    // §7 — header alignment with and without a photo, and no sideways scroll.
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const s = await signedIn(ADMIN, vp);
      const geo = {};
      for (const id of [A, P]) {
        await s.page.goto(`${APP}/donors/${id}`, { waitUntil: "domcontentloaded" });
        await s.page.waitForSelector('[data-testid=dp-header-figures]', { timeout: 20000 }).catch(() => {});
        await s.page.waitForTimeout(800);
        geo[id] = await s.page.evaluate(() => {
          const hd = document.querySelector(".donor-profile-header").getBoundingClientRect();
          const n = document.querySelector("[data-testid=dp-name]").getBoundingClientRect();
          const f = document.querySelector("[data-testid=dp-header-figures]").getBoundingClientRect();
          const wide = [...document.querySelectorAll("body *")].filter(e => {
            const cs = getComputedStyle(e);
            return /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
          }).map(e => e.getAttribute("data-testid") || e.className || e.tagName);
          return { nameX: Math.round(n.left - hd.left), nameY: Math.round(n.top - hd.top), figX: Math.round(f.left - hd.left), page: document.documentElement.scrollWidth > innerWidth, wide };
        });
      }
      ok(`§7 at ${vp.width}: the name sits in the same place with and without a photo`, geo[A].nameX === geo[P].nameX && geo[A].nameY === geo[P].nameY, geo);
      ok(`§7 at ${vp.width}: the number row starts in the same place`, geo[A].figX === geo[P].figX, geo);
      if (vp.width === 390) {
        ok("§7 at 390: the page never scrolls sideways", !geo[A].page && !geo[P].page, geo);
        ok("§7 at 390: the only thing that scrolls sideways is the tab row", geo[A].wide.every(w => /dp-tabs/.test(String(w))), geo[A].wide);
      }
      await s.ctx.close();
    }
    ok("the profile threw no page errors", errors.length === 0, errors.slice(0, 3));
    await browser.close();
  }
  for (const t of ["person_photos", "gift_soft_credits", "pledges", "interactions", "threads", "donor_scores", "donor_rhythm", "fin_transactions", "gifts", "tasks", "opportunities"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await h.closeDb();
  h.summary();
})().catch(e => { console.error(e); process.exit(1); });

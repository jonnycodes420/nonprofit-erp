// BUILD-87 F.3 verification walk — HOME, LAID OUT.
//
// F.3 is a layout pass, so the walk reads GEOMETRY off the real screen rather
// than grepping source: a padding constant that is right in the file and wrong
// on the page is exactly the defect this is for. Seven changes, walked at 1440
// and at 390.
//
//   §1 the header: a small greeting, then the note as the headline, one column
//   §2 the pills are gone and the names are still there
//   §3 a thread row is a name, one clause and one emerald action
//   §4 empty states are one line with the working behind "why"
//   §5 the rail is five items and a "More" — and nothing is unreachable
//   §6 cards: 24px padding (BUILD-88d; F.3 shipped 32), hairline, no shadow
//   §7 no "Admin User", and no colleague's surname on a row
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build87-f3-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const OUT = process.env.OUT_DIR || path.join(__dirname, "..", "docs", "build87");

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 320)));
  if (!cond) failures++;
};
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Harbour Light " + stamp, userName: "Mike Henderson", email: `b87f3_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
  await api("POST", "/onboarding/complete", {});

  // A morning with a queue on it.
  const ids = [];
  for (const [name, total, gifts] of [["Robert Harmon", 14500, 6], ["Margaret Chen", 48000, 9],
                                      ["Diana Torres", 300, 2], ["Otis Grange", 900, 3]]) {
    const d = await api("POST", "/donors", { name, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org" });
    const id = d.id || d.donor?.id; ids.push(id);
    for (let g = 0; g < gifts; g++) await api("POST", `/donors/${id}/gifts`, { amount: Math.round(total / gifts), date: day(-30 * (g + 1)), type: "cash" });
  }
  // A logged gift already opens its thank-you thread; clear them so the walk's
  // own commitments are the ones on screen (BUILD-85's silent-409 lesson).
  for (const t of (await api("GET", "/threads?scope=mine&cap=200")).list) await api("POST", `/threads/${t.id}/dismiss`, { reason: "handled_outside" });
  for (const [i, label, due] of [[0, "Call about the gala", -9], [2, "Send the import report", -2], [3, "Follow up", 3]]) {
    const r = await api("POST", `/donors/${ids[i]}/threads`, { label, due: day(due) });
    ok(`fixture: planned "${label}"`, !r.error, r);
  }
  // …and one with a real line on it, so §3 has a clause to read.
  // one grant, so §5 can walk the top-bar search onto a folded surface
  await api("POST", "/grants", { funder: "Kettle Foundation", amount: 25000, status: "prospecting", deadline: day(60) });
  await api("POST", `/donors/${ids[1]}/conversations`, { touch: "meeting", line: "She asked for the import report",
    date: day(-7), nextStep: { type: "follow_up", label: "Send the report", due: day(-1) } });

  const browser = await chromium.launch();

  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
    console.log(`\n── ${label} ${w}x${h} ──`);
    // hasTouch/isMobile so `(hover:none),(pointer:coarse)` actually matches —
    // a desktop window narrowed to 390px still reports a mouse, and asserting
    // the phone rule against it would have been testing the wrong browser.
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2,
      hasTouch: w < 1000, isMobile: w < 1000 });
    const pageErrors = [];
    page.on("pageerror", e => { const m = String(e); if (!/Unexpected token '<'/.test(m)) pageErrors.push(m.slice(0, 140)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2600);
    const text = await page.evaluate(() => document.body.innerText);

    // ── §1 the header ──────────────────────────────────────────────────────
    // BUILD-89 SUPERSEDES F.3's HEADER AND ITS CARD GEOMETRY. The morning
    // sentence is no longer the headline (it lives in the Thread's own header,
    // and the page header is the greeting and the day), Home is ONE PANEL
    // rather than a stack of bordered cards in a 1100px column, and the
    // padding moved from each card to the panel. Those measurements are
    // scripts/build89-walk.js's now; what F.3 proved that still stands is
    // checked below — the greeting is small and first-name only, the products
    // are named in plain serif with the brass underline, a row is a name and
    // one emerald action, empty states are one line, the rail is five items
    // and a More, and no colleague's surname reaches a screen.
    const greet = await page.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find(s => /^(Good (morning|afternoon|evening))/.test(s.textContent || ""));
      return el ? { size: parseFloat(getComputedStyle(el.parentElement).fontSize), text: el.textContent.trim() } : null;
    });
    ok(`${label}: the greeting is one small line`, greet && greet.size <= 14, greet);
    ok(`${label}: …and it uses a first name only`, !!greet && /Mike$/.test(greet.text), greet && greet.text);

    // ── §2 the pills ───────────────────────────────────────────────────────
    const marks = await page.evaluate(() => document.querySelectorAll(".pm-mark").length);
    ok(`${label}: the ProductMark pill is off the morning screen`, marks === 0, marks);
    const titles = await page.evaluate(() => [...document.querySelectorAll("span")]
      .filter(s => ["The Thread", "Drift"].includes((s.textContent || "").trim()))
      .map(s => { const cs = getComputedStyle(s); return { t: s.textContent.trim(), family: cs.fontFamily, border: cs.borderBottomColor, w: cs.borderBottomWidth }; }));
    ok(`${label}: both products are still named, once each`,
       titles.length === 2 && new Set(titles.map(x => x.t)).size === 2, titles);
    ok(`${label}: …in plain serif with the brass underline`,
       titles.length === 2 && titles.every(x => /DM Serif/.test(x.family) && x.border === "rgb(201, 168, 76)" && x.w === "3px"), titles);

    // ── §3 the rows ────────────────────────────────────────────────────────
    const rows = await page.evaluate(() => [...document.querySelectorAll(".attn-row")].map(li => {
      const main = li.querySelector(".attn-row-main");
      const meta = li.querySelector(".attn-meta");
      const clause = main && main.children[1] && main.children[1].children[0];
      const greens = [...li.querySelectorAll("*")].filter(e => getComputedStyle(e).backgroundColor === "rgb(13, 92, 58)").length;
      return {
        tag: main && main.tagName, href: main && main.getAttribute("href"),
        actionIsSibling: !!(main && li.querySelector(".attn-row-action") && !main.contains(li.querySelector(".attn-row-action"))),
        name: li.querySelector(".attn-donor-name")?.textContent.trim(),
        clause: clause ? clause.textContent.trim() : null,
        metaOpacity: meta ? getComputedStyle(meta).opacity : null,
        metaText: meta ? meta.textContent.trim() : null,
        emeraldSurfaces: greens,
      };
    }));
    ok(`${label}: the queue has rows`, rows.length > 0, rows.length);
    if (rows.length) {
      console.log("  a row reads: " + rows[0].name + " / " + rows[0].clause);
      ok(`${label}: the clause is one sentence with time in words`,
         rows.every(r => r.clause && /\.$/.test(r.clause) && /(today|yesterday|ago)\.$/.test(r.clause)), rows.map(r => r.clause));
      ok(`${label}: …and it is not the old four-fact line`,
         rows.every(r => !/\d{4}-\d{2}-\d{2}/.test(r.clause || "")), rows.map(r => r.clause));
      ok(`${label}: the date and the owner are ${w >= 1000 ? "on hover" : "shown (no hover on a phone)"}`,
         rows.every(r => r.metaOpacity === (w >= 1000 ? "0" : "1")), rows.map(r => r.metaOpacity));
      ok(`${label}: …and the record is still THERE, not deleted`,
         rows.every(r => /\d{4}-\d{2}-\d{2}/.test(r.metaText || "")), rows.map(r => r.metaText));
      ok(`${label}: exactly one emerald action per row`, rows.every(r => r.emeraldSurfaces === 1), rows.map(r => r.emeraldSurfaces));
      // BUILD-45 D-1, which this row rewrite had to preserve.
      ok(`${label}: the name is a real link and the action is its SIBLING`,
         rows.every(r => r.tag === "A" && /^\/donors\//.test(r.href || "") && r.actionIsSibling), rows.map(r => [r.tag, r.href, r.actionIsSibling]));

      // ── GEOMETRY, because a layout pass can pass every text assertion and
      // still be unreadable. The 390px capture of this very build had the name,
      // the next step and the buttons all drawn on top of each other with
      // "Dismiss" off the right edge — and every assertion above it was green.
      // A row's regions may not overlap, and nothing may sit outside the card.
      const boxes = await page.evaluate(() => [...document.querySelectorAll(".attn-row")].map(li => {
        const pick = sel => { const e = li.querySelector(sel); if (!e) return null;
          const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; };
        return { name: pick(".attn-donor-name"), next: pick(".attn-row-next"), act: pick(".attn-row-actions"),
                 card: (() => { const r = li.closest("#dash-thread").getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; })() };
      }));
      const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      ok(`${label}: no two regions of a row are drawn on top of each other`,
         boxes.every(x => !overlaps(x.name, x.next) && !overlaps(x.name, x.act) && !overlaps(x.next, x.act)),
         boxes.filter(x => overlaps(x.name, x.next) || overlaps(x.name, x.act) || overlaps(x.next, x.act)).slice(0, 2));
      ok(`${label}: every action button is fully inside its card`,
         boxes.every(x => x.act && x.act.r <= x.card.r + 1 && x.act.l >= x.card.l - 1),
         boxes.filter(x => !x.act || x.act.r > x.card.r + 1).slice(0, 2).map(x => [x.act, x.card]));
      // the band headers label the rows beneath them, so they line up with them
      // Measured off the rendered TEXT, not off a padding value: the row
      // carries a 3px left marker the band has to reserve too, and reading the
      // padding alone would have called a three-pixel step "aligned".
      const bandAlign = await page.evaluate(() => {
        const b = document.querySelector(".attn-band span"), n = document.querySelector(".attn-donor-name");
        return b && n ? [Math.round(b.getBoundingClientRect().left), Math.round(n.getBoundingClientRect().left)] : null;
      });
      ok(`${label}: the band header's left edge lines up with the names it labels`,
         !!bandAlign && Math.abs(bandAlign[0] - bandAlign[1]) <= 1, bandAlign);
    }

    // ── §6 cards ───────────────────────────────────────────────────────────
    // BUILD-89: the panel draws the edge, so what is asserted here is the part
    // that must never come back — a shadow on the morning screen.
    const shadows = await page.evaluate(() => [...document.querySelectorAll("#dash-thread,#dash-drifting,.home-shell")]
      .map(c => getComputedStyle(c).boxShadow));
    ok(`${label}: nothing on the morning screen casts a shadow`,
       shadows.length > 0 && shadows.every(v => v === "none"), shadows);

    // ── §7 names ───────────────────────────────────────────────────────────
    ok(`${label}: "Admin User" is nowhere on the screen`, !/Admin User/.test(text), (text.match(/.{0,40}Admin User.{0,40}/) || [])[0]);

    // Home is still exactly the four things.
    ok(`${label}: Home carries no board number`,
       !/Donor Retention Rate/i.test(text) && !/of goal reached/i.test(text) && !/led straight to the next step/i.test(text), text.slice(0, 300));

    // Nothing may scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${label}: the page never scrolls sideways`, overflow <= 1, overflow);
    ok(`${label}: zero uncaught page errors`, pageErrors.length === 0, pageErrors);

    // ── §5 the rail ────────────────────────────────────────────────────────
    if (w >= 1000) {
      const rail = await page.evaluate(() => [...document.querySelectorAll(".app-sidebar .side-nav-btn")]
        .filter(b => b.offsetParent).map(b => b.innerText.replace(/\s+/g, " ").trim()));
      // innerText applies text-transform, so the group label comes back "MORE".
      // (BUILD-82 paid for this one already.)
      const railNames = rail.map(r => r.replace(/^\S+\s*/, "").toLowerCase());
      ok(`${label}: the rail is Home · Dashboards · Donors · Fundraising · Reports · More · Settings`,
         JSON.stringify(railNames) === JSON.stringify(["home", "dashboards", "donors", "fundraising", "reports", "more", "settings"]), rail);
      // Every folded surface must still be one disclosure away.
      await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-controls") === "side-nav-more")?.click());
      await page.waitForTimeout(400);
      const opened = await page.evaluate(() => [...document.querySelectorAll("#side-nav-more .side-nav-btn")].map(b => b.innerText.replace(/\s+/g, " ").trim()));
      ok(`${label}: More holds the other six`,
         ["Pipeline", "Grants", "Communications", "Tasks", "Workflows", "Finance"].every(n => opened.some(o => o.endsWith(n))), opened);
      // …and it opens ITSELF when something ELSE puts you on a folded surface.
      // The real path for that is the top-bar search: you look up a grant from
      // Home and land on Grants, which is now behind the disclosure. A rail
      // that cannot admit where you are standing is the one way this split
      // could have made the product worse, so it is walked, not reasoned about.
      const fresh = await browser.newPage({ viewport: { width: w, height: h } });
      await fresh.addInitScript(([t, u, o]) => {
        localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
        localStorage.removeItem("steward_nav_more");   // shut, as a first visit would be
      }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);
      await fresh.goto(APP + "/dashboard", { waitUntil: "networkidle" });
      await fresh.waitForTimeout(2400);
      ok(`${label}: More starts shut on a first visit`, !(await fresh.$("#side-nav-more")));
      await fresh.fill('[data-testid="global-search"]', "Kettle");
      await fresh.waitForTimeout(900);
      // The result row commits on mousedown (so the blur cannot beat it), which
      // a synthetic .click() does not fire — drive it as a real pointer.
      const picked = await fresh.$('[data-testid="search-result"]');
      ok(`${label}: the top-bar search finds the grant`, !!picked);
      if (picked) await picked.click();
      await fresh.waitForTimeout(1800);
      const landed = await fresh.evaluate(() => {
        const g = document.querySelector("#side-nav-more");
        const active = [...document.querySelectorAll(".app-sidebar .side-nav-btn")]
          .find(b => getComputedStyle(b).backgroundColor === "rgb(26, 46, 31)");
        return { open: !!g, active: active ? active.innerText.replace(/\s+/g, " ").trim() : null };
      });
      ok(`${label}: landing on a folded surface OPENS More and marks it active`,
         landed.open && /Grants$/.test(landed.active || ""), landed);
      await fresh.close();
    }

    if (failures) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/f3-${label}.png`, fullPage: true }); }
    await page.close();
  }

  // ── §4 the empty states, on an org with nothing ──────────────────────────
  {
    const s2 = Date.now().toString(36) + "e";
    const r2 = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "Empty House " + s2, userName: "Mike Henderson", email: `b87e_${s2}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
    await fetch(API + "/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + r2.token }, body: "{}" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [r2.token, JSON.stringify(r2.user), JSON.stringify({ ...r2.org, onboarding_complete: 1 })]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2600);
    for (const id of ["drift-empty-state", "thread-empty-state"]) {
      const shut = await page.evaluate(i => document.querySelector(`[data-testid="${i}"]`)?.innerText.replace(/\n/g, " | ") || null, id);
      ok(`empty: ${id} is ONE line`, !!shut && shut.split("|").length <= 2 && shut.length < 80, shut);
      await page.click(`[data-testid="${id}-why"]`).catch(() => {});
      await page.waitForTimeout(150);
      const open = await page.evaluate(i => document.querySelector(`[data-testid="${i}"]`)?.innerText.replace(/\n/g, " | ") || null, id);
      ok(`empty: …and "why" still shows the working`, !!open && open.length > (shut || "").length + 30, open);
    }
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

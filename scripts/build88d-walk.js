// BUILD-88d verification walk — HOME PROPORTIONS.
//
// A layout pass is measured on the rendered page, never grepped out of the
// source: a constant that is right in the file and wrong on the screen is the
// whole reason this exists. Seven changes, walked at 1440 and at 390, one
// screenshot each.
//
//   §1 the headline: 34px DM Serif, at most two lines, 28ch; a 14px warm-grey
//      greeting above it and 32px of air below
//   §2 two columns from 1100px up — cards 2fr, the Today rail 1fr, and the
//      rail ABOVE the cards below the breakpoint
//   §3 the ground is #f7f5f0 and the cards are white with the #e8e4db
//      hairline, 12px radius, 24px padding, 16px gap, no shadow
//   §4 one action per row: one emerald verb, the rest behind "…", 64px tall,
//      name 15px medium, clause 14px warm grey, action on the right edge
//   §5 section headers 18px serif with the brass underline and 16px below
//   §6 the sidebar is 240px, its items 14px with 8px of vertical padding, and
//      MORE is collapsed for somebody who has never opened it
//   §7 the rail's three tiles each carry a number and a link to its list
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build88d-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const OUT = process.env.OUT_DIR || path.join(__dirname, "..", "docs", "build88d");

let failures = 0;
const ok = (label, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + label + (cond ? "" : " — " + String(JSON.stringify(detail) ?? "").slice(0, 320)));
  if (!cond) failures++;
};
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Sparrow Missions " + stamp, userName: "Mike Henderson", email: `b88d_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
  await api("POST", "/onboarding/complete", {});

  // A morning with something on it: four people, a queue with all three bands,
  // and a clause long enough to test that a row still ends at its own edge.
  const ids = [];
  for (const [name, total, gifts] of [["Robert Harmon", 14500, 6], ["Margaret Chen", 48000, 9],
                                      ["Diana Torres", 300, 2], ["Otis Grange", 900, 3]]) {
    const d = await api("POST", "/donors", { name, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.org" });
    ids.push(d.id || d.donor?.id);
    for (let g = 0; g < gifts; g++) await api("POST", `/donors/${ids[ids.length - 1]}/gifts`, { amount: Math.round(total / gifts), date: day(-30 * (g + 1)), type: "cash" });
  }
  for (const t of (await api("GET", "/threads?scope=mine&cap=200")).list) await api("POST", `/threads/${t.id}/dismiss`, { reason: "handled_outside" });
  for (const [i, label, due] of [[0, "Call about the gala", -9], [2, "Send the import report", -2], [1, "Ask for the meeting", 0], [3, "Follow up", 3]]) {
    await api("POST", `/donors/${ids[i]}/threads`, { label, due: day(due) });
  }
  await api("POST", `/donors/${ids[1]}/conversations`, { touch: "meeting", line: "She asked for the import report",
    date: day(-7), nextStep: { type: "follow_up", label: "Send the report", due: day(-1) } });

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const [w, h, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    console.log(`\n── ${label} ──`);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2,
      hasTouch: w < 1000, isMobile: w < 1000 });
    page.on("pageerror", e => { const m = String(e); if (!/Unexpected token '<'/.test(m)) console.log("  [pageerror] " + m.slice(0, 160)); });
    // NOTHING is seeded into localStorage but the session — §6's "collapsed by
    // default" is only a real claim for somebody who has never opened MORE.
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2800);

    // ── §1 the headline ────────────────────────────────────────────────────
    const note = await page.evaluate(() => {
      const el = document.querySelector(".home-note"); if (!el) return null;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { size: parseFloat(cs.fontSize), family: cs.fontFamily, maxWidth: parseFloat(cs.maxWidth),
               lineHeight: parseFloat(cs.lineHeight), height: r.height, clamp: cs.webkitLineClamp || cs.WebkitLineClamp,
               mb: parseFloat(cs.marginBottom), text: el.innerText.trim() };
    });
    ok(`${label}: the headline is the note`, !!note, note);
    if (note) {
      console.log(`\n  she reads: ${note.text}\n`);
      ok(`${label}: …at ${w >= 1100 ? 34 : 26}px in DM Serif`,
         note.size === (w >= 1100 ? 34 : 26) && /DM Serif/.test(note.family), note);
      // ch resolves to px, so the measure is checked as the width it produces.
      const ch = note.size * 0.502;  // DM Serif Display's "0" advance
      ok(`${label}: …at a 28ch measure`, near(note.maxWidth, 28 * ch, 28 * ch * 0.15),
         { computed: note.maxWidth, expected: Math.round(28 * ch) });
      ok(`${label}: …never more than two lines`,
         Math.round(note.height / note.lineHeight) <= 2, { lines: note.height / note.lineHeight, clamp: note.clamp });
      ok(`${label}: …with ${w >= 1100 ? 32 : 20}px below it`, note.mb === (w >= 1100 ? 32 : 20), note.mb);
    }
    const greet = await page.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find(s => /^(Good (morning|afternoon|evening))/.test(s.textContent || ""));
      if (!el) return null;
      const cs = getComputedStyle(el.parentElement);
      return { size: parseFloat(cs.fontSize), color: cs.color, text: el.textContent.trim() };
    });
    ok(`${label}: the greeting sits above it at 14px warm grey`,
       greet && greet.size === 14 && greet.color === "rgb(90, 85, 79)", greet);

    // ── §2 two columns ─────────────────────────────────────────────────────
    const cols = await page.evaluate(() => {
      const g = document.querySelector(".home-grid"), c = document.querySelector(".home-cards"), r = document.querySelector(".home-rail");
      if (!g || !c || !r) return null;
      const gr = g.getBoundingClientRect(), cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect();
      return { gw: gr.width, cw: cr.width, rw: rr.width, cLeft: cr.left, cRight: cr.right, cTop: cr.top,
               rLeft: rr.left, rTop: rr.top, rBottom: rr.bottom, gap: parseFloat(getComputedStyle(g).gap) };
    });
    ok(`${label}: Home is a grid with cards and a Today rail`, !!cols, cols);
    if (cols && w >= 1100) {
      ok("1440: the cards take two thirds", near(cols.cw / cols.gw, 2 / 3, 0.04), { share: +(cols.cw / cols.gw).toFixed(3), cw: cols.cw, gw: cols.gw });
      ok("1440: …the rail one third", near(cols.rw / cols.gw, 1 / 3, 0.04), { share: +(cols.rw / cols.gw).toFixed(3), rw: cols.rw });
      ok("1440: …and the rail is on the RIGHT of the cards", cols.rLeft >= cols.cRight - 1, { rLeft: cols.rLeft, cRight: cols.cRight });
      ok("1440: …with 16px between the columns", cols.gap === 16, cols.gap);
    }
    if (cols && w < 1100) {
      ok("390: the rail moves ABOVE the cards", cols.rBottom <= cols.cTop + 1, { rBottom: cols.rBottom, cTop: cols.cTop });
      ok("390: …and both are one full-width column", near(cols.cw, cols.rw, 1) && cols.cw <= w, { cw: cols.cw, rw: cols.rw });
    }

    // ── §3 the ground and the cards ────────────────────────────────────────
    const ground = await page.evaluate(() => getComputedStyle(document.querySelector(".dash-root")).backgroundColor);
    ok(`${label}: the page ground is #f7f5f0`, ground === "rgb(247, 245, 240)", ground);
    const cards = await page.evaluate(() => [...document.querySelectorAll("#dash-thread,#dash-drifting,.home-rail>div[role=button]")].map(c => {
      const cs = getComputedStyle(c);
      const inner = c.firstElementChild ? getComputedStyle(c.firstElementChild) : null;
      return { bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth, radius: cs.borderTopLeftRadius,
               shadow: cs.boxShadow, pad: cs.paddingLeft !== "0px" ? cs.paddingLeft : (inner ? inner.paddingLeft : null) };
    }));
    ok(`${label}: cards are white on the #e8e4db hairline`,
       cards.length >= 3 && cards.every(c => c.bg === "rgb(255, 255, 255)" && c.border === "rgb(232, 228, 219)" && c.bw === "1px"), cards);
    ok(`${label}: …12px radius, no shadow`,
       cards.every(c => c.radius === "12px" && c.shadow === "none"), cards);
    ok(`${label}: …and ${w >= 1100 ? "24px" : "16px"} of padding`,
       cards.every(c => c.pad === (w >= 1100 ? "24px" : "16px")), cards.map(c => c.pad));
    const stackGap = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".home-cards")).gap));
    ok(`${label}: …stacked 16px apart`, stackGap === 16, stackGap);

    // ── §4 one action per row ──────────────────────────────────────────────
    const rows = await page.evaluate(() => [...document.querySelectorAll(".attn-row")].map(r => {
      const rr = r.getBoundingClientRect();
      const name = r.querySelector(".attn-donor-name"), clause = r.querySelector(".attn-clause span");
      const buttons = [...r.querySelectorAll("button")].map(b => {
        const cs = getComputedStyle(b), br = b.getBoundingClientRect();
        return { text: (b.innerText || "").trim(), bg: cs.backgroundColor, right: br.right, label: b.getAttribute("aria-label") || "" };
      });
      const ncs = name ? getComputedStyle(name) : null, ccs = clause ? getComputedStyle(clause) : null;
      return { h: rr.height, right: rr.right, padRight: parseFloat(getComputedStyle(r).paddingRight),
               nameSize: ncs && parseFloat(ncs.fontSize), nameWeight: ncs && ncs.fontWeight,
               clauseSize: ccs && parseFloat(ccs.fontSize), clauseColor: ccs && ccs.color, buttons };
    }));
    ok(`${label}: the queue has rows to read`, rows.length >= 3, rows.length);
    const filled = rows.map(r => r.buttons.filter(b => b.bg === "rgb(13, 92, 58)"));
    ok(`${label}: exactly ONE emerald action per row`, filled.every(f => f.length === 1), filled.map(f => f.map(b => b.text)));
    ok(`${label}: …and the rest is behind a "…" menu`,
       rows.every(r => r.buttons.some(b => b.text === "…" && /More actions/.test(b.label))
                    && !r.buttons.some(b => /^Dismiss$/.test(b.text))), rows[0]?.buttons);
    ok(`${label}: a name is 15px medium`, rows.every(r => r.nameSize === 15 && r.nameWeight === "500"),
       rows.map(r => [r.nameSize, r.nameWeight])[0]);
    ok(`${label}: …its clause 14px warm grey`,
       rows.every(r => r.clauseSize === 14 && r.clauseColor === "rgb(90, 85, 79)"), rows.map(r => [r.clauseSize, r.clauseColor])[0]);
    if (w >= 1100) {
      ok("1440: a row is 64px tall", rows.every(r => Math.round(r.h) === 64), rows.map(r => Math.round(r.h)));
      ok("1440: …and its action sits on the row's right edge",
         rows.every(r => near(Math.max(...r.buttons.map(b => b.right)), r.right - r.padRight, 2)),
         rows.map(r => ({ btn: Math.round(Math.max(...r.buttons.map(b => b.right))), edge: Math.round(r.right - r.padRight) }))[0]);
      ok("1440: …and nothing on it runs past that edge",
         rows.every(r => r.buttons.every(b => b.right <= r.right - r.padRight + 2)), true);
    }

    // ── §5 section headers ─────────────────────────────────────────────────
    // …querySelectorAll("span") also finds the queue's own "Today" BAND label,
    // which is a 10px sans marker inside the card and not a section header.
    const heads = await page.evaluate(() => [...document.querySelectorAll("span")]
      .filter(s => ["The Thread", "Drift", "Today"].includes((s.textContent || "").trim()))
      .filter(s => !s.closest(".attn-band"))
      .map(s => {
        const cs = getComputedStyle(s);
        const block = s.closest("div");
        return { t: s.textContent.trim(), size: parseFloat(cs.fontSize), family: cs.fontFamily,
                 border: cs.borderBottomColor, bw: cs.borderBottomWidth,
                 below: block ? parseFloat(getComputedStyle(block).paddingBottom) || parseFloat(getComputedStyle(block.parentElement).rowGap) : null };
      }));
    ok(`${label}: the section headers are 18px serif`,
       heads.length >= 3 && heads.every(x => x.size === 18 && /DM Serif/.test(x.family)), heads);
    ok(`${label}: …each with the 3px brass underline`,
       heads.every(x => x.border === "rgb(201, 168, 76)" && x.bw === "3px"), heads);
    ok(`${label}: …and 16px below`, heads.every(x => x.below === 16), heads.map(x => [x.t, x.below]));

    // ── §6 the sidebar ─────────────────────────────────────────────────────
    if (w >= 1100) {
      const side = await page.evaluate(() => {
        const el = document.querySelector(".app-sidebar"); if (!el) return null;
        const btns = [...el.querySelectorAll("button.side-nav-btn")];
        const item = btns.find(b => /Donors/.test(b.innerText));
        const cs = item ? getComputedStyle(item) : null;
        const more = el.querySelector("button[aria-controls=side-nav-more]");
        return { width: el.getBoundingClientRect().width,
                 itemSize: cs && parseFloat(cs.fontSize), padTop: cs && cs.paddingTop, padBottom: cs && cs.paddingBottom,
                 moreExpanded: more ? more.getAttribute("aria-expanded") : null,
                 moreOpen: !!document.getElementById("side-nav-more"),
                 main: parseFloat(getComputedStyle(document.querySelector(".app-main")).marginLeft) };
      });
      ok("1440: the sidebar is 240px", side && side.width === 240, side);
      ok("1440: …its items 14px with 8px of vertical padding",
         side && side.itemSize === 14 && side.padTop === "8px" && side.padBottom === "8px", side);
      ok("1440: …the content starts where the sidebar ends", side && side.main === 240, side && side.main);
      ok("1440: …and MORE is collapsed for somebody who has never opened it",
         side && side.moreExpanded === "false" && side.moreOpen === false, side);
    }

    // ── §7 the rail ────────────────────────────────────────────────────────
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".home-rail>div[role=button]")].map(t => {
      const n = t.querySelector(".home-rail-n");
      const lbl = n && n.nextElementSibling;
      return { n: n && n.textContent.trim(), size: n && parseFloat(getComputedStyle(n).fontSize),
               family: n && getComputedStyle(n).fontFamily,
               label: lbl && lbl.textContent.trim(), labelSize: lbl && parseFloat(getComputedStyle(lbl).fontSize),
               clickable: t.getAttribute("role") === "button" && t.tabIndex === 0 };
    }));
    ok(`${label}: the rail is three tiles`, tiles.length === 3, tiles);
    ok(`${label}: …numbers at ${w >= 1100 ? 40 : 32}px serif, labels at 13px`,
       tiles.every(t => t.size === (w >= 1100 ? 40 : 32) && /DM Serif/.test(t.family) && t.labelSize === 13), tiles);
    ok(`${label}: …and each one is a link to its list`, tiles.every(t => t.clickable), tiles);
    console.log("  today: " + tiles.map(t => `${t.n} ${t.label}`).join(" · "));

    // The one failure a layout pass must never ship: a page that scrolls sideways.
    const hscroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(`${label}: the page does not scroll sideways`, hscroll.sw <= hscroll.cw + 1, hscroll);

    await page.screenshot({ path: `${OUT}/home-${label}.png`, fullPage: true });
    console.log(`  screenshot → docs/build88d/home-${label}.png`);
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

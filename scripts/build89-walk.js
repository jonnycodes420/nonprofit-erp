// BUILD-89 verification walk — HOME, ORGANISED.
//
// A layout pass is measured on the rendered page, never grepped out of the
// source. This file began as BUILD-88d's walk; 88d's proportions live INSIDE
// 89's shape now, so the surviving measurements were folded in here rather
// than left in a second walk asserting the same screen.
//
//   §1 the header is a greeting and the DAY — the morning sentence is not the
//      first thing anybody reads any more; it is in the Thread's own header
//   §2 ONE panel: the work left, the Today rail right, one hairline between;
//      below 1100 the rail goes above the work
//   §3 the ground is #f7f5f0 and the panel is white on the #e8e4db hairline;
//      no card inside it carries an edge of its own, and nothing has a shadow
//   §4 THE RAIL HAS TWO STATES — press a number, get its list; press a row,
//      get the donor with the money, the next step and the actions
//   §5 a thread row: name 15px medium, clause 14px warm grey, one emerald
//      action, 64px tall, and NO cream band bars anywhere on the screen
//   §6 section headers 18px serif with the brass underline and 16px below
//   §7 the sidebar is 240px, items 14px with 8px of vertical padding, MORE
//      collapsed for somebody who has never opened it
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build89-walk.js
// Loopback-hardcoded (script-guards class: LOOPBACK_HARDCODED).
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));

const APP = "http://localhost:4173";
const API = "http://localhost:5601";
const OUT = process.env.OUT_DIR || path.join(__dirname, "..", "docs", "build89");

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

  // A morning with something on it: a queue with all three bands and a clause
  // long enough to test that a row still ends at its own edge. (The thousand-
  // donor demo file is scripts/build89-demo-seed.js; this walk stays small so
  // it runs in seconds.)
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

    // ── §1 the header ──────────────────────────────────────────────────────
    const head = await page.evaluate(() => {
      const day = document.querySelector(".home-day");
      const greet = [...document.querySelectorAll("span")].find(x => /^(Good (morning|afternoon|evening))/.test(x.textContent || ""));
      const note = document.querySelector(".home-note");
      const threadNote = document.querySelector(".thread-note");
      const cs = day ? getComputedStyle(day) : null;
      const gcs = greet ? getComputedStyle(greet.parentElement) : null;
      return { day: day && day.innerText.trim(), size: cs && parseFloat(cs.fontSize), family: cs && cs.fontFamily,
               greet: greet && greet.textContent.trim(), greetSize: gcs && parseFloat(gcs.fontSize), greetColor: gcs && gcs.color,
               hasOldNote: !!note, threadNote: threadNote && threadNote.innerText.trim(),
               threadNoteSize: threadNote && parseFloat(getComputedStyle(threadNote).fontSize) };
    });
    ok(`${label}: the header is the day, in serif`,
       head.day && /September/.test(head.day) && /DM Serif/.test(head.family || ""), head);
    ok(`${label}: …with the greeting above it at 14px warm grey`,
       head.greetSize === 14 && head.greetColor === "rgb(90, 85, 79)" && /Mike/.test(head.greet || ""), head);
    ok(`${label}: THE MORNING SENTENCE IS NOT THE HEADLINE any more`, head.hasOldNote === false, head.hasOldNote);
    ok(`${label}: …it is in the Thread's own header, at reading size`,
       !!head.threadNote && head.threadNoteSize === 14, head);
    console.log(`\n  she reads: ${head.greet} · ${head.day}\n  the Thread says: ${head.threadNote}\n`);

    // ── §2 one panel ───────────────────────────────────────────────────────
    const shell = await page.evaluate(() => {
      const sh = document.querySelector(".home-shell"), main = document.querySelector(".home-shell-main"), rail = document.querySelector(".home-rail");
      if (!sh || !main || !rail) return null;
      const s1 = getComputedStyle(sh), r = rail.getBoundingClientRect(), m = main.getBoundingClientRect();
      return { bg: s1.backgroundColor, border: s1.borderTopColor, bw: s1.borderTopWidth, radius: s1.borderTopLeftRadius,
               shadow: s1.boxShadow, mainPad: getComputedStyle(main).paddingLeft, railPad: getComputedStyle(rail).paddingLeft,
               railLeft: r.left, railW: r.width, railTop: r.top, railBottom: r.bottom, mainRight: m.right, mainTop: m.top,
               divider: getComputedStyle(rail).borderLeftWidth, dividerTop: getComputedStyle(rail).borderTopWidth };
    });
    ok(`${label}: Home is ONE white panel on the hairline`,
       shell && shell.bg === "rgb(255, 255, 255)" && shell.border === "rgb(232, 228, 219)" && shell.bw === "1px", shell);
    ok(`${label}: …with no shadow`, shell && shell.shadow === "none", shell && shell.shadow);
    if (shell && w >= 1100) {
      ok("1440: the rail is to the RIGHT of the work", shell.railLeft >= shell.mainRight - 1, { railLeft: shell.railLeft, mainRight: shell.mainRight });
      ok("1440: …340px of it", Math.round(shell.railW) === 340, shell.railW);
      ok("1440: …divided by one hairline, not a second border", shell.divider === "1px" && shell.dividerTop === "0px", shell);
      ok("1440: …and the work has 40px of padding", shell.mainPad === "40px", shell.mainPad);
    }
    if (shell && w < 1100) {
      ok("390: the rail moves ABOVE the work", shell.railBottom <= shell.mainTop + 1, { railBottom: shell.railBottom, mainTop: shell.mainTop });
      ok("390: …and the panel pads to 20px", shell.mainPad === "20px" && shell.railPad === "20px", shell);
    }

    // ── §3 the ground, and no edges inside the panel ───────────────────────
    const ground = await page.evaluate(() => getComputedStyle(document.querySelector(".dash-root")).backgroundColor);
    ok(`${label}: the page ground is #f7f5f0`, ground === "rgb(247, 245, 240)", ground);
    const inner = await page.evaluate(() => [...document.querySelectorAll("#dash-thread,#dash-drifting")].map(c => {
      const cs = getComputedStyle(c);
      return { id: c.id, bg: cs.backgroundColor, bw: cs.borderTopWidth, shadow: cs.boxShadow };
    }));
    ok(`${label}: no card inside the panel draws its own edge`,
       inner.length > 0 && inner.every(c => c.bw === "0px" && c.shadow === "none"), inner);
    const blocks = await page.evaluate(() => [...document.querySelectorAll(".home-block")].map((b, i) => ({
      i, top: getComputedStyle(b).borderTopWidth, pad: getComputedStyle(b).paddingTop })));
    ok(`${label}: …blocks are separated by air and one rule`,
       blocks.length === 0 || (blocks[0].top === "0px" && blocks.slice(1).every(b => b.top === "1px")), blocks);

    // ── §4 the rail has two states ─────────────────────────────────────────
    const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="rail-tile-"]')].map(t => {
      const n = t.querySelector(".home-rail-n"), lbl = n && n.nextElementSibling;
      return { key: t.getAttribute("data-testid"), n: n && n.textContent.trim(), size: n && parseFloat(getComputedStyle(n).fontSize),
               family: n && getComputedStyle(n).fontFamily, label: lbl && lbl.textContent.trim(),
               labelSize: lbl && parseFloat(getComputedStyle(lbl).fontSize), pressable: t.getAttribute("role") === "button" && t.tabIndex === 0 };
    }));
    ok(`${label}: the rail rests on three numbers`, tiles.length === 3, tiles);
    ok(`${label}: …at ${w >= 1100 ? 40 : 32}px serif over a 13px label`,
       tiles.every(t => t.size === (w >= 1100 ? 40 : 32) && /DM Serif/.test(t.family) && t.labelSize === 13), tiles);
    ok(`${label}: …and every one is pressable`, tiles.every(t => t.pressable), tiles);
    console.log("  today: " + tiles.map(t => `${t.n} ${t.label}`).join(" · "));

    // press a number → its list, with a way back
    await page.click('[data-testid="rail-tile-open"]');
    await page.waitForTimeout(500);
    const listState = await page.evaluate(() => {
      const rail = document.querySelector(".home-rail");
      const back = [...rail.querySelectorAll("button")].find(b => /Today/.test(b.innerText));
      const rows = [...rail.querySelectorAll(".home-rail-row")].map(r => r.innerText.replace(/\s+/g, " ").trim());
      return { back: !!back, tiles: rail.querySelectorAll('[data-testid^="rail-tile-"]').length, rows: rows.slice(0, 4), count: rows.length };
    });
    ok(`${label}: pressing a number opens its list in the rail`,
       listState.count > 0 && listState.tiles === 0 && listState.back, listState);
    ok(`${label}: …and no row in it says "day 0"`, !listState.rows.some(r => /day 0\b/.test(r)), listState.rows);

    // press a row → the donor, with the money and the next step
    await page.click(".home-rail-row");
    await page.waitForTimeout(500);
    const donorState = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="rail-donor"]');
      if (!d) return null;
      const t = d.innerText.replace(/\s+/g, " ");
      const buttons = [...d.querySelectorAll("button")].map(b => ({ text: b.innerText.trim(), bg: getComputedStyle(b).backgroundColor }));
      return { text: t, hasNext: /NEXT STEP/i.test(t), buttons };
    });
    ok(`${label}: pressing a row opens the donor in the rail`, !!donorState, donorState);
    ok(`${label}: …with the next step and one emerald action`,
       donorState && donorState.hasNext
       && donorState.buttons.filter(b => b.bg === "rgb(13, 92, 58)").length === 1
       && donorState.buttons.some(b => /Open the record/.test(b.text)), donorState && donorState.buttons);
    ok(`${label}: …and the row it came from is marked as open`,
       await page.$('.attn-row[data-railsel="1"]') !== null);
    // back to Today
    await page.evaluate(() => { const b = [...document.querySelectorAll(".home-rail button")].find(x => /Today/.test(x.innerText)); if (b) b.click(); });
    await page.waitForTimeout(400);
    ok(`${label}: …and back lands on Today again`,
       (await page.$$('[data-testid^="rail-tile-"]')).length === 3);

    // ── §4b a thread row, and NO CREAM BARS ────────────────────────────────
    const rows = await page.evaluate(() => [...document.querySelectorAll(".attn-row")].map(r => {
      const rr = r.getBoundingClientRect();
      const name = r.querySelector(".attn-donor-name"), clause = r.querySelector(".attn-clause");
      const buttons = [...r.querySelectorAll("button")].map(b => {
        const cs = getComputedStyle(b), br = b.getBoundingClientRect();
        return { text: (b.innerText || "").trim(), bg: cs.backgroundColor, right: br.right, label: b.getAttribute("aria-label") || "" };
      });
      const ncs = name ? getComputedStyle(name) : null, ccs = clause ? getComputedStyle(clause) : null;
      const next = r.querySelector(".attn-row-next");
      const why = [...r.querySelectorAll(".attn-clause ~ div")].find(d => !d.classList.contains("attn-meta"));
      return { h: rr.height, right: rr.right, padRight: parseFloat(getComputedStyle(r).paddingRight),
               hasAvatar: !!r.querySelector('[aria-hidden="true"]'),
               nameSize: ncs && parseFloat(ncs.fontSize), nameWeight: ncs && ncs.fontWeight,
               clauseSize: ccs && parseFloat(ccs.fontSize), clauseColor: ccs && ccs.color,
               clauseWrap: ccs && ccs.whiteSpace, clauseEllipsis: ccs && ccs.textOverflow,
               clauseText: clause ? clause.innerText.replace(/\s+/g, " ").trim() : "",
               factValue: next ? (next.children[0] && next.children[0].textContent.trim()) : null,
               factLabel: next ? (next.children[1] && next.children[1].textContent.trim()) : null,
               whyText: why ? why.textContent.trim() : "",
               buttons };
    }));
    ok(`${label}: the queue has rows to read`, rows.length >= 4, rows.length);
    // FIX (2026-09-18) — THE ROW TOOK DRIFT'S SHAPE. Drift sat under this list
    // looking twice as good; the row is its anatomy now, so these measurements
    // moved with it: a face, a name at Drift's weight, ONE SENTENCE THAT WRAPS
    // (the clause was being cut off mid-word), and one fact on the right with
    // its label under it instead of "overdue" printed twice.
    ok(`${label}: every row has a face`,
       rows.every(r => r.hasAvatar), rows.map(r => r.hasAvatar)[0]);
    ok(`${label}: a name is 15px at Drift's weight`,
       rows.every(r => r.nameSize === 15 && r.nameWeight === "700"), rows.map(r => [r.nameSize, r.nameWeight])[0]);
    ok(`${label}: …and its sentence WRAPS rather than being cut off`,
       rows.every(r => r.clauseWrap !== "nowrap" && r.clauseEllipsis !== "ellipsis"),
       rows.map(r => [r.clauseWrap, r.clauseEllipsis])[0]);
    ok(`${label}: …and carries the next step inside it`,
       rows.every(r => /Next:/.test(r.clauseText || "")), rows.map(r => r.clauseText)[0]);
    ok(`${label}: the right-hand fact says how late it is, once`,
       rows.every(r => /^(\d+ days?|Today|\d\d-\d\d)$/.test(r.factValue || "") && /^(overdue|due|due on)$/.test(r.factLabel || "")),
       rows.map(r => [r.factValue, r.factLabel])[0]);
    ok(`${label}: …and that fact is not ALSO printed under the sentence`,
       rows.every(r => !/^Overdue \d/i.test(r.whyText || "")), rows.map(r => r.whyText).filter(Boolean)[0]);
    ok(`${label}: exactly ONE emerald action per row`,
       rows.every(r => r.buttons.filter(b => b.bg === "rgb(13, 92, 58)").length === 1), rows.map(r => r.buttons.map(b => [b.text, b.bg]))[0]);
    ok(`${label}: …and the rest is behind a "…" menu`,
       rows.every(r => r.buttons.some(b => b.text === "…" && /More actions/.test(b.label)) && !r.buttons.some(b => /^Dismiss$/.test(b.text))), rows[0]?.buttons);
    if (w >= 1100) {
      ok("1440: a row clears the 64px touch target", rows.every(r => r.h >= 64), rows.map(r => Math.round(r.h)));
      ok("1440: …and nothing on it runs past the row's own edge",
         rows.every(r => r.buttons.every(b => b.right <= r.right + 1)),
         rows.map(r => ({ btn: Math.round(Math.max(...r.buttons.map(b => b.right))), edge: Math.round(r.right) }))[0]);
    }

    // THE CREAM BARS ARE GONE. A band is a label on the same white as the list.
    const bands = await page.evaluate(() => [...document.querySelectorAll(".attn-band")].map(b => {
      const cs = getComputedStyle(b);
      return { text: b.innerText.replace(/\s+/g, " ").trim(), bg: cs.backgroundColor, bb: cs.borderBottomWidth,
               size: parseFloat(getComputedStyle(b.querySelector("span")).fontSize) };
    }));
    ok(`${label}: the band labels are on the panel's own white, not a filled bar`,
       bands.length > 0 && bands.every(b => b.bg === "rgba(0, 0, 0, 0)" || b.bg === "rgb(255, 255, 255)"), bands);
    ok(`${label}: …with no rule under them, at 11px`,
       bands.every(b => b.bb === "0px" && b.size === 11), bands);

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
                 // the space below a header comes from its own padding, its
                 // parent's gap, or (in the rail) the title's own margin.
                 below: block ? (parseFloat(getComputedStyle(block).paddingBottom)
                                 || parseFloat(getComputedStyle(s).marginBottom)
                                 || parseFloat(getComputedStyle(block.parentElement).rowGap)) : null };
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

    // The one failure a layout pass must never ship: a page that scrolls sideways.
    const hscroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(`${label}: the page does not scroll sideways`, hscroll.sw <= hscroll.cw + 1, hscroll);

    await page.screenshot({ path: `${OUT}/home-${label}.png`, fullPage: true });
    console.log(`  screenshot → docs/build89/home-${label}.png`);
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

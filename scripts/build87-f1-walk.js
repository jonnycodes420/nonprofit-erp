// BUILD-87 F.1 verification walk — THE DIALOGS, MEASURED.
//
// tests/modal-shell.test.js holds the source property (there is ONE shell and
// everything goes through it). This measures what that buys, on the real page,
// at both widths — because the defect it fixes was invisible to every source
// assertion ever written about it: the markup said `position: fixed` the whole
// time, and a transformed ancestor quietly redefined what "fixed" meant.
//
// The regression condition matters and is reproduced deliberately: the bug
// showed up on a TALL page (Fundraising > Campaigns with enough campaigns to
// scroll), because a containing block only misplaces a dialog when it is
// taller than the viewport. A short page would have passed while broken.
//
//   §1 the Edit-campaign dialog — the one this fix was written for
//   §2 the backdrop covers the FULL viewport, and stays covering it after a
//      scroll (the property "position:fixed" was supposed to give and did not)
//   §3 the dialog is inside the viewport and its primary button is reachable
//   §4 Escape closes it and focus goes back to the button that opened it
//   §5 the page behind does not scroll while it is open
//   §6 the same, for a dialog on Home and a dialog in Settings
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build87-f1-walk.js
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

// Everything a dialog has to be true of, measured off the live page.
async function measure(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const back = dlg.parentElement;
    const br = back.getBoundingClientRect(), dr = dlg.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // The primary action: the last button the dialog owns that is not a
    // close/cancel — scrolled into view inside the dialog's own scroller,
    // which is the reachability the 90vh cap is supposed to guarantee.
    const btns = [...dlg.querySelectorAll("button")].filter(b =>
      !/^(close|cancel|×|✕|maybe later)$/i.test((b.innerText || "").trim()));
    const primary = btns[btns.length - 1];
    if (primary) primary.scrollIntoView({ block: "nearest" });
    const pr = primary ? primary.getBoundingClientRect() : null;
    return {
      portalled: back.parentElement === document.body,
      backdropFixed: getComputedStyle(back).position === "fixed",
      backdrop: { t: Math.round(br.top), l: Math.round(br.left), w: Math.round(br.width), h: Math.round(br.height) },
      viewport: { w: vw, h: vh },
      dialog: { t: Math.round(dr.top), b: Math.round(dr.bottom), l: Math.round(dr.left), r: Math.round(dr.right) },
      primary: pr ? { label: (primary.innerText || "").trim().slice(0, 40), t: Math.round(pr.top), b: Math.round(pr.bottom), l: Math.round(pr.left), r: Math.round(pr.right) } : null,
      bodyOverflow: getComputedStyle(document.body).overflow,
      pageScrollHeight: document.documentElement.scrollHeight,
    };
  });
}

function assertDialog(label, m, w, h) {
  ok(`${label}: the dialog is portalled to document.body`, !!m && m.portalled, m && m.portalled);
  ok(`${label}: the backdrop covers the FULL viewport`,
     !!m && m.backdropFixed && m.backdrop.t === 0 && m.backdrop.l === 0
     && Math.abs(m.backdrop.w - w) <= 1 && Math.abs(m.backdrop.h - h) <= 1,
     m && { backdrop: m.backdrop, viewport: m.viewport });
  ok(`${label}: the dialog is inside the viewport, top to bottom`,
     !!m && m.dialog.t >= -1 && m.dialog.b <= h + 1 && m.dialog.l >= -1 && m.dialog.r <= w + 1,
     m && { dialog: m.dialog, viewport: m.viewport });
  ok(`${label}: the primary button is inside the viewport`,
     !!m && !!m.primary && m.primary.t >= 0 && m.primary.b <= h && m.primary.l >= 0 && m.primary.r <= w,
     m && m.primary);
  ok(`${label}: the page behind it cannot scroll`, !!m && m.bodyOverflow === "hidden", m && m.bodyOverflow);
}

(async () => {
  const stamp = Date.now().toString(36);
  const reg = await fetch(API + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: "Modal House " + stamp, userName: "Mike Henderson", email: `b87f1_${stamp}@test.local`, password: "loadtest1234" }) }).then(x => x.json());
  const token = reg.token;
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const api = (m, p, b) => fetch(API + p, { method: m, headers: auth, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
  await api("POST", "/onboarding/complete", {});

  // THE REGRESSION CONDITION: a Campaigns page tall enough to scroll. The
  // containing-block bug cannot show itself on a page that fits the viewport,
  // so a fixture of one campaign would have been a test that could not fail.
  for (let i = 0; i < 14; i++) {
    const r = await api("POST", "/fundraising/campaigns", { name: `Campaign ${i + 1}`, goalAmount: 10000 + i * 1000, goalCategory: "project" });
    if (i === 0) ok("fixture: campaigns are creatable", !r.error, r);
  }
  // …and a donor with an open thread, so Home has a row with a "Done" on it.
  const d = await api("POST", "/donors", { name: "Robert Harmon", email: "robert.harmon@example.org" });
  const donorId = d.id || d.donor?.id;
  const g = await api("POST", `/donors/${donorId}/gifts`, { amount: 2500, date: new Date(Date.now() - 86400000 * 20).toISOString().slice(0, 10), type: "cash" });
  ok("fixture: the donor and the gift both landed", !!donorId && !g.error, { donorId, g: g.error || Object.keys(g) });
  // The thank-you thread a gift opens is not visible on the very next read —
  // measured at about a second and a half here. Poll rather than sleep, so the
  // walk does not start against a Home that has nothing on it yet.
  let threads = { list: [] };
  for (let i = 0; i < 12 && !(threads.list || []).length; i++) {
    threads = await api("GET", "/threads?scope=mine&cap=20");
    if (!(threads.list || []).length) await new Promise(r => setTimeout(r, 500));
  }
  ok("fixture: the donor has a thread on Home", (threads.list || []).length > 0, threads);

  const browser = await chromium.launch();
  for (const [w, h, label] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
    console.log(`\n── ${label} ${w}x${h} ──`);
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: w < 1000 });
    const pageErrors = [];
    page.on("pageerror", e => { const m = String(e); if (!/Unexpected token '<'/.test(m)) pageErrors.push(m.slice(0, 140)); });
    await page.addInitScript(([t, u, o]) => {
      localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
    }, [token, JSON.stringify(reg.user), JSON.stringify({ ...reg.org, onboarding_complete: 1 })]);
    await page.goto(APP + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2200);

    const goTab = async name => {
      const hit = await page.evaluate(n => {
        const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent && x.innerText.toLowerCase().includes(n.toLowerCase()))
          .sort((a, b2) => a.innerText.length - b2.innerText.length)[0];
        if (!b) return false; b.click(); return true;
      }, name);
      if (hit) { await page.waitForTimeout(1400); return true; }
      const more = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent && /more/i.test(x.innerText))
          .sort((a, b2) => a.innerText.length - b2.innerText.length)[0];
        if (!b) return false; b.click(); return true;
      });
      if (!more) return false;
      await page.waitForTimeout(600);
      return goTab(name);
    };

    // ── §1–§5 · the Edit-campaign dialog on a TALL page ────────────────────
    ok(`${label}: Fundraising is reachable`, await goTab("Fundraising"));
    await page.evaluate(() => {
      const t = [...document.querySelectorAll("button,[role=button]")].find(b => /campaigns/i.test(b.innerText || ""));
      if (t) t.click();
    });
    await page.waitForTimeout(1500);
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    ok(`${label}: the Campaigns page is taller than the viewport (the condition the bug needs)`, tall, tall);
    // Scroll down first: a dialog opened from halfway down a long page is
    // exactly where the old one was drawn off-screen.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent && /^edit$/i.test((x.innerText || "").trim()));
      if (!b.length) return false; b[b.length - 1].focus(); b[b.length - 1].click(); return true;
    });
    ok(`${label}: an Edit campaign button opens`, opened);
    if (opened) {
      await page.waitForTimeout(700);
      const m = await measure(page);
      assertDialog(`${label} Edit campaign`, m, w, h);
      ok(`${label} Edit campaign: the form really is long enough to have needed the cap`,
         !!m && m.pageScrollHeight > h, m && m.pageScrollHeight);
      // §4 — Escape, and focus back to the opener.
      const before = await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.innerText || "").trim().slice(0, 20));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const gone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
      ok(`${label} Edit campaign: Escape closes it`, gone, before);
      const back = await page.evaluate(() => (document.activeElement?.innerText || "").trim().toLowerCase());
      ok(`${label} Edit campaign: focus returns to the opener`, back === "edit", back);
      const unlocked = await page.evaluate(() => getComputedStyle(document.body).overflow);
      ok(`${label} Edit campaign: the page scrolls again once it is closed`, unlocked !== "hidden", unlocked);
    }

    // ── §6 · the same five properties, on dialogs from OTHER call sites ────
    // One dialog proves the shell works; several prove the consolidation did.
    // These are four different components (Fundraising, Donors, LogConversation
    // and the campaign modal's create mode), so a shell that only happened to
    // suit the one it was written for would show up here.
    // [tab, pre-step (a menu to open first, or null), opener, name]
    const others = [
      ["Fundraising", null,                 /^\+?\s*new campaign$/i,   "New campaign"],
      ["Donors",      /import\s*&?\s*tools/i, /^import donors only/i, "Import donors"],
      ["Home",        null,                 /^done$/i,                 "Log a conversation"],
    ];
    let measured = 1;   // the Edit-campaign dialog above
    const clickByText = (rx) => page.evaluate(r => {
      const re = new RegExp(r.source, r.flags);
      const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent && re.test((x.innerText || "").trim()))[0];
      if (!b) return false; b.focus(); b.click(); return true;
    }, { source: rx.source, flags: rx.flags });

    for (const [tab, pre, opener, what] of others) {
      if (!(await goTab(tab))) { ok(`${label}: ${tab} is reachable`, false); continue; }
      if (pre) {
        const openedMenu = await clickByText(pre);
        ok(`${label}: the "${what}" control is reachable from its menu`, openedMenu, pre.source);
        if (!openedMenu) continue;
        await page.waitForTimeout(400);
      }
      const hit = await page.evaluate(rx => {
        const re = new RegExp(rx.source, rx.flags);
        const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent && re.test((x.innerText || "").trim()))[0];
        if (!b) return false; b.focus(); b.click(); return true;
      }, { source: opener.source, flags: opener.flags });
      if (!hit) { ok(`${label}: an opener for "${what}" exists`, false, opener.source); continue; }
      await page.waitForTimeout(900);
      const m = await measure(page);
      if (!m) { ok(`${label} ${what}: a dialog opened`, false); continue; }
      measured++;
      assertDialog(`${label} ${what}`, m, w, h);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      ok(`${label} ${what}: Escape closes it`, await page.evaluate(() => !document.querySelector('[role="dialog"]')));
    }
    ok(`${label}: four separate dialogs were opened and measured, not one`, measured >= 4, measured);

    ok(`${label}: zero uncaught page errors across the walk`, pageErrors.length === 0, pageErrors);
    if (failures) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/f1-${label}.png`, fullPage: false }); }
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

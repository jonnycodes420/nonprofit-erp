// tests/lib/deadClickCensus.js · CAMPAIGN-2 item 6. A CLICK THAT CHANGES NOTHING IS A DEFECT.
//
// Jarvis's power-use sweep (24 Nov) found buttons in the editors that did nothing a person could
// see: "Start a campaign from this" (no toast, no navigation, a draft made in silence), the
// sequence editor's "Write with AI" ("no visible change at all"), "Draft with AI" with unsaved
// changes ("did nothing at all"). The census walks every button in an editor, clicks it the way a
// person does, and fails the click when nothing a person could SEE changed:
//
//   seen      once it settles, what is visible differs: an element, an attribute, words or a value
//             inside the viewport (and inside every scrolling box around it), a new URL, or a toast. A change in a part of the rail
//             scrolled out of sight is not seen; that is exactly how the note above "Name" hid.
//   network   a request with nothing seen ("a draft made in silence") is still a dead click.
//
// census(page, { root, open, skip }) clicks (twice) each enabled, visible button under `root` in the top
// document (the email frame's own handles are BUILDER-2B's suite's), re-opening the editor with
// `open()` when a click leaves it, and returns [{ label, seen, requests }] for each button.
"use strict";

// Installed once per page: SIG() is what a person can see, settled: every element visible in the
// viewport (and inside every scrolling box around it) with its attributes, its own words and its
// value. A spinner that comes and goes leaves it unchanged; so does a note drawn out of sight.
const PROBE = () => {
  if (window.__census) return;
  const visible = el => {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll|hidden)/.test(s.overflowY + s.overflowX)) {
        const b = a.getBoundingClientRect();
        if (r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) return false;
      }
    }
    return true;
  };
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ");
  window.__census = {
    sig: () => [...document.body.querySelectorAll("*")].filter(visible).map(el =>
      el.tagName + [...el.attributes].map(a => a.name + "=" + a.value).join(",") + "|" + own(el) + ("value" in el ? "|" + (el.type === "checkbox" || el.type === "radio" ? el.checked : el.value) : "")).join("\n"),
    toast: () => !!document.querySelector('[data-testid="builder-toast"]'),
  };
};

async function buttonsUnder(page, root, skip) {
  return page.evaluate(([root, skip]) => {
    const host = document.querySelector(root);
    if (!host) return [];
    const re = skip ? new RegExp(skip, "i") : null;
    const seenLabels = new Map();
    return [...host.querySelectorAll("button")].filter(b => {
      if (b.disabled || b.closest("[aria-hidden=true]")) return false;
      // A choice already made (Desktop while on Desktop, the open tab) does nothing when pressed again, rightly.
      if (b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-checked") === "true" || b.getAttribute("aria-current")) return false;
      const r = b.getBoundingClientRect(); const st = getComputedStyle(b);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    }).map(b => {
      const label = (b.getAttribute("aria-label") || b.innerText || b.title || b.getAttribute("data-testid") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const n = seenLabels.get(label) || 0; seenLabels.set(label, n + 1);
      return { label, nth: n, testid: b.getAttribute("data-testid") || "" };
    }).filter(x => x.label && !(re && re.test(x.label + " " + x.testid)));
  }, [root, skip || ""]);
}

async function census(page, { root, open, skip, max = 80, settleMs = 1200 }) {
  await page.evaluate(PROBE);
  const list = (await buttonsUnder(page, root, skip)).slice(0, max);
  const out = [];
  for (const btn of list) {
    if (!(await page.locator(root).count())) { await open(); await page.evaluate(PROBE); }
    const target = btn.testid ? page.locator(root).locator(`button[data-testid="${btn.testid}"]`).nth(0)
      : page.locator(root).getByRole("button", { name: btn.label, exact: true }).nth(btn.nth);
    const el = target;
    if (!(await el.count()) || !(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) continue;
    // Pressed, then pressed again as a person does when nothing seemed to happen: the second press
    // owes an answer too ("Write with AI" on a step already holding the starting words said nothing).
    let left = false;
    for (const time of [1, 2]) {
      if (time === 2) {
        if (left || !(await el.count()) || !(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) break;
        const chosen = await el.evaluate(x => x.getAttribute("aria-pressed") === "true" || x.getAttribute("aria-selected") === "true" || x.getAttribute("aria-checked") === "true" || x.getAttribute("aria-expanded") === "true").catch(() => true);
        if (chosen) break;   // a choice now made, or a menu now open: pressing it again closes or keeps it, rightly
      }
      await el.scrollIntoViewIfNeeded().catch(() => {});
      // A toast from the last press goes first, so this press's own answer is what is compared.
      await page.waitForFunction(() => !window.__census.toast(), null, { timeout: 5000 }).catch(() => {});
      let requests = 0;
      const onReq = r => { if (!/\.(js|css|png|jpg|svg|woff2?)(\?|$)/.test(r.url())) requests++; };
      page.on("request", onReq);
      const before = await page.evaluate(() => ({ url: location.href, sig: window.__census.sig() }));
      await el.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(settleMs);
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => ({ url: location.href, sig: window.__census ? window.__census.sig() : "" }));
      page.off("request", onReq);
      const seen = after.url !== before.url || after.sig !== before.sig;
      out.push({ label: btn.label + (time === 2 ? " (pressed again)" : ""), testid: btn.testid, seen, requests });
      if (after.url !== before.url || !(await page.locator(root).count())) left = true;
    }
    // Put the editor back as it was for the next button: close what opened.
    await page.keyboard.press("Escape").catch(() => {});
    if ((await page.locator(root).count()) === 0) { await open(); await page.evaluate(PROBE); }
  }
  if (process.env.CENSUS_DEBUG) console.log("census", root, JSON.stringify(out));
  return out;
}

// The dead ones: nothing seen (with or without a request behind it).
const dead = results => results.filter(r => !r.seen).map(r => `${r.label}${r.requests ? " (a request, nothing seen)" : ""}`);

module.exports = { census, dead };

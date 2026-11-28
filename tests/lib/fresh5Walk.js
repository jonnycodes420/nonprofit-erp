// tests/lib/fresh5Walk.js · FRESH-5 item 5. THE FLEET'S CLICKS FRESH-4 DIDN'T REACH.
//
// W-1112-Volunteers-01X, walked on staging with FRESH-4 live (Sat 28 Nov): "task creation, gift and pledge
// delete, file upload, note save, and call delete still showed pre-save state, and Epsilon's Donors list
// row stayed Lapsed after his profile returned to Current"; Area 4: hours, shift deletes and the counts.
// Each step does the write with real clicks and asserts the visible line or number within 1.5 s of the
// write's answer, with no reload, on the profile, the Donors list and Volunteers. tests/stale2.test.js
// runs it (§N). What each one was on staging is in docs/history/FRESH-5.md.
"use strict";

const SEEN_MS = 1500;

// page: a signed-in Playwright page. fx: { app, todayUs, file, people: { prof, profName, lapsed, lapsedName, vol, volName }, tag }.
async function walk(page, fx) {
  const results = [];
  let loads = 0;
  page.on("load", () => { loads++; });
  page.on("dialog", d => d.accept().catch(() => {}));
  const open = async url => { await page.goto(fx.app + url, { waitUntil: "networkidle", timeout: 60000 }); };
  const seen = async (label, method, pathRe, clicks, test, arg) => {
    const l0 = loads;
    let at = 0;
    const answered = page.waitForResponse(r => r.request().method() === method && pathRe.test(new URL(r.url()).pathname), { timeout: 20000 })
      .then(r => { at = performance.now(); return r.status(); }).catch(() => null);
    try { await clicks(); } catch (e) { results.push({ label, ok: false, why: "clicks: " + e.message.split("\n")[0].slice(0, 160) }); return; }
    const status = await answered;
    if (!status || status >= 300) { results.push({ label, ok: false, why: `the write answered ${status}` }); return; }
    const hit = await page.waitForFunction(test, arg, { timeout: SEEN_MS + 2500, polling: 50 }).then(() => performance.now() - at).catch(() => null);
    results.push({ label, ok: hit != null && hit <= SEEN_MS && loads === l0, ms: hit, reloaded: loads !== l0,
      why: hit == null ? "not on screen within 4 s" : hit > SEEN_MS ? `on screen after ${Math.round(hit)} ms` : "" });
  };
  const has = s => new Function(`return document.body.innerText.includes(${JSON.stringify(s)})`);
  const hasNot = s => new Function(`return !document.body.innerText.includes(${JSON.stringify(s)})`);
  const tag = fx.tag;

  // ── THE PROFILE ──
  await open(`/donors/${fx.people.prof}`);
  // 1 · a task: Add a task → Create Task. Coming up lists it.
  await seen("task: profile → Add a task → Create Task → Coming up lists it", "POST", /^\/tasks$/, async () => {
    await page.click('[data-testid="dp-task"]');
    await page.fill('input[placeholder^="What happens next"], textarea[placeholder^="What happens next"]', `Walk task ${tag}`);
    await page.click('button:has-text("Create Task")');
  }, has(`Walk task ${tag}`));
  // 2 · a note: Add a note → Save the note. The timeline shows it.
  await seen("note: profile → Add a note → Save the note → the timeline shows it", "POST", /\/conversations$/, async () => {
    await page.click('[data-testid="dp-note"]');
    await page.fill('[data-testid="conv-line"]', `Walk note ${tag}`);
    await page.click('[data-testid="touch-save"]');
  }, has(`Walk note ${tag}`));
  // 3 · a file: Files → choose a file. "Files · 1" and its row.
  await page.click('[data-tab="files"]');
  await seen("file: Files → upload → its row and the count", "POST", /\/materials$/, async () => {
    await page.locator('[aria-label^="Drop a file here"] input[type=file], [aria-label^="Drop a file here"] ~ input[type=file]').first().setInputFiles(fx.file);
  }, () => [...document.querySelectorAll('[data-testid="dp-file"]')].some(r => /walk-file/.test(r.innerText))
    && /Files\s*·\s*1/.test((document.querySelector('[data-testid="dp-files-head"]') || {}).innerText || ""));
  // 4 · a call deleted: Conversations → the call's menu → Delete. It leaves, and Last contact with it.
  await page.click('[data-tab="conversations"]');
  await page.waitForSelector(`text=Walk call ${tag}`, { timeout: 10000 }).catch(() => {});
  await seen("call delete: Conversations → ⋯ → Delete → the call and its Last contact leave", "DELETE", /^\/interactions\/[^/]+$/, async () => {
    const i = await page.evaluate(t => [...document.querySelectorAll('[data-testid="item-menu"]')].findIndex(b => {
      for (let e = b, k = 0; e && k < 6; e = e.parentElement, k++) if ((e.innerText || "").includes(`Walk call ${t}`)) return true; return false; }), tag);
    await page.locator('[data-testid="item-menu"]').nth(Math.max(0, i)).click();
    await page.click('[role=menuitem]:has-text("Delete")');
  }, hasNot(`Walk call ${tag}`));
  // 5 · a pledge deleted: Giving → × → Delete pledge. Nothing on the page says $1,875, the Suggested ask included.
  await page.click('[data-tab="giving"]');
  await page.waitForSelector('button[aria-label="Delete this pledge"]', { timeout: 10000 }).catch(() => {});
  await seen("pledge delete: Giving → × → Delete pledge → $1,875 leaves the page (the Suggested ask too)", "DELETE", /^\/pledges\/[^/]+$/, async () => {
    await page.click('button[aria-label="Delete this pledge"]');
    await page.click('button:has-text("Delete pledge")');
  }, hasNot("$1,875"));
  // 6 · a gift deleted: Giving → Delete → confirm. Lifetime says nothing given.
  await seen("gift delete: Giving → Delete → Lifetime moves", "DELETE", /^\/gifts\/[^/]+$/, async () => {
    await page.locator('button:has-text("Delete")').first().click();
    await page.waitForTimeout(300);
    await page.locator('[role=dialog] button:has-text("Delete"), [role=alertdialog] button:has-text("Delete")').last().click();
  }, () => { const t = document.body.innerText; const i = t.indexOf("Lifetime"); return i >= 0 && !/\$80\b/.test(t.slice(i, i + 40)); });

  // ── THE DONORS LIST: a Lapsed person whose gift is edited into this month reads Current on the profile;
  // their row's Stage must not stay Lapsed ("Epsilon's Donors list row stayed Lapsed").
  await open("/donors");
  await page.fill("input.donors-search", fx.people.lapsedName.split(" ").pop());
  await page.waitForTimeout(1500);
  await page.click(`text=${fx.people.lapsedName}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.click('[data-tab="giving"]');
  await seen("gift edit: a Lapsed person's gift dated today → the profile leaves Lapsed", "PUT", /^\/gifts\/[^/]+$/, async () => {
    await page.locator('button:has-text("Edit")').first().click();
    const d = page.locator('label:has-text("Date") input').first();
    await d.fill(fx.todayUs); await page.keyboard.press("Tab");
    await page.click('[data-testid="gift-edit-save"]');
  }, () => { const t = document.body.innerText; return !/Lapsed\s*\n?\s*Log a touch/.test(t); });
  {
    const t0 = performance.now();
    await page.click("text=← Donors");
    const name = fx.people.lapsedName;
    const hit = await page.waitForFunction(n => { const t = document.body.innerText; const i = t.lastIndexOf(n); return i >= 0 && /Ongoing care/.test(t.slice(i, i + 120)) && !/Lapsed/.test(t.slice(i, i + 120)); },
      name, { timeout: 4000, polling: 50 }).then(() => performance.now() - t0).catch(() => null);
    const row = await page.evaluate(n => { const t = document.body.innerText; const i = t.lastIndexOf(n); return i < 0 ? null : t.slice(i, i + 120).replace(/\s+/g, " "); }, name);
    results.push({ label: "…← Donors: the row's Stage says Ongoing care, not Lapsed", ok: hit != null && hit <= SEEN_MS, ms: hit, row, why: hit == null ? "the row still says Lapsed" : "" });
  }

  // ── VOLUNTEERS: hours logged and a shift removed move Recent shifts and the header's hours ──
  await open("/app/volunteers");
  const hoursSaid = () => page.evaluate(() => { const m = document.body.innerText.match(/([\d,.]+) hours? given so far/); return m ? m[1] : null; });
  const h0 = await hoursSaid();
  await page.click('[data-vol-section="records"]');
  await page.waitForSelector('[data-testid="vol-log-shift"]', { timeout: 10000 }).catch(() => {});
  await seen("hours: Volunteers → Records → Log shift → Recent shifts lists it", "POST", /\/volunteer-hours$/, async () => {
    const v = await page.$eval('[data-testid="vol-log-shift"] select[aria-label="Volunteer"]', (s, n) => ([...s.options].find(o => o.textContent.includes(n)) || {}).value, fx.people.volName);
    await page.selectOption('[data-testid="vol-log-shift"] select[aria-label="Volunteer"]', v);
    await page.fill('[data-testid="vol-log-shift"] input[aria-label="Date"]', fx.todayUs); await page.keyboard.press("Tab");
    await page.fill('[data-testid="vol-log-shift"] input[aria-label="Hours"]', "6");
    await page.fill('[data-testid="vol-log-shift"] input[aria-label="What they did"]', `walkrole ${tag}`);
    await page.click('[data-testid="vol-log-shift"] button:has-text("Log shift")');
  }, t => [...document.querySelectorAll('[data-testid="vol-shift-row"]')].some(r => r.innerText.includes(`walkrole ${t}`)), tag);
  {
    const hit = await page.waitForFunction(was => { const m = document.body.innerText.match(/([\d,.]+) hours? given so far/); return !!m && m[1] !== was; }, h0, { timeout: 4000, polling: 50 }).then(() => true).catch(() => false);
    results.push({ label: "…and the header's hours given so far move with it", ok: hit, h0, h1: await hoursSaid() });
  }
  await seen("shift delete: Recent shifts → Remove → the row leaves", "DELETE", /^\/volunteer-shifts\/[^/]+$/, async () => {
    await page.locator('[data-testid="vol-shift-row"]', { hasText: `walkrole ${tag}` }).first().locator('button[aria-label^="Remove the shift"]').click();
    await page.waitForTimeout(250);
    const c = page.locator('[role=dialog] button:has-text("Remove"), [role=alertdialog] button:has-text("Remove")');
    if (await c.count()) await c.last().click();
  }, t => ![...document.querySelectorAll('[data-testid="vol-shift-row"]')].some(r => r.innerText.includes(`walkrole ${t}`)), tag);
  results.push({ label: "…and the header's hours are back where they were (a logged and removed shift nets to nothing)", ok: (await hoursSaid()) === h0, h0, h1: await hoursSaid() });
  return results;
}

module.exports = { walk, SEEN_MS };

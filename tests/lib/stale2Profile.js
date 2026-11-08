// tests/lib/stale2Profile.js: STALE-2's profile and dialog checks, run inside
// tests/stale1.test.js's browser walk (the same org, page and no-reload rule).
//
//   §P1 W-1107-Finance-04X  a gift added on the Giving tab moves the header's
//       Lifetime, and deleting it moves it back, with no reload
//   §P2 W-1107-Donors-31    the Files tab's count, its heading and its body are
//       one number, before and after an upload, with no reload
//   §P3 W-1107-Donors-44X   Merge with…'s search never shows rows for an older
//       query: while "Marl" is on its way, nobody without "marl" is listed
//   §P4 W-1107-Donors-49X   the household dialogs list the people the profile's
//       rail lists (the same relationship rows)
//
// Planted defects (each turned this red, then was taken back out): listed in
// the STALE-2 report.
"use strict";

module.exports = async function stale2Profile(t) {
  const { page, api, tok, P, person, go, text, until, check, noReload, q, ORG } = t;
  await person("odile", "Odile Marsh");
  await person("rufus", "Rufus Marsh");
  await person("marlow", "Marlow Pennant");
  await api("POST", `/donors/${P("odile")}/gifts`, tok, { amount: 50, date: t.today, type: "cash", paymentMethod: "Cash" });
  await api("POST", `/donors/${P("odile")}/relationships`, tok, { relatedDonorId: P("rufus"), relationshipType: "spouse" });
  // One uploaded file before the profile opens (a tiny text file).
  await api("POST", `/donors/${P("odile")}/materials`, tok, { file_name: "odile-letter.txt", file_type: "text/plain", file_data: Buffer.from("A letter.").toString("base64"), notes: "" });
  const lifetime = () => text('[data-testid="dp-fig-lifetime"]');
  // Every dialog closed (Escape, then a Close button if one is still up).
  const closeAll = async () => {
    for (let i = 0; i < 3 && await page.locator('[role="dialog"]').count(); i++) {
      await page.keyboard.press("Escape"); await page.waitForTimeout(250);
      const x = page.locator('[role="dialog"] [aria-label="Close"]').first();
      if (await x.count()) await x.click({ timeout: 2000 }).catch(() => {});
    }
  };
  // A click that names what it was for when it can't happen.
  const click = async (loc, what) => { try { await (typeof loc === "string" ? page.locator(loc).first() : loc).click({ timeout: 8000 }); } catch (e) { throw new Error(`could not click ${what}`); } };

  // ── §P1 · A GIFT ADDED AND DELETED ON THE PROFILE ─────────────────────────
  await noReload("§P1", async () => {
    await go(`/donors/${P("odile")}`);
    await until(() => /\$50/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""));
    const l0 = await lifetime();
    await click('[data-tab="giving"]', "the Giving tab");
    await click(page.getByRole("button", { name: "+ Add Gift" }), "+ Add Gift");
    await page.locator('[data-testid="dp-add-gift-form"] input[placeholder="Amount ($)"]').first().fill("25");
    await click('[data-testid="dp-add-gift-save"]', "Save gift");
    const up = await until(() => /\$75/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""));
    await check("§P1 a $25 gift added on the Giving tab moves Lifetime from $50 to $75", up, { before: l0, after: await lifetime() });
    const row = page.locator("tr").filter({ hasText: /\$25(\.00)?(?!\d)/ }).filter({ has: page.getByRole("button", { name: "Delete", exact: true }) }).first();
    await click(row.getByRole("button", { name: "Delete", exact: true }), "the $25 gift's Delete");
    await click(page.getByRole("button", { name: "Delete gift" }), "Delete gift in the confirm");
    const down = await until(() => /\$50(?!\d)/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || "")
      && !/\$75/.test((document.querySelector('[data-testid="dp-fig-lifetime"]') || {}).textContent || ""));
    await check("§P1 deleting it moves Lifetime back to $50", down, await lifetime());
  });

  // ── §P2 · THE FILES TAB: ONE NUMBER ───────────────────────────────────────
  const three = () => page.evaluate(() => {
    const n = s => { const m = /(\d[\d,]*)/.exec(s || ""); return m ? Number(m[1].replace(/,/g, "")) : 0; };
    const tab = document.querySelector('[data-tab="files"] [data-tab-count="files"]');
    const head = document.querySelector('[data-testid="dp-files-head"]');
    const body = document.querySelectorAll('[data-testid="dp-file"],[data-testid="dp-file-check"],.tl-card[data-kind="file"]').length;
    return { tab: tab ? n(tab.textContent) : 0, head: head ? n(head.textContent.replace(/^Files/, "")) : null, body };
  });
  await noReload("§P2", async () => {
    await click('[data-tab="files"]', "the Files tab");
    await until(() => !!document.querySelector('[data-testid="dp-files-head"]') && /·/.test(document.querySelector('[data-testid="dp-files-head"]').textContent));
    const a = await three();
    await check("§P2 the Files tab's count, heading and body agree (1 file)", a.tab === 1 && a.head === 1 && a.body === 1, a);
    await page.locator('[data-testid="dp-files-head"]').locator("xpath=../..").locator('input[type="file"]').first().setInputFiles({ name: "odile-second.txt", mimeType: "text/plain", buffer: Buffer.from("Another letter.") });
    const moved = await until(() => /·\s*2/.test((document.querySelector('[data-testid="dp-files-head"]') || {}).textContent || ""));
    const b = await three();
    await check("§P2 after an upload all three say 2, with no reload", moved && b.tab === 2 && b.head === 2 && b.body === 2, b);
  });

  // ── §P3 · MERGE WITH…: THE LATEST QUERY ONLY ──────────────────────────────
  // "Mar" answers at once; "Marl" is held back 2.5 s on the wire. While it is
  // held, the list may narrow what it has, never show "Mar"'s Odile and Rufus
  // Marsh as answers to "Marl".
  await noReload("§P3", async () => {
    // Held in the page itself: a service worker would carry it past page.route.
    await page.evaluate(() => {
      const real = window.fetch; window.__s2RealFetch = real;
      window.fetch = (u, o) => /\/donors\/pick\?q=Marl(&|$)/.test(String(u && u.url || u))
        ? new Promise(res => setTimeout(res, 2500)).then(() => real(u, o)) : real(u, o);
    });
    await click("#dp-more-btn", "More");
    await click('[data-testid="dp-merge-with"]', "Merge with…");
    const box = page.locator('[data-testid="mw-search"]');
    await box.fill("Mar");
    const marShown = await until(() => /Marlow/.test(Array.from(document.querySelectorAll('[data-testid="mw-pick"]')).map(b => b.textContent).join("|"))
      && /Rufus Marsh/.test(Array.from(document.querySelectorAll('[data-testid="mw-pick"]')).map(b => b.textContent).join("|")));
    await check("§P3 \"Mar\" lists Marlow and the Marshes", marShown, await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="mw-pick"]')).map(b => b.textContent)));
    await box.fill("Marl");
    await page.waitForTimeout(700);   // the debounce has passed; Marl's answer is still held
    const mid = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="mw-pick"]')).map(b => b.textContent));
    await check("§P3 while \"Marl\" is on its way, no row for an older query shows", mid.length > 0 ? mid.every(s => /marl/i.test(s)) : false, mid);
    await until(() => !!document.querySelector('[data-testid="mw-pick"]'), null);
    await page.waitForTimeout(2600);
    const end = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="mw-pick"]')).map(b => b.textContent));
    await check("§P3 …and \"Marl\"'s answer is Marlow alone", end.length === 1 && /Marlow/.test(end[0]), end);
    await page.evaluate(() => { if (window.__s2RealFetch) window.fetch = window.__s2RealFetch; });
    await closeAll();
  });

  // ── §P4 · THE HOUSEHOLD DIALOGS LIST WHO THE RAIL LISTS ───────────────────
  // A spouse link made The Marsh Household. Its relationship row taken away,
  // the rail still lists Rufus under the household, and Household and
  // related's Linked people must too (it said "Nobody linked yet"). Then
  // Marlow, linked to Pell as family and in no household: "Group into a
  // household" offers Pell first, as linked.
  await person("pell", "Pell Odum");
  await api("POST", `/donors/${P("marlow")}/relationships`, tok, { relatedDonorId: P("pell"), relationshipType: "family" });
  const relId = ((await q("SELECT id FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2)", [ORG, P("odile")]))[0] || {}).id;
  if (relId) await api("DELETE", `/donor-relationships/${relId}`, tok);
  await noReload("§P4", async () => {
    await go(`/donors/${P("rufus")}`);
    await go(`/donors/${P("odile")}`);
    await until(() => /Rufus Marsh/.test((document.querySelector('[data-testid="dp-rail-related"]') || {}).textContent || ""));
    const rail = await text('[data-testid="dp-rail-related"]');
    await check("§P4 the rail lists Rufus, in the household", /Rufus Marsh/.test(rail), rail.slice(0, 160));
    await click('[data-testid="dp-rail-related-manage"]', "the rail's Manage");
    const lp = await until(() => /Rufus Marsh/.test((document.querySelector('[data-testid="dp-linked-people"]') || {}).textContent || ""));
    await check("§P4 Household and related's Linked people lists Rufus, as the rail does", lp, await text('[data-testid="dp-linked-people"]'));
    await closeAll();
    await go(`/donors/${P("marlow")}`);
    await until(() => /Pell Odum/.test((document.querySelector('[data-testid="dp-rail-related"]') || {}).textContent || ""));
    await click('[data-tab="giving"]', "the Giving tab");
    await click('[data-testid="dp-household-add"]', "the household's Add");
    const linked = await until(() => /Pell Odum/.test((document.querySelector('[data-testid="hh-linked"]') || {}).textContent || ""));
    await check("§P4 Group into a household offers Pell, linked to Marlow as family", linked, await text('[data-testid="hh-linked"]'));
    await closeAll();
  });
};

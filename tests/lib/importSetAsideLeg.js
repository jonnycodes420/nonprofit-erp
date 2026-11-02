// tests/lib/importSetAsideLeg.js · IMPORT-6. THE PREVIEW SAYS WHERE EVERY ROW WENT.
//
// smoke-walk's donor leg calls this at 1440 and at 390: the reader opens a list
// of people with a heading, a repeated header and a page footer in it
// (tests/fixtures/import/people-shapes/with-chrome.csv), and the preview's
// "Set aside" list shows each of those lines with its line number and reason,
// inside the width, with no console error and no API 4xx/5xx. On 1 Nov the
// preview hid such lines, and 317 people went with them.
"use strict";
const path = require("path");
const FILE = path.join(__dirname, "..", "fixtures", "import", "people-shapes", "with-chrome.csv");

module.exports = async function importSetAsideLeg({ page, width, ok, APP, BASE, ignoreUrl, ignoreText, expected5xx }) {
  const trouble = [];
  const onConsole = m => { if (m.type() === "error" && !ignoreUrl.test((m.location() || {}).url || "") && !ignoreText.test(m.text()) && !/\[SW\]/.test(m.text())) trouble.push("console: " + m.text().slice(0, 140)); };
  const onResponse = r => { if (r.status() >= 400 && r.url().startsWith(BASE) && !expected5xx.test(r.url())) trouble.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); };
  const onError = e => trouble.push("threw: " + e.message.slice(0, 140));
  page.on("console", onConsole); page.on("response", onResponse); page.on("pageerror", onError);
  try {
    await page.goto(APP + "/donors", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Import & tools/ }).click();
    await page.getByText("Import a spreadsheet").click();
    await page.locator("[role=dialog] input[type=file]").first().setInputFiles(FILE);
    await page.locator('[data-testid="sheet-review"]').waitFor({ timeout: 30000 }).catch(() => {});
    const said = await page.locator("[role=dialog]").first().innerText().catch(() => "");
    await page.locator('[data-testid="sheet-aside"] summary').click().catch(() => {});
    const aside = await page.locator('[data-testid="sheet-aside-line"]').allInnerTexts().catch(() => []);
    const fits = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="sheet-aside"]');
      return !!d && d.getBoundingClientRect().right <= window.innerWidth + 1 && d.scrollWidth <= d.clientWidth + 1;
    });
    ok(`§import6 at ${width}: the preview lists each row set aside with its line and reason`, /Import 3 people/.test(said)
       && JSON.stringify(aside.map(t => t.slice(0, 7))) === '["Line 3:","Line 5:","Line 6:"]'
       && /"Board members"/.test(aside[0]) && /header row again/.test(aside[1]) && /"Page 2 of 3"/.test(aside[2]) && fits,
       JSON.stringify({ aside, fits, said: said.slice(0, 200) }));
    ok(`§import6 at ${width}: the preview has no console error or API 4xx/5xx`, trouble.length === 0, trouble.slice(0, 4));
  } finally {
    page.off("console", onConsole); page.off("response", onResponse); page.off("pageerror", onError);
  }
};

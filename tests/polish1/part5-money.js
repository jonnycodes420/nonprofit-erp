// POLISH-1 Part 5 — NUMBERS ALWAYS LOOK LIKE MONEY.
//
// The PREMIUM-1 walk read "57 gifts no fund (46693.95)" on the month-close
// banner: the bookkeeper file's bare decimal printed at a person, no dollar
// sign, no separator. Two checks:
//   §close  the month-close read names each problem in words and dollars
//           ("3 gifts with no payment method ($87.50)", "2 checks with no
//           number ($7,647.00)"), through the one formatter;
//   §bare   on the main screens (Home, Donors, a donor profile, Reports,
//           Finance and its month close) the rendered text holds no bare
//           money-like decimal: a number with two decimals and no "$".
// HOW IT GOES RED: put `(${i.amount})` back on the banner (the CSV shape), or
// print any amount with toFixed(2) and no formatter, on any of those screens.
// Proven red on 21a4644 (the PR says how).
const { build, wipe } = require("./fixture-p567");
const B = require("./browser-p567");

// A money-shaped decimal with nothing money-like in front of it. Not a
// percentage, not part of a version or a date, not hours or miles.
const BARE = /(?<![$\d.,:/\w-])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?![\d.%]|\s*(?:%|hours?|hrs?|miles?|x\b))/g;
function bareAmounts(text) {
  const hits = [];
  for (const m of String(text).matchAll(BARE)) hits.push(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10).replace(/\s+/g, " "));
  return hits;
}

module.exports = async function part5(h) {
  const { ok, api } = h;
  const f = await build(h);
  try {
    // §close — the read behind the banner.
    const r = await api("GET", `/reports/bookkeeper?from=${f.lastMonth.from}&to=${f.lastMonth.to}`, f.tok);
    const issues = (r.body && r.body.issues) || [];
    const by = k => issues.find(i => i.key === k) || {};
    ok("§close the month-close read answers", r.status === 200, r.status);
    ok("§close no payment method reads in dollars: 3 gifts, $87.50",
      by("no_method").count === 3 && by("no_method").display === "$87.50" && by("no_method").label === "with no payment method", by("no_method"));
    ok("§close a check is called a check, with its dollars: 2 checks with no number ($7,647.00)",
      by("no_check_number").count === 2 && by("no_check_number").noun === "check" && by("no_check_number").display === "$7,647.00", by("no_check_number"));
    const sentence = String((r.body && r.body.issueSentence) || "");
    ok("§close the sentence carries only formatted money", /\(\$87\.50\)/.test(sentence) && /2 checks with no number \(\$7,647\.00\)/.test(sentence) && !bareAmounts(sentence).length, sentence);
    ok("§close …and no British spelling reaches it", !/cheque/i.test(sentence), sentence);

    // §bare — the main screens, as rendered.
    const b = await B.open(h, "§bare");
    if (!b) return;
    try {
      const { ctx, page } = await b.signedIn(f.ADMIN);
      const screens = [
        ["Home", "/dashboard"], ["Donors", "/app/donors"], ["a donor profile", "/donors/d_p567_1"],
        ["Reports", "/app/reports?report=giving-summary"], ["the 3-year comparison", "/app/reports?report=three-year"],
        ["Finance", "/app/finance"], ["the month close", "/app/finance?subtab=close"],
      ];
      for (const [name, path] of screens) {
        await page.goto(b.APP + path, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const text = await page.evaluate(() => document.body.innerText);
        const hits = bareAmounts(text);
        ok(`§bare ${name}: no money printed without a dollar sign`, text.length > 200 && hits.length === 0, hits.length ? hits.slice(0, 5) : text.length);
        if (name === "the month close") {
          const banner = await page.locator('[data-testid="close-issues"]').innerText({ timeout: 10000 }).catch(() => "");
          ok("§bare the month-close banner reads \"3 gifts with no payment method ($87.50)\"", /3 gifts with no payment method \(\$87\.50\)/.test(banner), banner);
        }
      }
      await ctx.close();
    } finally { await b.browser.close(); }
  } finally { await wipe(h.q); }
};
module.exports.bareAmounts = bareAmounts;

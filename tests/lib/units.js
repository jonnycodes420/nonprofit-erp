// tests/lib/units.js: FIX-60. A NUMBER IS THE RIGHT KIND OF NUMBER.
//
// SWEEP-5 found two wrong numbers every test had passed: "Your top 50 donors
// gave $50" (a head count drawn as dollars) and a $400 fee on a $400 gift (the
// gross read into the fee column). The truth check proved screens agreed with
// each other; nothing asked whether a number was money or a count. These rules
// do, and assertSurfacesAgree (the API) and smoke-walk (the screen) both read
// them:
//
//   unitOfMeasure   a source's measure says what its figure is: "sum" (and a
//                   difference, an average per gift) is money, "count" a count
//   figureProblems  one figure as a screen or a report draws it: drawn as
//                   money, it opens a money source and shows a currency sign;
//                   drawn as a count, it opens a count and shows none
//   footProblems    a figure against its own rows: a total of money is the
//                   sum of its rows' money, a count is the number of its rows
//   feeProblems     a gift's money: a processing fee is less than its gift,
//                   and net is gross less the fee
//
// Each returns a list of sentences (empty when the number is right), so a
// caller can say where it looked ("Reports › top-donors: ...").
"use strict";

// A sum, a difference or an average per gift adds up the rows' amounts, which
// are money unless the source says its amounts are something else (hours).
const SUMS = new Set(["sum", "difference", "per_gift", "mean"]);
function unitOfMeasure(measure, amountKind = "money") {
  if (SUMS.has(measure)) return amountKind || "money";
  if (measure === "count") return "count";
  if (measure === "ratio") return "percent";
  return null;   // a measure this file does not know ("avg"): no claim either way
}

const CURRENCY = /[$€£]/;
// fig: { label, kind ("money" | "count" | "percent"), shown (the words drawn),
//        measure and amountKind (what its source said it counts), requested
//        (the measure the caller asked the source for, when it asked) }
function figureProblems(fig) {
  const out = [];
  const name = fig.label || fig.sourceKey || "a figure";
  const unit = unitOfMeasure(fig.measure, fig.amountKind);
  // A source may answer "mean" as its own "per_gift": both are money. What
  // must not change is the unit: asked for a sum, it may not count heads.
  if (fig.requested && fig.measure && unitOfMeasure(fig.requested) && unitOfMeasure(fig.requested) !== unitOfMeasure(fig.measure, "money"))
    out.push(`${name}: asked its source for ${fig.requested} (${unitOfMeasure(fig.requested)}) and got ${fig.measure} (${unitOfMeasure(fig.measure, "money")})`);
  if (fig.kind === "money" && unit && unit !== "money")
    out.push(`${name}: drawn as money but its source counts ${fig.measure === "count" ? "rows (a head count)" : fig.measure}`);
  if (fig.kind === "count" && unit === "money")
    out.push(`${name}: drawn as a count but its source adds up money (${fig.measure})`);
  if (fig.shown != null && fig.shown !== "None yet") {
    if (fig.kind === "money" && !CURRENCY.test(fig.shown)) out.push(`${name}: money drawn without a currency sign ("${fig.shown}")`);
    if (fig.kind !== "money" && CURRENCY.test(fig.shown)) out.push(`${name}: a ${fig.kind || "count"} drawn with a currency sign ("${fig.shown}")`);
  }
  return out;
}

const cents = v => Math.round(Number(v || 0) * 100);
// src: a /figures/:key/rows answer with every row (rows.length === totalRows).
// A row's money is its amount; a figure whose rows were cut short is not footed.
function footProblems(name, src) {
  if (!src || !Array.isArray(src.rows) || src.rows.length < (Number(src.totalRows) || 0)) return [];
  const unit = unitOfMeasure(src.measure, src.amountKind);
  if (src.measure === "sum") {
    const rowsCents = src.rows.reduce((n, r) => n + cents(r.amount), 0);
    const got = src.cents != null ? Number(src.cents) : cents(src.value);
    if (got !== rowsCents) return [`${name}: a total of ${(got / 100).toFixed(2)} over rows that add to ${(rowsCents / 100).toFixed(2)}`];
  }
  if (unit === "count") {
    if (Number(src.value) !== src.rows.length) return [`${name}: a count of ${src.value} over ${src.rows.length} rows`];
    if (src.cents != null && Number(src.cents) !== 0 && Number(src.cents) !== Number(src.value) * 100)
      return [`${name}: a count that carries cents (${src.cents})`];
  }
  return [];
}

// rows: [{ what, gross, fee, net }] in cents (fee or net may be null when
// the row has none). A fee equal to (or above) its gift fails, as does a net
// that is not gross less fee.
function feeProblems(rows) {
  const out = [];
  for (const r of rows || []) {
    const g = Number(r.gross), f = r.fee == null ? null : Number(r.fee), n = r.net == null ? null : Number(r.net);
    if (!Number.isFinite(g)) continue;
    if (f != null && f !== 0) {
      if (f < 0) out.push(`${r.what || "a gift"}: a negative fee (${f})`);
      else if (g > 0 && f >= g) out.push(`${r.what || "a gift"}: a fee of $${(f / 100).toFixed(2)} on a $${(g / 100).toFixed(2)} gift`);
    }
    if (n != null && n !== g - (f || 0)) out.push(`${r.what || "a gift"}: net $${(n / 100).toFixed(2)} is not $${(g / 100).toFixed(2)} less a $${((f || 0) / 100).toFixed(2)} fee`);
  }
  return out;
}

// "$1,234.56" / "-$4.50" / "($4.50)" / "" → cents, or null for no money.
function centsOfText(t) {
  const s = String(t == null ? "" : t).trim();
  if (!s || !/\d/.test(s)) return null;
  const neg = /^-|^\(|−/.test(s);
  const v = Math.round(Number(s.replace(/[^\d.]/g, "")) * 100);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

// THE SCREEN. Every <Figure> drawn on the page (data-figure), as the page
// draws it, with what its source says it counts. `ask(path)` returns a
// /figures answer (the caller's API, signed in). Reads at most `max` sources.
async function figuresOnPage(page, ask, { max = 40 } = {}) {
  const figs = await page.evaluate(() => [...document.querySelectorAll("[data-figure][data-kind]")]
    .filter(el => el.offsetParent !== null || el.tagName === "circle")
    .map(el => ({ label: el.getAttribute("data-figure"), kind: el.getAttribute("data-kind"), shown: el.getAttribute("data-shown"),
                  sourceKey: el.getAttribute("data-source-key"), params: el.getAttribute("data-source-params") })));
  const seen = new Map();
  const problems = [];
  for (const f of figs) {
    if (f.sourceKey && seen.size < max) {
      const key = `${f.sourceKey}?${f.params || ""}`;
      if (!seen.has(key)) {
        let p = {};
        try { p = f.params ? JSON.parse(f.params) : {}; } catch { p = {}; }
        const qs = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
        seen.set(key, await ask(`/figures/${encodeURIComponent(f.sourceKey)}/rows?${qs}${qs ? "&" : ""}pageSize=1`).catch(() => null));
      }
      const src = seen.get(key);
      f.measure = src && src.measure;
      f.amountKind = src && src.amountKind;
      f.requested = (() => { try { return (JSON.parse(f.params || "{}") || {}).measure; } catch { return undefined; } })();
    }
    problems.push(...figureProblems(f));
  }
  return { figures: figs.length, sources: seen.size, problems: [...new Set(problems)] };
}

// Every table on the page with a processing fee column, read as drawn: each
// row's gift, fee and net (when the table has a net column).
async function feeTablesOnPage(page) {
  const tables = await page.evaluate(() => [...document.querySelectorAll("table")].map(t => {
    const heads = [...t.querySelectorAll("th")].map(h => h.textContent.trim().toLowerCase());
    const fi = heads.findIndex(h => /^(processing )?fees?\b/.test(h)), ai = [/^amount\b/, /^gross\b/, /^gift( amount)?$/].map(re => heads.findIndex(h => re.test(h))).find(i => i >= 0) ?? -1, ni = heads.findIndex(h => /^net\b/.test(h));
    if (fi < 0 || ai < 0) return null;
    return [...t.querySelectorAll("tbody tr")].map(tr => [tr.children[ai], tr.children[fi], ni >= 0 ? tr.children[ni] : null].map(c => (c ? c.textContent.trim() : null)));
  }).filter(Boolean));
  const rows = [];
  tables.forEach((t, ti) => t.forEach(([a, f, n], i) => rows.push({ what: `table ${ti + 1} row ${i + 1}`, gross: centsOfText(a), fee: f === null ? null : Math.abs(centsOfText(f) || 0), net: n === null ? null : centsOfText(n) })));
  return { rows: rows.length, problems: feeProblems(rows.filter(r => r.gross != null)) };
}

module.exports = { unitOfMeasure, figureProblems, footProblems, feeProblems, centsOfText, figuresOnPage, feeTablesOnPage };

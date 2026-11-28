// tests/lib/reports6Checks.js · REPORTS-6 item 5. THE BOARD VIEW, THE DECK, THE DECK'S PDF, THE DASHBOARD TILE AND THE REPORT SAY ONE NUMBER.
//
// For each figure this build puts in front of a board or a new director:
//   · giving this fiscal year so far, and the same point last year: the Board
//     view's tiles = the board deck = the number printed beside its own label
//     in the deck's PDF = the rows its source opens;
//   · retention: the Board view = the deck = the deck's PDF;
//   · the same point last year: the Board view = the giving summary report =
//     Your dashboard's tile;
//   · LYBUNT: the report = Your dashboard's tile = the deck's "Call" count;
//   · the thank-you backlog: the Acknowledgment backlog report = the tile =
//     the deck's "Thank" count = the rows they open.
// A figure is pinned to its OWN label in the PDF (REPORTS-3's lesson: "somewhere
// on the page" was satisfied by an equal total elsewhere).
"use strict";

function pdfText(buf) {
  const raw = buf.toString("latin1");
  const runs = [];
  const unesc = t => t.replace(/\\([()\\])/g, "$1");
  const hex = h => Buffer.from(h.replace(/[^0-9a-fA-F]/g, ""), "hex").toString("latin1");
  const arr = /\[((?:<[0-9a-fA-F\s]*>|\((?:\\.|[^\\()])*\)|[-\d.\s])*)\]\s*TJ/g;
  let m;
  while ((m = arr.exec(raw)) !== null) {
    let out = "";
    const piece = /<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\()])*)\)/g;
    let p;
    while ((p = piece.exec(m[1])) !== null) out += p[1] !== undefined ? hex(p[1]) : unesc(p[2]);
    if (out) runs.push(out);
  }
  const one = /(?:<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\()])*)\))\s*Tj/g;
  while ((m = one.exec(raw)) !== null) runs.push(m[1] !== undefined ? hex(m[1]) : unesc(m[2]));
  // pdfkit's standard fonts write WinAnsi: its quotes and dashes are not latin1's.
  const WIN = { "\x91": "\u2018", "\x92": "\u2019", "\x93": "\u201c", "\x94": "\u201d", "\x95": "\u2022", "\x96": "\u2013", "\x97": "\u2014" };
  return runs.map(r => r.replace(/[\x91-\x97]/g, c => WIN[c]));
}
const cents = v => (v === null || v === undefined ? null : Math.round(Number(v) * 100));
const money = c => (c === null || c === undefined ? "blank" : `$${(c / 100).toFixed(2)}`);
const printed = (kind, v) => (v === null || v === undefined ? "None yet"
  : kind === "money" ? "$" + (Math.round(Number(v) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : kind === "percent" ? `${v}%` : Number(v).toLocaleString("en-US"));
// The value printed right after its own label, in the PDF's text runs.
function printedBeside(runs, label) {
  // A page's title can be the figure's own label ("Retention"): the figure is the label whose next run is not the label again.
  const i = runs.findIndex((r, j) => r === label && runs[j + 1] !== label);
  return i >= 0 ? runs[i + 1] : undefined;
}

async function reports6Checks({ get, raw, agree, skip }) {
  if (skip && skip.has("reports6")) return;
  const [board, deck, yd, gs, ret, ack, pdfR] = await Promise.all([
    get("/dashboards/board").catch(() => null), get("/board-deck").catch(() => null), get("/your-dashboard").catch(() => null),
    get("/reports/giving-summary?yearMode=fiscal").catch(() => null), get("/reports/retention?yearMode=fiscal").catch(() => null),
    get("/saved-reports/std:ack-backlog/run").catch(() => null), raw("/board-deck/pdf").catch(() => null),
  ]);
  if (!board || !board.metrics || !deck || !deck.pages) return;
  const runs = pdfR && pdfR.status === 200 ? pdfText(pdfR.buf) : [];
  const metric = k => board.metrics.find(m => m.key === k) || null;
  const page = k => deck.pages.find(p => p.key === k) || null;
  const tile = k => (yd && yd.tiles || []).find(t => t.key === k) || null;
  const rowsValue = async source => {
    if (!source) return undefined;
    const qs = new URLSearchParams({ ...source.params, pageSize: "1" }).toString();
    const r = await get(`/figures/${encodeURIComponent(source.key)}/rows?${qs}`).catch(() => null);
    return r ? r.value : undefined;
  };

  // Giving this year so far, the same point last year, and retention: the board view's tiles, as the deck draws them.
  const ytd = page("ytd"), retPage = page("retention");
  for (const [key, fig, kind] of [["revenueThisYear", ytd && ytd.figures[0], "money"], ["revenueLastYear", ytd && ytd.figures[1], "money"],
    ["retentionRate", retPage && retPage.figures[0], "percent"]]) {
    const m = metric(key);
    if (!m) continue;
    const asNum = v => (kind === "money" ? cents(v) : v);
    agree(`reports6 ${m.label}`, [["the Board view", asNum(m.value)], ["the board deck", fig ? asNum(fig.value) : undefined],
      ["the rows it opens", m.source && m.value !== null ? asNum(await rowsValue(m.source)) : undefined]], kind === "money" ? money : String);
    if (runs.length && fig) agree(`reports6 ${m.label}, printed in the deck`, [["the Board view", printed(kind, m.value)], ["the deck's PDF, beside its label", printedBeside(runs, fig.label)]]);
  }
  // The same point last year: the Board view = the giving summary = Your dashboard's tile.
  const giving = tile("giving");
  if (gs && gs.comparison) {
    agree("reports6 the same point last year", [["the Board view", cents((metric("revenueLastYear") || {}).value)], ["the giving summary report", cents(gs.comparison.value)],
      ["Your dashboard's tile", giving && giving.figures[1] ? cents(giving.figures[1].value) : undefined]], money);
    agree("reports6 giving this fiscal year (the report's period)", [["the giving summary report", cents(gs.figures && gs.figures.total && gs.figures.total.value)],
      ["Your dashboard's tile", giving && giving.figures[0] ? cents(giving.figures[0].value) : undefined]], money);
  }
  // Retention as the report states it (its last row with a rate) = the tile.
  const rt = tile("retention");
  const lastRow = ret && [...(ret.rows || [])].reverse().find(r => r.retentionRate !== null);
  if (lastRow) agree("reports6 retention, the report's last whole year", [["the retention report", lastRow.retentionRate], ["Your dashboard's tile", rt && rt.figures[0] ? rt.figures[0].value : undefined]]);
  // LYBUNT: the report = the tile = the deck's Call count.
  const fy = gs && gs.fiscalYear;
  const lyb = fy ? await get(`/reports/lybunt?year=${fy}&yearMode=fiscal`).catch(() => null) : null;
  const call = page("thankOrCall");
  if (lyb && lyb.figures && lyb.figures.people) {
    agree("reports6 LYBUNT", [["the LYBUNT report", lyb.figures.people.value], ["Your dashboard's tile", tile("lybunt") && tile("lybunt").figures[0] ? tile("lybunt").figures[0].value : undefined],
      ["the board deck's Call", call && call.right.figure ? call.right.figure.value : undefined], ["the rows it opens", await rowsValue(lyb.figures.people.source)]]);
  }
  // The thank-you backlog: the report = the tile = the deck's Thank = its rows.
  if (ack && ack.figures && ack.figures.count) {
    const t = tile("ack-backlog");
    agree("reports6 gifts not yet thanked", [["the Acknowledgment backlog report", ack.figures.count.value], ["Your dashboard's tile", t && t.figures[0] ? t.figures[0].value : undefined],
      ["the board deck's Thank", call ? call.left.figure.value : undefined], ["the rows it opens", await rowsValue(ack.figures.count.source)]]);
    if (runs.length && call) agree("reports6 gifts not yet thanked, printed in the deck", [["the report", printed("count", ack.figures.count.value)], ["the deck's PDF, beside its label", printedBeside(runs, call.left.figure.label)]]);
  }
}

module.exports = { reports6Checks, pdfText };

// server/onboard/sheetVerify.js · ONBOARD-1. THE FILE'S OWN FIGURES, FROM THE
// SPREADSHEET READER'S PLAN, taken inside the import's transaction and stored
// on the run (summary_json.verifyFile). Never recomputed: the file is gone.
//
// The money equation is the reader's own (FIX-52: rows in the file = gifts +
// pledges + set aside), so the Verify page can say where every dollar went:
//   file = gift rows + pledges + set-aside rows
//   held = gifts written (gift rows + paid first years of pledges)
//   file - held = set aside (by reason, by line) + already in Steward (by line)
//                 + pledged and not yet given
"use strict";

function fileFacts({ u, personId, dupLines, duplicateCents, pledgeCents, installmentCents, pick = 10, random = Math.random }) {
  const giftRows = u.gifts.filter(g => g.kind !== "installment");
  const allGifts = u.gifts;
  const asideCents = u.aside.reduce((n, x) => n + (x.cents || 0), 0);
  const fileCents = giftRows.reduce((n, g) => n + g.cents, 0) + u.pledges.reduce((n, p) => n + p.pledgeCents, 0) + asideCents;
  const fileGiftCents = allGifts.reduce((n, g) => n + g.cents, 0);
  const byYear = new Map(), byFund = new Map(), byPerson = new Map();
  for (const g of allGifts) {
    const y = g.date ? Number(String(g.date).slice(0, 4)) : null;
    if (y) byYear.set(y, (byYear.get(y) || 0) + g.cents);
    const fname = String(g.fund || "").trim() || "(no fund named)";
    const f = byFund.get(fname.toLowerCase()) || { name: fname, cents: 0, gifts: 0 };
    f.cents += g.cents; f.gifts++; byFund.set(fname.toLowerCase(), f);
    const id = personId.get(g.personKey);
    if (!id) continue;
    if (!byPerson.has(id)) byPerson.set(id, []);
    byPerson.get(id).push({ date: g.date || null, cents: g.cents, fund: g.fund || null, line: g.line });
  }
  const names = new Map(u.people.map(p => [personId.get(p.key), p.name || p.email || ""]));
  const ids = [...byPerson.keys()];
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  // The gaps, each one the rows that make it up.
  const reasons = new Map();
  for (const a of u.aside) {
    const r = reasons.get(a.reason) || { reason: a.reason, rows: 0, cents: 0, lines: [] };
    r.rows++; r.cents += a.cents || 0; if (r.lines.length < 50) r.lines.push(a.line); reasons.set(a.reason, r);
  }
  const gaps = [...reasons.values()].map(r => ({ bucket: "set aside", reason: r.reason, words: r.reason, rows: r.rows, cents: r.cents, lines: r.lines }));
  if (dupLines && dupLines.size) gaps.push({ bucket: "already in Steward", reason: "duplicate", words: "already in Steward", rows: dupLines.size,
    cents: duplicateCents, lines: [...dupLines].slice(0, 50).map(k => Number(k.slice(k.lastIndexOf(":") + 1))) });
  const pledgedOpen = Math.max(0, pledgeCents - installmentCents);
  if (pledgedOpen) gaps.push({ bucket: "pledged", reason: "pledged_not_given", words: "pledged and not yet given (a promise, not a gift)",
    rows: u.pledges.length, cents: pledgedOpen, lines: u.pledges.slice(0, 50).map(p => p.line) });
  return {
    source: "sheet",
    fileCents, fileGiftCents,
    people: u.people.length, gifts: allGifts.length,
    byYear: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, cents]) => ({ year, cents })),
    byFund: [...byFund.values()],
    gaps,
    spot: ids.slice(0, pick).map(id => ({ key: id, byId: true, name: names.get(id) || "", rows: byPerson.get(id).slice(0, 200) })),
  };
}

module.exports = { fileFacts };

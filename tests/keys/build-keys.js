#!/usr/bin/env node
// tests/keys/build-keys.js: TRUTH-1. THE REAL-SHAPED FILES' KEYS, FROM THEIR CELLS.
//
//   node tests/keys/build-keys.js          write tests/keys/*.key.json
//   node tests/keys/build-keys.js --check  exit 1 if a committed key differs
//
// Each key is computed from the fixture's own cells by the definitions in
// tests/keys/truthKey.js, read with SheetJS (a parser, not app code; the same
// one tests/real-shaped.test.js reads the files with). Nothing here imports
// the app. The file's rows are turned into the key's plain rows the way a
// person reading the sheet would: a row's donor (or its ID) is a party, a
// positive amount is a gift, a negative or zero row is set aside (never a
// gift; the gift file's key says each), "Not yet received" is a pledge, and
// the guest list's Yes/No columns say who came. The keys are committed; the
// truth check (tests/lib/surfacesAgree.js, ctx.fileKey) holds the org to them.
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));
const { computeKey, toJson } = require("./truthKey");

const FX = path.join(__dirname, "..", "fixtures", "import", "real-shaped");
const OUT = __dirname;
const centsOf = v => Math.round(Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")) * 100);
const yes = v => /^yes$/i.test(String(v || "").trim());
const sheet = (file, name) => {
  const wb = XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[name || wb.SheetNames[0]], { defval: null });
};
// A cell date as its civil day. SheetJS hands a dated cell back as local
// midnight of that day, so the day is read in local time, never as UTC.
const dayOf = v => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const norm = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// THE GIFT HISTORY (jp-gift-history-287): a row is a gift by a named donor.
function giftHistory() {
  const F = "jp-gift-history-287.xlsx";
  const R = sheet(F);
  const people = [...new Set(R.map(r => norm(r.Donor)).filter(Boolean))].map(id => ({ id }));
  const all = R.map((r, i) => ({ id: `r${i + 2}`, person: norm(r.Donor), cents: centsOf(r.Amount), date: dayOf(r.Date) }));
  const gifts = all.filter(g => g.cents > 0);
  const setAside = all.filter(g => g.cents <= 0);
  const k = computeKey({ people, gifts }, { today: "2026-11-02", fiscalStartMonth: 7 });
  const byCalendarYear = {};
  for (const g of gifts) { const y = g.date.slice(0, 4); byCalendarYear[y] = (byCalendarYear[y] || 0) + g.cents; }
  // `names` is not compared as people: the importer rightly folds a name's
  // variants ("Mr & Mrs. X" and "X") into one person, which a key read from
  // the cells cannot know without becoming the importer.
  return { file: F, rows: R.length, names: k.units, gifts: { count: k.gifts.count, cents: k.gifts.cents },
    setAside: { count: setAside.length, cents: setAside.reduce((n, g) => n + g.cents, 0) },
    net: k.gifts.cents + setAside.reduce((n, g) => n + g.cents, 0), byCalendarYear };
}

// FINDING JOY (jp-finding-joy-combined-443): People is the guest list, one row
// a party (a couple's row is one); Gifts holds each party's gift by ID,
// "Received" money and "Not yet received" a pledge, all made at the dinner.
function findingJoy() {
  const F = "jp-finding-joy-combined-443.xlsx";
  const P = sheet(F, "People"), G = sheet(F, "Gifts");
  const EV = "Finding Joy Dinner";
  const rows = {
    people: P.map(r => ({ id: r.ID })),
    gifts: G.filter(g => g.Status === "Received").map((g, i) => ({ id: `g${i}`, person: g.ID, cents: centsOf(g.Amount), date: "2026-10-22", event: EV })),
    pledges: G.filter(g => g.Status === "Not yet received").map((g, i) => ({ id: `p${i}`, person: g.ID, cents: centsOf(g.Amount), status: "open", event: EV })),
    attendance: P.filter(r => yes(r.Invited) || yes(r.Attended)).map(r => ({ id: r.ID, event: EV, person: r.ID,
      status: yes(r.Attended) ? "attended" : yes(r.RSVP) ? "registered" : "invited" })),
  };
  const k = computeKey(rows, { today: "2026-11-02", fiscalStartMonth: 7 });
  const e = k.events[EV];
  return { file: F, rows: P.length, units: k.units, gifts: { count: k.gifts.count, cents: k.gifts.cents },
    pledged: rows.pledges.reduce((n, p) => n + p.cents, 0),
    events: { [EV]: { invited: P.filter(r => yes(r.Invited)).length, came: e.came.parties, gave: e.gave.parties, cameGave: e.cameGave.parties, cameNoGift: e.cameNoGift.parties } } };
}

// THE DINNER FILE (jp-dinner-gifts-106): no dates; the last row is the totals
// row (no name), never a person or a gift. Completed Yes is a gift.
function dinner() {
  const F = "jp-dinner-gifts-106.xlsx";
  const R = sheet(F).filter(r => String(r.Last || "").trim() || String(r.First || "").trim());
  const received = R.filter(r => /^yes$/i.test(String(r.Completed || "").trim()));
  const notYet = R.filter(r => /^no$/i.test(String(r.Completed || "").trim()));
  return { file: F, rows: R.length, received: { count: received.length, cents: received.reduce((n, r) => n + centsOf(r.Amount), 0) },
    notYetReceived: { count: notYet.length, cents: notYet.reduce((n, r) => n + centsOf(r.Amount), 0) } };
}

const KEYS = { "gift-history-287": giftHistory, "finding-joy-443": findingJoy, "dinner-106": dinner };
if (require.main === module) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const [name, fn] of Object.entries(KEYS)) {
    const file = path.join(OUT, `${name}.key.json`);
    const text = JSON.stringify(fn(), null, 2) + "\n";
    if (check) {
      const ok = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
      if (!ok) { bad++; console.log(`  DIFFERS  ${name}.key.json (run node tests/keys/build-keys.js)`); } else console.log(`  same     ${name}.key.json`);
    } else { fs.writeFileSync(file, text); console.log(`  wrote    ${name}.key.json`); }
  }
  process.exit(bad ? 1 : 0);
}
module.exports = { KEYS, load: name => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.key.json`), "utf8")) };

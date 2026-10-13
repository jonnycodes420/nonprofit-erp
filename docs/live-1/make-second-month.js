// docs/live-1/make-second-month.js · LIVE-1. "Last month's file" for the walk.
//
// The same headers as steward-test-1000-donors-messy.csv, and rows for people
// already in that file: six whose last gift there is more than a year old
// give again, four give more than they ever have, and ten people are new.
// Every gift is dated in the last two weeks. Deterministic for a given day.
//
//   node docs/live-1/make-second-month.js <messy.csv> <out.csv>
const fs = require("fs");

function parseCsv(t) {
  const rows = []; let row = [], cell = "", qd = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (qd) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else qd = false; } else cell += c; }
    else if (c === '"') qd = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c; }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const mdy = d => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const [src, out] = process.argv.slice(2);
const all = parseCsv(fs.readFileSync(src, "utf8").replace(/^﻿/, ""));
const headerAt = all.findIndex(r => r.includes("Constituent ID"));
const headers = all[headerAt];
const rows = all.slice(headerAt + 1).filter(r => r.some(c => String(c).trim()));
const col = n => headers.indexOf(n);
const parseDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim()); return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null; };
const byId = new Map();
for (const r of rows) {
  const id = String(r[col("Constituent ID")] || "").trim();
  if (!/^D\d+$/.test(id)) continue;
  const d = parseDate(r[col("Gift Date")]), amt = Number(String(r[col("Gift Amount")] || "").replace(/[$,]/g, ""));
  if (!byId.has(id)) byId.set(id, { row: r, last: null, max: 0 });
  const p = byId.get(id);
  if (d && (!p.last || d > p.last)) p.last = d;
  if (amt > p.max) p.max = amt;
}
const yearAgo = daysAgo(400);
const people = [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const lapsed = people.filter(([, p]) => p.last && p.last < yearAgo && String(p.row[col("E-mail Address")] || "").includes("@")).slice(0, 6);
const recent = people.filter(([, p]) => p.last && p.last >= yearAgo && p.max > 0 && String(p.row[col("E-mail Address")] || "").includes("@")).slice(0, 4);
const outRows = [];
let gid = 900000;
const giftRow = (base, date, amount, fund = "General Fund") => {
  const r = headers.map((h, i) => base[i] ?? "");
  r[col("Gift Date")] = mdy(date); r[col("Gift Amount")] = String(amount); r[col("Fund/Designation")] = fund;
  r[col("Payment Type")] = "CHK"; r[col("Check #")] = String(1000 + (gid % 1000)); r[col("Gift ID")] = `G${gid++}`;
  r[col("Notes")] = "";
  return r;
};
lapsed.forEach(([, p], i) => outRows.push(giftRow(p.row, daysAgo(6 + i), 80 + i * 10)));
recent.forEach(([, p], i) => outRows.push(giftRow(p.row, daysAgo(4 + i), Math.round(p.max * 3 + 500))));
const NEW = [["Amara", "Okonkwo"], ["Felix", "Brandt"], ["Grace", "Liu"], ["Hector", "Salas"], ["Imogen", "Park"],
             ["Jonah", "Weiss"], ["Keiko", "Tanaka"], ["Luis", "Moreno"], ["Mira", "Kapoor"], ["Noah", "Bennett"]];
NEW.forEach(([f, l], i) => {
  const base = headers.map(() => "");
  base[col("Constituent ID")] = `D9${String(1000 + i)}`; base[col("First Name")] = f; base[col(" Last name")] = l;
  base[col("E-mail Address")] = `${f.toLowerCase()}.${l.toLowerCase()}@example.com`;
  outRows.push(giftRow(base, daysAgo(2 + (i % 9)), [40, 75, 100, 250, 500, 35, 60, 150, 1000, 25][i]));
});
fs.writeFileSync(out, [headers.map(csvCell).join(","), ...outRows.map(r => r.map(csvCell).join(","))].join("\n") + "\n");
console.log(`wrote ${outRows.length} rows to ${out}: ${lapsed.length} lapsed giving again, ${recent.length} biggest-ever, ${NEW.length} new`);

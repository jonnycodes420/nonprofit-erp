#!/usr/bin/env node
// DEVBOARD-1 · the board by hand (ops/board.json). Dry run unless --write.
//
//   node scripts/ops/board.js add C-Allie-grant-payment --source customer --customer "Justin's Place" --words "…" [--build GIFTS-1]
//   node scripts/ops/board.js assign W-1105-Prof4 PEOPLE-2
//   node scripts/ops/board.js close <BRIEF> <report.md>     the report's "Closes: W-…, C-…" line
//
// Close on the build's own branch, before its PR: the merge carries the items
// to fixed on main, and the next walk that passes them makes them verified.
"use strict";
const fs = require("fs");
const B = require("../../server/admin/board");

const [cmd, ...rest] = process.argv.slice(2);
const flag = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
const pos = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--") && rest[i - 1] !== "--write"));
const boardFile = flag("--board") || B.BOARD_PATH;
const today = flag("--date") || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const board = B.readBoard(boardFile);
let next = board;

if (cmd === "add") {
  const [id] = pos;
  const source = flag("--source") || (id && id.startsWith("C-") ? "customer" : "build follow-up");
  if (!id || !flag("--words")) { console.error("add needs an id and --words"); process.exit(64); }
  if (board.items.some(i => i.id === id)) { console.error(`${id} is already on the board`); process.exit(65); }
  next = JSON.parse(JSON.stringify(board));
  next.items.push({ id, source, check: null, words: flag("--words"), build: flag("--build") || null, state: "open",
    customer: flag("--customer") || null, opened: today, fixedBy: null, history: [{ on: today, state: "open", by: "added by hand" }] });
  console.log(`add ${id} (${source})`);
} else if (cmd === "assign") {
  const [id, build] = pos;
  next = JSON.parse(JSON.stringify(board));
  const it = next.items.find(i => i.id === id);
  if (!it || !build) { console.error(`assign needs a board id and a build (${id} ${it ? "found" : "not found"})`); process.exit(65); }
  it.build = build; console.log(`assign ${id} → ${build}`);
} else if (cmd === "close") {
  const [build, report] = pos;
  if (!build || !report) { console.error("close needs <BRIEF> <report.md>"); process.exit(64); }
  const ids = B.closesIn(fs.readFileSync(report, "utf8"));
  if (!ids.length) { console.error(`No "Closes: W-…, C-…" line in ${report}.`); process.exit(65); }
  const r = B.closeItems(board, ids, { build, date: today });
  next = r.board;
  console.log(`close ${build}: ${r.done.length} to fixed${r.done.length ? " (" + r.done.join(", ") + ")" : ""}${r.missing.length ? ` · not on the board: ${r.missing.join(", ")}` : ""}${r.recorded && r.recorded.length ? ` · recorded for items uploaded on /ops: ${r.recorded.join(", ")}` : ""}`);
} else { console.error("usage: board.js add|assign|close …"); process.exit(64); }

const problems = B.validate(next);
if (problems.length) { console.error(problems.join("\n")); process.exit(65); }
if (rest.includes("--write")) { B.writeBoard(next, boardFile); console.log("Wrote the board."); }
else console.log("Dry run: nothing written. Add --write to save.");

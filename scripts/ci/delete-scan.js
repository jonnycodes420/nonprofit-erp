#!/usr/bin/env node
// scripts/ci/delete-scan.js · TRASH-1 item 3. EVERY DELETE WITH MONEY OR PEOPLE GOES THROUGH removal.js.
//
// About a dozen `app.delete(` routes hard-deleted a row that carried money or
// people and named nothing that hung off it (a grant took its deadlines and
// notes with it and left its gift and pledge live on the funder). Now each
// answers through the one remove (routes/removal.js removeThrough, a kind in
// removal.js), or through the person trash (personTrash.trashPeople) or the
// row trash (trashRow), so the confirm names what is attached and Undo puts
// it back.
//
// This scan fails on a NEW `app.delete(` route whose handler runs `DELETE FROM`
// a table with money or person ids and goes through none of those. "Money or
// person ids" is read from the schema (server/db/ddl/*.js): a table with a
// donor_id, person_id, funder_donor_id, gift_id, pledge_id, grant_id or an
// amount column, plus the few named below. The routes that do so today for a
// reason are allowlisted with that reason; a new one needs a line here and a
// reviewer who agrees.
//
// Proven able to fail: plant `app.delete("/x/:id", …, run("DELETE FROM gifts …"))`
// in any routes file and it exits 1 naming the line (the --self-test flag does
// exactly that against a fixture).
//
// Usage: node scripts/ci/delete-scan.js [--self-test]. Exits 1 and prints file:line.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const MONEY_OR_PEOPLE_COL = /^(donor_id|person_id|funder_donor_id|gift_id|pledge_id|grant_id|amount|target_amount)$/;
const ALSO = new Set(["audiences", "cultivation_templates", "programs", "donors", "grants"]);
// What counts as going through the one remove (or one of the two trashes).
const THROUGH = /removeThrough\(|require\(["'][./]*removal["']\)\.plan|trashRow\(|trashPeople\(/;

// Routes that hard-delete such a row on purpose. "METHOD path": the reason.
const ALLOW = {
  "/gifts/:id": "the one gift delete: refuses while a receipt is live, takes its ledger row, voids its tasks and stops its journeys (gifts.js)",
  "/admin/orgs/:id": "super admin: a whole org, behind its own guard and confirm",
  "/finance/budgets/:id": "a budget line is a plan, not money that moved; nothing hangs off it",
  "/sequences/:id": "a sequence's enrollments go with it; the people and their mail history stay",
  "/donors/:id/screening": "a wealth screening result (prospect.js), re-run at will; the person stays",
  "/screening": "every screening result for the org, on its own confirm",
  "/donors/:id/designations/:kind": "a flag on the person, not a record of its own",
  "/volunteer-qualifications/:id": "a qualification on a volunteer; the person stays",
  "/programs/:id/grants/:grantId": "a link between a program and a grant; both stay",
  "/grants/documents/:docId": "a file on a grant; the grant and its money stay",
  "/grants/spend/:spendId": "a spending line typed against restricted money, on its own confirm (RestrictedView)",
  "/top100/members/:donorId": "a list membership; the person is untouched",
};

function tablesWithMoneyOrPeople() {
  const dir = path.join(ROOT, "server/db/ddl");
  const out = new Set(ALSO);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of s.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\)`?\)?/g)) {
      const cols = m[2].split("\n").map(l => (l.trim().match(/^(\w+)\s/) || [])[1]).filter(Boolean);
      if (cols.some(c => MONEY_OR_PEOPLE_COL.test(c))) out.add(m[1]);
    }
    for (const m of s.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)) if (MONEY_OR_PEOPLE_COL.test(m[2])) out.add(m[1]);
  }
  return out;
}

function files() {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "client", "tests", "scripts", "docs", ".git", ".generated"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) out.push(p);
    }
  };
  walk(ROOT);
  return out;
}

// The handler of each app.delete( in a file: its text up to the next route.
function deletes(text) {
  const out = [];
  const re = /app\.delete\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + 10);
    const next = rest.search(/\n\s*(app\.(get|post|put|patch|delete|use|all)\(|\}\s*\n\s*module\.exports|function \w+\()/);
    out.push({ route: m[1], at: m.index, body: next < 0 ? rest : rest.slice(0, next) });
  }
  return out;
}

function scan(sources, tables) {
  const found = [];
  for (const { file, text } of sources) {
    for (const d of deletes(text)) {
      const hit = [...d.body.matchAll(/DELETE FROM (\w+)/g)].map(x => x[1]).filter(t => tables.has(t));
      if (!hit.length || THROUGH.test(d.body) || ALLOW[d.route]) continue;
      const line = text.slice(0, d.at).split("\n").length;
      found.push(`${path.relative(ROOT, file)}:${line}  DELETE ${d.route} hard-deletes ${[...new Set(hit)].join(", ")} without removal.js`);
    }
  }
  return found;
}

const tables = tablesWithMoneyOrPeople();
if (process.argv.includes("--self-test")) {
  const planted = scan([{ file: path.join(ROOT, "routes/planted.js"),
    text: `app.delete("/planted/:id", requireAuth, wrap(async (req, res) => {\n  await run("DELETE FROM gifts WHERE id=?", [req.params.id]);\n}));\n` }], tables);
  const through = scan([{ file: path.join(ROOT, "routes/planted.js"),
    text: `app.delete("/planted/:id", requireAuth, wrap(async (req, res) =>\n  require("./removal").removeThrough(req, res, "grant", req.params.id)));\n` }], tables);
  if (planted.length !== 1 || through.length !== 0 || !tables.has("gifts") || !tables.has("grants")) {
    console.error("delete-scan self-test FAILED", { planted, through });
    process.exit(1);
  }
  console.log("delete-scan self-test: a planted hard delete of gifts is caught; one through removal.js passes.");
  process.exit(0);
}
const found = scan(files().map(file => ({ file, text: fs.readFileSync(file, "utf8") })), tables);
if (found.length) {
  console.error("TRASH-1 · a delete with money or people must go through removal.js (routes/removal.js removeThrough):\n" + found.join("\n")
    + "\nAdd a kind to removal.js, or, if it truly must hard-delete, an ALLOW line in scripts/ci/delete-scan.js with the reason.");
  process.exit(1);
}
console.log(`delete-scan: every app.delete( that touches money or people (${tables.size} tables) goes through removal.js or is allowlisted.`);

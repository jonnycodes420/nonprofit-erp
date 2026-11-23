#!/usr/bin/env node
// scripts/ci/send-plan-scan.js · SENDS-2. NO LOOP MINTS STAFF CONFIRMS WITHOUT A SEND PLAN.
//
// A staff confirm (sendGate.recordStaffConfirm) is what lets a message past the
// gate as "a person sent this by hand". On 22 Nov a route that looped over 33
// drafts minted 33 confirms in one click. The rule since SENDS-2: a staff send
// to more than one person goes through a send plan (server/mail/sendPlan.js),
// whose commit runs inside confirmScope.under(). This scan fails on:
//
//   1. a call to anything that mints a confirm, inside a loop (for, while,
//      for…of, .forEach, .map, .flatMap, .reduce, Promise.all) and not inside
//      confirmScope.under(…). "Anything that mints" is recordStaffConfirm and,
//      found by name to a fixed point, every function whose body calls one
//      (sendMilestoneDraft, sendDraft, sendHeld, sendVolunteerDraft, …);
//   2. recordStaffConfirm given a list for `to:` (an array, or a .join());
//   3. in the browser (client/src), a loop that presses a send endpoint once per
//      item (apiFetch of a path with "/send" in it, inside a loop): the bulk
//      door the server can't see, as Auctions' "Send all" was.
//
// The run-time half is confirmScope.noteConfirm (a second confirm in one request
// without a plan throws). Usage: node scripts/ci/send-plan-scan.js [--root dir] [file…]
// Exits 1 and prints file:line for each finding.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = (() => { const i = process.argv.indexOf("--root"); return i > 0 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, "../.."); })();
const ONLY = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--root");

function load(name) {
  for (const base of [ROOT, path.join(ROOT, "client"), path.resolve(__dirname, "../.."), path.resolve(__dirname, "../../client")]) {
    try { return require(require.resolve(name, { paths: [base] })); } catch (_) { /* next */ }
  }
  throw new Error(`send-plan-scan: cannot load ${name} (npm ci, and npm ci --prefix client)`);
}
const acorn = load("acorn");
let JsxParser = null;
function jsxParser() {
  if (!JsxParser) JsxParser = acorn.Parser.extend(load("acorn-jsx")());
  return JsxParser;
}

const SERVER_DIRS = ["server", "routes", "shared", "middleware"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".generated", "tests", "__tests__"]);
const LOOP_METHODS = new Set(["forEach", "map", "flatMap", "reduce", "reduceRight"]);
const SEED = "recordStaffConfirm";
// The draft sender reaches the volunteer routes through a seam set at boot
// (registerDraftSender: sendDraft → _sendDraft → sendMilestoneDraft), which no
// name-following can see. They are minters by construction.
const SEAMS = ["sendDraft", "_sendDraft"];
// Names too generic to follow (an object's `send` method is not every `.send(`).
const GENERIC = new Set(["send", "run", "then", "build", "changed", "commit", "mount", "handler", "fn", "next", "wrap", "use", "post", "get", "kind"]);

function walkFiles(dir, out, exts) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(p, out, exts); }
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function parse(file, src) {
  const jsx = /\.jsx$/.test(file);
  const P = jsx ? jsxParser() : acorn.Parser;
  const opts = { ecmaVersion: "latest", locations: true, allowHashBang: true, allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true, allowImportExportEverywhere: true };
  for (const sourceType of ["module", "script"]) {
    try { return P.parse(src, { ...opts, sourceType }); } catch (_) { /* try the other */ }
  }
  return null;
}

// Every node, with its ancestors (nearest last).
function visit(node, fn, stack = []) {
  if (!node || typeof node.type !== "string") return;
  fn(node, stack);
  stack.push(node);
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "start" || k === "end") continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") visit(c, fn, stack); }
    else if (v && typeof v.type === "string") visit(v, fn, stack);
  }
  stack.pop();
}

const calleeName = c => !c ? null : c.type === "Identifier" ? c.name
  : c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" ? c.property.name : null;

// The name a function is known by: function f(){}, const f = () => {}, { f() {} } / { f: () => … }.
function fnName(node, parent) {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (!parent) return null;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
  if (parent.type === "Property" && !parent.computed && parent.key.type === "Identifier") return parent.key.name;
  if (parent.type === "AssignmentExpression" && parent.left.type === "Identifier") return parent.left.name;
  return null;
}
const isFn = n => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";

// Is `node` inside the BODY of a loop (not its test or iterable), with no under() between?
// A function on the way up ends the search unless it is the loop's own callback
// (rows.map(r => send(r)) is a loop; a button's onClick inside rows.map is not).
function loopAround(node, stack) {
  let child = node;
  for (let i = stack.length - 1; i >= 0; i--) {
    const a = stack[i];
    if (isFn(child) && child !== node) {
      const loopCb = a.type === "CallExpression" && a.arguments.includes(child)
        && (LOOP_METHODS.has(calleeName(a.callee)) || calleeName(a.callee) === "all");
      if (!loopCb) return null;
    }
    if (a.type === "CallExpression" && calleeName(a.callee) === "under") return null;
    if ((a.type === "ForStatement" || a.type === "ForOfStatement" || a.type === "ForInStatement"
      || a.type === "WhileStatement" || a.type === "DoWhileStatement") && a.body === child) return a;
    if (a.type === "CallExpression" && a.arguments.includes(child) && isFn(child)) {
      const m = calleeName(a.callee);
      if (LOOP_METHODS.has(m)) return a;
    }
    if (a.type === "CallExpression" && calleeName(a.callee) === "all" && a.callee.object && a.callee.object.name === "Promise") return a;
    child = a;
  }
  return null;
}

// The repo's server files: where every minter is defined, whatever is being reported on.
function repoServerFiles() {
  return SERVER_DIRS.flatMap(d => walkFiles(path.join(ROOT, d), [], [".js", ".mjs", ".cjs"]))
    .concat(fs.readdirSync(ROOT).filter(n => /\.(c|m)?js$/.test(n)).map(n => path.join(ROOT, n)));
}

// Findings for `files`; the minters are learned from `files` and the whole repo.
function scanServer(files) {
  const report = new Set(files.map(f => path.resolve(f)));
  const trees = [];
  for (const f of [...new Set([...files.map(f => path.resolve(f)), ...repoServerFiles()])]) {
    const src = fs.readFileSync(f, "utf8");
    if (!/StaffConfirm|sendMilestoneDraft|sendDraft|sendHeld|sendVolunteerDraft|sendReconnectOne/.test(src)) continue;
    const ast = parse(f, src);
    if (ast) trees.push({ f, ast });
  }
  // The minters, to a fixed point.
  const minters = new Set([SEED, ...SEAMS]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { ast } of trees) {
      visit(ast, (node, stack) => {
        if (!isFn(node)) return;
        const name = fnName(node, stack[stack.length - 1]);
        if (!name || minters.has(name) || GENERIC.has(name)) return;
        let calls = false;
        visit(node.body, n => { if (n.type === "CallExpression" && minters.has(calleeName(n.callee))) calls = true; });
        if (calls) { minters.add(name); grew = true; }
      });
    }
  }
  const findings = [];
  for (const { f, ast } of trees) {
    if (!report.has(f)) continue;
    visit(ast, (node, stack) => {
      if (node.type !== "CallExpression") return;
      const name = calleeName(node.callee);
      if (!minters.has(name)) return;
      const loop = loopAround(node, stack);
      if (loop) findings.push(`${rel(f)}:${node.loc.start.line}  ${name}() inside a loop (line ${loop.loc.start.line}) with no send plan: a send to more than one person goes through server/mail/sendPlan.js`);
      if (name === SEED) {
        const arg = node.arguments[0];
        const to = arg && arg.type === "ObjectExpression" && arg.properties.find(p => p.key && (p.key.name === "to" || p.key.value === "to"));
        const v = to && to.value;
        if (v && (v.type === "ArrayExpression" || (v.type === "CallExpression" && calleeName(v.callee) === "join")))
          findings.push(`${rel(f)}:${node.loc.start.line}  recordStaffConfirm() for a list of people: a confirm is for one address`);
      }
    });
  }
  return { findings, minters: [...minters].sort() };
}

function pathText(arg) {
  if (!arg) return "";
  if (arg.type === "Literal") return String(arg.value);
  if (arg.type === "TemplateLiteral") return arg.quasis.map(q => q.value.raw).join("${}");
  return "";
}
function scanClient(files) {
  const findings = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!/apiFetch/.test(src) || !/\/send/.test(src)) continue;
    const ast = parse(f, src);
    if (!ast) continue;
    // A local helper that presses a send endpoint (const sendDraft = x => apiFetch(`…/send`)) counts as one.
    const pressers = new Set(["apiFetch:send"]);
    visit(ast, (node, stack) => {
      if (!isFn(node)) return;
      const name = fnName(node, stack[stack.length - 1]);
      if (!name) return;
      visit(node.body, n => {
        if (n.type === "CallExpression" && calleeName(n.callee) === "apiFetch" && isSendPath(pathText(n.arguments[0]))) pressers.add(name);
      });
    });
    visit(ast, (node, stack) => {
      if (node.type !== "CallExpression") return;
      const name = calleeName(node.callee);
      const presses = (name === "apiFetch" && isSendPath(pathText(node.arguments[0]))) || (name !== "apiFetch" && pressers.has(name));
      if (!presses) return;
      const loop = loopAround(node, stack);
      if (loop) findings.push(`${rel(f)}:${node.loc.start.line}  a send endpoint pressed once per item in a loop (line ${loop.loc.start.line}): build a send plan (POST /send-plans) and show it in SendPlanDialog`);
    });
  }
  return findings;
}
const isSendPath = p => /\/send(\b|[-/`?$])/.test(p) && !/send-plans/.test(p) && !/\/test/.test(p);
const rel = f => path.relative(ROOT, f);

function main() {
  let serverFiles, clientFiles;
  if (ONLY.length) {
    const abs = ONLY.map(f => path.resolve(f));
    serverFiles = abs.filter(f => !f.includes(`${path.sep}client${path.sep}`));
    clientFiles = abs.filter(f => f.includes(`${path.sep}client${path.sep}`) || f.endsWith(".jsx"));
    serverFiles = serverFiles.filter(f => !clientFiles.includes(f));
  } else {
    serverFiles = repoServerFiles();
    clientFiles = walkFiles(path.join(ROOT, "client", "src"), [], [".js", ".jsx"]);
  }
  const server = scanServer(serverFiles);
  const findings = server.findings.concat(scanClient(clientFiles));
  if (process.argv.includes("--minters")) console.log("minters:", server.minters.join(", "));
  if (findings.length) {
    console.error(`send-plan-scan: ${findings.length} finding(s)\n  ` + findings.join("\n  "));
    process.exit(1);
  }
  console.log(`send-plan-scan: ok · ${serverFiles.length + clientFiles.length} files · ${server.minters.length} functions mint staff confirms, none in a loop without a send plan`);
}

if (require.main === module) main();
module.exports = { scanServer, scanClient };

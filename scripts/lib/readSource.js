// scripts/lib/readSource.js — FIX-1: read a source file the way it read before
// the split.
//
// FIX-1 moved server.js's code into routes/<product>.js, App.jsx's tab lists
// into client/src/lib/tabRegistry.js and Donors.jsx into five files. Suites that
// assert on SOURCE TEXT ("the webhook verifies its signature", "no route writes
// without an actor", "this slice of the handler says X") must keep seeing the
// code they were written against, in the ORDER it was written — a comment
// stripped with one regex across the file, or a fixed-width window after a
// marker, reads different text if the pieces come back in a different order.
//
// readSource(rel) rebuilds that text from the LIVE files, never from a copy:
//   1. every file that holds a piece of `rel` (FILES below) is cut into its
//      top-level statements, each with the comments above it — the same cut
//      the split tool used, so a moved statement is byte-for-byte the text it
//      was in `rel`;
//   2. the lines the split ADDED are dropped: the app.use(...) router sites,
//      the mount() calls and imports that wire a module in, a module's header,
//      the ctx it reads and the bindings it mirrors; a moved require("../x") or
//      import("../x") is read back as the "./x" it was;
//   3. the pieces are laid out in their order before the split, from
//      splitOrder.json (a hash and a name per statement — an order, not a
//      copy). A statement edited since the split is found by its name; one
//      added since is placed right after the statement above it in its file.
// Until a file has been edited, readSource(rel) is byte-identical to `rel` as
// it was before the split (the split commits check exactly that).
//
// Only HOW a suite reads its source changed in FIX-1, never what it asserts.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");

// Where each split file's pieces live now. Each split commit adds its files.
const FILES = {
  "server.js": ["server.js", "routes/webhooks.js", "routes/billing.js", "routes/finance.js", "routes/volunteer.js"],
  "client/src/App.jsx": ["client/src/App.jsx"],
  "client/src/components/Donors.jsx": ["client/src/components/Donors.jsx"],
};
const ORDER_FILE = path.join(__dirname, "splitOrder.json");

let espree = null;
function parser() {
  // eslint's parser (acorn + JSX), from the client's own dependencies — it is
  // installed wherever the suites run (CI runs `npm ci --prefix client`).
  if (!espree) espree = require(path.join(ROOT, "client", "node_modules", "espree"));
  return espree;
}
function parse(src, jsx) {
  return parser().parse(src, { ecmaVersion: "latest", sourceType: jsx ? "module" : "script", range: true, loc: false, ecmaFeatures: { jsx: !!jsx } });
}

// Cut `stmts` (a statement list whose text lies in src) into chunks: from the
// line after the previous statement to the end of this statement's line.
function tile(src, stmts, floor) {
  const out = [];
  for (let i = 0; i < stmts.length; i++) {
    const prevEnd = i === 0 ? floor : stmts[i - 1].range[1];
    let a = src.indexOf("\n", prevEnd); a = a === -1 ? prevEnd : a + 1;
    if (i === 0) a = floor;
    a = Math.min(a, stmts[i].range[0]);
    let b = src.indexOf("\n", stmts[i].range[1]); b = b === -1 ? src.length : b + 1;
    out.push({ node: stmts[i], text: src.slice(a, b), stmt: src.slice(stmts[i].range[0], stmts[i].range[1]) });
  }
  return out;
}

const ROUTE_METHODS = new Set(["get", "post", "put", "delete", "patch", "all"]);
function keyOf(node) {
  const n = node.type === "ExportNamedDeclaration" && node.declaration ? node.declaration : node;
  if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") return "decl:" + n.id.name;
  if (n.type === "VariableDeclaration") return "decl:" + n.declarations.map(d => d.id.name || "_").join(",");
  if (n.type === "ImportDeclaration") return "import:" + n.source.value;
  if (n.type === "ExpressionStatement" && n.expression.type === "CallExpression") {
    const c = n.expression.callee, a0 = n.expression.arguments[0];
    if (c.type === "MemberExpression" && c.object.name === "app" && ROUTE_METHODS.has(c.property.name) && a0 && a0.type === "Literal")
      return "route:" + c.property.name + " " + a0.value;
  }
  return null;
}
const hash = t => crypto.createHash("sha1").update(t).digest("hex").slice(0, 16);

const isReq = (n, re) => n && n.type === "CallExpression" && n.callee.name === "require" && n.arguments[0] && re.test(String(n.arguments[0].value));
const ROUTES_MOD = /^\.\/routes\/[\w-]+$/;
// server.js: the wiring the split added
function isServerWiring(n) {
  if (n.type === "ExpressionStatement" && n.expression.type === "CallExpression") {
    const e = n.expression, c = e.callee;
    // app.use(require("./routes/X").routers.R)
    if (c.type === "MemberExpression" && c.object.name === "app" && c.property.name === "use" && e.arguments.length === 1) {
      const a = e.arguments[0];
      if (a.type === "MemberExpression" && a.object.type === "MemberExpression" && a.object.property.name === "routers" && isReq(a.object.object, ROUTES_MOD)) return true;
    }
    // require("./routes/X").mount({ ... })
    if (c.type === "MemberExpression" && c.property.name === "mount" && isReq(c.object, ROUTES_MOD)) return true;
  }
  // const { ... } = require("./routes/X")
  if (n.type === "VariableDeclaration" && n.declarations.length === 1 && isReq(n.declarations[0].init, ROUTES_MOD)) return true;
  return false;
}

// A routes/X.js module → its moved statements, in file order.
function modulePieces(rel, src) {
  const ast = parse(src, false);
  const body = ast.body;
  const mount = body.find(s => s.type === "FunctionDeclaration" && s.id.name === "mount");
  const exp = body.find(s => s.type === "ExpressionStatement" && s.expression.type === "AssignmentExpression"
    && s.expression.left.type === "MemberExpression" && s.expression.left.object.name === "module");
  if (!mount || !exp) return null; // not in the split shape (routes/migc.js): not a piece of anything
  // a helper module binds its imports with `({ ... } = ctx);` and keeps its
  // functions after mount(); a routes/jobs module keeps them inside mount()
  const first = mount.body.body[0];
  const lib = first && first.type === "ExpressionStatement" && first.expression.type === "AssignmentExpression";
  let stmts, floor;
  if (lib) {
    stmts = body.slice(body.indexOf(mount) + 1, body.indexOf(exp));
    floor = src.indexOf("\n", mount.range[1]) + 1;
  } else {
    stmts = mount.body.body;
    floor = src.indexOf("\n", mount.body.range[0]) + 1;
  }
  const chunks = tile(src, stmts, floor);
  // drop: `const { ... } = ctx;`, mirrored bindings, `app = routers.X;`
  const mirrored = new Set();
  for (const s of stmts) {
    if (s.type === "ExpressionStatement" && s.expression.type === "CallExpression" && s.expression.callee.type === "MemberExpression"
      && s.expression.callee.property.name === "then" && s.expression.arguments[0] && s.expression.arguments[0].type === "ArrowFunctionExpression") {
      const f = s.expression.arguments[0];
      const b = f.body.type === "BlockStatement" && f.body.body.length === 1 && f.body.body[0];
      if (b && b.type === "ExpressionStatement" && b.expression.type === "AssignmentExpression" && f.params[0] && b.expression.right.name === f.params[0].name) mirrored.add(s);
    }
  }
  return chunks.filter(({ node: s }, i) => {
    if (s.type === "VariableDeclaration" && s.declarations.length === 1 && s.declarations[0].init && s.declarations[0].init.type === "Identifier" && s.declarations[0].init.name === "ctx") return false;
    if (mirrored.has(s)) return false;
    if (s.type === "VariableDeclaration" && s.kind === "let" && s.declarations.length === 1 && s.declarations[0].init && s.declarations[0].init.type === "Literal" && s.declarations[0].init.value === null
      && stmts[i + 1] && mirrored.has(stmts[i + 1])) return false;
    const e = s.type === "ExpressionStatement" ? s.expression : s.type === "VariableDeclaration" && s.kind === "let" && s.declarations.length === 1 ? { type: "Decl", d: s.declarations[0] } : null;
    if (e && e.type === "AssignmentExpression" && e.left.name === "app" && e.right.type === "MemberExpression" && e.right.object.name === "routers") return false;
    if (e && e.type === "Decl" && e.d.id.name === "app" && e.d.init && e.d.init.type === "MemberExpression" && e.d.init.object.name === "routers") return false;
    return true;
  }).map(c => ({ ...c, text: c.text.replace(/\b(import|require)\((\s*)(["'`])\.\.\//g, "$1($2$3./") }));
}

// A client file → its statements; the split's own lines dropped.
const SIBLING = /^\.\/(DonorImport|DonorProfile|DonorDirectory|donorShared|Donors)$|^\.\/lib\/tabRegistry$/;
const PART_HEADER_END = /^[\s\S]*?\/\/ Tests read it through readSource\([^\n]*\n/;
function clientPieces(rel, src, isPart) {
  const ast = parse(src, true);
  const chunks = tile(src, ast.body, 0);
  if (isPart && chunks.length) chunks[0] = { ...chunks[0], text: chunks[0].text.replace(PART_HEADER_END, "") }; // the part's own header
  return chunks.filter(({ node: s }) => {
    if (s.type === "ImportDeclaration" && (isPart || SIBLING.test(s.source.value))) return false; // a part's imports, and the wiring between parts
    if (s.type === "ExportNamedDeclaration" && !s.declaration) return false;                  // export { ... } lists and re-exports
    return true;
  });
}

function piecesOf(target) {
  const out = [];
  for (const rel of FILES[target]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (target === "server.js") {
      if (rel === "server.js") {
        const ast = parse(src, false);
        for (const c of tile(src, ast.body, 0)) if (!isServerWiring(c.node)) out.push({ ...c, file: rel });
      } else {
        const p = modulePieces(rel, src);
        if (p) for (const c of p) out.push({ ...c, file: rel });
      }
    } else {
      for (const c of clientPieces(rel, src, rel !== target)) out.push({ ...c, file: rel });
    }
  }
  return out;
}

function assemble(target) {
  const order = fs.existsSync(ORDER_FILE) ? (JSON.parse(fs.readFileSync(ORDER_FILE, "utf8"))[target] || null) : null;
  const pieces = piecesOf(target);
  const imports = [], rest = pieces;
  if (!order) return rest.map(p => p.text).join("");
  const byHash = new Map(), byKey = new Map();
  rest.forEach((p, i) => {
    p.i = i; p.h = hash(p.text); p.k = keyOf(p.node) || "text:" + hash(p.stmt);
    if (!byHash.has(p.h)) byHash.set(p.h, []); byHash.get(p.h).push(p);
    if (p.k) { if (!byKey.has(p.k)) byKey.set(p.k, []); byKey.get(p.k).push(p); }
  });
  const used = new Set(), placed = [];
  const take = (m, k) => { const l = m.get(k); if (!l) return null; const p = l.find(x => !used.has(x)); if (p) used.add(p); return p || null; };
  for (const e of order) { const p = take(byHash, e.h); placed.push(p || e); }
  for (let j = 0; j < placed.length; j++) if (!placed[j].text) { const p = placed[j].k ? take(byKey, placed[j].k) : null; placed[j] = p; }
  const seq = placed.filter(Boolean);
  // statements with no place in the old order: right after the one above them in their file
  for (const p of rest) {
    if (used.has(p)) continue;
    const prev = rest.slice(0, p.i).reverse().find(x => x.file === p.file && seq.includes(x));
    seq.splice(prev ? seq.indexOf(prev) + 1 : 0, 0, p);
    used.add(p);
  }
  return [...imports, ...seq].map(p => p.text).join("");
}

const cache = new Map();
function readSource(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  const key = path.relative(ROOT, abs).split(path.sep).join("/");
  if (!FILES[key] || FILES[key].length === 1) return fs.readFileSync(abs, "utf8");
  const stamp = FILES[key].map(f => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs; } catch { return 0; } }).join();
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.text;
  const text = assemble(key);
  cache.set(key, { stamp, text });
  return text;
}

// The order file is written ONCE, by the split, from the files before it.
function orderOf(target, srcByFile) {
  const src = srcByFile[target];
  const ast = parse(src, target !== "server.js");
  return tile(src, ast.body, 0).map(c => ({ h: hash(c.text), k: keyOf(c.node) || "text:" + hash(c.stmt) }));
}

// The files that now hold pieces of a split file (not the file itself). A suite
// that enumerates source files reads these through readSource(target) instead.
function splitParts() {
  return new Set(Object.entries(FILES).flatMap(([t, fs_]) => fs_.filter(f => f !== t)));
}

module.exports = { readSource, FILES, orderOf, splitParts };

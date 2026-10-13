// POLISH-2 Part 5: words glued together on screen.
//
// JSX drops any run of whitespace that contains a newline. So text that ends a
// line, followed by `{expr}` on the next line, renders with no space between
// them ("64 early signs,{n}" -> "64 early signs,donors"), and the same happens
// the other way round. `scanGlued` finds those seams in the source; it parses
// every .jsx file with @babel/parser (the client's own copy) and looks only at
// JSX children, so comments, strings and plain JS can't trip it.
//
// `GLUED_RENDERED` is the browser half: given a screen's innerText it returns
// the tokens that look glued, for a walk to fail on.
"use strict";
const fs = require("fs");
const path = require("path");

const parser = require(path.join(__dirname, "..", "..", "client", "node_modules", "@babel", "parser"));

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.jsx$/.test(e.name)) out.push(p);
  }
  return out;
}

// Block-level tags start a new line, so nothing can glue across them.
const BLOCK = /^(div|p|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|section|header|footer|br|hr|form|label|input|select|textarea|button|details|summary|img|svg|Card|EmptyState)$/;

// What an expression can render at one edge ("head" or "tail"): a list of
// possible strings, where "" means nothing, and null means "a value" (an
// identifier, a call) that renders text flush against its neighbour.
function edgeOf(x, side) {
  if (!x) return [""];
  switch (x.type) {
    case "JSXEmptyExpression": case "NullLiteral": case "BooleanLiteral": return [""];
    case "StringLiteral": return [x.value];
    case "NumericLiteral": return [String(x.value)];
    case "TemplateLiteral": {
      const q = side === "head" ? x.quasis[0] : x.quasis[x.quasis.length - 1];
      const v = q.value.cooked || "";
      if (v) return [v];
      const inner = side === "head" ? x.expressions[0] : x.expressions[x.expressions.length - 1];
      return inner ? edgeOf(inner, side) : [""];
    }
    case "ConditionalExpression": return join(edgeOf(x.consequent, side), edgeOf(x.alternate, side));
    case "LogicalExpression":
      // a && X renders X or nothing; a || X renders a or X.
      if (x.operator === "&&") return join([""], edgeOf(x.right, side));
      return join(edgeOf(x.left, side), edgeOf(x.right, side));
    case "JSXElement": {
      const name = x.openingElement.name.name || "";
      if (BLOCK.test(name)) return ["\n"];
      // An element that boxes itself (block, flex, grid or float) sits apart.
      const style = x.openingElement.attributes.find(a => a.type === "JSXAttribute" && a.name && a.name.name === "style");
      if (style && style.value && CURRENT_SRC &&
          /display\s*:\s*["'`](?:block|flex|grid|inline-block)["'`]|float\s*:/.test(CURRENT_SRC.slice(style.value.start, style.value.end))) return ["\n"];
      // A component with no children renders what it likes (a figure, a name).
      if (/^[A-Z]/.test(name) && x.children.length === 0) return null;
      return childrenEdge(x.children, side);
    }
    case "JSXFragment": return childrenEdge(x.children, side);
    case "CallExpression":
      // xs.map(...) renders a list of elements; treat a map of elements by its body.
      if (x.callee && x.callee.property && x.callee.property.name === "map" && x.arguments[0]) {
        const fn = x.arguments[0];
        const body = fn.body && fn.body.type === "BlockStatement" ? null : fn.body;
        return body ? edgeOf(body, side) : null;
      }
      return null;
    case "ParenthesizedExpression": return edgeOf(x.expression, side);
    default: return null;
  }
}
function join(a, b) { return a === null || b === null ? null : a.concat(b); }
function childrenEdge(children, side) {
  const kids = side === "head" ? children : children.slice().reverse();
  for (const c of kids) {
    if (c.type === "JSXText") {
      const v = c.value.replace(/\s*\n\s*/g, "");
      if (v) return [v];
      continue;
    }
    if (c.type === "JSXExpressionContainer") {
      const e = edgeOf(c.expression, side);
      if (e === null) return null;
      if (e.every(s => s === "")) continue;
      return e;
    }
    return edgeOf(c, side);
  }
  return [""];
}
// Safe when every possible edge is empty, whitespace or punctuation.
function edgeSafe(x, side) {
  const e = edgeOf(x, side);
  if (e === null) return false;
  return e.every(s => s === "" || (side === "head" ? /^[^A-Za-z0-9$]/.test(s) : /[^A-Za-z0-9.,%]$/.test(s)));
}
function exprIsQuiet(node, side) {
  const x = node.expression;
  if (!x || x.type === "JSXEmptyExpression") return true;
  return edgeSafe(x, side);
}

// Whitespace between the visible text and the seam that JSX will throw away.
const INLINE_TAGS = process.env.GLUED_TAGS !== "0";
const DROPPED_TAIL = /\S([ \t]*\r?\n\s*)$/;   // text, then a newline run, at the end
const DROPPED_HEAD = /^(\s*\r?\n[ \t]*)\S/;   // a newline run, then text, at the start

// A flex or grid parent turns each child into its own box, so text and an
// expression beside it never share a line of words ("Filters" and a count pill).
function laysOutChildren(node, src) {
  if (node.type !== "JSXElement") return false;
  const style = node.openingElement.attributes.find(a => a.type === "JSXAttribute" && a.name && a.name.name === "style");
  if (!style || !style.value) return false;
  return /display\s*:\s*["'`](?:inline-)?(?:flex|grid)["'`]/.test(src.slice(style.value.start, style.value.end));
}

let CURRENT_SRC = null;
function scanSource(src, file) {
  CURRENT_SRC = src;
  let ast;
  try {
    ast = parser.parse(src, { sourceType: "module", plugins: ["jsx"], errorRecovery: true });
  } catch (_) { return []; }
  const hits = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if ((node.type === "JSXElement" || node.type === "JSXFragment") && Array.isArray(node.children) && !laysOutChildren(node, src)) {
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.type !== "JSXText") continue;
        const raw = k.value;
        const next = kids[i + 1], prev = kids[i - 1];
        // text, newline, then {expr}: "signs,\n{n}"
        if (next && next.type === "JSXExpressionContainer" && !exprIsQuiet(next, "head") && DROPPED_TAIL.test(raw)) {
          const body = raw.replace(/\s+$/, "");
          if (/[A-Za-z0-9,]$/.test(body)) {
            hits.push({ file, line: next.loc.start.line, text: body.split("\n").pop().trim().slice(-40) + "⟂{" + src.slice(next.expression.start, next.expression.end).slice(0, 30) + "}" });
          }
        }
        // text, newline, then an inline tag that starts with a word: "Click\n<a>here</a>"
        if (INLINE_TAGS && next && next.type === "JSXElement" && DROPPED_TAIL.test(raw) && !edgeSafe(next, "head")) {
          const body = raw.replace(/\s+$/, "");
          if (/[A-Za-z0-9,]$/.test(body)) hits.push({ file, line: next.loc.start.line, text: body.split("\n").pop().trim().slice(-40) + "⟂<" + (next.openingElement.name.name || "?") + ">" });
        }
        // an inline tag that ends in a word, newline, then text: "<b>Lifetime</b>\ngiving"
        if (INLINE_TAGS && prev && prev.type === "JSXElement" && DROPPED_HEAD.test(raw) && !edgeSafe(prev, "tail")) {
          const body = raw.replace(/^\s+/, "");
          if (/^[A-Za-z0-9]/.test(body)) hits.push({ file, line: k.loc.start.line, text: "<" + (prev.openingElement.name.name || "?") + ">⟂" + body.split("\n")[0].trim().slice(0, 40) });
        }
        // {expr}, newline, then text: "{n}\nwords"
        if (prev && prev.type === "JSXExpressionContainer" && !exprIsQuiet(prev, "tail") && DROPPED_HEAD.test(raw)) {
          const body = raw.replace(/^\s+/, "");
          if (/^[A-Za-z0-9]/.test(body)) {
            hits.push({ file, line: k.loc.start.line + raw.slice(0, raw.length - body.length).split("\n").length - 1,
              text: "{" + src.slice(prev.expression.start, prev.expression.end).slice(-30) + "}⟂" + body.split("\n")[0].trim().slice(0, 40) });
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === "string" && visit(c));
      else if (v && typeof v.type === "string") visit(v);
    }
  };
  visit(ast.program);
  return hits;
}

function scanGlued(rootDir) {
  const root = rootDir || path.join(__dirname, "..", "..", "client", "src");
  const out = [];
  for (const f of walkFiles(root)) {
    out.push(...scanSource(fs.readFileSync(f, "utf8"), path.relative(path.join(root, "..", ".."), f)));
  }
  return out;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
// Lowercase-word-then-digit joins that are real words ("holds1,049", "says969"),
// not ids or units ("h2", "q4", "2fa", "D10003").
const WORD_DIGIT = /\b([a-z]{3,})(\d[\d,.]*)\b/g;
const ALLOW_WORD_DIGIT = /^(utf|sha|base|mp|ipv|http|https|org|demo|gift|donor|test|step|part|build|fix|seed|row|col|page|level|tier|item|line|polish|chore|wire|int|ask|landing|harden|groups|journeys|cal|reports|tasks|live|sheets|grants|email|scale|vol|qbo|search|trans|thread|agent|admin|connect|push|mailchimp|import|clean|prospect|proof|parity|premium|profile|nav|home|events|members|survey|fin|engage|content|give|gtm|help|why|lf|sec|zapier)$/;

function GLUED_RENDERED(text) {
  const s = String(text || "");
  const found = new Set();
  let m;
  const comma = /[a-z],[a-z]{2,}/g;                          // "signs,donors"
  while ((m = comma.exec(s))) found.add(m[0]);
  WORD_DIGIT.lastIndex = 0;
  while ((m = WORD_DIGIT.exec(s))) if (!ALLOW_WORD_DIGIT.test(m[1])) found.add(m[0]);
  const month = new RegExp("[a-z](?:" + MONTHS + ")\\b", "g"); // "forSeptember"
  while ((m = month.exec(s))) found.add(s.slice(Math.max(0, m.index - 6), m.index + m[0].length));
  const known = /\b(this|last|next)(week|month|year)\b|\byour[A-Z]|\b[a-z]+(?:export|file)\b(?=\s|$)/g;
  while ((m = known.exec(s))) {
    if (/^(this|last|next)(week|month|year)$/.test(m[0]) || /^your[A-Z]/.test(m[0])) found.add(m[0]);
    else if (/^(spreadsheet|csv|excel)(export|file)$/i.test(m[0])) found.add(m[0]);
  }
  return [...found];
}

module.exports = { scanGlued, scanSource, GLUED_RENDERED };

if (require.main === module) {
  const hits = scanGlued(process.argv[2]);
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.text}`);
  console.log(`${hits.length} glued seam(s)`);
}

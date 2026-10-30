// tests/claude-md.test.js · FIX-59. CLAUDE.md STAYS SHORT.
// Pure Node, no server, no DB. Run: node tests/claude-md.test.js
//
// Every session reads CLAUDE.md on every turn, and its first lines promise
// "200 lines at most, enforced by tests/claude-md.test.js". That file did not
// exist, so the promise was enforced by nothing. This is it.
//
// HOW IT GOES RED: add lines to CLAUDE.md until it passes 200, or remove the
// sentence that names this file (then the cap is no longer written down where
// a session reads it).
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");

const CAP = 200;
const file = process.env.CLAUDE_MD || path.join(__dirname, "..", "CLAUDE.md");
const text = fs.readFileSync(file, "utf8");
const lines = text.replace(/\n$/, "").split("\n").length;

ok(`CLAUDE.md is ${CAP} lines at most (it is ${lines})`, lines <= CAP, { lines, cap: CAP });
ok("CLAUDE.md names this test as what enforces its cap", /200 lines at most/.test(text) && /tests\/claude-md\.test\.js/.test(text));
summary();

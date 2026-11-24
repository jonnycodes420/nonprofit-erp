// tests/lib/changelogOffHome.js: PERF-5 item 1. What's new is every file in
// docs/changelog/, one more each build. None of it may ride in the JavaScript
// Home downloads: the entries load when the menu holding What's new opens,
// and the dot reads a build-time list of the newest ids (client/scripts/
// changelogLatest.mjs). Given the script URLs Home's visit loaded, this reads
// each one from the dist and names any that is the changelog chunk or carries
// the newest entry's title (which a static import of lib/changelog.js puts in
// the entry chunk).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function newestEntryTitle() {
  const dir = path.join(ROOT, "docs", "changelog");
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)).sort();
  for (const f of files.reverse()) {
    const m = /^title:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    if (m) return { file: f, title: m[1].trim() };
  }
  return null;
}

// scriptUrls: every Script response of Home's visit. dist: the built client.
function changelogOnHome(scriptUrls, dist) {
  const newest = newestEntryTitle();
  // A title is written into the bundle as a JS string: match a stretch of it
  // that needs no escaping.
  const probe = newest && newest.title.replace(/["'\\].*$/, "").slice(0, 40);
  const found = [];
  for (const u of new Set(scriptUrls)) {
    let p;
    try { p = new URL(u).pathname; } catch { continue; }
    if (!/\.js$/.test(p)) continue;
    const name = path.basename(p);
    if (/^changelog-/.test(name)) { found.push(`${name} (the changelog chunk)`); continue; }
    const file = path.join(dist, p.replace(/^\//, ""));
    if (probe && probe.length >= 12 && fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(probe)) found.push(`${name} (carries "${probe}", ${newest.file})`);
  }
  return { found, probe, newest: newest && newest.file };
}

module.exports = { changelogOnHome, newestEntryTitle };

// scripts/ci/write-announce-scan.mjs · SCALE-6 item 3. EVERY WRITE SAYS WHAT IT CHANGED.
//
// Reads every apiFetch(<path>, { method: "POST" | "PUT" | "PATCH" | "DELETE" }) in
// client/src, puts a sample id in each ${…} of the path, and asks lib/changes.js
// kindsOfWrite what that write announces. A write that announces nothing ("other")
// re-reads no screen, so the fleet sees the old figure until a reload
// (W-1112-Volunteers-01X). Each one must either get a rule in kindsOfWrite or be
// named in client/src/lib/writeToRead.js NO_SCREEN_READS with the reason no screen
// shows what it changed.
//
//   node scripts/ci/write-announce-scan.mjs          # exit 1 when a write is unannounced
//   node scripts/ci/write-announce-scan.mjs --list   # every write and its kinds
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "client/src");
const { kindsOfWrite } = await import(pathToFileURL(path.join(SRC, "lib/changes.js")).href);
const { NO_SCREEN_READS } = await import(pathToFileURL(path.join(SRC, "lib/writeToRead.js")).href);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") walk(p); }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(SRC);

// apiFetch(`…` or "…", { … method: "X" …   — the options on the same statement.
const CALL = /apiFetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*,\s*\{([^;]{0,400}?)method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/g;
export function scan() {
  const out = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(CALL)) {
      const raw = m[1].slice(1, -1);
      const sample = raw.replace(/\$\{[^}]*\}/g, "x1");
      if (!sample.startsWith("/")) continue;   // a path built elsewhere (a variable): named where it is built
      const body = /body\s*:\s*JSON\.stringify\(\s*\{([^}]*)\}/.exec(m[2] + src.slice(m.index + m[0].length, m.index + m[0].length + 300));
      const keys = body ? Object.fromEntries((body[1].match(/\b(donorId|donor_id|personId|eventId|pledgeId|grantId|groupId|taskId)\b/g) || []).map(k => [k, "x1"])) : null;
      const w = kindsOfWrite(sample, m[3], keys ? JSON.stringify(keys) : undefined);
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ file: path.relative(ROOT, f), line, method: m[3], path: raw, sample: sample.split("?")[0], kinds: [...w.kinds] });
    }
  }
  return out;
}

// THE RATCHET. When SCALE-6 added this check, 385 writes announced nothing (most on /ops,
// Settings, the sign-up pages and the editors, where no figure re-reads). They are the
// baseline (write-announce-baseline.json): CI fails on a write that is unannounced and not
// in it, and a baseline entry that has since been given a rule is reported so the list
// only shrinks (--update rewrites it, never to add).
const BASELINE = path.join(ROOT, "scripts/ci/write-announce-baseline.json");
const keyOf = w => `${w.method} ${w.sample}`;
const quiet = (w) => NO_SCREEN_READS.some(n => n.method === w.method && n.re.test(w.sample));
export function check() {
  const all = scan();
  const missing = all.filter(w => w.kinds.length === 1 && w.kinds[0] === "other" && !quiet(w));
  const base = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")).unannounced : []);
  const fresh = missing.filter(w => !base.has(keyOf(w)));
  const now = new Set(missing.map(keyOf));
  const below = [...base].filter(k => !now.has(k));
  return { all, missing, fresh, below };
}
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { all, missing, fresh, below } = check();
  if (process.argv.includes("--list")) for (const w of all) console.log(`${w.method.padEnd(6)} ${w.sample.padEnd(60)} ${w.kinds.join(",")}  ${w.file}:${w.line}`);
  // --seed: the first baseline only, when there is none.
  const seeding = process.argv.includes("--seed") && !fs.existsSync(BASELINE);
  if (process.argv.includes("--update") || seeding) {
    if (fresh.length && !seeding) { console.log(`[write-announce] refusing --update: ${fresh.length} new unannounced write(s) would join the baseline. Give each a rule.`); }
    else { fs.writeFileSync(BASELINE, JSON.stringify({ note: "SCALE-6: writes that announced nothing when the check was added. Only ever shrinks.", unannounced: [...new Set(missing.map(keyOf))].sort() }, null, 1) + "\n"); console.log(`[write-announce] baseline written: ${new Set(missing.map(keyOf)).size} entries`); }
  }
  console.log(`[write-announce] ${all.length} writes in client/src · ${all.length - missing.length} announce what they changed · ${missing.length} unannounced, ${missing.length - fresh.length} of them in the baseline${below.length ? ` · ${below.length} baseline entr${below.length === 1 ? "y" : "ies"} now announced: run --update to lower it` : ""}`);
  for (const w of fresh) console.log(`  UNANNOUNCED ${w.method} ${w.path}  (${w.file}:${w.line}): add a rule to client/src/lib/changes.js kindsOfWrite, or name it in writeToRead.js NO_SCREEN_READS with why no screen shows it`);
  process.exit(fresh.length ? 1 : 0);
}

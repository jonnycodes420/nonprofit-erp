// PERF-5 · the unread dot's only input, computed at build time.
// The top bar's What's new dot needs to know the newest entry, not every
// entry: before this, every docs/changelog file loaded four seconds after
// Home drew (58 KB gzipped on 24 Nov, and one more file every build). Vite
// defines __WN_LATEST__ as the newest entry's id (parsed by the same
// shared/changelog.js the panel uses), so the dot is a fixed-size constant and
// the entries load only when What's new is opened. One id, not a
// list: five ids cost Home 76 bytes gzipped, more than the prefetch code this
// replaced. If a super-admin hid the newest entry, no dot shows until a newer
// build (the panel, WhatsNewPanel.jsx, still marks what it showed as seen).
import { readdirSync, readFileSync } from "node:fs";
import { entriesFrom } from "../../shared/changelog.js";

export function changelogLatest(dir = new URL("../../docs/changelog/", import.meta.url)) {
  const files = {};
  for (const f of readdirSync(dir)) if (f.endsWith(".md")) files[f] = readFileSync(new URL(f, dir), "utf8");
  const [newest] = entriesFrom(files);
  return newest ? newest.id : "";
}

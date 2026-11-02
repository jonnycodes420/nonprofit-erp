## SCREENS-1 · The giant screens become parts, and Home's first look gets its own chunk (2026-11-02)

**Why.** Settings.jsx (4,583 lines), DonorImport.jsx (4,559) and Dashboard.jsx (3,384) were each one
file: every build that touched a card collided with every other, nothing could be tested one card at
a time, and Dashboard.jsx was most of the JavaScript that kept Home on a phone over its 3-second bar
(PERF-2). DonorProfile.jsx was PROFILE-3's to split and was not touched.

**How the move was made.** By a tool, not by hand. It parsed each file (Babel), cut it into top-level
statements with the comments above them, and wrote each named group to a new file with exactly the
imports it reads (relative paths, dynamic `import()` included, rewritten for the new folder). For the
parts inside one giant component it lifted a JSX block or a `const`'s value out whole: its free names
became props (a component) or the argument (a render function), and it refused any lift that called
a hook, assigned a name from outside, or read a `const` declared below the place it is called, which
would have been a TDZ error at render (it caught `openRailDonor`, declared under the Thread's rows;
that one line moved up). The tool was a build script and is not committed.

- **Settings** (1,490 lines) keeps the page; its 24 cards and the tab list are 25 files in
  `components/settings/`. Stitched back by `readSource`, the text is the old file statement for
  statement, apart from import lines and the `export` on each moved card.
- **DonorImport** (1,481) keeps the gate and the wizard's state; the field registry, the reader, the
  payload builders, gift history, merge and every step (reader, detection, mapping, the date
  questions, review, done, header) are 14 files in `components/import/`.
- **Dashboard** (1,481) keeps Home's state, its reads and its first look: `home/HomeFirstLook.jsx`
  (the greeting, the day, Ask and the moves) and the Today rail. Everything else, every section, the
  Thread's rows, the rail's drill-downs, the board's line, the overlays and the section stack, is a
  render function in `components/home/`, gathered by `home/HomeLater.js` into one chunk that
  `home/useHomeLater.js` fetches after the first paint. Dashboard calls each function where its JSX
  was written, so once the chunk is in, the element tree is the one it was.

**Proof that nothing changed.** The same walk (every tab, every Settings section, a profile and Home,
at 1440 and 390, on a real-shaped org and an empty one) ran on main's build and on this one: the page
text was compared screen by screen and the screenshots pixel by pixel. The numbers are in the PR.
Every part has one render case in `tests/screens1-parts.test.js`. The source guards that read these
files now read them through `scripts/lib/readSource.js`, which knows each screen's parts folder.

**Not changed, written down.** The old import wizard is reachable from no screen; Dashboard still
computes a few things nothing draws (`docs/defects.md`, SCREENS-1).

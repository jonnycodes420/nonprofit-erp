// BUILD-86 Part A — HOME, AND THE BOARD MEETING. Run: node tests/build86.test.js
//
// Home is hers at 7:40 in the morning. Dashboard is the board meeting. This
// pins the split and the sentence:
//
//   §1  THE SENTENCE is asserted on the FAMILY of source combinations (any
//       one, any two, all three, none) — never on one string. It is assembled,
//       never a template with holes, and "Nothing is waiting on you this
//       morning." is allowed to be the whole screen.
//   §2  THE SPLIT: every section is on exactly one surface, and the rule that
//       decided which is encoded — not "no numbers on Home", which would fail
//       against the Thread card BUILD-85 shipped, but the brief's real
//       sentence: NO ROW ON HOME IS A NUMBER WITHOUT A NAME ATTACHED.
//   §3  NOTHING WAS LOST. Every section that existed before this build still
//       renders on one of the two surfaces.
//   §4  The at-risk monthly gifts arrive WITH DONOR NAMES, capped, org-scoped.
//
// §1–§3 are pure and need no server. §4 needs the scratch stack.

const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b86", ORG2 = "org_b86two";
const root = path.join(__dirname, "..");

(async () => {
  // ── §1 · the sentence ────────────────────────────────────────────────────
  console.log("\n— §1 · one sentence, assembled, never generic —");
  const M = await import("../shared/homeNote.js");
  // Pinned clock: a sentence that reads the wall clock is a guard measuring
  // the calendar (the BUILD-84 rule).
  const NOW = Date.parse("2026-09-16T12:00:00Z");
  const dayAgo = n => new Date(NOW - n * 86400000).toISOString();

  const THREADS = { list: [
    { donorName: "Robert Harmon", overdue: true,  daysOpen: 24 },
    { donorName: "Ana Diaz",      overdue: true,  daysOpen: 3 },
    { donorName: "Kip Lee",       overdue: false, daysOpen: 1 },
  ] };
  const DRIFT = { list: [{ donorName: "Margaret Chen" }, { donorName: "Otis Grange" }] };
  const ATRISK = [
    { donor_name: "Sunrise Foundation", first_failed_at: dayAgo(2) },
    { donor_name: "Rob Delaney",        first_failed_at: dayAgo(1) },
  ];

  // THE FAMILY: every combination of the three sources.
  const SOURCES = { threads: THREADS, drift: DRIFT, atRisk: ATRISK };
  const KEYS = ["threads", "drift", "atRisk"];
  const combos = [];
  for (let mask = 0; mask < 8; mask++) {
    const input = {};
    const on = [];
    KEYS.forEach((k, i) => { if (mask & (1 << i)) { input[k] = SOURCES[k]; on.push(k); } });
    combos.push({ on, note: M.homeNote(input, NOW) });
  }
  ok("every combination of sources produces a note", combos.every(c => typeof c.note === "string" && c.note.length > 0));
  ok("…each opens with a capital and ends in a full stop",
     combos.every(c => /^[A-Z]/.test(c.note) && c.note.endsWith(".")), combos.map(c => c.note));
  ok("NO SOURCE AT ALL is an answer, not an empty state",
     combos.find(c => c.on.length === 0).note === M.NOTHING_WAITING, combos[0].note);
  ok("…and it is at most three sentences", combos.every(c => (c.note.match(/\. /g) || []).length <= 2), combos.map(c => c.note));

  // NEVER A TEMPLATE WITH HOLES: a source that is off contributes no words.
  const BANNED_WHEN_OFF = { threads: /asked for|meant to call|thanked|conversation|people are waiting|has been waiting/i, drift: /gone quiet/i, atRisk: /card/i };
  for (const c of combos) {
    if (c.on.length === 0) continue;   // "Nothing is waiting on you" is the answer, not a clause
    for (const k of KEYS) {
      if (c.on.includes(k)) continue;
      ok(`with ${k} empty, its clause is ABSENT (not "0 ...")`,
         !BANNED_WHEN_OFF[k].test(c.note), { on: c.on, note: c.note });
    }
  }

  // ── C.2 · IT READS LIKE A NOTE, NOT A LOG LINE ──────────────────────────
  // The Part A defect, named: "Chen is at day 7." was true and written by a
  // machine. These are the rules that make it a note, asserted on the family.
  console.log("\n— §1b · the voice —");
  for (const rule of M.BANNED_PUNCTUATION) {
    ok(`no ${rule.name} in any note in the family`,
       !combos.some(c => rule.re.test(c.note)), combos.filter(c => rule.re.test(c.note)).map(c => c.note));
  }
  const oneLate = M.homeNote({ threads: { list: [{ donorName: "Margaret Chen", overdue: true, overdueDays: 7, nextStep: { label: "Send the import report" } }] } }, NOW);
  ok("ONE thing late leads with the PERSON, in full, and says what they asked for",
     oneLate === "Margaret Chen asked for the import report a week ago and hasn't heard back.", oneLate);
  const manyLate = M.homeNote({ threads: { list: [
    { donorName: "Margaret Chen", overdue: true, overdueDays: 11, nextStep: { label: "Send the report" } },
    { donorName: "Robert Harmon", overdue: true, overdueDays: 3, nextStep: { label: "Call" } },
    { donorName: "Diana Torres", overdue: true, overdueDays: 2, nextStep: { label: "Call" } }] } }, NOW);
  ok("SEVERAL leads with the count and still names who has waited longest",
     manyLate === "Three people are waiting on you; Chen has been waiting a week and a half.", manyLate);
  ok("time is in WORDS, never a day count",
     M.agoPhrase(1) === "yesterday" && M.agoPhrase(7) === "a week ago" && M.agoPhrase(30) === "a month ago",
     [M.agoPhrase(1), M.agoPhrase(7), M.agoPhrase(30)]);
  ok("…and a duration is not an 'ago' (\"waited longest, a week ago\" is not English)",
     M.durationPhrase(11) === "a week and a half" && M.agoPhrase(11) === "a week and a half ago");
  ok("a surname that is a bare number is not a name — the whole name is used",
     M.surname("Donor 1") === "Donor 1" && M.surname("Margaret Chen") === "Chen");
  ok("an ORGANISATION keeps its whole name at every mention",
     M.surname("Sunrise Foundation") === "Sunrise Foundation");
  ok("her words reach the note",
     M.homeNote({ drift: DRIFT, vocabulary: { giver_plural: "sponsors" } }, NOW).includes("sponsors"),
     M.homeNote({ drift: DRIFT, vocabulary: { giver_plural: "sponsors" } }, NOW));

  // The twenty-note fixture exists and covers the shapes a human should hear.
  const fixture = fs.readFileSync(path.join(root, "docs/build86/notes.txt"), "utf8");
  ok("the twenty-note fixture is checked in for a human to read in a row",
     (fixture.match(/\n\S.*  .+\./g) || []).length >= 20, (fixture.match(/\n\S.*  .+\./g) || []).length);
  // Only the NOTES, not the header that explains the rules by quoting them.
  const notesOnly = (fixture.split("=".repeat(78))[1] || "");
  ok("…and no note in it sounds like a log line",
     !/\bday \d+/i.test(notesOnly) && !/—/.test(notesOnly) && !/:\s/.test(notesOnly),
     (notesOnly.match(/\bday \d+|—|:\s/gi) || []).slice(0, 3));

  // ── §2 · the split ───────────────────────────────────────────────────────
  console.log("\n— §2 · two surfaces, one registry —");
  const L = await import("../client/src/lib/homeLayout.js");
  const home = L.sectionsFor("home").map(s => s.id);
  const board = L.sectionsFor("board").map(s => s.id);
  ok("every section declares exactly one surface",
     L.HOME_SECTIONS.every(s => s.surface === "home" || s.surface === "board"), L.HOME_SECTIONS.map(s => [s.id, s.surface]));
  ok("no section is on both", home.filter(id => board.includes(id)).length === 0, { home, board });
  // C.4 — HOME IS EXACTLY FOUR SECTIONS. The Part A leftovers are gone: the
  // tasks list ("Needs your attention", Mark done) and the milestone card.
  ok("Home renders EXACTLY the note, the Thread, Drift and the failing gifts",
     home.slice().sort().join(",") === "drift,recurring,setup,thread", home);
  // COMMENTS ARE NOT A SCREEN. The note explaining what was removed names the
  // thing it removed; a guard that cannot tell a comment from a render forces
  // you to stop writing down why.
  const dashSrc = require("fs").readFileSync(require("path").join(root, "client/src/components/Dashboard.jsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("the tasks list is gone from Home — no 'Needs your attention', no 'Mark done'",
     !/dash-needtodo/.test(dashSrc) && !/Mark done/i.test(dashSrc),
     (dashSrc.match(/dash-needtodo|Mark done/gi) || []).slice(0, 3));
  ok("the setup checklist is still there, and still retires itself",
     home.includes("setup") && /setupStatus\.complete/.test(dashSrc));
  ok("the note is the NOTE module, not Part A's sentence",
     /shared\/homeNote/.test(dashSrc) && !/morningSentence/.test(dashSrc));

  ok("Home is the queue, the names, and the things she set up",
     ["thread", "drift", "recurring", "setup"].every(id => home.includes(id)), home);
  // BUILD-86 C.3 — REVIEWED CHANGE. The board TAB is four dashboards now, each
  // one question with a defined number. The section registry's `board` entries
  // are no longer what that tab renders; their CONTENT survives on the
  // dashboards (the goal on Fundraising, retention on Board), and the registry
  // keeps them so Home's saved-layout machinery is untouched. What the split
  // still guarantees is that none of them is on HOME.
  ok("no board-surface section leaks onto Home",
     ["hero", "retentionPipeline", "myPortfolio", "impact", "monthly"].every(id => !home.includes(id)), home);
  const DB = await import("../shared/dashboards.js");
  ok("the board tab is four dashboards, each a question",
     DB.DASHBOARD_KEYS.join(",") === "board,fundraising,people,recurring", DB.DASHBOARD_KEYS);
  ok("Home can never be blank: the Thread is not hideable there",
     L.sectionMeta("thread").hideable === false);

  // §3 — NOTHING WAS LOST. This is the assertion that makes "it is a move"
  // checkable: every section that existed before BUILD-86 still renders.
  const BEFORE_BUILD_86 = ["hero", "setup", "thread", "monthly", "drift", "retentionPipeline", "myPortfolio", "impact"];
  ok("every section that existed before this build still renders on one surface",
     BEFORE_BUILD_86.every(id => home.includes(id) || board.includes(id)),
     BEFORE_BUILD_86.filter(id => !home.includes(id) && !board.includes(id)));

  // The saved-layout machinery is surface-agnostic and must stay that way —
  // one per-user list, filtered at render. BUILD-34's stale-config guarantee
  // rides on that and is re-proven here.
  const stale = L.mergeLayout([{ id: "thread", visible: true }]);
  ok("a stale saved layout still gains every new section, visible",
     L.HOME_SECTIONS.every(s => stale.some(r => r.id === s.id)), stale.map(r => r.id));
  ok("…including the one this build added", stale.some(r => r.id === "recurring" && r.visible));

  // ── §2b · NO ROW ON HOME IS A NUMBER WITHOUT A NAME ─────────────────────
  // Read off the source, because the rule is about what the component renders.
  // The brief's literal "no numeric-only element" would fail against the
  // Thread card's own count line, which LABELS the named rows beneath it —
  // see audit/BUILD-86-FINDINGS.md A2 for the judgment and its reasons.
  console.log("\n— §2b · the rule, read off the source —");
  const dash = fs.readFileSync(path.join(root, "client/src/components/Dashboard.jsx"), "utf8");
  ok("the 30-day continuation RATE is gone from the Thread card",
     !/threadHealth[\s\S]{0,400}?dash-needtodo/.test(dash));
  ok("…and renders on the board instead", /const threadHealthLine=/.test(dash) && /retentionPipeline:<>\{retentionPipelineSection\}\{threadHealthLine\}<\/>/.test(dash));
  ok("the at-risk monthly gifts render a donor NAME on every row",
     /atRisk\.map\(/.test(dash) && /r\.donor_name/.test(dash), null);
  ok("the sentence renders only on Home, the as-of line only on the board",
     /surface==="home"&&!editMode&&threadsData/.test(dash) && /surface==="board"&&!editMode/.test(dash));
  ok("the board says what it is and as of when", /Numbers a board can read/.test(dash));

  const app = fs.readFileSync(path.join(root, "client/src/App.jsx"), "utf8");
  ok("the board is a NEW tab id — `dashboard` keeps its route, its label and every deep link",
     /\{id:"board",label:"Dashboards"/.test(app) && /\{id:"dashboard",label:"Home"/.test(app));
  ok("Home renders the section surface; the board tab renders the four dashboards",
     /tab==="dashboard"&&<Dashboard[^>]*surface="home"/.test(app) && /tab==="board"&&<Dashboards/.test(app));
  ok("Dashboard sits directly under Home in the sidebar, not buried in a group",
     /navItem\(home\)\}[\s\S]{0,400}?navItem\(board\)/.test(app));
  ok("…and is reachable on mobile", /const MORE_TABS=\[\s*\n\s*\{id:"board"/.test(app));

  // ── §4 · names on the at-risk count (live) ───────────────────────────────
  console.log("\n— §4 · the count finally says who —");
  const bcrypt = require("bcryptjs");
  const TABLES = ["threads", "recurring_subscriptions", "payment_recovery_events", "digest_sends", "tasks",
                  "interactions", "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, name, slug, email] of [[ORG, "B86 Org", "b86", "b86@test.local"], [ORG2, "B86 Other", "b86two", "b86two@test.local"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, ["u_" + id, id, email, hash]);
  }
  for (const [did, org, nm] of [["d_b86_a", ORG, "Failing Frida"], ["d_b86_b", ORG, "Stopped Sam"], ["d_b86_x", ORG2, "Other Org Donor"]])
    await q(`INSERT INTO donors (id,org_id,name,stage) VALUES ($1,$2,$3,'steward')`, [did, org, nm]);
  const sub = (id, org, donor, amt, status) =>
    q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,first_failed_at)
       VALUES ($1,$2,$3,$4,$5,'month',$6,NOW() - INTERVAL '2 days')`, [id, org, donor, "sub_" + id, amt, status]);
  await sub("rs_b86_a", ORG, "d_b86_a", 40, "past_due");
  await sub("rs_b86_b", ORG, "d_b86_b", 25, "recovering");
  await sub("rs_b86_x", ORG2, "d_b86_x", 99, "past_due");

  const tok = await login("b86@test.local");
  const h = (await api("GET", "/recurring/health", tok)).body;
  ok("the at-risk count arrives with the donors on it", Array.isArray(h.atRisk) && h.atRisk.length === 2, h.atRisk);
  ok("…and every row carries a name, an amount and when it started failing",
     h.atRisk.every(r => r.donor_name && r.amount != null && r.first_failed_at), h.atRisk);
  ok("the names match the count that was already there", h.atRisk.length === h.atRiskCount, { n: h.atRisk.length, count: h.atRiskCount });
  ok("it is capped, so a shop with hundreds gets a queue not a dump", h.atRisk.length <= 6);
  const names = h.atRisk.map(r => r.donor_name);
  ok("NO other org's donor is in the list", !names.includes("Other Org Donor"), names);

  const tok2 = await login("b86two@test.local");
  const h2 = (await api("GET", "/recurring/health", tok2)).body;
  ok("the other org sees only its own", h2.atRisk.length === 1 && h2.atRisk[0].donor_name === "Other Org Donor", h2.atRisk);

  // A cancelled subscription is not "needing you" — it is decided.
  await q(`UPDATE recurring_subscriptions SET status='canceled' WHERE id='rs_b86_a'`);
  const h3 = (await api("GET", "/recurring/health", tok)).body;
  ok("a cancelled monthly gift drops off the list — it is decided, not waiting",
     h3.atRisk.length === 1 && h3.atRisk[0].donor_name === "Stopped Sam", h3.atRisk);

  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });

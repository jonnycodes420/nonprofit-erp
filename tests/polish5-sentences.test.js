// polish5-sentences — POLISH-5. EVERY SENTENCE READS LIKE A PERSON WROTE IT.
//
// The walks of 4–5 Nov found words glued together all over the app ("emails
// withMarlowe", "worth$500", "$165this 12 mo.", "$16,000.From a few donors").
// This suite opens every tab and every donor-profile tab of a fresh org that
// holds the real-shaped files (the gift history and the contacts list), plus
// the key dialogs, and reads what a person reads (innerText). It fails on:
//   · a letter or digit glued to a "$" ("worth$500", "$165this");
//   · a capital glued after a lowercase word ("toMarlowe");
//   · a period glued to the next word ("$16,000.From").
// Real words like "iPhone" and product names are allow-listed below.
//
// The other legs pin the rest of the brief, each red on main:
//   §3 a displayed date is the org's day (the clock pinned to 8 PM Eastern,
//      when UTC is already the next day);
//   §4 the copy list.
//
// Standard scratch stack (tests/README.md), browser legs need the local dist.
// Sends nothing. Its own fixture orgs; never the demo.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const BASE = process.env.BASE || "http://localhost:5601";
const XLSX = require(path.join(ROOT, "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "real-shaped");
const PASSWORD = "loadtest1234";
const ORG = "org_polish5_glue";
const PROFILE_TABS = ["activity", "giving", "conversations", "emails", "tasks", "notes", "files"];

// ── the glue rules ────────────────────────────────────────────────────────
// Words that really are written with an inner capital. Matched on the whole
// token, so "toMarlowe" is never excused by "Marlowe".
const { glued, INNER_CAPS } = require("./lib/glued");   // POLISH-6: shared with polish6


// In the page: every block (its nearest non-inline ancestor) as [rendered
// text, text-node-by-text-node trimmed text]. Form controls are left out.
const SEAMS = () => {
  // a node-by-node reader keeps a node's own spaces but not one standing alone
  const out = new Map();
  const blockOf = el => { while (el && el !== document.body) { const d = getComputedStyle(el).display; if (!/^inline/.test(d) || /^(BUTTON|LABEL|TD|TH|LI)$/.test(el.tagName)) return el; el = el.parentElement; } return document.body; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) { if (n.tagName === "BR") { const e = out.get(blockOf(n.parentElement)); if (e) { e[0] += "\n"; e[1] += "\n"; } } continue; }
    const p = n.parentElement;
    if (!p || p.closest("script,style,noscript,select,option,textarea,svg,[aria-hidden=true]")) continue;
    const r = p.getClientRects(); if (!r.length || getComputedStyle(p).visibility === "hidden") continue;
    const b = blockOf(p);
    const e = out.get(b) || out.set(b, ["", ""]).get(b);
    const t = n.textContent;
    e[0] += t;
    // the seams a node-by-node reader loses: a node that is only a space, and
    // the edge between two text nodes side by side in one element
    if (!t.trim()) continue;
    const prevText = n.previousSibling && n.previousSibling.nodeType === 3 && n.previousSibling.textContent.trim();
    const nextText = n.nextSibling && n.nextSibling.nodeType === 3 && n.nextSibling.textContent.trim();
    e[1] += (prevText ? t.replace(/^\s+/, "") : t).replace(nextText ? /\s+$/ : /$^/, "");
  }
  return [...out.values()].map(([a, b]) => [a.replace(/[ \t]+/g, " ").trim(), b]).filter(([a]) => a);
};

// ── the fixture org: the real-shaped gift history and contacts ────────────
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return (await api("POST", "/auth/login", null, { email, password: PASSWORD })).body;
}
let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, file)), { type: "buffer", cellDates: true }), XLSX);
}
async function importFile(tok, file) {
  const body = { fileName: file, sheets: await sheetsOf(file) };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { ok: false, why: [u.status, r.status, JSON.stringify(r.body).slice(0, 200)] };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { ok: j.body.status === "done", importId: r.body.importId, why: j.body.status };
    if (performance.now() - t0 > 120000) return { ok: false, why: "timeout" };
    await new Promise(res => setTimeout(res, 200));
  }
}

function tabs() {
  const src = fs.readFileSync(path.join(ROOT, "client", "src", "lib", "tabRegistry.js"), "utf8");
  const ids = new Set();
  const m = /const TABS\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  for (const line of (m ? m[1] : "").split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    const id = /\{\s*id\s*:\s*"([^"]+)"/.exec(line);
    if (id && id[1] !== "portal") ids.add(id[1]);
  }
  return [...ids];
}

async function walkForGlue(chromium, auth, donorIds) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
    [auth.token, JSON.stringify(auth.user), JSON.stringify(auth.org)]);
  const page = await ctx.newPage();
  const found = new Map();
  const read = async where => {
    await page.waitForTimeout(400);
    // Two readings of each block: as rendered (spaces where the page has them)
    // and as a reader that takes each text node on its own, trimmed. A space
    // that lives only at the edge of a text node is lost in the second, which
    // is how "worth {money}" read "worth$500". A glue in the second reading
    // that is not in the first is a sentence whose space is fragile.
    const blocks = await page.evaluate(SEAMS).catch(() => []);
    for (const [shown, read] of blocks) {
      const real = new Set(glued(shown).map(g => g.replace(/^[^:]+: /, "")));
      for (const g of glued(read)) if (!real.has(g.replace(/^[^:]+: /, "")) && !found.has(g)) { found.set(g, where); if (process.env.GLUE_DEBUG) console.log("      block:", JSON.stringify(shown).slice(0, 300)); }
      for (const g of glued(shown)) if (!found.has(g)) found.set(g, where);
    }
  };
  const urls = [];
  for (const t of tabs()) urls.push([t, `/app/${t}`]);
  for (const id of donorIds) for (const t of PROFILE_TABS) urls.push([`profile ${t}`, `/donors/${id}?tab=${t}`]);
  urls.push(["data health", "/app/donors?view=health"], ["imports", "/app/settings?section=imports"], ["settings connections", "/app/settings?section=connections"],
    ["settings security", "/app/settings?section=security"], ["settings receipts", "/app/settings?section=receipts"]);
  for (const [what, url] of urls) {
    await page.goto(APP + url, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await read(what);
  }
  await browser.close();
  return [...found].map(([g, w]) => `${w}: ${g}`);
}

// ── §2–§4, each red on main ───────────────────────────────────────────────
const SRC = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const lib = rel => import(path.join(ROOT, rel)).catch(() => ({}));
// 8 PM Eastern on Nov 3, 2026: UTC is already Nov 4.
const EIGHT_PM_EASTERN = "2026-11-04T01:00:00.000Z";

async function moneyAndDates() {
  // §2 money in sentences: whole dollars for an average, cents for one gift
  const SA = await import(path.join(ROOT, "shared", "smartAmounts.js"));
  const avg = SA.suggestedAskCents({ largestCents: 1000000, lastThreeCents: [1500000, 1000000, 750000] });
  ok("§2 an average in a sentence is whole dollars (\"last 3 averaged $10,833\")", avg && /last 3 averaged \$10,833\b(?!\.)/.test(avg.sentence), avg && avg.sentence);
  const one = SA.suggestedAskCents({ largestCents: 25050, lastThreeCents: [25050] });
  ok("§2 one gift keeps its cents (\"last gift was $250.50\")", one && /last gift was \$250\.50/.test(one.sentence), one && one.sentence);
  const AI = await lib("client/src/lib/amountInput.js");
  ok("§2 the award step's amount box reads 10,000.00, and sends 10000.00", AI.toAmountInput && AI.toAmountInput(1000000) === "10,000.00" && AI.fromAmountInput("10,000.00") === "10000.00",
    AI.toAmountInput && AI.toAmountInput(1000000));
  ok("§2 the award step starts from that box", /toAmountInput\(grant\.askCents\)/.test(SRC("client/src/components/GrantAward.jsx")), "");

  // §3 a displayed date is the org's day; the clock is 8 PM Eastern
  const OD = await lib("client/src/lib/orgDay.js");
  const OT = await lib("client/src/lib/orgToday.js");
  if (OT.setOrgTimezone) OT.setOrgTimezone("America/New_York");
  ok("§3 an undo at 8 PM Eastern on Nov 3 reads Nov 3, not the UTC Nov 4", OD.displayOrgDate && OD.displayOrgDate(EIGHT_PM_EASTERN) === "Nov 3, 2026",
    OD.displayOrgDate && OD.displayOrgDate(EIGHT_PM_EASTERN));
  ok("§3 a DATE column (midnight UTC) keeps its own day", OD.displayOrgDate && OD.displayOrgDate("2026-11-04T00:00:00.000Z") === "Nov 4, 2026" && OD.displayOrgDate("2026-11-04") === "Nov 4, 2026", "");
  if (OT.setOrgTimezone) OT.setOrgTimezone("America/Los_Angeles");
  ok("§3 the org's zone, not the browser's: 5 PM Pacific is still Nov 3", OD.displayOrgDate && OD.displayOrgDate(EIGHT_PM_EASTERN) === "Nov 3, 2026", "");
  if (OT.setOrgTimezone) OT.setOrgTimezone("");
  ok("§3 Imports › Undone reads the org's day", /Undone \$\{displayOrgDate\(open\.reversedAt\)\}/.test(SRC("client/src/components/settings/ImportsHistory.jsx")), "");
  ok("§3 the timeline dates a meeting by the org's day, never toISOString", !/new Date\(m\.startsAt\)\.toISOString\(\)/.test(SRC("client/src/components/MeetingPanels.jsx")), "");
  ok("§3 an import still running is dated by the org's day", !/committedOn: new Date\(j\.started_at\)\.toISOString\(\)/.test(SRC("server/imports/routes.js")), "");
}

async function copyList(auth) {
  const MS = await lib("client/src/lib/moveSentence.js");
  const said = MS.moveSentence && MS.moveSentence({ channel: "Visit", when: { words: "between Nov 5, 2026 and Dec 5, 2026" } }, "Marlowe", "Upgraded on their own");
  ok("§4 the next move is a sentence: \"Visit Marlowe between …\", not \"Upgraded on their own: visit\"", said === "Visit Marlowe between Nov 5, 2026 and Dec 5, 2026."
    && /moveSentence\(how, firstName, m\.title\)/.test(SRC("client/src/components/Insights.jsx")), said);
  ok("§4 the closeness sentence's period rides with its last fact", /dp-closeness-last/.test(SRC("client/src/components/ProfileStatus.jsx"))
    && !/\{c\.facts\.length \? "\." : ""\}/.test(SRC("client/src/components/ProfileStatus.jsx")), "");
  ok("§4 an empty merge list is not \"Moves to the kept record: .\"", /names\.length \? `Moves to the kept record:/.test(SRC("client/src/components/DataHealth.jsx")), "");
  const DN = await import(path.join(ROOT, "shared", "draftNote.js"));
  const note = DN.thankYouDraft({ donorName: "Ana Reyes", giftCents: 5000, orgName: "Glue Check Shelter", giftCountBefore: 6 }).body;
  ok("§4 the thank-you draft never says \"That is 7 now\"", !/That is \d+ now/.test(note) && /7 gifts/.test(note), note);
  ok("§4 Two-factor never shows without its status word", !/Two-factor is <strong>\{st \?/.test(SRC("client/src/components/SecurityPanel.jsx")) && /security-2fa-loading/.test(SRC("client/src/components/SecurityPanel.jsx")), "");
  const RB = await lib("client/src/lib/receiptBadge.js");
  const off = RB.receiptBadge && RB.receiptBadge(true, [{ key: "gift_receipt", on: false }, { key: "year_end", on: false }]);
  ok("§4 Tax Receipts with both switches off does not say Enabled", off && !off.on && !/enabled/i.test(off.words)
    && /receiptBadge\(form\.receiptsEnabled/.test(SRC("client/src/components/settings/TaxReceiptsManager.jsx")), off);
  const IE = await lib("client/src/lib/impactExample.js");
  const ex = IE.impactExample && IE.impactExample("Your ${amount} has covered {n} full-year scholarships", 2500);
  ok("§4 Settings' impact text has no raw placeholder", ex === "Your $2,500 has covered 1 full-year scholarship" && !/\{m\.outcome_template\}/.test(SRC("client/src/components/Settings.jsx")), ex);
  ok("§4 Peer-to-peer never says \"in cents\" on screen", !/[^/*]\bin cents;/.test(SRC("client/src/components/PeerToPeer.jsx").split("\n").filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n")), "");
  const IL = await lib("client/src/lib/internalLabels.js");
  ok("§4 a profile shows no \"demo-file\" tag and no BUILD-89 note", IL.shownTags && JSON.stringify(IL.shownTags(["demo-file", "board", "BUILD-89"])) === '["board"]'
    && IL.shownNote("From the demo file (BUILD-89).") === "" && /shownTags\(donor\.tags\)/.test(SRC("client/src/components/profile/RailAbout.jsx")), IL.shownTags && IL.shownTags(["demo-file", "board"]));
  ok("§4 no \"Tell Atlas about undefined\" or \"Add a photo for undefined\"", /about \$\{donor\.name \|\| "this person"\}/.test(SRC("client/src/components/profile/ProfileHeader.jsx"))
    && /donor && donor\.name \? `Tell me what happened with/.test(SRC("client/src/components/TellSteward.jsx")) && /donor\.name\|\|"this person"/.test(SRC("client/src/components/profile/ProfilePhoto.jsx")), "");
  const NN = await import(path.join(ROOT, "shared", "nearNames.js"));
  const church = NN.nearDuplicate("First Baptist Church", "Fist Baptist Church");
  ok("§4 Data health speaks of a church's name, not its first name", church && !/first name/.test(church.sentence), church);
  const person = NN.nearDuplicate("Marlowe Blackwood", "Marlow Blackwood");
  ok("§4 …and still of a person's first name", person && /first names/.test(person.sentence), person);
  ok("§4 the Grants BCC banner is a small \"Log emails\" link with a popover", /Log emails/.test(SRC("client/src/components/GrantEmailPath.jsx")) && /grant-email-path-popover/.test(SRC("client/src/components/GrantEmailPath.jsx")), "");

  // the Insights thank-you names the header's Last gift. A made-up donor who
  // moved up, whose biggest recent gift ($5,000) is not their last ($400):
  // on main the card thanked them for the $5,000 the header never shows.
  const up = await api("POST", "/donors", auth.token, { name: "Odalys Fernwright", email: "odalys.fernwright@example.org" });
  const upId = up.body && (up.body.id || (up.body.donor && up.body.donor.id));
  for (const [amount, date] of [[300, "2024-11-15"], [200, "2025-06-01"], [5000, "2026-02-10"], [400, "2026-09-20"]])
    await api("POST", `/donors/${upId}/gifts`, auth.token, { amount, date });
  for (let i = 0; i < 40; i++) {   // INSIGHTS-2: the org's Insights rebuild on the worker after a gift
    const r = await api("GET", `/insights/donor/${upId}`, auth.token);
    if (r.status === 200 && r.body && !r.body.preparing) break;
    await new Promise(res => setTimeout(res, 1500));
  }
  const moves = await q(`SELECT d.id, d.last_gift_amount FROM donors d WHERE d.org_id=$1 AND d.last_gift_amount IS NOT NULL ORDER BY (d.id=$2) DESC, d.total_giving DESC LIMIT 60`, [ORG, upId]);
  let checked = 0, wrong = [], sawUp = false;
  for (const d of moves) {
    const r = await api("GET", `/insights/donor/${d.id}`, auth.token);
    const m = r.body && r.body.move;
    if (!m || m.kind !== "upgraded" || !m.item || !m.item.how || !m.item.how.say) continue;
    checked++; if (d.id === upId) sawUp = true;
    const said = (/Your gift of (\$[\d,]+(?:\.\d\d)?)/.exec(m.item.how.say) || [])[1];
    const header = "$" + Number(d.last_gift_amount).toLocaleString("en-US", Number.isInteger(Number(d.last_gift_amount)) ? {} : { minimumFractionDigits: 2 });
    if (said && said !== header) wrong.push(`${d.id}: says ${said}, header ${header}`);
  }
  ok(`§4 the Insights thank-you names the header's last gift (${checked} upgraded moves read)`, sawUp && wrong.length === 0, wrong.slice(0, 5));
}

async function main() {
  await moneyAndDates();
  ok("the glue rules catch the walk's examples", ["emails withMarlowe", "worth$500", "$165this 12 mo.", "$16,000.From a few donors", "Barnaby BlackwoodintoBarnaby Vasquez"].every(s => glued(s).length > 0),
    ["emails withMarlowe", "worth$500"].map(s => glued(s)));
  ok("the glue rules pass ordinary sentences", glued("Averaged $10,833 over 3 gifts. Next, call Ana about her iPhone. LYBUNT donors: $2.5K. stewardapp.dev").length === 0,
    glued("Averaged $10,833 over 3 gifts. Next, call Ana about her iPhone. LYBUNT donors: $2.5K. stewardapp.dev"));

  const auth = await freshOrg(ORG, "Glue Check Shelter");
  const g = await importFile(auth.token, "jp-gift-history-287.xlsx");
  ok("§1 the gift history imports", g.ok, g.why);
  const c = await importFile(auth.token, "jp-contacts-656.xlsx");
  ok("§1 the contacts import", c.ok, c.why);
  const ids = (await q(`SELECT d.id FROM donors d JOIN gifts g ON g.donor_id=d.id WHERE d.org_id=$1 GROUP BY d.id ORDER BY SUM(g.amount) DESC LIMIT 3`, [ORG])).map(r => r.id);
  await copyList(auth);

  let chromium = null;
  const distOk = fs.existsSync(path.join(DIST, "index.html"));
  try { ({ chromium } = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"))); } catch {}
  if (!chromium || !distOk) browserLegOrSkip(!chromium ? "Playwright not found" : "client/dist not built");
  else {
    const glue = await walkForGlue(chromium, auth, ids);
    for (const g of glue) console.log("    glued · " + g);
    ok(`§1 no glued words on any page (${glue.length} found)`, glue.length === 0, glue.slice(0, 60).join("\n  "));
  }
  summary();
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => closeDb());

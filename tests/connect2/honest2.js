// tests/connect2/honest2.js: HONEST-2. BADGES, PUBLIC PAGES AND SETTINGS ONLY CLAIM WHAT'S TRUE,
// AND NO BUTTON LOOPS OR DIES. A part of connect2-sources (the integrations suite), no new suite.
//
//   §1  The census: every client surface that names a connection's state reads the one status
//       (server/connections/status.js, through flowParts.jsx). A new file drawing "Connected" or
//       "Healthy" on its own fails here. In a demo org a connection's badge is "Example" and its line
//       opens "Example: connecting is off in the demo."; a statement import says when it came in.
//   §3  Choose a plan / Upgrade land on Settings → Billing: no in-app link to the public pricing page,
//       the Billing section exists, and GET /billing/invoices answers with a sentence.
//   §4  Giving levels: blank and over-long values are refused with a message for the field (no 500);
//       the Atlas AI pointer names Your Data only when the switch is there; the Major gifts copy is a
//       full sentence; a revoked invite leaves the list at once.
//   §5  Suggested amounts typed 25, 50, 999, 250, 500 are saved and shown ascending.
//   §6  A draft carrying a note's label ("QA", "TEST", "About:") or naming nobody is refused, and a
//       draft built from an About note carries its meaning without the label, and the person's name.
//
// HOW IT GOES RED (run against main first): Finance, the Stripe payments panel, the source tile and
// the setup steps said "Connected" on their own (§1 census); a demo card said Working (§1); the
// statement card said "brought in ." (§1); Choose a plan was <a href="/pricing"> and there was no
// Billing section (§3); a 40-digit level answered 500 (§4); the ladder kept 25, 50, 999, 250, 500
// (§5); guardDraft passed "QA A1 About:" and a draft to nobody (§6).

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { testNow } = require("../clock");

const ORG = "org_c2hon2";
const ADMIN = "admin@c2hon2-fixture.org";
const ROOT = path.join(__dirname, "..", "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const TABLES = ["gifts", "giving_sources", "imports", "donors", "portal_settings", "users"];
const DAY = 86400000;

async function reset(q) {
  for (let i = 0; i < 6; i++) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
    await new Promise(r => setTimeout(r, 300));
  }
}

// Every client file outside the public site that writes a connection-state word of its own.
function censusHits() {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/marketing|node_modules/.test(f)) walk(f); }
      else if (/\.jsx?$/.test(e.name)) files.push(f);
    }
  })("client/src");
  const RE = /(?:^|[^\w])(?:>\s*(?:Stripe\s+)?(?:Connected|Healthy)\s*<|["'`](?:Stripe )?(?:Connected|Healthy)["'`]|<Status>Connected|>\s*Connected as\b)/;
  // A FlowWord's fallback (shown only until the card's flow has loaded) is the flow's own reader, not a word of its own.
  return files.filter(f => read(f).split("\n").some(l => RE.test(l.replace(/fallback=(["'])Connected\1/g, "")) && !/^\s*\/\//.test(l)));
}
// Files allowed to carry the word, and why. Anything else is a surface drawing a state of its own.
const CENSUS_OK = {
  "client/src/components/connections/flowParts.jsx": "the one place the flow words live",
  "client/src/components/ProfileRail.jsx": "the profile's 'Connected' section is related people, not a connection",
  "client/src/components/settings/GivingSourcesManager.jsx": "STATE_LABEL.connected is FlowWord's fallback and the tile's aria words",
  "client/src/components/InboxConnect.jsx": "a person's own mailbox address ('Connected as ada@…'), not a status.js connection",
  "client/src/pages/setup/ui.jsx": "the setup Email step's 'Connected as <mailbox>' (a person's inbox); QuickBooks there reads FlowWord",
};

async function run({ ok, login, api, q }) {
  const now = testNow();
  await reset(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,timezone,mission)
           VALUES ($1,'Honest Two Demo','honest-two-demo',1,'active','team','demo','UTC','We teach sailing to kids on the harbor. Every summer, free.')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_c2hon2',$1,$2,$3,'Hon Two','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,status,created_by,created_by_name) VALUES ('d_hon2',$1,'Ada Ferris','active','system:test','honest2 suite')`, [ORG]);
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status,last_synced_at,created_by,created_by_name)
           VALUES ('gs_hon2_gb',$1,'givebutter','Givebutter','active',$2,'system:test','honest2 suite')`, [ORG, new Date(now - DAY)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,giving_source_id,created_by,created_by_name)
           VALUES ('g_hon2',$1,'d_hon2',30,$2,'online','gs_hon2_gb','system:test','honest2 suite')`, [ORG, new Date(now - 3 * DAY).toISOString().slice(0, 10)]);
  await q(`INSERT INTO imports (id,org_id,name,shape,committed_at) VALUES ('imp_hon2',$1,'bank.csv','statement',$2)`, [ORG, new Date(now - 2 * DAY)])
    .catch(e => ok("§1 fixture import", false, e.message));
  const tok = await login(ADMIN);

  // ── §1 · the census, the demo example, the statement line ─────────────────
  const hits = censusHits().map(f => f.split(path.sep).join("/"));
  const strays = hits.filter(f => !CENSUS_OK[f]);
  ok("§1 census: no client surface draws a connection state of its own (it reads the flow)", strays.length === 0, strays);
  ok("§1 census: Finance, the Stripe payments panel, the source tile and the setup steps read FlowWord",
    /<FlowWord kind="own_stripe"/.test(read("client/src/components/Finance.jsx")) && /<FlowWord kind="own_stripe"/.test(read("client/src/components/Settings.jsx"))
    && /<FlowWord provider=\{logoKey\}/.test(read("client/src/components/settings/GivingSourcesManager.jsx"))
    && /<FlowWord provider=\{p\.key\}/.test(read("client/src/pages/setup/StepsConnect.jsx")) && /<FlowWord provider=\{flowProvider\}/.test(read("client/src/pages/setup/ui.jsx")));
  ok("§1 census: the help assistant says a connection's state from the flow", /connectionsFor\(/.test(read("routes/support.js")) && /c\.flow\.label/.test(read("support/engine.js")));
  const r = await api("GET", "/connections", tok);
  const cards = (r.body && r.body.cards) || [];
  const gb = cards.find(c => c.provider === "givebutter" && c.connected);
  ok("§1 a demo org's connection says Example, connecting is off in the demo, never Connected or Working",
    !!gb && gb.flow && gb.flow.label === "Example" && gb.flow.example === true && /^Example: connecting is off in the demo\./.test(gb.flow.sentence), gb && gb.flow);
  const st = cards.find(c => c.kind === "statements");
  ok("§1 a statement import says when the last file came in (never \"brought in .\")",
    !!st && st.flow && /^The last file was brought in (today|yesterday|\d+ days ago)\.$/.test(st.flow.sentence) && st.flow.label !== "Example", st && st.flow);
  const start = await api("POST", "/oauth/mailchimp/start", tok, {});
  ok("§1 connecting really is off in a demo org (any provider), so the Example line is true",
    start.status === 409 || start.status === 503, start.status);

  // ── §3 · Choose a plan lands on Billing ───────────────────────────────────
  const inApp = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/marketing|node_modules/.test(f)) walk(f); }
      else if (/\.jsx?$/.test(e.name) && /(href=|navigate\(|to=)\s*["'{`]*\/pricing\b/.test(read(f)) && !/LostAndFound\.jsx$/.test(f)) inApp.push(f);
    }
  })("client/src");
  ok("§3 no Choose a plan or Upgrade in the app links to the public pricing page", inApp.length === 0, inApp);
  ok("§3 Settings has a Billing section, and Upgrade, the trial banner and Team's plan link land on it",
    /\{id:"billing",label:"Billing"/.test(read("client/src/components/settings/settingsTabs.js"))
    && /section==="billing"&&/.test(read("client/src/components/Settings.jsx"))
    && /tabHref\("settings", \{ section: "billing" \}\)/.test(read("client/src/components/UpgradeModal.jsx"))
    && (read("client/src/App.jsx").match(/navigateTo\("settings",\{section:"billing"\}\)/g) || []).length >= 3
    && /setSection\("billing"\)/.test(read("client/src/components/Settings.jsx")));
  ok("§3 Billing offers 'Talk to Jonathan about changing plans', since there are no public prices",
    /Talk to Jonathan about changing plans/.test(read("client/src/components/settings/BillingMore.jsx")) && /<PlanTalkLink\/>/.test(read("client/src/components/Settings.jsx")));
  const inv = await api("GET", "/billing/invoices", tok);
  ok("§3 GET /billing/invoices answers the admin with a list and, when empty, a sentence", inv.status === 200 && Array.isArray(inv.body.invoices) && (inv.body.invoices.length || !!inv.body.sentence), inv);

  // ── §4 · Settings has no dead ends ─────────────────────────────────────────
  const blank = await api("PUT", "/settings/giving-levels", tok, { mid: "", major: "10000" });
  ok("§4 a blank giving level is refused with a message for its field",
    blank.status === 400 && Array.isArray(blank.body.errors) && blank.body.errors.some(e => e.field === "mid" && /blank/.test(e.message)), blank.body);
  const long = await api("PUT", "/settings/giving-levels", tok, { mid: "1000", major: "9".repeat(40) });
  ok("§4 an over-long giving level is refused with a message, never a 500",
    long.status === 400 && long.body.errors && long.body.errors.some(e => e.field === "major"), { status: long.status, body: long.body });
  const good = await api("PUT", "/settings/giving-levels", tok, { mid: "1,000", major: "$10,000" });
  ok("§4 …and good values still save", good.status === 200 && good.body.midCents === 100000 && good.body.majorCents === 1000000, good.body);
  ok("§4 the levels card shows each refusal under its field",
    /giving-level-error-/.test(read("client/src/components/settings/GivingLevelsCard.jsx")) && /e\.errors/.test(read("client/src/components/settings/GivingLevelsCard.jsx")));
  const atlas = read("client/src/components/AtlasSettings.jsx");
  ok("§4 Settings › Atlas points at Your Data only when the AI switch is there (AI turned off), and says there is no switch with no key",
    /status\.reason === "ai_disabled"/.test(atlas) && /status\.reason === "agent_unavailable"/.test(atlas) && !/The AI switch is in Your Data/.test(atlas));
  ok("§4 the Major gifts tab copy is a full sentence", !/>The tabs on the Major Gifts page\./.test(read("client/src/components/settings/OrgMenuEditor.jsx")));
  ok("§4 a revoked invite leaves the list the moment the revoke answers, and a late read can't bring it back",
    /gone\.current\.add\(i\.id\); setInvites\(list =>/.test(read("client/src/components/settings/InvitedList.jsx")) && /n === seq\.current/.test(read("client/src/components/settings/InvitedList.jsx")));

  // ── §5 · suggested amounts ascending ───────────────────────────────────────
  const put = await api("PUT", "/org-form/page/settings", tok, { settings: { onetimeAmounts: [25, 50, 999, 250, 500] } });
  ok("§5 one-time amounts typed 25, 50, 999, 250, 500 are saved ascending",
    put.status === 200 && JSON.stringify(put.body.draftSettings && put.body.draftSettings.onetimeAmounts) === "[25,50,250,500,999]", put.body);
  const page = await api("GET", "/org-form/page", tok);
  ok("§5 …and shown that way when the editor reads them back", JSON.stringify(page.body.draftSettings && page.body.draftSettings.onetimeAmounts) === "[25,50,250,500,999]", page.body.draftSettings);

  // ── §6 · no test text reaches a donor draft ───────────────────────────────
  const SG = await import(path.join(ROOT, "shared", "suggestionGuard.js"));
  const DA = await import(path.join(ROOT, "shared", "draftAbout.js"));
  const qa = SG.guardDraft("Thank you, Ada\nDear Ada,\n\nQA A1 About: loves the harbor boats.", { donor: { name: "Ada Ferris" } });
  ok("§6 suggestionGuard refuses a draft carrying a note's label (QA, About:)", !qa.ok && qa.reasons.some(x => /label/.test(x)), qa);
  ok("§6 …and TEST, and a label after a sentence", !SG.guardDraft("Dear Ada,\nTEST thanks.", { donor: { name: "Ada Ferris" } }).ok
    && !SG.guardDraft("Dear Ada, thank you. About: retired teacher.", { donor: { name: "Ada Ferris" } }).ok);
  const nobody = SG.guardDraft("Thank you\nDear friend,\n\nThank you so much for your gift.", { donor: { name: "Ada Ferris" } });
  ok("§6 a draft to a person that names nobody is refused", !nobody.ok && nobody.reasons.some(x => /who it is to/.test(x)), nobody);
  ok("§6 a merge tag names them at send, so it passes", SG.guardDraft("Dear {{first_name}},\n\nThank you so much.", { donor: { name: "Ada Ferris" } }).ok);
  const t = DA.draftTemplate({ firstName: "", fullName: "Ada Ferris", thanks: true, aboutThem: "QA A1 About: Her grandson Milo sails with Harbor Crew." });
  const tg = SG.guardDraft(`${t.subject}\n${t.body}`, { donor: { name: "Ada Ferris" } });
  ok("§6 a draft built from an About note names the person, carries the note's detail and no label, and passes the guard",
    /^Dear Ada,/.test(t.body) && /Milo/.test(t.body) && /Harbor Crew/.test(t.body) && !/QA|A1|About:/.test(t.body) && tg.ok, { body: t.body, tg });
  ok("§6 the model is never handed the label either", !/QA A1|About:/.test(DA.aboutInstruction("QA A1 About: Her grandson Milo sails.")));

  // ── §2 (public giving page) · Not open yet shows whose page it is ─────────
  const pub = await api("GET", "/org/honest-two-demo/public", null);
  ok("§2 a giving page that isn't open carries the org's name, its mission line and Opens soon",
    pub.status === 404 && pub.body.notOpen === true && pub.body.brand && /Honest Two Demo/.test(pub.body.brand.name || "")
    && /^We teach sailing to kids on the harbor\./.test(pub.body.brand.mission || "") && pub.body.brand.opensSoon === "Opens soon", pub.body);
  ok("§2 no placeholder video ships in the seed or default content",
    !/aqz-KE-bpKQ|eRsGyueVLvQ|R6MlUcmOul8/.test(read("scripts/ci/seed-demo.js") + read("scripts/seed/email1-demo.js")));
  await reset(q);
}

module.exports = { run };

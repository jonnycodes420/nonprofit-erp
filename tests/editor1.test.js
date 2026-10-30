// tests/editor1.test.js · EDITOR-1. ONE STEWARD EDITOR FOR PAGES AND EMAIL.
//
// The build's one test. It earns its place under CLAUDE.md's rule because it
// guards donor email and what a donor sees: the words typed in the editor's
// preview are the words the template keeps (and a field typed as a chip stays
// a field, never one person's name), a receipt's tax lines cannot be edited
// or dropped, a campaign says truthfully who it can reach and can never be
// sent while Donor mail is off, a time that has gone is never a schedule, and
// every photo Steward puts on a page is one it is licensed to use.
//
//   §1  a receipt's tax block is locked: a save without it, or with it
//       changed, is refused; the editable preview never marks it.
//   §2  the editable preview: fields are chips filled for the person it is
//       previewed as ("Preview as"), the words are marked, a plain preview
//       carries neither; a campaign's unsaved blocks preview the same way.
//   §3  typed in the preview, saved, reopened: the browser types into the
//       thank-you's preview, puts a field in from "+ Field", saves, and the
//       template (and the store every draft reads) holds the words with the
//       field as {{first_name}}. In the receipt the tax block has no Remove.
//   §4  the campaign audience adds up: total = can get it + every reason, and
//       while Donor mail is off nobody can get it, the people it would reach
//       are one reason, and Send is disabled with that sentence.
//   §5  Send it later starts empty, and a time that has gone is refused by
//       the server (POST and PUT).
//   §6  a campaign's own blocks save, and nothing is sent: no recipient row.
//   §7  CAMPAIGN-2's give-only blocks (countdown, matching challenge, recent
//       gifts) save in a draft (they were "Unknown widget type.").
//   §8  the event page preview is the page, marked to type in; another org's
//       event is a 404.
//   §9  stock photos: every photo has its license row and every row its
//       photo; mission words pick the group; a new giving page and a new event
//       start with a stock photo from the org's group (tests/lib/stockPhotosCheck.js).
//
// RED ON MAIN (1e383a1): §1's editable preview, §2, §4 (no `audience`), §5
// (a past time is accepted), §6 (emailBlocks ignored), §7 ("Unknown widget
// type."), §8 (no preview route), §9 (no stock photos) and the whole browser
// leg (no shell). Planted and watched go red: chips rendered as plain text
// (§2, §3: the saved words held "Maria"), the org group left out of the
// audience (§4 total no longer adds up), and the past-time check removed (§5).
//
// Never the demo org. Nothing here sends: Donor mail is off for the fixture
// org except in §4's one check, and that check only reads the audience.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const S = require("./lib/stockPhotosCheck");

const ORG = "org_editor1", ORG2 = "org_editor1_other";
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function fixture(org, slug, name, mission) {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,mission,emails_enabled,staff_mail_enabled)
           VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York',$4,false,false)`, [org, name, slug, mission]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Hale','admin')`,
    ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
  return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
}

(async () => {
  const a = await fixture(ORG, "editor1-riders", "Editor One Riders", "Therapeutic riding for kids with disabilities, with our horses and volunteers.");
  const TOK = a.token;
  ok("fixture org signs in", !!TOK, a);
  // Six people: three who can get email, two with no address, one whose automatic email is off.
  const people = [["d_e1_maria", "Maria Lopez", "maria@example.org", true], ["d_e1_ben", "Ben Ortiz", "ben@example.org", true], ["d_e1_ada", "Ada Kim", "ada@example.org", true],
    ["d_e1_noel", "Noel Park", null, true], ["d_e1_iris", "Iris Wu", null, true], ["d_e1_sam", "Sam Reyes", "sam@example.org", false]];
  for (const [id, name, email, auto] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,auto_email,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`, [id, ORG, name, email, auto]);
  }
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_e1_maria',$1,'d_e1_maria',125,'2026-09-14','system:test','test')`, [ORG]).catch(e => ok("seed gift", false, e.message));

  // ── §1 · the receipt's tax block is locked ───────────────────────────────
  const rc = await api("POST", "/email-templates", TOK, { starterKey: "person_receipt" });
  const rid = rc.body.template && rc.body.template.id;
  const rblocks = (rc.body.template && rc.body.template.blocks) || [];
  ok("§1 the receipt opens as blocks with one locked tax block", rblocks.filter(b => b.locked).length === 1, rblocks.map(b => b.type + (b.locked ? "*" : "")));
  const dropped = await api("PUT", `/email-templates/${rid}`, TOK, { blocks: rblocks.filter(b => !b.locked) });
  ok("§1 a save without the tax block is refused", dropped.status === 400 && dropped.body.error === "locked_block", dropped.body);
  const changed = await api("PUT", `/email-templates/${rid}`, TOK, { blocks: rblocks.map(b => (b.locked ? { ...b, blocks: [{ type: "p", text: "No tax words" }] } : b)) });
  ok("§1 a save with the tax words changed is refused", changed.status === 400 && changed.body.error === "locked_block", changed.body);
  const rprev = await api("POST", `/email-templates/${rid}/preview`, TOK, { editable: true });
  const lockedRows = (rprev.body.html || "").split(/<tr /).filter(r => /data-st-locked="1"/.test(r));
  ok("§1 the editable preview never marks the tax block to type in", lockedRows.length > 0 && lockedRows.every(r => !/data-st-edit=/.test(r.split("</tr>")[0])), lockedRows.length);

  // ── §2 · the editable preview: chips, marks, "Preview as" ─────────────────
  const ty = await api("POST", "/email-templates", TOK, { starterKey: "person_thanks_first" });
  const tid = ty.body.template && ty.body.template.id;
  const asMaria = await api("POST", `/email-templates/${tid}/preview`, TOK, { editable: true, as: "d_e1_maria" });
  const h = asMaria.body.html || "";
  ok("§2 previewed as a real person: the preview says whose it is", asMaria.body.as && asMaria.body.as.id === "d_e1_maria", asMaria.body.as);
  ok("§2 a field is a chip that keeps its field and shows her value", /<span class="st-chip" data-st-token="first_name"[^>]*>Maria<\/span>/.test(h), (h.match(/<span class="st-chip"[^>]*>[^<]*<\/span>/g) || []).slice(0, 3));
  ok("§2 her own last gift fills the gift field", /data-st-token="gift_amount"[^>]*>\$125/.test(h), (h.match(/data-st-token="gift_amount"[^>]*>[^<]*/) || [])[0]);
  ok("§2 the words are marked to be typed in", /data-st-edit="\d+\.blocks"/.test(h));
  const plain = await api("POST", `/email-templates/${tid}/preview`, TOK, {});
  ok("§2 a plain preview carries no marks and no chips", !/data-st-edit|st-chip/.test(plain.body.html || ""), (plain.body.html || "").length);
  const other = await fixture(ORG2, "editor1-other", "Editor One Other", "A food pantry.");
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ('d_e1_x',$1,'Xavier Other','x@example.org','system:test','test')`, [ORG2]);
  const cross = await api("POST", `/email-templates/${tid}/preview`, TOK, { editable: true, as: "d_e1_x" });
  ok("§2 another org's person is never previewed as", cross.status === 200 && !/Xavier/.test(cross.body.html || "") && (!cross.body.as || cross.body.as.id !== "d_e1_x"), cross.body.as);
  const cprev = await api("POST", "/email-preview", TOK, { editable: true, as: "d_e1_ben", subject: "Hello {{first_name}}",
    blocks: [{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{first_name}}, the barn roof is fixed." }] }, { type: "footer" }] });
  ok("§2 a campaign's unsaved blocks preview the same way, for the person chosen", cprev.status === 200 && /data-st-token="first_name"[^>]*>Ben</.test(cprev.body.html || "") && cprev.body.subject === "Hello Ben", { s: cprev.status, subject: cprev.body.subject });

  // ── §4 · the campaign audience adds up, and Send stays shut ───────────────
  const seg = await api("POST", "/campaigns/segment-preview", TOK, { segment: { mode: "all" } });
  const au = seg.body.audience || {};
  const sum = (au.groups || []).reduce((n, g) => n + g.count, 0);
  ok("§4 the audience is there", !!seg.body.audience, seg.body);
  ok("§4 the reasons add up to the segment: total = can get it + every reason", au.total === au.sendable + sum && au.total === seg.body.count + seg.body.leftOutCount, { au, count: seg.body.count, left: seg.body.leftOutCount });
  ok("§4 while Donor mail is off, nobody can get it and Send has its reason", au.sendable === 0 && /Donor mail is off for Editor One Riders/.test(au.blocked || ""), au.blocked);
  const offGroup = (au.groups || []).find(g => /^org_/.test(g.reason));
  ok("§4 the people it would reach are one reason, named, with its count", offGroup && offGroup.count === 3 && au.wouldReach === 3 && /can't get email while Donor mail is off for Editor One Riders/.test(offGroup.sentence), offGroup);
  ok("§4 no address is a reason with its people", (au.groups || []).some(g => g.reason === "no_email" && g.count === 2 && g.people.length === 2));
  ok("§4 the line reads as one sentence", /^6 donors · 0 can get this email: /.test(au.line || ""), au.line);
  // The org's switch is read through a five-second cache (routes/email.js
  // ORG_MAIL_GATE_TTL_MS), so each flip waits that out before it is asked.
  const gateTtl = () => new Promise(r => setTimeout(r, 5200));
  await q(`UPDATE orgs SET emails_enabled=true WHERE id=$1`, [ORG]);
  await gateTtl();
  const on = (await api("POST", "/campaigns/segment-preview", TOK, { segment: { mode: "all" } })).body.audience || {};
  await q(`UPDATE orgs SET emails_enabled=false WHERE id=$1`, [ORG]);
  await gateTtl();
  ok("§4 with Donor mail on, the same people can get it and it still adds up", on.sendable === 3 && !on.blocked && on.total === on.sendable + (on.groups || []).reduce((n, g) => n + g.count, 0), on);

  // ── §5 · Send it later: empty, and never in the past ─────────────────────
  const past = await api("POST", "/campaigns", TOK, { name: "Late", subject: "x", body: "<p>x</p>", segment: { mode: "all" }, scheduledAt: "2020-01-01T09:00" });
  ok("§5 a time that has gone is refused on create", past.status === 400 && past.body.error === "schedule_in_past", past.body);
  const draft = await api("POST", "/campaigns", TOK, { name: "Spring barn", subject: "Hello {{first_name}}", body: "<p>Hi</p>", segment: { mode: "all" } });
  const cid = draft.body.id;
  const past2 = await api("PUT", `/campaigns/${cid}`, TOK, { name: "Spring barn", subject: "x", body: "<p>x</p>", segment: { mode: "all" }, status: "scheduled", scheduledAt: "2020-01-01T09:00" });
  ok("§5 a time that has gone is refused when scheduling", past2.status === 400 && past2.body.error === "schedule_in_past", past2.body);

  // ── §6 · a campaign's own blocks save; nothing is sent ───────────────────
  const blocks = [{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{first_name}}, the horses say thank you." }] }, { type: "button", action: "give", label: "Give" }, { type: "footer" }];
  const put = await api("PUT", `/campaigns/${cid}`, TOK, { name: "Spring barn", subject: "Hello {{first_name}}", body: "<p>Dear {{first_name}}, the horses say thank you.</p>", segment: { mode: "all" }, status: "draft", emailBlocks: blocks, preheader: "From the barn" });
  const [row] = await q(`SELECT email_blocks, preheader, status FROM campaigns WHERE id=$1`, [cid]);
  ok("§6 the campaign keeps its own blocks and preview line", put.status === 200 && Array.isArray(row.email_blocks) && row.email_blocks.length === 4 && row.preheader === "From the barn" && row.status === "draft", { s: put.status, row });
  const bad = await api("PUT", `/campaigns/${cid}`, TOK, { name: "Spring barn", subject: "x", body: "", segment: { mode: "all" }, status: "draft", emailBlocks: [{ type: "nonsense" }] });
  ok("§6 blocks the email cannot carry are refused", bad.status === 400 && bad.body.error === "invalid_blocks", bad.body);
  const [sent] = await q(`SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE org_id=$1`, [ORG]);
  ok("§6 nothing was sent", sent.n === 0, sent);

  // ── §7 · CAMPAIGN-2's give-only blocks save in a draft ───────────────────
  const gp = await api("POST", "/giving-pages", TOK, { title: "Hay for winter" });
  const gpId = gp.body && gp.body.id;
  const d7 = await api("PUT", `/giving-pages/${gpId}/page/draft`, TOK, { widgets: [{ type: "countdown", heading: "" }, { type: "matchchallenge" }, { type: "recentgifts", count: 8, showAmounts: false, heading: "Recent gifts" }] });
  ok("§7 a draft with a countdown, a matching challenge and recent gifts saves", d7.status === 200 && Array.isArray(d7.body.draft) && d7.body.draft.length === 3, { s: d7.status, b: d7.body.error || d7.body.message });

  // ── §8 · the event page preview ──────────────────────────────────────────
  const ev = await api("POST", "/events", TOK, { name: "Barn open day", date: "2027-04-10", eventType: "community", description: "Meet the horses." });
  const evId = ev.body && ev.body.id;
  const ep = await api("GET", `/events/${evId}/page/preview`, TOK);
  ok("§8 the event page preview is the page, its name and description marked to type in", ep.status === 200 && /<h1 data-st-edit="name">Barn open day<\/h1>/.test(ep.body.html || "") && /data-st-edit="description"[^>]*>Meet the horses\./.test(ep.body.html || ""), ep.status);
  ok("§8 and it carries no inline script handler", !/ on[a-z]+="/.test(ep.body.html || ""));
  const ep2 = await api("GET", `/events/${evId}/page/preview`, other.token);
  ok("§8 another org's event is a 404", ep2.status === 404, ep2.status);

  // ── §9 · stock photos ────────────────────────────────────────────────────
  try { const r = await S.checkLicenses(); ok("§9 every bundled photo has its LICENSES.md row, and every row its photo", true, r); } catch (e) { ok("§9 every bundled photo has its LICENSES.md row, and every row its photo", false, e.message); }
  try { const r = await S.checkMissionGroups(); ok("§9 mission words pick the photo group", true, r); } catch (e) { ok("§9 mission words pick the photo group", false, e.message); }
  try { const r = await S.checkNewRowsGetStock({ base: BASE, token: TOK, q }); ok("§9 a new giving page and a new event start with a stock photo from the org's group", r.group === "animals", r); }
  catch (e) { ok("§9 a new giving page and a new event start with a stock photo from the org's group", false, e.message); }

  // ── §3 · the browser: typed in the preview, saved, reopened ──────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await ctx.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [TOK, JSON.stringify(a.user), JSON.stringify(a.org)]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message.slice(0, 160)));
    const FRAME = '[data-testid="email-preview-frame"]';
    const open = async id => {
      await page.goto(`${APP}/app/communications?subtab=templates&template=${id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator(FRAME).waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForFunction(s => { const f = document.querySelector(s); try { return f && f.contentDocument.querySelector("[data-st-edit]"); } catch { return false; } }, FRAME, { timeout: 15000 }).catch(() => {});
    };
    await open(tid);
    const f = page.frameLocator(FRAME);
    await f.locator("[data-st-rich]").first().click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" We saved you a seat, ");
    await page.click('[data-testid="field-menu"]');
    await page.click('[data-testid="field-first_name"]');
    await page.waitForTimeout(300);
    await page.click('[data-testid="editor-name"]');
    await page.waitForTimeout(700);
    await page.click('[data-testid="email-save"]');
    await page.waitForFunction(() => /^Saved/.test((document.querySelector('[data-testid="editor-status"]') || {}).innerText || ""), null, { timeout: 10000 }).catch(() => {});
    const after = (await api("GET", "/email-templates", TOK)).body.templates.find(t => t.id === tid);
    const words = (after.blocks || []).filter(b => b.type === "richtext" && !b.locked).flatMap(b => b.blocks.map(x => x.text || "")).join("\n");
    ok("§3 typed in the preview, the words are the template's", /We saved you a seat, \{\{first_name\}\}/.test(words), words.slice(-160));
    ok("§3 the field stayed a field: no person's name in the template", !/Maria|Robin/.test(words), words.slice(-160));
    const [mt] = await q(`SELECT body FROM message_templates WHERE org_id=$1 AND kind='thanks_first'`, [ORG]);
    ok("§3 and the store every thank-you draft reads holds them too", !!mt && /We saved you a seat, \{\{first_name\}\}/.test(mt.body), mt && mt.body.slice(-120));
    await open(tid);
    const shown = await page.evaluate(s => document.querySelector(s).contentDocument.body.innerText, FRAME);
    ok("§3 reopened, the preview shows them, the field filled", /We saved you a seat, Robin/.test(shown), shown.slice(0, 200));
    // The receipt: the tax block has no Remove handle.
    await open(rid);
    const handles = await page.evaluate(s => {
      const d = document.querySelector(s).contentDocument;
      const row = d.querySelector('tr[data-st-locked="1"]');
      row.dispatchEvent(new d.defaultView.MouseEvent("mouseover", { bubbles: true }));
      const rm = d.querySelector('.st-bar [data-act="remove"]');
      return { tag: d.querySelector(".st-bar span") && d.querySelector(".st-bar span").textContent, removeShown: rm ? rm.style.display !== "none" : null };
    }, FRAME);
    ok("§3 in the receipt the tax block says it is required and has no Remove", /required/.test(handles.tag || "") && handles.removeShown === false, handles);
    // The campaign: Send is disabled while Donor mail is off, with the reason.
    await page.goto(`${APP}/app/communications?subtab=campaigns&campaign=${cid}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    const row2 = page.locator(`[data-testid="camp-row"]`).filter({ hasText: "Spring barn" }).first();
    await row2.locator('[data-testid="edit-in-editor"], [data-testid="camp-view"]').first().click().catch(() => {});
    await page.locator('[data-testid="audience-line"]').waitFor({ timeout: 20000 }).catch(() => {});
    const c = await page.evaluate(() => ({ send: (document.querySelector('[data-testid="campaign-send"]') || {}).disabled, label: (document.querySelector('[data-testid="campaign-send"]') || {}).innerText,
      reason: (document.querySelector('[data-testid="editor-primary-reason"]') || {}).innerText, line: (document.querySelector('[data-testid="audience-line"]') || {}).innerText,
      when: (document.querySelector('[data-testid="campaign-schedule-at"]') || {}).value }));
    ok("§4 in the editor, Send to 3 is disabled with the Donor mail sentence", c.send === true && /Send to 3/.test(c.label || "") && /Donor mail is off/.test(c.reason || ""), c);
    ok("§4 the line on screen adds up", /^6 donors · 0 can get this email: 2 have no email address, 1 has automatic email off, 3 can't get email while Donor mail is off for Editor One Riders\.$/.test((c.line || "").trim()), c.line);
    ok("§5 Send it later starts empty", c.when === "", c.when);
    ok("§3 nothing threw", errors.length === 0, errors.slice(0, 3));
    await browser.close();
  }

  await wipe(ORG); await wipe(ORG2);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

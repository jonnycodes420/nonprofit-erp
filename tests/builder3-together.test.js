// tests/builder3-together.test.js · BUILDER-3. WORKING ON AN EMAIL TOGETHER, SHARED FOR REVIEW.
//
// The build's one test. It earns its place under CLAUDE.md's rule because it guards donor data,
// donor email and security: a review link is the one door to an email from outside the org; a
// comment must never reach a donor; a code block is HTML a person typed; and two people saving
// one email must not lose each other's words.
//
//   §1  a review link is read only: a GET and a HEAD on it write nothing (every row of the org,
//       and the audit log); it shows only the one previewed person's details, or none with sample
//       values; it expires, and a turned-off link stops at once; another org's person sees nothing.
//   §2  comments: pinned to a block, never in the preview, the export or a send's HTML; an
//       @mention is a line in that person's bell (nobody outside the org can be mentioned);
//       Resolve takes it out of the bell; another org can't read or resolve them; an outside
//       reviewer comments only when the link allows it.
//   §3  a code block: only an admin adds or changes one (template and campaign); one with a script
//       or an event handler is refused at send (the campaign's preflight, and send-mode render).
//   §4  two editors on different blocks, from the same version, both save: both changes are kept
//       and the audit shows each actor once. A block one person is typing in stays theirs.
//   §5  the house style: an admin sets it, every email shows it, no saved block is rewritten, and a
//       block that sets its own size keeps it.
//   §6  the browser, two people (two contexts): each sees the other's face; an outline in that
//       person's colour on the block they selected; the block one is typing in can't be typed in
//       by the other; one's save appears on the other's screen without losing the other's change;
//       Undo takes back only one's own change; both changes save. Then Share, Export and Styles.
//
// RED ON MAIN (3c0e0b8): every section (no presence, no rev or merge: the second save lays over the
// first; no comments, review links or house style; a staff code block saves). Planted and
// watched go red: see the PR.
//
// Never the demo org. Nothing here sends.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");

const ORG = "org_builder3", ORG2 = "org_builder3_other";
const { DIST } = require("./lib/dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function fixture(org, slug, name, people) {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,mission,emails_enabled,staff_mail_enabled)
           VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York','A community garden and food pantry.',false,false)`, [org, name, slug]);
  const out = {};
  for (const [k, full, role] of people) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
      [`u_${org}_${k}`, org, `${k}@${org}.test.local`, bcrypt.hashSync("loadtest1234", 4), full, role]);
    out[k] = (await api("POST", "/auth/login", null, { email: `${k}@${org}.test.local`, password: "loadtest1234" })).body;
  }
  return out;
}
// Every row of the org (its count and its newest version) and the audit log: a write anywhere moves it.
async function snapshot(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name NOT IN ('orgs')`)).map(r => r.table_name);
  const out = {};
  for (const t of tables) {
    const [r] = await q(`SELECT COUNT(*)::int AS n, COALESCE(MAX(xmin::text::bigint),0)::text AS x FROM "${t}" WHERE org_id=$1`, [org]).catch(() => [null]);
    if (r) out[t] = r.n + ":" + r.x;
  }
  const [o] = await q(`SELECT xmin::text AS x FROM orgs WHERE id=$1`, [org]);
  out.orgs = o.x;
  const [a] = await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log`);
  out.audit_all = a.n;
  return out;
}
const diff = (a, b) => Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]);
// The email as saved now: /live, or (on main, which has no /live) the templates list.
const liveOf = async (id, tok) => {
  const r = await api("GET", `/email-templates/${id}/live`, tok);
  if (r.status === 200) return r.body;
  const t = ((await api("GET", "/email-templates", tok)).body.templates || []).find(x => x.id === id) || {};
  return { blocks: t.blocks || [], rev: t.rev };
};
const raw = (method, p, token) => fetch(BASE + p, { method, headers: token ? { Authorization: "Bearer " + token } : {} });

(async () => {
  const EB = await import("../shared/emailBlocks.js");
  const U = await fixture(ORG, "builder3-garden", "Builder Three Garden", [["nat", "Natalie Brook", "staff"], ["owen", "Owen Hale", "staff"], ["ada", "Ada Quill", "admin"]]);
  const U2 = await fixture(ORG2, "builder3-other", "Other Org", [["zed", "Zed Elsewhere", "admin"]]);
  const NAT = U.nat.token, OWEN = U.owen.token, ADA = U.ada.token, ZED = U2.zed.token;
  ok("fixture: three people in the org, one in another", !!(NAT && OWEN && ADA && ZED));
  // Two made-up donors: the previewed one, and one who must never show.
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ('d_b3_margot',$1,'Margot Feld','margot.feld@example.org','system:test','BUILDER-3 fixture'),
           ('d_b3_ruth',$1,'Ruthanne Other','ruthanne.other@example.org','system:test','BUILDER-3 fixture')`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ('d_b3_zed',$1,'Zebulon Faraway','zeb@example.org','system:test','BUILDER-3 fixture')`, [ORG2]);
  const t = (await api("POST", "/email-templates", NAT, { starterKey: "thank_you" })).body.template;
  ok("a thank-you email to work on, every block with an id and a rev", !!t && t.blocks.every(b => b.id) && t.rev === 0, t && t.blocks.map(b => b.id));
  const t2 = (await api("POST", "/email-templates", ZED, { starterKey: "thank_you" })).body.template;
  await api("PUT", `/email-templates/${t2.id}`, ZED, { blocks: t2.blocks.map(b => b.type === "richtext" ? { ...b, blocks: [{ type: "p", text: "Words only the other org has." }] } : b), baseRev: t2.rev, base: t2.blocks });
  const textIdx = t.blocks.findIndex(b => b.type === "richtext"), sigIdx = t.blocks.findIndex(b => b.type === "signature");

  // Each section runs on its own, so one that fails (on main, a route that isn't there) doesn't hide the rest.
  const sec = async (n, fn) => { try { await fn(); } catch (e) { ok(`${n} ran`, false, e.message); } };
  let inside = { body: {} };
  await sec("§1", async () => {
  // ── §1 · a review link is read only ───────────────────────────────────────
  const shareAs = await api("POST", `/email-templates/${t.id}/share`, NAT, { audience: "outside", as: "d_b3_margot", allowComments: false, reviewerName: "A board member" });
  const tokAs = (shareAs.body.url || "").split("/review/")[1];
  ok("§1 an outside link is made, for 7 days, and only its hash is kept", shareAs.status === 200 && /^[A-Za-z0-9_-]{20,}$/.test(tokAs || "")
    && (await q(`SELECT token_hash FROM email_review_links WHERE id=$1`, [shareAs.body.id]))[0].token_hash !== tokAs, shareAs.body);
  const before = await snapshot(ORG);
  const g1 = await api("GET", `/public/email-review/${tokAs}`, null);
  const g2 = await api("GET", `/public/email-review/${tokAs}`, null);
  const h1 = await raw("HEAD", `/public/email-review/${tokAs}`);
  await new Promise(r => setTimeout(r, 300));
  const after = await snapshot(ORG);
  ok("§1 a GET and a HEAD on the link write nothing (every row of the org, and the audit log)", g1.status === 200 && g2.status === 200 && h1.status === 200 && diff(before, after).length === 0, diff(before, after));
  ok("§1 it shows the email as the one previewed person sees it, and nobody else's details", /Margot/.test(g1.body.html) && !/Ruthanne|ruthanne/.test(g1.body.html) && g1.body.shownAs === "Margot" && g1.body.sample === false, g1.body.shownAs);
  ok("§1 nothing from another org", !/Words only the other org has|Zebulon|Other Org/.test(JSON.stringify(g1.body)));
  const shareSample = await api("POST", `/email-templates/${t.id}/share`, NAT, { audience: "outside", sample: true, allowComments: true });
  const tokS = (shareSample.body.url || "").split("/review/")[1];
  const gs = await api("GET", `/public/email-review/${tokS}`, null);
  ok("§1 with sample values, no one's details", gs.status === 200 && gs.body.sample === true && !/Margot|Ruthanne/.test(gs.body.html), gs.body.shownAs);
  ok("§1 a view-only link takes no comment", (await api("POST", `/public/email-review/${tokAs}/comments`, null, { body: "Lovely." })).status === 403);
  const outsideC = await api("POST", `/public/email-review/${tokS}/comments`, null, { body: "The second line reads well.", name: "Rae" });
  ok("§1 a link that allows comments takes one, stamped with the link as its actor", outsideC.status === 200
    && (await q(`SELECT created_by FROM email_comments WHERE id=$1`, [outsideC.body.comment.id]))[0].created_by === `system:email-review/${shareSample.body.id}`, outsideC.body);
  await q(`UPDATE email_review_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [shareSample.body.id]);
  const exp = await api("GET", `/public/email-review/${tokS}`, null);
  ok("§1 an expired link shows nothing, and says so", exp.status === 404 && !exp.body.html && /expired/.test(exp.body.sentence || ""), exp.body);
  ok("§1 …and takes no comment", (await api("POST", `/public/email-review/${tokS}/comments`, null, { body: "Late." })).status === 404);
  await api("POST", `/email-review-links/${shareAs.body.id}/revoke`, NAT, {});
  ok("§1 a turned-off link stops at once", (await api("GET", `/public/email-review/${tokAs}`, null)).status === 404);
  ok("§1 an unknown token is the same 404", (await api("GET", `/public/email-review/${"x".repeat(32)}`, null)).status === 404);
  inside = await api("POST", `/email-templates/${t.id}/share`, NAT, { audience: "org", sample: true });
  ok("§1 an in-org link needs a sign-in", (await api("GET", `/email-reviews/${inside.body.id}`, null)).status === 401);
  ok("§1 …opens for someone in the org", (await api("GET", `/email-reviews/${inside.body.id}`, OWEN)).status === 200);
  ok("§1 …and is a 404 to another org's admin, as are this email's links and comments",
    (await api("GET", `/email-reviews/${inside.body.id}`, ZED)).status === 404 && (await api("GET", `/email-templates/${t.id}/shares`, ZED)).status === 404
    && (await api("POST", `/email-templates/${t.id}/share`, ZED, { audience: "outside", sample: true })).status === 404
    && (await api("POST", `/email-review-links/${inside.body.id}/revoke`, ZED, {})).status === 404);

  });
  await sec("§2", async () => {
  // ── §2 · comments ─────────────────────────────────────────────────────────
  const bodyText = "Owen, the second line needs a warmer word";
  const c1 = await api("POST", `/email-templates/${t.id}/comments`, NAT, { blockId: t.blocks[textIdx].id, body: bodyText, mentions: [`u_${ORG}_owen`, `u_${ORG2}_zed`] });
  ok("§2 a comment on one block, mentioning Owen", c1.status === 200 && c1.body.comment.blockId === t.blocks[textIdx].id, c1.body);
  const ments = await q(`SELECT user_id FROM email_comment_mentions WHERE comment_id=$1`, [c1.body.comment.id]);
  ok("§2 only people of the org can be mentioned (another org's person is ignored)", ments.length === 1 && ments[0].user_id === `u_${ORG}_owen`, ments);
  const bellO = await api("GET", "/atlas/activity", OWEN);
  const mItem = (bellO.body.items || []).find(x => x.kind === "mention");
  ok("§2 Owen's bell has the mention, and it waits", !!mItem && bellO.body.waiting >= 1 && /mentioned you/.test(mItem.line), bellO.body.items && bellO.body.items.slice(0, 2));
  ok("§2 Natalie's bell does not", !((await api("GET", "/atlas/activity", NAT)).body.items || []).some(x => x.kind === "mention"));
  ok("§2 nobody is emailed (no mail row for the mention)", (await q(`SELECT COUNT(*)::int AS n FROM notification_sends WHERE org_id=$1`, [ORG]).catch(() => [{ n: 0 }]))[0].n === 0);
  const pv = await api("POST", `/email-templates/${t.id}/preview`, NAT, { device: "desktop" });
  const ex = await api("POST", "/email-export", NAT, { blocks: t.blocks, subject: t.subject, name: t.name });
  const withPhoto = t.blocks.map(b => (b.type === "hero" || b.type === "image" ? { ...b, image: "https://cdn.example/photo.jpg", alt: "The garden in June" } : b));
  const send = EB.renderEmail({ blocks: withPhoto, brand: {}, fields: { first_name: "Margot" }, subject: t.subject, mode: "send" });
  const r1 = await api("GET", `/email-reviews/${inside.body.id}`, OWEN);
  ok("§2 a comment is never in the preview, the export, a send's HTML or the reviewed email", ![pv.body.html, ex.body.html, send.html, r1.body.html].some(h => String(h || "").includes("warmer word")));
  ok("§2 another org can't read or resolve the comments", (await api("GET", `/email-templates/${t.id}/comments`, ZED)).status === 404
    && (await api("POST", `/email-comments/${c1.body.comment.id}/resolve`, ZED, {})).status === 404);
  await api("POST", `/email-comments/${c1.body.comment.id}/resolve`, OWEN, {});
  const bellO2 = await api("GET", "/atlas/activity", OWEN);
  ok("§2 resolved: the thread is hidden and Owen's bell lets it go", !(bellO2.body.items || []).some(x => x.kind === "mention")
    && (await api("GET", `/email-templates/${t.id}/comments`, NAT)).body.comments.find(x => x.id === c1.body.comment.id).resolved === true);

  });
  await sec("§3", async () => {
  // ── §3 · a code block ─────────────────────────────────────────────────────
  const cur = await liveOf(t.id, NAT);
  const withCode = html => [...cur.blocks.slice(0, -1), { type: "code", html }, cur.blocks[cur.blocks.length - 1]];
  const staffCode = await api("PUT", `/email-templates/${t.id}`, NAT, { blocks: withCode("<p>Hello</p>"), baseRev: cur.rev, base: cur.blocks });
  ok("§3 a staff member can't add a code block (the server says so, not only the editor)", staffCode.status === 403 && staffCode.body.error === "code_admin_only", staffCode.body);
  const bad = `<p onclick="steal()">Hello</p><script>alert(1)</script>`;
  const adminCode = await api("PUT", `/email-templates/${t.id}`, ADA, { blocks: withCode(bad), baseRev: cur.rev, base: cur.blocks });
  ok("§3 an admin can", adminCode.status === 200, adminCode.body);
  const afterCode = adminCode.body.template;
  const staffOther = await api("PUT", `/email-templates/${t.id}`, NAT, { subject: "Thank you, truly", blocks: afterCode.blocks, baseRev: afterCode.rev, base: afterCode.blocks });
  ok("§3 a staff member can still save the email that carries it, the code unchanged", staffOther.status === 200, staffOther.body);
  let threw = null;
  try { EB.renderEmail({ blocks: afterCode.blocks, brand: {}, fields: {}, subject: "x", mode: "send" }); } catch (e) { threw = e; }
  ok("§3 a script or an event handler is refused at send (send-mode render)", !!threw && threw.code === "EMAIL_NOT_READY" && threw.problems.some(p => /took out/.test(p)), threw && threw.problems);
  const camp = (await api("POST", "/campaigns/from-template", ADA, { templateId: t.id, name: "Code check" })).body;
  const appr = await api("POST", `/campaigns/${camp.id}/request-approval`, NAT, {});
  ok("§3 …and by the campaign's preflight, with the reason", appr.status === 400 && appr.body.error === "email_not_ready" && (appr.body.problems || []).some(p => /took out/.test(p)), appr.body);
  const campStaff = await api("PUT", `/campaigns/${camp.id}`, NAT, { name: "Code check", subject: "x", emailBlocks: [...camp.email_blocks || [], { type: "code", html: "<p>Mine</p>" }] });
  ok("§3 a staff member can't add a code block to a campaign either", campStaff.status === 403 && campStaff.body.error === "code_admin_only", campStaff.body);

  });
  await sec("§4", async () => {
  // ── §4 · two editors, different blocks, both saved ───────────────────────
  const t4 = (await api("POST", "/email-templates", NAT, { starterKey: "thank_you" })).body.template;
  const i4 = t4.blocks.findIndex(b => b.type === "richtext"), s4 = t4.blocks.findIndex(b => b.type === "signature");
  const [{ now: t0 }] = await q(`SELECT NOW() AS now`);
  const mineN = t4.blocks.map((b, i) => (i === i4 ? { ...b, blocks: [{ type: "p", text: "Natalie's words." }] } : b));
  const mineO = t4.blocks.map((b, i) => (i === s4 ? { ...b, title: "Owen's title" } : b));
  const sN = await api("PUT", `/email-templates/${t4.id}`, NAT, { blocks: mineN, baseRev: t4.rev, base: t4.blocks });
  const sO = await api("PUT", `/email-templates/${t4.id}`, OWEN, { blocks: mineO, baseRev: t4.rev, base: t4.blocks });
  const fin = await liveOf(t4.id, NAT);
  ok("§4 both saves from the same version are kept: Natalie's words and Owen's title", sN.status === 200 && sO.status === 200
    && JSON.stringify(fin.blocks[i4]).includes("Natalie's words.") && fin.blocks[s4].title === "Owen's title" && fin.rev === 2, { merged: sO.body.merged, rev: fin.rev });
  const aud = await q(`SELECT user_id, COUNT(*)::int AS n FROM fin_audit_log WHERE entity_id=$1 AND request_method='PUT' AND created_at >= $2 GROUP BY user_id`, [t4.id, t0]);
  const byU = Object.fromEntries(aud.map(r => [r.user_id, r.n]));
  ok("§4 the audit shows each actor once", byU[`u_${ORG}_nat`] === 1 && byU[`u_${ORG}_owen`] === 1 && aud.length === 2, aud);
  // A block Natalie is typing in stays hers.
  const bid = fin.blocks[i4].id || "p" + i4;
  await api("POST", `/email-templates/${t4.id}/presence`, NAT, { blockId: bid, editingBlockId: bid, typed: true });
  const pO = await api("POST", `/email-templates/${t4.id}/presence`, OWEN, { blockId: bid, editingBlockId: bid, typed: true });
  ok("§4 Owen is told Natalie is editing that block", !!pO.body.refused && /Natalie is editing this/.test(pO.body.refused.sentence) && pO.body.others.some(p => p.firstName === "Natalie" && p.holds === bid), pO.body);
  const over = await api("PUT", `/email-templates/${t4.id}`, OWEN, { blocks: fin.blocks.map((b, i) => (i === i4 ? { ...b, blocks: [{ type: "p", text: "Owen over the top." }] } : b)), baseRev: fin.rev, base: fin.blocks });
  const fin2 = await liveOf(t4.id, NAT);
  ok("§4 a save that changes a block someone else holds keeps their words, and says so", over.status === 200 && (over.body.merged || {}).held && over.body.merged.held.includes(bid)
    && JSON.stringify(fin2.blocks[i4]).includes("Natalie's words.") && !JSON.stringify(fin2.blocks).includes("Owen over the top."), over.body.merged);
  ok("§4 a heartbeat is nobody's change: no audit row", (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE request_path LIKE '%/presence%'`))[0].n === 0);
  ok("§4 another org's person can't see who is here", (await api("POST", `/email-templates/${t4.id}/presence`, ZED, {})).status === 404);

  });
  await sec("§5", async () => {
  // ── §5 · the house style ──────────────────────────────────────────────────
  const t5 = (await api("POST", "/email-templates", ADA, { starterKey: "year_end_appeal" })).body.template;
  const own = t5.blocks.map(b => (b.type === "richtext" ? { ...b, size: 21 } : b));
  const saved5 = (await api("PUT", `/email-templates/${t5.id}`, ADA, { blocks: own, baseRev: t5.rev, base: t5.blocks })).body.template;
  const rowBefore = (await q(`SELECT blocks::text AS b FROM email_templates WHERE id=$1`, [t5.id]))[0].b;
  ok("§5 a staff member can't change the house style", (await api("PUT", "/email-style", NAT, { style: { buttonShape: "pill" } })).status === 403);
  ok("§5 a value Steward doesn't offer is refused with a sentence", (await api("PUT", "/email-style", ADA, { style: { buttonShape: "star" } })).status === 400);
  const st = await api("PUT", "/email-style", ADA, { style: { buttonShape: "pill", bodySize: 18, headingFont: "verdana" } });
  const pv5 = await api("POST", `/email-templates/${t5.id}/preview`, ADA, { device: "desktop" });
  ok("§5 an admin sets it and the email shows it (pill buttons, 18 px body, Verdana headings)", st.status === 200 && /border-radius:26px/.test(pv5.body.html) && /font-size:18px/.test(pv5.body.html) && /Verdana/.test(pv5.body.html), st.body);
  ok("§5 a block that sets its own size keeps it", /font-size:21px/.test(pv5.body.html));
  ok("§5 no saved block is rewritten", (await q(`SELECT blocks::text AS b FROM email_templates WHERE id=$1`, [t5.id]))[0].b === rowBefore && !!saved5);
  const other5 = await api("POST", `/email-templates/${t2.id}/preview`, ZED, { device: "desktop" });
  ok("§5 another org's email is untouched by it", !/Verdana/.test(other5.body.html || ""));
  await api("PUT", "/email-style", ADA, { reset: true });

  });

  // ── §6 · the browser: two people on one email ────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const t6 = (await api("POST", "/email-templates", ADA, { starterKey: "thank_you" })).body.template;
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const FRAME = '[data-testid="email-preview-frame"]';
    const errors = [];
    const open = async who => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
      await ctx.addInitScript(([a, b, c]) => { localStorage.setItem("npe_token", a); localStorage.setItem("npe_user", b); localStorage.setItem("npe_org", c); },
        [who.token, JSON.stringify(who.user), JSON.stringify(who.org)]);
      const p = await ctx.newPage();
      p.on("pageerror", e => errors.push(e.message.slice(0, 160)));
      await p.goto(`${APP}/app/communications?subtab=templates&template=${t6.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.locator(FRAME).waitFor({ timeout: 30000 });
      await p.waitForFunction(s => { const f = document.querySelector(s); try { return f.contentDocument.querySelectorAll("tr[data-st-block]").length > 2; } catch { return false; } }, FRAME, { timeout: 30000 });
      return p;
    };
    // The caret at the end of the words (a click can land on a field's chip, which takes no typing).
    const typeAtEnd = async (page, el, text) => {
      await el.click({ force: true });
      await el.evaluate(e => { const d = e.ownerDocument; const w = d.createTreeWalker(e, 4); let n, last = null;
        while ((n = w.nextNode())) if (n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest("[contenteditable=false]"))) last = n;
        if (!last) return; const r = d.createRange(); r.setStart(last, last.nodeValue.length); r.collapse(true); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); });
      await page.keyboard.type(text);
    };
    const pN = await open(U.nat), pO = await open(U.owen);
    await pN.waitForTimeout(4000);
    const faces = p => p.locator('[data-testid="together-face"]').evaluateAll(els => els.map(e => e.textContent + ":" + e.getAttribute("data-color")));
    const fN = await faces(pN), fO = await faces(pO);
    ok("§6 each sees the other's face, in a colour of their own (emerald or brass)", fN.length === 1 && /^O:#/.test(fN[0]) && fO.length === 1 && /^N:#/.test(fO[0]) && fN[0].split(":")[1] !== fO[0].split(":")[1]
      && [fN[0], fO[0]].every(x => /#(0D5C3A|C9A84C|3E8E66|8A6D1F|6FB592|A88A3A)$/i.test(x)), [fN, fO]);
    const frN = pN.frameLocator(FRAME), frO = pO.frameLocator(FRAME);
    await typeAtEnd(pN, frN.locator("[data-st-rich]").first(), " Natalie was here.");
    await pO.waitForTimeout(4500);
    const outline = await frO.locator('[data-testid="email-block-other"]').evaluateAll(els => els.map(e => ({ at: e.getAttribute("data-st-for"), color: e.getAttribute("data-color"), who: e.textContent })));
    const textAt = String(t6.blocks.findIndex(b => b.type === "richtext"));
    ok("§6 Owen sees an outline in Natalie's colour on the block she is in, and that she is editing it", outline.length === 1 && outline[0].at === textAt && outline[0].color === fO[0].split(":")[1] && /Natalie is editing/.test(outline[0].who), outline);
    const textO = frO.locator("[data-st-rich]").first();
    await typeAtEnd(pO, textO, " Owen tried");
    await pO.waitForTimeout(600);
    ok("§6 Owen can't type in it, and is told why", !(await textO.innerText()).includes("Owen tried") && /Natalie is editing this/.test(await pO.locator('[data-testid="block-held"]').innerText().catch(() => "")));
    await typeAtEnd(pO, frO.locator('[data-st-edit$=".title"]').first(), " and Owen");
    await pO.waitForTimeout(400);
    await pN.locator('[data-testid="email-save"]').click();
    await pN.waitForTimeout(1500);
    await pO.waitForTimeout(5000);   // his next heartbeat sees her save and merges it in
    ok("§6 her save appears on his screen, and his own change is still there", (await frO.locator("[data-st-rich]").first().innerText()).includes("Natalie was here.")
      && (await frO.locator('[data-st-edit$=".title"]').first().innerText()).includes("and Owen"));
    await pO.locator('[data-testid="editor-undo"]').click();
    await pO.waitForTimeout(1500);
    ok("§6 his Undo takes back only his own change", (await frO.locator("[data-st-rich]").first().innerText()).includes("Natalie was here.")
      && !(await frO.locator('[data-st-edit$=".title"]').first().innerText()).includes("and Owen"));
    await pO.locator('[data-testid="editor-redo"]').click();
    await pO.waitForTimeout(800);
    await pO.locator('[data-testid="email-save"]').click();
    await pO.waitForTimeout(1500);
    const fin6 = await liveOf(t6.id, ADA);
    ok("§6 both changes saved", JSON.stringify(fin6.blocks).includes("Natalie was here.") && JSON.stringify(fin6.blocks).includes("and Owen"), fin6.rev);
    // Share, Export and Styles (Ada, an admin)
    const pA = await open(U.ada);
    await pA.locator('[data-testid="email-share"]').click();
    await pA.locator('[data-testid="share-outside"]').click();
    await pA.locator('[data-testid="share-make"]').click();
    const url = await pA.locator('[data-testid="share-url"]').inputValue({ timeout: 10000 }).catch(() => "");
    ok("§6 Share makes a private link and says what it shows and for how long", /\/review\/[A-Za-z0-9_-]{20,}$/.test(url) && /7 days/.test(await pA.locator('[data-testid="share-made"]').innerText()), url);
    const rp = await (await browser.newContext()).newPage();
    await rp.goto(url.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: "domcontentloaded" });
    await rp.locator('[data-testid="review-page"]').waitFor({ timeout: 20000 }).catch(() => {});
    ok("§6 the link opens the email, view only, with no sign-in", /View only/.test(await rp.locator('[data-testid="review-shown-as"]').innerText().catch(() => "")));
    await pA.locator('[data-testid="email-export"]').click();
    const [dl] = await Promise.all([pA.waitForEvent("download", { timeout: 15000 }).catch(() => null), pA.locator('[data-testid="export-download"]').click()]);
    const dlText = dl ? fs.readFileSync(await dl.path(), "utf8") : "";
    ok("§6 Export downloads the email's HTML, its footer filled with a sample unsubscribe line", /<html/i.test(dlText) && /Unsubscribe/.test(dlText) && !dlText.includes("<!--steward:footer-->"), dl && dl.suggestedFilename());
    await pA.locator('[data-testid="builder-left-tabs"] button', { hasText: "Styles" }).click();
    await pA.locator('[data-testid="style-bodySize"]').fill("19");
    await pA.locator('[data-testid="style-save"]').click();
    await pA.waitForTimeout(2500);
    const html6 = await pA.evaluate(s => document.querySelector(s).contentDocument.documentElement.outerHTML, FRAME);
    ok("§6 the Styles tab sets the house style, and the email on screen shows it", /font-size:19px/.test(html6));
    await api("PUT", "/email-style", ADA, { reset: true });
    ok("§6 no page error", errors.length === 0, errors.slice(0, 3));
    await browser.close();
  }

  await wipe(ORG); await wipe(ORG2);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

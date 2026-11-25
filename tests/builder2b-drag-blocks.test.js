// tests/builder2b-drag-blocks.test.js · BUILDER-2B. DRAG AND DROP, COLUMNS, AND BLOCKS SAVED TO USE AGAIN.
//
// The build's one test. It earns its place under CLAUDE.md's rule because it
// guards donor email: the order a person drags the email into is the order
// that saves and the order a donor receives; a block saved in one org never
// reaches another; and the new parts render as tables an inbox lays out.
//
//   §1  a two-column block renders as tables that pass lintEmailHtml and stack
//       at phone width (through the real preview route, in the org's brand).
//   §2  a saved block is visible only in its own org, and using it adds a copy
//       (fresh ids), not a link: changing the saved one later leaves the copy.
//   §3  a Box with an image inside renders as nested tables that pass lintEmailHtml.
//   §4  the browser, in the editor (BUILDER-1's screen): a tile dropped on the
//       drop line lands there, as one undo step; a block moved by its grip
//       (the real mouse: press, move, release) moves, and its new order is what saves AND what the email renders to;
//       Alt+Down moves the selected block; the "+" between two blocks adds
//       there; Save as a block puts it in the Blocks tab, and a click adds a
//       copy; copy and paste puts the block in another email of the org;
//       Columns, Box and Social are tiles; Code is not (the person is not an admin).
//   §5  a click selects the block it lands on, every time (Jonathan, prod ebd9f87:
//       "can't click into each box on its own by hitting it"): an email of every
//       type, each clicked in its middle, at its edge and in its padding, and at
//       its bottom right while the block below it is selected (where that block's
//       handles used to sit: on main the click pressed Duplicate). Each click
//       selects that block: the outline, its name tag, the path line and the
//       right pane, and nothing in the email changes. A click in text puts the
//       caret there; a click on a photo or a stat selects it, never the "+".
//   §6  the preview is light unless Dark mode is pressed, on a computer in dark
//       mode too (both preview routes); a send still carries the dark block.
//
// RED ON MAIN (ebd9f87): §5's "bottom right while the block below is selected"
// (14 of 14 pressed Duplicate on staging), §6 (the dark block followed the
// computer), and §4 throughout (no drop line, no handle drag, no
// Alt+Down, no "+", the Blocks tab is a placeholder, no Save as a block, no
// paste, and no Columns tile). Planted and watched go red: moveTo left out of
// the drop (§4 order unchanged), and the saved-block copy keeping the saved
// block's ids (§2 "a copy, not a link").
//
// Never the demo org. Nothing here sends.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, browserLegOrSkip } = require("./helpers");

const ORG = "org_builder2b", ORG2 = "org_builder2b_other";
const { DIST } = require("./lib/dist");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const PIC = "https://cdn.example/photo.jpg";

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function fixture(org, slug, name, role = "staff") {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,mission,emails_enabled,staff_mail_enabled)
           VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York','A community garden and food pantry.',false,false)`, [org, name, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Sam Ortega',$5)`,
    ["u_" + org, org, `${org}@test.local`, bcrypt.hashSync("loadtest1234", 4), role]);
  return (await api("POST", "/auth/login", null, { email: `${org}@test.local`, password: "loadtest1234" })).body;
}
const lintOf = async html => { const EB = await import("../shared/emailBlocks.js"); return EB.lintEmailHtml(html.replace(/<!--steward:footer-->/, "")); };

(async () => {
  const EB = await import("../shared/emailBlocks.js");
  const a = await fixture(ORG, "builder2b-garden", "Garden Test Org");
  const b = await fixture(ORG2, "builder2b-other", "Other Test Org");
  const TOK = a.token, TOK2 = b.token;
  ok("the two fixture orgs sign in", !!TOK && !!TOK2);

  // ── §1 · two columns: tables, lint, phone stack ──────────────────────────
  const cols = { type: "columns", count: 2, columns: [{ items: [{ type: "text", heading: "40 families", text: "fed each week" }] }, { items: [{ type: "image", image: PIC, alt: "The pantry shelves" }] }] };
  const p1 = await api("POST", "/email-preview", TOK, { blocks: [{ type: "header" }, cols, { type: "footer" }] });
  const h1 = p1.body.html || "";
  ok("§1 a two-column block previews", p1.status === 200, p1.body);
  ok("§1 it is two table cells that stack on a phone, no flexbox or grid", (h1.match(/<td class="st-col" width="50%"/g) || []).length === 2 && h1.includes(EB.PHONE_MEDIA) && !/display:\s*(flex|grid)/.test(h1));
  const raw1 = EB.renderEmail({ blocks: [{ type: "header" }, cols, { type: "footer" }], brand: {}, fields: {}, links: {}, mode: "send" });
  ok("§1 and passes lintEmailHtml", EB.lintEmailHtml(raw1.html).length === 0, EB.lintEmailHtml(raw1.html));

  // ── §2 · a saved block is its org's, and a use is a copy ─────────────────
  const made = await api("POST", "/email-blocks", TOK, { name: "Pantry numbers", blocks: [cols] });
  const sid = made.body.block && made.body.block.id;
  ok("§2 a block is saved for the org", made.status === 201 && !!sid, made.body);
  const other = await api("GET", "/email-blocks", TOK2);
  const otherUse = await api("POST", `/email-blocks/${sid}/use`, TOK2, {});
  ok("§2 another org neither sees it nor can use it", !(other.body.saved || []).some(s => s.id === sid) && otherUse.status === 404, otherUse.status);
  const use1 = await api("POST", `/email-blocks/${sid}/use`, TOK, {});
  const use2 = await api("POST", `/email-blocks/${sid}/use`, TOK, {});
  const ids = r => JSON.stringify(r.body.blocks || []).match(/"id":"blk_[a-f0-9]{20}"/g) || [];
  ok("§2 using it twice gives two copies with different ids", ids(use1).length === 1 && ids(use2).length === 1 && ids(use1)[0] !== ids(use2)[0], [ids(use1), ids(use2)]);
  await api("PUT", `/email-blocks/${sid}`, TOK, { blocks: [{ type: "divider" }] });
  ok("§2 a copy is not a link: changing the saved block leaves the copy as it was", (use1.body.blocks || [])[0] && use1.body.blocks[0].type === "columns");

  // ── §3 · a Box holding a photo ───────────────────────────────────────────
  const box = { type: "box", style: { bg: "cream", pad: [24, 32, 24, 32], border: "thin", borderColor: "band", radius: 8 }, children: [{ type: "image", image: PIC, alt: "The garden in June" }] };
  const r3 = EB.renderEmail({ blocks: [{ type: "header" }, box, { type: "footer" }], brand: { band: "#0d5c3a" }, fields: {}, links: {}, mode: "send" });
  ok("§3 a Box with a photo is nested tables, its ground inside its border", /<table role="presentation" width="100%"[^>]*bgcolor="#f0ede6"[^>]*border:1px solid #0d5c3a;[^>]*><tr><td style="padding:24px 32px 24px 32px;"><table role="presentation" width="100%"[^>]*>\n<tr><td style="padding:12px 0px;"><img/.test(r3.html));
  ok("§3 and passes lintEmailHtml", EB.lintEmailHtml(r3.html).length === 0, EB.lintEmailHtml(r3.html));

  // ── §4 · the browser ─────────────────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = BASE.replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const t1 = (await api("POST", "/email-templates", TOK, { starterKey: "year_end_appeal" })).body.template;
    const t2 = (await api("POST", "/email-templates", TOK, { starterKey: "spring_appeal" })).body.template;
    ok("§4 two designed emails to work in", !!(t1 && t2), [t1 && t1.id, t2 && t2.id]);
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
      await page.waitForFunction(s => { const f = document.querySelector(s); try { return f && f.contentDocument.querySelectorAll("tr[data-st-block]").length > 2; } catch { return false; } }, FRAME, { timeout: 20000 }).catch(() => {});
    };
    const order = () => page.evaluate(s => [...new Set([...document.querySelector(s).contentDocument.querySelectorAll("tr[data-st-block]")]
      .filter(r => /^\d+$/.test(r.getAttribute("data-st-block"))).map(r => r.getAttribute("data-st-block") + ":" + r.getAttribute("data-st-type")))].map(x => x.split(":")[1]), FRAME);
    const settle = () => page.waitForTimeout(1300);   // the preview redraws 300 ms after a change, then loads
    // A real drag across the frame is the browser's own; Playwright drives it
    // as the DataTransfer and events a mouse drag fires.
    const dropInFrame = (payload, beforeIndex) => page.evaluate(([s, pl, at]) => {
      const doc = document.querySelector(s).contentDocument;
      const rows = [...doc.querySelectorAll(`tr[data-st-block="${at}"]`)];
      const r = rows[0].getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData("application/x-steward-email-block", JSON.stringify(pl));
      const at0 = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.top + 3 };
      doc.body.dispatchEvent(new DragEvent("dragover", at0));
      const line = doc.querySelector('[data-testid="email-drop-line"]');
      const shown = line && line.style.display === "block";
      doc.body.dispatchEvent(new DragEvent("drop", at0));
      return shown;
    }, [FRAME, payload, beforeIndex]);

    await open(t1.id);
    const tiles = await page.$$eval('[data-testid^="element-"]', t => t.map(x => x.getAttribute("data-testid").replace("element-", "")));
    ok("§4 Columns, Box and Social are tiles; Code is not, for someone who is not an admin", ["columns", "box", "social"].every(k => tiles.includes(k)) && !tiles.includes("code"), tiles);
    const o0 = await order();
    // A tile dropped on the line above block 2.
    const lineShown = await dropInFrame({ type: "divider" }, 2);
    await settle();
    const o1 = await order();
    ok("§4 dragging a tile over the email shows the drop line", lineShown);
    ok("§4 the tile lands where the line was", o1[2] === "divider" && o1.length === o0.length + 1, { o0, o1 });
    await page.click('[data-testid="editor-undo"]');
    await settle();
    ok("§4 the drop is one undo step", JSON.stringify(await order()) === JSON.stringify(o0), await order());
    // Move block 3 (the text) above block 1 by its handle.
    await page.frameLocator(FRAME).locator('tr[data-st-block="3"]').first().click();
    // The ⠿ grip, with the real mouse: press, move to the top of block 1, release.
    const at = sel => page.evaluate(([s, q]) => { const e = document.querySelector(s).contentDocument.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, left: r.left }; }, [FRAME, sel]);
    const fr = await page.locator(FRAME).boundingBox();
    const grip = await at('.st-bar [data-act="drag"]');
    ok("§4 a selected block has a drag handle", !!grip);
    const dest = await at('tr[data-st-block="1"]');
    await page.mouse.move(fr.x + grip.x, fr.y + grip.y);
    await page.mouse.down();
    await page.mouse.move(fr.x + dest.left + 80, fr.y + dest.top + 3, { steps: 12 });
    const gripLine = await page.evaluate(s => { const l = document.querySelector(s).contentDocument.querySelector('[data-testid="email-drop-line"]'); return !!l && l.style.display === "block"; }, FRAME);
    await page.mouse.up();
    ok("§4 moving a block by its grip shows the drop line", gripLine);
    await settle();
    const o2 = await order();
    const want = [o0[0], o0[3], o0[1], o0[2], ...o0.slice(4)];
    ok("§4 a block dragged by its handle moves there", JSON.stringify(o2) === JSON.stringify(want), { o0, o2 });
    // Alt+Down: the moved block goes down one.
    await page.frameLocator(FRAME).locator('tr[data-st-block="1"]').first().click();
    await page.keyboard.press("Alt+ArrowDown");
    await settle();
    const o3 = await order();
    const want3 = [want[0], want[2], want[1], ...want.slice(3)];
    ok("§4 Alt+Down moves the selected block down one", JSON.stringify(o3) === JSON.stringify(want3), { want3, o3 });
    // The "+" between blocks 2 and 3 adds a Quote there.
    await page.evaluate(s => {
      const doc = document.querySelector(s).contentDocument;
      const r = doc.querySelector('tr[data-st-block="3"]').getBoundingClientRect();
      doc.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 1 }));
    }, FRAME);
    await page.waitForTimeout(500);   // the "+" shows once the pointer rests on the line
    const plusShown = await page.evaluate(s => { const p = document.querySelector(s).contentDocument.querySelector('[data-testid="email-plus"]'); return !!p && p.style.display === "block"; }, FRAME);
    ok("§4 a \"+\" shows on the line between two blocks", plusShown);
    await page.frameLocator(FRAME).locator('[data-testid="email-plus"]').click();
    await page.click('[data-testid="plus-element-quote"]');
    await settle();
    const o4 = await order();
    ok("§4 a pick from the \"+\" lands there", o4[3] === "quote" && o4.length === o3.length + 1, o4);
    // Save: the order is what saves, and what the email renders to.
    await page.click('[data-testid="email-save"]');
    await page.waitForFunction(() => /^Saved/.test((document.querySelector('[data-testid="editor-status"]') || {}).innerText || ""), null, { timeout: 10000 }).catch(() => {});
    const saved = (await api("GET", "/email-templates", TOK)).body.templates.find(t => t.id === t1.id);
    // The footer draws no row of its own (the send path fills its slot), so it is not in the email's order.
    const savedOrder = (saved.blocks || []).map(x => x.type).filter(t => t !== "footer");
    ok("§4 the dragged order is what saves", JSON.stringify(savedOrder) === JSON.stringify(o4), { savedOrder, o4 });
    // The renderer every send goes through, drawing every block (an empty quote included).
    const sendHtml = EB.renderEmail({ blocks: saved.blocks, brand: {}, fields: { first_name: "Ada" }, links: {}, mode: "preview", editable: true }).html;
    const sendOrder = [...new Set([...sendHtml.matchAll(/data-st-block="(\d+)" data-st-type="([a-z0-9]+)"/g)].map(m => m[1] + ":" + m[2]))].map(x => x.split(":")[1]);
    ok("§4 and the order the email renders to (the send path's renderer)", JSON.stringify(sendOrder) === JSON.stringify(o4), sendOrder);
    // Save as a block, then use it from the Blocks tab.
    await page.frameLocator(FRAME).locator('tr[data-st-block="3"]').first().click();
    await page.click('[data-testid="save-as-block"]');
    await page.fill('[data-testid="save-as-block-name"]', "Our quote");
    await page.click('[data-testid="save-as-block-save"]');
    await page.click('[data-testid="builder-left-tabs-blocks"]');
    await page.waitForSelector('[data-testid="saved-block"]', { timeout: 10000 }).catch(() => {});
    const names = await page.$$eval('[data-testid="saved-block"]', c => c.map(x => x.innerText));
    ok("§4 Save as a block puts it in the Blocks tab, with its picture", names.some(n => /Our quote/.test(n)) && await page.locator('[data-testid="saved-block"] iframe').count() > 0, names);
    const ours = (await api("GET", "/email-blocks", TOK)).body.saved.find(s => s.name === "Our quote");
    const before5 = (await order()).length;
    await page.click(`[data-testid="saved-block-use-${ours.id}"]`);
    await settle();
    ok("§4 clicking a saved block adds a copy to the email", (await order()).length === before5 + 1);
    const readyCount = await page.locator('[data-testid="ready-block"]').count();
    ok("§4 the Blocks tab offers Steward's ready-made sections", readyCount === 5, readyCount);
    // Copy here, paste into the other email.
    await page.frameLocator(FRAME).locator('tr[data-st-block="3"]').first().click();
    const clip = await page.evaluate(s => {
      const doc = document.querySelector(s).contentDocument;
      const dt = new DataTransfer();
      doc.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: dt }));
      return dt.getData("text/plain");
    }, FRAME);
    ok("§4 Cmd/Ctrl-C on a selected block copies it", /^STEWARD-EMAIL-BLOCKS:/.test(clip), clip.slice(0, 60));
    await page.click('[data-testid="email-save"]').catch(() => {});
    await page.waitForTimeout(800);
    await open(t2.id);
    const before6 = await order();
    await page.frameLocator(FRAME).locator('tr[data-st-block="1"]').first().click();
    await page.evaluate(([s, text]) => {
      const doc = document.querySelector(s).contentDocument;
      const dt = new DataTransfer(); dt.setData("text/plain", text);
      doc.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, [FRAME, clip]);
    await settle();
    const after6 = await order();
    ok("§4 Cmd/Ctrl-V puts it into another email of the org", after6.length === before6.length + 1 && after6[2] === "quote", { before6, after6 });
    const foreign = clip.replace(`"org":"${ORG}"`, `"org":"${ORG2}"`);
    await page.evaluate(([s, text]) => {
      const doc = document.querySelector(s).contentDocument;
      const dt = new DataTransfer(); dt.setData("text/plain", text);
      doc.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, [FRAME, foreign]);
    await settle();
    ok("§4 a block copied in another organization is not pasted", (await order()).length === after6.length && /another organization/.test(await page.locator('[data-testid="builder-toast"]').innerText().catch(() => "")));
    ok("§4 no page error on the way", errors.length === 0, errors);

    // ── §5 · every click selects the block it lands on ─────────────────────
    const pic = (await api("POST", "/stock-photos/kids-rope-swing/use", TOK, {})).body.url;
    const PHOTO = pic || PIC;
    const EVERY = [{ type: "header" }, { type: "hero", heading: "A year together", sub: "Thank you", image: PHOTO, alt: "A child on a swing" },
      { type: "richtext", blocks: [{ type: "p", text: "Hi {{first_name}}, a paragraph of words to click into." }, { type: "p", text: "A second paragraph." }] },
      { type: "richtext", blocks: [{ type: "ul", items: ["First thing", "Second thing"] }] },
      { type: "image", image: PHOTO, alt: "A swing", caption: "A caption" }, { type: "photos2", images: [{ src: PHOTO, alt: "One" }, { src: PHOTO, alt: "Two" }] },
      { type: "stats", items: [{ value: "48", label: "kids" }, { value: "1,200", label: "meals" }] }, { type: "quote", text: "It changed my summer.", attribution: "A parent" },
      { type: "button", action: "readmore", label: "Read more", url: "https://example.org" }, { type: "divider" }, { type: "signature", name: "Sam Ortega", title: "Director" },
      { type: "giftsummary", heading: "Your gift" }, { type: "event", eventId: "" }, { type: "givingpage", givingPageId: "" }, { type: "video" }, { type: "footer" }];
    const t3 = (await api("POST", "/email-templates", TOK, { starterKey: "year_end_appeal" })).body.template;
    const put3 = await api("PUT", `/email-templates/${t3.id}`, TOK, { name: "Every block", blocks: EVERY });
    ok("§5 an email with every block type", put3.status === 200, put3.body);
    await open(t3.id);
    await page.waitForTimeout(1200);
    const fr5 = await page.locator(FRAME).boundingBox();
    const state = () => page.evaluate(s => {
      const doc = document.querySelector(s).contentDocument;
      const box = doc.querySelector('[data-testid="email-block-selected"]');
      const rail = document.querySelector('[data-testid="rail-block"]');
      const a = doc.activeElement;
      return { sel: box && box.style.display !== "none" ? box.getAttribute("data-st-for") : null, tag: box ? (box.querySelector(".st-name") || {}).textContent || "" : "",
        crumb: (document.querySelector('[data-testid="editor-crumb-current"]') || {}).innerText || "", rail: rail ? rail.getAttribute("data-block-type") : null,
        caret: a && a.getAttribute ? a.getAttribute("data-st-edit") : null,
        order: [...new Set([...doc.querySelectorAll("tr[data-st-block]")].filter(r => /^\d+$/.test(r.getAttribute("data-st-block"))).map(r => r.getAttribute("data-st-block") + ":" + r.getAttribute("data-st-type")))].join(","),
        crumbAll: [...document.querySelectorAll('[data-testid="editor-crumb-current"]')].length };
    }, FRAME);
    const pointIn = (i, where) => page.evaluate(([s, i, where]) => {
      const doc = document.querySelector(s).contentDocument;
      const rows = [...doc.querySelectorAll(`tr[data-st-block="${i}"]`)];
      rows[0].scrollIntoView({ block: "center" });
      const rs = rows.map(r => r.getBoundingClientRect());
      const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom)), left = Math.min(...rs.map(r => r.left)), right = Math.max(...rs.map(r => r.right));
      if (where === "middle") return { x: (left + right) / 2, y: (top + bottom) / 2 };
      if (where === "edge") return { x: left + 6, y: (top + bottom) / 2 };
      if (where === "padding") return { x: (left + right) / 2 + 120, y: top + 4 };
      return { x: right - 40, y: bottom - 5 };   // "under": bottom right
    }, [FRAME, i, where]);
    const clear = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(80); };
    const start = await state();
    const types = await page.evaluate(s => Object.fromEntries([...document.querySelector(s).contentDocument.querySelectorAll("tr[data-st-block]")].filter(r => /^\d+$/.test(r.getAttribute("data-st-block"))).map(r => [r.getAttribute("data-st-block"), r.getAttribute("data-st-type")])), FRAME);
    const wrong = [];
    for (const i of Object.keys(types).map(Number)) {
      if (wrong.length) break;   // the first wrong click is the one to read; the rest follow from it
      for (const where of ["middle", "edge", "padding", "under"]) {
        await clear();
        if (where === "under") {
          if (types[i + 1] == null) continue;
          const nb = await pointIn(i + 1, "edge");
          await page.mouse.click(fr5.x + nb.x, fr5.y + nb.y);
          await page.waitForTimeout(150);
        }
        const pt = await pointIn(i, where);
        await page.mouse.click(fr5.x + pt.x, fr5.y + pt.y);
        await page.waitForTimeout(150);
        const st = await state();
        const good = st.sel === String(i) && st.rail === types[i] && st.crumb && st.tag && st.order === start.order;
        if (!good) { wrong.push({ i, type: types[i], where, got: st }); break; }
      }
    }
    ok(`§5 every click selects the block it lands on (${Object.keys(types).length} blocks × middle, edge, padding, under the next block's handles), and changes nothing`, wrong.length === 0, wrong.slice(0, 2));
    // A click in text: the block, and the caret there.
    await clear();
    const ti = Object.keys(types).find(k => types[k] === "richtext");
    const tp = await page.evaluate(([s, i]) => { const el = document.querySelector(s).contentDocument.querySelector(`[data-st-edit="${i}.blocks"] p`); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; }, [FRAME, ti]);
    await page.mouse.click(fr5.x + tp.x, fr5.y + tp.y);
    await page.waitForTimeout(150);
    const ts = await state();
    ok("§5 a click in text selects its block and puts the caret there", ts.sel === ti && ts.caret === `${ti}.blocks`, ts);
    // A photo's top edge and a stat's number: the photo and the stats, never the "+".
    for (const [type, q] of [["image", "img"], ["hero", "img"], ["stats", '[data-st-edit$=".value"]']]) {
      await clear();
      const bi = Object.keys(types).find(k => types[k] === type);
      const r = await page.evaluate(([s, i, q]) => { const el = document.querySelector(s).contentDocument.querySelector(`tr[data-st-block="${i}"] ${q}`); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 3 }; }, [FRAME, bi, q]);
      await page.mouse.move(fr5.x + r.x, fr5.y + r.y - 20);
      await page.mouse.move(fr5.x + r.x, fr5.y + r.y, { steps: 4 });
      await page.mouse.click(fr5.x + r.x, fr5.y + r.y);
      await page.waitForTimeout(200);
      const st = await state();
      const menu = await page.locator('[data-testid="plus-menu"]').count();
      ok(`§5 a click at the top of the ${type === "stats" ? "stat's number" : type + "'s photo"} selects the ${type}, not the block above or the "+"`, st.sel === bi && menu === 0, { st, menu });
      if (menu) await page.keyboard.press("Escape");
    }
    await browser.close();
  }

  // ── §6 · the preview is light unless Dark mode is pressed ───────────────
  for (const [route, call] of [["a template's preview", async dark => api("POST", `/email-templates/${(await api("POST", "/email-templates", TOK, { starterKey: "spring_appeal" })).body.template.id}/preview`, TOK, dark == null ? {} : { dark })],
    ["the campaign preview", dark => api("POST", "/email-preview", TOK, { blocks: [{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Hi" }] }, { type: "footer" }], ...(dark == null ? {} : { dark }) })]]) {
    const off = await call(null), offFalse = await call(false), on = await call(true);
    const light = r => !(r.body.html || "").includes(EB.DARK_MEDIA) && /@media not all\{\n\.st-body/.test(r.body.html || "") && /<meta name="color-scheme" content="light">/.test(r.body.html || "");
    ok(`§6 ${route}: light with Dark mode off (not following the computer's dark mode)`, light(off) && light(offFalse), (off.body.html || "").slice(0, 0));
    ok(`§6 ${route}: dark with Dark mode pressed`, /@media all\{\n\.st-body/.test(on.body.html || "") && !(on.body.html || "").includes(EB.DARK_MEDIA));
  }
  const sent = EB.renderEmail({ blocks: [{ type: "header" }, { type: "footer" }], brand: {}, fields: {}, links: {}, mode: "send" });
  ok("§6 a send still carries the dark block and both schemes, for real inboxes", sent.html.includes(EB.DARK_MEDIA) && /<meta name="color-scheme" content="light dark">/.test(sent.html));

  await wipe(ORG); await wipe(ORG2);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("suite ran", false, e.message); await closeDb().catch(() => {}); summary(); });

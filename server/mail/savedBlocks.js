// server/mail/savedBlocks.js · BUILDER-2A item 5. SAVED BLOCKS AND READY-MADE BLOCKS.
//
//   GET    /email-blocks                  the org's saved blocks, newest first, each with its preview
//   POST   /email-blocks                  { name, blocks } -> a saved block (blocks pass validateEmailBlocks)
//   PUT    /email-blocks/:id              { name?, blocks? } rename it, or keep new blocks under its name
//   DELETE /email-blocks/:id              the one Remove (removal.js kind saved_block): to the trash, with Undo
//   POST   /email-blocks/:id/use          -> { blocks }: a COPY with fresh ids, never a link to the row
//   GET    /email-blocks/ready            Steward's ready-made sections, previewed in the org's brand
//   POST   /email-blocks/ready/:key/use   -> { blocks }: a copy, its photo one of Steward's, stored for the org
//
// THE RULES IT KEEPS. Every read and write is inside the signed-in person's org
// (a saved block of another org is a 404, the same as one that does not exist).
// Every new row stamps created_by / created_by_name. A GET writes nothing: the
// ready-made previews show Steward's photo by its public thumbnail, and only
// "use" stores it for the org. Nothing here sends, and nothing writes an audit
// row (middleware/auditTrail.js does; this file improves it with req.audit.entity).
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1

const routers = { r0: express.Router() };
let EB = null, PW = null, RB = null, SP = null;
const READY = Promise.all([
  import("../../shared/emailBlocks.js").then(m => { EB = m; }),
  import("../../shared/pageWidgets.js").then(m => { PW = m; }),
  import("../../shared/emailReadyBlocks.js").then(m => { RB = m; }),
  import("../../shared/stockPhotos.js").then(m => { SP = m; }),
]);

const ID_RE = /^esb_[a-f0-9]{20}$/;
const MAX_SAVED = 200;   // per org: a library, not a second store of emails
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const blockId = () => newId("blk");

// Sample fields for a preview, from the one list of merge fields (no person is read).
function sampleFields(ectx) {
  const f = Object.fromEntries(EB.EMAIL_MERGE_FIELDS.map(m => [m.key, m.sample]));
  return { ...f, greeting: f.first_name, org_name: ectx.orgName || f.org_name, give_link: ectx.giveLink || f.give_link };
}
// The blocks as an email in the org's brand: a small standalone page the Blocks tab shows scaled down.
function previewOf(blocks, ectx) {
  const r = EB.renderEmail({ blocks, brand: ectx.brand, fields: sampleFields(ectx), links: ectx.links, mode: "preview" });
  return r.html.replace(EB.FOOTER_SLOT, "");
}
const shape = r => ({
  id: r.id, name: r.name, blocks: Array.isArray(r.blocks) ? r.blocks : [], parts: RB.partsOf(r.blocks),
  previewHtml: r.preview_html || "", createdByName: r.created_by_name || null, createdAt: r.created_at, updatedAt: r.updated_at,
});

function mount(ctx) {
  const { actor, checkWriteAccess, query, run, requireAuth, wrap } = ctx;
  const app = routers.r0;
  const emailContext = orgId => require("../../routes/emailTemplates").buildEmailContext(orgId);
  const rowOf = async (orgId, id) => {
    if (!ID_RE.test(String(id || ""))) return null;
    const [r] = await query(`SELECT id, org_id, name, blocks, preview_html, created_by_name, created_at, updated_at
                               FROM email_saved_blocks WHERE id=? AND org_id=?`, [id, orgId]);
    return r || null;
  };
  // A name and blocks, checked the way a template's are. Returns { error } or { name, blocks }.
  const checked = (b, { needBlocks }) => {
    const name = b.name != null ? clip(b.name, 80).trim() : null;
    if (b.name != null && !name) return { error: "name_required", sentence: "Give the block a name." };
    if (name && /—/.test(name)) return { error: "em_dash", sentence: "Use a comma or a full stop instead of a long dash." };
    let blocks = null;
    if (b.blocks != null || needBlocks) {
      const v = EB.validateEmailBlocks(b.blocks || [], PW.typesForSurface("email"));
      if (!v.ok) return { error: "invalid_blocks", sentence: v.error };
      if (!v.blocks.length) return { error: "no_blocks", sentence: "Choose at least one block to save." };
      if (v.blocks.some(x => x.type === "header" || x.type === "footer")) return { error: "frame_block", sentence: "The header and the footer come with every email, so they are not saved as blocks." };
      blocks = v.blocks;
    }
    return { name, blocks };
  };

  app.get("/email-blocks", requireAuth, wrap(async (req, res) => {
    await READY;
    const rows = await query(`SELECT id, name, blocks, preview_html, created_by_name, created_at, updated_at
                                FROM email_saved_blocks WHERE org_id=? ORDER BY updated_at DESC, id LIMIT ${MAX_SAVED}`, [req.user.orgId]);
    res.json({ saved: rows.map(shape) });
  }));

  app.post("/email-blocks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const c = checked(req.body || {}, { needBlocks: true });
    if (c.error) return res.status(400).json({ error: c.error, sentence: c.sentence });
    if (!c.name) return res.status(400).json({ error: "name_required", sentence: "Give the block a name." });
    const [{ n }] = await query(`SELECT COUNT(*)::int n FROM email_saved_blocks WHERE org_id=?`, [orgId]);
    if (n >= MAX_SAVED) return res.status(409).json({ error: "too_many", sentence: `You have ${MAX_SAVED} saved blocks. Delete one you no longer use first.` });
    const ectx = await emailContext(orgId);
    const id = newId("esb");
    const who = actor(req);
    await run(`INSERT INTO email_saved_blocks (id, org_id, name, blocks, preview_html, created_by, created_by_name)
               VALUES (?,?,?,?::jsonb,?,?,?)`, [id, orgId, c.name, JSON.stringify(c.blocks), previewOf(c.blocks, ectx), who.id, who.name]);
    if (req.audit) req.audit.entity("email_saved_block", id, c.name);
    res.status(201).json({ block: shape(await rowOf(orgId, id)) });
  }));

  app.put("/email-blocks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const row = await rowOf(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "That saved block is not here any more." });
    const c = checked(req.body || {}, { needBlocks: false });
    if (c.error) return res.status(400).json({ error: c.error, sentence: c.sentence });
    const name = c.name || row.name;
    const blocks = c.blocks || row.blocks;
    const preview = c.blocks ? previewOf(blocks, await emailContext(orgId)) : row.preview_html;
    const who = actor(req);
    await run(`UPDATE email_saved_blocks SET name=?, blocks=?::jsonb, preview_html=?, updated_at=NOW(), updated_by=?, updated_by_name=?
                WHERE id=? AND org_id=?`, [name, JSON.stringify(blocks), preview, who.id, who.name, row.id, orgId]);
    if (req.audit) req.audit.entity("email_saved_block", row.id, name);
    res.json({ block: shape(await rowOf(orgId, row.id)) });
  }));

  // The one Remove: the confirm, the trash and Undo are removal.js's.
  app.delete("/email-blocks/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const row = await rowOf(req.user.orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "That saved block is not here any more." });
    return require("../../routes/removal").removeThrough(req, res, "saved_block", row.id, { deleted: true });
  }));

  // A copy, never a link: fresh ids on every block (a Box's children too).
  // A POST because using is an act; it writes nothing.
  app.post("/email-blocks/:id/use", requireAuth, wrap(async (req, res) => {
    await READY;
    const row = await rowOf(req.user.orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "That saved block is not here any more." });
    const v = EB.validateEmailBlocks(RB.copyBlocks(row.blocks, blockId), PW.typesForSurface("email"));
    if (!v.ok) return res.status(409).json({ error: "invalid_blocks", sentence: v.error });
    res.json({ blocks: v.blocks, name: row.name });
  }));

  // Steward's ready-made sections, each previewed in this org's brand with a
  // photo from its mission group (shown by the photo's public thumbnail: a GET
  // stores nothing).
  app.get("/email-blocks/ready", requireAuth, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const ectx = await emailContext(orgId);
    const group = await require("../../routes/stockPhotos").orgGroup(orgId).catch(() => SP.FALLBACK_GROUP);
    const base = `${req.protocol}://${req.get("host")}`;
    res.json({
      ready: RB.READY_BLOCKS.map(r => {
        const pick = SP.pickStock(group, r.key);
        const blocks = RB.fillStockPhotos(r.blocks, pick ? { src: `${base}/stock-photos/thumb/${encodeURIComponent(pick.id)}`, alt: pick.alt } : null);
        return { key: r.key, name: r.name, hint: r.hint, parts: RB.partsOf(r.blocks), previewHtml: previewOf(blocks, ectx) };
      }),
    });
  }));

  // Using a ready-made section stores its photo for the org (the stock
  // photo's own path, content-addressed) and hands back a copy with fresh ids.
  app.post("/email-blocks/ready/:key/use", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const def = RB.readyBlockByKey(req.params.key);
    if (!def) return res.status(404).json({ error: "not_found", sentence: "That is not one of Steward's ready-made blocks." });
    let pic = null;
    if (JSON.stringify(def.blocks).includes("\"stockPhoto\":true")) {
      const SPR = require("../../routes/stockPhotos");
      const group = await SPR.orgGroup(orgId).catch(() => SP.FALLBACK_GROUP);
      const p = await SPR.useStockPhoto(orgId, SP.pickStock(group, def.key).id).catch(() => null);
      if (p) pic = { src: p.url, alt: p.alt };
    }
    const v = EB.validateEmailBlocks(RB.copyBlocks(RB.fillStockPhotos(def.blocks, pic), blockId), PW.typesForSurface("email"));
    if (!v.ok) return res.status(500).json({ error: "invalid_blocks", sentence: v.error });
    res.json({ blocks: v.blocks, name: def.name });
  }));
}

module.exports = { routers, mount };

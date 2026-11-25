// server/mail/emailTogether.js · BUILDER-3. WORKING ON AN EMAIL TOGETHER.
//
//   POST /email-templates/:id/presence        heartbeat { blockId, editingBlockId } -> who else is here,
//                                             the block each has selected, the blocks each holds, and the
//                                             email's rev (a save by someone else shows up within 3 s)
//   POST /email-templates/:id/presence/leave  this person closed the email
//   GET  /email-templates/:id/live            the email as saved now, with its rev (reading only)
//   GET  /email-templates/:id/comments        its threads, newest last, and the people who can be @mentioned
//   POST /email-templates/:id/comments        { blockId, body, parentId?, mentions[] } a comment on one block
//   POST /email-comments/:id/resolve          the thread is resolved, and hidden
//   POST /email-comment-mentions/:id/dismiss  the bell stops listing this mention
//   POST /email-templates/:id/share           { audience: org|outside, as?, sample?, allowComments?, reviewerName? } -> a link
//   GET  /email-templates/:id/shares          the links made for this email, live or not
//   POST /email-review-links/:id/revoke       a link stops working at once
//   GET  /email-reviews/:id                   a review link for someone in the org (signed in): the email, read only
//   GET  /public/email-review/:token          the outside reviewer's view-only page data (no sign-in)
//   POST /public/email-review/:token/comments a comment from the outside reviewer, when the link allows it
//   GET  /email-style   PUT /email-style      the org's house style (PUT: admins)
//
// THE RULES IT KEEPS
// - Presence is no new paid service and no socket: a heartbeat every 3 s (the brief's fallback;
//   docs/needs-jonathan/BUILDER-3.md has the one-line option for a push channel). Its table is
//   silent (shared/changeTopics.cjs) and a heartbeat writes no audit row (it is nobody's change).
// - A block lock is presence: the block a person is typing in is theirs until they move on or
//   are idle 30 s. A save that changes a block someone else holds keeps their version of it.
// - Comments live beside the blocks, never in them: no send and no rendered HTML can carry one.
// - A @mention is an in-app line in the person's bell (routes/atlas.js /atlas/activity), never an email.
// - A review link is the email for one previewed person (only that person's merge values) or with
//   sample values. A GET on it writes nothing. It expires in 7 days; only the token's SHA-256 is kept.
//   Another org's link, or an unknown, expired or revoked one, shows nothing.
"use strict";
const express = require("express");
const crypto = require("crypto");
const { newId } = require("../shared/newId");

const routers = { r0: express.Router() };
let EB = null, PW = null, MG = null, ST = null;
const READY = Promise.all([
  import("../../shared/emailBlocks.js").then(m => { EB = m; }),
  import("../../shared/pageWidgets.js").then(m => { PW = m; }),
  import("../../shared/emailMerge.js").then(m => { MG = m; }),
  import("../../shared/emailStyle.js").then(m => { ST = m; }),
]);

const TPL_RE = /^et_(?:[a-f0-9]{12}|[a-f0-9]{20})$/;
const SEEN_S = 15;                 // a person is "here" for 15 s after their last heartbeat
const LOCK_IDLE_S = 30;            // a block is held for 30 s after its holder last typed in it
const REVIEW_DAYS = 7;
const MAX_COMMENT = 2000;
// Emerald shades and brass only (CLAUDE.md's four colours, and their shades).
const COLORS = ["#0D5C3A", "#C9A84C", "#3E8E66", "#8A6D1F", "#6FB592", "#A88A3A"];
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "Someone";
const initialOf = n => (String(n || "").trim()[0] || "?").toUpperCase();
const blockIdOk = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);

let C = null;
const q = (...a) => C.query(...a);

// The blocks someone else holds now on this email (for a save, and for the editor).
async function othersHold(orgId, templateId, userId) {
  const rows = await q(`SELECT editing_block_id FROM email_editor_presence
                         WHERE org_id=? AND template_id=? AND user_id<>? AND editing_block_id IS NOT NULL
                           AND edited_at > NOW() - INTERVAL '${LOCK_IDLE_S} seconds' AND seen_at > NOW() - INTERVAL '${SEEN_S} seconds'`,
  [orgId, templateId, userId]);
  return new Set(rows.map(r => r.editing_block_id));
}

// The code in an email's code blocks (a Box's too), as text: what a non-admin may not add or change.
function codesOf(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b && b.type === "code") out.push(String(b.html || ""));
    if (b && b.type === "box") for (const c of b.children || []) if (c && c.type === "code") out.push(String(c.html || ""));
  }
  return out;
}
// BUILDER-3 item 5: a Code block is admins' only, on the server too (the editor hides its tile and
// settings from everyone else). Anyone may save an email that carries an admin's code unchanged,
// or take a code block out. Returns null, or { status, error, sentence } to refuse with.
async function codeGuard(req, before, after) {
  const was = codesOf(before);
  const added = codesOf(after).filter(c => { const i = was.indexOf(c); if (i >= 0) { was.splice(i, 1); return false; } return true; });
  if (!added.length) return null;
  const role = req.user.support ? "admin" : await require("../auth/access").liveRoleIn(req.user.userId, req.user.orgId);
  return role === "admin" ? null : { status: 403, error: "code_admin_only", sentence: "Only an admin can add or change a code block. Everything else in this email can be saved without it." };
}

// saveTemplate (routes/emailTemplates.js) calls this with the blocks it validated. It gives every
// block an id, merges a save that started from an older rev with what is saved now, keeps a block
// someone else holds as they have it, and refuses a code block from anyone but an admin.
// Returns { blocks, meta, merged } or { status, error, sentence }.
async function prepareSave(req, row, b, blocks, meta) {
  await READY;
  const orgId = req.user.orgId, userId = req.user.userId;
  const savedNow = row.draft && Array.isArray(row.draft.blocks) ? row.draft : { name: row.name, subject: row.subject, preheader: row.preheader, blocks: row.blocks || [] };
  const theirs = MG.withIds(savedNow.blocks);
  let mine = MG.withIds(blocks), outMeta = meta, merged = null;
  const held = await othersHold(orgId, row.id, userId);
  const baseRev = b.baseRev == null ? null : Number(b.baseRev);
  if (baseRev != null && Number.isFinite(baseRev) && baseRev !== Number(row.rev || 0) && Array.isArray(b.base)) {
    const r = MG.mergeBlocks({ base: b.base, theirs, mine, lockedByOthers: held });
    mine = MG.withIds(r.blocks);
    outMeta = MG.mergeMeta({ base: b.baseMeta || {}, theirs: savedNow, mine: meta });
    merged = { from: baseRev, into: Number(row.rev || 0), conflicts: r.conflicts, held: r.held };
  } else if (held.size) {
    // Same rev, but someone else is typing in a block this save changes: theirs stands.
    const r = MG.mergeBlocks({ base: theirs, theirs, mine, lockedByOthers: held });
    if (r.held.length) { mine = MG.withIds(r.blocks); merged = { from: Number(row.rev || 0), into: Number(row.rev || 0), conflicts: [], held: r.held }; }
  }
  const refused = await codeGuard(req, theirs, mine);
  if (refused) return refused;
  return { blocks: mine, meta: outMeta, merged };
}

// The people of the org who can be @mentioned (and named on a face).
async function orgPeople(orgId) {
  return q(`SELECT id, name FROM users WHERE org_id=? AND deactivated_at IS NULL ORDER BY lower(name)`, [orgId]);
}

// The email as a reviewer sees it: for the one previewed person, or with sample values.
async function reviewHtml(orgId, row, link) {
  const T = require("../../routes/emailTemplates");
  const ectx = await T.buildEmailContext(orgId);
  let fields = Object.fromEntries(EB.EMAIL_MERGE_FIELDS.map(f => [f.key, f.sample]));
  fields = { ...fields, greeting: fields.first_name, org_name: ectx.orgName || fields.org_name, give_link: ectx.giveLink || fields.give_link };
  let shownAs = null;
  if (link.preview_as) {
    const [d] = await q("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [link.preview_as, orgId]);
    if (d) { shownAs = firstName(d.name); fields = { ...fields, ...(await T.donorFieldsFor(orgId, d, ectx)) }; }
  }
  const src = row.draft && Array.isArray(row.draft.blocks) ? row.draft : row;
  const r = EB.renderEmail({ blocks: src.blocks || [], brand: ectx.brand, fields, links: ectx.links, subject: src.subject || "", preheader: src.preheader || "", mode: "preview" });
  const org = String(ectx.orgName || "us").replace(/[<>&"]/g, "");
  const html = EB.previewScheme(r.html.replace(EB.FOOTER_SLOT, `You are receiving this email from ${org}. <a href="#unsubscribe" style="color:#6b6b64;text-decoration:underline;">Unsubscribe</a>`), false);
  const parts = MG.withIds(src.blocks || []).filter(x => x.type !== "header" && x.type !== "footer").map((x, i) => ({ id: x.id, label: `Part ${i + 1}: ${partName(x)}` }));
  return { html, subject: EB.renderSubject(src.subject || "", fields), name: src.name || row.name, shownAs, sample: !shownAs, parts };
}
function partName(b) {
  const n = { richtext: "Text", image: "Image", button: "Button", divider: "Divider", columns: "Columns", signature: "Signature", giftsummary: "Gift summary",
    social: "Social", box: "Box", event: "Event", givingpage: "Giving page", video: "Video", stats: "Stats", quote: "Quote", hero: "Hero", photos2: "Two photos", code: "Code" }[b.type] || "Part";
  const words = b.type === "richtext" && Array.isArray(b.blocks) && b.blocks[0] ? String(b.blocks[0].text || (b.blocks[0].items || [])[0] || "") : b.type === "button" ? String(b.label || "") : "";
  return words ? `${n} ("${words.slice(0, 40)}${words.length > 40 ? "…" : ""}")` : n;
}
const commentOut = c => ({ id: c.id, blockId: c.block_id, parentId: c.parent_id || null, body: c.body, authorName: c.author_name,
  outside: !!c.review_link_id, resolved: !!c.resolved_at, resolvedByName: c.resolved_by_name || null, at: c.created_at });

// A review link row by its token (outside) or id (inside), live and of this org only.
async function liveLink(where, params) {
  const [l] = await q(`SELECT * FROM email_review_links WHERE ${where} AND revoked_at IS NULL AND expires_at > NOW()`, params);
  return l || null;
}

// The bell's lines for one person: comments that mention them, not dismissed, thread not resolved.
async function openMentions(query, orgId, userId, limit = 10) {
  const rows = await query(`SELECT m.id, m.comment_id, c.template_id, c.block_id, c.body, c.author_name, c.created_at, t.name AS template_name
                              FROM email_comment_mentions m JOIN email_comments c ON c.id = m.comment_id AND c.org_id = m.org_id
                              JOIN email_templates t ON t.id = c.template_id AND t.org_id = c.org_id
                             WHERE m.org_id=? AND m.user_id=? AND m.dismissed_at IS NULL AND c.resolved_at IS NULL
                             ORDER BY c.created_at DESC LIMIT ?`, [orgId, userId, limit]).catch(() => []);
  return rows.map(r => ({ id: `mention_${r.id}`, mentionId: r.id, kind: "mention", state: "waiting", waits: true, undoable: false, by: r.author_name,
    line: `mentioned you on "${String(r.template_name).slice(0, 60)}": "${String(r.body).slice(0, 80)}${String(r.body).length > 80 ? "…" : ""}"`,
    link: { tab: "template", templateId: r.template_id, commentId: r.comment_id }, at: r.created_at, seenAt: null }));
}

function mount(ctx) {
  C = ctx;
  const { actor, checkWriteAccess, run, requireAuth, requireAdmin, wrap } = ctx;
  const app = routers.r0;
  const tpl = async (orgId, id) => {
    if (!TPL_RE.test(String(id || ""))) return null;
    const [r] = await q(`SELECT * FROM email_templates WHERE id=? AND org_id=?`, [id, orgId]);
    return r || null;
  };
  const nameOf = async req => { const who = actor(req); const [u] = await q(`SELECT name FROM users WHERE id=? AND org_id=?`, [who.id, req.user.orgId]).catch(() => []); return (u && u.name) || who.name || "Someone"; };

  // ── PRESENCE AND LOCKS ──────────────────────────────────────────────────
  app.post("/email-templates/:id/presence", requireAuth, wrap(async (req, res) => {
    await READY;
    if (req.audit) req.audit.skip("a heartbeat: who has the email open");
    const orgId = req.user.orgId, userId = req.user.userId;
    const row = await tpl(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const b = req.body || {};
    const blockId = blockIdOk(b.blockId) ? b.blockId : null;
    const editing = blockIdOk(b.editingBlockId) ? b.editingBlockId : null;
    const held = editing ? await othersHold(orgId, row.id, userId) : new Set();
    const mayHold = editing && !held.has(editing) ? editing : null;
    const name = await nameOf(req);
    await run(`INSERT INTO email_editor_presence (org_id, template_id, user_id, user_name, block_id, editing_block_id, edited_at, seen_at)
               VALUES (?,?,?,?,?,?,${mayHold ? "NOW()" : "NULL"},NOW())
               ON CONFLICT (template_id, user_id) DO UPDATE SET org_id=EXCLUDED.org_id, user_name=EXCLUDED.user_name, block_id=EXCLUDED.block_id,
                 editing_block_id=EXCLUDED.editing_block_id,
                 edited_at=CASE WHEN EXCLUDED.editing_block_id IS NULL THEN NULL
                                WHEN b.typed THEN NOW()
                                WHEN email_editor_presence.editing_block_id IS DISTINCT FROM EXCLUDED.editing_block_id THEN NOW()
                                ELSE email_editor_presence.edited_at END,
                 seen_at=NOW()`.replace("b.typed", b.typed ? "true" : "false"),
    [orgId, row.id, userId, name, blockId, mayHold]);
    res.json(await presenceOut(orgId, row, userId, editing && !mayHold ? editing : null));
  }));
  async function presenceOut(orgId, row, userId, refused) {
    const rows = await q(`SELECT user_id, user_name, block_id, editing_block_id, edited_at, joined_at FROM email_editor_presence
                           WHERE org_id=? AND template_id=? AND seen_at > NOW() - INTERVAL '${SEEN_S} seconds' ORDER BY joined_at, user_id`, [orgId, row.id]);
    const [{ now }] = await q(`SELECT NOW() AS now`);
    const people = rows.map((r, i) => {
      const holds = r.editing_block_id && r.edited_at && (new Date(now) - new Date(r.edited_at)) < LOCK_IDLE_S * 1000 ? r.editing_block_id : null;
      return { userId: r.user_id, name: r.user_name, firstName: firstName(r.user_name), initial: initialOf(r.user_name), color: COLORS[i % COLORS.length],
        blockId: r.block_id || null, holds, me: r.user_id === userId };
    });
    const me = people.find(p => p.me) || null;
    const by = refused ? people.find(p => !p.me && p.holds === refused) : null;
    return { rev: Number(row.rev || 0), me, others: people.filter(p => !p.me),
      refused: by ? { blockId: refused, sentence: `${by.firstName} is editing this. You can type in it when ${by.firstName} moves on.` } : null };
  }
  app.post("/email-templates/:id/presence/leave", requireAuth, wrap(async (req, res) => {
    if (req.audit) req.audit.skip("closing the email: who has it open");
    const row = await tpl(req.user.orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    await run(`DELETE FROM email_editor_presence WHERE org_id=? AND template_id=? AND user_id=?`, [req.user.orgId, row.id, req.user.userId]);
    res.json({ ok: true });
  }));
  // The email as saved now: what someone else saved, for the editor to merge in. Reading only.
  app.get("/email-templates/:id/live", requireAuth, wrap(async (req, res) => {
    await READY;
    const row = await tpl(req.user.orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const src = row.draft && Array.isArray(row.draft.blocks) ? row.draft : row;
    res.json({ rev: Number(row.rev || 0), name: src.name || row.name, subject: src.subject || "", preheader: src.preheader || "", blocks: MG.withIds(src.blocks || []),
      hasDraft: !!row.draft, savedByName: row.words_saved_by_name || null, updatedAt: row.updated_at });
  }));

  // ── COMMENTS ────────────────────────────────────────────────────────────
  app.get("/email-templates/:id/comments", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const row = await tpl(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const rows = await q(`SELECT * FROM email_comments WHERE org_id=? AND template_id=? ORDER BY created_at, id`, [orgId, row.id]);
    res.json({ comments: rows.map(commentOut), people: (await orgPeople(orgId)).map(p => ({ id: p.id, name: p.name })) });
  }));
  app.post("/email-templates/:id/comments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const row = await tpl(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const b = req.body || {};
    const body = clip(b.body, MAX_COMMENT).trim();
    if (!body) return res.status(400).json({ error: "body_required", sentence: "Write the comment first." });
    if (!blockIdOk(b.blockId)) return res.status(400).json({ error: "block_required", sentence: "Choose the part of the email the comment is about." });
    let parentId = null;
    if (b.parentId) {
      const [p] = await q(`SELECT id, block_id FROM email_comments WHERE id=? AND org_id=? AND template_id=?`, [String(b.parentId), orgId, row.id]);
      if (!p) return res.status(404).json({ error: "not_found", sentence: "That thread is gone." });
      parentId = p.id;
    }
    // Mentions: people of this org only; anyone else named is ignored.
    const people = await orgPeople(orgId);
    const ids = new Set(people.map(p => p.id));
    const mentions = [...new Set((Array.isArray(b.mentions) ? b.mentions : []).map(String))].filter(id => ids.has(id) && id !== req.user.userId).slice(0, 20);
    const who = actor(req), name = await nameOf(req);
    const id = newId("ecm");
    await run(`INSERT INTO email_comments (id, org_id, template_id, block_id, parent_id, body, author_name, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, orgId, row.id, b.blockId, parentId, body, name, who.id, who.name]);
    for (const uid of mentions) await run(`INSERT INTO email_comment_mentions (id, org_id, comment_id, user_id, created_by, created_by_name) VALUES (?,?,?,?,?,?)`,
      [newId("ecmn"), orgId, id, uid, who.id, who.name]);
    if (req.audit) { req.audit.entity("email_template", row.id, row.name); req.audit.action("commented"); }
    const [c] = await q(`SELECT * FROM email_comments WHERE id=? AND org_id=?`, [id, orgId]);
    const named = people.filter(p => mentions.includes(p.id)).map(p => firstName(p.name));
    res.json({ comment: commentOut(c), sentence: named.length ? `Comment added. ${named.join(", ")} will see it in the bell; nobody is emailed.` : "Comment added." });
  }));
  app.post("/email-comments/:id/resolve", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [c] = await q(`SELECT * FROM email_comments WHERE id=? AND org_id=?`, [String(req.params.id), orgId]);
    if (!c) return res.status(404).json({ error: "not_found", sentence: "That comment is gone." });
    const root = c.parent_id || c.id;
    const who = actor(req), name = await nameOf(req);
    const reopen = (req.body || {}).reopen === true;
    await run(reopen
      ? `UPDATE email_comments SET resolved_at=NULL, resolved_by=NULL, resolved_by_name=NULL WHERE org_id=? AND (id=? OR parent_id=?)`
      : `UPDATE email_comments SET resolved_at=NOW(), resolved_by=?, resolved_by_name=? WHERE org_id=? AND (id=? OR parent_id=?) AND resolved_at IS NULL`,
    reopen ? [orgId, root, root] : [who.id, name, orgId, root, root]);
    if (req.audit) { req.audit.entity("email_template", c.template_id); req.audit.action(reopen ? "reopened a comment" : "resolved a comment"); }
    res.json({ ok: true, sentence: reopen ? "The thread is open again." : "Resolved. The thread is hidden; Show resolved brings it back." });
  }));
  app.post("/email-comment-mentions/:id/dismiss", requireAuth, wrap(async (req, res) => {
    // Only her own mention, in this org: anyone else's is a 404, the same as one that isn't there.
    const [m] = await q(`SELECT id FROM email_comment_mentions WHERE id=? AND org_id=? AND user_id=?`, [String(req.params.id), req.user.orgId, req.user.userId]);
    if (!m) return res.status(404).json({ error: "not_found", sentence: "That mention is gone." });
    const r = await run(`UPDATE email_comment_mentions SET dismissed_at=NOW() WHERE id=? AND org_id=? AND user_id=? AND dismissed_at IS NULL`,
      [String(req.params.id), req.user.orgId, req.user.userId]);
    if (!(r && r.changes)) return res.status(409).json({ error: "not_waiting", sentence: "That mention isn't waiting any more." });
    res.json({ ok: true });
  }));

  // ── SHARE FOR REVIEW ────────────────────────────────────────────────────
  app.post("/email-templates/:id/share", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const row = await tpl(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const b = req.body || {};
    const audience = b.audience === "outside" ? "outside" : "org";
    let asId = null, asName = null;
    if (b.as && b.sample !== true) {
      const [d] = await q("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(b.as), orgId]);
      if (!d) return res.status(404).json({ error: "not_found", sentence: "That person is not in your records." });
      asId = d.id; asName = firstName(d.name);
    }
    const who = actor(req);
    const id = newId("erl");
    const token = audience === "outside" ? crypto.randomBytes(24).toString("base64url") : null;
    const allow = b.allowComments === true;
    await run(`INSERT INTO email_review_links (id, org_id, template_id, audience, token_hash, preview_as, allow_comments, reviewer_name, expires_at, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?,?, NOW() + INTERVAL '${REVIEW_DAYS} days', ?, ?)`,
    [id, orgId, row.id, audience, token ? hash(token) : null, asId, allow, clip(b.reviewerName, 80).trim() || null, who.id, who.name]);
    const [l] = await q(`SELECT expires_at FROM email_review_links WHERE id=?`, [id]);
    const app0 = require("../../publicUrl").publicAppUrl();
    const url = audience === "outside" ? `${app0}/review/${token}` : `${app0}/app/review/${id}`;
    if (req.audit) { req.audit.entity("email_template", row.id, row.name); req.audit.action(audience === "outside" ? "shared for outside review" : "shared for review"); }
    const as = asName ? `as ${asName} sees it` : "with sample values";
    res.json({ id, url, audience, expiresAt: l.expires_at, allowComments: allow,
      sentence: audience === "outside"
        ? `A private view-only link, ${as}${allow ? ", where the reviewer can leave comments" : ""}. It works for 7 days; anyone with it can view the email, so send it only to your reviewer.`
        : `A review link for people in your organization (they sign in), ${as}. It works for 7 days.` });
  }));
  app.get("/email-templates/:id/shares", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const row = await tpl(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const rows = await q(`SELECT id, audience, preview_as, allow_comments, reviewer_name, expires_at, revoked_at, created_by_name, created_at, (expires_at > NOW() AND revoked_at IS NULL) AS live
                            FROM email_review_links WHERE org_id=? AND template_id=? ORDER BY created_at DESC LIMIT 50`, [orgId, row.id]);
    res.json({ shares: rows.map(r => ({ id: r.id, audience: r.audience, sample: !r.preview_as, allowComments: r.allow_comments, reviewerName: r.reviewer_name,
      expiresAt: r.expires_at, live: r.live, revoked: !!r.revoked_at, byName: r.created_by_name, at: r.created_at })) });
  }));
  app.post("/email-review-links/:id/revoke", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const r = await run(`UPDATE email_review_links SET revoked_at=NOW() WHERE id=? AND org_id=? AND revoked_at IS NULL`, [String(req.params.id), req.user.orgId]);
    if (!(r && r.changes)) return res.status(404).json({ error: "not_found", sentence: "That link is already off." });
    res.json({ ok: true, sentence: "The link no longer works." });
  }));
  // The in-org review page: signed in, same org, read only.
  app.get("/email-reviews/:id", requireAuth, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const link = await liveLink(`id=? AND org_id=? AND audience='org'`, [String(req.params.id), orgId]);
    if (!link) return res.status(404).json({ error: "not_found", sentence: "This review link has expired or been turned off. Ask for a new one." });
    const row = await tpl(orgId, link.template_id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "This email is no longer there." });
    const comments = await q(`SELECT * FROM email_comments WHERE org_id=? AND template_id=? AND resolved_at IS NULL ORDER BY created_at`, [orgId, row.id]);
    res.json({ ...(await reviewHtml(orgId, row, link)), templateId: row.id, expiresAt: link.expires_at, comments: comments.map(commentOut), canComment: true, inside: true });
  }));
  // The outside reviewer: no sign-in, the token only. A GET (and a HEAD) writes nothing.
  const outside = async token => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) return null;
    return liveLink(`token_hash=? AND audience='outside'`, [hash(token)]);
  };
  app.get("/public/email-review/:token", wrap(async (req, res) => {
    await READY;
    res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex");
    const link = await outside(req.params.token);
    if (!link) return res.status(404).json({ error: "not_found", sentence: "This review link has expired or been turned off. Ask the person who sent it for a new one." });
    const row = await tpl(link.org_id, link.template_id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "This email is no longer there." });
    const comments = link.allow_comments ? await q(`SELECT * FROM email_comments WHERE org_id=? AND template_id=? AND review_link_id=? ORDER BY created_at`, [link.org_id, row.id, link.id]) : [];
    const r = await reviewHtml(link.org_id, row, link);
    res.json({ ...r, expiresAt: link.expires_at, canComment: !!link.allow_comments, comments: comments.map(commentOut), reviewerName: link.reviewer_name || null });
  }));
  app.post("/public/email-review/:token/comments", wrap(async (req, res) => {
    await READY;
    const link = await outside(req.params.token);
    if (!link) return res.status(404).json({ error: "not_found", sentence: "This review link has expired or been turned off." });
    if (!link.allow_comments) return res.status(403).json({ error: "view_only", sentence: "This link is view only." });
    const b = req.body || {};
    const body = clip(b.body, MAX_COMMENT).trim();
    if (!body) return res.status(400).json({ error: "body_required", sentence: "Write the comment first." });
    const row = await tpl(link.org_id, link.template_id);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "This email is no longer there." });
    const parts = MG.withIds((row.draft && row.draft.blocks) || row.blocks || []);
    const blockId = blockIdOk(b.blockId) && parts.some(p => p.id === b.blockId) ? b.blockId : (parts.find(p => p.type !== "header") || parts[0] || { id: "p0" }).id;
    const name = (clip(b.name, 80).trim() || link.reviewer_name || "Reviewer") + " (reviewer)";
    const id = newId("ecm");
    const actorId = `system:email-review/${link.id}`;
    await run(`INSERT INTO email_comments (id, org_id, template_id, block_id, body, author_name, review_link_id, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, link.org_id, row.id, blockId, body, name, link.id, actorId, name]);
    if (req.audit) { req.audit.org(link.org_id); req.audit.actor({ id: actorId, name }); req.audit.entity("email_template", row.id, row.name); req.audit.action("commented (outside reviewer)"); }
    const [c] = await q(`SELECT * FROM email_comments WHERE id=?`, [id]);
    res.json({ comment: commentOut(c), sentence: "Thank you. Your comment is with the team." });
  }));

  // ── HOUSE STYLE ─────────────────────────────────────────────────────────
  app.get("/email-style", requireAuth, wrap(async (req, res) => {
    await READY;
    const [r] = await q(`SELECT email_style FROM portal_settings WHERE org_id=?`, [req.user.orgId]);
    res.json({ style: ST.normalizeEmailStyle(r && r.email_style), set: !!(r && r.email_style),
      fonts: ST.EMAIL_STYLE_FONTS.map(f => ({ key: f.key, label: f.label })), linkColors: ST.EMAIL_STYLE_LINK_COLORS, buttons: ST.EMAIL_STYLE_BUTTONS.map(b => ({ key: b.key, label: b.label })),
      sizes: ST.EMAIL_STYLE_SIZES, defaults: ST.EMAIL_STYLE_DEFAULTS });
  }));
  app.put("/email-style", requireAuth, checkWriteAccess, requireAdmin, wrap(async (req, res) => {
    await READY;
    const orgId = req.user.orgId;
    const b = req.body || {};
    const v = b.reset === true ? { ok: true, style: null } : ST.validateEmailStyle(b.style || {});
    if (!v.ok) return res.status(400).json({ error: "invalid_style", sentence: v.error });
    const [before] = await q(`SELECT email_style FROM portal_settings WHERE org_id=?`, [orgId]);
    const who = actor(req);
    await run(`INSERT INTO portal_settings (org_id, email_style) VALUES (?, ?::jsonb) ON CONFLICT (org_id) DO UPDATE SET email_style=EXCLUDED.email_style`,
      [orgId, v.style ? JSON.stringify(v.style) : null]);
    if (req.audit) { req.audit.entity("email_style", orgId, "House style for emails"); req.audit.before({ email_style: before ? before.email_style : null }); req.audit.after({ email_style: v.style }); }
    res.json({ style: ST.normalizeEmailStyle(v.style), set: !!v.style, by: who.name,
      sentence: v.style ? "Saved. Every email shows the new style the next time it is opened or sent; parts with their own style keep it." : "Back to Steward's style for every email." });
  }));
}

module.exports = { routers, mount, prepareSave, codeGuard, openMentions, COLORS, LOCK_IDLE_S, SEEN_S };

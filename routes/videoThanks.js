// routes/videoThanks.js, PARITY-1 Part F. A VIDEO THANK-YOU.
//
// STAFF SIDE (signed in): on the donor profile she records up to two minutes
// with her camera, watches it back, and saves it. Saving stores the file in
// the org's own asset store (assetStore.putThemeAsset: the S3-compatible
// bucket, or Postgres when there is none) and writes ONE DRAFT email to the
// donor in the review queue (milestone_drafts, source 'video_thanks') with the
// link in it. Nothing is sent: a person reads the draft and presses send.
//
// PUBLIC SIDE: /v/:token, a small server-rendered page in the org's own band
// colour and logo (shared/publicPage.js) with a <video> that streams from
// /v/:token/video. The token is 32 bytes of crypto randomness, so the link is
// the credential, and nothing else about the donor is in it.
//
// A GET NEVER CHANGES STATE. Opening the page, fetching the video and a HEAD
// on either write nothing (a mail scanner prefetching the link is not a
// view). The page itself POSTs /v/:token/viewed when the video starts to
// play, and that is the one write: the view count, the first-viewed time,
// and, once, a line on the donor's timeline.
//
// There is no virus scanner on this host. What is checked is the size (60MB),
// the declared type (video/webm or video/mp4 only) and that the first bytes
// are really that container (an EBML header naming webm, or an ISO box with
// `ftyp`). The file is only ever served back with that same video type and
// `nosniff`, so a browser never runs it as anything else.
const express = require("express");
const crypto = require("crypto");
const { putThemeAsset, getThemeAsset } = require("../assetStore");
const { publicAppUrl } = require("../publicUrl");

const routers = { r0: express.Router() };

// ── Shared consts (the TDZ rule: above every line that reads them) ─────────
const VIDEO_MAX_BYTES = 60 * 1024 * 1024;   // one decision with server.js's raw-body limit
const VIDEO_MAX_SECONDS = 120;
const VIDEO_MIMES = ["video/webm", "video/mp4"];
const VIDEO_ASSET_KIND = "video_thanks";
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const VIEW_ACTOR = { id: "system:video-thanks", name: "Video thank-you" };

// The declared type, without codec parameters ("video/webm;codecs=vp8,opus").
function baseMime(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase();
}

// Are these bytes really the container the upload says they are?
//   webm: an EBML header (1A 45 DF A3) whose DocType is "webm".
//   mp4:  an ISO base-media file, whose first box is `ftyp` at offset 4.
function videoBytesMatchMime(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const m = baseMime(mime);
  if (m === "video/webm") {
    if (!buffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return false;
    return buffer.slice(0, 64).includes(Buffer.from("webm", "latin1"));
  }
  if (m === "video/mp4") return buffer.slice(4, 8).toString("latin1") === "ftyp";
  return false;
}

function newToken() { return crypto.randomBytes(32).toString("base64url"); }
function videoUrl(token) { return `${publicAppUrl()}/v/${token}`; }
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "there";

function mount(ctx) {
const {
  actor, checkWriteAccess, orgToday, orgTz, query, requireAuth, resolveOrgBrandTheme, run, uuid, videoLimiter, wrap,
} = ctx;

let PP = null;
const READY = import("../shared/publicPage.js").then(m => { PP = m; });
const app = routers.r0;
const DEFAULT_BRAND = { band: "#0d5c3a", bandFg: "#ffffff", displayName: "", logoDataUri: null, logoAbsUrl: null };
async function brandOf(orgId) {
  const t = await resolveOrgBrandTheme(orgId).catch(() => null);
  return t || DEFAULT_BRAND;
}
async function byToken(token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const [v] = await query(
    `SELECT v.*, d.name AS donor_name, o.name AS org_name
       FROM video_thanks v JOIN donors d ON d.id = v.donor_id AND d.org_id = v.org_id
       JOIN orgs o ON o.id = v.org_id
      WHERE v.token = ? AND d.deleted_at IS NULL`, [String(token)]);
  return v || null;
}
const shape = v => ({
  id: v.id, donorId: v.donor_id, mime: v.mime, bytes: v.bytes, durationSeconds: v.duration_seconds,
  hasVideo: !!v.asset_id, createdAt: v.created_at, createdByName: v.created_by_name || null,
  firstViewedAt: v.first_viewed_at, viewCount: Number(v.view_count) || 0,
  url: videoUrl(v.token), previewUrl: `${videoUrl(v.token)}?preview=1`,
  draftId: v.draft_id || null, draftStatus: v.draft_status || null,
});

// ── STAFF ───────────────────────────────────────────────────────────────────
// The upload is the raw file (server.js gives this one path a 61MB raw body),
// with the length she recorded in ?duration=. The person is checked FIRST, so
// another organisation's donor id is a 404 whatever the body is.
app.post("/donors/:id/video-thanks", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(
    `SELECT id, name, email, deceased, do_not_contact FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  if (d.deceased || d.do_not_contact)
    return res.status(400).json({ error: "not_contactable", sentence: "This record says not to contact them, so Steward will not prepare a message to them." });
  if (!String(d.email || "").trim())
    return res.status(400).json({ error: "no_email", sentence: `${d.name} has no email address on file, so there is nowhere to send the link. Add one first.` });
  const mime = baseMime(req.headers["content-type"]);
  if (!VIDEO_MIMES.includes(mime))
    return res.status(415).json({ error: "unsupported_type", sentence: "A video thank-you has to be a WebM or MP4 video." });
  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer || !buffer.length) return res.status(400).json({ error: "empty", sentence: "No video arrived. Record it again and save." });
  if (buffer.length > VIDEO_MAX_BYTES)
    return res.status(413).json({ error: "too_large", sentence: `That video is ${Math.ceil(buffer.length / 1024 / 1024)} MB. The limit is ${VIDEO_MAX_BYTES / 1024 / 1024} MB.` });
  if (!videoBytesMatchMime(buffer, mime))
    return res.status(415).json({ error: "not_a_video", sentence: "That file is not the video it says it is." });
  const dur = Math.round(Number(req.query.duration));
  const duration = Number.isFinite(dur) && dur > 0 ? Math.min(dur, VIDEO_MAX_SECONDS) : null;

  const stored = await putThemeAsset({ orgId, kind: VIDEO_ASSET_KIND, buffer, contentType: mime });
  const id = "vt_" + uuid().slice(0, 12), token = newToken(), who = actor(req);
  await run(`INSERT INTO video_thanks (id,org_id,donor_id,asset_id,mime,bytes,duration_seconds,token,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, d.id, stored.id, mime, buffer.length, duration, token, who.id, who.name]);

  // THE DRAFT. Her words, a person's send: it waits in Communications.
  const brand = await brandOf(orgId);
  const orgName = brand.displayName || "";
  // Signed with her NAME, not the login email actor() carries.
  const [me] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, orgId]);
  const signer = (me && String(me.name || "").trim()) || "";
  const subject = `A thank-you from ${orgName || "us"}`;
  const body = `Dear ${firstName(d.name)},\n\nI recorded a short video to say thank you. You can watch it here:\n\n${videoUrl(token)}\n\n`
    + `With gratitude,${signer ? `\n${signer}` : ""}${orgName ? `\n${orgName}` : ""}`;
  const draftId = "md_" + uuid().slice(0, 12);
  await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES (?,?,?,?,?,?, 'pending_review', 'video_thanks', ?, ?)`,
    [draftId, orgId, d.id, `video:${id}`, subject, body, who.id, who.name]);
  await run(`UPDATE video_thanks SET draft_id=? WHERE id=? AND org_id=?`, [draftId, id, orgId]);
  req.audit.entity("video_thanks", id, `Video thank-you for ${d.name}`);
  req.audit.after({ donor: d.name, bytes: buffer.length, mime, duration_seconds: duration, draft: draftId });
  const [row] = await query(`SELECT v.*, m.status AS draft_status FROM video_thanks v LEFT JOIN milestone_drafts m ON m.id = v.draft_id AND m.org_id = v.org_id WHERE v.id=? AND v.org_id=?`, [id, orgId]);
  res.status(201).json({ video: shape(row),
    sentence: "Saved. A draft email with the link is waiting in Communications for you to read and send. Nothing has been sent." });
}));

app.get("/donors/:id/video-thanks", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    `SELECT v.*, m.status AS draft_status FROM video_thanks v
       LEFT JOIN milestone_drafts m ON m.id = v.draft_id AND m.org_id = v.org_id
      WHERE v.org_id=? AND v.donor_id=? ORDER BY v.created_at DESC LIMIT 50`, [orgId, d.id]);
  res.json({ videos: rows.map(shape), maxSeconds: VIDEO_MAX_SECONDS, maxBytes: VIDEO_MAX_BYTES });
}));

// ── PUBLIC ──────────────────────────────────────────────────────────────────
const esc = s => PP.escapeHtml(s);
function notFound(res, brand) {
  return res.status(404).send(PP.publicPage({ title: "Not found", brand: brand || DEFAULT_BRAND, footer: "Sent with Steward.",
    body: `<div class="card"><h1>That video is not here.</h1><p class="muted">The link may be incomplete. Ask the organisation that sent it for a fresh one.</p></div>` }));
}

app.get("/v/:token", videoLimiter, wrap(async (req, res) => {
  await READY;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  const v = await byToken(req.params.token);
  if (!v) return notFound(res);
  const brand = await brandOf(v.org_id);
  const orgName = brand.displayName || v.org_name || "";
  const preview = req.query.preview === "1";
  const src = `/v/${encodeURIComponent(v.token)}/video`;
  const player = v.asset_id
    ? `<video id="vt" controls playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:10px;background:#0f1a12;display:block" src="${esc(src)}"></video>`
    : `<p class="muted" data-state="processing">This video is still being prepared. Please come back to this link a little later.</p>`;
  // The view is a POST from this page, sent once when playing starts. A
  // preview (staff checking the link) sends nothing.
  const beacon = v.asset_id && !preview
    ? `<script>(function(){var v=document.getElementById("vt"),sent=false;if(!v)return;v.addEventListener("play",function(){if(sent)return;sent=true;try{fetch(${JSON.stringify(`/v/${v.token}/viewed`)},{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:"{}"});}catch(e){}});})();</script>`
    : "";
  res.send(PP.publicPage({ title: `A thank-you from ${orgName}`, brand, footer: "Sent with Steward.",
    body: `<div class="card"><h1>Thank you, ${esc(firstName(v.donor_name))}.</h1>
      <p class="muted">A short message for you${orgName ? ` from everyone at ${esc(orgName)}` : ""}.</p>
      ${preview ? `<p class="small">Preview: watching it here is not counted as a view.</p>` : ""}
      ${player}</div>${beacon}` }));
}));

// The bytes. Range requests are answered, because Safari on a phone will not
// play an MP4 without them. A GET or HEAD here writes nothing.
app.get("/v/:token/video", videoLimiter, wrap(async (req, res) => {
  const v = await byToken(req.params.token);
  if (!v || !v.asset_id) return res.status(404).json({ error: "not_found" });
  const asset = await getThemeAsset(v.asset_id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  const buf = asset.buffer, total = buf.length;
  const type = VIDEO_MIMES.includes(baseMime(v.mime)) ? baseMime(v.mime) : "video/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Disposition", "inline");
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start, end;
    if (m[1] === "") { start = Math.max(0, total - Number(m[2])); end = total - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1); }
    if (!(start >= 0) || start > end || start >= total) {
      res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(end - start + 1));
    return res.end(buf.slice(start, end + 1));
  }
  res.setHeader("Content-Length", String(total));
  res.end(buf);
}));

// THE VIEW. The page posts this when the video starts playing. The first one
// stamps first_viewed_at and puts one line on the donor's timeline; every one
// adds to the count. The token is the only credential, as on the page.
app.post("/v/:token/viewed", videoLimiter, wrap(async (req, res) => {
  const v = await byToken(req.params.token);
  if (!v || !v.asset_id) { req.audit.skip("no such video"); return res.status(404).json({ error: "not_found" }); }
  req.audit.org(v.org_id);
  req.audit.actor({ kind: "anonymous", id: null, name: "A donor watching a video thank-you" });
  req.audit.entity("video_thanks", v.id, `Video thank-you for ${v.donor_name}`);
  req.audit.action("viewed");
  const first = await query(
    `UPDATE video_thanks SET first_viewed_at = NOW(), view_count = view_count + 1
      WHERE id=? AND org_id=? AND first_viewed_at IS NULL RETURNING id`, [v.id, v.org_id]);
  if (first.length) {
    await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name)
               VALUES (?,?,?,'note',?,?,?,?,?)`,
      ["int_" + uuid().slice(0, 10), v.org_id, v.donor_id, "Watched your video thank-you",
       orgToday(await orgTz(v.org_id)), JSON.stringify({ video_thanks_id: v.id, video_event: "watched" }),   // ORG_TZ_SEAM_OK
       VIEW_ACTOR.id, VIEW_ACTOR.name]);
  } else {
    await run(`UPDATE video_thanks SET view_count = view_count + 1 WHERE id=? AND org_id=?`, [v.id, v.org_id]);
  }
  res.json({ ok: true });
}));
}

module.exports = { routers, mount, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, VIDEO_MIMES, videoBytesMatchMime };

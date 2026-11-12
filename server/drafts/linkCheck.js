// server/drafts/linkCheck.js · FLOWS-7 (W-1112-Fundraising-19). A DRAFT NEVER
// POINTS AT SOMETHING THAT ISN'T THERE.
//
// The first staging night: a milestone thank-you in Drafts to review said a
// short video was recorded and linked to a page that said "That video is not
// here". A person reading a draft trusts that its links open. So every draft
// in Drafts to review is checked before it is shown:
//   · a link to one of Steward's video pages (/v/<token>) opens only when that
//     video is on file, has its recording, and is for the person the draft is to;
//   · any other link is asked for once (HEAD, then GET, three seconds, through
//     safeFetch, cached ten minutes) and is dead only on a 404 or 410 answer.
//     A link that could not be checked is never called dead;
//   · a draft that speaks of a video for a person with no video ready says so
//     (shared/suggestionGuard.js's words for a video).
// A dead link or a claim with nothing behind it puts one brass line at the top
// of the draft (Communications), naming the link. Nothing is changed in the
// words, and nothing is sent: the person fixes it and sends it, or dismisses it.
// The database is read first, in one query, and released before any fetch (LOAD-1).
"use strict";
const { query } = require("../../db");

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const VIDEO_PATH = /^\/v\/([A-Za-z0-9_-]{16,})\/?$/;
const VIDEO_WORDS = /\b(video|videos|recorded a|filmed)\b/i;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();   // url -> { at, dead, why }

const trimUrl = u => String(u).replace(/[.,;:!?]+$/, "");
const urlsIn = text => [...new Set((String(text || "").match(URL_RE) || []).map(trimUrl))];
const ownHosts = () => {
  const out = new Set();
  for (const u of [require("../../publicUrl").publicAppUrl(), process.env.PUBLIC_API_URL, process.env.API_URL]) {
    try { if (u) out.add(new URL(u).host); } catch { /* not a URL */ }
  }
  return out;
};

async function askOutside(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const { safeFetch } = require("../../safeFetch");
  let r = await safeFetch(url, { method: "HEAD", timeoutMs: 3000 }).catch(() => null);
  if (r && (r.status === 405 || r.status === 501)) r = await safeFetch(url, { method: "GET", timeoutMs: 3000 }).catch(() => null);
  const dead = !!(r && (r.status === 404 || r.status === 410));
  const out = { at: Date.now(), dead, why: dead ? `it answers ${r.status}, not found` : null };
  cache.set(url, out);
  return out;
}

// drafts: rows with id, donor_id, subject, body. Returns the same rows, each
// with linkCheck: { ok, problems: [{ url|null, why }], sentence|null }.
async function checkDrafts(orgId, drafts, { outside = true } = {}) {
  const own = ownHosts();
  const per = drafts.map(d => ({ d, urls: urlsIn(`${d.subject || ""}\n${d.body || ""}`) }));
  const tokens = new Set();
  for (const p of per) for (const u of p.urls) {
    try { const x = new URL(u); const m = VIDEO_PATH.exec(x.pathname); if (own.has(x.host) && m) tokens.add(m[1]); } catch { /* skip */ }
  }
  const donorIds = [...new Set(drafts.map(d => d.donor_id).filter(Boolean))];
  const [vids, ready] = await Promise.all([
    tokens.size ? query(
      `SELECT v.token, v.donor_id FROM video_thanks v JOIN donors d ON d.id = v.donor_id AND d.org_id = v.org_id
        WHERE v.org_id = ? AND v.token = ANY(?::text[]) AND v.asset_id IS NOT NULL AND d.deleted_at IS NULL`, [orgId, [...tokens]]) : [],
    donorIds.length ? query(
      `SELECT DISTINCT donor_id FROM video_thanks WHERE org_id = ? AND donor_id = ANY(?::text[]) AND asset_id IS NOT NULL`, [orgId, donorIds]) : [],
  ]);
  const videoOf = new Map(vids.map(v => [v.token, v.donor_id]));
  const hasVideo = new Set(ready.map(r => r.donor_id));
  const out = [];
  for (const { d, urls } of per) {
    const problems = [];
    for (const u of urls) {
      let x; try { x = new URL(u); } catch { problems.push({ url: u, why: "it is not a web address" }); continue; }
      const m = VIDEO_PATH.exec(x.pathname);
      if (own.has(x.host) && m) {
        const owner = videoOf.get(m[1]);
        if (!owner) problems.push({ url: u, why: "that video is not on file, so the page says \"That video is not here\"" });
        else if (owner !== d.donor_id) problems.push({ url: u, why: "that video was recorded for someone else" });
      } else if (outside && !own.has(x.host)) {
        const a = await askOutside(u);
        if (a.dead) problems.push({ url: u, why: a.why });
      }
    }
    if (VIDEO_WORDS.test(`${d.subject || ""} ${d.body || ""}`) && !hasVideo.has(d.donor_id))
      problems.push({ url: null, why: "it speaks of a video, and no video thank-you is on file for them" });
    const sentence = problems.length
      ? `Check this draft before sending: ${problems.map(p => p.url ? `${p.url} does not open (${p.why})` : p.why[0].toUpperCase() + p.why.slice(1)).join("; ")}.`
      : null;
    out.push({ ...d, linkCheck: { ok: !problems.length, problems, sentence } });
  }
  return out;
}

module.exports = { checkDrafts, urlsIn };

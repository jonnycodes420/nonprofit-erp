// server/atlas/proposal.js · SENDS-1 item 2. ATLAS PROPOSES, SHE SAVES.
//
// W-1107-Atlas-05: Atlas logged a call and set a Jan 5 reminder without
// asking, under its own footer "I send nothing without your yes".
// W-1107-Atlas-06: the follow-up was written twice. W-1107-Donors-26X: "Draft
// an email" quietly made a task beside the Communications draft, unsigned.
//
// The rule: Atlas reads and drafts, then shows ONE proposal card listing
// exactly what it would write (the call and its note, the follow-up and its
// date, the draft and its words), with Save and Edit. Nothing is written until
// Save. Save claims the proposal by its id in one UPDATE, so ten Saves at once
// write each item once and the other nine answer "already saved". A draft is
// signed with her signature block (shared/brandKit.js senderSignature), and an
// email makes the draft only: the reminder to book a meeting is a "remind me"
// box she ticks, off by default.
"use strict";
const { query, run } = require("../../db");
const { newId } = require("../shared/newId");

// The step kinds that write on her behalf without money (money already waits for a tap).
const WRITE_KINDS = new Set(["log_conversation", "note", "reminder", "draft_email", "send_now"]);

// What she may change on each item before Save. Anything else she sends is ignored.
const EDITABLE = {
  call: ["note", "date", "skip"],
  note: ["note", "skip"],
  follow_up: ["title", "due", "skip"],
  draft: ["subject", "body", "remindMe", "remindDue", "skip"],
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function mergeEdits(items, edits) {
  const by = new Map((Array.isArray(edits) ? edits : []).filter(e => e && e.pid).map(e => [String(e.pid), e]));
  return (items || []).map(it => {
    const e = by.get(it.pid);
    if (!e) return { ...it };
    const out = { ...it };
    for (const k of EDITABLE[it.kind] || []) {
      if (!(k in e)) continue;
      if (k === "skip" || k === "remindMe") out[k] = e[k] === true;
      else if (k === "date" || k === "due" || k === "remindDue") { if (DAY.test(String(e[k]))) out[k] = String(e[k]); }
      else out[k] = String(e[k] == null ? "" : e[k]).slice(0, k === "body" ? 8000 : 2000);
    }
    return out;
  });
}

// The block goes under the sign-off once: a body that already ends with its
// first line is left as it is.
function withSignature(body, signature) {
  const b = String(body || "").replace(/\s+$/, "");
  const sig = String(signature || "").trim();
  if (!sig) return b;
  const first = sig.split("\n")[0].trim();
  const tail = b.split("\n").slice(-6).map(l => l.trim());
  if (first && tail.includes(first)) return b;
  return `${b}\n${sig}`;
}

async function signatureFor(orgId, userId) {
  const BK = await import("../../shared/brandKit.js");
  const [[org], [user]] = await Promise.all([
    query("SELECT name, receipt_signature_name, receipt_signature_title, brand_signature_extra FROM orgs WHERE id=?", [orgId]).catch(() => [null]),
    query(`SELECT ${BK.SIGN_COLUMNS} FROM users WHERE id=? AND org_id=?`, [userId, orgId]).catch(() => [null]),
  ]);
  return BK.senderSignature(org || {}, user || null).text || "";
}

// One line that names what Save will write, for the card's header.
function proposalLine(items) {
  const n = items.length;
  return `Here's what I'd save: ${n === 1 ? "one thing" : `${n} things`}. Nothing is written until you press Save.`;
}

async function storeProposal(orgId, memoId, items) {
  const [m] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  const read = (m && (typeof m.read === "string" ? JSON.parse(m.read) : m.read)) || {};
  const proposal = { id: newId("prop"), items, savedAt: null };
  read.atlas = { ...(read.atlas || {}), proposal };
  await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify(read), memoId, orgId]);
  return proposal;
}

// THE CLAIM. One UPDATE decides which Save writes; every other one changes nothing.
async function claimProposal(orgId, memoId, proposalId, at) {
  const r = await run(
    `UPDATE voice_memos SET read = jsonb_set(read, '{atlas,proposal,savedAt}', to_jsonb(?::text))
      WHERE id=? AND org_id=? AND read #>> '{atlas,proposal,id}' = ? AND read #>> '{atlas,proposal,savedAt}' IS NULL`,
    [at, memoId, orgId, String(proposalId || "")]);
  return !!(r && r.changes);
}

module.exports = { WRITE_KINDS, EDITABLE, mergeEdits, withSignature, signatureFor, proposalLine, storeProposal, claimProposal };

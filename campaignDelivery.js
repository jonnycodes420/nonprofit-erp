// campaignDelivery.js — SECURE-2 item 2. WHAT A CAMPAIGN ACTUALLY DID, SAID ONCE.
//
// A campaign is never just "Sent". Every surface that names a sent campaign
// (the campaign list, the sent list, Communications' recent list, the as-sent
// page) reads this one answer, so they cannot disagree:
//   · every recipient went          → "Sent to 500"
//   · some went                     → "Sent to 412 of 500 · 88 not sent", with
//                                     the reasons, counted, and the rows
//   · none went (SECURE-1 rule)     → "Not sent", with the reasons
// The counts come from campaign_recipients: a row with sent_at went; a row
// without it did not, and its failure_reason says why ("suppressed: …" is a
// person who asked not to hear from you, which is a reason, not a fault).
"use strict";
const { query } = require("./db");

const n = v => Number(v || 0).toLocaleString("en-US");

// The reason a row did not go, in her words.
function reasonWord(r) {
  const s = String(r || "").trim();
  if (!s) return "Not attempted";
  if (/^suppressed:\s*unsub/i.test(s)) return "Unsubscribed";
  if (/^suppressed:\s*bounce/i.test(s)) return "Bounced before";
  if (/^suppressed:\s*complain/i.test(s)) return "Marked as spam before";
  if (/^suppressed:/i.test(s)) return "On your do-not-email list";
  if (/bounce/i.test(s)) return "Bounced";
  if (/invalid|not a valid|malformed/i.test(s)) return "Address not valid";
  if (/limit|rate|429/i.test(s)) return "Provider limit reached";
  return "Refused by the email provider";
}

function sentenceFor(status, sent, total) {
  const notSent = Math.max(0, total - sent);
  if (status === "draft" || status === "scheduled" || status === "awaiting_approval") return null;
  if (status === "sending") return `Sending · ${n(sent)} of ${n(total)} so far`;
  if (total > 0 && sent === 0) return "Not sent";
  if (status === "failed") return "Not sent";
  if (notSent > 0) return `Sent to ${n(sent)} of ${n(total)} · ${n(notSent)} not sent`;
  return `Sent to ${n(sent)}`;
}

// Map of campaign id → { state, sent, total, notSent, reasons:[{reason, n}], sentence }.
async function deliveryFor(orgId, campaigns) {
  const list = (campaigns || []).filter(Boolean);
  const out = new Map();
  if (!list.length) return out;
  const ids = list.map(c => c.id);
  const ph = ids.map(() => "?").join(",");
  const counts = await query(
    `SELECT campaign_id, COUNT(*)::int AS total, COUNT(sent_at)::int AS sent
       FROM campaign_recipients WHERE org_id=? AND campaign_id IN (${ph}) GROUP BY campaign_id`, [orgId, ...ids]);
  const why = await query(
    `SELECT campaign_id, failure_reason, COUNT(*)::int AS n
       FROM campaign_recipients WHERE org_id=? AND campaign_id IN (${ph}) AND sent_at IS NULL
      GROUP BY campaign_id, failure_reason`, [orgId, ...ids]);
  const byId = new Map(counts.map(r => [r.campaign_id, r]));
  const reasons = new Map();
  for (const r of why) {
    const m = reasons.get(r.campaign_id) || new Map();
    const w = reasonWord(r.failure_reason);
    m.set(w, (m.get(w) || 0) + r.n);
    reasons.set(r.campaign_id, m);
  }
  for (const c of list) {
    const k = byId.get(c.id) || { total: 0, sent: 0 };
    const total = k.total, sent = k.sent, notSent = Math.max(0, total - sent);
    const sentence = sentenceFor(c.status, sent, total);
    const state = sentence === "Not sent" ? "not_sent" : (sentence && notSent > 0 && c.status !== "sending") ? "partial"
      : (c.status === "sent" ? "sent" : c.status);
    out.set(c.id, { state, sent, total, notSent, sentence,
      reasons: [...(reasons.get(c.id) || new Map()).entries()].map(([reason, count]) => ({ reason, n: count })).sort((a, b) => b.n - a.n) });
  }
  return out;
}

// The same, attached to each row as `delivery`.
async function withDelivery(orgId, campaigns) {
  const d = await deliveryFor(orgId, campaigns);
  return (campaigns || []).map(c => ({ ...c, delivery: d.get(c.id) || null }));
}

module.exports = { deliveryFor, withDelivery, sentenceFor, reasonWord };

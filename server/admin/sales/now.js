// server/admin/sales/now.js · SALES-4 item 1. SALES OPENS ON "NOW".
//
// One ranked list, each row one action with one button. buildNow(input, now, tz) is pure; the
// route reads its input once (Today's own lines, the deal rows, the last touches).
//
// THE ORDER, computed and shown on every row:
//   1. Due first: tasks and deals' next steps due today or overdue (overdue first), today's
//      meetings to prep for, "How did it go?", deals back from Later, and trial or billing
//      steps within three days. Their own order: overdue, then by time.
//   2. Then every other open deal that needs a move, ranked by
//         score = monthly value × stage probability × days since the last touch
//      highest first (ties: the longer wait first). One row per deal, the most pressing of:
//         Follow up   an email of yours with no reply for the Sales settings days
//         Reply       their email is the last touch
//         Stale       no touch in 14 days at 20% or more
//         Call        no next step and no open task ("Interested 6 days ago, no next step")
//      A deal with a meeting ahead, or a next step not due yet, is waiting on its day: not here.
// Each ranked row carries a proposed next step from the touch (the call rules), accepted with
// one click (POST /ops/sales/deals/:id/next-step).
//
// THE PLANTED DEFECT (SALES4_PLANT=rankdue on the server, tests only): due rows are ranked by
// score with the rest, so a cold lead with a big value can sit above a due follow-up. §1 goes red.
"use strict";
const T = require("./touch");
const { civil, addDays } = require("./today");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES4_PLANT || "" : "";
const STALE_DAYS = 14, STALE_PROBABILITY = 20, SOON_DAYS = 3;
const SENTENCES = {
  order: "Due first (overdue, then by time), then every other open deal by monthly value × stage probability × days since the last touch, highest first.",
  score: "Monthly value × stage probability × days since the last touch.",
  stale: `An open deal at ${STALE_PROBABILITY}% or more with no touch in ${STALE_DAYS} days.`,
  touch: "A touch is a call, a meeting, a note, an email drafted, or an email to or from them read from your mailbox. A task is a plan, not a touch.",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : String(d || ""); };
const isCall = s => /^\s*call\b/i.test(String(s || ""));
const isEmail = s => /^\s*(email|e-mail|follow up|reply)\b/i.test(String(s || ""));

// The proposed next step after a touch, by the same rules call mode uses.
function propose(touch, who, today, rules, addBusinessDays) {
  const name = who || "them";
  if (!touch) return { body: `Call ${name}`, due_on: today };
  if (touch.kind === "call") {
    const r = rules[touch.outcome] || {};
    if (r.callAgainDays != null) return { body: `Call ${name} again`, due_on: addBusinessDays(today, r.callAgainDays) };
    return { body: `Call ${name}`, due_on: addBusinessDays(today, 2) };
  }
  if (touch.kind === "email") return touch.direction === "in" ? { body: `Reply to ${name}`, due_on: today } : { body: `Call ${name} if no reply`, due_on: addBusinessDays(today, 2) };
  if (touch.kind === "meeting") return { body: `Follow up on the meeting with ${name}`, due_on: addBusinessDays(today, 1) };
  return { body: `Call ${name}`, due_on: addBusinessDays(today, 1) };
}

// input: { today (buildToday's answer, with Sales' extra lines), deals, touches (Map), people (Map dealId → [contact]),
//          noReply ({ "deal:id"|"contact:id": { noReplyDays } }), rules, addBusinessDays, lists, moved }
function buildNow(input, now, tz = "America/New_York") {
  const today = civil(now, tz);
  const L = input.today.lines;
  const deals = new Map((input.deals || []).map(d => [d.id, d]));
  const people = input.people || new Map();
  const leadOf = dealId => {
    const ps = (people.get(dealId) || []).filter(c => !c.dnc_at);
    return ps.find(c => c.role === "ED") || ps.find(c => c.role === "Development Director") || ps[0] || null;
  };
  const scoreOf = d => {
    const t = T.dealTouch(input.touches, d, (people.get(d.id) || []).map(c => c.id));
    const days = T.daysSince(t ? t.at : d.created_at, now) || 0;
    const value = Math.round(Number(d.value_cents || 0) / 100);
    const n = Math.round(value * (Number(d.probability || 0) / 100) * days);
    return { touch: t, days, value, probability: Number(d.probability || 0), n, says: `$${value.toLocaleString("en-US")} × ${Number(d.probability || 0)}% × ${days} ${days === 1 ? "day" : "days"} = ${n.toLocaleString("en-US")}` };
  };
  const dealRef = id => { const d = deals.get(id); return d ? { type: "deal", id, name: d.displayName } : null; };
  const rowFor = (r, extra) => {
    const dealId = r.open && r.open.type === "deal" ? r.open.id : ((r.records || []).find(x => x.type === "deal") || {}).id || null;
    const d = dealId ? deals.get(dealId) : null;
    const lead = d ? leadOf(d.id) : null;
    return { dealId, orgId: d ? d.org_id : ((r.records || []).find(x => x.type === "org") || (r.open && r.open.type === "org" ? r.open : {})).id || null,
      contactId: ((r.records || []).find(x => x.type === "contact") || {}).id || (lead ? lead.id : null),
      score: d && d.stage_kind === "open" ? scoreOf(d) : null, ...extra };
  };

  // 1. Due.
  const due = [];
  for (const r of L.due || []) {
    const action = isCall(r.says) ? "call" : isEmail(r.says) ? "email" : "open";
    due.push(rowFor(r, { key: `${r.kind}:${r.id}`, kind: r.kind === "task" ? "task" : "next_step", taskId: r.kind === "task" ? r.id : null, says: r.says,
      reason: r.overdue ? `Overdue since ${short(r.on)}` : "Due today", on: r.on, overdue: !!r.overdue, open: r.open, action }));
  }
  for (const m of (L.meetings || []).filter(m => m.on === today && new Date(m.at).getTime() > now - 3600000)) {
    const deal = (m.records || []).find(x => x.type === "deal");
    due.push(rowFor(m, { key: `meeting:${m.at}:${deal ? deal.id : ""}`, kind: "meeting", says: m.says, reason: "Meeting today", on: today, at: m.at, open: deal || m.open, action: "prep" }));
  }
  for (const r of L.howDidItGo || []) due.push(rowFor(r, { key: `after:${r.id}`, kind: "after", meetingId: r.id, says: r.says, reason: `Met ${short(r.on)}, no answer yet`, on: r.on, overdue: true, open: r.open, action: "after" }));
  for (const r of L.revisit || []) due.push(rowFor(r, { key: `revisit:${r.open.id}`, kind: "revisit", says: r.says, reason: "Back from Later", on: r.on, overdue: !!r.overdue, open: r.open, action: "open" }));
  const soon = addDays(today, SOON_DAYS);
  for (const r of [...(L.trials || []), ...(L.billingStarts || [])].filter(x => x.on && x.on <= soon))
    due.push(rowFor(r, { key: `step:${r.open.type}:${r.open.id}:${r.on}`, kind: "trial", says: r.says, reason: r.on === today ? "Today" : `On ${short(r.on)}`, on: r.on, open: r.open, action: "open" }));
  const rank = PLANT === "rankdue" ? () => 0 : r => (r.overdue ? 0 : 1);
  due.sort((a, b) => rank(a) - rank(b) || String(a.at || a.on).localeCompare(String(b.at || b.on)));
  const covered = new Set(due.map(r => r.dealId).filter(Boolean));

  // 2. Ranked: one row per open deal that needs a move.
  const ahead = new Set((L.booked || []).map(m => m.open && m.open.type === "deal" ? m.open.id : null).filter(Boolean));
  const ranked = [];
  for (const d of input.deals || []) {
    if (d.stage_kind !== "open" || covered.has(d.id) || ahead.has(d.id)) continue;
    const ps = people.get(d.id) || [];
    const s = scoreOf(d);
    const lead = leadOf(d.id);
    const who = lead ? lead.name : d.primary_org_name || d.displayName;
    const waiting = [`deal:${d.id}`, ...ps.map(c => `contact:${c.id}`)].map(k => (input.noReply || {})[k]).filter(f => f && f.noReplyDays != null);
    const bare = !String(d.next_step || "").trim() && !d.has_open_task;
    const base = { key: `deal:${d.id}`, dealId: d.id, orgId: d.org_id, contactId: lead ? lead.id : null, open: dealRef(d.id), score: s,
      says: `${who}${d.primary_org_name && who !== d.primary_org_name ? ` · ${d.primary_org_name}` : ""}`, stage: d.stage_name };
    const row = waiting.length ? { ...base, kind: "followup", action: "email", reason: `No reply in ${Math.max(...waiting.map(f => f.noReplyDays))} days` }
      : s.touch && s.touch.kind === "email" && s.touch.direction === "in" ? { ...base, kind: "reply", action: "email", reason: T.reasonOf(s.touch, now) }
      : s.probability >= STALE_PROBABILITY && s.days >= STALE_DAYS ? { ...base, kind: "stale", action: "call", reason: `No touch in ${s.days} days at ${s.probability}%` }
      : bare ? { ...base, kind: "call", action: "call", reason: `${T.reasonOf(s.touch, now)}, no next step` }
      : null;
    if (!row) continue;
    if (bare) row.propose = propose(s.touch, lead ? lead.name.split(" ")[0] : who, today, input.rules || {}, input.addBusinessDays || ((day, n) => addDays(day, n)));
    ranked.push(row);
  }
  ranked.sort((a, b) => b.score.n - a.score.n || b.score.days - a.score.days);
  const rows = PLANT === "rankdue" ? [...due, ...ranked].sort((a, b) => ((b.score && b.score.n) || 0) - ((a.score && a.score.n) || 0)) : [...due, ...ranked];
  rows.forEach((r, i) => { r.rank = i + 1; });

  // The empty state names the list with the most organizations to work.
  const list = [...(input.lists || [])].sort((a, b) => (b.orgs || 0) - (a.orgs || 0))[0] || null;
  return {
    today, rows, moved: input.moved || [],
    start: rows.find(r => r.action === "call" && r.orgId) ? { orgIds: [...new Set(rows.filter(r => r.action === "call" && r.orgId).map(r => r.orgId))] } : null,
    empty: rows.length ? null : list ? { says: `No one's waiting. Work the ${list.name} list`, listId: list.id } : { says: "No one's waiting. Add prospects to a list and work it.", listId: null },
    sentences: SENTENCES,
  };
}

// The people on each open deal (its own contacts, else its primary organization's), in two statements.
async function peopleOf(query, deals) {
  const ids = deals.filter(d => d.stage_kind === "open").map(d => d.id);
  const orgIds = [...new Set(deals.map(d => d.org_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const [onDeal, onOrg] = await Promise.all([
    query(`SELECT l.a_id AS deal_id, c.id, c.first_name, c.last_name, c.role, c.phones, c.bad_phones, c.emails, c.dnc_at
             FROM sales_links l JOIN sales_contacts c ON c.id = l.b_id AND c.deleted_at IS NULL
            WHERE l.a_type = 'deal' AND l.b_type = 'contact' AND l.a_id = ANY(?) ORDER BY c.created_at`, [ids]),
    orgIds.length ? query(`SELECT l.b_id AS org_id, c.id, c.first_name, c.last_name, c.role, c.phones, c.bad_phones, c.emails, c.dnc_at
             FROM sales_links l JOIN sales_contacts c ON c.id = l.a_id AND c.deleted_at IS NULL
            WHERE l.a_type = 'contact' AND l.b_type = 'org' AND l.b_id = ANY(?) ORDER BY c.created_at`, [orgIds]) : [],
  ]);
  const name = c => [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.emails || [])[0] || "(no name)";
  const out = new Map();
  for (const d of deals) {
    if (d.stage_kind !== "open") continue;
    const own = onDeal.filter(c => c.deal_id === d.id);
    out.set(d.id, (own.length ? own : onOrg.filter(c => c.org_id === d.org_id)).map(c => ({ ...c, name: name(c) })));
  }
  return out;
}

// One click: the proposed next step becomes the deal's next step (and its day). Nothing is sent:
// a "Follow up" or "Reply" step is Jonathan's to write, from a draft, in his own mail.
// THE PLANTED DEFECT (SALES4_PLANT=send, tests only): accepting also emails the deal's first
// contact through the mail provider. tests/sales4.test.js §6 goes red.
async function acceptNext(ctx, dealId, b, who) {
  const body = String((b && b.body) || "").trim().slice(0, 500);
  if (!body) return { error: "invalid", message: "Say what the next step is." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String((b && b.due_on) || ""))) return { error: "invalid", message: "The next step needs a day." };
  const r = await ctx.run(`UPDATE sales_deals SET next_step = ?, next_step_on = ?::date, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`,
    [body, b.due_on, who.id, who.name, dealId]);
  if (!r.changes) return { error: "not_found" };
  if (PLANT === "send") {
    const [c] = await ctx.query(`SELECT c.emails FROM sales_links l JOIN sales_contacts c ON c.id = l.b_id WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'contact' LIMIT 1`, [dealId]);
    const to = c && (c.emails || [])[0];
    if (to) await fetch(`${process.env.RESEND_BASE_URL || "https://api.resend.com"}/emails`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY || ""}` },
      body: JSON.stringify({ from: "jonathan@stewardapp.dev", to, subject: body, text: body }) }).catch(() => null);
  }
  return { ok: true, says: `Next step set: ${body}, ${b.due_on}.` };
}

module.exports = { buildNow, peopleOf, propose, acceptNext, SENTENCES, STALE_DAYS, STALE_PROBABILITY, PLANT };

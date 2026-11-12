// server/admin/sales/meetings.js · SALES-2 item 6. MEETING BOOKED, DONE RIGHT.
//
// book: from call mode or a deal, a meeting takes its day, time (Jonathan's own, New York),
// a place or Zoom link and who's attending. It writes the meeting activity (on the deal, the
// organization and the people), moves the deal to Meeting booked (making the deal if the
// organization has none open), and adds a "Send the calendar invite" task due today. Steward
// sends nothing: Jonathan sends the invite himself.
//
// The day after, Today asks "How did it go?" (today.js howDidItGo); answering moves the deal:
//   Demo done → Demo done · Donors loaded next → Donors loaded · Later (a revisit day) · Lost (a reason)
//
// THE PLANTED DEFECT (SALES2_PLANT=meetingstage on the server, tests only): booking leaves the
// deal in its old stage. tests/sales2-prospecting.test.js §6 goes red.
"use strict";
const ACT = require("./activities");
const LINKS = require("./links");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const TZ = "America/New_York";
const AFTER = [
  { key: "demo_done", label: "Demo done", stage: "Demo done" },
  { key: "donors_loaded", label: "Donors loaded next", stage: "Donors loaded" },
  { key: "later", label: "Later", stage: "Later" },
  { key: "lost", label: "Lost", stage: "Lost" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function checkMeeting(m) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.date || ""))) return { error: "invalid", need: "date", message: "Give the meeting a day." };
  if (!/^\d{1,2}:\d{2}$/.test(String(m.time || ""))) return { error: "invalid", need: "time", message: "Give the meeting a time, like 10:30." };
  if (!String(m.place || "").trim()) return { error: "invalid", need: "place", message: "Say where: a place or a Zoom link." };
  return null;
}

// "2026-11-16" + "10:30" in New York → the instant.
function nyInstant(date, time) {
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00Z`);
  for (const t of [guess + 5 * 3600000, guess + 4 * 3600000]) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const g = k => parts.find(p => p.type === k).value;
    if (`${g("year")}-${g("month")}-${g("day")}` === date && Number(g("hour")) % 24 === h && Number(g("minute")) === mi) return new Date(t);
  }
  return new Date(guess + 5 * 3600000);
}
function words(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${wd} ${MONTHS[m - 1]} ${d}, ${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// b: { dealId?, orgId?, contactIds?, date, time, place, attendees?, stageName? }
async function book(ctx, b, who, now = Date.now()) {
  const CM = require("./callMode");
  const bad = checkMeeting(b);
  if (bad) return bad;
  let org = null, dealId = b.dealId ? String(b.dealId) : null;
  if (dealId) {
    const [d] = await ctx.query(`SELECT id FROM sales_deals WHERE id = ? AND deleted_at IS NULL`, [dealId]);
    if (!d) return { error: "not_found", message: "That deal doesn't exist." };
    const linked = await LINKS.linkedOf(ctx.query, "deal", dealId);
    org = linked.org.find(o => o.primary) || linked.org[0] || null;
  } else if (b.orgId) {
    [org] = await ctx.query(`SELECT id, name FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [String(b.orgId)]);
    if (!org) return { error: "not_found", message: "That organization doesn't exist." };
  } else return { error: "invalid", message: "Book a meeting on a deal or an organization." };
  const contactIds = (Array.isArray(b.contactIds) ? b.contactIds : []).map(String).filter(Boolean);
  if (!dealId) {
    const d = await CM.ensureDeal(ctx, org, contactIds, who, { stageName: "Lead" });
    if (d.error) return d;
    dealId = d.id;
  }
  const stage = b.stageName || "Meeting booked";
  if (PLANT !== "meetingstage") {
    const mv = await CM.moveDeal(ctx, dealId, stage, who);
    if (mv.error) return mv;
  }
  for (const c of contactIds) await LINKS.associate(ctx, "deal", dealId, "contact", c, {}, who);
  await require("./cadences").endFor(ctx, contactIds, "meeting", who);   // SALES-2 item 9: a booked meeting ends their cadences
  const at = nyInstant(b.date, b.time);
  const place = String(b.place).trim().slice(0, 500), attendees = String(b.attendees || "").trim().slice(0, 1000);
  const when = words(b.date, b.time);
  const records = [{ type: "deal", id: dealId }, ...(org ? [{ type: "org", id: org.id }] : []), ...contactIds.map(id => ({ type: "contact", id }))];
  const m = await ACT.create(ctx, { kind: "meeting", at: at.toISOString(), body: `Meeting ${when} · ${place}${attendees ? ` · with ${attendees}` : ""}`, records }, who);
  if (m.error) return m;
  await ctx.run(`UPDATE sales_activities SET meeting = ?::jsonb WHERE id = ?`, [JSON.stringify({ date: b.date, time: b.time, place, attendees }), m.id]);
  const { civil } = require("./today");
  const today = civil(now, TZ);
  const body = `Send the calendar invite: ${when}${org ? ` with ${org.name}` : ""}`;
  const t = await ACT.create(ctx, { kind: "task", body, due_on: today, records }, who);
  return { ok: true, id: m.id, dealId, at: at.toISOString(), tasks: t.ok ? [{ id: t.id, body, due_on: today }] : [],
    says: `Meeting booked for ${when}. The deal is in ${stage}. Send the calendar invite yourself: it's a task due today.` };
}

// "How did it go?" b: { outcome, revisit_on?, lost_reason? }
async function after(ctx, id, b, who) {
  const CM = require("./callMode");
  const o = AFTER.find(x => x.key === b.outcome);
  if (!o) return { error: "invalid", message: "Demo done, Donors loaded next, Later or Lost." };
  const [m] = await ctx.query(`SELECT id, kind FROM sales_activities WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!m || m.kind !== "meeting") return { error: "not_found" };
  const deals = await ctx.query(`SELECT record_id FROM sales_activity_links WHERE activity_id = ? AND record_type = 'deal'`, [id]);
  for (const d of deals) {
    const r = await CM.moveDeal(ctx, d.record_id, o.stage, who, { lostReason: b.lost_reason, revisitOn: b.revisit_on });
    if (r.error) return r;
  }
  await ctx.run(`UPDATE sales_activities SET outcome = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`, [o.key, who.id, who.name, id]);
  return { ok: true, says: deals.length ? `${o.label}: the deal is in ${o.stage}.` : `${o.label}, noted.` };
}

module.exports = { AFTER, checkMeeting, nyInstant, words, book, after, PLANT };

// routes/homeCalls.js · PARITY-1 Part C. Home's "Calls to make" panel.
//
//   GET  /home/calls              the gifts to thank by phone (callsToMake.js),
//                                 each opening its gift, and the count opening
//                                 the list. Read only.
//   POST /gifts/:id/thank-call    "Mark called": logs a thank-you call with the
//                                 giver (an interactions row, type call, stamped
//                                 with who logged it), which takes the gift off
//                                 the list by the list's own rule.
//   POST /gifts/:id/call-snooze   hides that gift's row for seven days.
//   PUT  /settings/call-floor     (admin) the gift size that puts a gift on the
//                                 list; WHY-1's "Who should I call?" reads it too.
//
// Steward lists and logs; the call itself is hers. Nothing here reaches a donor.
const express = require("express");
const CT = require("../callsToMake");
const FS = require("../figureSources");
const DS = require("../donorStatus");

const routers = { r0: express.Router() };

function mount(ctx) {
const { actor, checkWriteAccess, orgTime, query, requireAdmin, requireAuth, run, uuid, wrap } = ctx;
const app = routers.r0;

async function giftInOrg(orgId, id) {
  const [g] = await query(`SELECT id, donor_id, LEFT(date,10) AS date FROM gifts WHERE id = ? AND org_id = ?`, [String(id), orgId]);
  return g || null;
}

app.get("/home/calls", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [today, floor] = await Promise.all([DS.todayFor(orgId), CT.floorFor(orgId)]);
  const source = { key: "calls-to-make", params: { today, floor: String(floor) } };
  const f = await FS.figure(orgId, source, {}, { page: 1, pageSize: 8 });
  res.json({
    today, floorCents: floor, firstTimeDays: CT.FIRST_TIME_DAYS, snoozeDays: CT.SNOOZE_DAYS,
    count: { value: f.value, source, label: f.label, definition: f.sentence },
    more: Math.max(0, f.totalRows - f.rows.length),
    rows: f.rows.map(r => ({
      giftId: r.id, donorId: r.donorId, name: r.name, date: r.date, dateLabel: r.dateLabel, amount: r.amount,
      firstTime: r.detail === CT.FIRST_DETAIL, reason: r.detail,
      source: { key: "one-gift", params: { id: r.id } },
    })),
  });
}));

app.post("/gifts/:id/thank-call", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await giftInOrg(orgId, req.params.id);
  if (!g || !g.donor_id) return res.status(404).json({ error: "Gift not found" });
  const today = await DS.todayFor(orgId);
  const who = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id = ? AND org_id = ?`, [req.user.userId, orgId]);
  const id = "int_" + uuid().slice(0, 8);
  // A call logged ahead of a future-dated gift would not clear it, so the
  // call is dated the later of today and the gift's own day.
  const date = g.date && g.date > today ? g.date : today;
  await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, g.donor_id, "call", "Thank-you call", date, who.id, (u && u.name) || who.name || "", g.id,
     JSON.stringify({ via: "home_calls_to_make" })]);
  res.status(201).json({ ok: true, interactionId: id, giftId: g.id, date });
}));

app.post("/gifts/:id/call-snooze", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await giftInOrg(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Gift not found" });
  const until = orgTime.addDays(await DS.todayFor(orgId), CT.SNOOZE_DAYS);
  const who = actor(req);
  await run(`INSERT INTO call_snoozes (id,org_id,gift_id,until,created_by,created_by_name) VALUES (?,?,?,?,?,?)
             ON CONFLICT (org_id, gift_id) DO UPDATE SET until = EXCLUDED.until, created_by = EXCLUDED.created_by,
               created_by_name = EXCLUDED.created_by_name, created_at = NOW()`,
    ["csz_" + uuid().slice(0, 12), orgId, g.id, until, who.id || "system:unknown", who.name]);
  res.json({ ok: true, giftId: g.id, until });
}));

app.put("/settings/call-floor", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const n = Number(String((req.body && req.body.amount) ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 10000000) {
    return res.status(400).json({ error: "invalid_floor", message: "The gift size is a dollar amount above zero." });
  }
  await run(`UPDATE orgs SET call_gift_floor_cents = ? WHERE id = ?`, [Math.round(n * 100), req.user.orgId]);
  const floor = await CT.floorFor(req.user.orgId);
  res.json({ floorCents: floor });
}));
}

module.exports = { routers, mount };

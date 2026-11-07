// server/org/morningEmail.js · TIDY-1. THE MORNING EMAIL CAN BE SEEN AND TESTED.
//
// Settings → Your email had a switch and no way to see what it sends. Here:
//   GET  /me/morning-email           today's email for the signed-in person,
//                                    rendered by the one builder the morning
//                                    tick sends from (server/mail/morningBrief.js),
//                                    whether today's tick would send it and why
//                                    not, and the last one sent (time, items).
//   POST /me/morning-email/test      that email, subject marked [Test], to the
//                                    signed-in person's OWN address and nobody
//                                    else. At most 3 a day (the digest ledger,
//                                    `morning_test`, three slots a day).
// A GET changes nothing. The test send reserves no morning ledger, so the real
// email still goes tomorrow (or today, if it hasn't yet).
"use strict";
const express = require("express");
const MB = require("../mail/morningBrief");

const TESTS_A_DAY = 3;
const routers = { r1: express.Router() };
const S = () => require("../boot/share").ctx;

// Why today's tick would not send it, in her words.
const WHY = {
  opted_out: "Your morning email is off, so nothing goes out. This is what it would say.",
  not_today: "Your morning email comes on weekdays, so none goes out today.",
  empty: "Nothing is waiting on you today, so no email goes out this morning.",
  sections_off: "The sections with something in them are turned off, so no email goes out this morning.",
};

async function todaysEmail(query, orgId, userId) {
  const [org] = await query(`SELECT ${MB.ORG_COLS} FROM orgs WHERE id=?`, [orgId]);
  const [u] = await query(`SELECT ${MB.USER_COLS} FROM users WHERE id=? AND org_id=?`, [userId, orgId]);
  if (!org || !u) return null;
  const today = S().orgToday(org);   // ORG_TZ_SEAM_OK: the morning tick's own day
  await S().ItemRefs.links();        // THREAD-2: the links are ready before it renders
  const team = await MB.teamRollup(org.id, today);
  const p = await MB.composeFor(org, u, today, team);
  const mail = MB.renderFor(org, u, today, p);
  let why = null;
  if (!p.b.on) why = "opted_out";
  else if (p.empty) why = p.suppressed ? "sections_off" : "empty";
  else if (S().briefDueNow(p.b, today, null, false) === "not_today") why = "not_today";
  return { org, u, today, p, mail, why };
}

// The last real morning email: the newest day either of its two ledgers
// reserved for her, and the items it carried that day.
async function lastSent(query, orgId, userId) {
  const rows = await query(
    `SELECT period_key, MAX(created_at) AS at,
            SUM(COALESCE((meta->>'count')::int, 0) + COALESCE((meta->>'readouts')::int, 0) + COALESCE((meta->>'meetings')::int, 0))::int AS items
       FROM digest_sends WHERE org_id=? AND recipient_user_id=? AND digest_type IN ('thread_nudge', 'daily_tasks')
      GROUP BY period_key ORDER BY MAX(created_at) DESC LIMIT 1`, [orgId, userId]);
  return rows[0] ? { at: rows[0].at, items: rows[0].items } : null;
}

async function testsUsed(query, orgId, userId, today) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM digest_sends WHERE org_id=? AND recipient_user_id=? AND digest_type='morning_test' AND period_key LIKE ?`,
    [orgId, userId, `day:${today}#%`]);
  return r ? r.n : 0;
}

function mount(ctx) {
  const { query, requireAuth, wrap } = ctx;
  const app = routers.r1;

  app.get("/me/morning-email", requireAuth, wrap(async (req, res) => {
    const t = await todaysEmail(query, req.user.orgId, req.user.userId);
    if (!t) return res.status(404).json({ error: "Not found" });
    const used = await testsUsed(query, t.org.id, t.u.id, t.today);
    res.json({
      // The whole email as it lands: the org's header (sendDigestEmail adds it) and the body.
      today: t.today, subject: t.mail.subject, html: (await S().brandEmailHeaderHtml(t.org.id)) + t.mail.body, items: MB.itemCount(t.p),
      wouldSend: !t.why, why: t.why, whyWords: t.why ? WHY[t.why] : null,
      to: t.u.email, lastSent: await lastSent(query, t.org.id, t.u.id),
      testsLeft: Math.max(0, TESTS_A_DAY - used), testsADay: TESTS_A_DAY,
    });
  }));

  app.post("/me/morning-email/test", requireAuth, wrap(async (req, res) => {
    const t = await todaysEmail(query, req.user.orgId, req.user.userId);
    if (!t) return res.status(404).json({ error: "Not found" });
    // Her own sign-in address, read from her row: never a body field, never anyone else.
    const to = t.u.email;
    if (!to) return res.status(400).json({ error: "Your account has no email address to send to." });
    let slot = null;
    for (let n = 1; n <= TESTS_A_DAY && !slot; n++)
      slot = await S().reserveDigest(t.org.id, "morning_test", `day:${t.today}#${n}`, t.u.id, to, "user", { items: MB.itemCount(t.p) });
    if (!slot) return res.status(429).json({ error: `You've sent ${TESTS_A_DAY} tests today. You can send more tomorrow.`, testsLeft: 0 });
    const sent = await S().sendDigestEmail(t.org, to, `[Test] ${t.mail.subject}`, t.mail.body);
    if (!sent) {
      await query(`DELETE FROM digest_sends WHERE id=?`, [slot]);   // it never went: the slot is hers again
      return res.status(502).json({ error: "The test didn't send. Staff email may be switched off for your organization, or the mail service refused it." });
    }
    res.json({ sent: true, to, subject: `[Test] ${t.mail.subject}`, testsLeft: Math.max(0, TESTS_A_DAY - await testsUsed(query, t.org.id, t.u.id, t.today)) });
  }));
}

module.exports = { routers, mount, TESTS_A_DAY };

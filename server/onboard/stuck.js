// server/onboard/stuck.js · ONBOARD-4 item 6. THE STUCK COLUMN ON /ops → ONBOARDING.
//
// Five rules, each read from a timestamp that already exists. Nothing is stored
// and nothing is sent: each row carries a note Jonathan sends himself (his rule:
// onboarding email is his, never automated), as Copy and a mailto: link.
//
//   booked        a booking from /book (sales_bookings) 2 days old, and no close
//                 link or start link made for that email
//   no_people     signed (a close link completed, or ONBOARD-1's paper) 48 hours
//                 ago, and no person in Steward
//   no_check      people in (the first person written) 3 days ago, and no
//                 "Looks right" on the totals check (orgs.data_in_at)
//   no_call       signed 7 days ago, and nobody at the org has logged a call or
//                 a note
//   concierge     a "Send it to us" file waiting more than one business day
//                 (New York) without Load pressed
//
// One row per org for the three org rules, the earliest step that is stuck
// (no people, then no check, then no call); a concierge job is its own row.
//
// THE PLANTED DEFECTS (ONBOARD4B_PLANT, tests only; tests/onboard4b.test.js §3):
//   nowindow   every window is zero, so an org on day one is "stuck"
//   noclose    a booking is stuck even after its close link was sent
"use strict";

const HOUR = 3600000, DAY = 24 * HOUR;
const PLANT = () => (process.env.TEST_MODE === "1" ? process.env.ONBOARD4B_PLANT || "" : "");
const WINDOW = { booked: 2 * DAY, no_people: 48 * HOUR, no_check: 3 * DAY, no_call: 7 * DAY };
const MISSING = new Set(["42P01", "42703"]);
const safe = p => p.catch(e => { if (e && MISSING.has(e.code)) return []; throw e; });
const t = v => (v ? new Date(v).getTime() : null);
const first = full => String(full || "").trim().split(/\s+/)[0] || "there";
const days = ms => Math.max(0, Math.floor(ms / DAY));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// One business day after an instant, in New York: Saturday and Sunday do not count.
function oneBusinessDayAfter(at) {
  let d = new Date(t(at) + DAY);
  const dow = x => new Date(x.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  while (dow(d) === 0 || dow(d) === 6) d = new Date(d.getTime() + DAY);
  return d.getTime();
}

const SIGN = "\n\nJonathan";
function draft(rule, who, org) {
  const hi = `Hi ${first(who && who.name)},\n\n`;
  const notes = {
    booked: [`Steward: your call about ${org}`, `${hi}Thank you for booking time to talk about ${org}. I want to make sure you have what you need from me to get started. Shall I send the link to sign up, or is there anything you'd like to go over first?`],
    no_people: [`Getting your people into Steward`, `${hi}Welcome to Steward. The next step is bringing your people in. You can upload your donor file, start from your Stripe or PayPal history, or send the file to me and I'll map it and load it for you. Would 20 minutes on a call this week help?`],
    no_check: [`Does Steward match your old system?`, `${hi}Your people are in. Before you rely on the numbers, open Home and check "Does this match your old system?" If anything looks off, reply and I'll go through it with you.`],
    no_call: [`Your first call from Steward`, `${hi}Home lists the people worth a call first, each with the reason. Pick one, make the call or write the note, and press Log a touch. If you'd like, we can do the first one together.`],
    concierge: [`Your donor file`, `${hi}I have your donor file and I'm mapping it now. You'll see it on Home as "Ready for you to check" as soon as it's loaded, and nothing goes in until I press Load.`],
  };
  const [subject, body] = notes[rule];
  return { to: (who && who.email) || null, subject, body: body + SIGN };
}

const row = (rule, x) => ({ rule, ...x, draft: draft(rule, x.who, x.name) });

async function list(query, now = Date.now()) {
  const plant = PLANT();
  const w = k => (plant === "nowindow" ? 0 : WINDOW[k]);
  const out = [];

  // 1 · Booked, and no close link 2 days on.
  const bookings = await safe(query(`SELECT b.id, b.name, b.org_name, b.email, b.created_at FROM sales_bookings b
    WHERE b.created_at <= ?
      AND (? OR NOT EXISTS (SELECT 1 FROM close_links c WHERE lower(c.contact_email) = lower(b.email)))
      AND (? OR NOT EXISTS (SELECT 1 FROM start_links s WHERE lower(s.contact_email) = lower(b.email)))
    ORDER BY b.created_at LIMIT 200`, [new Date(now - w("booked")).toISOString(), plant === "noclose", plant === "noclose"]));
  for (const b of bookings) out.push(row("booked", { key: `booked:${b.id}`, bookingId: b.id, orgId: null, name: b.org_name,
    since: b.created_at, says: `Booked a call ${plural(days(now - t(b.created_at)), "day")} ago. No close link has been sent.`,
    who: { name: b.name, email: b.email } }));

  // 2 to 4 · Orgs that signed: a completed close link, or ONBOARD-1's paper.
  const orgs = await query(`SELECT o.id, o.name, o.paper_done_at, o.data_in_at,
      (SELECT MIN(c.completed_at) FROM close_links c WHERE c.status = 'completed' AND (c.org_id = o.id OR c.target_org_id = o.id)) AS closed_at
    FROM orgs o WHERE o.archived_at IS NULL AND COALESCE(o.is_demo_org, false) = false
      AND (o.paper_done_at IS NOT NULL OR EXISTS (SELECT 1 FROM close_links c WHERE c.status = 'completed' AND (c.org_id = o.id OR c.target_org_id = o.id)))`, []);
  const ids = orgs.map(o => o.id);
  const [people, calls, admins] = ids.length ? await Promise.all([
    query(`SELECT org_id, MIN(created_at) AS t FROM donors WHERE org_id = ANY(?) AND deleted_at IS NULL AND COALESCE(is_sample, false) = false GROUP BY org_id`, [ids]),
    // A call or a note logged by a person at the org (not Steward's own staff).
    query(`SELECT i.org_id, MIN(i.created_at) AS t FROM interactions i JOIN users u ON u.id = i.created_by AND u.org_id = i.org_id
            WHERE i.org_id = ANY(?) AND COALESCE(u.is_super_admin, false) = false GROUP BY i.org_id`, [ids]),
    query(`SELECT DISTINCT ON (org_id) org_id, name, email FROM users WHERE org_id = ANY(?) AND role = 'admin' AND deactivated_at IS NULL
            AND COALESCE(is_super_admin, false) = false ORDER BY org_id, created_at`, [ids]),
  ]) : [[], [], []];
  const by = rows => new Map(rows.map(r => [r.org_id, r]));
  const P = by(people), C = by(calls), A = by(admins);
  for (const o of orgs) {
    const signed = Math.min(...[t(o.paper_done_at), t(o.closed_at)].filter(Number.isFinite));
    const who = A.get(o.id) || null;
    const p = P.get(o.id);
    const base = { orgId: o.id, name: o.name, who };
    if (!p) {
      if (now - signed >= w("no_people")) out.push(row("no_people", { ...base, key: `no_people:${o.id}`, since: new Date(signed).toISOString(),
        says: `Signed ${plural(days(now - signed), "day")} ago. No people in Steward yet.` }));
      continue;
    }
    if (!o.data_in_at) {
      if (now - t(p.t) >= w("no_check")) out.push(row("no_check", { ...base, key: `no_check:${o.id}`, since: p.t,
        says: `People in ${plural(days(now - t(p.t)), "day")} ago. No "Looks right" on the totals check.` }));
      continue;
    }
    if (!C.get(o.id) && now - signed >= w("no_call")) out.push(row("no_call", { ...base, key: `no_call:${o.id}`, since: new Date(signed).toISOString(),
      says: `Day ${days(now - signed)} since signing. No call or note logged yet.` }));
  }

  // 5 · A "Send it to us" file waiting more than a business day for Load.
  const jobs = await safe(query(`SELECT j.id, j.org_id, j.file_name, j.created_at, j.mapped_at, o.name AS org_name, o.archived_at
    FROM onboard_concierge_jobs j JOIN orgs o ON o.id = j.org_id LEFT JOIN imports i ON i.id = j.import_id AND i.org_id = j.org_id
    WHERE (j.loaded_at IS NULL OR i.reversed_at IS NOT NULL) AND o.archived_at IS NULL ORDER BY j.created_at LIMIT 200`, []));
  for (const j of jobs) {
    if (plant !== "nowindow" && now <= oneBusinessDayAfter(j.created_at)) continue;
    out.push(row("concierge", { key: `concierge:${j.id}`, jobId: j.id, orgId: j.org_id, name: j.org_name, since: j.created_at, who: A.get(j.org_id) || null,
      says: `${j.file_name} sent ${plural(days(now - t(j.created_at)), "day")} ago, ${j.mapped_at ? "mapped" : "not mapped yet"}, not loaded.` }));
  }
  return out;
}

const TITLES = { booked: "Booked, no close link", no_people: "Signed, no people", no_check: "People in, not checked", no_call: "No call logged", concierge: "File waiting" };
const SENTENCE = "Who is stuck, from timestamps already kept: a booking with no close link after 2 days; signed with no people after 48 hours; "
  + "people in with no \"Looks right\" after 3 days; no call logged by day 7; a sent file not loaded after one business day. Each note is yours to send; Steward sends nothing.";

module.exports = { list, oneBusinessDayAfter, draft, WINDOW, TITLES, SENTENCE };

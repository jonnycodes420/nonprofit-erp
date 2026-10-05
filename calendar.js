// calendar.js · CAL-1. ONE CALENDAR FOR EVERYTHING WITH A DATE.
//
// Meetings live on the profile and Home, shifts in Volunteers, events in
// Events, next steps on the Thread. This reads them all for one date range,
// in the organisation's own timezone, as one list of typed items. It never
// writes: every move and every edit goes through the item's own route, so
// each keeps its one audit write and its Undo.
//
// An item: { id, type, title, start, end, allDay, ownerId, ownerName,
//   donorId, donorName, detail, editable: { move, resize }, ref, conflict }
//   start/end are org-local civil: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM".
//   ref carries the ids the item's own routes need.
//
// Org-scoped on every query; deleted people and cancelled or dismissed items
// are left out.
const { query } = require("./db");

const TYPES = ["meeting", "step", "shift", "event", "journey", "send", "pledge", "birthday"];
const DEFAULT_ON = ["meeting", "step", "shift", "event", "journey", "send", "pledge"];   // birthdays off by default

const pad = n => String(n).padStart(2, "0");
const addMin = (hhmm, m) => { const [h, mm] = String(hhmm).split(":").map(Number); const t = Math.min(23 * 60 + 59, h * 60 + mm + m); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
const hm = v => (v ? String(v).slice(0, 5) : null);

async function calendarItems(orgId, { from, to, tz, userId, scope = "everyone", staff = null, types = DEFAULT_ON }) {
  const want = new Set(types.filter(t => TYPES.includes(t)));
  const owner = staff || (scope === "mine" ? userId : null);
  const out = [];
  const jobs = [];

  if (want.has("meeting")) {
    jobs.push(query(
      `SELECT ce.id, ce.title, ce.provider, ce.booked_in_steward, ce.owner_user_id, u.name AS owner_name, ce.location, ce.person_ids,
              to_char(ce.starts_at AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS s, to_char(ce.ends_at AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS e,
              to_char(ce.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS si, to_char(ce.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ei,
              d.id AS donor_id, d.name AS donor_name, d.last_gift_date, d.last_gift_amount
         FROM calendar_events ce
         LEFT JOIN users u ON u.id = ce.owner_user_id AND u.org_id = ce.org_id
         LEFT JOIN donors d ON d.org_id = ce.org_id AND d.id = ce.person_ids[1] AND d.deleted_at IS NULL
        WHERE ce.org_id = ? AND ce.dismissed_at IS NULL
          AND (ce.starts_at AT TIME ZONE ?)::date <= ?::date AND (ce.ends_at AT TIME ZONE ?)::date >= ?::date
          AND (?::text IS NULL OR ce.owner_user_id = ?)`,
      [tz, tz, orgId, tz, to, tz, from, owner, owner]).then(rows => rows.forEach(r => out.push({
        id: `meeting:${r.id}`, type: "meeting", title: r.title || (r.donor_name ? `Meeting with ${r.donor_name}` : "Meeting"),
        start: r.s, end: r.e, allDay: false, ownerId: r.owner_user_id, ownerName: r.owner_name || "",
        donorId: r.donor_id || null, donorName: r.donor_name || null,
        lastGift: r.donor_id && r.last_gift_date ? { date: String(r.last_gift_date).slice(0, 10), amount: Number(r.last_gift_amount) || 0 } : null,
        detail: [r.location, r.provider && r.provider !== "steward" ? `on your ${r.provider === "microsoft" ? "Outlook" : "Google"} calendar` : null].filter(Boolean).join(" · "),
        editable: { move: true, resize: true }, ref: { calendarEventId: r.id, startsAt: r.si, endsAt: r.ei, provider: r.provider || null, synced: !!(r.provider && r.provider !== "steward" && !r.booked_in_steward) },
      }))));
    // A meeting logged on the timeline (a conversation that happened) shows on its day.
    jobs.push(query(
      `SELECT i.id, i.date, i.note, i.created_by, d.id AS donor_id, d.name AS donor_name
         FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id AND d.deleted_at IS NULL
        WHERE i.org_id = ? AND i.type = 'meeting' AND LEFT(i.date, 10) >= ? AND LEFT(i.date, 10) <= ?
          AND (?::text IS NULL OR i.created_by = ?)`,
      [orgId, from, to, owner, owner]).then(rows => rows.forEach(r => out.push({
        id: `logged:${r.id}`, type: "meeting", title: `Met ${r.donor_name}`, start: String(r.date).slice(0, 10), end: String(r.date).slice(0, 10), allDay: true,
        ownerId: r.created_by, donorId: r.donor_id, donorName: r.donor_name, detail: String(r.note || "").slice(0, 140), logged: true,
        editable: { move: false, resize: false }, ref: { interactionId: r.id },
      }))));
  }
  if (want.has("step")) {
    jobs.push(query(
      `SELECT t.id, t.next_step_label, t.due_date, t.due_time, t.owner_id, t.owner_name, d.id AS donor_id, d.name AS donor_name
         FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id AND d.deleted_at IS NULL
        WHERE t.org_id = ? AND t.closed_at IS NULL AND t.due_date IS NOT NULL AND LEFT(t.due_date::text, 10) >= ? AND LEFT(t.due_date::text, 10) <= ?
          AND (t.snoozed_until IS NULL OR t.snoozed_until::date <= t.due_date::date)
          AND (?::text IS NULL OR t.owner_id = ?)`,
      [orgId, from, to, owner, owner]).then(rows => rows.forEach(r => {
        const day = String(r.due_date).slice(0, 10), time = hm(r.due_time);
        out.push({ id: `step:${r.id}`, type: "step", title: `${r.next_step_label || "Next step"}: ${r.donor_name}`,
          start: time ? `${day}T${time}` : day, end: time ? `${day}T${addMin(time, 30)}` : day, allDay: !time,
          ownerId: r.owner_id, ownerName: r.owner_name || "", donorId: r.donor_id, donorName: r.donor_name, detail: r.next_step_label || "",
          editable: { move: true, resize: false }, ref: { threadId: r.id } });
      })));
    jobs.push(query(
      `SELECT t.id, t.title, t.due, t.assigned_to, t.assigned_to_name, d.id AS donor_id, d.name AS donor_name
         FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND COALESCE(t.done::text, '0') NOT IN ('1', 'true') AND t.voided_at IS NULL AND COALESCE(t.is_sample, false) = false
          AND t.due IS NOT NULL AND LEFT(t.due::text, 10) >= ? AND LEFT(t.due::text, 10) <= ?
          AND (?::text IS NULL OR t.assigned_to = ?)`,
      [orgId, from, to, owner, owner]).then(rows => rows.forEach(r => {
        const day = String(r.due).slice(0, 10);
        out.push({ id: `task:${r.id}`, type: "step", title: r.title, start: day, end: day, allDay: true, ownerId: r.assigned_to, ownerName: r.assigned_to_name || "",
          donorId: r.donor_id || null, donorName: r.donor_name || null, detail: "A task", editable: { move: false, resize: false }, ref: { taskId: r.id } });
      })));
  }
  if (want.has("shift")) {
    jobs.push(query(
      `SELECT s.id, COALESCE(s.name, o.name) AS name, s.date, s.start_time, s.end_time, s.capacity, s.color, s.venue,
              (SELECT COUNT(*) FROM volunteer_signups su WHERE su.org_id = s.org_id AND su.slot_id = s.id AND su.status IN ('confirmed','completed'))::int AS filled,
              (SELECT COALESCE(SUM(r.needed), 0) FROM volunteer_slot_roles r WHERE r.org_id = s.org_id AND r.slot_id = s.id)::int AS role_needed
         FROM volunteer_slots s LEFT JOIN volunteer_opportunities o ON o.id = s.opportunity_id AND o.org_id = s.org_id
        WHERE s.org_id = ? AND s.cancelled_at IS NULL AND s.date >= ? AND s.date <= ?`,
      [orgId, from, to]).then(rows => rows.forEach(r => {
        const needed = r.role_needed || r.capacity || null;
        const short = needed ? Math.max(0, needed - r.filled) : 0;
        out.push({ id: `shift:${r.id}`, type: "shift", title: r.name || "Shift", start: `${r.date}T${hm(r.start_time) || "09:00"}`, end: `${r.date}T${hm(r.end_time) || "12:00"}`,
          allDay: false, detail: needed ? `${r.filled} of ${needed} filled` : `${r.filled} signed up`, filled: r.filled, needed,
          short, editable: { move: true, resize: true }, ref: { slotId: r.id }, ...(short ? { conflict: `Short ${short} ${short === 1 ? "person" : "people"}` } : {}) });
      })));
  }
  if (want.has("event")) {
    jobs.push(query(
      `SELECT e.id, e.name, e.date::text AS date, e.start_time, e.end_time, e.location FROM events e
        WHERE e.org_id = ? AND e.date IS NOT NULL AND LEFT(e.date::text, 10) >= ? AND LEFT(e.date::text, 10) <= ?`,
      [orgId, from, to]).then(rows => rows.forEach(r => {
        const day = String(r.date).slice(0, 10), st = hm(r.start_time), en = hm(r.end_time);
        out.push({ id: `event:${r.id}`, type: "event", title: r.name, start: st ? `${day}T${st}` : day, end: st ? `${day}T${en || addMin(st, 120)}` : day,
          allDay: !st, detail: r.location || "", editable: { move: true, resize: !!st }, ref: { eventId: r.id } });
      })));
  }
  if (want.has("journey")) {
    jobs.push(query(
      `SELECT st.id, st.label, st.due_date::text AS due, st.owner_id, st.owner_name, d.id AS donor_id, d.name AS donor_name
         FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id = st.plan_id AND p.org_id = st.org_id
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
        WHERE st.org_id = ? AND st.closed_at IS NULL AND COALESCE(st.status, 'open') NOT IN ('done','skipped')
          AND st.due_date IS NOT NULL AND LEFT(st.due_date::text, 10) >= ? AND LEFT(st.due_date::text, 10) <= ?
          AND (?::text IS NULL OR st.owner_id = ? OR p.owner_id = ?)`,
      [orgId, from, to, owner, owner, owner]).then(rows => rows.forEach(r => {
        const day = String(r.due).slice(0, 10);
        out.push({ id: `journey:${r.id}`, type: "journey", title: `${r.label}: ${r.donor_name}`, start: day, end: day, allDay: true,
          ownerId: r.owner_id, donorId: r.donor_id, donorName: r.donor_name, detail: "A journey step", editable: { move: false, resize: false }, ref: { stepId: r.id } });
      })).catch(() => {}));
  }
  if (want.has("send")) {
    jobs.push(query(
      `SELECT c.id, c.name, c.subject, to_char(COALESCE(c.sent_at, c.scheduled_at) AT TIME ZONE ?, 'YYYY-MM-DD"T"HH24:MI') AS at, c.sent_at IS NOT NULL AS sent
         FROM campaigns c WHERE c.org_id = ? AND COALESCE(c.sent_at, c.scheduled_at) IS NOT NULL
          AND (COALESCE(c.sent_at, c.scheduled_at) AT TIME ZONE ?)::date BETWEEN ?::date AND ?::date`,
      [tz, orgId, tz, from, to]).then(rows => rows.forEach(r => out.push({
        id: `send:${r.id}`, type: "send", title: `${r.sent ? "Sent" : "Sends"}: ${r.name || r.subject || "a campaign"}`, start: r.at, end: `${r.at.slice(0, 11)}${addMin(r.at.slice(11), 30)}`,
        allDay: false, detail: r.subject || "", editable: { move: false, resize: false }, ref: { campaignId: r.id },
      }))));
  }
  if (want.has("pledge")) {
    jobs.push(query(
      `SELECT pi.id, pi.due_date::text AS due, pi.amount, d.id AS donor_id, d.name AS donor_name
         FROM pledge_installments pi JOIN pledges p ON p.id = pi.pledge_id AND p.org_id = pi.org_id AND p.status = 'open'
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
        WHERE pi.org_id = ? AND pi.paid_at IS NULL AND LEFT(pi.due_date::text, 10) >= ? AND LEFT(pi.due_date::text, 10) <= ?
       UNION ALL
       SELECT p.id, p.due_date::text, p.amount, d.id, d.name FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
        WHERE p.org_id = ? AND p.status = 'open' AND p.due_date IS NOT NULL AND LEFT(p.due_date::text, 10) >= ? AND LEFT(p.due_date::text, 10) <= ?
          AND NOT EXISTS (SELECT 1 FROM pledge_installments x WHERE x.org_id = p.org_id AND x.pledge_id = p.id)`,
      [orgId, from, to, orgId, from, to]).then(rows => rows.forEach(r => {
        const day = String(r.due).slice(0, 10);
        out.push({ id: `pledge:${r.id}`, type: "pledge", title: `Pledge due: ${r.donor_name}`, start: day, end: day, allDay: true,
          donorId: r.donor_id, donorName: r.donor_name, amount: Number(r.amount) || 0, detail: `$${Number(r.amount || 0).toLocaleString("en-US")} due`,
          editable: { move: false, resize: false }, ref: { pledgeId: r.id } });
      })));
  }
  if (want.has("birthday")) {
    jobs.push(query(
      `SELECT id, name, birth_month, birth_day FROM donors WHERE org_id = ? AND deleted_at IS NULL AND deceased IS NOT TRUE
          AND birth_month IS NOT NULL AND birth_day IS NOT NULL`, [orgId]).then(rows => {
        const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])];
        for (const r of rows) for (const y of years) {
          const day = `${y}-${pad(r.birth_month)}-${pad(r.birth_day)}`;
          if (day >= from && day <= to) out.push({ id: `birthday:${r.id}:${y}`, type: "birthday", title: `${r.name}'s birthday`, start: day, end: day, allDay: true,
            donorId: r.id, donorName: r.name, detail: "", editable: { move: false, resize: false }, ref: {} });
        }
      }));
  }
  await Promise.all(jobs);
  markConflicts(out);
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.type.localeCompare(b.type));
  return out;
}

// Two of one person's meetings at once; an event and a shift on top of each
// other. A shift short of people already says so. Quiet markers only.
function markConflicts(items) {
  const timed = items.filter(i => !i.allDay && i.start && i.end && i.start.length > 10);
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  const meets = timed.filter(i => i.type === "meeting");
  for (let i = 0; i < meets.length; i++) for (let j = i + 1; j < meets.length; j++) {
    const a = meets[i], b = meets[j];
    if (a.ownerId && a.ownerId === b.ownerId && overlap(a, b)) { a.conflict = a.conflict || "Overlaps another of your meetings"; b.conflict = b.conflict || "Overlaps another of your meetings"; }
  }
  const evs = items.filter(i => i.type === "event"), shifts = timed.filter(i => i.type === "shift");
  for (const e of evs) for (const s of shifts) {
    const same = e.allDay ? s.start.slice(0, 10) === e.start.slice(0, 10) : overlap(e, s);
    if (same) { e.conflict = e.conflict || `Clashes with the shift ${s.title}`; s.conflict = s.conflict ? `${s.conflict} · clashes with ${e.title}` : `Clashes with ${e.title}`; }
  }
}

module.exports = { calendarItems, TYPES, DEFAULT_ON, markConflicts };

// server/onboard/weekNotes.js · ONBOARD-3 item 4. "PRINT THIS WEEK'S NOTES".
//
// Every Monday a director can print the notes she means to write by hand: one
// row per person with a thank-you or note step due this week (Monday to Sunday,
// the org's own days), open and not voided, on the Thread (a step) or on Tasks
// (a task). A thank-you step is the gift's own (thankYouOnce.js: next_step_type
// thank / thank_you_note, a label that starts "Send thank-you"); a note step is
// a handwritten note ("Send a handwritten note") or a task whose title says
// thank-you or note. Never a person marked deceased or do not contact, and
// never anyone in the trash. A do-not-mail person is listed without an address.
// Each row: the name, the mailing address on file, the last gift, the About
// note's detail, and a suggested first line written from those facts (the
// template path). Printing stores and sends nothing.
"use strict";
const orgTime = require("../../orgTime");
const { lastGifts } = require("../../shared/numbers/lastGift");
const { EVERYONE } = require("../../shared/numbers/everyone");
const PLANT = () => String(process.env.ONBOARD3_PLANT || "");

const STEP_WORDS = "(thank|note|card|letter)";
const THREAD_IS_NOTE = `(t.next_step_type IN ('thank', 'thank_you_note') OR t.next_step_label ~* '${STEP_WORDS}')`;
const TASK_IS_NOTE = `(k.thanks_gift_id IS NOT NULL OR k.title ~* '${STEP_WORDS}')`;
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const words = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const usd = c => { const n = Math.abs(Math.round(Number(c) || 0)); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };

// Monday to Sunday around the org's today.
function weekOf(today) {
  const from = orgTime.addDays(today, -orgTime.dayOfWeek(today));
  return { from, to: orgTime.addDays(from, 6) };
}

// The About note's detail, clipped at a sentence (shared/draftAbout.js clipNote's rule).
function clip(about, max = 180) {
  const s = String(about || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= max) return /[.!?]$/.test(s) ? s : s + ".";
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

// The template's first line, from facts on file only: the step, the last gift, the About note.
// `hi` is shared/greeting.js greetingLine's (the salutation on file, else the first name).
function firstLine({ hi, step, last, about }) {
  if (/thank/i.test(step) && last) return `${hi} thank you for your gift of ${usd(last.cents)} on ${words(last.date)}.`;
  if (about) return `${hi} I have been thinking about what you shared with us: ${about.replace(/\.$/, "")}.`;
  if (last) return `${hi} your gift of ${usd(last.cents)} on ${words(last.date)} is still making a difference here.`;
  return `${hi} I wanted to write to you myself.`;
}

async function list(query, orgId, today) {
  const wk = weekOf(today);
  const live = PLANT() === "print-dnc" ? `d.org_id = ? AND ${EVERYONE("d")}` : `d.org_id = ? AND ${EVERYONE("d")} AND COALESCE(d.do_not_contact, false) = false AND COALESCE(d.deceased, false) = false`;
  const due = PLANT() === "print-all" ? "" : "AND LEFT(x.due, 10) >= ? AND LEFT(x.due, 10) <= ?";
  const rows = await query(`
    SELECT x.donor_id, MIN(LEFT(x.due, 10)) AS due, (ARRAY_AGG(x.label ORDER BY LEFT(x.due, 10), x.label))[1] AS step,
           d.name, d.salutation, d.person_types, d.contact_name, d.address, d.address2, d.city, d.state, d.zip, COALESCE(d.do_not_mail, false) AS no_mail, d.about_them
      FROM (SELECT t.donor_id, t.due_date::text AS due, t.next_step_label AS label FROM threads t
             WHERE t.org_id = ? AND t.closed_at IS NULL AND ${THREAD_IS_NOTE}
            UNION ALL
            SELECT k.donor_id, k.due, k.title FROM tasks k
             WHERE k.org_id = ? AND k.donor_id IS NOT NULL AND COALESCE(k.done, 0) = 0 AND k.voided_at IS NULL AND ${TASK_IS_NOTE}
               AND COALESCE(k.due, '') ~ '^\\d{4}-\\d{2}-\\d{2}') x
      JOIN donors d ON d.id = x.donor_id
     WHERE ${live} ${due}
     GROUP BY x.donor_id, d.name, d.salutation, d.person_types, d.contact_name, d.address, d.address2, d.city, d.state, d.zip, d.do_not_mail, d.about_them
     ORDER BY MIN(LEFT(x.due, 10)), d.name`,
    [orgId, orgId, orgId, ...(due ? [wk.from, wk.to] : [])]);
  const last = await lastGifts(query, orgId, rows.map(r => r.donor_id));
  const G = await import("../../shared/greeting.js");
  const people = rows.map(r => {
    const about = clip(r.about_them);
    const lg = last.get(r.donor_id) || null;
    const hi = G.greetingLine({ name: r.name, salutation: r.salutation, person_types: r.person_types, contact_name: r.contact_name });
    const addr = r.no_mail ? null : [r.address, r.address2, [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].map(v => String(v || "").trim()).filter(Boolean);
    return { id: r.donor_id, name: r.name, due: r.due, step: r.step,
      address: addr && addr.length ? addr : null, noMail: !!r.no_mail,
      lastGift: lg, about, firstLine: firstLine({ hi, step: r.step, last: lg, about }) };
  });
  return { week: wk, today, people,
    sentence: `Everyone with a thank-you or note step due ${words(wk.from)} to ${words(wk.to)}, on the Thread or on Tasks, not done. People marked do not contact or deceased are left out.`,
    empty: people.length ? null : `Nobody has a thank-you or note due this week (${words(wk.from)} to ${words(wk.to)}). Nothing to print.` };
}

module.exports = { list, weekOf, firstLine, clip };

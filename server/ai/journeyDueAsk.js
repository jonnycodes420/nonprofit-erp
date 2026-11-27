// server/ai/journeyDueAsk.js · POLISH-15 item 5 (W-1127-Atlas-02). ASK WHEN A JOURNEY STEP IS DUE.
//
// The Calendar's Ask box ("Ask anything about these dates") answered "When is
// the next journey step due?" with "Steward can't answer … yet" (the panel's
// "No answer"), although the same Calendar draws every journey step on its day.
// Now a question about journey steps being due is answered from the rows the
// Calendar reads (calendar.js, type "journey"): open steps of a live person's
// journey, with a due day. On the Calendar the dates on screen are the range;
// anywhere else, today and the next 30 days. A question that says "next" also
// names the first step due after the range when none falls inside it.
// Read only, in code, AI on or off: the sentence is the same template either way.
"use strict";

const ASKS_DUE = /\bjourneys?\b/i;
// "due" says it; "next/upcoming step" says it too. "How many journeys started
// this month" is the catalog's journeys count, not this.
const DUE_WORDS = /\bdue\b|\b(next|upcoming|coming up|scheduled)\b.*\bsteps?\b|\bsteps?\b.*\b(next|upcoming|coming up|scheduled)\b/i;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHOWN = 10;

function isJourneyDueQuestion(text) {
  const t = String(text || "");
  return ASKS_DUE.test(t) && DUE_WORDS.test(t) && !/\b(why|how many|raised|gave|giving|started|joined)\b/i.test(t);
}

// "Nov 30", with the year when it is not today's year.
function dayWords(day, today) {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return `${MON[m - 1]} ${d}${String(y) === String(today).slice(0, 4) ? "" : `, ${y}`}`;
}
const rangeWords = (from, to, today) => from === to ? `on ${dayWords(from, today)}` : `from ${dayWords(from, today)} to ${dayWords(to, today)}`;

const STEPS_SQL = `SELECT st.id, st.label, LEFT(st.due_date::text, 10) AS due, d.id AS donor_id, d.name AS donor_name
     FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id = st.plan_id AND p.org_id = st.org_id
     JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
    WHERE st.org_id = ? AND st.closed_at IS NULL AND COALESCE(st.status, 'open') NOT IN ('done','skipped')
      AND st.due_date IS NOT NULL AND LEFT(st.due_date::text, 10) >= ? AND LEFT(st.due_date::text, 10) <= ?`;

// { query, orgId, typed, scope, today, vis } → an Ask answer, or null when it isn't this question.
async function journeyDueAnswer({ query, orgId, typed, scope, today, vis = { sql: "", args: [] } }) {
  if (!isJourneyDueQuestion(typed)) return null;
  const add = (day, n) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const onCalendar = scope && DAY.test(String(scope.from || "")) && DAY.test(String(scope.to || "")) && String(scope.to) >= String(scope.from);
  const from = onCalendar ? String(scope.from) : today, to = onCalendar ? String(scope.to) : add(today, 30);
  const visSql = vis.sql || "";   // visibleSql(req, "d"): a portfolio user sees their own people's steps
  const order = " ORDER BY LEFT(st.due_date::text, 10), d.name, st.id";
  const rows = await query(STEPS_SQL + visSql + order + ` LIMIT ${SHOWN + 1}`, [orgId, from, to, ...(vis.args || [])]);
  const span = rangeWords(from, to, today);
  const where = onCalendar ? span : `in the next 30 days`;
  const steps = [{ kind: "open", label: "Open the Calendar", href: "/app/calendar" }];
  const planWords = `Journey steps · due ${where}`;
  const counted = "Open steps of a journey on a person's record, with a due day, as the Calendar shows them. A step marked done or skipped is not counted. Steward wrote nothing.";
  const said = r => `${r.label} for ${r.donor_name} on ${dayWords(r.due, today)}`;
  if (!rows.length) {
    let next = null;
    if (/\bnext\b/i.test(typed)) [next] = await query(STEPS_SQL + visSql + order + " LIMIT 1", [orgId, add(to, 1), "9999-12-31", ...(vis.args || [])]);
    const line = `No journey step is due ${where}.` + (next ? ` The next one is the ${said(next)}.` : "");
    return { answered: true, kind: "answer", sentence: line, sentenceParts: [line], figures: {}, table: null,
      people: next ? [{ donorId: next.donor_id, name: next.donor_name, cents: 0 }] : null, steps, counted, planWords };
  }
  const shown = rows.slice(0, SHOWN);
  const more = rows.length > SHOWN ? " There are more on the Calendar." : "";
  const lead = /\bnext\b/i.test(typed) && !onCalendar
    ? `The next journey step due is the ${said(shown[0])}.`
    : `Due ${where}: ${shown.map(said).join("; ")}.`;
  const rest = /\bnext\b/i.test(typed) && !onCalendar && shown.length > 1 ? ` After it: ${shown.slice(1).map(said).join("; ")}.` : "";
  const sentence = lead + rest + more;
  const seen = new Set(), people = [];
  for (const r of shown) if (!seen.has(r.donor_id)) { seen.add(r.donor_id); people.push({ donorId: r.donor_id, name: r.donor_name, cents: 0 }); }
  return { answered: true, kind: "answer", sentence, sentenceParts: [sentence], figures: {}, table: null, people, steps, counted, planWords };
}

module.exports = { journeyDueAnswer, isJourneyDueQuestion };

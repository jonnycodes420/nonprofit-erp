// server/atlas/briefOpen.js · ATLAS-9 item 1. THE BRIEF NAMES WHAT'S OPEN.
//
// Jarvis (23 Nov): "The Margaret Chen brief has the money right but omits her
// open $25,000 ask for Youth Arts Access, her unthanked Sep 26 gift, and coffee
// with her tomorrow." The brief (answers.js personAnswer) read what happened:
// giving, conversations, About. Nothing it read was still open.
//
// Now it leads with what is open, each line opening its row, each read by the
// rule the profile already uses:
//   open asks     figureSources "donor-open-ask": a proposal whose stage is one
//                 of proposalShape.OPEN_STAGE_KEYS, at the amount it asks for
//   not thanked   shared/numbers/thanks.js AWAITING, from the org's Steward
//                 start (shared/numbers/stewardStart.js), as the profile's rail
//   coming up     meetings.js meetingsWith(held: false): a calendar meeting or
//                 a meeting logged for a later day, the soonest first
"use strict";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const usd = cents => require("../../money").formatCentsPlain(Math.round(Number(cents) || 0));
const cents = v => Math.round((Number(v) || 0) * 100);
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const dayWords = d => (isDay(d) ? `${MON[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : "");
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// "tomorrow, Nov 24, 2026", "today, …", or the date alone.
function when(d, today) {
  if (!isDay(d)) return "";
  if (today && d === today) return `today, ${dayWords(d)}`;
  if (today && d === addDays(today, 1)) return `tomorrow, ${dayWords(d)}`;
  return dayWords(d);
}
const SHOW = 3;   // of each kind; the line says how many more

// [{ kind, id, line, link }] for one person, what is open first.
async function openItems(query, orgId, donorId, { today = null, first = "They" } = {}) {
  const P = require("../../shared/proposalShape.js");
  const stageWord = Object.fromEntries(P.PROPOSAL_STAGES.map(s => [s.key, s.label]));
  const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]).catch(() => []);
  const since = await require("../../shared/numbers/stewardStart").stewardStart(query, orgId, require("../../orgTime").normalizeTimezone(o && o.timezone)).catch(() => null);
  const day = today || new Date().toISOString().slice(0, 10);
  const [asks, unthanked, coming] = await Promise.all([
    query(`SELECT o.id, COALESCE(NULLIF(o.name, ''), f.name) AS purpose, f.name AS fund, o.target_amount, o.proposal_stage,
                  TO_CHAR(o.expected_close, 'YYYY-MM-DD') AS due
             FROM opportunities o LEFT JOIN funds f ON f.id = o.fund_id AND f.org_id = o.org_id
            WHERE o.org_id = ? AND o.donor_id = ? AND o.proposal_stage = ANY(?::text[])
            ORDER BY o.target_amount DESC NULLS LAST, o.expected_close NULLS LAST, o.id`, [orgId, donorId, P.OPEN_STAGE_KEYS])
      .catch(e => { console.error("[atlas] brief asks:", e.message); return []; }),
    query(`SELECT g.id, g.amount, LEFT(g.date, 10) AS date FROM gifts g
            WHERE g.org_id = ? AND g.donor_id = ? AND COALESCE(g.is_sample, false) = false AND g.date IS NOT NULL
              ${since ? "AND g.date >= ?" : ""} AND ${require("../../shared/numbers/thanks").AWAITING("g")}
            ORDER BY g.date DESC, g.id DESC`, since ? [orgId, donorId, since] : [orgId, donorId])
      .catch(e => { console.error("[atlas] brief thanks:", e.message); return []; }),
    require("../../meetings").meetingsWith(orgId, donorId, { held: false, limit: 50 })
      .catch(e => { console.error("[atlas] brief meetings:", e.message); return []; }),
  ]);
  const out = [];
  for (const o of asks.slice(0, SHOW)) {
    const purpose = String(o.purpose || "").trim();
    const stage = stageWord[o.proposal_stage] || String(o.proposal_stage || "").replace(/_/g, " ");
    out.push({ kind: "open_ask", id: o.id, line: `Open ask: ${usd(cents(o.target_amount))}${purpose ? ` for ${purpose}` : ""}, stage ${stage}${o.due ? `, expected ${dayWords(o.due)}` : ""}.`,
      link: { tab: "donor", donorId, section: "giving" } });
  }
  if (asks.length > SHOW) out.push({ kind: "open_ask", line: `And ${asks.length - SHOW} more open ${asks.length - SHOW === 1 ? "ask" : "asks"} on ${first}'s record.`, link: { tab: "donor", donorId, section: "giving" } });
  for (const g of unthanked.slice(0, SHOW))
    out.push({ kind: "unthanked", id: g.id, line: `Not yet thanked: ${usd(cents(g.amount))} on ${dayWords(g.date)}.`, link: { tab: "donor", donorId, section: "giving" } });
  if (unthanked.length > SHOW) out.push({ kind: "unthanked", line: `And ${unthanked.length - SHOW} more ${unthanked.length - SHOW === 1 ? "gift" : "gifts"} not yet thanked.`, link: { tab: "donor", donorId, section: "giving" } });
  // The soonest meeting still to come (meetingsWith is newest first).
  const next = coming.filter(m => isDay(String(m.date || "").slice(0, 10)) && String(m.date).slice(0, 10) >= day)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.starts_at || "").localeCompare(String(b.starts_at || "")))[0];
  if (next) {
    const what = String(next.title || next.note || "").replace(/\s+/g, " ").trim().slice(0, 120);
    out.push({ kind: "coming_up", id: next.id, line: `Meeting ${when(String(next.date).slice(0, 10), day)}${what ? `: ${what}` : ""}.`,
      link: { tab: "donor", donorId, section: "timeline" } });
  }
  return out;
}

module.exports = { openItems, when };

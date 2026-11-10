// server/majorGifts/top100Atlas.js · TOP100-1. ATLAS AND THE TOP 100.
//
//   "Who on my Top 100 hasn't been touched in 60 days?"
//       The people on the list whose last logged contact is 60 or more days
//       ago, or who have none, by rank. The same Last contact the list shows.
//   "Make a plan of care for #4"
//       A proposal: Quarterly touches from today, said in one line. Nothing is
//       written. The line opens the person's plan of care, where she confirms
//       it with one press (the panel's "Add these touches").
//
// Only for admins and staff with the major gifts permission, like the list.
"use strict";
const P = require("../../prospect");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Feb 8", with the year when it is not this year ("Nov 8, 2027").
const dayWords = (day, today) => { const [y, m, d] = String(day).split("-").map(Number); return `${MON[m - 1]} ${d}${String(y) === String(today).slice(0, 4) ? "" : `, ${y}`}`; };

let _shape = null;
const shapeMod = async () => _shape || (_shape = await import("../../shared/careShape.js"));

async function answer({ req, query, step, top100Rows, today }) {
  const orgId = req.user.orgId;
  if (!(await P.canSee(req.user.userId, orgId)))
    return { kind: "refused", state: "refused", line: "The Top 100 is for admins and staff with the major gifts permission." };
  const S = await shapeMod();
  const rows = await top100Rows(orgId);
  if (!rows.length) return { kind: "answer", state: "done", line: "Your Top 100 is empty. Add people from a profile, from Donors, or on the Top 100 page.", link: { tab: "top100" } };
  if (step.how === "quiet") {
    const days = Math.max(1, Math.min(3650, parseInt(step.amountWords, 10) || 60));
    const quiet = rows.filter(r => !r.lastContact || r.lastContact.days == null || r.lastContact.days >= days);
    if (!quiet.length) return { kind: "answer", state: "done", link: { tab: "top100" },
      line: `Everyone on your Top 100 has been touched in the last ${days} days.` };
    const shown = quiet.slice(0, 10).map(r => `#${r.rank} ${r.name} (${r.lastContact && r.lastContact.days != null ? `${r.lastContact.days} days` : "never"})`);
    return { kind: "answer", state: "done", link: { tab: "top100" },
      line: `${quiet.length} of ${rows.length} on your Top 100 ${quiet.length === 1 ? "hasn't" : "haven't"} been touched in ${days} days: ${shown.join(", ")}${quiet.length > 10 ? `, and ${quiet.length - 10} more` : ""}.` };
  }
  // A plan of care for "#4", "number 4" or a name on the list.
  const said = String(step.target || "");
  const n = (said.match(/\d+/) || [])[0];
  const who = n ? rows.find(r => r.rank === Number(n))
    : rows.find(r => String(r.name || "").toLowerCase() === said.toLowerCase()) || rows.find(r => String(r.name || "").toLowerCase().startsWith(said.toLowerCase()));
  if (!who) return { kind: "not_found", state: "refused", link: { tab: "top100" },
    line: n ? `Nobody is #${n} on your Top 100; it has ${rows.length}.` : `I couldn't find ${said} on your Top 100.` };
  const touches = S.touchesFromTemplate(S.QUARTERLY, today);
  const parts = touches.map(t => `${t.label.toLowerCase()} ${t.due === today ? "today" : dayWords(t.due, today)}`);
  return { kind: "answer", state: "done", donorId: who.donorId,
    link: { tab: "careplan", donorId: who.donorId, templateId: S.QUARTERLY.id },
    line: `Here's a plan of care for #${who.rank} ${who.name} from ${S.QUARTERLY.name}: ${parts.join(", ")}. Open it to add them; nothing is added until you do.`
      + (who.touchCount ? ` ${who.name} already has ${who.touchCount} planned ${who.touchCount === 1 ? "touch" : "touches"}.` : "") };
}

// The two asks, read in code: "Who on my Top 100 hasn't been touched in 60
// days" (any number of days; 60 when none is said) and "Make a plan of care
// for #4" (or "number 4", or a name). Anything else is not one of these.
function readInCode(text) {
  const t = String(text || "").trim().replace(/[.!?]+$/, "");
  const words = t;
  if (/\btop\s*100\b/i.test(t) && /\b(touched|contacted|heard from|spoken to|talked to|reached|seen|visited)\b/i.test(t)) {
    const d = t.match(/(\d+)\s*days?\b/i);
    return { kind: "top100", how: "quiet", amountWords: d ? d[1] : "60", target: t, who: "", whenWords: "", words };
  }
  const m = t.match(/^(?:please\s+)?(?:make|build|create|draft|start|write)\s+(?:a\s+|the\s+)?(?:plan of care|care plan)\s+for\s+(#\s*\d+|number\s+\d+|[A-Za-z][A-Za-z'’ -]{1,60})$/i);
  if (m) return { kind: "top100", how: "plan", target: m[1].trim(), amountWords: "", who: "", whenWords: "", words };
  return null;
}

module.exports = { answer, readInCode };

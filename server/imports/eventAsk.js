// server/imports/eventAsk.js · IMPORT-10 item 5. WHICH EVENT A SPREADSHEET'S GIFTS JOIN.
//
// The rule lives in shared/eventMatch.js. Here: the event the import will link
// (one she picked, answers.eventId, or the same event however it was typed),
// and, when she is about to create an event and a close one exists ("Night of
// The Stars" beside "NIght of the Stars 2026"), the question "Did you mean …?",
// which holds Import until she answers. "No, create it" is answers.newEvent,
// the name she said no for; a different name asks again.
"use strict";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = d => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null; };

function eventAsk({ u, answers, name, orgEvents, EM }) {
  const a = answers || {};
  const chosen = a.eventId ? orgEvents.find(e => e.id === a.eventId) || null : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.eventDate || "")) ? a.eventDate : null;
  const same = !chosen && name ? EM.sameEvent(name, orgEvents, date) : null;
  const events = chosen ? [chosen] : same ? [same] : [];
  const creating = !!name && !events.length && ((a.linkEvent && a.eventName) || (u.event && (u.event.fromEngagement || u.event.named)));
  if (creating) {
    const close = EM.closeEvent(name, orgEvents);
    if (close && a.newEvent !== EM.normEvent(name)) {
      u.questions.push({ id: "eventMatch", kind: "eventMatch", optional: false, typed: String(name), eventId: close.id, eventName: close.name, eventDate: close.date || null,
        text: `Did you mean ${close.name}?`,
        hint: `"${name}" is close to ${close.name}${longDay(close.date) ? `, ${longDay(close.date)}` : ""}, already on your calendar. Link these gifts to it, or create a new event.` });
    }
  }
  return { events };
}

module.exports = { eventAsk };

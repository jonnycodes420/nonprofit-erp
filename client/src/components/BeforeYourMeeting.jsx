// BeforeYourMeeting.jsx · VOICE-3. THE BRIEF, THE DAY BEFORE AND THE DAY OF.
//
// When a meeting with this person is today or tomorrow, the facts to have in
// mind before going in, from their own record: what they have given, the last
// time, the open ask, their last email, a gift not yet thanked. A line is left
// out rather than filled when there is nothing true to say.
//
// One read (GET /donors/:id/before-meeting) and one card, for every surface:
// the donor profile, a meeting on the calendar, and Home's lead slot. Give it
// `donorId` and it reads for itself (and draws nothing when there is no
// meeting today or tomorrow), or hand it `data` already read.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T, firstNameOf } from "./shared";
import { displayDate } from "../../../shared/displayDate.js";

const LABEL = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const time = iso => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export function useBeforeMeeting(donorId) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!donorId) { setData(null); return undefined; }
    let live = true;
    apiFetch(`/donors/${encodeURIComponent(donorId)}/before-meeting`).then(r => { if (live) setData(r && r.meeting ? r : null); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [donorId]);
  return data;
}

// The five facts, in the order she reads them before going in.
export function beforeLines(brief) {
  if (!brief) return [];
  return [
    brief.giving && ["Giving", brief.giving.text],
    brief.lastTime && ["Last time", `${displayDate(String(brief.lastTime.date).slice(0, 10))}: ${brief.lastTime.text || "a meeting"}`],
    brief.openAsk && ["Open ask", brief.openAsk.text],
    brief.lastEmail && ["Their last email", `"${brief.lastEmail.quote}"`],
    brief.unthanked && ["Not thanked yet", brief.unthanked.text],
  ].filter(Boolean);
}

export default function BeforeYourMeeting({ donorId, data: given, compact = false, showTitle = true }) {
  const read = useBeforeMeeting(given ? null : donorId);
  const data = given || read;
  if (!data || !data.meeting) return null;
  const { meeting, brief } = data;
  const first = firstNameOf((brief && brief.name) || "") || "them";
  const lines = beforeLines(brief);
  const when = `${meeting.day === "today" ? "Today" : "Tomorrow"}${meeting.startsAt ? `, ${time(meeting.startsAt)}` : ""}`;
  return (
    <section data-testid="before-meeting" aria-label="Before your meeting"
      style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid #C9A84C", borderRadius: 12, padding: compact ? "10px 12px" : "16px 18px" }}>
      <div style={{ ...LABEL, marginBottom: 4 }}>Before your meeting</div>
      {showTitle && <div style={{ fontSize: compact ? 14.5 : 16, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>
        {meeting.title} with {first} <span style={{ fontWeight: 400, color: T.ink3 }}>· {when}{meeting.location ? ` · ${meeting.location}` : ""}</span>
      </div>}
      {lines.length === 0
        ? <div style={{ fontSize: 13.5, color: T.ink3, marginTop: 6 }}>Nothing on file yet about {first}: no gifts and no conversations logged.</div>
        : <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {lines.map(([k, v]) => <div key={k} data-testid="before-meeting-line" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}><b>{k}.</b> {v}</div>)}
        </div>}
    </section>
  );
}

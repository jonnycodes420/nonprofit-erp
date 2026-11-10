// components/profile/NotesBanner.jsx · FLOWS-4 (W-1109-Atlas-02X).
// THE NOTES BANNER SAYS WHAT IS TRUE NOW, AND DATES WHAT WAS TRUE THEN.
//
// Renee's banner read "Attended an info session, hasn't given yet." above
// $36,750 of gifts: the record's notes field, typed (or imported) before she
// gave, shown as if it were today's fact. Now the banner's first line is
// derived from her giving as it stands (the stored lifetime, donorSummary.js,
// and the last gift), and the stored note under it is dated by when it was
// written (donors.notes_at; a note from before that column falls back to the
// day the record was made): "Mar 2025 note: …".
import { T, firstNameOf } from "../shared";
import { shownNote } from "../../lib/internalLabels";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = v => { const s = String(v || ""); const m = /^(\d{4})-(\d{2})/.exec(s); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ""; };
const dayOf = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || "")); return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
const money = c => "$" + (Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

export function givingLine(donor) {
  const life = donor && donor.figures && donor.figures.lifetime;
  const cents = life && life.cents != null ? Number(life.cents) : Math.round(Number((donor && (donor.total_giving ?? donor.total)) || 0) * 100);
  const who = firstNameOf(donor && donor.name) || (donor && donor.name) || "They";
  if (!(cents > 0)) return `${who} hasn't given yet.`;
  const last = dayOf(donor.last_gift_date || donor.lastGift);
  return `${who} has given ${money(cents)} in all${last ? `, most recently on ${last}` : ""}.`;
}

export function NotesBanner({ donor }) {
  const note = shownNote(donor && donor.notes);
  if (!note) return null;
  const when = monthOf(donor.notes_at || donor.notesAt || donor.created_at || donor.createdAt);
  return (
    <div data-testid="dp-record-notes" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
      <div data-testid="dp-notes-giving" style={{ color: T.ink, fontWeight: 600, marginBottom: 4 }}>{givingLine(donor)}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{when ? <b style={{ fontWeight: 700 }}>{when} note: </b> : null}{note}</div>
    </div>
  );
}

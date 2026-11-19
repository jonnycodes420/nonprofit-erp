// components/donors/ReengageChange.jsx · FLOWS-19 item 5 (W-1118-Donors-T6).
// WHY RE-ENGAGE'S COUNT MOVED, UNDER THE COUNT.
//
// "1 more than Nov 16: Silas Inglewood crossed 12 months without a gift on Nov 17."
// The server compares today's Re-engage with the last day Steward kept its list
// (server/donors/reengageChange.js) and writes the sentence; this shows it, and
// the people it names open their profiles. Before Steward has kept a day, it
// says when the comparison starts. It reads the whole count, so it hides while
// the Directory's filters narrow the list.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

export function ReengageChange({ hidden = false, onSelectDonor = null }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    if (hidden) return undefined;
    let live = true;
    apiFetch("/donors/reengage-change").then(r => { if (live) setC(r || null); }).catch(() => { if (live) setC(null); });
    return () => { live = false; };
  }, [hidden]);
  if (hidden || !c) return null;
  const sentence = c.sentence || "Steward keeps who is on Re-engage each day; tomorrow this says who moved since today, and why.";
  const named = (c.moves || []).filter(m => m.id && m.name).slice(0, 5);
  return (
    <div data-testid="reengage-change" data-since={c.since || ""} style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, margin: "0 0 10px" }}>
      {sentence}
      {onSelectDonor && named.length > 0 && <span> Open:{" "}{named.map((m, i) => (
        <span key={m.id}>{i ? ", " : ""}<button type="button" data-testid="reengage-change-person" onClick={() => onSelectDonor({ id: m.id, name: m.name })}
          style={{ border: "none", background: "transparent", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>{m.name}</button></span>))}</span>}
    </div>
  );
}

// GoalCommitment.jsx · GIFTS-2. A GOAL'S PLEDGES, SAID ON THE CARD.
//
// The server says raised, pledged and committed for each goal and whether it
// counts pledges (shared/numbers/goalPledges.js). On: "Raised $225,116 +
// $23,750 pledged = $248,866 committed", and the pace beside it reads
// committed. Off: the pledged line still shows beside the goal, so nothing is
// hidden. An admin turns the switch on the card itself.
import { useState } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { T } from "./shared";

export default function GoalCommitment({ c, isAdmin = false, onChanged, style }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!c) return null;
  const flip = async () => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/goals/${c.kind}/${encodeURIComponent(c.goalId)}/count-pledges`, { method: "PUT", body: JSON.stringify({ on: !c.countPledges }) });
      if (onChanged) onChanged();
    } catch (e) { setErr(errorMessage(e, "That setting could not be saved.")); }
    setBusy(false);
  };
  return (
    <div data-testid="goal-commitment" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, ...(style || {}) }}>
      <div data-testid="goal-commitment-sentence" title={c.definition}>{c.sentence}</div>
      {c.canCount && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.ink3, marginTop: 4, cursor: isAdmin ? "pointer" : "default" }}
          title={isAdmin ? c.definition : "An admin can change this."}>
          <input type="checkbox" checked={!!c.countPledges} disabled={!isAdmin || busy} onChange={flip} data-testid="goal-count-pledges"
            style={{ accentColor: T.greenDk }} />
          Count pledges toward this goal
        </label>
      )}
      {err && <div role="alert" style={{ fontSize: 11.5, color: T.gold700, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

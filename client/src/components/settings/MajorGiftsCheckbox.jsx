// settings/MajorGiftsCheckbox.jsx · PROSPECT-1, moved out of Settings.jsx by WEALTH-1
// (which put the Wealth Score team switch beside it). Who sees Room to give,
// screening results, prospect briefs and Wealth Scores: admins always do;
// anyone else only when an admin ticks this.
import { T } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { VIEWER } from "../../../../shared/viewOnly.js";

export function MajorGiftsCheckbox({ m, isAdmin, setTeam }) {
  if (!(isAdmin && !["volunteer_coordinator", VIEWER].includes(m.role) && !m.member)) return null;
  return (
    <label data-testid={"team-major-gifts-" + m.id} title={m.role === "admin" ? "Admins always have it" : "Sees the Major Gifts page, Room to give, screening results, prospect briefs and Wealth Scores"}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: T.ink3, cursor: m.role === "admin" ? "default" : "pointer", flexShrink: 0 }}>
      <input type="checkbox" checked={m.role === "admin" || !!m.can_major_gifts} disabled={m.role === "admin"}
        onChange={async e => {
          const on = e.target.checked;
          setTeam(t => t.map(x => x.id === m.id ? { ...x, can_major_gifts: on } : x));
          try { const r = await apiFetch(`/org/users/${m.id}/major-gifts`, { method: "PUT", body: JSON.stringify({ on }) });
            setTeam(t => t.map(x => x.id === m.id ? { ...x, can_major_gifts: !!r.canMajorGifts } : x)); }
          catch (err) { setTeam(t => t.map(x => x.id === m.id ? { ...x, can_major_gifts: !on } : x)); alert(errorMessage(err, "That permission did not change.")); }
        }} style={{ accentColor: T.greenDk }} />
      Major gifts{m.role === "admin" ? " (admins always have it)" : ""}
    </label>
  );
}

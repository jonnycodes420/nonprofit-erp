// settings/TeamAccess.jsx · ACCESS-2. "Sees: Everyone / Only people assigned to them".
// In Settings → Team, beside each member (an admin's control), and on the
// invite. The Campaign cabinet preset is Staff, only assigned people, no
// export and no Wealth Score. Admins always see everyone. The server is the
// guard (server/auth/portfolio.js); this only sets it.
import { T } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";

const OPTIONS = [
  ["everyone", "Sees everyone"],
  ["assigned", "Sees only people assigned to them"],
  ["cabinet", "Campaign cabinet: only assigned, no export, no Wealth Score"],
];
const valueOf = m => m.sees !== "assigned" ? "everyone" : (m.can_export === false && m.can_wealth === false ? "cabinet" : "assigned");
const bodyOf = v => v === "cabinet" ? { preset: "cabinet" } : { sees: v };
const selectStyle = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 6px", fontSize: 11.5, color: T.ink2, background: T.bg, flexShrink: 0, maxWidth: 230 };
const TITLE = "Only people assigned to them: they see the people they own (and the members of a household whose main person they own). Everyone else is not there for them: not in lists, search, Atlas, Home or exports.";

export function SeesSelect({ m, isAdmin, setTeam }) {
  if (!isAdmin || m.role === "admin") return null;
  const v = valueOf(m);
  return (
    <select data-testid={"team-sees-" + m.id} value={v} title={TITLE} aria-label={"Who " + (m.name || "they") + " sees"} style={selectStyle}
      onChange={async e => {
        const next = e.target.value, prev = { sees: m.sees, can_export: m.can_export, can_wealth: m.can_wealth };
        const opt = next === "cabinet" ? { sees: "assigned", can_export: false, can_wealth: false } : { sees: next, can_export: true, can_wealth: true };
        setTeam(t => t.map(x => x.id === m.id ? { ...x, ...opt } : x));
        try { await apiFetch(`/org/users/${m.id}/access`, { method: "PUT", body: JSON.stringify(bodyOf(next)) }); }
        catch (err) { setTeam(t => t.map(x => x.id === m.id ? { ...x, ...prev } : x)); alert(errorMessage(err, "Who they see did not change.")); }
      }}>
      {OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
}

// On the invite: the same three, sent with the invite (POST /auth/invite).
export function InviteSees({ role, value, onChange }) {
  if (role === "admin") return null;
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Sees</div>
      <select data-testid="invite-sees" value={value.preset === "cabinet" ? "cabinet" : (value.sees || "everyone")} title={TITLE}
        onChange={e => onChange(bodyOf(e.target.value))}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: T.ink, background: T.bg, outline: "none", marginBottom: 16 }}>
        {OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </>
  );
}

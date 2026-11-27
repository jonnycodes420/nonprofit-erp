// settings/RoleTable.jsx · POLISH-14 item 5. Settings → Team: what each role
// can do, in one short table (shared/viewOnly.js ROLE_CAN, the server's gates).
// A viewer's Export reads the org's Viewers can export switch, live.
import { ROLES, ROLE_ACTIONS, ROLE_CAN, roleWord, viewerExportWord } from "../../../../shared/viewOnly.js";
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

// The switch's answer (an admin's read; a staff member's is refused, so null),
// kept current when an admin flips it (ViewerExports says so on the window).
export const VIEWER_EXPORTS_EVENT = "steward:viewer-exports";

export function RoleTable({ isAdmin }) {
  const [viewerExportsOn, setOn] = useState(null);
  useEffect(() => {
    if (isAdmin) apiFetch("/org/viewer-exports").then(s => setOn(!!(s && s.on))).catch(() => setOn(null));
    const hear = e => setOn(!!(e && e.detail && e.detail.on));
    window.addEventListener(VIEWER_EXPORTS_EVENT, hear);
    return () => window.removeEventListener(VIEWER_EXPORTS_EVENT, hear);
  }, [isAdmin]);
  const cell = { padding: "6px 10px", borderBottom: "1px solid " + T.bg3, fontSize: 12, color: T.ink2, textAlign: "left", verticalAlign: "top" };
  const order = ["admin", ...ROLES.filter(r => r !== "admin")];
  return (
    <div data-testid="role-table" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, marginBottom: 6 }}>What each role can do</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: T.white }}>
          <thead><tr>
            <th scope="col" style={{ ...cell, color: T.ink3, fontWeight: 700 }}>Role</th>
            {ROLE_ACTIONS.map(a => <th key={a} scope="col" style={{ ...cell, color: T.ink3, fontWeight: 700 }}>{a}</th>)}
          </tr></thead>
          <tbody>
            {order.map(r => (
              <tr key={r} data-testid={`role-row-${r}`}>
                <th scope="row" style={{ ...cell, color: T.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{roleWord(r)}</th>
                {ROLE_ACTIONS.map(a => <td key={a} style={cell}>{ROLE_CAN[r][a] == null ? viewerExportWord(viewerExportsOn) : ROLE_CAN[r][a]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

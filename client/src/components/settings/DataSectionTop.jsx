// components/settings/DataSectionTop.jsx · the top of Settings → Your Data.
// Moved out of Settings.jsx (FLOWS-4, which was at its 1,500-line edge) with
// the line FLOWS-4 adds: where deleted people are restored from.
import { T, SectionLabel } from "../shared";
import { TrashLink } from "./TrashLink";

export function DataSectionTop({ isAdmin, onNavigate }) {
  return <>
    {/* FLOWS-4 (W-1107-Finance-35): Your Data said deleted records restore "from there" and showed no way there. */}
    <TrashLink isAdmin={isAdmin} onNavigate={onNavigate} lead="Deleted people are kept for 30 days and restored from "
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "14px 28px", marginBottom: 14 }} />
    {/* CLEAN-1 4d: said plainly, where an admin looks for what Steward does with addresses. */}
    <div data-testid="settings-ncoa-line" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 28px", marginBottom: 14 }}>
      <SectionLabel>Change of address (NCOA)</SectionLabel>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, maxWidth: 620 }}>
        Steward doesn't run the change-of-address check itself yet. Donors, Data health prepares an address update file that works with any USPS-licensed NCOA provider, and reads the file they send back so you can approve each move.
      </div>
    </div>
  </>;
}

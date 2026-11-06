// client/src/components/settings/InvitedList.jsx · WALKB-2 item 1. THE
// INVITES YOU SENT, UNDER TEAM.
//
// A Staff invite used to vanish once made: the Team list read only people
// who had accepted, so the invite showed nowhere but the Audit log. Each
// pending invite is a row here with its role and date, and Resend, Copy link
// and Revoke (server/org/invites.js).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, Pill, SectionLabel } from "../shared";
import { askConfirm } from "../ConfirmDialog";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import { civilDayOf } from "../../lib/orgToday";   // the org's day, never the UTC one

const link = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" };

export function InvitedList({ isAdmin, version = 0 }) {
  const [invites, setInvites] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => apiFetch("/org/invites").then(r => setInvites((r && r.invites) || [])).catch(() => setInvites([]));
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, version]);
  if (!isAdmin || !invites || !invites.length) return null;

  const resend = async i => {
    setBusy(i.id); setMsg("");
    try { const r = await apiFetch(`/org/invites/${encodeURIComponent(i.id)}/resend`, { method: "POST", body: "{}" }); setMsg(r.message || ""); await load(); }
    catch (e) { setMsg(errorMessage(e, "The invite was not sent again.")); }
    setBusy("");
  };
  const copy = i => {
    const done = () => setMsg(`The link for ${i.email} is copied.`);
    try { navigator.clipboard.writeText(i.link).then(done, () => setMsg(i.link)); } catch { setMsg(i.link); }
  };
  const revoke = async i => {
    if (!(await askConfirm({ title: `Revoke the invite to ${i.email}?`, body: "The link stops working at once. You can invite them again later.", yes: "Revoke", danger: true }))) return;
    setBusy(i.id); setMsg("");
    try { const r = await apiFetch(`/org/invites/${encodeURIComponent(i.id)}`, { method: "DELETE" }); setMsg(r.message || ""); await load(); }
    catch (e) { setMsg(errorMessage(e, "The invite was not revoked.")); }
    setBusy("");
  };
  return (
    <div data-testid="team-invited" style={{ marginTop: 20 }}>
      <SectionLabel>Invited</SectionLabel>
      {invites.map((i, k) => (
        <div key={i.id} data-testid="team-invite-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: k < invites.length - 1 ? "1px solid " + T.bg3 : "none", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{i.email}</div>
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>
              Invited {displayDate(civilDayOf(new Date(i.createdAt)))}{i.invitedBy ? ` by ${i.invitedBy}` : ""} · {i.expired ? "the link has expired" : `the link works until ${displayDate(civilDayOf(new Date(i.expiresAt)))}`}
            </div>
          </div>
          <Pill label={i.role === "volunteer_coordinator" ? "volunteer coordinator" : i.role} color={T.ink3} />
          <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
            <button type="button" style={link} disabled={busy === i.id} onClick={() => resend(i)}>Resend</button>
            <button type="button" style={link} onClick={() => copy(i)}>Copy link</button>
            <button type="button" data-testid="team-invite-revoke" style={{ ...link, color: T.ink2 }} disabled={busy === i.id} onClick={() => revoke(i)}>Revoke</button>
          </span>
        </div>
      ))}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink, marginTop: 8, wordBreak: "break-all" }}>{msg}</div>}
    </div>
  );
}

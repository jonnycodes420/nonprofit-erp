// client/src/components/settings/InvitedList.jsx · WALKB-2 item 1. THE
// INVITES YOU SENT, UNDER TEAM.
//
// A Staff invite used to vanish once made: the Team list read only people
// who had accepted, so the invite showed nowhere but the Audit log. Each
// pending invite is a row here with its role and date, and Resend, Copy link
// and Revoke (server/org/invites.js).
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { useChanged } from "../../lib/changes";   // FLOWS-13 item 1: an invite made or revoked anywhere re-reads the list
import { T, Pill, SectionLabel } from "../shared";
import { askConfirm } from "../ConfirmDialog";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import { civilDayOf } from "../../lib/orgToday";   // the org's day, never the UTC one
import { roleWord } from "../../../../shared/viewOnly.js";   // ACCESS-1

const link = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontSize: 12, fontFamily: "inherit" };

export function InvitedList({ isAdmin, version = 0 }) {
  const [invites, setInvites] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  // HONEST-2 item 4 (W-1126-Settings-01): a revoked invite stayed on screen with greyed buttons. The
  // row goes the moment the revoke answers, and a read that started before it can't put it back: only
  // the latest read lands, and a revoked id stays gone for the life of the list.
  const seq = useRef(0);
  const gone = useRef(new Set());
  const load = () => { const n = ++seq.current;
    return apiFetch("/org/invites").then(r => { if (n === seq.current) setInvites(((r && r.invites) || []).filter(x => !gone.current.has(x.id))); })
      .catch(() => { if (n === seq.current) setInvites([]); }); };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, version]);
  useChanged(["org"], () => { if (isAdmin) load(); });
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
    try { const r = await apiFetch(`/org/invites/${encodeURIComponent(i.id)}`, { method: "DELETE" });
      gone.current.add(i.id); setInvites(list => (list || []).filter(x => x.id !== i.id)); setBusy(""); setMsg(r.message || ""); await load(); }
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
            {/* COMMS-1: the email itself: not sent, or it bounced. */}
            {i.bounced
              ? <div data-testid="team-invite-bounced" style={{ fontSize: 11, color: T.gold700, fontWeight: 700, marginTop: 1 }}>The invite email to {i.email} bounced. Check the address, or copy the link and send it another way.</div>
              : !i.lastSentAt && <div data-testid="team-invite-unsent" style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>The email hasn't gone yet. Resend it, or copy the link.</div>}
          </div>
          <Pill label={roleWord(i.role)} color={T.ink3} />
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

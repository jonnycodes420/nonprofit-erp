// client/src/components/AgentDraftsWaiting.jsx · WIRE-1-ADDENDUM, COMMS-1 item 4.
// Atlas's drafts in Drafts to review: how many wait, Review all in a row, and
// (COMMS-1) each one as a row with Read the draft and its own ×.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { atlasName } from "../lib/atlas";
import { AgentDraftReview, agentDraftsIn } from "./AgentDraftReview";
import { dismissDrafts, DismissX, SelectBox } from "./DraftDismiss";
import { useChangeRev } from "../lib/changes";
import { errorMessage } from "../lib/domainError";

export function AgentDraftsWaiting({ highlightDraftId = null, selection = null }) {
  const [items, setItems] = useState(null);
  // AGENT-5: Atlas's "Review and send" opens its draft here, ready to read.
  const [open, setOpen] = useState(() => /^adr_/.test(String(highlightDraftId || "")));
  const rev = useChangeRev(["draft"]);   // COMMS-1: a dismiss anywhere re-reads
  const load = () => apiFetch("/agent/waiting").then(w => setItems(agentDraftsIn(w))).catch(() => setItems([]));
  useEffect(() => { load(); }, [rev]);   // eslint-disable-line react-hooks/exhaustive-deps
  const n = (items || []).length;
  if (!n) return null;
  // COMMS-1: each Atlas draft is a row with its own ×.
  return (
    <div data-testid="agent-drafts-waiting" style={{ marginTop: 12, background: T.bg2, borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, color: T.ink }}>{n === 1 ? `One note ${atlasName()} drafted is` : `${n} notes ${atlasName()} drafted are`} waiting for you.</span>
        <button onClick={() => setOpen(true)} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Review all {n}</button>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(it => (
          <div key={it.id} data-testid="agent-draft-row" data-draft={it.id} style={{ display: "flex", alignItems: "center", gap: 10, background: T.white, borderRadius: 8, padding: "8px 10px", flexWrap: "wrap" }}>
            {selection && selection.selecting && <SelectBox checked={selection.has("agent", it.id)} onChange={on => selection.toggle("agent", it.id, on)} label={`Select the draft to ${it.who}`} />}
            <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, color: T.ink }}><b>{it.who}</b>{it.subject ? ` · ${it.subject}` : ""}</div>
            <button type="button" onClick={() => setOpen(true)} style={{ background: T.white, border: "1px solid " + T.ink, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: T.ink }}>Read the draft</button>
            <DismissX onClick={() => dismissDrafts([{ kind: "agent", id: it.id }]).then(() => load()).catch(e => alert(errorMessage(e)))} label={`Dismiss the draft to ${it.who}`} />
          </div>
        ))}
      </div>
      {open && <AgentDraftReview onClose={() => { setOpen(false); load(); }} onChanged={load} />}
    </div>
  );
}


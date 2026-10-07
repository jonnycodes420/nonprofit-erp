// AgentDraftReview.jsx · WIRE-1-ADDENDUM item 2. REVIEW ALL, IN A ROW.
//
// "Draft a thank-you to every donor who gave this month" made twenty-one
// drafts, and the only way through them was twenty-one separate yeses in a
// queue that mixed them with everything else. This is one view that walks the
// drafts one person at a time: read it, approve it (or skip it), and the next
// one is in front of you. Approving a thank-you marks the gifts it thanks as
// thanked; Steward still sends nothing. Each approve and skip offers the shared
// Undo toast, which puts the draft back exactly as it was.
//
// `instructionId` narrows it to one plan's drafts; without it, every Agent
// draft waiting in the org.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { offerUndo } from "./EditHistory";
import { DonorLink } from "./RecordLink";
import { errorMessage } from "../lib/domainError";

const BTN = { border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const YES = { ...BTN, background: T.greenDk, color: T.white };
const QUIET = { ...BTN, background: T.white, color: T.ink, border: "1px solid " + T.bg2 };

export function agentDraftsIn(waiting, instructionId = null) {
  return ((waiting && waiting.items) || []).filter(it => it.kind === "agent_draft" && (!instructionId || it.instructionId === instructionId));
}

export function AgentDraftReview({ instructionId = null, onClose, onChanged }) {
  const [items, setItems] = useState(null);
  const [at, setAt] = useState(0);
  const [done, setDone] = useState({});        // id -> "approved" | "skipped"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => apiFetch("/agent/waiting")
    .then(w => setItems(agentDraftsIn(w, instructionId)))
    .catch(e => { setItems([]); setErr(errorMessage(e, "The drafts could not be read just now.")); }), [instructionId]);
  useEffect(() => { load(); }, [load]);

  const list = items || [];
  const total = list.length;
  const it = list[at] || null;
  const settledCount = Object.keys(done).length;

  async function act(action) {
    if (!it || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/agent/waiting/agent_draft/${it.id}/${action}`, { method: "POST", body: "{}" });
      const id = it.id;
      setDone(m => ({ ...m, [id]: action === "approve" ? "approved" : "skipped" }));
      offerUndo({ message: (r && r.sentence) || (action === "approve" ? "Approved." : "Skipped."), undoAction: async () => {
        const y = await apiFetch(`/agent/waiting/agent_draft/${id}/reopen`, { method: "POST", body: "{}" });
        setDone(m => { const n = { ...m }; delete n[id]; return n; });
        onChanged && onChanged();
        return y;
      } }, "draft");
      onChanged && onChanged();
      // The next one still waiting, after this one; else the first left.
      const nextIdx = list.findIndex((x, i) => i > at && !done[x.id] && x.id !== id);
      const anyIdx = list.findIndex(x => !done[x.id] && x.id !== id);
      if (nextIdx >= 0) setAt(nextIdx); else if (anyIdx >= 0) setAt(anyIdx);
    } catch (e) { setErr(errorMessage(e, "That did not go through. Nothing was changed.")); }
    setBusy(false);
  }

  const state = it ? done[it.id] : null;
  const allDone = total > 0 && settledCount >= total;
  return (
    <Modal onClose={onClose} width={640} ariaLabel="Review the drafts"
      title={total ? `Review all ${total}` : "Review the drafts"}
      subtitle={total ? `${settledCount} of ${total} reviewed. Approving a thank-you marks its gift thanked. Nothing is sent.` : null}>
      <div data-testid="agent-draft-review">
        {items === null && <p style={{ color: T.ink3 }}>Reading the drafts…</p>}
        {items !== null && !total && <p style={{ color: T.ink3 }}>No drafts are waiting for you.</p>}
        {allDone && <p data-testid="review-all-done" style={{ color: T.ink, fontWeight: 700 }}>All {total} reviewed. Each one is on its person's record.</p>}
        {it && !allDone && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: T.ink3, fontWeight: 700 }}>{at + 1} of {total}</div>
              <DonorLink id={it.donorId}>{it.who}</DonorLink>
            </div>
            {it.subject && <div style={{ fontWeight: 700, margin: "10px 0 6px", overflowWrap: "anywhere" }}>{it.subject}</div>}
            <div data-testid="review-body" style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 15, background: T.bg2, borderRadius: 10, padding: "14px 16px", maxHeight: "45vh", overflowY: "auto", overflowWrap: "anywhere" }}>{it.body}</div>
            {state && <p style={{ margin: "10px 0 0", color: T.ink3 }}>{state === "approved" ? "Approved." : "Skipped."}</p>}
            {err && <p role="alert" style={{ margin: "10px 0 0", color: T.ink }}>{err}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button data-testid="review-approve" style={{ ...YES, opacity: busy || state ? 0.6 : 1 }} disabled={busy || !!state} onClick={() => act("approve")}>Approve and next</button>
              <button data-testid="review-skip" style={QUIET} disabled={busy || !!state} onClick={() => act("skip")}>Skip</button>
              <span style={{ flex: 1 }} />
              <button style={QUIET} disabled={at <= 0} onClick={() => setAt(a => Math.max(0, a - 1))}>Previous</button>
              <button style={QUIET} disabled={at >= total - 1} onClick={() => setAt(a => Math.min(total - 1, a + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

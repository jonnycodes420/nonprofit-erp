// client/src/components/DraftDismiss.jsx · COMMS-1 item 4. EVERY DRAFT CAN BE
// DISMISSED.
//
// The × on a draft's row asks once, archives it (POST /drafts/dismiss; never a
// delete, server/drafts/dismiss.js) and offers the shared Undo toast, which
// restores it. Select mode dismisses many at once. "Dismissed (n)" at the foot
// of Drafts to review lists what was dismissed, each with Restore; nothing
// comes back on its own. Every dismiss and restore is a write to /drafts,
// which STALE-1 announces as the "draft" kind (lib/changes.js), so Home's
// "waiting for you", the bell and the Atlas banner re-read at once.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { offerUndo } from "./EditHistory";
import { errorMessage } from "../lib/domainError";
import { useChangeRev } from "../lib/changes";

const THANK_YOUS_CHANGED = "steward:thank-yous-changed";
const bump = () => { try { window.dispatchEvent(new Event(THANK_YOUS_CHANGED)); } catch { /* no window */ } };

// drafts: [{ kind: "milestone" | "agent" | "thank_you", id }]. Resolves true once dismissed.
export async function dismissDrafts(drafts, { onRestored } = {}) {
  const list = (drafts || []).filter(d => d && d.id && d.kind);
  if (!list.length) return false;
  const one = list.length === 1;
  const yes = await askConfirm(one
    ? { title: "Dismiss this draft?", body: "It won't be sent.", yes: "Dismiss" }
    : { title: `Dismiss ${list.length} drafts?`, body: "They won't be sent.", yes: "Dismiss" });
  if (!yes) return false;
  const r = await apiFetch("/drafts/dismiss", { method: "POST", body: JSON.stringify({ drafts: list }) });
  bump();
  const done = (r && r.dismissed) || list;
  offerUndo({ message: (r && r.sentence) || "Dismissed.", undoAction: async () => {
    const y = await apiFetch("/drafts/restore", { method: "POST", body: JSON.stringify({ drafts: done }) });
    bump();
    if (onRestored) onRestored(y);
    return y;
  } }, one ? "draft" : "drafts");
  return true;
}

export function DismissX({ onClick, label = "Dismiss this draft", disabled, testid = "draft-dismiss" }) {
  return (
    <button type="button" data-testid={testid} aria-label={label} title={label} disabled={disabled} onClick={onClick}
      style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, width: 30, height: 30, flexShrink: 0, cursor: "pointer",
        color: T.ink3, fontSize: 16, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
      {"×"}
    </button>
  );
}

// "Select" turns checkboxes on; "Dismiss selected" dismisses them together.
export function SelectBar({ selecting, setSelecting, selected, onDismiss, total, testid = "drafts-select" }) {
  if (!total) return null;
  const n = selected.length;
  const btn = { background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: T.ink, fontFamily: "inherit" };
  return (
    <div data-testid={testid} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {!selecting
        ? <button type="button" data-testid={testid + "-on"} style={btn} onClick={() => setSelecting(true)}>Select</button>
        : <>
            <button type="button" data-testid={testid + "-dismiss"} disabled={!n} onClick={onDismiss}
              style={{ ...btn, background: n ? T.greenDk : T.white, color: n ? T.white : T.ink3, border: "1px solid " + (n ? T.greenDk : T.bg3) }}>
              Dismiss selected{n ? ` (${n})` : ""}
            </button>
            <button type="button" style={btn} onClick={() => setSelecting(false)}>Done</button>
          </>}
    </div>
  );
}

export function SelectBox({ checked, onChange, label }) {
  return <input type="checkbox" data-testid="draft-select" aria-label={label} checked={!!checked} onChange={e => onChange(e.target.checked)}
    style={{ width: 18, height: 18, flexShrink: 0, accentColor: T.greenDk, cursor: "pointer" }} />;
}

// A selection kept as a Set of "kind:id" keys.
export function useSelection() {
  const [selecting, setSelectingRaw] = useState(false);
  const [keys, setKeys] = useState(() => new Set());
  const setSelecting = v => { setSelectingRaw(v); if (!v) setKeys(new Set()); };
  const toggle = (kind, id, on) => setKeys(s => { const n = new Set(s); const k = kind + ":" + id; if (on) n.add(k); else n.delete(k); return n; });
  const has = (kind, id) => keys.has(kind + ":" + id);
  const list = [...keys].map(k => { const i = k.indexOf(":"); return { kind: k.slice(0, i), id: k.slice(i + 1) }; });
  return { selecting, setSelecting, toggle, has, list, clear: () => setKeys(new Set()) };
}

const KIND_WORD = { milestone: "Milestone or journey draft", agent: "Atlas draft", thank_you: "Thank-you" };

// "Dismissed (n)" and its list, each with Restore.
export function DismissedDrafts() {
  const rev = useChangeRev(["draft"]);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/drafts/dismissed").then(setData).catch(() => setData({ drafts: [], count: 0 }));
  useEffect(() => { load(); }, [rev]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !data.count) return null;
  const restore = async d => {
    setMsg("");
    try { const r = await apiFetch("/drafts/restore", { method: "POST", body: JSON.stringify({ drafts: [{ kind: d.kind, id: d.id }] }) }); bump(); setMsg(r.sentence || ""); await load(); }
    catch (e) { setMsg(errorMessage(e, "That draft was not restored.")); }
  };
  return (
    <div data-testid="drafts-dismissed" style={{ marginTop: 8 }}>
      <button type="button" data-testid="drafts-dismissed-open" aria-expanded={open} onClick={() => setOpen(v => !v)}
        style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
        Dismissed ({data.count})
      </button>
      {open && (
        <div style={{ marginTop: 8, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10 }}>
          {data.drafts.map((d, i) => (
            <div key={d.kind + d.id} data-testid="drafts-dismissed-row" style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: i ? "1px solid " + T.bg2 : "none", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13, color: T.ink }}>
                <b>{d.who}</b>{d.subject ? ` · ${d.subject}` : ""}
                <div style={{ fontSize: 11.5, color: T.ink3 }}>{KIND_WORD[d.kind]} · dismissed {new Date(d.archivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{d.by ? ` by ${d.by}` : ""}</div>
              </div>
              <button type="button" data-testid="drafts-restore" onClick={() => restore(d)}
                style={{ background: T.white, border: "1px solid " + T.ink, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: T.ink, fontFamily: "inherit" }}>Restore</button>
            </div>
          ))}
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

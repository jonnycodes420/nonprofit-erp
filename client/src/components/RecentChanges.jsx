// FIX-45 · RECENT CHANGES. This person's last 50 changes that can still be
// undone, each with Undo, from the profile menu and from the toast's "See all".
//
// The rows come from the server (GET /recent-changes: the trash, a skipped To
// confirm card, a person added by hand), plus any undo this tab offered that
// only the screen could rebuild (lib/recentUndo.js). Each Undo runs against
// the row as it is NOW on the server, never against what a screen drew before,
// and every screen that listens for UNDONE reloads afterwards.
import { retryImport } from "../lib/lazyRetry";
// AGENT-5: the Agent page's What changed. SWEEP-6: loaded when it is shown.
const WhatChanged = lazy(() => retryImport(() => import("./WhatChanged")).then(m => ({ default: m.WhatChanged })));
import { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { sessionOffers, markUndone, announceUndone } from "../lib/recentUndo";

const linkBtn = { background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" };

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function until(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return "";
  if (s < 3600) return `Undo for ${Math.max(1, Math.round(s / 60))} more min`;
  if (s < 86400) return `Undo for ${Math.round(s / 3600)} more h`;
  return `Undo until ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function RecentChangesPanel({ onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});

  const [showChanged, setShowChanged] = useState(false);
  // AGENT-5: what Atlas did is in this list too, from its activity log, and
  // the Agent page's "What changed" (what each import told us) sits below.
  const load = () => Promise.all([apiFetch("/recent-changes"), apiFetch("/atlas/activity").catch(() => ({ items: [] }))])
    .then(([r, a]) => {
      const atlas = (a.items || []).filter(x => x.undoable).map(x => ({ id: x.id, kind: "atlas", sentence: `${x.by}: ${x.line}`, at: x.at, from: "server",
        undo: { path: `/atlas/actions/${x.id}/undo`, method: "POST", body: {} } }));
      const server = [...(r.rows || []).map(x => ({ ...x, from: "server" })), ...atlas];
      const tab = sessionOffers().map(o => ({ id: o.id, sentence: o.sentence, at: o.at, until: o.until, from: "tab", entry: o }));
      setRows([...tab, ...server].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50));
      setErr("");
    })
    .catch(e => { setRows([]); setErr(errorMessage(e, "Recent changes did not load.")); });
  useEffect(() => { load(); }, []);

  const undo = async row => {
    if (busy) return;
    setBusy(row.id); setErr("");
    try {
      if (row.from === "tab") await row.entry.action();
      else await apiFetch(row.undo.path, { method: row.undo.method, ...(row.undo.body ? { body: JSON.stringify(row.undo.body) } : {}) });
      if (row.entry) markUndone(row.entry);
      setDone(d => ({ ...d, [row.id]: true }));
      announceUndone({ id: row.id });
    } catch (e) { setErr(errorMessage(e, "That could not be put back. It may have changed since.")); }
    setBusy(null);
  };

  return (
    <Modal onClose={onClose} title="Recent changes" subtitle="Your last 50 changes that can still be undone. Each Undo puts back what is there now."
      width={560} zIndex={450} ariaLabel="Recent changes">
      <div data-testid="recent-changes" style={{ display: "flex", flexDirection: "column" }}>
        {err && <div role="status" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, marginBottom: 10 }}>{err}</div>}
        {!rows && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>}
        {rows && !rows.length && !err && (
          <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>Nothing to undo. When you remove, skip or add something, it shows here for as long as it can still be put back.</div>
        )}
        {rows && rows.map((r, i) => (
          <div key={r.id} data-testid="recent-change" data-kind={r.kind || "tab"}
            style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: i ? "1px solid " + T.bg2 : "none", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.sentence}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>{ago(r.at)}{r.until && !done[r.id] ? ` · ${until(r.until)}` : ""}</div>
            </div>
            {done[r.id]
              ? <span data-testid="recent-change-done" style={{ fontSize: 12.5, color: T.ink3 }}>Put back.</span>
              : <button type="button" data-testid="recent-change-undo" disabled={!!busy} onClick={() => undo(r)}
                  style={{ ...linkBtn, color: T.greenDk, fontWeight: 800, fontSize: 13 }}>{busy === r.id ? "Putting back…" : (r.undoLabel || "Undo")}</button>}
          </div>
        ))}
        <div style={{ borderTop: "1px solid " + T.bg3, marginTop: 10, paddingTop: 10 }}>
          <button type="button" data-testid="recent-what-changed" onClick={() => setShowChanged(v => !v)} style={{ ...linkBtn, color: T.greenDk, fontWeight: 800, fontSize: 13 }}>
            {showChanged ? "Hide" : "Show"} what your imports changed</button>
          {showChanged && <div style={{ marginTop: 10 }}><Suspense fallback={null}><WhatChanged isReadOnly={false} wide={false}
            onNavigate={(t, o) => { onClose(); window.dispatchEvent(new CustomEvent("steward:go", { detail: { tab: t, opts: o } })); }} /></Suspense></div>}
        </div>
      </div>
    </Modal>
  );
}

// From anywhere (the profile menu, the toast): one host on document.body.
let hostSet = null;
function RecentHost() {
  const [open, setOpen] = useState(0);
  useEffect(() => { hostSet = setOpen; return () => { hostSet = null; }; }, []);
  return open ? <RecentChangesPanel key={open} onClose={() => setOpen(0)} /> : null;
}
let mounted = false;
export function openRecentChanges() {
  if (typeof document === "undefined") return;
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.setAttribute("data-recent-host", "");
    document.body.appendChild(el);
    createRoot(el).render(<RecentHost />);
  }
  const go = () => (hostSet ? hostSet(Date.now()) : setTimeout(go, 20));
  go();
}

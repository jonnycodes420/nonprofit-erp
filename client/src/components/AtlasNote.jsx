// AtlasNote.jsx · AGENT-5. A SMALL NOTE WHERE ATLAS ACTED, AND THE BELL.
//
// AtlasNote sits at the top of a page (Events, Journeys, Communications, the
// gifts To confirm, a donor's profile and Home) and shows what Atlas did there
// that nobody has seen yet, signed, with Undo where it can be undone, and
// anything still waiting for a tap. Once shown it is marked seen (a POST: the
// read never changes anything) and fades; what waits stays until answered.
// AtlasBell is the header's bell: everything newest first, each line opening
// its place, and a count of only what waits on a person. Both read one table,
// atlas_actions (routes/atlas.js).
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { useStewardTold, told } from "../lib/stewardTold";
import { noteServerChanges, useChanged } from "../lib/changes";   // STALE-1
// COMMS-1 item 4: the dismiss flow loads on the first × (Home's first look stays within perf-app's budget).
const dismissDrafts = (...a) => import("./DraftDismiss").then(m => m.dismissDrafts(...a));
import { linkTarget, followLink, useAtlasName } from "../lib/atlas";
import { openTellSteward } from "./TellStewardOpen";   // ATLAS-5: Answer opens the question still asking

const TAP = { gift: "Record", pledge: "Record", receipt: "Send both", held_back: "Keep as a note" };
const small = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", minHeight: 30, fontFamily: "inherit" });

// "Marked Undine..." reads "Atlas marked Undine..."; anything else ("Harbor
// Run is on Dec 30...", "$10,000 gift...") keeps its words after a colon.
const VERB = /^(Marked|Added|Drafted|Logged|Noted|Took|Recorded|Sent|Kept|Undid)\b/;
const lower = s => { const t = String(s || ""); return VERB.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };

// COMMS-1: a line asking for a draft's review ("Drafted an email to Marlowe")
// names that draft; its × dismisses the draft itself (server/drafts/dismiss.js).
const draftOf = n => (n && n.kind === "draft" && n.waits && n.link && n.link.draftId ? String(n.link.draftId) : null);
// ATLAS-5 (W-1108-Atlas-08X): every other waiting line can be let go. A
// proposal is discarded (nothing written), a tap is its card's No, an
// unanswered question is closed.
const letGoPath = n => (!n || !n.waits || draftOf(n) ? null : n.kind === "question" ? `/atlas/${encodeURIComponent(n.requestId)}/dismiss-question` : `/atlas/actions/${encodeURIComponent(n.id)}/dismiss`);
const DISMISS_SAYS = { proposal: "Discard this proposal (nothing is saved)", question: "Dismiss this question", held_back: "Discard this detail" };

function NoteLine({ n, onAct, onOpen, busy, onDismiss, onAnswer }) {
  return (
    <div data-testid="atlas-note" data-kind={n.kind} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5, color: T.ink, lineHeight: 1.45 }}>
      <span style={{ flex: "1 1 240px", minWidth: 0 }}>
        <b>{n.by}</b>{VERB.test(String(n.line || "")) ? " " : ": "}
        {onOpen && linkTarget(n.link)
          ? <button type="button" onClick={() => onOpen(n.link)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, textAlign: "left", cursor: "pointer", textDecoration: "underline", textDecorationColor: T.bg3, textUnderlineOffset: 3 }}>{lower(n.line)}</button>
          : lower(n.line)}
      </span>
      {n.undoable && <button type="button" data-testid="atlas-note-undo" disabled={busy} onClick={() => onAct(`/atlas/actions/${n.id}/undo`)} style={small(false)}>Undo</button>}
      {n.waits && TAP[n.kind] && <button type="button" data-testid="atlas-note-tap" disabled={busy} onClick={() => onAct(`/atlas/actions/${n.id}/yes`)} style={small(true)}>{TAP[n.kind]}</button>}
      {n.waits && n.kind === "question" && onAnswer && <button type="button" data-testid="atlas-note-answer" disabled={busy} onClick={() => onAnswer(n)} style={small(true)}>Answer</button>}
      {letGoPath(n) && <button type="button" data-testid="atlas-note-letgo" aria-label={DISMISS_SAYS[n.kind] || "Dismiss"} title={DISMISS_SAYS[n.kind] || "Dismiss"} disabled={busy} onClick={() => onAct(letGoPath(n))}
        style={{ ...small(false), minWidth: 30 }}>Dismiss</button>}
      {onDismiss && draftOf(n) && <button type="button" data-testid="atlas-note-dismiss" aria-label="Dismiss this draft" title="Dismiss this draft" disabled={busy} onClick={() => onDismiss([n])}
        style={{ ...small(false), width: 30, padding: 0, color: T.ink3, fontSize: 16, lineHeight: 1 }}>{"\u00d7"}</button>}
    </div>
  );
}

export function AtlasNote({ place, id = null, onNavigate, style }) {
  const [notes, setNotes] = useState([]);
  const [fading, setFading] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const load = () => apiFetch(`/atlas/notes?place=${encodeURIComponent(place)}${id ? `&id=${encodeURIComponent(id)}` : ""}`)
    .then(r => { setNotes(r.notes || []); setFading(false); }).catch(() => setNotes([]));
  useEffect(() => { load(); return () => clearTimeout(timer.current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [place, id]);
  useStewardTold(() => load());
  useChanged(["draft"], () => load());   // COMMS-1: a draft dismissed anywhere leaves the banner
  // Seen once it is on the screen; what does not wait fades a few seconds later.
  useEffect(() => {
    const unseen = notes.filter(n => !n.seenAt).map(n => n.id);
    if (!unseen.length) return;
    apiFetch("/atlas/notes/seen", { method: "POST", body: JSON.stringify({ ids: unseen }) }).catch(() => {});
    if (notes.every(n => !n.waits)) { clearTimeout(timer.current); timer.current = setTimeout(() => setFading(true), 9000); }
  }, [notes]);
  if (!notes.length) return null;
  const act = async path => {
    setBusy(true);
    try { await apiFetch(path, { method: "POST", body: "{}" }); told(); await load(); } catch { /* the line stays as it was */ }
    setBusy(false);
  };
  const open = onNavigate ? link => { const t = followLink(link); if (t) onNavigate(t[0], t[1]); } : null;
  const shown = fading ? notes.filter(n => n.waits) : notes;
  const dismiss = async lines => {
    setBusy(true);
    try { if (await dismissDrafts(lines.map(n => ({ kind: "agent", id: draftOf(n) })), { onRestored: () => load() })) await load(); }
    catch { /* the lines stay as they were */ }
    setBusy(false);
  };
  const draftLines = (shown.length ? shown : notes).slice(0, 6).filter(draftOf);
  return (
    <div data-testid="atlas-notes" data-place={place} style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.greenDk, borderRadius: 10,
      padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, transition: "opacity 1.2s", opacity: fading && !shown.length ? 0 : 1, margin: "0 0 14px", ...style }}>
      {(shown.length ? shown : notes).slice(0, 6).map(n => <NoteLine key={n.id} n={n} busy={busy} onAct={act} onOpen={open} onDismiss={dismiss} />)}
      {draftLines.length >= 2 && (
        <div><button type="button" data-testid="atlas-note-dismiss-all" disabled={busy} onClick={() => dismiss(draftLines)} style={small(false)}>Dismiss all {draftLines.length}</button></div>
      )}
    </div>
  );
}

// ── THE BELL ────────────────────────────────────────────────────────────────
// PERF-2: two bells are mounted, the desktop bar's and the phone header's (one
// hidden by CSS), and the read Home parks for them is handed over once. They
// share the read that is in flight, so a phone does not wait on a second.
let bellRead = null;
// STALE-1: its answer carries the org's latest change marks, and a table the
// worker (or anyone) moved since the last answer is announced (lib/changes.js).
const readBell = () => bellRead || (bellRead = apiFetch("/atlas/activity").then(r => { noteServerChanges(r && r.changes); return r; }).finally(() => { bellRead = null; }));
export function AtlasBell({ onNavigate }) {
  const name = useAtlasName();
  const [data, setData] = useState({ waiting: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bellRef = useRef(null);
  const closeRef = useRef(null);
  const load = () => readBell().then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useStewardTold(() => load());
  useChanged(["draft"], c => { if (c.source !== "worker") load(); });   // COMMS-1: the count drops at once
  // ATLAS-5 (W-1108-Atlas-08): the panel closes with Escape, its ×, and a click
  // anywhere outside it (the header included), and focus goes back to the bell.
  const close = () => { setOpen(false); setTimeout(() => { if (bellRef.current) bellRef.current.focus(); }, 0); };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onDown = e => { const panel = document.querySelector('[data-testid="atlas-bell-list"]'); if (panel && !panel.contains(e.target) && !(bellRef.current && bellRef.current.contains(e.target))) close(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    setTimeout(() => { if (closeRef.current) closeRef.current.focus(); }, 0);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown, true); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const act = async path => { setBusy(true); try { await apiFetch(path, { method: "POST", body: "{}" }); told(); await load(); } catch { /* unchanged */ } setBusy(false); };
  const go = link => { const t = followLink(link); if (t && onNavigate) { setOpen(false); onNavigate(t[0], t[1]); } };
  const answer = n => { setOpen(false); openTellSteward(null, { requestId: n.requestId }); };
  const n = data.waiting || 0;
  return (
    <div style={{ position: "relative" }}>
      <button ref={bellRef} type="button" data-testid="atlas-bell" aria-label={n ? `${name}: ${n} waiting for you` : `What ${name} did`} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}
        style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: 6, color: "inherit", display: "inline-flex" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && <span data-testid="atlas-bell-count" style={{ position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, background: "#C9A84C", color: T.ink, fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{n}</span>}
      </button>
      {open && <div data-testid="atlas-bell-list" role="dialog" aria-label={`What ${name} did`}
          style={{ position: "fixed", right: 16, top: 58, zIndex: 391, width: "min(380px, calc(100vw - 32px))", maxHeight: "70vh", overflowY: "auto",
            background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 12, boxShadow: "0 12px 32px rgba(15,26,18,0.18)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3 }}>{name}{n ? ` · ${n} waiting for you` : ""}</div>
            <button ref={closeRef} type="button" data-testid="atlas-bell-close" aria-label="Close" title="Close (Esc)" onClick={close}
              style={{ background: "none", border: "none", cursor: "pointer", color: T.ink2, fontSize: 20, lineHeight: 1, padding: "2px 6px", minWidth: 32, minHeight: 32 }}>{"\u00d7"}</button>
          </div>
          {!data.items.length && <div style={{ fontSize: 13.5, color: T.ink3 }}>Nothing yet. Tell {name} what happened and it shows here.</div>}
          {data.items.map(it => (
            <div key={it.id} data-testid="atlas-bell-item" data-kind={it.kind} data-waits={it.waits ? "1" : "0"} style={{ padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
              <NoteLine n={it} busy={busy} onAct={act} onOpen={go} onAnswer={answer} />
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{new Date(it.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{it.state === "undone" ? " · undone" : it.state === "discarded" ? " · discarded" : ""}</div>
            </div>))}
        </div>}
    </div>
  );
}

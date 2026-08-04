// Pipeline.jsx — Moves management & prospect pipeline (BUILD-15, Team plan).
// The major-gifts spine: a Kanban board by stage, cards color-coded by
// officer, filterable by portfolio + designation, with the open-ask forecast.
// A move requires a description (enforced in MoveModal). Full ask/gift + move
// history lives on the DonorProfile (see Donors.jsx). Core orgs get a graceful
// upgrade state, not a broken tab.
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, EmptyState, fmt, fmtFull, interactive, LockedFeature, goToPricing } from "./shared";

// Forward major-gifts pipeline + trailing re-engagement column. Mirrors
// server's ALL_PIPELINE_STAGES ordering.
const STAGE_META = [
  { id: "prospect", label: "Prospect", hint: "Identification" },
  { id: "qualify", label: "Qualify", hint: "Qualification" },
  { id: "cultivate", label: "Cultivate", hint: "Cultivation" },
  { id: "solicit", label: "Solicit", hint: "Solicitation" },
  { id: "steward", label: "Steward", hint: "Stewardship" },
  { id: "lapsed", label: "Lapsed", hint: "Re-engage" },
];
const DESIGNATIONS = [["", "All designations"], ["planned_confirmed", "Planned gift confirmed"], ["planned_prospect", "Planned-giving prospect"], ["estate", "Estate giving"]];

function initials(name) { return (name || "?").trim()[0]?.toUpperCase() || "?"; }

// ── Move modal — the description is REQUIRED (server enforces too) ──────────
function MoveModal({ card, onClose, onMoved }) {
  const [toStage, setToStage] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!toStage) { setErr("Pick a stage."); return; }
    if (!desc.trim()) { setErr("Describe what happened in this move."); return; }
    setBusy(true); setErr("");
    try {
      await apiFetch(`/pipeline/${card.donorId}/move`, { method: "POST", body: JSON.stringify({ toStage, description: desc.trim() }) });
      onMoved();
    } catch (e) { setErr(e.message || "Could not save move."); setBusy(false); }
  };
  const inp = { width: "100%", padding: "9px 11px", border: `1px solid ${T.bg3}`, borderRadius: T.radiusSm, fontSize: 14, fontFamily: "'DM Sans',sans-serif", boxSizing: "border-box" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgCard, borderRadius: T.radiusLg, padding: 24, width: "100%", maxWidth: 460, boxShadow: T.shadowLg }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 22, color: T.ink }}>Move {card.name}</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 16 }}>Currently in <strong style={{ color: T.ink }}>{STAGE_META.find(s => s.id === card.stage)?.label || card.stage}</strong>. Every move is logged with your name and note.</div>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".04em" }}>Move to stage</label>
        <select value={toStage} onChange={e => setToStage(e.target.value)} style={{ ...inp, marginTop: 6, marginBottom: 14 }}>
          <option value="">Choose a stage…</option>
          {STAGE_META.filter(s => s.id !== card.stage).map(s => <option key={s.id} value={s.id}>{s.label} — {s.hint}</option>)}
        </select>
        <label style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".04em" }}>What happened <span style={{ color: T.terracotta }}>*</span></label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="e.g. Coffee with the board chair — ready to talk about a leadership gift." style={{ ...inp, marginTop: 6, resize: "vertical" }} />
        {err && <div style={{ color: T.terracotta, fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${T.bg3}`, borderRadius: T.radiusSm, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: T.ink }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ background: T.greenMid, border: "none", borderRadius: T.radiusSm, padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Log move"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Drop note — the ONE-field prompt a drag opens (BUILD-30 Part 3) ─────────
// A move STILL requires a description (BUILD-15) so the Week-in-Review and the
// per-officer reports aren't hollowed out — we never silently log an empty move.
// Pre-filled with from→to; Enter saves, Esc cancels (which rolls the card back).
function DropNotePrompt({ card, fromStage, toStage, onSave, onCancel }) {
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fromL = STAGE_META.find(s => s.id === fromStage)?.label || fromStage;
  const toL = STAGE_META.find(s => s.id === toStage)?.label || toStage;
  const submit = () => {
    if (!desc.trim()) { setErr("Add a one-line note — every move is logged."); return; }
    setBusy(true); setErr("");
    onSave(desc.trim()); // parent owns the request + closes / rolls back
  };
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,.55)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bgCard, borderRadius: T.radiusLg, padding: 22, width: "100%", maxWidth: 440, boxShadow: T.shadowLg }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink }}>{card.name}</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 14 }}>
          <strong style={{ color: T.ink }}>{fromL}</strong> <span style={{ color: T.gold600 }}>→</span> <strong style={{ color: T.ink }}>{toL}</strong> · every move is logged with your note.
        </div>
        <input autoFocus value={desc} onChange={e => setDesc(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } else if (e.key === "Escape") onCancel(); }}
          placeholder={`Why ${card.name} moved to ${toL}…`}
          style={{ width: "100%", padding: "10px 12px", border: `1px solid ${T.bg3}`, borderRadius: T.radiusSm, fontSize: 14, fontFamily: "'DM Sans',sans-serif", boxSizing: "border-box" }} />
        {err && <div style={{ color: T.terracotta, fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button onClick={onCancel} style={{ background: "none", border: `1px solid ${T.bg3}`, borderRadius: T.radiusSm, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: T.ink }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ background: T.greenMid, border: "none", borderRadius: T.radiusSm, padding: "8px 18px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Save move ↵"}</button>
        </div>
      </div>
    </div>
  );
}

function ProspectCard({ card, colorMap, onOpen, onMove, isReadOnly, dndEnabled, dragging, onDragStart, onDragEnd }) {
  const color = colorMap[card.assignedTo] || null;
  return (
    <div
      draggable={dndEnabled}
      onDragStart={dndEnabled ? e => onDragStart(e, card) : undefined}
      onDragEnd={dndEnabled ? onDragEnd : undefined}
      style={{ background: T.bgCard, borderRadius: T.radiusSm, border: `1px solid ${T.bg2}`, borderLeft: `3px solid ${color || T.bg3}`, padding: "10px 12px", boxShadow: T.shadow, cursor: dndEnabled ? "grab" : "default", opacity: dragging ? 0.4 : 1, transition: "opacity .15s, box-shadow .2s, transform .2s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div {...interactive(() => onOpen(card.donorId), { label: `Open ${card.name}` })} style={{ borderRadius: 6, margin: -4, padding: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div title={card.assignedToName || "Unassigned"} style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: color || "#1a6b4a22", color: color ? "#fff" : T.greenMid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>{initials(card.assignedToName)}</div>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {card.askAmount > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: T.gold600 }}>{fmt(card.askAmount)} ask{card.openOppCount > 1 ? ` ×${card.openOppCount}` : ""}</span>}
            {card.totalGiving > 0 && <span style={{ fontSize: 11, color: T.ink3 }}>{fmt(card.totalGiving)} given</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 6 }}>
            {card.stageAge != null && <span style={{ fontSize: 11, color: card.stageAge > 120 ? T.terracotta : T.ink3 }}>{card.stageAge}d in stage</span>}
            {card.nextTask && <span title={card.nextTask.title} style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>◻ {card.nextTask.title}</span>}
          </div>
        </div>
        {dndEnabled && <span title="Drag to another stage" aria-hidden="true" style={{ color: T.ink3, fontSize: 15, lineHeight: 1, cursor: "grab", flexShrink: 0, userSelect: "none" }}>{"⠿"}</span>}
      </div>
      {!isReadOnly && <button onClick={() => onMove(card)} style={{ marginTop: 8, width: "100%", background: T.green100, border: `1px solid ${T.bg2}`, borderRadius: 6, padding: "4px 0", fontSize: 12, fontWeight: 700, color: T.greenMid, cursor: "pointer" }}>Move →</button>}
    </div>
  );
}

const VALUE_BANDS = [["", "Any value"], ["1000", "$1k+"], ["10000", "$10k+"], ["25000", "$25k+"], ["100000", "$100k+"]];
const SORTS = [["value", "Value"], ["last_gift", "Last gift"], ["stage_age", "Time in stage"]];
const COL_PAGE = 30; // render this many cards/column at a time (never hundreds)

export function Pipeline({ isReadOnly, onNavigate, initialScope }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState(initialScope === "all" ? "all" : "mine");
  const [assignedTo, setAssignedTo] = useState("");
  const [designation, setDesignation] = useState("");
  const [minGiving, setMinGiving] = useState("");
  const [sort, setSort] = useState("value");
  const [search, setSearch] = useState("");
  const [dSearch, setDSearch] = useState("");   // debounced
  const [shown, setShown] = useState({});         // per-stage visible count
  const [moving, setMoving] = useState(null);
  // Drag-and-drop (BUILD-30 Part 3)
  const [drag, setDrag] = useState(null);         // { donorId, name, stage, card } being dragged
  const [dropStage, setDropStage] = useState(null);
  const [prompt, setPrompt] = useState(null);     // { card, fromStage, toStage } → the note prompt
  const [optimistic, setOptimistic] = useState({}); // donorId → toStage (card shown moved before the server confirms)
  const [dndError, setDndError] = useState("");

  useEffect(() => { const t = setTimeout(() => setDSearch(search.trim()), 220); return () => clearTimeout(t); }, [search]);

  const load = () => {
    const qs = new URLSearchParams();
    qs.set("scope", scope);
    if (assignedTo) qs.set("assignedTo", assignedTo);
    if (designation) qs.set("designation", designation);
    if (minGiving) qs.set("minGiving", minGiving);
    if (sort) qs.set("sort", sort);
    if (dSearch) qs.set("search", dSearch);
    setLoading(true);
    apiFetch("/pipeline?" + qs).then(d => { setData(d); setShown({}); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, [scope, assignedTo, designation, minGiving, sort, dSearch]);

  const colorMap = useMemo(() => Object.fromEntries((data?.officers || []).filter(o => o.color).map(o => [o.id, o.color])), [data]);
  // Apply pending optimistic moves so a dragged card shows in its new column
  // instantly (reverted on cancel/reject). Membership count is unchanged — only
  // which column a card sits in — so per-stage headers reconcile on reload.
  // MUST stay ABOVE every early return below (loading / locked / empty) — a hook
  // called conditionally throws "Rendered more hooks…" (react-hooks/rules-of-hooks).
  const displayColumns = useMemo(() => {
    const cols = data?.columns || {};
    if (!Object.keys(optimistic).length) return cols;
    const clone = {}; STAGE_META.forEach(s => { clone[s.id] = [...(cols[s.id] || [])]; });
    for (const [donorId, toStage] of Object.entries(optimistic)) {
      let moved = null;
      for (const sid of Object.keys(clone)) {
        const idx = clone[sid].findIndex(c => c.donorId === donorId);
        if (idx >= 0) { moved = clone[sid][idx]; clone[sid].splice(idx, 1); break; }
      }
      if (moved && clone[toStage]) clone[toStage] = [{ ...moved, stage: toStage }, ...clone[toStage]];
    }
    return clone;
  }, [data, optimistic]);
  const openDonor = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const goAddProspects = () => onNavigate && onNavigate("donors");

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const onDragStart = (e, card) => {
    setDrag({ donorId: card.donorId, name: card.name, stage: card.stage, card });
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", card.donorId); } catch { /* older browsers */ }
  };
  const onDragEnd = () => { setDrag(null); setDropStage(null); };
  const onColDragOver = (e, stageId) => {
    if (!drag || drag.stage === stageId) return;   // no-op onto the same column
    e.preventDefault();                             // allow the drop
    try { e.dataTransfer.dropEffect = "move"; } catch { /* noop */ }
    if (dropStage !== stageId) setDropStage(stageId);
  };
  const onColDragLeave = (stageId) => setDropStage(s => (s === stageId ? null : s));
  const onColDrop = (e, stageId) => {
    e.preventDefault();
    const d = drag; setDropStage(null); setDrag(null);
    if (!d || d.stage === stageId) return;
    // Optimistic: move the card into the target column immediately, then ask for
    // the required note. If the officer cancels or the server rejects, we roll back.
    setOptimistic(o => ({ ...o, [d.donorId]: stageId }));
    setPrompt({ card: d.card, fromStage: d.stage, toStage: stageId });
  };
  const savePrompt = async (description) => {
    const p = prompt; if (!p) return;
    try {
      await apiFetch(`/pipeline/${p.card.donorId}/move`, { method: "POST", body: JSON.stringify({ toStage: p.toStage, description }) });
      setOptimistic(o => { const n = { ...o }; delete n[p.card.donorId]; return n; });
      setPrompt(null);
      load(); // re-sync with the server (concurrency-safe: server is the source of truth)
    } catch (err) {
      // Rollback the optimistic move + surface a clear error (plan gate / permission / conflict).
      setOptimistic(o => { const n = { ...o }; delete n[p.card.donorId]; return n; });
      setPrompt(null);
      setDndError(`Couldn't move ${p.card.name}: ${err.message || "the server rejected the move."}`);
      setTimeout(() => setDndError(""), 6000);
    }
  };
  const cancelPrompt = () => {
    const p = prompt;
    if (p) setOptimistic(o => { const n = { ...o }; delete n[p.card.donorId]; return n; }); // rollback
    setPrompt(null);
  };

  if (loading && !data) return <div style={{ padding: 40, color: T.ink3 }}>Loading pipeline…</div>;

  const locked = !!(data && data.locked);
  const f = data?.forecast;
  const officers = data?.officers || [];
  const columns = data?.columns || {};
  const counts = data?.counts || {};
  const totalCards = data?.total ?? Object.values(columns).reduce((s, c) => s + c.length, 0);
  const anyFilter = !!(assignedTo || designation || minGiving || dSearch);
  // Cross-officer visibility ("All portfolios" + the officer filter) is admin-only
  // (BUILD-31 Part 4) — the server reports it and also enforces it. An individual
  // officer sees only their own portfolio, with the toggle hidden.
  const canViewAll = !!(data && data.canViewAll);
  // BUILD-32 Part 4 — a "My/All portfolios" toggle (and an officer filter) is a
  // single-value picker in a one-officer org: both views show the same board.
  // Show them only when 2+ officers actually have assigned donors (server's
  // `multiOfficer`). Standing UI rule: hide single-value pickers.
  const multiOfficer = !!(data && data.multiOfficer);
  const showPortfolioToggle = canViewAll && multiOfficer;
  // Drag-and-drop is a Team write path: off in the locked Core preview and for
  // read-only orgs. The keyboard/button "Move →" path stays available regardless.
  const dndEnabled = !isReadOnly && !locked;

  const board = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <PageTitle main="Prospect" accent="Pipeline" />
        {f && <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Stat label="Open asks" value={fmtFull(f.open)} sub={`${f.openCount} open`} color={T.gold600} />
          <Stat label="Weighted forecast" value={fmtFull(f.weighted)} sub="by stage" color={T.greenMid} />
          <Stat label="Closed this FY" value={fmtFull(f.wonThisPeriod)} sub={`${f.wonCount} won`} color={T.greenDk} />
        </div>}
      </div>

      {/* Scope toggle + add-prospects. The My/All toggle is ADMIN-only oversight. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "6px 0 10px" }}>
        {showPortfolioToggle && (
          <div style={{ display: "flex", background: T.bg2, borderRadius: T.radiusSm, padding: 3 }}>
            {[["mine", "My portfolio"], ["all", "All portfolios"]].map(([v, l]) => (
              <button key={v} onClick={() => { setScope(v); if (v === "mine") setAssignedTo(""); }}
                style={{ background: scope === v && !assignedTo ? T.bgCard : "transparent", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: scope === v && !assignedTo ? T.ink : T.ink3, cursor: "pointer", boxShadow: scope === v && !assignedTo ? T.shadow : "none" }}>{l}</button>
            ))}
          </div>
        )}
        <span style={{ fontSize: 12.5, color: T.ink3 }}>{totalCards} {canViewAll ? "on the board" : "in your portfolio"}{anyFilter ? " (filtered)" : ""}</span>
        <button onClick={goAddProspects} style={{ marginLeft: "auto", background: T.greenMid, border: "none", borderRadius: T.radiusSm, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer" }}>+ Add prospects from your donors</button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "0 0 16px" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prospects…" style={{ ...filterInp, minWidth: 170 }} />
        {showPortfolioToggle && <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={filterInp}>
          <option value="">Any officer</option>
          {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>}
        <select value={minGiving} onChange={e => setMinGiving(e.target.value)} style={filterInp}>
          {VALUE_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={designation} onChange={e => setDesignation(e.target.value)} style={filterInp}>
          {DESIGNATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} style={filterInp} title="Sort within each column">
          {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
        </select>
        {officers.some(o => o.color) && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: "auto", alignItems: "center" }}>
          {officers.filter(o => o.color).map(o => <span key={o.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.ink3 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: o.color }} />{o.name}
          </span>)}
        </div>}
      </div>

      {totalCards === 0 ? (
        <EmptyState           title={anyFilter ? "No prospects match these filters" : (scope === "mine" ? "Your pipeline is empty — and that's the point" : "No prospects on the board yet")}
          message={anyFilter
            ? (canViewAll ? "Clear a filter, or switch to All portfolios." : "Clear a filter to see your whole portfolio.")
            : "The pipeline holds the prospects you're actively working — not your whole donor list. Open your Donors directory, pick the major-gift prospects worth cultivating, and add them here."}
          action={anyFilter ? undefined : "Go to Donors →"} onAction={goAddProspects} />
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {STAGE_META.map(s => {
            const cards = displayColumns[s.id] || [];
            const trueCount = counts[s.id] ?? cards.length;
            const colAsk = cards.reduce((a, c) => a + c.askAmount, 0);
            const visible = shown[s.id] || COL_PAGE;
            const showCards = cards.slice(0, visible);
            const isDropTarget = dndEnabled && dropStage === s.id && drag && drag.stage !== s.id;
            return (
              <div key={s.id}
                onDragOver={dndEnabled ? e => onColDragOver(e, s.id) : undefined}
                onDragLeave={dndEnabled ? () => onColDragLeave(s.id) : undefined}
                onDrop={dndEnabled ? e => onColDrop(e, s.id) : undefined}
                style={{ flex: "1 1 230px", minWidth: 220, background: isDropTarget ? T.green100 : T.bg2, borderRadius: T.radius, padding: 10, outline: isDropTarget ? `2px dashed ${T.green600 || T.greenMid}` : "2px dashed transparent", outlineOffset: -2, transition: "background .15s, outline-color .15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: T.ink3 }}>{trueCount}</div>
                </div>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 8 }}>{s.hint}{colAsk > 0 ? ` · ${fmt(colAsk)} asks` : ""}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {showCards.map(c => <ProspectCard key={c.donorId} card={c} colorMap={colorMap} onOpen={openDonor} onMove={setMoving} isReadOnly={isReadOnly} dndEnabled={dndEnabled} dragging={drag?.donorId === c.donorId} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
                  {cards.length === 0 && <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "12px 0" }}>{isDropTarget ? "Drop here" : "—"}</div>}
                  {cards.length > visible && (
                    <button onClick={() => setShown(p => ({ ...p, [s.id]: visible + COL_PAGE }))}
                      style={{ background: "none", border: `1px dashed ${T.bg3}`, borderRadius: 6, padding: "6px 0", fontSize: 12, fontWeight: 700, color: T.greenMid, cursor: "pointer" }}>
                      Show more ({cards.length - visible} of {trueCount})
                    </button>
                  )}
                  {trueCount > cards.length && cards.length <= visible && (
                    <div style={{ fontSize: 11, color: T.ink3, textAlign: "center", paddingTop: 4 }}>Showing top {cards.length} of {trueCount} — narrow with search or value.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {moving && <MoveModal card={moving} onClose={() => setMoving(null)} onMoved={() => { setMoving(null); load(); }} />}
      {prompt && <DropNotePrompt card={prompt.card} fromStage={prompt.fromStage} toStage={prompt.toStage} onSave={savePrompt} onCancel={cancelPrompt} />}
      {dndError && <div role="alert" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: T.terracotta, color: "#fff", padding: "10px 16px", borderRadius: T.radiusSm, fontSize: 13, fontWeight: 600, zIndex: 500, boxShadow: T.shadowLg, maxWidth: "90vw" }}>{dndError}</div>}
    </div>
  );

  if (locked) {
    return (
      <div>
        <PageTitle main="Prospect" accent="Pipeline" />
        <LockedFeature
          title="Manage a major-gifts pipeline"
          blurb="Move prospects through Identification → Qualification → Cultivation → Solicitation → Stewardship, log every move with a note, track asks against the gifts they close, and see each officer's portfolio at a glance. This preview shows your own donors — unlock the board to work it."
          onCta={goToPricing}
        >
          {board}
        </LockedFeature>
      </div>
    );
  }

  return board;
}

const filterInp = { padding: "7px 10px", border: `1px solid ${T.bg3}`, borderRadius: T.radiusSm, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: T.bgCard, color: T.ink };
function Stat({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.ink3 }}>{sub}</div>
    </div>
  );
}

export default Pipeline;

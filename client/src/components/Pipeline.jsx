// Pipeline.jsx — Moves management & prospect pipeline (BUILD-15, Team plan).
// The major-gifts spine: a Kanban board by stage, cards color-coded by
// officer, filterable by portfolio + designation, with the open-ask forecast.
// A move requires a description (enforced in MoveModal). Full ask/gift + move
// history lives on the DonorProfile (see Donors.jsx). Core orgs get a graceful
// upgrade state, not a broken tab.
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, EmptyState, fmt, fmtFull, interactive, LockedFeature } from "./shared";

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

function ProspectCard({ card, colorMap, onOpen, onMove, isReadOnly }) {
  const color = colorMap[card.assignedTo] || null;
  return (
    <div style={{ background: T.bgCard, borderRadius: T.radiusSm, border: `1px solid ${T.bg2}`, borderLeft: `3px solid ${color || T.bg3}`, padding: "10px 12px", boxShadow: T.shadow }}>
      <div {...interactive(() => onOpen(card.donorId), { label: `Open ${card.name}` })} style={{ borderRadius: 6, margin: -4, padding: 4 }}>
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
      {!isReadOnly && <button onClick={() => onMove(card)} style={{ marginTop: 8, width: "100%", background: T.green100, border: `1px solid ${T.bg2}`, borderRadius: 6, padding: "4px 0", fontSize: 12, fontWeight: 700, color: T.greenMid, cursor: "pointer" }}>Move →</button>}
    </div>
  );
}

export function Pipeline({ isReadOnly, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedTo, setAssignedTo] = useState("");
  const [designation, setDesignation] = useState("");
  const [moving, setMoving] = useState(null);

  const load = () => {
    const qs = new URLSearchParams();
    if (assignedTo) qs.set("assignedTo", assignedTo);
    if (designation) qs.set("designation", designation);
    setLoading(true);
    apiFetch("/pipeline" + (qs.toString() ? "?" + qs : "")).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, [assignedTo, designation]);

  const colorMap = useMemo(() => Object.fromEntries((data?.officers || []).filter(o => o.color).map(o => [o.id, o.color])), [data]);
  const openDonor = id => onNavigate && onNavigate("donors", { selectDonorId: id });

  if (loading && !data) return <div style={{ padding: 40, color: T.ink3 }}>Loading pipeline…</div>;

  const locked = !!(data && data.locked);
  const f = data?.forecast;
  const officers = data?.officers || [];
  const columns = data?.columns || {};
  const totalCards = Object.values(columns).reduce((s, c) => s + c.length, 0);

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

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "4px 0 16px" }}>
        <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={filterInp}>
          <option value="">All portfolios</option>
          {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={designation} onChange={e => setDesignation(e.target.value)} style={filterInp}>
          {DESIGNATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {/* Officer legend */}
        {officers.some(o => o.color) && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginLeft: "auto", alignItems: "center" }}>
          {officers.filter(o => o.color).map(o => <span key={o.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: T.ink3 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: o.color }} />{o.name}
          </span>)}
        </div>}
      </div>

      {totalCards === 0 ? (
        <EmptyState icon="◇" title="No prospects in the pipeline yet" message="Prospects appear here as you assign donors and set their stage. Open a donor and move them into the pipeline to start tracking cultivation and asks." />
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {STAGE_META.map(s => {
            const cards = columns[s.id] || [];
            const colAsk = cards.reduce((a, c) => a + c.askAmount, 0);
            return (
              <div key={s.id} style={{ flex: "1 1 230px", minWidth: 220, background: T.bg2, borderRadius: T.radius, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: T.ink3 }}>{cards.length}</div>
                </div>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 8 }}>{s.hint}{colAsk > 0 ? ` · ${fmt(colAsk)} asks` : ""}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cards.map(c => <ProspectCard key={c.donorId} card={c} colorMap={colorMap} onOpen={openDonor} onMove={setMoving} isReadOnly={isReadOnly} />)}
                  {cards.length === 0 && <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "12px 0" }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {moving && <MoveModal card={moving} onClose={() => setMoving(null)} onMoved={() => { setMoving(null); load(); }} />}
    </div>
  );

  if (locked) {
    return (
      <div>
        <PageTitle main="Prospect" accent="Pipeline" />
        <LockedFeature
          title="Manage a major-gifts pipeline"
          blurb="Move prospects through Identification → Qualification → Cultivation → Solicitation → Stewardship, log every move with a note, track asks against the gifts they close, and see each officer's portfolio at a glance. This preview shows your own donors — unlock the board to work it."
          onCta={() => onNavigate && onNavigate("settings")}
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

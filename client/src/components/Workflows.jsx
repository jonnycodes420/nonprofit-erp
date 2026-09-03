import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, interactive } from "./shared";

// BUILD-13 Part 3 — Workflows: retention recipes on a builder-ready trigger →
// conditions → actions model. v1 exposes only the four pre-built recipes with
// on/off toggles + light config + a recent-run log. Calm and legible, not a
// spaghetti canvas — the visual builder is a deferred stage on the same schema.

const TRIGGER_LABEL = {
  gift_received: "When a gift is received",
  recurring_failed: "When a recurring card fails",
  donor_lapsed: "When a donor lapses",
};
const ACTION_LABEL = {
  send_email: "Send email",
  create_task: "Create task",
  add_tag: "Add tag",
  notify_owner: "Alert owner",
  notify_gift: "Notify team",
};
const fmtWhen = ts => { if (!ts) return "never"; const d = new Date(ts); const mins = Math.floor((Date.now() - d) / 60000); if (mins < 1) return "just now"; if (mins < 60) return `${mins}m ago`; if (mins < 1440) return `${Math.floor(mins / 60)}h ago`; return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

export function Workflows({ isReadOnly, onNavigate }) {
  const [rows, setRows] = useState(null);
  const [expanded, setExpanded] = useState(null); // workflow id whose run log is open
  const [runs, setRuns] = useState({});           // id → runs[]

  useEffect(() => { apiFetch("/workflows").then(setRows).catch(() => setRows([])); }, []);

  const patch = async (id, body) => {
    try {
      const updated = await apiFetch(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(body) });
      setRows(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    } catch { /* revert on next load */ }
  };
  const toggle = w => { if (isReadOnly) return; patch(w.id, { enabled: !w.enabled }); };

  const openRuns = async w => {
    if (expanded === w.id) { setExpanded(null); return; }
    setExpanded(w.id);
    if (!runs[w.id]) { try { const r = await apiFetch(`/workflows/${w.id}/runs`); setRuns(p => ({ ...p, [w.id]: r })); } catch { setRuns(p => ({ ...p, [w.id]: [] })); } }
  };

  if (rows === null) return <div style={{ padding: 40, color: T.ink3, fontSize: 13 }}>Loading workflows…</div>;
  const activeCount = rows.filter(w => w.enabled).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle main="Automations that do the" accent="quiet work." />
      <div style={{ fontSize: 13.5, color: T.ink3, marginTop: -8, maxWidth: 620, lineHeight: 1.6 }}>
        Turn on a recipe and Steward watches for the moment, then acts in your name — a task, a branded email, a tag. Everything is logged, nothing double-sends, and a human always stays in the loop. <strong style={{ color: T.ink }}>{activeCount} of {rows.length} active.</strong>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {rows.map(w => (
          <RecipeCard key={w.id} w={w} isReadOnly={isReadOnly}
            onToggle={() => toggle(w)}
            onConfig={cfg => patch(w.id, { config: cfg })}
            expanded={expanded === w.id} onOpenRuns={() => openRuns(w)}
            runs={runs[w.id]} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function RecipeCard({ w, isReadOnly, onToggle, onConfig, expanded, onOpenRuns, runs, onNavigate }) {
  const accent = w.enabled ? T.greenMid : T.bg3;
  return (
    <div style={{ background: T.white, border: `1px solid ${w.enabled ? T.greenMid + "55" : T.bg3}`, borderLeft: `3px solid ${accent}`, borderRadius: 14, padding: "18px 20px", boxShadow: w.enabled ? T.shadow : "none", transition: "border-color 0.15s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>{w.name}</div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, lineHeight: 1.55 }}>{w.description}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Chip label={TRIGGER_LABEL[w.trigger] || w.trigger} tone="trigger" />
            <span style={{ color: T.ink3, fontSize: 12 }}>→</span>
            {w.actions.map((a, i) => <Chip key={i} label={ACTION_LABEL[a.type] || a.type} tone="action" />)}
          </div>
        </div>
        {/* Toggle */}
        <button onClick={onToggle} disabled={isReadOnly} aria-label={w.enabled ? "Turn off" : "Turn on"}
          title={isReadOnly ? "Reactivate your subscription to make changes." : (w.enabled ? "Turn off" : "Turn on")}
          style={{ background: w.enabled ? T.greenMid : T.bg3, border: "none", borderRadius: 99, width: 46, height: 26, position: "relative", cursor: isReadOnly ? "not-allowed" : "pointer", flexShrink: 0, transition: "background 0.15s", opacity: isReadOnly ? 0.5 : 1 }}>
          <span style={{ position: "absolute", top: 3, left: w.enabled ? 23 : 3, width: 20, height: 20, background: "#fff", borderRadius: "50%", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
        </button>
      </div>

      {/* Light config */}
      {w.recipe_key === "major_gift_alert" && (
        <>
          <ConfigRow label="Major-gift threshold" prefix="$" value={w.config?.threshold ?? 1000} isReadOnly={isReadOnly}
            onSave={v => onConfig({ threshold: Number(v) })} />
          {/* BUILD-76 Part 7 — the honest default: the org's own 95th-percentile
              gift over the trailing year, suggested, never silently applied. */}
          {w.suggestedThreshold != null && w.suggestedThreshold !== (w.config?.threshold ?? 1000) && (
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>
              In your own file, the top 5% of last year's gifts start at <strong style={{ color: T.ink }}>${w.suggestedThreshold.toLocaleString()}</strong>
              {!isReadOnly && <> — <button onClick={() => onConfig({ threshold: w.suggestedThreshold })}
                style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>use that</button></>}
            </div>
          )}
        </>
      )}
      {w.recipe_key === "pledge_due_soon" && (
        <ConfigRow label="Days before the due date" value={w.config?.leadDays ?? 14} isReadOnly={isReadOnly}
          onSave={v => onConfig({ leadDays: Number(v) })} />
      )}
      {w.recipe_key === "instant_gift_thanks" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: T.ink3, fontWeight: 600 }}>Notify</span>
            <select value={w.config?.notify || "both"} disabled={isReadOnly}
              onChange={e => onConfig({ notify: e.target.value })}
              style={{ background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "5px 8px", fontSize: 13, color: T.ink, cursor: isReadOnly ? "not-allowed" : "pointer" }}>
              <option value="both">ED &amp; assigned officer</option>
              <option value="ed">Executive director only</option>
              <option value="owner">Assigned officer only</option>
            </select>
          </div>
          <ConfigRow inline label="Only above" prefix="$" value={w.config?.threshold ?? 0} isReadOnly={isReadOnly} onSave={v => onConfig({ threshold: Number(v) })} />
        </div>
      )}
      {w.recipe_key === "lapsing_reengage" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <ConfigRow inline label="Lapse window (days)" value={w.config?.lapseDays ?? 365} isReadOnly={isReadOnly} onSave={v => onConfig({ lapseDays: Number(v) })} />
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: T.ink3, cursor: isReadOnly ? "default" : "pointer" }}>
            <input type="checkbox" checked={!!w.config?.sendEmail} disabled={isReadOnly} onChange={e => onConfig({ sendEmail: e.target.checked })} />
            Also send a re-engagement email
          </label>
        </div>
      )}

      {/* Run log */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${T.bg2}`, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 12, color: T.ink3 }}>
          {w.runCount > 0 ? <><strong style={{ color: T.ink }}>{w.runCount}</strong> run{w.runCount === 1 ? "" : "s"} · last {fmtWhen(w.lastRun)}</> : "No runs yet — it'll act the next time the moment happens."}
        </div>
        {w.runCount > 0 && <button onClick={onOpenRuns} style={{ background: "none", border: "none", color: T.greenMid, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{expanded ? "Hide activity" : "View activity"}</button>}
      </div>

      {expanded && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {(runs || []).length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>Loading…</div>}
          {(runs || []).map(r => {
            const donorLink = r.donor_id && onNavigate ? () => onNavigate("donors", { selectDonorId: r.donor_id }) : null;
            return (
              <div key={r.id} {...(donorLink ? interactive(donorLink, { label: "Open donor" }) : {})}
                style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                <span style={{ color: T.ink3, flexShrink: 0 }}>{fmtWhen(r.created_at)}</span>
                <span style={{ flex: 1, color: T.ink, minWidth: 0 }}>
                  {(r.actions_taken || []).map(a => ACTION_LABEL[a.type] || a.type).join(" · ") || "ran"}
                </span>
                {r.donor_id && <span style={{ color: T.greenMid, fontWeight: 600, flexShrink: 0 }}>♦ donor</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone }) {
  const styles = tone === "trigger"
    ? { background: T.gold100, color: T.gold600, border: `1px solid ${T.gold300}` }
    : { background: T.green100, color: T.greenMid, border: `1px solid ${T.green200}` };
  return <span style={{ ...styles, fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "2px 9px", whiteSpace: "nowrap" }}>{label}</span>;
}

function ConfigRow({ label, prefix, value, onSave, isReadOnly, inline }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const dirty = String(v) !== String(value);
  const body = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12.5, color: T.ink3, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "4px 8px" }}>
        {prefix && <span style={{ fontSize: 12, color: T.ink3 }}>{prefix}</span>}
        <input value={v} disabled={isReadOnly} onChange={e => setV(e.target.value.replace(/[^0-9]/g, ""))} style={{ width: 64, border: "none", background: "transparent", fontSize: 13, color: T.ink, outline: "none" }} />
      </div>
      {dirty && !isReadOnly && <button onClick={() => onSave(v)} style={{ background: T.greenMid, border: "none", borderRadius: 7, padding: "5px 10px", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>}
    </div>
  );
  return inline ? body : <div style={{ marginTop: 12 }}>{body}</div>;
}

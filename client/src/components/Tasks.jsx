import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, EmptyState, interactive } from "./shared";

// BUILD-13 Part 1 — Tasks: the daily-driver follow-up surface.
// Answers "what do I need to do" via three time buckets (Overdue / Due today /
// Upcoming). One-click complete, create-task, and every donor-linked row deep-
// links to that donor's profile (BUILD-12 clickability + keyboard-accessible
// interactive() treatment). Local state is synced back into data.tasks via
// setData so the sidebar badge stays live.

const todayISO = () => new Date().toISOString().slice(0, 10);
const dueDays = due => Math.floor((new Date(due) - new Date(todayISO())) / 86400000);
const fmtDue = due => new Date(due + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Bucket a task by its due date. No-date tasks are their own low-urgency group.
function bucketOf(t) {
  if (!t.due) return "someday";
  const d = dueDays(t.due);
  return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
}

const BUCKETS = [
  { key: "overdue",  label: "Overdue",   accent: T.terracotta, empty: "Nothing overdue — you're on top of it." },
  { key: "today",    label: "Due today", accent: T.gold,       empty: "Nothing due today." },
  { key: "upcoming", label: "Upcoming",  accent: T.greenMid,   empty: "No upcoming tasks scheduled." },
  { key: "someday",  label: "No date",   accent: T.ink3,       empty: null },
];

export function Tasks({ data, setData, isReadOnly, onNavigate, initialScope }) {
  const [tasks, setTasks] = useState(() => data?.tasks ? null : []); // null = loading
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", due: "", priority: "medium", donorId: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Scope: "mine" (my own tasks) matches Home's Tasks command-card count exactly,
  // so "Tasks: N" on Home lands on N here (BUILD-30 class audit). "all" = the whole
  // org, one toggle away. Default "mine" — the daily-driver, and the Home default.
  const [scope, setScope] = useState(initialScope === "all" ? "all" : "mine");

  // Fetch the authoritative list (includes donor_name join), re-fetch on scope.
  useEffect(() => {
    let alive = true;
    apiFetch(`/tasks?scope=${scope}`).then(rows => {
      if (!alive) return;
      setTasks(rows);
      if (scope === "mine") syncBadge(rows); // the sidebar badge = the user's own tasks
    }).catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, [scope]);

  // Keep App.jsx's data.tasks (sidebar badge source) in sync with the truth.
  const syncBadge = rows => setData(prev => prev ? { ...prev, tasks: rows.map(t => ({
    id: t.id, title: t.title, due: t.due || "", priority: t.priority, type: t.type,
    done: !!t.done, donorId: t.donor_id || null,
  })) } : prev);

  const donors = data?.donors || [];

  const open = useMemo(() => (tasks || []).filter(t => !t.done), [tasks]);
  const doneTasks = useMemo(() => (tasks || []).filter(t => t.done), [tasks]);
  const grouped = useMemo(() => {
    const g = { overdue: [], today: [], upcoming: [], someday: [] };
    for (const t of open) g[bucketOf(t)].push(t);
    // Within a bucket, soonest-due first, then high-priority first.
    const pr = { high: 0, medium: 1, low: 2 };
    for (const k of Object.keys(g)) g[k].sort((a, b) =>
      (a.due && b.due ? new Date(a.due) - new Date(b.due) : 0) || (pr[a.priority] - pr[b.priority]));
    return g;
  }, [open]);

  const replace = row => setTasks(prev => { const next = (prev || []).map(t => t.id === row.id ? row : t); syncBadge(next); return next; });

  const toggle = async t => {
    if (isReadOnly) return;
    // optimistic
    const optimistic = { ...t, done: !t.done };
    replace(optimistic);
    try {
      const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: !t.done }) });
      replace(row);
    } catch { replace(t); }
  };

  const add = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true); setErr("");
    try {
      const row = await apiFetch("/tasks", { method: "POST", body: JSON.stringify({
        title: form.title.trim(), due: form.due, priority: form.priority, donorId: form.donorId || undefined,
      }) });
      setTasks(prev => { const next = [...(prev || []), row]; syncBadge(next); return next; });
      setForm({ title: "", due: "", priority: "medium", donorId: "" });
      setShowAdd(false);
    } catch (e) { setErr(e.message || "Could not save task"); }
    setSaving(false);
  };

  const openCount = open.length;
  const overdueCount = grouped.overdue.length + grouped.today.length;

  if (tasks === null) return <div style={{ padding: 40, color: T.ink3, fontSize: 13 }}>Loading tasks…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <PageTitle main="Your" accent="tasks." />
        <button onClick={() => setShowAdd(v => !v)} disabled={isReadOnly}
          title={isReadOnly ? "Reactivate your subscription to make changes." : undefined}
          style={{ background: T.greenMid, border: "none", borderRadius: 10, padding: "10px 16px", color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer", opacity: isReadOnly ? 0.45 : 1 }}>
          + New task
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: T.ink3, marginTop: -6, alignItems: "center", flexWrap: "wrap" }}>
        <span><strong style={{ color: overdueCount ? T.terracotta : T.ink }}>{overdueCount}</strong> need attention</span>
        <span><strong style={{ color: T.ink }}>{openCount}</strong> open</span>
        <span><strong style={{ color: T.ink }}>{doneTasks.length}</strong> done</span>
        {/* Mine/All — "mine" is the default so the count matches Home's Tasks card. */}
        <div style={{ display: "flex", background: T.bg2, borderRadius: 8, padding: 3, marginLeft: "auto" }}>
          {[["mine", "Mine"], ["all", "All"]].map(([v, l]) => (
            <button key={v} onClick={() => setScope(v)}
              style={{ background: scope === v ? T.white : "transparent", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: scope === v ? T.ink : T.ink3, cursor: "pointer", boxShadow: scope === v ? T.shadow : "none" }}>{l}</button>
          ))}
        </div>
      </div>

      {showAdd && (
        <div style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: T.shadow }}>
          <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="What needs to happen? (e.g. Call Jane about the spring gala)"
            style={inp} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={lbl}>Due
              <input type="date" value={form.due} onChange={e => setForm(f => ({ ...f, due: e.target.value }))} style={{ ...inp, padding: "8px 10px" }} />
            </label>
            <label style={lbl}>Priority
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={{ ...inp, padding: "8px 10px" }}>
                {["high", "medium", "low"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label style={{ ...lbl, flex: 1, minWidth: 180 }}>Linked donor (optional)
              <select value={form.donorId} onChange={e => setForm(f => ({ ...f, donorId: e.target.value }))} style={{ ...inp, padding: "8px 10px" }}>
                <option value="">— none —</option>
                {donors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>
          {err && <div style={{ color: T.terracotta, fontSize: 12 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={add} disabled={!form.title.trim() || saving}
              style={{ background: T.greenMid, border: "none", borderRadius: 8, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: (!form.title.trim() || saving) ? 0.5 : 1 }}>
              {saving ? "Saving…" : "Add task"}
            </button>
            <button onClick={() => { setShowAdd(false); setErr(""); }} style={{ background: T.bg2, border: "none", borderRadius: 8, padding: "9px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {openCount === 0 && !showAdd && (
        <EmptyState icon="✓" title="You're all caught up" message="No open tasks. Add a follow-up so nothing slips — every task can link to the donor it's about." action="+ New task" onAction={isReadOnly ? undefined : () => setShowAdd(true)} />
      )}

      {BUCKETS.map(b => {
        const rows = grouped[b.key];
        if (!rows.length) return null;
        return (
          <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink }}>{b.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>{rows.length}</span>
            </div>
            {rows.map(t => <TaskRow key={t.id} t={t} accent={b.accent} onToggle={() => toggle(t)} isReadOnly={isReadOnly}
              onDonor={t.donor_id && onNavigate ? () => onNavigate("donors", { selectDonorId: t.donor_id }) : null} />)}
          </div>
        );
      })}

      {doneTasks.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, cursor: "pointer" }}>Completed · {doneTasks.length}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {doneTasks.map(t => (
              <div key={t.id} onClick={() => toggle(t)} style={{ display: "flex", alignItems: "center", gap: 12, background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 10, padding: "9px 14px", opacity: 0.55, cursor: isReadOnly ? "default" : "pointer" }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: T.greenMid, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontSize: 11, fontWeight: 800 }}>✓</span>
                <span style={{ fontSize: 13, color: T.ink3, textDecoration: "line-through", flex: 1 }}>{t.title}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TaskRow({ t, accent, onToggle, onDonor, isReadOnly }) {
  const overdue = t.due && dueDays(t.due) < 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: T.white, border: `1px solid ${T.bg2}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: "11px 14px" }}>
      <button onClick={onToggle} disabled={isReadOnly} aria-label="Complete task"
        title={isReadOnly ? "Reactivate your subscription to make changes." : "Mark complete"}
        style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${accent}`, background: "transparent", flexShrink: 0, cursor: isReadOnly ? "not-allowed" : "pointer", padding: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500, lineHeight: 1.35 }}>{t.title}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
          {t.due && <span style={{ fontSize: 11.5, color: overdue ? T.terracotta : T.ink3, fontWeight: overdue ? 700 : 400 }}>{overdue ? "Was due " : "Due "}{fmtDue(t.due)}</span>}
          {t.donor_name && (
            onDonor
              ? <span {...interactive(onDonor, { label: `Open ${t.donor_name}` })} style={{ fontSize: 11.5, color: T.greenMid, fontWeight: 600, borderRadius: 6, padding: "1px 6px" }}>♦ {t.donor_name}</span>
              : <span style={{ fontSize: 11.5, color: T.ink3 }}>♦ {t.donor_name}</span>
          )}
          {t.assigned_to_name && <span style={{ fontSize: 11, color: T.ink3 }}>· {t.assigned_to_name}</span>}
        </div>
      </div>
      {t.priority === "high" && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", color: T.terracotta, background: "#f6e3dd", borderRadius: 99, padding: "2px 8px", flexShrink: 0 }}>HIGH</span>}
    </div>
  );
}

const inp = { background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" };

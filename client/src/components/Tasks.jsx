import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, PageTitle, EmptyState, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { DonorLink } from "./RecordLink";
import { offerUndo } from "./EditHistory";
import { orgTodayPlus } from "../lib/orgToday";
import { fmtDayShort } from "../lib/taskDue";
import { TASK_VIEWS, TASK_KINDS, NEEDS_OUTCOME, recurPhrase, addDays, weekdayOf } from "../../../shared/taskShape.js";

// TASKS-2 — Tasks, the place a development director runs her week from.
// Views (Today, Upcoming, Overdue, Later, No date, Done) each carry the count
// the server computed with the same rule as the list (GET /tasks/counts), and
// Home's "Due today" is that same number. Every task says what it is about as
// a chip that opens the record. Quick add reads a sentence and shows what it
// understood; nothing saves until she says so. A call or a meeting with a
// person is finished by saying how it went and what is next.

// Shared styles, above every line that reads them (the TDZ rule).
const inp = { background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "9px 11px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", width: "100%", boxSizing: "border-box" };
const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" };
const outlineBtn = { background: T.white, border: `1px solid ${T.ink}`, borderRadius: 8, padding: "5px 12px", minHeight: 44, fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const textBtn = { background: "none", border: "none", padding: "5px 8px", minHeight: 44, minWidth: 44, fontSize: 12, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" };
// FIX-34 · every tap target on a row is at least 44 by 44 CSS px (a phone thumb).
const TAP = 44;
const tapBox = { minWidth: TAP, minHeight: TAP, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", boxSizing: "border-box" };
const barBtn = { background: T.white, border: "none", borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

// FIX-34 · the templates a task's draft starts from.
const THANK_KIND = n => (n > 1 ? "thanks_renewal" : "thanks_first");
const EMAIL_KINDS = ["thanks_monthly", "event_followup", "volunteer_thanks"];
const KIND_TEMPLATE_LABEL = { thanks_monthly: "Thank you: monthly gift", event_followup: "Event follow-up", volunteer_thanks: "Volunteer thank-you" };
const KIND_LABEL = Object.fromEntries(TASK_KINDS.map(k => [k.key, k.label]));
const VIEW_ORDER = ["today", "upcoming", "overdue", "later", "nodate", "done"];
const fmtTime = t => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ""));
  if (!m) return "";
  const h = +m[1], ap = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
  return `${h12}:${m[2]} ${ap}`;
};
const nextMonday = today => addDays(today, ((8 - weekdayOf(today)) % 7) || 7);

export function Tasks({ data, setData, isReadOnly, onNavigate, initialScope, initialView }) {
  const auth = useAuth();
  const isAdmin = auth?.user?.role === "admin";
  const today = orgTodayPlus(0);
  const [view, setView] = useState(VIEW_ORDER.includes(initialView) ? initialView : "today");
  const [scope, setScope] = useState(initialScope === "all" ? "all" : "mine");
  const [staff, setStaff] = useState("");
  const [team, setTeam] = useState([]);
  const [counts, setCounts] = useState(null);
  const [rows, setRows] = useState(null);           // null = loading
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [selecting, setSelecting] = useState(false);  // FIX-34: boxes hidden until "Select"
  const [draft, setDraft] = useState(null);         // a thank-you or email task's draft
  const [sheet, setSheet] = useState(null);         // a task open in the sheet
  const [finish, setFinish] = useState(null);       // a call/meeting being finished
  const [snoozeFor, setSnoozeFor] = useState(null);

  useEffect(() => { apiFetch("/org/team").then(r => setTeam(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const q = `scope=${staff ? "all" : scope}${staff ? `&staff=${encodeURIComponent(staff)}` : ""}`;
  const load = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([apiFetch(`/tasks/counts?${q}`), apiFetch(`/tasks?view=${view}&${q}`)]);
      setCounts(c); setRows(list); setErr("");
    } catch (e) { setRows(r => r || []); setErr(errorMessage(e, "Tasks could not be loaded just now.")); }
    // The sidebar badge is her own open tasks.
    apiFetch("/tasks?scope=mine").then(all => setData && setData(prev => prev ? { ...prev, tasks: all.map(t => ({
      id: t.id, title: t.title, due: t.due || "", priority: t.priority, type: t.type, done: !!t.done, donorId: t.donor_id || null,
    })) } : prev)).catch(() => {});
  }, [q, view, setData]);
  useEffect(() => { setRows(null); setSelected(new Set()); load(); }, [load]);
  const stopSelecting = useCallback(() => { setSelecting(false); setSelected(new Set()); }, []);
  useEffect(() => {
    if (!selecting) return undefined;
    const onKey = e => { if (e.key === "Escape") stopSelecting(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, stopSelecting]);

  const say = e => setErr((e && e.sentence) || errorMessage(e, "That did not save."));

  // ── Done ──────────────────────────────────────────────────────────────
  const complete = async (t, done = true, extra = {}) => {
    const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done, ...extra }) });
    return row;
  };
  const tick = async t => {
    if (isReadOnly) return;
    setErr("");
    if (!t.done && NEEDS_OUTCOME.has(t.kind) && t.donor_id) { setFinish(t); return; }
    try {
      const row = await complete(t, !t.done);
      await load();
      if (!t.done) offerUndo({ message: row.next ? `Done: ${t.title}. The next one is on ${fmtDayShort(row.next.due)}.` : `Done: ${t.title}.`,
        undoAction: async () => { await complete(t, false); await load(); } }, t.title);
    } catch (e) { say(e); }
  };

  // ── Snooze ────────────────────────────────────────────────────────────
  const snooze = async (t, until, reason) => {
    try {
      const row = await apiFetch(`/tasks/${t.id}/snooze`, { method: "POST", body: JSON.stringify({ until, reason }) });
      setSnoozeFor(null); await load();
      offerUndo({ message: `Snoozed to ${fmtDayShort(until)}${reason ? `: ${reason}` : ""}.`,
        undoAction: async () => { await apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ due: row.previousDue || "" }) }); await load(); } }, t.title);
    } catch (e) { say(e); }
  };

  // ── Bulk ──────────────────────────────────────────────────────────────
  const bulk = async (action, extra = {}) => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const r = await apiFetch("/tasks/bulk", { method: "POST", body: JSON.stringify({ ids, action, ...extra }) });
      stopSelecting(); await load();
      const n = r.changed.length;
      const skippedLine = r.skipped.length ? ` ${r.skipped.length} left as they were: ${r.skipped[0].sentence}` : "";
      const word = { reassign: "Reassigned", move: "Moved", done: "Marked done", delete: "Deleted" }[action];
      const undoAction = action === "delete"
        ? async () => { for (const id of r.undoIds) await apiFetch(`/deleted-records/${id}/restore`, { method: "POST" }); await load(); }
        : action === "done"
          ? async () => { await apiFetch("/tasks/bulk", { method: "POST", body: JSON.stringify({ ids: r.changed, action: "undone" }) }); await load(); }
          : async () => { await apiFetch("/tasks/bulk", { method: "POST", body: JSON.stringify({ ids: r.changed, action: "restore", before: r.before }) }); await load(); };
      offerUndo({ message: `${word} ${n} task${n === 1 ? "" : "s"}.${skippedLine}`, undoAction }, `${n} tasks`);
    } catch (e) { say(e); }
  };

  const openAbout = t => {
    const a = t.about;
    if (!a || !onNavigate) return null;
    if (a.kind === "person") return () => onNavigate("donors", { selectDonorId: a.id });
    if (a.kind === "household") return t.donor_id ? () => onNavigate("donors", { selectDonorId: t.donor_id }) : null;
    if (a.kind === "grant") return () => onNavigate("grants", { grantId: a.id });
    if (a.kind === "event") return () => onNavigate("fundraising", { frSection: "events", eventId: a.id });
    if (a.kind === "campaign") return () => onNavigate("communications", { subtab: "campaigns", campaignId: a.id });
    return null;
  };
  // One click does what the kind says.
  const kindAction = t => {
    if (isReadOnly || !onNavigate) return null;
    if (t.kind === "call" || t.kind === "meeting") {
      if (t.kind === "meeting" && !t.donor_id) return { label: "Book it", run: () => onNavigate("calendar") };
      return { label: t.kind === "call" ? "Log the call" : "How did it go?", run: () => t.donor_id ? setFinish(t) : tick(t) };
    }
    // FIX-34: the draft opens here, for that person (and that gift), not the profile.
    if (t.kind === "email") return { label: "Draft the email", run: () => t.donor_id ? setDraft({ t, mode: "email" }) : onNavigate("communications", { subtab: "templates" }) };
    if (t.kind === "thank_you") return { label: "Draft the thank-you", run: () => t.donor_id ? setDraft({ t, mode: "thank" }) : onNavigate("communications", { subtab: "milestones" }) };
    if (t.kind === "write") return { label: "Open Drafts", run: () => onNavigate("communications", { subtab: "milestones" }) };
    return null;
  };

  const viewMeta = TASK_VIEWS.find(v => v.key === view);
  const allIds = (rows || []).filter(t => !t.done).map(t => t.id);
  const allPicked = allIds.length > 0 && allIds.every(id => selected.has(id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <PageTitle main="Your" accent="tasks." />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div role="group" aria-label="Whose tasks" style={{ display: "flex", background: T.bg2, borderRadius: 8, padding: 3 }}>
            {[["mine", "Mine"], ["all", "Everyone"]].map(([v, l]) => (
              <button key={v} aria-pressed={!staff && scope === v} onClick={() => { setStaff(""); setScope(v); }}
                style={{ background: !staff && scope === v ? T.white : "transparent", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: !staff && scope === v ? T.ink : T.ink3, cursor: "pointer", boxShadow: !staff && scope === v ? T.shadow : "none" }}>{l}</button>
            ))}
          </div>
          {isAdmin && team.length > 1 && (
            <select aria-label="One person's tasks" data-testid="tasks-staff" value={staff} onChange={e => setStaff(e.target.value)} style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 12.5 }}>
              <option value="">Any staff member</option>
              {team.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          )}
        </div>
      </div>

      {!isReadOnly && <QuickAdd onSaved={async (row) => { await load(); offerUndo({ message: `Added: ${row.title}${row.due ? `, ${fmtDayShort(row.due)}` : ""}.`,
        undoAction: async () => { await apiFetch(`/tasks/${row.id}`, { method: "DELETE" }); await load(); } }, row.title); }} today={today} />}

      <div role="tablist" aria-label="Task views" style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: `1px solid ${T.bg2}` }}>
        {VIEW_ORDER.map(k => {
          const v = TASK_VIEWS.find(x => x.key === k);
          const n = counts ? counts[k] : null;
          const on = view === k;
          return (
            <button key={k} role="tab" aria-selected={on} data-testid={`tasks-view-${k}`} title={v.definition} onClick={() => setView(k)}
              style={{ background: "none", border: "none", borderBottom: `2px solid ${on ? T.greenDk : "transparent"}`, padding: "8px 10px", marginBottom: -1,
                fontSize: 13, fontWeight: on ? 800 : 600, color: on ? T.ink : T.ink3, cursor: "pointer", fontFamily: "inherit" }}>
              {v.label} <span style={{ fontWeight: 700, color: k === "overdue" && n ? T.gold700 : T.ink3 }}>{n == null ? "" : n}</span>
            </button>
          );
        })}
      </div>
      {viewMeta && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: -6 }}>{viewMeta.definition}</div>}

      {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}


      {rows === null ? <div style={{ padding: 30, color: T.ink3, fontSize: 13 }}>Loading tasks…</div>
        : rows.length === 0
          ? <EmptyState icon="✓" title={view === "today" ? "Nothing due today" : `Nothing in ${viewMeta?.label || "this view"}`}
              message={view === "today" ? "Type a task above in plain words, like “Call Bill Harmon Friday 2pm about the gala”." : "Tasks land here by their day."} />
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* The bulk bar takes the place of "Select all" and sticks to the
                  top while she scrolls, so it never sits over a row she is
                  about to pick (at 390 a bar pinned to the bottom did). */}
              {view !== "done" && !isReadOnly && allIds.length > 0 && (selecting
                ? <BulkBar n={selected.size} team={team} today={today} allPicked={allPicked}
                    onAll={() => setSelected(allPicked ? new Set() : new Set(allIds))} onClear={stopSelecting} onBulk={bulk} />
                : <div><button onClick={() => setSelecting(true)} data-testid="tasks-select" style={{ ...textBtn, paddingLeft: 0 }}>Select</button></div>)}
              {rows.map(t => (
                <TaskRow key={t.id} t={t} today={today} isReadOnly={isReadOnly} selecting={selecting}
                  onLongPress={() => { setSelecting(true); setSelected(s => new Set(s).add(t.id)); }}
                  picked={selected.has(t.id)} onPick={() => setSelected(s => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                  onTick={() => tick(t)} onOpen={() => setSheet(t)} onAbout={openAbout(t)} action={kindAction(t)}
                  onSnooze={() => setSnoozeFor(t)} />
              ))}
            </div>
          )}

      {sheet && <TaskSheet t={sheet} team={team} isReadOnly={isReadOnly} onClose={() => setSheet(null)}
        onChanged={async () => { await load(); }} onError={say} onFinish={t => { setSheet(null); if (NEEDS_OUTCOME.has(t.kind) && t.donor_id) setFinish(t); else tick(t); }} />}
      {finish && <FinishSheet t={finish} today={today} onClose={() => setFinish(null)} onDone={async (row) => {
        setFinish(null); await load();
        const t = finish;
        offerUndo({ message: `Done: ${t.title}. Logged how it went${row && row.next ? `; the next one is on ${fmtDayShort(row.next.due)}` : ""}.`,
          undoAction: async () => { await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: false }) }); await load(); } }, t.title);
      }} />}
      {draft && <DraftSheet t={draft.t} mode={draft.mode} onClose={() => setDraft(null)}
        onThanked={async (r) => {
          const t = draft.t; setDraft(null); await load();
          offerUndo({ message: r.mode === "send" ? `Sent the thank-you to ${t.donor_name || "them"}. The gift is thanked and the task is done.` : `Marked the thank-you sent. The gift is thanked and the task is done.`,
            undoAction: async () => { await apiFetch(`/tasks/${t.id}/thank/undo`, { method: "POST", body: JSON.stringify({ giftId: r.giftId, before: r.before, draftIds: r.draftIds }) }); await load(); } }, t.title);
        }}
        onEmailed={(r) => { const t = draft.t; setDraft(null); setFinish({ ...t, emailInteractionId: r.interactionId }); load(); }} />}
      {snoozeFor && <SnoozeSheet t={snoozeFor} today={today} onClose={() => setSnoozeFor(null)} onSnooze={snooze} />}
    </div>
  );
}

function TaskRow({ t, today, picked, onPick, onTick, onOpen, onAbout, action, onSnooze, isReadOnly, selecting, onLongPress }) {
  const late = t.view === "overdue";
  // A long press on a phone starts selecting, the way "Select" does.
  const press = useRef(null);
  const startPress = () => { if (isReadOnly || t.done || selecting) return; press.current = setTimeout(() => { press.current = null; onLongPress && onLongPress(); }, 550); };
  const endPress = () => { if (press.current) { clearTimeout(press.current); press.current = null; } };
  const dayLine = t.due ? (t.due.slice(0, 10) === today ? "Today" : `${late ? "Was due " : ""}${fmtDayShort(t.due)}`) : "";
  return (
    <div data-testid="task-row" data-task-id={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: T.white, border: `1px solid ${T.bg2}`,
      borderLeft: `3px solid ${late ? T.gold500 : t.done ? T.bg3 : T.greenDk}`, borderRadius: 10, padding: "4px 8px", opacity: t.done ? 0.6 : 1 }}
      onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}>
      {selecting && !t.done && !isReadOnly && (
        <label data-testid="task-select" style={tapBox} aria-label={`Select ${t.title}`}>
          <input type="checkbox" aria-label={`Select ${t.title}`} checked={picked} onChange={onPick} style={{ width: 18, height: 18, margin: 0, cursor: "pointer" }} />
        </label>)}
      <button onClick={onTick} disabled={isReadOnly} aria-label={t.done ? "Reopen task" : "Complete task"} data-testid="task-tick"
        title={isReadOnly ? "Reactivate your subscription to make changes." : t.done ? "Reopen" : "Mark complete"}
        style={{ ...tapBox, background: "none", border: "none", padding: 0, cursor: isReadOnly ? "not-allowed" : "pointer" }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${late ? T.gold500 : T.greenDk}`, background: t.done ? T.greenDk : "transparent", boxSizing: "border-box",
          color: T.white, fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{t.done ? "✓" : ""}</span></button>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: 4 }}>
        <button onClick={onOpen} data-testid="task-open" style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", minHeight: 44, minWidth: 44,
          fontSize: 14, color: T.ink, fontWeight: 600, lineHeight: 1.35, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</button>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: T.ink3 }}>
          <span style={{ fontWeight: 700, color: T.ink2 }}>{KIND_LABEL[t.kind] || "Other"}</span>
          {dayLine && <span style={{ color: late ? T.gold700 : T.ink3, fontWeight: late ? 700 : 400 }}>{dayLine}{t.due_time ? ` · ${fmtTime(t.due_time)}` : ""}</span>}
          {t.about && (onAbout
            ? <DonorLink id={t.about.id} onOpen={onAbout} data-testid="task-about" style={{ fontSize: 12, color: T.greenDk, fontWeight: 700, minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", boxSizing: "border-box" }}><span style={{ background: T.bg, borderRadius: 99, padding: "1px 8px", border: `1px solid ${T.bg3}` }}>{t.about.name}</span></DonorLink>
            : <span style={{ fontSize: 12, background: T.bg, borderRadius: 99, padding: "1px 8px" }}>{t.about.name}</span>)}
          {t.assigned_to_name && <span>{t.assigned_to_name}</span>}
          {t.recur && <span>{recurPhrase(t.recur)}</span>}
          {t.link_kind === "next_step" && <span>A next step on the Thread</span>}
          {t.snooze_reason && !t.done && <span>Snoozed: {t.snooze_reason}</span>}
          {Array.isArray(t.checklist) && t.checklist.length > 0 && <span>{t.checklist.filter(i => i.done).length} of {t.checklist.length} done</span>}
        </div>
      </div>
      {t.priority === "high" && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", color: T.gold700, border: `1px solid ${T.gold500}`, borderRadius: 99, padding: "2px 8px", flexShrink: 0 }}>HIGH</span>}
      {!t.done && !isReadOnly && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", paddingTop: 2 }}>
          {action && <button onClick={action.run} data-testid="task-kind-action" style={outlineBtn}>{action.label}</button>}
          <button onClick={onSnooze} data-testid="task-snooze" style={textBtn}>Snooze</button>
        </div>
      )}
    </div>
  );
}

// ── Quick add ────────────────────────────────────────────────────────────
function QuickAdd({ onSaved, today }) {
  const [text, setText] = useState("");
  const [p, setP] = useState(null);       // what Steward understood, editable
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const read = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/tasks/parse", { method: "POST", body: JSON.stringify({ text }) });
      setP({ ...r, donorId: r.person ? r.person.id : (r.candidates[0] ? "" : ""), donorName: r.person ? r.person.name : "" });
    } catch (e) { setErr(errorMessage(e, "Steward could not read that.")); }
    setBusy(false);
  };
  const save = async () => {
    if (!p || !String(p.title || "").trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const row = await apiFetch("/tasks", { method: "POST", body: JSON.stringify({
        title: p.title.trim(), due: p.due || "", dueTime: p.time || null, kind: p.kind, priority: p.priority,
        recur: p.recur || null, donorId: p.donorId || undefined }) });
      setText(""); setP(null); await onSaved(row);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  return (
    <div style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={e => { setText(e.target.value); setP(null); }} onKeyDown={e => { if (e.key === "Enter") (p ? save() : read()); }}
          data-testid="quick-add" aria-label="Add a task in plain words" placeholder="Add a task: Call Bill Harmon Friday 2pm about the gala" style={{ ...inp, flex: 1 }} />
        <button onClick={p ? save : read} disabled={!text.trim() || busy} data-testid="quick-add-go"
          style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "0 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !text.trim() || busy ? 0.5 : 1 }}>
          {p ? "Save task" : "Add"}
        </button>
      </div>
      {p && (
        <div data-testid="quick-add-confirm" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, color: T.ink3 }}>Here is what Steward read. Change anything, then Save task.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ ...lbl, flex: "2 1 220px" }}>Task<input value={p.title} onChange={e => setP({ ...p, title: e.target.value })} data-testid="qa-title" style={inp} /></label>
            <label style={{ ...lbl, flex: "1 1 140px" }}>About
              {p.person || !p.candidates.length
                ? <input value={p.donorName || "Nobody in particular"} readOnly data-testid="qa-person" style={{ ...inp, color: p.donorName ? T.ink : T.ink3 }} />
                : <select value={p.donorId} onChange={e => { const c = p.candidates.find(x => x.id === e.target.value); setP({ ...p, donorId: e.target.value, donorName: c ? c.name : "" }); }} style={inp}>
                    <option value="">Which one?</option>
                    {p.candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>}
            </label>
            <label style={{ ...lbl, flex: "1 1 130px" }}>Day<input type="date" value={p.due || ""} onChange={e => setP({ ...p, due: e.target.value })} data-testid="qa-due" style={inp} /></label>
            <label style={{ ...lbl, flex: "1 1 100px" }}>Time<input type="time" value={p.time || ""} onChange={e => setP({ ...p, time: e.target.value })} data-testid="qa-time" style={inp} /></label>
            <label style={{ ...lbl, flex: "1 1 110px" }}>Kind
              <select value={p.kind} onChange={e => setP({ ...p, kind: e.target.value })} data-testid="qa-kind" style={inp}>
                {TASK_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 12.5, color: T.ink2 }}>
            {p.recur ? `${recurPhrase(p.recur)}. ` : ""}{p.priority === "high" ? "High priority. " : ""}
            {p.due === today ? "Due today." : ""}
          </div>
          {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
          <div><button onClick={() => setP(null)} style={textBtn}>Cancel</button></div>
        </div>
      )}
      {!p && err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
    </div>
  );
}

// ── The task, opened ─────────────────────────────────────────────────────
function TaskSheet({ t, team, onClose, onChanged, onError, onFinish, isReadOnly }) {
  const [f, setF] = useState({ title: t.title, due: (t.due || "").slice(0, 10), time: t.due_time || "", priority: t.priority === "high" ? "high" : "medium",
    kind: t.kind, notes: t.notes || "", checklist: Array.isArray(t.checklist) ? t.checklist : [], recur: t.recur || null,
    assignedTo: t.assigned_to || "", reassignNote: "" });
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const linked = !!t.link_kind;
  const save = async () => {
    setBusy(true);
    try {
      const body = { due: f.due, dueTime: f.time || null, priority: f.priority, kind: f.kind, notes: f.notes, checklist: f.checklist, recur: f.recur };
      if (!linked) body.title = f.title;
      if ((f.assignedTo || "") !== (t.assigned_to || "")) { body.assignedTo = f.assignedTo || null; body.reassignNote = f.reassignNote; }
      await apiFetch(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await onChanged(); onClose();
    } catch (e) { onError(e); }
    setBusy(false);
  };
  const del = async () => {
    try {
      const r = await apiFetch(`/tasks/${t.id}`, { method: "DELETE" });
      await onChanged(); onClose();
      offerUndo({ ...r, message: `Deleted: ${t.title}.`, onRestored: onChanged }, t.title);
    } catch (e) { onError(e); }
  };
  return (
    <Modal onClose={onClose} title={linked ? t.title : "Task"} width={520}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {!isReadOnly && !t.done && <button onClick={() => onFinish(t)} style={outlineBtn} data-testid="sheet-done">Mark done</button>}
          {!isReadOnly && !linked && <button onClick={del} style={textBtn}>Delete</button>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={textBtn}>Cancel</button>
          {!isReadOnly && <button onClick={save} disabled={busy} data-testid="sheet-save" style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{busy ? "Saving…" : "Save"}</button>}
        </div>
      </div>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {linked
          ? <div style={{ fontSize: 12.5, color: T.ink3 }}>{t.link_kind === "next_step" ? "This is a next step on the Thread. Its day moves the step too." : "This is a grant deadline. Its day moves the deadline too."}</div>
          : <label style={lbl}>Task<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={inp} /></label>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...lbl, flex: "1 1 140px" }}>Day<input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} style={inp} /></label>
          <label style={{ ...lbl, flex: "1 1 100px" }}>Time<input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} style={inp} /></label>
          <label style={{ ...lbl, flex: "1 1 110px" }}>Kind
            <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} style={inp}>{TASK_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          </label>
          <label style={{ ...lbl, flex: "1 1 110px" }}>Priority
            <select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} style={inp}><option value="medium">Normal</option><option value="high">High</option></select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...lbl, flex: "1 1 180px" }}>Owner
            <select value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: e.target.value })} data-testid="sheet-owner" style={inp}>
              <option value="">Nobody yet</option>
              {team.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </label>
          {!linked && <label style={{ ...lbl, flex: "1 1 180px" }}>Repeats
            <select value={f.recur ? JSON.stringify(f.recur) : ""} onChange={e => setF({ ...f, recur: e.target.value ? JSON.parse(e.target.value) : null })} style={inp}>
              <option value="">Does not repeat</option>
              <option value={JSON.stringify({ every: "week" })}>Every week</option>
              <option value={JSON.stringify({ every: "month" })}>Every month, same day</option>
              <option value={JSON.stringify({ every: "month", nth: 1, weekday: 1 })}>Every month, first Monday</option>
              <option value={JSON.stringify({ every: "quarter" })}>Every quarter</option>
              {f.recur && ![`{"every":"week"}`, `{"every":"month"}`, `{"every":"month","nth":1,"weekday":1}`, `{"every":"quarter"}`].includes(JSON.stringify(f.recur)) && <option value={JSON.stringify(f.recur)}>{recurPhrase(f.recur)}</option>}
            </select>
          </label>}
        </div>
        {(f.assignedTo || "") !== (t.assigned_to || "") && (
          <label style={lbl}>A note for them<input value={f.reassignNote} onChange={e => setF({ ...f, reassignNote: e.target.value })} placeholder="She asked for you by name." style={inp} /></label>
        )}
        {t.reassign_note && <div style={{ fontSize: 12.5, color: T.ink2 }}>Handed over with: {t.reassign_note}</div>}
        <label style={lbl}>Notes<textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} rows={3} style={{ ...inp, resize: "vertical" }} /></label>
        <div style={lbl}>Checklist
          {f.checklist.map((i, n) => (
            <label key={n} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              <input type="checkbox" checked={!!i.done} onChange={() => setF({ ...f, checklist: f.checklist.map((x, m) => m === n ? { ...x, done: !x.done } : x) })} />
              <span style={{ flex: 1, textDecoration: i.done ? "line-through" : "none" }}>{i.text}</span>
              <button onClick={() => setF({ ...f, checklist: f.checklist.filter((_, m) => m !== n) })} aria-label={`Remove ${i.text}`} style={textBtn}>Remove</button>
            </label>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add an item"
              onKeyDown={e => { if (e.key === "Enter" && newItem.trim()) { setF({ ...f, checklist: [...f.checklist, { text: newItem.trim(), done: false }] }); setNewItem(""); } }} style={inp} />
            <button onClick={() => { if (newItem.trim()) { setF({ ...f, checklist: [...f.checklist, { text: newItem.trim(), done: false }] }); setNewItem(""); } }} style={outlineBtn}>Add</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Done properly: how did it go, and what's next ────────────────────────
function FinishSheet({ t, today, onClose, onDone }) {
  const [line, setLine] = useState("");
  const [reached, setReached] = useState(true);
  const [next, setNext] = useState({ label: "", due: addDays(today, 7) });
  const [none, setNone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isCall = t.kind === "call";
  const emailed = !!t.emailInteractionId;   // FIX-34: the email is sent and logged; only the next step is asked
  const ready = (emailed || line.trim()) && (none || (next.label.trim() && next.due));
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      if (emailed) {
        const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: true, interactionId: t.emailInteractionId,
          nextStep: none ? { skipped: true } : { type: "follow_up", label: next.label.trim(), due: next.due } }) });
        await onDone(row); setBusy(false); return;
      }
      const touch = isCall ? (reached ? "call_reached" : "call_no_answer") : "meeting";
      const c = await apiFetch(`/donors/${t.donor_id}/conversations`, { method: "POST", body: JSON.stringify({
        touch, line: line.trim(), nextStep: none ? { skipped: true } : { type: "follow_up", label: next.label.trim(), due: next.due } }) });
      const row = await apiFetch(`/tasks/${t.id}/complete`, { method: "POST", body: JSON.stringify({ done: true, interactionId: c.interactionId }) });
      await onDone(row);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} title={emailed ? `The email to ${t.donor_name || "them"} is sent` : `${isCall ? "The call" : "The meeting"} with ${t.donor_name || "them"}`} width={480}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={textBtn}>Cancel</button>
        <button onClick={save} disabled={!ready || busy} data-testid="finish-save"
          style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !ready || busy ? 0.5 : 1 }}>Save and mark done</button>
      </div>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {emailed && <div style={{ fontSize: 13, color: T.ink2 }}>It is on their timeline. Say what comes next, or "No next step", to finish the task.</div>}
        {isCall && !emailed && <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
          <label><input type="radio" checked={reached} onChange={() => setReached(true)} /> Reached them</label>
          <label><input type="radio" checked={!reached} onChange={() => setReached(false)} /> No answer</label>
        </div>}
        {!emailed && <label style={lbl}>How did it go?
          <textarea autoFocus value={line} onChange={e => setLine(e.target.value)} rows={2} data-testid="finish-line" placeholder="She will bring two tables to the gala." style={{ ...inp, resize: "vertical" }} />
        </label>}
        <div style={lbl}>What's next?
          {!none && <div style={{ display: "flex", gap: 8 }}>
            <input value={next.label} onChange={e => setNext({ ...next, label: e.target.value })} data-testid="finish-next" placeholder="Send the table details" style={{ ...inp, flex: 2 }} />
            <input type="date" value={next.due} onChange={e => setNext({ ...next, due: e.target.value })} data-testid="finish-next-due" style={{ ...inp, flex: 1 }} />
          </div>}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            <input type="checkbox" checked={none} onChange={e => setNone(e.target.checked)} data-testid="finish-none" /> No next step
          </label>
        </div>
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
      </div>
    </Modal>
  );
}

function SnoozeSheet({ t, today, onClose, onSnooze }) {
  const [day, setDay] = useState(addDays(today, 1));
  const [reason, setReason] = useState("");
  return (
    <Modal onClose={onClose} title={`Snooze: ${t.title}`} width={420}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={textBtn}>Cancel</button>
        <button onClick={() => onSnooze(t, day, reason.trim())} data-testid="snooze-save" disabled={!day || day <= today}
          style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Snooze to {fmtDayShort(day)}</button>
      </div>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setDay(addDays(today, 1))} aria-pressed={day === addDays(today, 1)} style={outlineBtn}>Tomorrow</button>
          <button onClick={() => setDay(nextMonday(today))} aria-pressed={day === nextMonday(today)} style={outlineBtn}>Next week</button>
          <input type="date" value={day} min={addDays(today, 1)} onChange={e => setDay(e.target.value)} aria-label="Pick a day" style={{ ...inp, width: "auto" }} />
        </div>
        <label style={lbl}>Why (kept on the task)<input value={reason} onChange={e => setReason(e.target.value)} data-testid="snooze-reason" placeholder="She is travelling until Monday." style={inp} /></label>
      </div>
    </Modal>
  );
}

function BulkBar({ n, team, today, allPicked, onAll, onClear, onBulk }) {
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(addDays(today, 1));
  return (
    <div data-testid="tasks-bulk" style={{ position: "sticky", top: 0, zIndex: 20,
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: T.ink, color: T.white, borderRadius: 10, padding: "10px 12px", boxShadow: T.shadow }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
        <input type="checkbox" checked={allPicked} onChange={onAll} aria-label="Select all" /> {n} selected
      </label>
      <select value={who} onChange={e => setWho(e.target.value)} aria-label="Reassign to" data-testid="bulk-who" style={{ ...inp, width: "auto", padding: "5px 8px" }}>
        <option value="">Reassign to…</option>
        {team.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
      </select>
      {who && <input value={note} onChange={e => setNote(e.target.value)} placeholder="A note (optional)" style={{ ...inp, width: 160, padding: "5px 8px" }} />}
      {who && <button onClick={() => onBulk("reassign", { assignedTo: who, note })} data-testid="bulk-reassign" style={barBtn}>Reassign</button>}
      <input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label="Move to" style={{ ...inp, width: "auto", padding: "5px 8px" }} />
      <button onClick={() => onBulk("move", { due: day })} data-testid="bulk-move" style={barBtn}>Move</button>
      <button onClick={() => onBulk("done")} data-testid="bulk-done" style={barBtn}>Mark done</button>
      <button onClick={() => onBulk("delete")} data-testid="bulk-delete" style={barBtn}>Delete</button>
      <button onClick={onClear} data-testid="bulk-cancel" style={{ ...barBtn, background: "transparent", border: "none", color: T.white, textDecoration: "underline" }}>Cancel</button>
    </div>
  );
}

// ── FIX-34 · The draft a Thank-you or an Email task opens ───────────────────
// The org's own template (Templates), filled for this person, in words she can
// change. Send is hers: it goes through the one draft sender and the mail
// rules. A thank-you can also be marked sent (she thanked them another way).
function DraftSheet({ t, mode, onClose, onThanked, onEmailed }) {
  const thank = mode === "thank";
  const [info, setInfo] = useState(null);
  const [kind, setKind] = useState(thank ? "" : "blank");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const first = String(t.donor_name || "").trim().split(/\s+/)[0] || "";
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const i = await apiFetch(`/tasks/${t.id}/thank`);
        if (!live) return;
        setInfo(i);
        if (thank) setKind(THANK_KIND(i.giftCount || 1));
      } catch (e) { if (live) setErr(errorMessage(e, "The draft could not be opened.")); }
    })();
    return () => { live = false; };
  }, [t.id, thank]);
  useEffect(() => {
    if (!kind) return;
    if (kind === "blank") { setSubject(t.title || ""); setBody(`Dear ${first},\n\n`); return; }
    apiFetch(`/templates/${kind}/preview`, { method: "POST", body: JSON.stringify({ donorId: t.donor_id }) })
      .then(r => { setSubject(r.subject || ""); setBody(r.body || ""); })
      .catch(e => setErr(errorMessage(e, "The template could not be filled.")));
  }, [kind, t.donor_id, t.title, first]);
  const email = info && info.donor && info.donor.email;
  const gift = info && info.gift;
  const go = async (how) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      if (thank) {
        const r = await apiFetch(`/tasks/${t.id}/thank`, { method: "POST", body: JSON.stringify({ mode: how, giftId: gift && gift.id, subject, body }) });
        await onThanked(r);
      } else {
        const r = await apiFetch(`/tasks/${t.id}/email`, { method: "POST", body: JSON.stringify({ subject, body }) });
        onEmailed(r);
      }
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That did not send.")); }
    setBusy(false);
  };
  const ready = subject.trim() && body.trim();
  const primary = { background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 16px", minHeight: 44, color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" };
  return (
    <Modal onClose={onClose} title={thank ? `Thank ${t.donor_name || "them"}` : `Email ${t.donor_name || "them"}`} width={560}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={onClose} style={textBtn}>Cancel</button>
        {thank && <button onClick={() => go("mark")} disabled={busy || !gift} data-testid="draft-mark-sent" style={{ ...outlineBtn, opacity: busy || !gift ? 0.5 : 1 }}>Mark sent</button>}
        <button onClick={() => go("send")} disabled={busy || !ready || !email || (thank && !gift)} data-testid="draft-send"
          style={{ ...primary, opacity: busy || !ready || !email || (thank && !gift) ? 0.5 : 1 }}>Send</button>
      </div>}>
      <div data-testid="task-draft" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: T.ink2 }}>
          {thank
            ? (gift ? `For the gift of $${Number(gift.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} on ${fmtDayShort(gift.date)}. Sending it, or marking it sent, thanks that gift and finishes this task.`
                    : info ? "There is no gift on file to thank them for yet." : "Opening the draft…")
            : "Sending it puts the email on their timeline. Then say what comes next."}
          {info && !email && " They have no email address on file, so this one can only be marked sent."}
        </div>
        {!thank && <label style={lbl}>Start from
          <select value={kind} onChange={e => setKind(e.target.value)} data-testid="draft-template" style={inp}>
            <option value="blank">A blank email</option>
            {EMAIL_KINDS.map(k => <option key={k} value={k}>{KIND_TEMPLATE_LABEL[k]}</option>)}
          </select></label>}
        <label style={lbl}>Subject
          <input value={subject} onChange={e => setSubject(e.target.value)} data-testid="draft-subject" style={inp} /></label>
        <label style={lbl}>Words
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={9} data-testid="draft-body" style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} /></label>
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
      </div>
    </Modal>
  );
}

// PARITY-3 Part 4 · THE SCHEDULE.
//
// Four views of one read (GET /volunteer-hub/schedule): Day, Week, Month and
// List. Every shift shows its footer (needed, scheduled, short, waitlisted,
// hours), each number defined where it is shown, and opens its people. A
// shift short of people is marked in brass, the codebase's overdue colour;
// a conflict (somebody on two shifts at once) is marked on the person.
//
// Roster mode is the same read laid out as people by shift, for dragging a
// person onto a role. To send is the queue of reminders and thank-yous
// Steward drafted: nothing reaches a volunteer until somebody here presses
// Send.
import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch, API } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { displayDate } from "../../../shared/displayDate";
import { addDaysCivil } from "../../../shared/volunteerShifts.js";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { background: T.green, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: T.ink, cursor: "pointer" };
const btnDanger = { ...btnQuiet, color: T.ink, borderColor: T.ink };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.green, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left", fontFamily: "inherit" };
const card = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "16px 18px" };
const eyebrow = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };
const lbl = { display: "block", fontSize: 12, fontWeight: 700, color: T.ink3, margin: "10px 0 4px" };
const COLOUR_NAMES = { "#0d5c3a": "Emerald", "#c9a84c": "Brass", "#0f1a12": "Ink" };
const VIEWS = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "list", label: "List" }];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOf(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return addDaysCivil(iso, -((d.getUTCDay() + 6) % 7));
}
function rangeFor(view, anchor) {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") { const f = mondayOf(anchor); return { from: f, to: addDaysCivil(f, 6) }; }
  if (view === "month") {
    const first = anchor.slice(0, 8) + "01";
    const f = mondayOf(first);
    return { from: f, to: addDaysCivil(f, 41) };
  }
  return { from: anchor, to: addDaysCivil(anchor, 34) };
}
function step(view, anchor, dir) {
  if (view === "day") return addDaysCivil(anchor, dir);
  if (view === "week") return addDaysCivil(anchor, 7 * dir);
  if (view === "month") {
    let y = +anchor.slice(0, 4), m = +anchor.slice(5, 7) + dir;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  return addDaysCivil(anchor, 35 * dir);
}
const monthWords = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const t12 = hhmm => { const [h, m] = String(hhmm || "").split(":").map(Number); if (Number.isNaN(h)) return hhmm; const ap = h >= 12 ? "pm" : "am"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };

function downloadCsv(path, name) {
  const token = localStorage.getItem("npe_token");
  return fetch(`${API}${path}`, { headers: { Authorization: "Bearer " + token } })
    .then(r => { if (!r.ok) throw new Error("export"); return r.blob(); })
    .then(b => { const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); });
}

// ── THE FOOTER ─────────────────────────────────────────────────────────────
// Five numbers, each with its sentence on hover and focus. The same object
// the CSV and the roster read.
export function ShiftFooter({ footer, defs, compact }) {
  const items = [
    ["needed", "Needed", footer.needed == null ? "No limit" : footer.needed],
    ["scheduled", "Scheduled", footer.scheduled],
    ["short", "Short", footer.short],
    ["waitlisted", "Waitlisted", footer.waitlisted],
    ["hours", "Hours", footer.hours],
  ];
  return (
    <div data-testid="shift-footer" style={{ display: "flex", flexWrap: "wrap", gap: compact ? 8 : 14, fontSize: compact ? 11.5 : 12.5, color: T.ink3, marginTop: 6 }}>
      {items.map(([k, label, v]) => (
        <span key={k} data-foot={k} tabIndex={0} title={defs && defs[k]} aria-label={`${label}: ${v}. ${defs ? defs[k] : ""}`}
          style={{ whiteSpace: "nowrap", color: k === "short" && footer.short > 0 ? T.gold700 : T.ink3, fontWeight: k === "short" && footer.short > 0 ? 800 : 500 }}>
          {label} <strong style={{ color: k === "short" && footer.short > 0 ? T.gold700 : T.ink }}>{v}</strong>
        </span>
      ))}
    </div>
  );
}

function ShiftChip({ s, onOpen, selected, onSelect, compact, isReadOnly }) {
  const bar = s.color || T.green;
  return (
    <div data-testid="shift-chip" data-shift={s.id} data-short={s.footer.short > 0 ? "1" : "0"}
      style={{ display: "flex", gap: 8, alignItems: "flex-start", background: T.white, border: "1px solid " + (s.footer.short > 0 ? T.gold : T.bg2),
               borderLeft: `4px solid ${bar}`, borderRadius: 10, padding: compact ? "6px 8px" : "9px 11px", minWidth: 0 }}>
      {!isReadOnly && onSelect && <input type="checkbox" aria-label={`Select ${s.name}, ${s.when}`} checked={!!selected} onChange={e => onSelect(s.id, e.target.checked)} style={{ marginTop: 3 }} />}
      <button onClick={() => onOpen(s)} style={{ ...btnLink, color: T.ink, fontWeight: 600, flex: 1, minWidth: 0, fontSize: compact ? 12 : 13 }}>
        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: compact ? "nowrap" : "normal" }}>{s.name}</div>
        <div style={{ fontSize: 11.5, color: T.ink3, fontWeight: 500 }}>{t12(s.startTime)} to {t12(s.endTime)}{s.venue && !compact ? ` · ${s.venue}` : ""}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
          {!s.published && <span style={{ fontSize: 10.5, fontWeight: 800, color: T.ink3, border: "1px solid " + T.bg3, borderRadius: 999, padding: "0 6px" }}>Draft</span>}
          {s.footer.short > 0 && <span data-testid="shift-short" style={{ fontSize: 10.5, fontWeight: 800, color: T.gold700, background: T.gold100, borderRadius: 999, padding: "0 6px" }}>{s.footer.short} short</span>}
          {s.conflicts > 0 && <span data-testid="shift-conflict" style={{ fontSize: 10.5, fontWeight: 800, color: T.ink, background: T.bg2, borderRadius: 999, padding: "0 6px" }}>{s.conflicts} {s.conflicts === 1 ? "conflict" : "conflicts"}</span>}
          {compact && <span style={{ fontSize: 10.5, color: T.ink3 }}>{s.footer.scheduled}{s.footer.needed != null ? ` of ${s.footer.needed}` : ""}</span>}
        </div>
      </button>
    </div>
  );
}

// ── THE SCHEDULE ───────────────────────────────────────────────────────────
export function ScheduleView({ isReadOnly, narrow, onOpenPerson, initialSlot }) {
  const [view, setView] = useState(() => (narrow ? "list" : "week"));
  const [anchor, setAnchor] = useState(null);
  const [opp, setOpp] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [problems, setProblems] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    const base = anchor || "";
    const r = base ? rangeFor(view, base) : null;
    const qs = new URLSearchParams({ ...(r ? { from: r.from, to: r.to } : {}), ...(opp ? { opportunityId: opp } : {}) }).toString();
    apiFetch(`/volunteer-hub/schedule?${qs}`).then(d => {
      if (!base) {
        setAnchor(view === "month" ? d.today.slice(0, 8) + "01" : d.today);
        return;
      }
      setData(d); setErr("");
    }).catch(e => setErr(errorMessage(e, "The schedule did not load.")));
  }, [anchor, view, opp]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!initialSlot || !data) return;
    const s = data.shifts.find(x => x.id === initialSlot);
    if (s) setOpen(s);
  }, [initialSlot, data]);

  const shifts = data ? data.shifts : [];
  const range = anchor ? rangeFor(view, anchor) : null;
  const toggle = (id, on) => setSelected(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });
  const byDay = useMemo(() => {
    const m = new Map();
    for (const s of shifts) { if (!m.has(s.date)) m.set(s.date, []); m.get(s.date).push(s); }
    return m;
  }, [shifts]);
  const refreshOpen = id => { load(); if (id) apiFetch(`/volunteer-hub/schedule?from=${open ? open.date : ""}&to=${open ? open.date : ""}`).then(d => { const s = d.shifts.find(x => x.id === id); if (s) setOpen(s); }).catch(() => {}); };

  const openProblems = which => apiFetch("/volunteer-hub/schedule/problems").then(p => setProblems({ ...p, which })).catch(e => setNote(errorMessage(e, "That did not load.")));

  if (err) return <div style={card}><div role="alert" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!data || !range) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;

  const title = view === "day" ? displayDate(anchor) : view === "week" ? `${shortDay(range.from)} to ${shortDay(range.to)}` : view === "month" ? monthWords(anchor) : `${shortDay(range.from)} to ${shortDay(range.to)}`;
  const chip = (s, compact) => <ShiftChip key={s.id} s={s} compact={compact} onOpen={setOpen} selected={selected.has(s.id)} onSelect={toggle} isReadOnly={isReadOnly} />;

  return (
    <div data-testid="vol-schedule" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* The two week numbers, each opening its rows. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[["short", "Shifts short this week", data.week.short, "Published shifts this week, Monday to Sunday, where at least one role still needs people."],
          ["conflicts", "Schedule conflicts this week", data.week.conflicts, "The same person with a place on two shifts that overlap in time. Back to back is not a conflict."]].map(([k, label, v, def]) => (
          <button key={k} data-testid={`sched-${k}`} onClick={() => openProblems(k)} title={def} aria-label={`${label}: ${v}. ${def}`}
            style={{ ...card, padding: "10px 14px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 170 }}>
            <div style={eyebrow}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: v > 0 ? T.gold700 : T.ink }}>{v}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div role="tablist" aria-label="Calendar view" style={{ display: "flex", border: "1px solid " + T.bg3, borderRadius: 9, overflow: "hidden" }}>
          {VIEWS.map(v => (
            <button key={v.id} role="tab" aria-selected={view === v.id} data-testid={`sched-view-${v.id}`} onClick={() => { setView(v.id); if (v.id === "month") setAnchor(a => a.slice(0, 8) + "01"); }}
              style={{ background: view === v.id ? T.ink : T.white, color: view === v.id ? T.white : T.ink, border: "none", padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{v.label}</button>
          ))}
        </div>
        <button style={btnQuiet} aria-label="Earlier" onClick={() => setAnchor(step(view, anchor, -1))}>‹</button>
        <button style={btnQuiet} onClick={() => setAnchor(view === "month" ? data.today.slice(0, 8) + "01" : data.today)}>Today</button>
        <button style={btnQuiet} aria-label="Later" onClick={() => setAnchor(step(view, anchor, 1))}>›</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginLeft: 4 }} data-testid="sched-title">{title}</div>
        <div style={{ flex: 1 }} />
        <select aria-label="Opportunity" value={opp} onChange={e => setOpp(e.target.value)} style={inp}>
          <option value="">Every opportunity</option>
          {data.opportunities.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {!isReadOnly && <button style={btnPrimary} data-testid="sched-new" onClick={() => setCreating(true)}>New shift</button>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3 }}>{data.sentence}</div>
      {note && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{note}</div>}

      {selected.size > 0 && !isReadOnly && (
        <BulkBar ids={[...selected]} shifts={shifts} onDone={msg => { setNote(msg); setSelected(new Set()); load(); }} onClear={() => setSelected(new Set())} />
      )}

      {view === "week" && !narrow && (
        <div data-testid="sched-week" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8 }}>
          {Array.from({ length: 7 }, (_, i) => addDaysCivil(range.from, i)).map(d => (
            <div key={d} style={{ background: d === data.today ? T.green100 : T.bg, borderRadius: 12, padding: 8, minHeight: 160, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: d === data.today ? T.green : T.ink3 }}>{shortDay(d)}</div>
              {(byDay.get(d) || []).map(s => chip(s, true))}
            </div>
          ))}
        </div>
      )}
      {(view === "day" || (view === "week" && narrow)) && (
        <div data-testid="sched-day" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDaysCivil(range.from, i)).map(d => (
            <div key={d}>
              {view !== "day" && <div style={{ ...eyebrow, margin: "6px 0" }}>{shortDay(d)}</div>}
              {(byDay.get(d) || []).length === 0 && view === "day" && <div style={{ ...card, fontSize: 13, color: T.ink3 }}>No shifts on this day.</div>}
              {(byDay.get(d) || []).map(s => (
                <div key={s.id} style={{ ...card, padding: 10, marginBottom: 8 }}>
                  {chip(s, false)}
                  <ShiftFooter footer={s.footer} defs={data.definitions} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {view === "month" && (
        <div data-testid="sched-month">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
            {WEEKDAYS.map(w => <div key={w} style={{ ...eyebrow, textAlign: "center" }}>{narrow ? w[0] : w}</div>)}
            {Array.from({ length: 42 }, (_, i) => addDaysCivil(range.from, i)).map(d => {
              const list = byDay.get(d) || [];
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              const short = list.some(s => s.footer.short > 0);
              return (
                <button key={d} onClick={() => { setAnchor(d); setView("day"); }} aria-label={`${displayDate(d)}: ${list.length} ${list.length === 1 ? "shift" : "shifts"}${short ? ", short of people" : ""}`}
                  style={{ minHeight: narrow ? 44 : 84, background: d === data.today ? T.green100 : inMonth ? T.white : T.bg, border: "1px solid " + (short ? T.gold : T.bg2), borderRadius: 8, padding: 4, textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: inMonth ? T.ink : T.ink3 }}>{+d.slice(8, 10)}</span>
                  {!narrow && list.slice(0, 3).map(s => (
                    <span key={s.id} style={{ fontSize: 10.5, color: T.ink, borderLeft: `3px solid ${s.color || T.green}`, paddingLeft: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t12(s.startTime)} {s.name}{s.footer.short > 0 ? ` · ${s.footer.short} short` : ""}
                    </span>
                  ))}
                  {!narrow && list.length > 3 && <span style={{ fontSize: 10.5, color: T.ink3 }}>and {list.length - 3} more</span>}
                  {narrow && list.length > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: short ? T.gold700 : T.green }}>{list.length}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {view === "list" && (
        <div data-testid="sched-list" style={{ ...card, padding: 0, overflowX: "auto" }}>
          {!shifts.length && <div style={{ padding: 16, fontSize: 13, color: T.ink3 }}>No shifts in these dates.</div>}
          {shifts.length > 0 && (narrow ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {shifts.map(s => (
                <div key={s.id} style={{ padding: 12, borderTop: "1px solid " + T.bg2 }}>
                  {chip(s, false)}
                  <ShiftFooter footer={s.footer} defs={data.definitions} compact />
                </div>
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: T.ink3, fontSize: 11.5 }}>
                {!isReadOnly && <th style={{ padding: "10px 12px" }}><input type="checkbox" aria-label="Select every shift" checked={shifts.every(s => selected.has(s.id))} onChange={e => setSelected(e.target.checked ? new Set(shifts.map(s => s.id)) : new Set())} /></th>}
                <th style={{ padding: "10px 8px" }}>Shift</th><th>When</th><th>Venue</th>
                {["needed", "scheduled", "short", "waitlisted", "hours"].map(k => <th key={k} title={data.definitions[k]} style={{ textAlign: "right", padding: "0 10px" }}>{k[0].toUpperCase() + k.slice(1)}</th>)}
              </tr></thead>
              <tbody>
                {shifts.map(s => (
                  <tr key={s.id} data-shift={s.id} style={{ borderTop: "1px solid " + T.bg2, background: s.footer.short > 0 ? T.gold50 : undefined }}>
                    {!isReadOnly && <td style={{ padding: "8px 12px" }}><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={e => toggle(s.id, e.target.checked)} /></td>}
                    <td style={{ padding: "8px", borderLeft: `3px solid ${s.color || T.green}` }}>
                      <button style={{ ...btnLink, color: T.ink }} onClick={() => setOpen(s)}>{s.name}</button>
                      {!s.published && <span style={{ fontSize: 11, color: T.ink3 }}> · Draft</span>}
                      {s.conflicts > 0 && <span style={{ fontSize: 11, color: T.ink, fontWeight: 700 }}> · {s.conflicts} {s.conflicts === 1 ? "conflict" : "conflicts"}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{shortDay(s.date)}, {t12(s.startTime)} to {t12(s.endTime)}</td>
                    <td>{[s.venue, s.locationDetail].filter(Boolean).join(", ")}</td>
                    <td style={{ textAlign: "right", padding: "0 10px" }}>{s.footer.needed == null ? "No limit" : s.footer.needed}</td>
                    <td style={{ textAlign: "right", padding: "0 10px" }}>{s.footer.scheduled}</td>
                    <td style={{ textAlign: "right", padding: "0 10px", color: s.footer.short > 0 ? T.gold700 : T.ink, fontWeight: s.footer.short > 0 ? 800 : 400 }}>{s.footer.short}</td>
                    <td style={{ textAlign: "right", padding: "0 10px" }}>{s.footer.waitlisted}</td>
                    <td style={{ textAlign: "right", padding: "0 10px" }}>{s.footer.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      {open && <ShiftDrawer shift={open} defs={data.definitions} isReadOnly={isReadOnly} onClose={() => setOpen(null)}
        onChanged={msg => { if (msg) setNote(msg); refreshOpen(open.id); }} onOpenPerson={onOpenPerson} />}
      {creating && <ShiftEditor opportunities={data.opportunities} date={view === "day" ? anchor : data.today} onClose={() => setCreating(false)}
        onSaved={msg => { setCreating(false); setNote(msg); load(); }} />}
      {problems && (
        <Modal onClose={() => setProblems(null)} width={560} ariaLabel={problems.which === "short" ? "Shifts short this week" : "Schedule conflicts this week"}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{problems.which === "short" ? "Shifts short this week" : "Schedule conflicts this week"}</div>
          <div style={{ fontSize: 12.5, color: T.ink3, margin: "4px 0 12px" }}>{problems.definitions[problems.which]}</div>
          {problems.which === "short" && (problems.short.length ? problems.short.map(s => (
            <div key={s.id} style={{ padding: "8px 0", borderTop: "1px solid " + T.bg2, fontSize: 13 }}>
              <strong>{s.name}</strong> · {s.when} · <span style={{ color: T.gold700, fontWeight: 800 }}>{s.short} short</span> ({s.scheduled} of {s.needed})
            </div>)) : <div style={{ fontSize: 13, color: T.ink3 }}>Every published shift this week has the people it needs.</div>)}
          {problems.which === "conflicts" && (problems.conflicts.length ? problems.conflicts.map((c, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: "1px solid " + T.bg2, fontSize: 13 }}>
              <button style={btnLink} onClick={() => { setProblems(null); onOpenPerson && onOpenPerson({ id: c.personId, name: c.name }); }}>{c.name}</button> is on {c.a.name || "a shift"} ({c.a.when}) and {c.b.name || "another shift"} ({c.b.when}).
            </div>)) : <div style={{ fontSize: 13, color: T.ink3 }}>Nobody is on two shifts at once this week.</div>)}
        </Modal>
      )}
    </div>
  );
}

// ── BULK, ON SELECTED SHIFTS ──────────────────────────────────────────────
function BulkBar({ ids, shifts, onDone, onClear }) {
  const [mode, setMode] = useState(null);
  const [weeks, setWeeks] = useState("4");
  const [days, setDays] = useState("7");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async payload => {
    setBusy(true); setErr("");
    try { const r = await apiFetch("/volunteer-hub/slots/bulk", { method: "POST", body: JSON.stringify({ ids, ...payload }) }); onDone(r.message); setMode(null); }
    catch (e) { setErr(errorMessage(e, "That did not work.")); }
    setBusy(false);
  };
  const people = shifts.filter(s => ids.includes(s.id)).reduce((a, s) => a + s.footer.scheduled + s.footer.waitlisted, 0);
  return (
    <div data-testid="sched-bulk" style={{ ...card, background: T.ground, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{ids.length} {ids.length === 1 ? "shift" : "shifts"} selected</strong>
        <button style={btnQuiet} onClick={() => setMode("copy")}>Copy weekly</button>
        <button style={btnQuiet} onClick={() => setMode("move")}>Move</button>
        <button style={btnQuiet} onClick={() => setMode("settings")}>Change settings</button>
        <button style={btnQuiet} onClick={() => downloadCsv(`/volunteer-hub/slots/export.csv?ids=${ids.join(",")}`, "shifts.csv").catch(() => setErr("The export did not download."))}>Export CSV</button>
        <button style={btnQuiet} onClick={() => setMode("message")}>Draft a message</button>
        <button style={btnDanger} onClick={() => setMode("delete")}>Delete</button>
        <button style={btnLink} onClick={onClear}>Clear</button>
      </div>
      {mode === "copy" && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>Repeat every week for</span>
        <input aria-label="Weeks" inputMode="numeric" value={weeks} onChange={e => setWeeks(e.target.value)} style={{ ...inp, width: 60 }} />
        <span style={{ fontSize: 13 }}>weeks, with the same times and roles and nobody on them yet.</span>
        <button style={btnPrimary} disabled={busy} onClick={() => go({ action: "copy", weeks: Number(weeks) })}>Copy</button></div>}
      {mode === "move" && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>Move by</span>
        <input aria-label="Days" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} style={{ ...inp, width: 60 }} />
        <span style={{ fontSize: 13 }}>days (a minus number moves them earlier). Everyone on them keeps their place.</span>
        <button style={btnPrimary} disabled={busy} onClick={() => go({ action: "move", days: Number(days) })}>Move</button></div>}
      {mode === "settings" && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={btnQuiet} disabled={busy} onClick={() => go({ action: "settings", published: true })}>Publish</button>
        <button style={btnQuiet} disabled={busy} onClick={() => go({ action: "settings", published: false })}>Make draft</button>
        {Object.entries(COLOUR_NAMES).map(([hex, name]) => (
          <button key={hex} style={{ ...btnQuiet, borderLeft: `6px solid ${hex}` }} disabled={busy} onClick={() => go({ action: "settings", color: hex })}>{name}</button>))}
      </div>}
      {mode === "message" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12.5, color: T.ink3 }}>One draft per person on these shifts ({people} places). Write {"{{first_name}}"} to use their first name. Nothing is sent until you press Send in To send.</div>
        <input aria-label="Subject" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
        <textarea aria-label="Message" rows={4} placeholder="Dear {{first_name}}," value={body} onChange={e => setBody(e.target.value)} style={inp} />
        <div><button style={btnPrimary} disabled={busy} onClick={() => go({ action: "message", subject, body })}>Write the drafts</button></div>
      </div>}
      {mode === "delete" && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>Delete {ids.length} {ids.length === 1 ? "shift" : "shifts"}{people ? `, taking ${people} ${people === 1 ? "person" : "people"} off them` : ""}? Steward will not write to anybody.</span>
        <button style={{ ...btnPrimary, background: T.terra700 }} disabled={busy} onClick={() => go({ action: "delete" })}>Delete</button></div>}
      {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
    </div>
  );
}

// ── ONE SHIFT: ITS SETTINGS, ITS ROLES, ITS PEOPLE ─────────────────────────
// CAL-1 Part 3 · THE SHIFT FORM. One clean event form for a shift, the same
// from the calendar and from Volunteers: the title, the date with start and
// end on one row, all day, repeat (weekly on that day, until a date), venue
// and room, roles with how many each, places, published, colour from the
// palette, and notes. Saving is the shift's own route (PATCH or POST
// /volunteer-hub/slots), so it is one audit write; a change offers Undo,
// which puts the old values back through the same route.
const SHIFT_COLOURS = [["#0d5c3a", "Emerald"], ["#c9a84c", "Brass"], ["#0f1a12", "Ink"]];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function ShiftEditor({ shift, opportunities = [], date, startTime, endTime, onClose, onSaved }) {
  const editing = !!shift;
  const [opps, setOpps] = useState(opportunities);
  useEffect(() => { if (!editing && !opportunities.length) apiFetch("/volunteer-hub/opportunities").then(d => setOpps(d.opportunities || [])).catch(() => {}); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const wasAllDay = shift && shift.startTime === "00:00" && shift.endTime === "23:59";
  const [f, setF] = useState(() => ({
    opportunityId: shift ? shift.opportunityId : (opportunities[0] && opportunities[0].id) || "",
    name: shift ? shift.ownName || shift.name || "" : "", color: shift ? shift.color || "" : "",
    date: shift ? shift.date : date, startTime: shift ? shift.startTime : (startTime || "09:00"), endTime: shift ? shift.endTime : (endTime || "12:00"),
    allDay: !!wasAllDay, repeat: false, until: "",
    venue: shift ? shift.ownVenue || shift.venue || "" : "", locationDetail: shift ? shift.locationDetail || "" : "",
    published: shift ? shift.published !== false : true, capacity: shift && shift.capacity != null ? String(shift.capacity) : "",
    notes: shift ? shift.notes || "" : "",
    roles: shift ? (shift.roles || []).map(r => ({ id: r.id, name: r.name, needed: String(r.needed) })) : [],
  }));
  useEffect(() => { if (!editing && !f.opportunityId && opps[0]) setF(p => ({ ...p, opportunityId: opps[0].id })); }, [opps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = k => e => setF(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setRole = (i, k, v) => setF(p => ({ ...p, roles: p.roles.map((r, j) => j === i ? { ...r, [k]: v } : r) }));
  const weekday = f.date ? WEEKDAY_LONG[new Date(Date.UTC(+f.date.slice(0, 4), +f.date.slice(5, 7) - 1, +f.date.slice(8, 10))).getUTCDay()] : "";
  const save = async () => {
    setBusy(true); setErr("");
    const times = f.allDay ? { startTime: "00:00", endTime: "23:59" } : { startTime: f.startTime, endTime: f.endTime };
    const body = { opportunityId: f.opportunityId, name: f.name, color: f.color, date: f.date, ...times, venue: f.venue, locationDetail: f.locationDetail,
      published: f.published, notes: f.notes, capacity: f.roles.length ? null : f.capacity,
      roles: f.roles.map(r => ({ ...(r.id ? { id: r.id } : {}), name: r.name, needed: Number(r.needed) })),
      ...(!editing && f.repeat && f.until ? { repeat: { weeklyUntil: f.until } } : {}) };
    try {
      if (editing) {
        const was = { name: shift.ownName || "", color: shift.color || "", date: shift.date, startTime: shift.startTime, endTime: shift.endTime,
          venue: shift.ownVenue || "", locationDetail: shift.locationDetail || "", published: shift.published !== false, notes: shift.notes || "",
          capacity: shift.capacity != null ? String(shift.capacity) : null };
        const r = await apiFetch(`/volunteer-hub/slots/${shift.id}`, { method: "PATCH", body: JSON.stringify(body) });
        offerUndo({ message: "Shift changed.", undoAction: () => apiFetch(`/volunteer-hub/slots/${shift.id}`, { method: "PATCH", body: JSON.stringify(was) }) }, "shift", () => onSaved && onSaved("Put back."));
        onSaved(r.message || "Shift saved.");
      } else {
        const r = await apiFetch("/volunteer-hub/slots", { method: "POST", body: JSON.stringify(body) });
        onSaved(r.count > 1 ? `${r.count} shifts added, every ${weekday} until ${f.until}.` : "Shift added.");
      }
    } catch (e) { setErr(errorMessage(e, "That shift did not save.")); }
    setBusy(false);
  };
  const row = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" };
  return (
    <Modal onClose={onClose} width={560} ariaLabel={editing ? "Change this shift" : "New shift"}>
      <div data-testid="shift-form" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 2 }}>{editing ? "Change this shift" : "New shift"}</div>
        <label style={lbl} htmlFor="se-name">Title</label>
        <input id="se-name" data-testid="shift-title" placeholder={editing ? (shift.opportunityName || "The opportunity's name") : "The opportunity's name"} value={f.name} onChange={set("name")} style={{ ...inp, width: "100%", fontSize: 15 }} />
        {!editing && <><label style={lbl} htmlFor="se-opp">Opportunity</label>
          <select id="se-opp" value={f.opportunityId} onChange={set("opportunityId")} style={{ ...inp, width: "100%" }}>
            {opps.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></>}
        <label style={lbl}>When</label>
        <div style={row}>
          <input aria-label="Date" id="se-date" type="date" value={f.date} onChange={set("date")} style={{ ...inp, flex: "1 1 150px" }} />
          {!f.allDay && <>
            <input aria-label="Starts" id="se-start" type="time" value={f.startTime} onChange={set("startTime")} style={{ ...inp, flex: "0 1 110px" }} />
            <span style={{ color: T.ink3, fontSize: 13, paddingBottom: 9 }}>to</span>
            <input aria-label="Ends" id="se-end" type="time" value={f.endTime} onChange={set("endTime")} style={{ ...inp, flex: "0 1 110px" }} />
          </>}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" data-testid="shift-all-day" checked={f.allDay} onChange={set("allDay")} /> All day</label>
          {!editing && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" data-testid="shift-repeat" checked={f.repeat} onChange={set("repeat")} /> Repeat weekly on {weekday || "this day"}</label>}
          {!editing && f.repeat && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>until <input aria-label="Repeat until" type="date" value={f.until} min={f.date} onChange={set("until")} style={inp} /></label>}
        </div>
        <div style={row}>
          <div style={{ flex: "1 1 180px" }}><label style={lbl} htmlFor="se-venue">Venue</label><input id="se-venue" value={f.venue} onChange={set("venue")} style={{ ...inp, width: "100%" }} /></div>
          <div style={{ flex: "1 1 180px" }}><label style={lbl} htmlFor="se-loc">Room</label><input id="se-loc" placeholder="Loading dock, Room 2" value={f.locationDetail} onChange={set("locationDetail")} style={{ ...inp, width: "100%" }} /></div>
        </div>
        <label style={lbl}>Roles, and how many people each needs</label>
        {f.roles.map((r, i) => (
          <div key={r.id || i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input aria-label={`Role ${i + 1} name`} placeholder="Sorting" value={r.name} onChange={e => setRole(i, "name", e.target.value)} style={{ ...inp, flex: 2, minWidth: 0 }} />
            <input aria-label={`Role ${i + 1} people needed`} inputMode="numeric" value={r.needed} onChange={e => setRole(i, "needed", e.target.value)} style={{ ...inp, width: 64 }} />
            <button type="button" style={btnQuiet} aria-label={`Remove role ${i + 1}`} onClick={() => setF(p => ({ ...p, roles: p.roles.filter((_, j) => j !== i) }))}>Remove</button>
          </div>))}
        <button type="button" style={btnLink} onClick={() => setF(p => ({ ...p, roles: [...p.roles, { name: "", needed: "1" }] }))}>Add a role</button>
        {!f.roles.length && <><label style={lbl} htmlFor="se-cap">Places (empty for no limit)</label><input id="se-cap" inputMode="numeric" value={f.capacity} onChange={set("capacity")} style={{ ...inp, width: 100 }} /></>}
        <label style={lbl}>Colour</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SHIFT_COLOURS.map(([hex, name]) => (
            <button key={hex} type="button" aria-pressed={f.color === hex} onClick={() => setF(p => ({ ...p, color: hex }))}
              style={{ ...btnQuiet, borderLeft: `8px solid ${hex}`, fontWeight: f.color === hex ? 800 : 500, outline: f.color === hex ? `2px solid ${T.ink}` : "none" }}>{name}</button>))}
        </div>
        <label style={lbl} htmlFor="se-notes">Notes</label>
        <textarea id="se-notes" rows={3} value={f.notes} onChange={set("notes")} placeholder="What to bring, where to park" style={{ ...inp, width: "100%", resize: "vertical" }} />
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 12 }}>
          <input type="checkbox" checked={f.published} onChange={set("published")} /> Published: volunteers can see it and sign up. A draft is only yours.
        </label>
        {err && <div role="alert" style={{ fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button type="button" data-testid="shift-save" style={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : editing ? "Save" : "Add the shift"}</button>
          <button type="button" style={btnQuiet} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ShiftDrawer({ shift, defs, isReadOnly, onClose, onChanged, onOpenPerson }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(null);   // role id (or "" for no role)
  const [roster, setRoster] = useState(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (adding !== null && !roster) apiFetch("/volunteer-hub/roster").then(setRoster).catch(() => setRoster({ people: [] })); }, [adding, roster]);
  const act = async (path, body, fallback) => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); setMsg(r.message || ""); onChanged(r.message); }
    catch (e) { setMsg(errorMessage(e, fallback)); }
    setBusy(false);
  };
  const groups = shift.roles.length ? shift.roles : [{ id: "", name: "People", needed: shift.capacity, scheduled: shift.footer.scheduled, waitlisted: shift.footer.waitlisted, short: shift.footer.short, people: shift.people }];
  const onShift = new Set([...shift.people, ...shift.roles.flatMap(r => r.people)].map(p => p.personId));
  const candidates = ((roster && roster.people) || []).filter(p => !onShift.has(p.id) && (!search || String(p.name).toLowerCase().includes(search.toLowerCase()))).slice(0, 8);
  return (
    <Modal onClose={onClose} width={620} align="right" ariaLabel={`${shift.name}, ${shift.when}`}>
      <div data-testid="shift-drawer" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ borderLeft: `5px solid ${shift.color || T.green}`, paddingLeft: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{shift.name}</div>
          <div style={{ fontSize: 13, color: T.ink3 }}>{shift.when}{shift.venue ? ` · ${shift.venue}` : ""}{shift.locationDetail ? `, ${shift.locationDetail}` : ""}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>{shift.opportunityName} · {shift.published ? "Published" : "Draft: volunteers cannot see it"}</div>
        </div>
        <ShiftFooter footer={shift.footer} defs={defs} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isReadOnly && <button style={btnQuiet} onClick={() => setEditing(true)}>Change shift</button>}
          {!isReadOnly && <button style={btnQuiet} disabled={busy} onClick={() => act(`/volunteer-hub/slots/bulk`, { ids: [shift.id], action: "settings", published: !shift.published }, "That did not change.")}>{shift.published ? "Make draft" : "Publish"}</button>}
          <button style={btnQuiet} onClick={() => { window.dispatchEvent(new CustomEvent("steward:vol-checkin", { detail: shift.id })); onClose(); }}>Check in on this phone</button>
        </div>
        {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
        {groups.map(g => (
          <div key={g.id || "all"} data-role={g.name} style={{ ...card, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{g.name}</div>
              <div style={{ fontSize: 12, color: g.short > 0 ? T.gold700 : T.ink3, fontWeight: g.short > 0 ? 800 : 500 }}>
                {g.scheduled}{g.needed != null ? ` of ${g.needed}` : ""} scheduled{g.short > 0 ? ` · ${g.short} short` : ""}{g.waitlisted ? ` · ${g.waitlisted} waiting` : ""}
              </div>
            </div>
            {!g.people.length && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>Nobody yet.</div>}
            {g.people.map(p => (
              <div key={p.signupId} data-person={p.personId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
                <button style={{ ...btnLink, color: T.ink, fontWeight: 600 }} onClick={() => onOpenPerson && onOpenPerson({ id: p.personId, name: p.name })}>{p.name}</button>
                <span style={{ fontSize: 12, color: T.ink3 }}>
                  {p.status === "waitlisted" ? `Waiting, number ${p.position}` : p.checkedInAt ? "Checked in" : p.status === "completed" ? "Done" : p.status === "no_show" ? "Did not come" : "Confirmed"}
                </span>
                {p.conflict && <span title="On another shift that overlaps this one" style={{ fontSize: 11, fontWeight: 800, color: T.ink, background: T.bg2, borderRadius: 999, padding: "0 6px" }}>Conflict</span>}
                <div style={{ flex: 1 }} />
                {!isReadOnly && shift.roles.length > 1 && ["confirmed", "waitlisted"].includes(p.status) && (
                  <select aria-label={`Move ${p.name} to another role`} value="" onChange={e => e.target.value && act(`/volunteer-hub/signups/${p.signupId}/move`, { roleId: e.target.value }, "That move did not work.")} style={{ ...inp, padding: "4px 6px", fontSize: 12 }}>
                    <option value="">Move to…</option>
                    {shift.roles.filter(r => r.id !== p.roleId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>)}
                {!isReadOnly && ["confirmed", "waitlisted"].includes(p.status) && <button style={btnQuiet} disabled={busy} onClick={() => act(`/volunteer-hub/signups/${p.signupId}/cancel`, {}, "That did not work.")}>Take off</button>}
              </div>
            ))}
            {!isReadOnly && (adding === g.id ? (
              <div style={{ marginTop: 8 }}>
                <input autoFocus aria-label="Find a volunteer" placeholder="Find a volunteer" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: "100%" }} />
                {candidates.map(c => <button key={c.id} style={{ ...btnLink, display: "block", padding: "6px 0" }} disabled={busy}
                  onClick={() => { act("/volunteer-hub/signups", { slotId: shift.id, personId: c.id, ...(g.id ? { roleId: g.id } : {}) }, "That sign-up did not work."); setAdding(null); setSearch(""); }}>{c.name}</button>)}
                {roster && !candidates.length && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>Nobody on the roster matches.</div>}
              </div>
            ) : <button style={{ ...btnLink, marginTop: 8 }} onClick={() => setAdding(g.id)}>Add somebody{g.id ? ` to ${g.name}` : ""}</button>)}
          </div>
        ))}
      </div>
      {editing && <ShiftEditor shift={shift} opportunities={[]} onClose={() => setEditing(false)} onSaved={m => { setEditing(false); onChanged(m); }} />}
    </Modal>
  );
}

// ── ROSTER MODE: PEOPLE BY SHIFT ──────────────────────────────────────────
// The week's shifts across the top, roles under each; volunteers down the
// side. Drag a name onto a role, or (on a phone, or by keyboard) pick a name
// and then press the role. Every placement goes through the one sign-up path,
// so a full role puts them on its waiting list here exactly as anywhere.
export function RosterModeView({ isReadOnly, narrow }) {
  const [anchor, setAnchor] = useState(null);
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState(null);
  const [picked, setPicked] = useState(null);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(() => {
    const qs = anchor ? `?from=${mondayOf(anchor)}&to=${addDaysCivil(mondayOf(anchor), 6)}` : "";
    apiFetch(`/volunteer-hub/schedule${qs}`).then(d => { if (!anchor) setAnchor(d.today); else setData(d); }).catch(e => setMsg(errorMessage(e, "The week did not load.")));
  }, [anchor]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiFetch("/volunteer-hub/roster").then(setRoster).catch(() => setRoster({ people: [] })); }, []);
  const place = async (person, shift, roleId) => {
    if (isReadOnly || !person) return;
    setMsg("");
    try {
      const r = await apiFetch("/volunteer-hub/signups", { method: "POST", body: JSON.stringify({ slotId: shift.id, personId: person.id, ...(roleId ? { roleId } : {}) }) });
      setMsg(r.message); setPicked(null); load();
    } catch (e) { setMsg(errorMessage(e, "That placement did not work.")); }
  };
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>{msg || "Loading…"}</div>;
  const people = ((roster && roster.people) || []).filter(p => !search || String(p.name).toLowerCase().includes(search.toLowerCase()));
  const placeOf = new Map();   // personId|shiftId -> label
  for (const s of data.shifts) {
    for (const r of s.roles) for (const p of r.people) placeOf.set(`${p.personId}|${s.id}`, `${r.name}${p.status === "waitlisted" ? " (waiting)" : ""}`);
    for (const p of s.people) placeOf.set(`${p.personId}|${s.id}`, p.status === "waitlisted" ? "Waiting" : "On");
  }
  const drop = (shift, roleId) => e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); const p = people.find(x => x.id === id) || (roster.people || []).find(x => x.id === id); place(p, shift, roleId); };
  return (
    <div data-testid="vol-roster-mode" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={btnQuiet} aria-label="Earlier week" onClick={() => setAnchor(addDaysCivil(anchor, -7))}>‹</button>
        <strong style={{ fontSize: 14 }}>{shortDay(data.from)} to {shortDay(data.to)}</strong>
        <button style={btnQuiet} aria-label="Later week" onClick={() => setAnchor(addDaysCivil(anchor, 7))}>›</button>
        <input aria-label="Find a volunteer" placeholder="Find a volunteer" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: 200 }} />
        <span style={{ fontSize: 12.5, color: T.ink3 }}>{narrow ? "Tap a name, then tap a role." : "Drag a name onto a role, or click a name and then a role."} A full role puts them on its waiting list.</span>
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
      {picked && <div style={{ fontSize: 13, color: T.ink }}>Placing <strong>{picked.name}</strong>. Pick a role. <button style={btnLink} onClick={() => setPicked(null)}>Cancel</button></div>}
      {!data.shifts.length && <div style={{ ...card, fontSize: 13, color: T.ink3 }}>No shifts this week.</div>}
      {data.shifts.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid " + T.bg2, borderRadius: 12, background: T.white }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: Math.max(600, 180 + data.shifts.length * 150) }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: T.white, textAlign: "left", padding: 8, minWidth: 160, zIndex: 1 }}>Volunteer</th>
                {data.shifts.map(s => (
                  <th key={s.id} style={{ padding: 8, verticalAlign: "top", borderLeft: "1px solid " + T.bg2, minWidth: 140, textAlign: "left" }}>
                    <div style={{ borderLeft: `3px solid ${s.color || T.green}`, paddingLeft: 6 }}>
                      <div style={{ fontWeight: 800, color: T.ink }}>{s.name}</div>
                      <div style={{ fontWeight: 500, color: T.ink3 }}>{shortDay(s.date)} {t12(s.startTime)}</div>
                      <div style={{ fontWeight: 700, color: s.footer.short > 0 ? T.gold700 : T.ink3 }}>{s.footer.scheduled}{s.footer.needed != null ? ` of ${s.footer.needed}` : ""}{s.footer.short > 0 ? ` · ${s.footer.short} short` : ""}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {(s.roles.length ? s.roles : [{ id: "", name: "Add here", short: s.footer.short, needed: s.footer.needed, scheduled: s.footer.scheduled }]).map(r => (
                        <button key={r.id || "x"} data-drop-role={r.name} onDragOver={e => e.preventDefault()} onDrop={drop(s, r.id)}
                          onClick={() => picked && place(picked, s, r.id)} disabled={isReadOnly}
                          style={{ border: `1.5px dashed ${r.short > 0 ? T.gold : T.bg3}`, background: picked ? T.green100 : T.bg, borderRadius: 8, padding: "5px 6px", fontSize: 11.5, fontWeight: 700, color: T.ink, cursor: picked ? "pointer" : "default", textAlign: "left", fontFamily: "inherit" }}>
                          {r.name}{r.needed != null ? ` ${r.scheduled}/${r.needed}` : ""}
                        </button>))}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.slice(0, 200).map(p => (
                <tr key={p.id} style={{ borderTop: "1px solid " + T.bg2 }}>
                  <td style={{ position: "sticky", left: 0, background: picked && picked.id === p.id ? T.green100 : T.white, padding: "6px 8px" }}>
                    <button draggable={!isReadOnly} onDragStart={e => e.dataTransfer.setData("text/plain", p.id)} onClick={() => setPicked(p)}
                      aria-pressed={!!(picked && picked.id === p.id)} style={{ ...btnLink, color: T.ink, fontWeight: 600, cursor: isReadOnly ? "default" : "grab" }}>{p.name}</button>
                  </td>
                  {data.shifts.map(s => {
                    const at = placeOf.get(`${p.id}|${s.id}`);
                    return <td key={s.id} style={{ padding: "6px 8px", borderLeft: "1px solid " + T.bg2, color: at ? T.ink : T.bg3, fontWeight: at ? 700 : 400 }}>{at || "·"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── TO SEND ───────────────────────────────────────────────────────────────
// Reminders for tomorrow and thank-yous after a shift, drafted by Steward.
// One tap sends the ones selected; each is checked against the mail rules at
// that moment, and one that cannot go says why.
export function ToSendView({ isReadOnly }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    apiFetch("/volunteer-hub/drafts").then(d => { setData(d); setSel(new Set(d.drafts.map(x => x.id))); }).catch(e => setMsg(errorMessage(e, "The drafts did not load.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  const send = async ids => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch("/volunteer-hub/drafts/send", { method: "POST", body: JSON.stringify({ ids }) }); setMsg(r.message); load(); }
    catch (e) { setMsg(errorMessage(e, "Nothing was sent.")); }
    setBusy(false);
  };
  const draftNow = async () => {
    setBusy(true);
    try { const r = await apiFetch("/volunteer-hub/drafts/reminders", { method: "POST" }); setMsg(r.message); load(); }
    catch (e) { setMsg(errorMessage(e, "That did not work.")); }
    setBusy(false);
  };
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>{msg || "Loading…"}</div>;
  const kinds = [...new Set(data.drafts.map(d => d.kindLabel))];
  return (
    <div data-testid="vol-to-send" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: T.ink3, maxWidth: 680, lineHeight: 1.6 }}>{data.sentence}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!isReadOnly && data.drafts.length > 0 && <button style={btnPrimary} data-testid="to-send-all" disabled={busy || !sel.size} onClick={() => send([...sel])}>Send {sel.size} {sel.size === 1 ? "email" : "emails"}</button>}
        {!isReadOnly && <button style={btnQuiet} disabled={busy} onClick={draftNow}>Draft tomorrow's reminders now</button>}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
      {!data.drafts.length && <div style={{ ...card, fontSize: 13, color: T.ink3 }}>Nothing waiting. A reminder is drafted the day before each shift, and a thank-you when somebody is checked in.</div>}
      {kinds.map(k => (
        <div key={k} style={{ ...card, padding: 0 }}>
          <div style={{ ...eyebrow, padding: "12px 14px 6px" }}>{k}</div>
          {data.drafts.filter(d => d.kindLabel === k).map(d => (
            <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
              {!isReadOnly && <input type="checkbox" aria-label={`Send to ${d.name}`} checked={sel.has(d.id)} onChange={e => setSel(p => { const n = new Set(p); e.target.checked ? n.add(d.id) : n.delete(d.id); return n; })} />}
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{d.name}</div>
                <div style={{ fontSize: 12, color: T.ink3 }}>{d.subject}</div>
              </div>
              <button style={btnLink} onClick={() => setOpen(d)}>Read it</button>
              {!isReadOnly && <button style={btnQuiet} disabled={busy} onClick={() => apiFetch(`/volunteer-hub/drafts/${d.id}/discard`, { method: "POST" }).then(load)}>Discard</button>}
            </div>
          ))}
        </div>
      ))}
      {open && (
        <Modal onClose={() => setOpen(null)} width={520} ariaLabel={`Draft to ${open.name}`}>
          <div style={{ fontSize: 12, color: T.ink3 }}>To {open.name}{open.email ? ` · ${open.email}` : ""}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, margin: "4px 0 10px" }}>{open.subject}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, color: T.ink, lineHeight: 1.6 }}>{open.body}</div>
          {!isReadOnly && <div style={{ marginTop: 14 }}><button style={btnPrimary} disabled={busy} onClick={() => { send([open.id]); setOpen(null); }}>Send this one</button></div>}
        </Modal>
      )}
    </div>
  );
}

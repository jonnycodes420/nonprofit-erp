// CAL-1 — ONE CALENDAR FOR EVERYTHING WITH A DATE.
//
// A director plans her week in one place: meetings, next steps and tasks,
// volunteer shifts (filled of needed), events, journey steps, campaign sends,
// pledge instalments and, when she wants them, birthdays. Day, Week (the
// default), Month and Agenda (the default on a phone). Each type has its own
// tint from the four colours and its own toggle.
//
// NOTHING HERE WRITES ON ITS OWN ACCOUNT. A block dragged (or stretched by
// its bottom edge) becomes the request its own screen makes
// (shared/calendarMoves.js): one audit write, and the shared Undo toast puts
// it back through the same route. A synced meeting moves on Google or Outlook
// first, or the calendar says why it could not. An empty slot offers Meeting,
// Call, Next step, Shift and Event, each the existing form, prefilled.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { offerUndo } from "./EditHistory";
import { DonorLink, RecordLink } from "./RecordLink";
import { AskBox } from "./AskPanel";
import { ShiftEditor } from "./VolunteerSchedule";
import { errorMessage } from "../lib/domainError";
import { tabHref, urlParam } from "../lib/appUrls";
import { moveRequest, movedWords, addDaysCivil } from "../../../shared/calendarMoves.js";
import { AddToRecord } from "./MeetingPanels";

// ── Shared consts (the TDZ rule: above every line that reads them) ─────────
const HOUR_PX = 48, DAY_START = 7, DAY_END = 21, SNAP = 15;
const VIEWS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["agenda", "Agenda"]];
// The tints: the four colours and their shades, one per type.
const TYPE_META = {
  meeting: { label: "Meetings", bg: "rgba(13,92,58,0.14)", bar: T.greenDk, ink: T.ink },
  step:    { label: "Next steps and tasks", bg: "rgba(201,168,76,0.22)", bar: T.gold, ink: T.ink },
  deadline:{ label: "Grant deadlines", bg: "rgba(13,92,58,0.06)", bar: T.greenDk, ink: T.ink, outline: true },
  shift:   { label: "Volunteer shifts", bg: "rgba(15,26,18,0.10)", bar: T.ink, ink: T.ink },
  event:   { label: "Events", bg: T.greenDk, bar: T.greenDk, ink: T.white },
  journey: { label: "Journey steps", bg: T.white, bar: T.gold, ink: T.ink, outline: true },
  send:    { label: "Campaign sends", bg: T.white, bar: T.ink, ink: T.ink, outline: true },
  pledge:  { label: "Pledge instalments", bg: "rgba(201,168,76,0.12)", bar: T.gold, ink: T.ink },
  membership:{ label: "Memberships ending", bg: "rgba(201,168,76,0.12)", bar: T.greenDk, ink: T.ink },
  auction: { label: "Auctions closing", bg: "rgba(15,26,18,0.10)", bar: T.gold, ink: T.ink },
  campaign:{ label: "Campaign and page end dates", bg: T.white, bar: T.greenDk, ink: T.ink, outline: true },
  recurring:{ label: "Monthly gifts", bg: "rgba(13,92,58,0.06)", bar: T.gold, ink: T.ink, outline: true },
  birthday:{ label: "Birthdays", bg: T.bg, bar: T.bg3, ink: T.ink },
};
const TYPE_ORDER = ["meeting", "step", "deadline", "shift", "event", "journey", "send", "pledge", "membership", "auction", "campaign", "recurring", "birthday"];
const TYPES_KEY = "steward_calendar_types";
const chip = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btn = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = n => String(n).padStart(2, "0");
const mondayOf = iso => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))); return addDaysCivil(iso, -((d.getUTCDay() + 6) % 7)); };
const minsOf = s => (String(s).length > 10 ? +s.slice(11, 13) * 60 + +s.slice(14, 16) : 0);
const t12 = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""}${h >= 12 ? "pm" : "am"}`; };
const dayWords = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthWords = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
function rangeFor(view, anchor) {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") { const f = mondayOf(anchor); return { from: f, to: addDaysCivil(f, 6) }; }
  if (view === "month") { const f = mondayOf(anchor.slice(0, 8) + "01"); return { from: f, to: addDaysCivil(f, 41) }; }
  return { from: anchor, to: addDaysCivil(anchor, 13) };
}
function step(view, anchor, dir) {
  if (view === "day") return addDaysCivil(anchor, dir);
  if (view === "month") { let y = +anchor.slice(0, 4), m = +anchor.slice(5, 7) + dir; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } return `${y}-${pad(m)}-01`; }
  return addDaysCivil(anchor, (view === "agenda" ? 14 : 7) * dir);
}
// FIX-28: a kind added since the choice was saved is shown, so a saved
// choice from before grant deadlines existed does not hide them.
const KNOWN_KEY = "steward_calendar_types_known";
function loadTypes(defaults) {
  try {
    const v = JSON.parse(window.localStorage.getItem(TYPES_KEY) || "null");
    if (Array.isArray(v)) {
      const known = JSON.parse(window.localStorage.getItem(KNOWN_KEY) || "null") || ["meeting", "step", "shift", "event", "journey", "send", "pledge", "birthday"];
      const added = defaults.filter(t => !known.includes(t) && !v.includes(t));
      window.localStorage.setItem(KNOWN_KEY, JSON.stringify(TYPE_ORDER));
      return [...v, ...added];
    }
  } catch { /* private mode */ }
  return defaults;
}
const narrowNow = () => typeof window !== "undefined" && window.innerWidth < 760;

export default function CalendarPage({ isReadOnly, onNavigate, isAdmin }) {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => { const r = () => setNarrow(narrowNow()); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const [view, setView] = useState(() => (narrowNow() ? "agenda" : "week"));
  const [anchor, setAnchor] = useState(null);
  const [scope, setScope] = useState("everyone");
  const [staff, setStaff] = useState("");
  const [types, setTypes] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [card, setCard] = useState(null);       // { item, x, y }
  const [adding, setAdding] = useState(null);   // { date, time }
  const [form, setForm] = useState(null);       // { kind, date, time, item? }
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState(null);
  const [showFilters, setShowFilters] = useState(false);   // on a phone the filters fold away
  const range = anchor ? rangeFor(view, anchor) : null;

  const load = useCallback(() => {
    if (!range || !types) return;
    const qs = new URLSearchParams({ from: range.from, to: range.to, scope, types: types.join(","), ...(staff ? { staff } : {}) });
    apiFetch(`/calendar/items?${qs}`).then(d => { setData(d); setErr(""); }).catch(e => setErr(errorMessage(e, "The calendar did not load just now.")));
  }, [range && range.from, range && range.to, scope, staff, types && types.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The first read learns the org's today and default types.
  useEffect(() => {
    apiFetch(`/calendar/items?from=2000-01-01&to=2000-01-01`).then(d => {
      // SEARCH-2: ⌘K opens the calendar on a meeting's day (?day=YYYY-MM-DD).
      const asked = urlParam("calendar", "day");
      setAnchor(/^\d{4}-\d{2}-\d{2}$/.test(asked || "") ? asked : d.today); setTypes(loadTypes(d.defaultOn));
    }).catch(() => { const t = new Date().toISOString().slice(0, 10); setAnchor(t); setTypes(loadTypes(["meeting", "step", "deadline", "shift", "event", "journey", "send", "pledge"])); });
  }, []);
  useEffect(() => { load(); }, [load]);
  // FIX-28: her own dates on her own connected calendar, when she turns it on.
  const [push, setPush] = useState(null);
  const [pushNote, setPushNote] = useState("");
  useEffect(() => {
    apiFetch("/calendar/push-dates").then(p => {
      setPush(p);
      if (p.enabled) apiFetch("/calendar/push-dates/run", { method: "POST", body: "{}" }).catch(() => {});
    }).catch(() => setPush(null));
  }, []);
  const togglePush = async () => {
    const enabled = !push.enabled;
    setPushNote("");
    try {
      const r = await apiFetch("/calendar/push-dates", { method: "PUT", body: JSON.stringify({ enabled }) });
      setPush({ ...push, enabled }); setPushNote(r.sentence || "");
      offerUndo({ message: r.sentence || "Saved.", undoAction: async () => { const x = await apiFetch("/calendar/push-dates", { method: "PUT", body: JSON.stringify({ enabled: !enabled }) }); setPush(p => ({ ...p, enabled: !enabled })); setPushNote(""); return x; } }, "calendar setting");
    } catch (e) { setPushNote((e && e.sentence) || errorMessage(e, "That did not save.")); }
  };
  const toggleType = k => setTypes(cur => { const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]; try { window.localStorage.setItem(TYPES_KEY, JSON.stringify(next)); } catch { /* */ } return next; });

  // ── A MOVE: the item's own route, then Undo the same way ─────────────────
  const move = async (item, d) => {
    const req = moveRequest(item, d);
    if (req.refused) { setNote(req.refused); return; }
    try {
      await apiFetch(req.path, { method: req.method, body: JSON.stringify(req.body) });
      setNote("");
      load();
      offerUndo({ message: movedWords(item, req), undoAction: async () => { const r = await apiFetch(req.undo.path, { method: req.undo.method, body: JSON.stringify(req.undo.body) }); load(); return r; } }, item.title);
    } catch (e) { setNote((e && e.sentence) || errorMessage(e, "That did not move.")); load(); }
  };

  if (!anchor || !types) return <div style={{ padding: 24, color: T.ink3, fontSize: 14 }}>Loading the calendar…</div>;
  const items = data ? data.items : [];
  const today = data ? data.today : anchor;
  const title = view === "month" ? monthWords(anchor) : view === "day" ? dayWords(anchor) : `${dayWords(range.from)} to ${dayWords(range.to)}`;

  const openItem = (item, ev) => setCard({ item, x: ev ? ev.clientX : 0, y: ev ? ev.clientY : 0 });
  const addAt = (date, time) => !isReadOnly && setAdding({ date, time });

  const side = (
    <div data-testid="cal-side" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {VIEWS.map(([k, l]) => <button key={k} type="button" data-testid={`cal-view-${k}`} aria-pressed={view === k} onClick={() => setView(k)}
          style={{ ...chip, background: view === k ? T.ink : T.white, color: view === k ? T.white : T.ink }}>{l}</button>)}
      </div>
      {narrow && <button type="button" data-testid="cal-filters" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)} style={{ ...chip, alignSelf: "flex-start" }}>{showFilters ? "Hide filters" : "Filters"}</button>}
      {(!narrow || showFilters) && <>
      <div style={{ display: "flex", gap: 6 }}>
        {[["mine", "Mine"], ["everyone", "Everyone"]].map(([k, l]) => <button key={k} type="button" data-testid={`cal-scope-${k}`} aria-pressed={scope === k} onClick={() => setScope(k)}
          style={{ ...chip, background: scope === k ? T.greenDk : T.white, color: scope === k ? T.white : T.ink }}>{l}</button>)}
      </div>
      {isAdmin && data && data.staff && data.staff.length > 1 && (
        <select aria-label="Staff" value={staff} onChange={e => setStaff(e.target.value)} style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" }}>
          <option value="">All staff</option>
          {data.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>)}
      <div data-testid="cal-types" style={{ display: "flex", flexDirection: narrow ? "row" : "column", flexWrap: "wrap", gap: 6 }}>
        {TYPE_ORDER.map(k => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" data-testid={`cal-type-${k}`} checked={types.includes(k)} onChange={() => toggleType(k)} />
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: TYPE_META[k].outline ? T.white : TYPE_META[k].bg, border: `2px solid ${TYPE_META[k].bar}` }} />
            {TYPE_META[k].label}
          </label>))}
      </div>
      </>}
      {push && push.connected && !isReadOnly && (
        <label data-testid="cal-push" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: T.ink2, cursor: "pointer", lineHeight: 1.4 }}>
          <input type="checkbox" checked={push.enabled} onChange={togglePush} data-testid="cal-push-toggle" style={{ marginTop: 2 }} />
          <span>Put my deadlines, next steps and journey steps on my {push.provider === "microsoft" ? "Outlook" : "Google"} calendar too</span>
        </label>)}
      {pushNote && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{pushNote}</div>}
      {data && <div data-testid="cal-tz" style={{ fontSize: 12, color: T.ink3 }}>Times are {data.timezone.replace(/_/g, " ")}{data.timezoneConfirmed ? "" : " (Steward's default; set yours in Settings)"}.</div>}
    </div>
  );

  return (
    <div data-testid="calendar-page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: narrow ? 26 : 32, margin: 0, color: T.ink }}>Calendar</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" style={chip} onClick={() => setAnchor(today)}>Today</button>
          <button type="button" aria-label="Back" style={chip} onClick={() => setAnchor(a => step(view, a, -1))}>‹</button>
          <button type="button" aria-label="Forward" style={chip} onClick={() => setAnchor(a => step(view, a, 1))}>›</button>
          <span data-testid="cal-title" style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginLeft: 4 }}>{title}</span>
        </div>
      </div>
      {/* Part 4: ask from the calendar, scoped to the dates on screen. */}
      <div data-testid="cal-ask-line" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" data-testid="cal-q-week" style={chip} onClick={() => setSummary("week")}>{view === "day" ? "What's my day look like?" : view === "month" ? "What's my month look like?" : "What's my week look like?"}</button>
          <button type="button" data-testid="cal-q-meeting" style={chip} onClick={() => setSummary("meeting")}>Who am I meeting {view === "day" ? "today" : view === "month" ? "this month" : "this week"} and when did they last give?</button>
        </div>
        <AskBox scope={{ from: range.from, to: range.to }} isReadOnly={isReadOnly} testid="cal-ask" label="Ask" starters={[]} placeholder="Ask anything about these dates" />
      </div>
      {summary && <Summary kind={summary} items={items} scope={scope} range={range} onClose={() => setSummary(null)} onOpen={openItem} />}
      {note && <div role="status" data-testid="cal-note" style={{ fontSize: 13, color: T.ink, background: T.bg, borderRadius: 8, padding: "8px 12px" }}>{note}</div>}
      {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
      <div style={{ display: narrow ? "flex" : "grid", flexDirection: "column", gridTemplateColumns: "220px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        {side}
        <div style={{ minWidth: 0 }}>
          {view === "agenda" && <AgendaView items={items} range={range} today={today} narrow={narrow} anchor={anchor} setAnchor={setAnchor} onOpen={openItem} />}
          {view === "month" && <MonthView items={items} range={range} anchor={anchor} today={today} onOpen={openItem} onAdd={d => addAt(d, null)} onDay={d => { setAnchor(d); setView("day"); }} />}
          {(view === "week" || view === "day") && <TimeGrid days={view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDaysCivil(range.from, i))}
            items={items} today={today} isReadOnly={isReadOnly} onOpen={openItem} onAdd={addAt} onMove={move} />}
        </div>
      </div>
      {narrow && !isReadOnly && <button type="button" data-testid="cal-add" aria-label="Add" onClick={() => setAdding({ date: anchor, time: null })}
        style={{ position: "fixed", right: 18, bottom: 84, width: 52, height: 52, borderRadius: 99, background: T.greenDk, color: T.white, border: "none", fontSize: 28, lineHeight: 1, boxShadow: "0 6px 18px rgba(15,26,18,0.25)", zIndex: 260 }}>+</button>}
      {card && <ItemCard card={card} isReadOnly={isReadOnly} onClose={() => setCard(null)} onNavigate={onNavigate} onChanged={m => { setCard(null); setNote(m || ""); load(); }}
        onEditShift={it => { setCard(null); setForm({ kind: "shift", item: it }); }} />}
      {adding && <AddMenu at={adding} onClose={() => setAdding(null)} onPick={kind => { setForm({ kind, date: adding.date, time: adding.time }); setAdding(null); }} />}
      {form && <AddForm form={form} onClose={() => setForm(null)} onSaved={m => { setForm(null); setNote(m || ""); load(); }} />}
    </div>
  );
}


// ── BLOCK ──────────────────────────────────────────────────────────────────
function Block({ item, onOpen, style, compact, children }) {
  const m = TYPE_META[item.type] || TYPE_META.step;
  return (
    <div role="button" tabIndex={0} data-testid="cal-item" data-type={item.type} data-id={item.id} title={item.conflict || item.title}
      onClick={e => { e.stopPropagation(); onOpen(item, e); }} onKeyDown={e => { if (e.key === "Enter") onOpen(item, e); }}
      style={{ background: m.bg, color: m.ink, borderLeft: `3px solid ${m.bar}`, border: m.outline ? `1px solid ${m.bar}` : undefined, borderLeftWidth: 3,
               borderRadius: 6, padding: compact ? "1px 6px" : "3px 6px", fontSize: 12, lineHeight: 1.3, overflow: "hidden", cursor: "pointer", boxSizing: "border-box", ...style }}>
      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.conflict && <span data-testid="cal-conflict" aria-label={item.conflict} style={{ display: "inline-block", width: 7, height: 7, borderRadius: 99, background: T.gold, marginRight: 5, verticalAlign: "middle" }} />}
        {item.title}
      </div>
      {!compact && item.type === "shift" && item.detail && <div style={{ opacity: 0.85 }}>{item.detail}</div>}
      {children}
    </div>
  );
}

// Side-by-side lanes for items that overlap in time on one day: each item
// gets a lane and the number of lanes in its cluster, like a paper diary.
function lanesFor(list) {
  const sorted = [...list].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(b.end).localeCompare(String(a.end)));
  const out = new Map();
  let cluster = [], clusterEnd = "";
  const flush = () => { const n = Math.max(1, ...cluster.map(c => out.get(c.id).lane + 1)); for (const c of cluster) out.get(c.id).of = n; cluster = []; };
  for (const it of sorted) {
    if (cluster.length && String(it.start) >= clusterEnd) flush();
    const used = new Set(cluster.filter(c => String(c.end) > String(it.start)).map(c => out.get(c.id).lane));
    let lane = 0; while (used.has(lane)) lane++;
    out.set(it.id, { lane, of: 1 });
    cluster.push(it); if (String(it.end) > clusterEnd) clusterEnd = String(it.end);
  }
  if (cluster.length) flush();
  return out;
}

// ── DAY AND WEEK: THE TIME GRID ────────────────────────────────────────────
function TimeGrid({ days, items, today, isReadOnly, onOpen, onAdd, onMove }) {
  const gridRef = useRef(null);
  const [drag, setDrag] = useState(null);   // { item, mode, x0, y0, dx, dy }
  const justDragged = useRef(false);        // the click that ends a drag is not a click on the item
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const colW = () => { const g = gridRef.current; return g ? (g.getBoundingClientRect().width - 52) / days.length : 100; };
  const allDay = d => items.filter(i => (i.allDay || String(i.start).length === 10) && String(i.start).slice(0, 10) <= d && String(i.end || i.start).slice(0, 10) >= d);
  const timed = d => items.filter(i => !(i.allDay || String(i.start).length === 10) && String(i.start).slice(0, 10) === d);
  const top = s => Math.max(0, ((minsOf(s) - DAY_START * 60) / 60) * HOUR_PX);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  useEffect(() => {
    if (!drag) return undefined;
    const mv = e => setDrag(d => d && { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0, moved: d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4 });
    const up = () => {
      setDrag(d => {
        if (d && d.moved) {
          justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 50);
          const days = d.mode === "move" ? Math.round(d.dx / colW()) : 0;
          const mins = Math.round(((d.dy / HOUR_PX) * 60) / SNAP) * SNAP;
          if (days || mins) onMove(d.item, d.mode === "move" ? { days, minutes: mins } : { endMinutes: mins });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  }, [drag && drag.item && drag.item.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const start = (e, item, mode) => {
    if (isReadOnly || !(item.editable && item.editable[mode === "move" ? "move" : "resize"])) return;
    e.stopPropagation(); e.preventDefault();
    setDrag({ item, mode, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false });
  };
  return (
    <div data-testid="cal-grid" style={{ border: "1px solid " + T.bg3, borderRadius: 12, background: T.white, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${days.length}, minmax(0,1fr))`, borderBottom: "1px solid " + T.bg2 }}>
        <div />
        {days.map((d, i) => (
          <div key={d} data-testid="cal-day-head" style={{ padding: "8px 6px", fontSize: 12, fontWeight: 700, color: d === today ? T.greenDk : T.ink3, textAlign: "center", borderLeft: "1px solid " + T.bg2 }}>
            {days.length > 1 ? WD[i] : ""} <span style={{ fontSize: 15, color: d === today ? T.white : T.ink, background: d === today ? T.greenDk : "transparent", borderRadius: 99, padding: "1px 7px" }}>{+d.slice(8, 10)}</span>
          </div>))}
      </div>
      {/* The all-day row: next steps with no time, journey steps, pledges, birthdays. */}
      <div data-testid="cal-allday" style={{ display: "grid", gridTemplateColumns: `52px repeat(${days.length}, minmax(0,1fr))`, borderBottom: "1px solid " + T.bg2, minHeight: 28 }}>
        <div style={{ fontSize: 10, color: T.ink3, padding: "6px 4px", textAlign: "right" }}>All day</div>
        {days.map(d => (
          <div key={d} onClick={() => onAdd(d, null)} style={{ borderLeft: "1px solid " + T.bg2, padding: 3, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {allDay(d).slice(0, 4).map(it => <Block key={it.id + d} item={it} onOpen={onOpen} compact />)}
            {allDay(d).length > 4 && <span style={{ fontSize: 11, color: T.ink3 }}>{allDay(d).length - 4} more</span>}
          </div>))}
      </div>
      <div ref={gridRef} style={{ position: "relative", display: "grid", gridTemplateColumns: `52px repeat(${days.length}, minmax(0,1fr))`, maxHeight: 620, overflowY: "auto" }}>
        <div>{hours.map(h => <div key={h} style={{ height: HOUR_PX, fontSize: 10.5, color: T.ink3, textAlign: "right", paddingRight: 6, boxSizing: "border-box" }}>{t12(`${h}:00`)}</div>)}</div>
        {days.map((d, di) => (
          <div key={d} data-testid="cal-col" data-day={d} style={{ position: "relative", borderLeft: "1px solid " + T.bg2, background: d === today ? "rgba(13,92,58,0.03)" : T.white }}>
            {hours.map(h => <div key={h} data-testid="cal-slot" onClick={() => onAdd(d, `${pad(h)}:00`)} style={{ height: HOUR_PX, borderTop: "1px solid " + T.bg2, boxSizing: "border-box", cursor: "pointer" }} />)}
            {d === today && nowMins >= DAY_START * 60 && nowMins <= DAY_END * 60 && (
              <div data-testid="cal-now" aria-hidden style={{ position: "absolute", left: 0, right: 0, top: ((nowMins - DAY_START * 60) / 60) * HOUR_PX, borderTop: `2px solid ${T.greenDk}`, zIndex: 3 }} />)}
            {(() => { const lanes = lanesFor(timed(d)); return timed(d).map(it => {
              const t0 = top(it.start), h = Math.max(20, top(it.end) - t0);
              const ln = lanes.get(it.id) || { lane: 0, of: 1 };
              const dragging = drag && drag.item.id === it.id && drag.moved;
              const dx = dragging && drag.mode === "move" ? drag.dx : 0, dy = dragging && drag.mode === "move" ? drag.dy : 0;
              const dh = dragging && drag.mode === "resize" ? drag.dy : 0;
              return (
                <div key={it.id} onPointerDown={e => start(e, it, "move")}
                  style={{ position: "absolute", left: `calc(${(ln.lane / ln.of) * 100}% + 2px)`, width: `calc(${100 / ln.of}% - 4px)`, top: t0, height: Math.max(20, h + dh), transform: `translate(${dx}px, ${dy}px)`, zIndex: dragging ? 5 : 2, touchAction: "none", opacity: dragging ? 0.85 : 1 }}>
                  <Block item={it} onOpen={(x, e) => { if (!justDragged.current && !(drag && drag.moved)) onOpen(x, e); }} style={{ height: "100%" }}>
                    {!isReadOnly && it.editable && it.editable.resize && <div data-testid="cal-resize" onPointerDown={e => start(e, it, "resize")}
                      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 7, cursor: "ns-resize" }} />}
                  </Block>
                </div>);
            }); })()}
          </div>))}
      </div>
    </div>
  );
}

// ── MONTH ──────────────────────────────────────────────────────────────────
function MonthView({ items, range, anchor, today, onOpen, onAdd, onDay }) {
  const days = Array.from({ length: 42 }, (_, i) => addDaysCivil(range.from, i));
  const on = d => items.filter(i => String(i.start).slice(0, 10) <= d && String(i.end || i.start).slice(0, 10) >= d);
  return (
    <div data-testid="cal-month" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden", background: T.white }}>
      {WD.map(w => <div key={w} style={{ padding: "6px", fontSize: 11, fontWeight: 700, color: T.ink3, borderBottom: "1px solid " + T.bg2 }}>{w}</div>)}
      {days.map(d => (
        <div key={d} onClick={() => onAdd(d)} style={{ minHeight: 96, borderTop: "1px solid " + T.bg2, borderLeft: "1px solid " + T.bg2, padding: 4, display: "flex", flexDirection: "column", gap: 2, minWidth: 0, opacity: d.slice(5, 7) === anchor.slice(5, 7) ? 1 : 0.55 }}>
          <button type="button" onClick={e => { e.stopPropagation(); onDay(d); }} style={{ alignSelf: "flex-start", background: d === today ? T.greenDk : "none", color: d === today ? T.white : T.ink, border: "none", borderRadius: 99, padding: "0 6px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{+d.slice(8, 10)}</button>
          {on(d).slice(0, 3).map(it => <Block key={it.id + d} item={it} onOpen={onOpen} compact />)}
          {on(d).length > 3 && <button type="button" onClick={e => { e.stopPropagation(); onDay(d); }} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: T.greenDk, textAlign: "left", cursor: "pointer" }}>{on(d).length - 3} more</button>}
        </div>))}
    </div>
  );
}

// ── AGENDA (the default on a phone): a day strip and the list ────────────
function AgendaView({ items, range, today, narrow, anchor, setAnchor, onOpen }) {
  const days = Array.from({ length: 14 }, (_, i) => addDaysCivil(range.from, i));
  const by = d => items.filter(i => String(i.start).slice(0, 10) <= d && String(i.end || i.start).slice(0, 10) >= d)
    .sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
  const [pick, setPick] = useState(null);
  const shown = narrow ? [pick || anchor] : days;
  return (
    <div data-testid="cal-agenda" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {narrow && (
        <div data-testid="cal-strip" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
          {days.slice(0, 7).map((d, i) => (
            <button key={d} type="button" onClick={() => { setPick(d); setAnchor(range.from); }} aria-pressed={(pick || anchor) === d}
              style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: "6px 0", background: (pick || anchor) === d ? T.ink : T.white, color: (pick || anchor) === d ? T.white : T.ink, fontFamily: "inherit", minWidth: 0 }}>
              <div style={{ fontSize: 10.5 }}>{WD[(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay() + 6) % 7]}</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{+d.slice(8, 10)}</div>
              {by(d).length > 0 && <div aria-hidden style={{ width: 5, height: 5, borderRadius: 99, background: (pick || anchor) === d ? T.gold : T.greenDk, margin: "2px auto 0" }} />}
            </button>))}
        </div>)}
      {shown.map(d => (
        <div key={d} data-testid="cal-agenda-day">
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: d === today ? T.greenDk : T.ink3, margin: "4px 0 6px" }}>{dayWords(d)}{d === today ? " · today" : ""}</div>
          {by(d).length === 0 ? <div style={{ fontSize: 13, color: T.ink3 }}>Nothing on the calendar.</div>
            : by(d).map(it => (
              <div key={it.id + d} style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: 10, alignItems: "start", padding: "6px 0", borderTop: "1px solid " + T.bg2 }}>
                <span style={{ fontSize: 12, color: T.ink3 }}>{it.allDay || String(it.start).length === 10 ? "All day" : t12(String(it.start).slice(11, 16))}</span>
                <Block item={it} onOpen={onOpen}>{it.detail && it.type !== "shift" && <div style={{ fontWeight: 400, opacity: 0.85, whiteSpace: "normal" }}>{it.detail}</div>}</Block>
              </div>))}
        </div>))}
    </div>
  );
}

// ── "WHAT'S MY WEEK LOOK LIKE?" ─────────────────────────────────────────────
// Answered from the calendar's own rows for the dates on screen: how many of
// each kind, what needs a person (a short shift, a clash), and for the second
// question each meeting's person with their last gift from their record.
function Summary({ kind, items, scope, range, onClose, onOpen }) {
  const count = t => items.filter(i => i.type === t).length;
  const meetings = items.filter(i => i.type === "meeting" && !i.logged).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const flagged = items.filter(i => i.conflict);
  const parts = [["meeting", "meeting", "meetings"], ["step", "next step or task", "next steps and tasks"], ["deadline", "grant deadline", "grant deadlines"], ["shift", "shift", "shifts"], ["event", "event", "events"],
    ["journey", "journey step", "journey steps"], ["send", "campaign send", "campaign sends"], ["pledge", "pledge instalment", "pledge instalments"]]
    .filter(([t]) => count(t)).map(([t, one, many]) => `${count(t)} ${count(t) === 1 ? one : many}`);
  const who = scope === "mine" ? "You have" : "The calendar has";
  return (
    <div data-testid="cal-summary" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{dayWords(range.from)} to {dayWords(range.to)}</div>
        <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: T.ink3 }}>×</button>
      </div>
      {kind === "week" ? <>
        <div data-testid="cal-summary-sentence" style={{ fontSize: 16, color: T.ink, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.5 }}>
          {parts.length ? `${who} ${parts.join(", ")}.` : "Nothing is on the calendar for these dates."}
          {flagged.length ? ` ${flagged.length === 1 ? "One needs" : `${flagged.length} need`} a look.` : ""}
        </div>
        {flagged.map(i => <div key={i.id} style={{ fontSize: 13.5, borderLeft: `3px solid ${T.gold}`, paddingLeft: 8, cursor: "pointer" }} onClick={e => onOpen(i, e)}><strong>{i.title}</strong>: {i.conflict}</div>)}
        <div style={{ fontSize: 12, color: T.ink3 }}>Counted from the calendar on screen, with the types you have switched on.</div>
      </> : <>
        <div data-testid="cal-summary-sentence" style={{ fontSize: 16, color: T.ink, fontFamily: "'Fraunces', Georgia, serif" }}>
          {meetings.length ? `${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"} on these dates.` : "No meetings on these dates."}
        </div>
        {meetings.map(m => (
          <div key={m.id} data-testid="cal-summary-meeting" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, borderTop: "1px solid " + T.bg2, paddingTop: 6, fontSize: 13.5 }}>
            <span style={{ cursor: "pointer" }} onClick={e => onOpen(m, e)}><strong>{dayWords(m.start.slice(0, 10))}, {t12(m.start.slice(11, 16))}</strong> · {m.donorName || m.title}</span>
            <span style={{ color: T.ink2, whiteSpace: "nowrap" }}>{m.lastGift ? `last gave $${Number(m.lastGift.amount).toLocaleString("en-US")} on ${dayWords(m.lastGift.date)}` : m.donorId ? "no gift on record" : "nobody on file"}</span>
          </div>))}
        <div style={{ fontSize: 12, color: T.ink3 }}>Each last gift is from that person's record.</div>
      </>}
    </div>
  );
}

// ── THE CARD: essentials and one main action ───────────────────────────────
function ItemCard({ card, isReadOnly, onClose, onNavigate, onChanged, onEditShift }) {
  const it = card.item;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const when = it.allDay || String(it.start).length === 10 ? `${dayWords(String(it.start).slice(0, 10))}, all day`
    : `${dayWords(it.start.slice(0, 10))}, ${t12(it.start.slice(11, 16))} to ${t12(String(it.end).slice(11, 16))}`;
  const go = (tab, opts) => { onClose(); onNavigate && onNavigate(tab, opts); };
  const done = async () => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/threads/${it.ref.threadId}/dismiss`, { method: "POST", body: JSON.stringify({ reason: "handled_outside" }) });
      onChanged("Marked done.");
    } catch (e) { setErr(errorMessage(e, "That did not save.")); }
    setBusy(false);
  };
  const action = (() => {
    if (it.type === "shift") return <button type="button" style={btn} onClick={() => onEditShift(it)}>Change this shift</button>;
    if (it.type === "event") return <RecordLink to={tabHref("fundraising", { frSection: "events", eventId: it.ref.eventId })} onOpen={() => go("fundraising", { frSection: "events", eventId: it.ref.eventId })} style={{ ...btn, display: "inline-block", textDecoration: "none" }}>Open the event to check in</RecordLink>;
    if (it.type === "step" && it.ref.threadId && !isReadOnly) return <button type="button" style={btn} disabled={busy} onClick={done}>{busy ? "Saving…" : "Mark done"}</button>;
    if (it.type === "deadline") return <RecordLink to={tabHref("grants", {})} onOpen={() => go("grants", { grantId: it.ref.grantId })} style={{ ...btn, display: "inline-block", textDecoration: "none" }}>Open the grant</RecordLink>;
    if (it.type === "send") return <RecordLink to={tabHref("communications", {})} onOpen={() => go("communications", {})} style={{ ...btn, display: "inline-block", textDecoration: "none" }}>Open the campaign</RecordLink>;
    if (it.donorId) return <DonorLink id={it.donorId} onOpen={() => go("donors", { selectDonorId: it.donorId })} style={{ ...btn, display: "inline-block", textDecoration: "none" }}>Open {it.donorName}</DonorLink>;
    return null;
  })();
  // FIX-33 Part 3b · every meeting on the calendar can be put on a donor's
  // record; an unsure one leads with it and lists who the title could mean.
  const addToRecord = it.type === "meeting" && it.ref && it.ref.calendarEventId && !isReadOnly
    ? <AddToRecord eventId={it.ref.calendarEventId} candidates={it.candidates || []} compact={!it.unsure} onDone={s => onChanged(s)}/> : null;
  return (
    <Modal onClose={onClose} width={420} ariaLabel={it.title}>
      <div data-testid="cal-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{(TYPE_META[it.type] || {}).label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{it.title}</div>
        <div style={{ fontSize: 13.5, color: T.ink2 }}>{when}</div>
        {it.detail && <div style={{ fontSize: 13.5, color: T.ink2 }}>{it.detail}</div>}
        {/* THREAD-3: the day's monthly gifts, one row per plan, each opening the person. */}
        {Array.isArray(it.rows) && it.rows.length > 0 && (
          <div data-testid="cal-card-rows" style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto", borderTop: "1px solid " + T.bg2 }}>
            {it.rows.map(r => (
              <div key={r.planId} data-testid="cal-card-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, padding: "6px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13.5 }}>
                <DonorLink id={r.donorId} onOpen={() => go("donors", { selectDonorId: r.donorId, anchor: "plan-" + r.planId })} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donorName}</DonorLink>
                <span style={{ color: T.ink2, fontVariantNumeric: "tabular-nums" }}>${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: r.amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}</span>
              </div>))}
          </div>)}
        {it.donorId && it.type !== "birthday" && it.type !== "deadline" && <div style={{ fontSize: 13.5 }}>With <DonorLink id={it.donorId} onOpen={() => go("donors", { selectDonorId: it.donorId })} style={{ fontWeight: 700, textDecoration: "underline dotted" }}>{it.donorName}</DonorLink></div>}
        {it.conflict && <div data-testid="cal-card-conflict" style={{ fontSize: 13, color: T.ink, borderLeft: `3px solid ${T.gold}`, paddingLeft: 8 }}>{it.conflict}</div>}
        {it.ref && it.ref.synced && <div style={{ fontSize: 12.5, color: T.ink3 }}>Moving it here moves it on your connected calendar too.</div>}
        {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
        {it.unsure && <div data-testid="cal-card-unsure" style={{ fontSize: 13.5, color: T.ink2 }}>Steward could not tell who this meeting is with.</div>}
        {addToRecord}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{action}<button type="button" style={chip} onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

// ── AN EMPTY SLOT: what to add there ───────────────────────────────────────
function AddMenu({ at, onClose, onPick }) {
  return (
    <Modal onClose={onClose} width={360} ariaLabel="Add to the calendar">
      <div data-testid="cal-add-menu" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{dayWords(at.date)}{at.time ? `, ${t12(at.time)}` : ""}</div>
        {[["meeting", "Meeting"], ["call", "Call"], ["step", "Next step"], ["shift", "Shift"], ["event", "Event"]].map(([k, l]) => (
          <button key={k} type="button" data-testid={`cal-add-${k}`} style={{ ...chip, textAlign: "left", borderRadius: 10, padding: "10px 14px" }} onClick={() => onPick(k)}>{l}</button>))}
      </div>
    </Modal>
  );
}

// The existing forms, prefilled with the slot's date and time: a meeting is
// booked on her connected calendar (POST /donors/:id/book-visit), a call or a
// next step is a Thread step (POST /donors/:id/threads), a shift is the shift
// form, an event is the events form's own route (POST /events).
function AddForm({ form, onClose, onSaved }) {
  if (form.kind === "shift") {
    const it = form.item;
    if (it) return <ShiftFromCalendar slotId={it.ref.slotId} date={it.start.slice(0, 10)} onClose={onClose} onSaved={onSaved} />;
    return <ShiftEditor date={form.date} startTime={form.time || "09:00"} endTime={form.time ? `${pad(Math.min(23, +form.time.slice(0, 2) + 3))}:00` : "12:00"} onClose={onClose} onSaved={onSaved} />;
  }
  return <QuickForm form={form} onClose={onClose} onSaved={onSaved} />;
}
function ShiftFromCalendar({ slotId, date, onClose, onSaved }) {
  const [shift, setShift] = useState(null);
  useEffect(() => { apiFetch(`/volunteer-hub/schedule?from=${date}&to=${date}`).then(d => setShift((d.shifts || []).find(s => s.id === slotId) || false)).catch(() => setShift(false)); }, [slotId, date]);
  if (shift === null) return null;
  if (!shift) { onClose(); return null; }
  return <ShiftEditor shift={shift} onClose={onClose} onSaved={onSaved} />;
}
function QuickForm({ form, onClose, onSaved }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [who, setWho] = useState(null);
  const [date, setDate] = useState(form.date);
  const [time, setTime] = useState(form.time || "");
  const [mins, setMins] = useState("60");
  const [label, setLabel] = useState(form.kind === "call" ? "Call" : form.kind === "meeting" ? "" : "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const needsDonor = form.kind !== "event";
  useEffect(() => {
    if (!needsDonor || q.trim().length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/donors?search=${encodeURIComponent(q.trim())}&limit=8`).then(r => setHits((r.donors || r.rows || r || []).slice(0, 8))).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr("");
    try {
      if (form.kind === "event") {
        await apiFetch("/events", { method: "POST", body: JSON.stringify({ name, date, eventType: "other", ...(time ? { startTime: time } : {}) }) });
        onSaved(`${name} is on the calendar.`);
      } else if (form.kind === "meeting") {
        const startsAt = new Date(`${date}T${time || "10:00"}:00`).toISOString();
        const endsAt = new Date(Date.parse(startsAt) + Number(mins) * 60000).toISOString();
        const r = await apiFetch(`/donors/${who.id}/book-visit`, { method: "POST", body: JSON.stringify({ startsAt, endsAt, title: label || undefined }) });
        onSaved(r.sentence || "On your calendar.");
      } else {
        await apiFetch(`/donors/${who.id}/threads`, { method: "POST", body: JSON.stringify({ label: label || (form.kind === "call" ? "Call" : "Follow up"), due: date, ...(time ? { time } : {}) }) });
        onSaved(`${label || "The step"} with ${who.name} is on the calendar.`);
      }
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "That was not added.")); }
    setBusy(false);
  };
  const title = { meeting: "Meeting", call: "Call", step: "Next step", event: "Event" }[form.kind];
  const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box" };
  const ready = form.kind === "event" ? !!name.trim() : !!who;
  return (
    <Modal onClose={onClose} width={440} ariaLabel={title}>
      <div data-testid="cal-quick-form" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{title}</div>
        {needsDonor && (who
          ? <div style={{ fontSize: 14 }}>With <strong>{who.name}</strong> <button type="button" style={{ ...chip, padding: "2px 8px", fontSize: 12 }} onClick={() => setWho(null)}>Change</button></div>
          : <>
            <input aria-label="Find a person" data-testid="cal-donor-search" placeholder="Find a person" value={q} onChange={e => setQ(e.target.value)} style={inp} autoFocus />
            {hits.map(h => <button key={h.id} type="button" style={{ ...chip, textAlign: "left", borderRadius: 8 }} onClick={() => { setWho({ id: h.id, name: h.name }); setHits([]); }}>{h.name}</button>)}
          </>)}
        {form.kind === "event" && <input aria-label="Event name" placeholder="Event name" value={name} onChange={e => setName(e.target.value)} style={inp} />}
        {(form.kind === "call" || form.kind === "step" || form.kind === "meeting") && <input aria-label="What" placeholder={form.kind === "meeting" ? `Visit with ${who ? who.name : "them"}` : "Call"} value={label} onChange={e => setLabel(e.target.value)} style={inp} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, flex: "1 1 140px" }} />
          <input aria-label="Time" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inp, flex: "0 1 120px" }} />
          {form.kind === "meeting" && <select aria-label="How long" value={mins} onChange={e => setMins(e.target.value)} style={inp}>{["30", "45", "60", "90"].map(m => <option key={m} value={m}>{m} minutes</option>)}</select>}
        </div>
        {form.kind === "meeting" && <div style={{ fontSize: 12.5, color: T.ink3 }}>Booked on your connected calendar. Nobody is invited unless you invite them from there.</div>}
        {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" data-testid="cal-quick-save" style={{ ...btn, opacity: ready ? 1 : 0.5 }} disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Add"}</button>
          <button type="button" style={chip} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// client/src/components/MeetingPanels.jsx — INT-BUILD-1 Parts 3 to 5.
//
// THE CALENDAR AND THE INBOX, ON THE PEOPLE THEY CONCERN.
// docs/int-build-1/Profile.html, Prep.html and After.html are the approved
// drawings; values below are copied from them.
//
//   MeetingCard          the next meeting with this person, inside 7 days,
//                        with the four-line brief from their own record
//   RelationshipTimeline every email thread, meeting and gift, one list,
//                        filter chips with counts, every item opens
//   RelationshipRail     next step, the 12-month rhythm, coming up, this
//                        year, and Book a visit (on HER calendar; inviting
//                        the person is a box, off by default)
//   AfterMeetingForm     "How did coffee with Margaret go?" Nothing is
//                        recorded until she presses save, and then only
//                        through the ordinary gift, pledge and thread routes
//   MorningBrief         today's meetings, each with its brief (Home, 390)
//
// No pronoun is ever guessed from a name: the copy says the person's first
// name, or "they".
import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { T, firstNameOf, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { errorMessage } from "../lib/domainError";
import { civilDaysAgo, civilDayOf, orgTodayPlus } from "../lib/orgToday";
import { noteFields } from "../../../shared/meetingNote.js";
import { TIMELINE_FILTERS, loadTimelinePrefs, saveTimelinePrefs, isMassEmail, interactionBucket,
  TimelineListView, AttachmentChips, AttachButton } from "./ProfileTimelineParts";

const DARK_BRASS = T.gold700;      // the artboards' #8A6D1F
const CHIP_EDGE = T.bg3;           // the artboards draw a hairline one shade off bg3; bg3 is the token
const LABEL = { fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };
const SERIF = "'DM Serif Display',Georgia,serif";
const btnPrimary = { padding: "12px 18px", minHeight: 44, border: 0, borderRadius: 10, background: T.greenDk, color: T.white,
  font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" };
const btnOutline = { padding: "12px 18px", minHeight: 44, border: "1.5px solid " + T.ink, borderRadius: 10, background: T.white, color: T.ink,
  font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" };
const input = { font: "16px 'DM Sans',sans-serif", color: T.ink, border: "1px solid " + T.bg2, borderRadius: 12, padding: 12,
  minHeight: 44, boxSizing: "border-box", width: "100%", background: T.white };
const PROVIDER_CAL = { google: "Google Calendar", microsoft: "Outlook calendar" };
const MEAL_WORDS = ["coffee", "lunch", "breakfast", "dinner", "tea", "drinks", "call", "visit", "tour"];

const dayKey = d => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
export function whenLabel(iso) {
  const d = new Date(iso);
  const days = Math.round((dayKey(d) - dayKey(Date.now())) / 864e5);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
    : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `${day} · ${time}`;
}
export function relDay(dateLike) {
  if (!dateLike) return "";
  const s = String(dateLike);
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = civil ? new Date(s + "T12:00:00") : new Date(s);
  // FIX-14 Part 1 — a civil date is compared with the ORG's today, as civil
  // dates; only an instant is placed on the browser's clock.
  const days = civil ? -civilDaysAgo(s) : Math.round((dayKey(d) - dayKey(Date.now())) / 864e5);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
const durationOf = (a, b) => {
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  if (!(m > 0)) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} hr${r ? ` ${r} min` : ""}` : `${r} min`;
};
// "How did coffee with Margaret go?" — the meeting's own word when its title
// starts with one, otherwise "your meeting".
export function meetingNoun(title) {
  const w = String(title || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (["call", "visit", "tour"].includes(w)) return "the " + w;
  return MEAL_WORDS.includes(w) ? w : "your meeting";
}
const ownerFirst = m => firstNameOf(m?.ownerName || "") || "You";

// ── THE BRIEF, as four labelled lines ───────────────────────────────────────
function BriefLines({ brief, first, columns = 2, onInk = false }) {
  if (!brief) return null;
  const items = [
    brief.lastTime && [`Last time, ${relDay(brief.lastTime.date)}`, brief.lastTime.text],
    brief.openAsk && ["The open ask", brief.openAsk.text],
    brief.lastEmail && [`${first} wrote ${relDay(brief.lastEmail.date).toLowerCase() === "yesterday" ? "yesterday" : relDay(brief.lastEmail.date)}`, `"${brief.lastEmail.quote}"`],
    brief.unthanked && ["Don't forget", brief.unthanked.text],
  ].filter(Boolean);
  if (!items.length) return <div style={{ fontSize: 15, color: onInk ? T.sage400 : T.ink3 }}>Nothing on the record to brief from yet.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "18px 28px", alignContent: "start" }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: onInk ? T.sage400 : T.ink3 }}>{k}</span>
          <span style={{ fontSize: 15, lineHeight: 1.5 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── MOVE IT ─────────────────────────────────────────────────────────────────
function TimeForm({ initialStart, initialMinutes = 60, onSubmit, submitLabel, busy, extra }) {
  const s = new Date(initialStart || Date.now() + 864e5);
  const pad = n => String(n).padStart(2, "0");
  const [date, setDate] = useState(`${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`);
  const [time, setTime] = useState(`${pad(s.getHours())}:${pad(s.getMinutes())}`);
  const [mins, setMins] = useState(initialMinutes);
  const go = e => {
    e.preventDefault();
    const start = new Date(`${date}T${time}`);
    onSubmit({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + Number(mins) * 60000).toISOString() });
  };
  return (
    <form onSubmit={go} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "inherit" }}>Day
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required style={{ ...input, width: 160, padding: 8 }}/></label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "inherit" }}>Time
        <input type="time" value={time} onChange={e => setTime(e.target.value)} required style={{ ...input, width: 120, padding: 8 }}/></label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "inherit" }}>Minutes
        <input type="number" min={15} step={15} value={mins} onChange={e => setMins(e.target.value)} style={{ ...input, width: 90, padding: 8 }}/></label>
      {extra}
      <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}

export function MeetingCard({ meeting, donor, onReload }) {
  const [moving, setMoving] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!meeting) return null;
  const first = firstNameOf(donor?.name) || "them";
  const move = async body => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch(`/calendar/events/${meeting.id}/move`, { method: "POST", body: JSON.stringify(body) }); setMsg(r.sentence); setMoving(false); onReload && onReload(); }
    catch (e) { setMsg(e?.sentence || errorMessage(e, "That did not move.")); }
    setBusy(false);
  };
  return (
    <section aria-label="The next meeting" data-testid="dp-meeting-card"
      style={{ background: T.white, borderRadius: 20, padding: "30px 34px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 32 }}
      className="dp-meeting-card">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", color: DARK_BRASS, fontWeight: 600, textTransform: "uppercase" }}>{whenLabel(meeting.startsAt)}</div>
        <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15 }}>{meeting.title}</div>
        <div style={{ fontSize: 14, color: T.ink3 }}>From {meeting.ownerName ? `${ownerFirst(meeting)}'s` : "a"} {PROVIDER_CAL[meeting.provider] || "calendar"} · {[ownerFirst(meeting), ...(meeting.people || []).map(firstNameOf)].join(" and ")}</div>
        {meeting.location && <div style={{ fontSize: 14, color: T.ink3 }}>{meeting.location}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setOpen(o => !o)} style={btnPrimary} aria-expanded={open}>{open ? "Close the brief" : "Open the brief"}</button>
          <button type="button" onClick={() => setMoving(m => !m)} style={btnOutline}>{moving ? "Keep it" : "Move it"}</button>
        </div>
        {moving && <div style={{ marginTop: 8 }}><TimeForm initialStart={meeting.startsAt}
          initialMinutes={Math.max(15, Math.round((new Date(meeting.endsAt) - new Date(meeting.startsAt)) / 60000))}
          onSubmit={move} submitLabel="Move it" busy={busy}/></div>}
        {msg && <div style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
      </div>
      <div style={{ gridColumn: "span 2", borderLeft: "1px solid " + T.bg2, paddingLeft: 32 }}>
        <BriefLines brief={meeting.brief} first={first}/>
        {open && (
          <div data-testid="dp-brief-full" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid " + T.bg2, fontSize: 15, lineHeight: 1.6 }}>
            {meeting.brief?.giving && <div><span style={{ color: T.ink3 }}>Gave</span> {meeting.brief.giving.text}</div>}
            {meeting.location && <div><span style={{ color: T.ink3 }}>Where</span> {meeting.location}</div>}
            <div><span style={{ color: T.ink3 }}>When</span> {whenLabel(meeting.startsAt)}, {durationOf(meeting.startsAt, meeting.endsAt)}</div>
            <button type="button" onClick={() => window.print()} style={{ ...btnOutline, marginTop: 10, padding: "8px 14px", minHeight: 36, fontSize: 14 }}>Print the brief</button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── EVERYTHING WITH THEM ────────────────────────────────────────────────────
const ICON = {
  email: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>,
  meeting: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>,
};
const TILE_BG = { email: T.bg, meeting: T.ink, gift: T.bg2, talk: T.white };
// FIX-14 Part 3 — calls, notes, asks and stewardship touches join the one
// timeline (the old Touchpoint timeline is gone), with a speech-mark tile.
ICON.talk = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>;

// PARITY-1 Part B — the filters are the leader's set (All, Gifts,
// Conversations, Tasks, Notes, Emails, Attachments), Emails carries "Hide mass
// emails", and a list view sits beside the cards. The chosen filter, the switch
// and the view are remembered per viewer (ProfileTimelineParts.jsx). A meeting
// is a Conversation; a note is a Note; a campaign, appeal or sequence send is a
// MASS email; the donor's open and done tasks are Tasks; Attachments lists
// every file on a conversation or a note.
ICON.task = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>;
ICON.file = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>;
TILE_BG.task = T.white; TILE_BG.file = T.bg;
const KIND_LABEL = { email: "Email", meeting: "Meeting", gift: "Gift", task: "Task", file: "File" };
const TYPE_WORD = { meeting: "Meeting", call: "Call", visit: "Visit", ask: "Ask", stewardship: "Stewardship", event: "Event", letter: "Letter", text: "Text" };

export function RelationshipTimeline({ rel, donor, gifts = [], interactions = [], onLog, onChanged, renderActions = null, inboxConnected = true, onConnect = null,
  tasks = [], attachments = [], canWrite = false }) {
  const [prefs, setPrefs] = useState(loadTimelinePrefs);
  const { filter, hideMass, view } = prefs;
  const setPref = patch => setPrefs(p => { const n = { ...p, ...patch }; saveTimelinePrefs(n); return n; });
  const setFilter = f => setPref({ filter: f });
  const [openId, setOpenId] = useState(null);
  const [limit, setLimit] = useState(12);
  if (!rel) return null;
  const first = firstNameOf(donor?.name) || "them";
  const byId = Object.fromEntries((interactions || []).map(i => [i.id, i]));
  const filesBy = {};
  for (const f of attachments || []) (filesBy[f.interactionId] = filesBy[f.interactionId] || []).push(f);
  const calendarMeetingIds = new Set((rel.past || []).map(e => e.id));
  const items = [];
  for (const t of rel.emailThreads || []) items.push({ kind: "email", bucket: "email", id: "t:" + t.key, date: t.lastDate, t });
  if (Array.isArray(rel.meetings)) {
    // FIX-14 Part 1 — the meetings are the server's ONE source (meetings.js),
    // so this list, the rail and the header count the same rows.
    for (const m of rel.meetings) {
      if (m.kind === "calendar") items.push({ kind: "meeting", bucket: "conversation", id: "c:" + m.id, date: m.date, m });
      else items.push({ kind: "meeting", bucket: "conversation", id: "i:" + m.id, date: m.date, logged: { ...m, ...(byId[m.id] || {}), date: m.date } });
    }
  } else {
    for (const m of rel.past || []) items.push({ kind: "meeting", bucket: "conversation", id: "c:" + m.id, date: m.date || String(new Date(m.startsAt).toISOString()).slice(0, 10), m });
    for (const i of interactions || []) {
      if (i.type !== "meeting" || calendarMeetingIds.has(i.id)) continue;
      let meta = {}; try { meta = typeof i.metadata === "string" ? JSON.parse(i.metadata || "{}") : (i.metadata || {}); } catch {}
      if (meta.calendar_event_id) continue;    // shown as its calendar meeting
      items.push({ kind: "meeting", bucket: "conversation", id: "i:" + i.id, date: String(i.date).slice(0, 10), logged: i });
    }
  }
  for (const g of gifts || []) items.push({ kind: "gift", bucket: "gift", id: "g:" + g.id, date: String(g.date).slice(0, 10), g });
  // FIX-14 Part 3 — every other hand-logged touch (a call, a note, an ask, a
  // stewardship touch, an email typed in by hand) is on this one timeline too.
  const inThreads = new Set((rel.emailThreads || []).flatMap(t => t.ids || []));
  const meetingIds = new Set(items.filter(i => i.kind === "meeting" && i.logged).map(i => i.logged.id));
  for (const i of interactions || []) {
    if (!i || !i.id || i.type === "gift" || i.type === "meeting" || meetingIds.has(i.id) || inThreads.has(i.id)) continue;
    items.push({ kind: "talk", bucket: interactionBucket(i), mass: isMassEmail(i), id: "n:" + i.id, date: String(i.date || "").slice(0, 10), logged: i });
  }
  for (const t of tasks || []) {
    items.push({ kind: "task", bucket: "task", id: "k:" + t.id, date: String(t.due || t.created_at || "").slice(0, 10), task: t });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const fileItems = (attachments || []).map(f => ({ kind: "file", bucket: "file", id: "f:" + f.id,
    date: String(f.createdAt || "").slice(0, 10), f }));
  const counts = { email: (rel.emailThreads || []).reduce((s, t) => s + t.count, 0), meeting: items.filter(i => i.kind === "meeting").length };
  // FIX-14 Part 3 — no emails, no meetings and no inbox: one quiet line, not two zeros.
  const quietInbox = !inboxConnected && !counts.email && !counts.meeting;
  const massCount = items.filter(i => i.mass).length;
  const shown = filter === "file" ? fileItems
    : items.filter(i => (filter === "all" || i.bucket === filter) && !(hideMass && i.mass));
  const chip = (key, label) => (
    <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} data-filter={key}
      style={{ padding: "8px 14px", borderRadius: 999, border: filter === key ? 0 : "1px solid " + CHIP_EDGE,
        background: filter === key ? T.ink : "transparent", color: filter === key ? T.inkInverse : T.ink,
        font: "500 14px 'DM Sans',sans-serif", cursor: "pointer" }}>{label}</button>
  );
  const seg = (key, label) => (
    <button type="button" onClick={() => setPref({ view: key })} aria-pressed={view === key} data-view={key}
      style={{ padding: "6px 12px", border: 0, borderRadius: 8, background: view === key ? T.bg2 : "transparent", color: T.ink,
        font: (view === key ? "600" : "500") + " 13px 'DM Sans',sans-serif", cursor: "pointer" }}>{label}</button>
  );
  const describe = (it) => {
    let title, body = null, meta = null, by = "", type = KIND_LABEL[it.kind] || "";
    if (it.kind === "email") {
      const t = it.t;
      title = t.subject;
      body = t.lastQuote ? `${t.lastDirection === "inbound" ? first : "You"}: "${t.lastQuote}"` : null;
      meta = `${t.count} message${t.count === 1 ? "" : "s"}${t.attachments ? ` · ${t.attachments} attachment${t.attachments === 1 ? "" : "s"}` : ""}`;
      by = t.lastDirection === "inbound" ? first : "";
    } else if (it.kind === "meeting" && it.m) {
      const m = it.m;
      title = `${m.title}${durationOf(m.startsAt, m.endsAt) ? ` · ${durationOf(m.startsAt, m.endsAt)}` : ""}`;
      body = m.note ? `${ownerFirst(m)}'s note: "${m.note}"` : "No note yet.";
      meta = m.nextStep ? `Next step set: ${m.nextStep}` : null;
      by = ownerFirst(m);
    } else if (it.kind === "talk" || it.kind === "meeting") {
      const i = it.logged;
      title = conversationTitle(i);
      body = <NoteBody note={i.note}/>;
      by = i.logged_by_name || i.ownerName || i.created_by_name || "";
      meta = by ? `Logged by ${by}` : null;
      type = it.mass ? "Email" : it.bucket === "note" ? "Note" : it.bucket === "email" ? "Email" : (TYPE_WORD[i.type] || "Conversation");
    } else if (it.kind === "task") {
      const t = it.task;
      const done = Number(t.done) === 1 || t.done === true;
      title = t.title;
      body = done ? "Done." : t.due ? `Due ${relDay(String(t.due).slice(0, 10))}.` : "Open, no due date.";
      by = t.assigned_to_name || "";
      meta = by ? `For ${by}` : null;
    } else if (it.kind === "file") {
      const f = it.f;
      title = f.fileName;
      body = `On a ${String(f.interactionType || "conversation").replace(/_/g, " ")}${f.interactionDate ? ` from ${relDay(f.interactionDate)}` : ""}.`;
      by = f.createdByName || "";
      meta = by ? `Attached by ${by}` : null;
    } else {
      const g = it.g;
      title = `${fmtFull(Number(g.amount))}${g.fund_name ? ` to ${g.fund_name}` : ""}${g.payment_method ? ` · ${g.payment_method}` : ""}`;
      body = g.acknowledgement_sent ? `Thanked${g.acknowledged_via ? ` by ${g.acknowledged_via}` : ""}${g.acknowledged_by_name ? `, ${g.acknowledged_by_name}` : ""}.` : "Not thanked yet.";
      by = g.created_by_name || "";
    }
    return { title, body, meta, by, type };
  };
  const loggedOf = it => it.logged || (it.m && byId[it.m.interactionId]) || null;
  return (
    <section aria-label="Conversations and meetings" data-testid="dp-timeline" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 13, letterSpacing: "0.12em", fontWeight: 600, textTransform: "uppercase" }}>Everything with {first}</h2>
        <div role="group" aria-label="View" style={{ display: "inline-flex", gap: 2, padding: 2, border: "1px solid " + CHIP_EDGE, borderRadius: 10 }}>
          {seg("cards", "Timeline")}{seg("list", "List")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label="Show">
        {TIMELINE_FILTERS.map(([k, l]) => chip(k, l))}
      </div>
      {(filter === "all" || filter === "email") && massCount > 0 && <label data-testid="dp-hide-mass" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink, cursor: "pointer", alignSelf: "flex-start" }}>
        <input type="checkbox" checked={hideMass} onChange={e => setPref({ hideMass: e.target.checked })} style={{ accentColor: T.greenDk }}/>
        Hide mass emails <span style={{ color: T.ink3 }}>(campaigns, appeals and sequence steps sent to many people)</span>
      </label>}
      {quietInbox && <div data-testid="dp-connect-inbox" style={{ fontSize: 13, color: T.ink3 }}>
        {onConnect ? <button type="button" onClick={onConnect} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, textDecoration: "underline", cursor: "pointer", font: "inherit" }}>Connect your inbox</button> : "Connect your inbox"} to see emails and meetings.
      </div>}
      {!shown.length && <div style={{ fontSize: 14, color: T.ink3 }}>{filter === "file" ? "No files attached to conversations or notes yet." : filter === "task" ? `No tasks for ${first}.` : "Nothing here yet."}</div>}
      {view === "list" && shown.length > 0 && <TimelineListView
        rows={shown.slice(0, limit).map(it => { const d = describe(it); const lg = loggedOf(it);
          return { id: it.id, kind: it.kind, dateLabel: relDay(it.date), type: d.type, mass: !!it.mass,
            summary: typeof d.title === "string" ? d.title : "", by: d.by, files: lg ? (filesBy[lg.id] || []) : [] }; })}
        onOpen={r => { setPref({ view: "cards" }); setOpenId(r.id); }}/>}
      {view !== "list" && shown.slice(0, limit).map(it => {
        const isOpen = openId === it.id;
        const { title, body, meta } = describe(it);
        let extra = null;
        if (it.kind === "email") {
          const t = it.t;
          if (isOpen) extra = (t.ids || []).map(id => byId[id]).filter(Boolean).map(x => {
            let mm = {}; try { mm = typeof x.metadata === "string" ? JSON.parse(x.metadata || "{}") : (x.metadata || {}); } catch {}
            return <div key={x.id} style={{ borderTop: "1px solid " + T.bg2, paddingTop: 10, marginTop: 10, fontSize: 14, lineHeight: 1.55 }}>
              <div style={{ fontSize: 12, color: T.ink3 }}>{relDay(x.date)} · {mm.direction === "inbound" ? `From ${first}` : mm.direction === "outbound" ? `To ${first}` : "Email"}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{String(x.note || "").split("\n").slice(1).join("\n").trim() || String(x.note || "")}</div>
              {mm.provider && mm.message_id && <button type="button" onClick={e => { e.stopPropagation();
                if (!window.confirm("Remove this email from the record? Steward will not log it again.")) return;
                apiFetch("/mailbox/forget", { method: "POST", body: JSON.stringify({ interactionId: x.id }) }).then(() => onChanged && onChanged()).catch(() => {}); }}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: T.ink3, fontSize: 13, cursor: "pointer", textDecoration: "underline", font: "inherit" }}>Remove from the record</button>}
            </div>;
          });
        } else if (it.kind === "meeting" && it.m) {
          const m = it.m;
          if (isOpen) extra = <div style={{ fontSize: 14, color: T.ink3, marginTop: 8, lineHeight: 1.6 }}>
            {m.location && <div>{m.location}</div>}
            <div>{whenLabel(m.startsAt)} · from {ownerFirst(m)}'s {PROVIDER_CAL[m.provider] || "calendar"}</div>
            {!m.loggedAt && onLog && <button type="button" onClick={e => { e.stopPropagation(); onLog(m); }} style={{ ...btnOutline, marginTop: 10, padding: "8px 14px", minHeight: 36, fontSize: 14 }}>Log how it went</button>}
          </div>;
        } else if (it.kind === "gift") {
          const g = it.g;
          if (isOpen) extra = <div style={{ fontSize: 14, color: T.ink3, marginTop: 8 }}>{g.type ? `${g.type} · ` : ""}{g.date}{g.notes ? ` · ${g.notes}` : ""}</div>;
        } else if (it.kind === "file") {
          extra = <AttachmentChips files={[it.f]} canRemove={canWrite}/>;
        }
        // PARITY-1 Part B — the files on this entry, and "Attach a file".
        const lg = it.kind === "file" ? null : loggedOf(it);
        const files = lg ? (filesBy[lg.id] || []) : [];
        const attachRow = lg && lg.id && (files.length > 0 || (canWrite && isOpen)) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <AttachmentChips files={files} canRemove={canWrite}/>
            {canWrite && isOpen && <AttachButton interactionId={lg.id}/>}
          </div>) : null;
        return (
          <div key={it.id} id={it.kind === "gift" ? `gift-${it.g.id}` : undefined} role="button" tabIndex={0} aria-expanded={isOpen} data-kind={it.kind}
            onClick={() => setOpenId(isOpen ? null : it.id)} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(isOpen ? null : it.id); } }}
            style={{ background: T.white, borderRadius: 16, padding: "22px 26px", display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: 18, alignItems: "start", cursor: "pointer" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: TILE_BG[it.kind], color: it.kind === "meeting" ? T.inkInverse : T.ink,
              border: it.kind === "talk" || it.kind === "task" ? "1px solid " + T.bg3 : "none", boxSizing: "border-box",
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: 20 }}>{it.kind === "gift" ? "$" : ICON[it.kind]}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{title}{it.mass && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: T.ink3 }}>Mass email</span>}</div>
              {body && <div style={{ fontSize: 15, lineHeight: 1.5, color: T.ink3, whiteSpace: typeof body === "string" ? "pre-wrap" : undefined }}>{body}</div>}
              {meta && <div style={{ fontSize: 13, color: it.kind === "meeting" && meta.startsWith("Next") ? T.greenDk : T.ink3, fontWeight: it.kind === "meeting" && meta.startsWith("Next") ? 600 : 400 }}>{meta}</div>}
              {extra}
              {attachRow}
            </div>
            <div style={{ fontSize: 14, color: T.ink3, textAlign: "right", whiteSpace: "nowrap" }}>{relDay(it.date)}
              {/* FIX-14 Part 2: Edit/Delete and "Edited" on a logged meeting. */}
              {renderActions && lg && <div>{renderActions(lg)}</div>}
            </div>
          </div>
        );
      })}
      {shown.length > limit && <button type="button" onClick={() => setLimit(l => l + 20)} style={{ ...btnOutline, alignSelf: "flex-start" }}>Show {Math.min(20, shown.length - limit)} more</button>}
    </section>
  );
}

// ── FIX-14 Part 1 — A LOGGED CONVERSATION, READABLE ────────────────────────
// Titled by what it was and where ("Meeting at Starbucks", or "Meeting"); the
// first line of the note is not a title. The note keeps its own line breaks,
// and a run of "Label: value" lines (the touchpoint form writes them) shows as
// labelled rows.
const KIND_WORD = { meeting: "Meeting", call: "Call", email: "Email", note: "Note", ask: "Ask", stewardship: "Stewardship" };
function metaOf(i) {
  try { return typeof i?.metadata === "string" ? JSON.parse(i.metadata || "{}") : (i?.metadata || {}); } catch { return {}; }
}
export function conversationTitle(i) {
  const meta = metaOf(i);
  const word = meta.touch === "visit" ? "Visit" : KIND_WORD[i?.type || "meeting"] || "Meeting";
  const place = i?.location || meta.location || (noteFields(i?.note).find(f => /^location$/i.test(f.label)) || {}).value || "";
  return place ? `${word} at ${place}` : word;
}
export function NoteBody({ note }) {
  const text = String(note || "").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const fields = noteFields(text);
  if (fields.length >= 2) {
    const rows = lines.map((line, k) => {
      const f = noteFields(line)[0];
      return f ? { k, label: f.label, value: f.value } : line.trim() ? { k, text: line.trim() } : null;
    }).filter(Boolean).filter(r => !(r.label && /^location$/i.test(r.label)));
    return (
      <dl data-testid="note-fields" style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)", gap: "4px 14px" }}>
        {rows.map(r => r.label
          ? [<dt key={r.k + "l"} style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3, paddingTop: 3 }}>{r.label}</dt>,
             <dd key={r.k + "v"} style={{ margin: 0, color: T.ink, whiteSpace: "pre-wrap" }}>{r.value}</dd>]
          : <dd key={r.k} style={{ margin: 0, gridColumn: "1 / -1", color: T.ink, whiteSpace: "pre-wrap" }}>{r.text}</dd>)}
      </dl>
    );
  }
  return <div style={{ whiteSpace: "pre-wrap", color: T.ink3 }}>{text}</div>;
}

// What Steward heard in a note, as chips. Each one does nothing until a person
// presses it; "Not now" is remembered too. POSTs from this page only.
export function ConversationChips({ interactionId, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    setD(null); setMsg("");
    apiFetch(`/interactions/${interactionId}/suggest`, { method: "POST", body: "{}" })
      .then(r => { if (alive) setD(r); }).catch(() => { if (alive) setD({ suggestions: [] }); });
    return () => { alive = false; };
  }, [interactionId]);
  if (!d || !(d.suggestions || []).length) return msg ? <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div> : null;
  const answer = async (c, yes) => {
    setBusy(c.kind); setMsg("");
    try {
      const body = { kind: c.kind, answer: yes ? "yes" : "no" };
      if (yes && c.kind === "next") Object.assign(body, { label: c.stepLabel || "Follow up", due: c.due });
      if (yes && c.kind === "spouse") Object.assign(body, { name: c.fullName || c.name, matchId: c.matchId || undefined });
      const r = await apiFetch(`/interactions/${interactionId}/chips`, { method: "POST", body: JSON.stringify(body) });
      setD(prev => ({ ...prev, suggestions: prev.suggestions.filter(x => x.kind !== c.kind) }));
      setMsg(r.sentence || "");
      if (yes && onChanged) onChanged();
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
    setBusy("");
  };
  return (
    <div data-testid="conversation-chips" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: T.ink3 }}>{d.sentence}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {d.suggestions.map(c => (
          <span key={c.kind} style={{ display: "inline-flex", alignItems: "center", border: "1px solid " + T.ink, borderRadius: 999, background: T.white }}>
            <button type="button" data-chip={c.kind} disabled={!!busy} onClick={() => answer(c, true)} title={c.quote ? `From the note: "${c.quote}"` : undefined}
              style={{ background: "none", border: "none", padding: "7px 6px 7px 14px", font: "600 14px 'DM Sans',sans-serif", color: T.ink, cursor: busy ? "wait" : "pointer" }}>
              {busy === c.kind ? "Saving…" : c.label}
            </button>
            <button type="button" aria-label={`Not now: ${c.label}`} disabled={!!busy} onClick={() => answer(c, false)}
              style={{ background: "none", border: "none", padding: "7px 12px 7px 6px", fontSize: 13, color: T.ink3, cursor: "pointer" }}>Not now</button>
          </span>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </div>
  );
}

// ── THE RAIL ────────────────────────────────────────────────────────────────
export function RelationshipRail({ rel, donor, onReload, nextSlot = null, rhythmSlot = null, inboxConnected = true }) {
  const [booking, setBooking] = useState(false);
  const [invite, setInvite] = useState(false);
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!rel) return null;
  const first = firstNameOf(donor?.name) || "them";
  const y = rel.thisYear || {};
  const n = y.meetings?.value || 0;
  const monthsElapsed = Math.max(1, Number(String(rel.today || "").slice(5, 7)) || new Date().getMonth() + 1);
  const next = (rel.upcoming || [])[0];
  const book = async body => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch(`/donors/${donor.id}/book-visit`, { method: "POST",
        body: JSON.stringify({ ...body, title: title.trim() || `Visit with ${donor.name}`, location: place.trim() || undefined, inviteDonor: invite }) });
      setMsg(r.sentence); setBooking(false); onReload && onReload();
    } catch (e) { setMsg(e?.sentence || errorMessage(e, "Nothing was added to your calendar.")); }
    setBusy(false);
  };
  const H = ({ children, gold }) => <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: gold ? T.gold : T.sage400 }}>{children}</div>;
  const Row = ({ k, v }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}><span>{k}</span><span style={{ textAlign: "right" }}>{v}</span></div>;
  return (
    <div data-testid="dp-rail-relationship" style={{ display: "flex", flexDirection: "column", gap: 30, paddingBottom: 24, marginBottom: 8, borderBottom: "1px solid " + T.green650 }}>
      {nextSlot || <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <H gold>Next step</H>
        <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.2 }}>{rel.nextStep?.label || "Nothing planned yet."}</div>
        {rel.nextStep?.due && <div style={{ fontSize: 14, color: T.sage400 }}>Due {relDay(rel.nextStep.due)}</div>}
      </div>}
      {rhythmSlot || <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <H>Meeting rhythm · last 12 months</H>
        <div role="img" aria-label={rel.rhythmSentence} title={rel.rhythmSentence}
          style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 5 }}>
          {(rel.rhythm || []).map(m => (
            <div key={m.month} data-month={m.month} data-count={m.count}
              title={`${new Date(m.from + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}: ${m.count} meeting${m.count === 1 ? "" : "s"}${m.upcoming ? ", one still to come" : ""}`}
              style={{ height: 30, borderRadius: 4, boxSizing: "border-box",
                background: m.count > 0 ? T.gold : m.upcoming ? "transparent" : "rgba(240,237,230,0.12)",
                border: m.count === 0 && m.upcoming ? "1.5px dashed " + T.gold : "none" }}/>
          ))}
        </div>
        <div style={{ fontSize: 14, color: T.sage400, lineHeight: 1.5 }}>
          {n ? `${n} meeting${n === 1 ? "" : "s"} this year${n > 1 ? `, about every ${Math.max(1, Math.round(monthsElapsed / n))} month${Math.round(monthsElapsed / n) === 1 ? "" : "s"}` : ""}.` : "No meetings yet this year."}
          {next ? ` The next one is ${relDay(next.date || next.startsAt).toLowerCase() === "tomorrow" ? "tomorrow" : relDay(next.date || next.startsAt)}.` : ""}
        </div>
      </div>}
      {(inboxConnected || (rel.upcoming || []).length > 0) && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <H>Coming up</H>
        {(rel.upcoming || []).slice(0, 4).map(e => <Row key={e.id} k={e.title} v={<span style={{ color: T.sage400 }}>{relDay(e.date || e.startsAt)}</span>}/>)}
        {!(rel.upcoming || []).length && <div style={{ fontSize: 14, color: T.sage400 }}>Nothing coming up, on a calendar or logged ahead.</div>}
      </div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <H>This year</H>
        {(inboxConnected || y.emails?.value || n) ? <><Row k="Emails" v={<><Figure value={y.emails?.value || 0} kind="count" label="Emails this year" definition="Every email with this person on the record this year, either way." source={y.emails?.source} variant="inline"/>{" · "}<Figure value={y.fromThem?.value || 0} kind="count" label={`Emails from ${first} this year`} definition={`Every email from ${first} on the record this year.`} source={y.fromThem?.source} variant="inline"/> from {first}</>}/>
        <Row k="Meetings" v={<Figure value={n} kind="count" label="Meetings this year" definition="Every meeting with this person this year, from a connected calendar or logged by hand." source={y.meetings?.source} variant="inline"/>}/></>
          : <div data-testid="dp-rail-connect-inbox" style={{ fontSize: 14, color: T.sage400 }}>Connect your inbox to see emails and meetings.</div>}
        <Row k="Given" v={<Figure value={y.given?.value || 0} kind="money" label="Given this year" definition="Every gift from this person this year, to the cent." source={y.given?.source} variant="inline"/>}/>
      </div>
      {!booking && <button type="button" data-testid="dp-book-visit" onClick={() => setBooking(true)}
        style={{ padding: "14px 18px", minHeight: 48, border: "1.5px solid " + T.inkInverse, borderRadius: 10, background: "transparent", color: T.inkInverse, font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" }}>Book a visit on your calendar</button>}
      {booking && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, color: T.inkInverse }}>
          <H>Book a visit</H>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`Visit with ${donor.name}`} aria-label="Title" style={{ ...input, padding: 8 }}/>
          <input value={place} onChange={e => setPlace(e.target.value)} placeholder="Where (optional)" aria-label="Where" style={{ ...input, padding: 8 }}/>
          <TimeForm initialStart={Date.now() + 7 * 864e5} onSubmit={book} submitLabel="Add to my calendar" busy={busy}
            extra={<label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, width: "100%" }}>
              <input type="checkbox" checked={invite} onChange={e => setInvite(e.target.checked)}/>
              Also invite {first}. Their invitation comes from your calendar.
            </label>}/>
          <button type="button" onClick={() => setBooking(false)} style={{ background: "none", border: "none", color: T.sage400, cursor: "pointer", fontSize: 14, alignSelf: "flex-start" }}>Cancel</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 14, color: T.inkInverse, lineHeight: 1.5 }}>{msg}</div>}
    </div>
  );
}

// ── HOW DID IT GO ───────────────────────────────────────────────────────────
// FIX-14 Part 1 — the org's calendar (this was the UTC day of a local instant).
const plus = (iso, days) => orgTodayPlus(days, new Date(iso));
const FREQ_FOR = { 2: "semiannual", 4: "quarterly", 12: "monthly" };

export function AfterMeetingForm({ meeting, onDone }) {
  const person = (meeting.people || [])[0] || null;
  const first = firstNameOf(person?.name) || "them";
  const [note, setNote] = useState("");
  const [chips, setChips] = useState([]);
  const [chipNote, setChipNote] = useState("");   // FIX-12 Part 7b: says so when AI is off
  const [removed, setRemoved] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [next, setNext] = useState("");
  const [nextTouched, setNextTouched] = useState(false);
  const [due, setDue] = useState(plus(Date.now(), 7));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!note.trim()) { setChips([]); return; }
    timer.current = setTimeout(() => {
      apiFetch(`/calendar/events/${meeting.id}/suggest`, { method: "POST", body: JSON.stringify({ note }) })
        .then(r => {
          setChips(r.suggestions || []);
          setChipNote(/AI is turned off/.test(r.sentence || "") ? r.sentence : "");
          const n = (r.suggestions || []).find(c => c.kind === "next");
          if (n && !nextTouched) setNext(n.text);
        }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer.current);
  }, [note]);
  const live = chips.filter((c, i) => !removed[i] && c.kind !== "next");
  const isOn = c => confirmed[chips.indexOf(c)];
  const pledge = live.find(c => c.kind === "pledge" && isOn(c));
  const gift = live.find(c => c.kind === "gift" && isOn(c));
  const fund = live.find(c => c.kind === "fund" && isOn(c));
  const save = async e => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/calendar/events/${meeting.id}/log`, { method: "POST", body: JSON.stringify({ note, nextStep: next.trim() || null }) });
      const done = ["the note"];
      const meetingDay = civilDayOf(meeting.startsAt);   // FIX-14 Part 1 — the org-local day, not the UTC day
      if (person && pledge) {
        const count = pledge.payments > 1 ? pledge.payments : null;
        await apiFetch(`/donors/${person.id}/pledges`, { method: "POST", body: JSON.stringify({
          amount: pledge.amount, dueDate: meetingDay, notes: `From the meeting on ${meetingDay}${fund ? `, for ${fund.label}` : ""}.`,
          ...(count ? { installmentCount: count, frequency: FREQ_FOR[count] || "annual" } : {}) }) });
        done.push("the pledge");
      }
      if (person && gift) {
        await apiFetch(`/donors/${person.id}/gifts`, { method: "POST", body: JSON.stringify({ amount: gift.amount, date: meetingDay, fundId: fund?.fundId || undefined }) });
        done.push("the gift");
      }
      if (person && next.trim()) {
        try { await apiFetch(`/donors/${person.id}/threads`, { method: "POST", body: JSON.stringify({ label: next.trim(), due }) }); done.push("the next step"); }
        catch (err) { if (err?.status !== 409 && err?.error !== "thread_open") throw err;
          setMsg(`${first} already has an open next step, so this one is on the meeting only.`); }
      }
      onDone && onDone(`Saved ${done.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
    } catch (err) { setMsg(err?.sentence || err?.error || errorMessage(err, "That did not save.")); }
    setBusy(false);
  };
  const saveLabel = pledge ? "Save and record the pledge" : gift ? "Save and record the gift" : "Save";
  const end = new Date(meeting.endsAt);
  const hhmm = d => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "");
  return (
    <div data-testid="after-meeting" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", color: DARK_BRASS, fontWeight: 600, textTransform: "uppercase" }}>
          {Date.now() - end.getTime() < 3 * 3600e3 ? "Just now" : relDay(meeting.startsAt)} · {hhmm(meeting.startsAt)} to {hhmm(meeting.endsAt)}
        </div>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontWeight: 400, fontSize: 32, lineHeight: 1.12 }}>How did {meetingNoun(meeting.title)} with {first} go?</h2>
      </div>
      <form onSubmit={save} style={{ background: T.white, borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <label htmlFor={`note-${meeting.id}`} style={{ fontSize: 13, letterSpacing: "0.08em", color: T.ink3, textTransform: "uppercase" }}>What happened</label>
        <textarea id={`note-${meeting.id}`} rows={5} value={note} onChange={e => setNote(e.target.value)}
          style={{ font: "16px/1.5 'DM Sans',sans-serif", color: T.ink, border: "1px solid " + T.bg2, borderRadius: 12, padding: 12, resize: "none" }}/>
        {live.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, letterSpacing: "0.08em", color: T.ink3, textTransform: "uppercase" }}>Steward heard</span>
            {chipNote && <span data-testid="chips-ai-off" style={{ fontSize: 13, color: T.ink3 }}>{chipNote}</span>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {live.map(c => { const i = chips.indexOf(c); const on = !!confirmed[i]; return (
                <span key={i} data-chip={c.kind} data-confirmed={on ? "1" : "0"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999,
                  background: on ? T.bg2 : T.white, border: on ? "1px solid " + T.bg2 : "1px dashed " + CHIP_EDGE, fontSize: 14 }}>
                  <button type="button" onClick={() => setConfirmed(x => ({ ...x, [i]: !on }))} aria-pressed={on}
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, cursor: "pointer" }}>{on ? "✓ " : "Confirm "}{c.label}</button>
                  <button type="button" onClick={() => setRemoved(x => ({ ...x, [i]: true }))} aria-label={`Remove ${c.label}`}
                    style={{ background: "none", border: "none", padding: 0, color: T.ink3, cursor: "pointer", fontSize: 15 }}>×</button>
                </span>); })}
            </div>
            <span style={{ fontSize: 12, color: T.ink3 }}>Read from your note. Only what you confirm is recorded, and only when you save.</span>
          </div>
        )}
        <label htmlFor={`next-${meeting.id}`} style={{ fontSize: 13, letterSpacing: "0.08em", color: T.ink3, textTransform: "uppercase" }}>Next step</label>
        <input id={`next-${meeting.id}`} value={next} onChange={e => { setNext(e.target.value); setNextTouched(true); }} style={input}/>
        {next.trim() && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: T.ink3 }}>Due
          <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ ...input, width: 170, padding: 8 }}/></label>}
        <button type="submit" disabled={busy || (!note.trim() && !next.trim())}
          style={{ padding: 15, minHeight: 52, border: 0, borderRadius: 12, background: T.greenDk, color: T.white, font: "600 16px 'DM Sans',sans-serif",
            cursor: "pointer", opacity: busy || (!note.trim() && !next.trim()) ? 0.6 : 1 }}>{busy ? "Saving…" : saveLabel}</button>
        {msg && <div style={{ fontSize: 14, color: T.ink }}>{msg}</div>}
      </form>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5, padding: "0 4px" }}>
        The meeting is already on {first}'s profile from your calendar. Saving adds your note{pledge ? ", the pledge" : gift ? ", the gift" : ""}{next.trim() ? " and the next step" : ""}.
      </div>
    </div>
  );
}

// ── HOME: TODAY'S MEETINGS, AND THE ONES WAITING FOR A NOTE ────────────────
export function MorningBrief({ userName, onOpenPerson }) {
  const [today, setToday] = useState(null);
  const [toLog, setToLog] = useState(null);
  const [done, setDone] = useState("");
  const [logging, setLogging] = useState(null);
  const load = () => {
    apiFetch("/calendar/today").then(setToday).catch(() => setToday({ meetings: [] }));
    apiFetch("/calendar/to-log").then(r => setToLog(r.meetings || [])).catch(() => setToLog([]));
  };
  useEffect(() => { load(); }, []);
  if (!today || !toLog) return null;
  const upcoming = today.meetings.filter(m => new Date(m.endsAt).getTime() > Date.now());
  const lead = upcoming.find(m => m.brief) || null;
  const rest = today.meetings.filter(m => m !== lead && new Date(m.endsAt).getTime() > Date.now());
  if (!lead && !rest.length && !toLog.length && !done) return null;
  const inLabel = iso => {
    const mins = Math.round((new Date(iso) - Date.now()) / 60000);
    if (mins <= 0) return "Now";
    const h = Math.floor(mins / 60), m = mins % 60;
    return `In ${h ? `${h} hr ` : ""}${m ? `${m} min` : ""}`.trim();
  };
  const b = lead?.brief;
  const first = firstNameOf(lead?.people?.[0]?.name) || "them";
  return (
    <div data-testid="morning-brief" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {done && <div role="status" style={{ background: T.white, borderRadius: 14, padding: "12px 16px", fontSize: 14 }}>{done}</div>}
      {toLog.slice(0, 1).map(m => logging === m.id
        ? <AfterMeetingForm key={m.id} meeting={m} onDone={s => { setDone(s); setLogging(null); load(); }}/>
        : <div key={m.id} data-testid="after-prompt" style={{ background: T.white, borderRadius: 20, padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: "0.12em", color: DARK_BRASS, fontWeight: 600, textTransform: "uppercase" }}>{relDay(m.startsAt)} · {m.title}</div>
              <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.15, marginTop: 4 }}>How did {meetingNoun(m.title)} with {firstNameOf(m.people?.[0]?.name) || "them"} go?</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setLogging(m.id)} style={btnPrimary}>Write it down</button>
              <button type="button" onClick={() => apiFetch(`/calendar/events/${m.id}/dismiss`, { method: "POST", body: "{}" }).then(load)} style={{ ...btnOutline, border: "1px solid " + T.bg2 }}>Not now</button>
            </div>
          </div>)}
      {lead && (
        <section data-testid="today-meeting" style={{ background: T.ink, color: T.inkInverse, borderRadius: 20, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.12em", color: T.gold, textTransform: "uppercase" }}>{inLabel(lead.startsAt)}{lead.location ? ` · ${lead.location}` : ""}</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 1.15 }}>{lead.title}{lead.people?.[0] && !lead.title.includes(lead.people[0].name) ? ` with ${lead.people[0].name}` : ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 15, lineHeight: 1.45 }}>
            {b?.giving && <div><span style={{ opacity: 0.6 }}>Gave</span> {b.giving.text}</div>}
            {b?.openAsk && <div><span style={{ opacity: 0.6 }}>Ask open</span> {b.openAsk.text}</div>}
            {b?.lastTime && <div><span style={{ opacity: 0.6 }}>Bring up</span> {b.lastTime.text}</div>}
            {b?.unthanked && <div><span style={{ opacity: 0.6 }}>Owe {first}</span> a thank-you for the {relDay(b.unthanked.date)} gift</div>}
          </div>
          {lead.people?.[0] && onOpenPerson && <button type="button" onClick={() => onOpenPerson(lead.people[0].id)}
            style={{ marginTop: 4, padding: 14, minHeight: 48, border: 0, borderRadius: 12, background: T.inkInverse, color: T.ink, font: "600 15px 'DM Sans',sans-serif", cursor: "pointer" }}>Open {first}'s full profile</button>}
        </section>
      )}
      {rest.length > 0 && (
        <section style={{ background: T.white, borderRadius: 20, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={LABEL}>{lead ? "Also today" : "Today"}</div>
          {rest.map((m, i) => <div key={m.id}>
            {i > 0 && <div style={{ height: 1, background: T.bg2, marginBottom: 12 }}/>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15 }}>
              <span><b style={{ fontWeight: 600 }}>{new Date(m.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}</b> {m.title}</span>
              {m.people?.length === 1 && onOpenPerson
                ? <button type="button" onClick={() => onOpenPerson(m.people[0].id)} style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", font: "inherit" }}>Brief</button>
                : <span style={{ color: T.ink3 }}>{m.people?.length || 0} {m.people?.length === 1 ? "person" : "people"}</span>}
            </div>
          </div>)}
        </section>
      )}
      {(lead || rest.length > 0) && <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5, padding: "0 4px" }}>{today.sentence}</div>}
    </div>
  );
}

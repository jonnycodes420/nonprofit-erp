// FIX-1 C — VOLUNTEERS, ITS OWN HUB.
//
// Volunteers lived under Donors with a paragraph explaining why. The data model
// was right and stays (one person, one record: BUILD-94's person_types and
// BUILD-98's volunteer_shifts); what changes is that the person who coordinates
// volunteers has a place built for them rather than for the person who asks
// for money. The old hidden Volunteers.jsx (its own `volunteers` table) is NOT
// revived: the roster is everyone whose record carries the Volunteer role.
//
//   Roster            hours this year, last shift, also gives?
//   Shifts and hours  log a shift, the recent record, Wranglr/VolunteerHub import
//   Sign-up link      one link that lets anyone join the roster (copied, never sent)
//   Volunteers who give  the conversion list; every row opens the record
//   Internal notes    on each volunteer's panel. They live in volunteer_notes and
//                     never reach the giving record, its timeline, Drift or a draft.
//
// No money is drawn here on purpose: this is the coordinator's screen. Giving
// is one click away on the person's record, where it is defined.
// The client lint config has no jsx-uses-vars rule, so every component this
// file uses only in JSX reads as "never used" (ten false warnings). Off for this
// file only; checked by hand that every name below is used. (FIX-1 C)
/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { apiFetch } from "../api";
import { T, PageTitle, SectionTabs, EmptyState, Modal } from "./shared";
import { HoursImportModal } from "./VolunteerPanel";
import * as HOURS_PRESETS_MOD from "../../../shared/volunteerHours.js";
import { errorMessage } from "../lib/domainError";

const VIEWS = [
  { id: "roster", label: "Roster" },
  { id: "shifts", label: "Shifts and hours" },
  { id: "signup", label: "Sign-up link" },
  { id: "givers", label: "Volunteers who give" },
];
const NOTE_KINDS = [
  { id: "training", label: "Training" },
  { id: "background_check", label: "Background check" },
  { id: "availability", label: "Availability" },
  { id: "note", label: "Note" },
];
const KIND_LABEL = Object.fromEntries(NOTE_KINDS.map(k => [k.id, k.label]));

// Hundredths are integers end to end; this is the only place they become a
// decimal, for reading.
const hrs = h => String(Math.round(Number(h || 0)) / 100);

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const btnPrimary = { background: T.green, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: T.ink, cursor: "pointer" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.green, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" };
const card = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "18px 20px" };
const eyebrow = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };

function useNarrow() {
  const q = "(max-width: 720px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
    return () => { m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on); };
  }, []);
  return n;
}

// The defining sentence for every figure, shown where the figure is.
function Definitions({ items }) {
  const rows = items.filter(([, s]) => s);
  if (!rows.length) return null;
  return (
    <div data-testid="vol-definitions" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
      {rows.map(([k, s]) => <div key={k}><strong style={{ color: T.ink2, fontWeight: 700 }}>{k}.</strong> {s}</div>)}
    </div>
  );
}

export function VolunteersHub({ isReadOnly, onNavigate }) {
  const [view, setView] = useState("roster");
  const [roster, setRoster] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);   // the person whose panel is open
  const narrow = useNarrow();

  const loadRoster = useCallback(() => {
    apiFetch("/volunteer-hub/roster").then(r => { setRoster(r); setErr(""); })
      .catch(e => setErr(errorMessage(e, "The roster did not load.")));
  }, []);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  const openRecord = id => onNavigate && onNavigate("donors", { selectDonorId: id });

  return (
    <div data-testid="volunteers-hub" className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <PageTitle main="Your" accent="volunteers." sub={roster ? roster.sentence : " "} />
      <SectionTabs tabs={VIEWS.map(v => v.id === "roster" && roster ? { ...v, badge: roster.people.length } : v)} active={view} onSelect={setView} />
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
      {view === "roster" && <RosterView roster={roster} narrow={narrow} onOpen={setOpen} />}
      {view === "shifts" && <ShiftsView roster={roster} narrow={narrow} isReadOnly={isReadOnly} onChanged={loadRoster} onOpen={setOpen} />}
      {view === "signup" && <SignupView />}
      {view === "givers" && <GiversView narrow={narrow} onOpenRecord={openRecord} onOpen={setOpen} />}
      {open && <PersonPanel person={open} isReadOnly={isReadOnly} onClose={() => setOpen(null)} onChanged={loadRoster} onOpenRecord={id => { setOpen(null); openRecord(id); }} />}
    </div>
  );
}

// ── Roster ──────────────────────────────────────────────────────────────────
function RosterView({ roster, narrow, onOpen }) {
  if (!roster) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading the roster…</div>;
  const d = roster.definitions || {};
  if (!roster.people.length) return (
    <div style={card}>
      <EmptyState title="Nobody is on the roster yet" message={roster.sentence} />
    </div>
  );
  const cols = narrow ? "1fr auto" : "minmax(180px,2fr) 1fr 1fr 1fr";
  return (
    <div style={card} data-testid="vol-roster">
      {!narrow && (
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "0 4px 10px", borderBottom: "1px solid " + T.bg2 }}>
          <span style={eyebrow}>Volunteer</span>
          <span style={eyebrow} title={d.hoursThisYear}>Hours in {roster.year}</span>
          <span style={eyebrow} title={d.lastShift}>Last shift</span>
          <span style={eyebrow} title={d.alsoGives}>Also gives?</span>
        </div>
      )}
      {roster.people.map(p => (
        <div key={p.id} data-testid="vol-roster-row" style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "11px 4px", borderBottom: "1px solid " + T.bg2 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <button onClick={() => onOpen(p)} style={{ ...btnLink, color: T.ink, fontSize: 14 }}>{p.name}</button>
            {narrow && <span style={{ fontSize: 12, color: T.ink3 }}>Last shift {p.lastShift || "none yet"}{p.alsoGives ? " · also gives" : ""}</span>}
          </div>
          {narrow
            ? <span style={{ fontSize: 13, color: T.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{hrs(p.hundredthsThisYear)} h</span>
            : <>
                <span style={{ fontSize: 13, color: T.ink, fontWeight: 700 }}>{hrs(p.hundredthsThisYear)}</span>
                <span style={{ fontSize: 13, color: p.lastShift ? T.ink : T.ink3 }}>{p.lastShift || "None yet"}</span>
                <span style={{ fontSize: 13, color: p.alsoGives ? T.green : T.ink3, fontWeight: p.alsoGives ? 700 : 400 }}>{p.alsoGives ? "Yes" : "Not yet"}</span>
              </>}
        </div>
      ))}
      <Definitions items={[["On the roster", d.roster], [`Hours in ${roster.year}`, d.hoursThisYear], ["Last shift", d.lastShift], ["Also gives", d.alsoGives]]} />
    </div>
  );
}

// ── Shifts and hours ────────────────────────────────────────────────────────
function ShiftsView({ roster, narrow, isReadOnly, onChanged, onOpen }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ personId: "", date: "", hours: "", role: "" });
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const load = useCallback(() => { apiFetch("/volunteer-hub/shifts?limit=50").then(setData).catch(() => setData({ shifts: [] })); }, []);
  useEffect(() => { load(); }, [load]);
  const people = (roster && roster.people) || [];
  const log = async () => {
    setMsg("");
    try {
      await apiFetch(`/donors/${form.personId}/volunteer-hours`, { method: "POST", body: JSON.stringify({ date: form.date, hours: form.hours, role: form.role }) });
      setForm({ personId: form.personId, date: "", hours: "", role: "" }); setMsg("Shift logged."); load(); onChanged();
    } catch (e) { setMsg(errorMessage(e, "That shift did not save.")); }
  };
  const remove = async id => {
    setMsg("");
    try { await apiFetch(`/volunteer-shifts/${id}`, { method: "DELETE" }); load(); onChanged(); }
    catch (e) { setMsg(errorMessage(e, "That shift was not removed.")); }
  };
  const via = s => s.via === "self" ? "the volunteer, from their link" : s.via === "import" ? "an import" : (s.created_by_name || "staff");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!isReadOnly && (
        <div style={card} data-testid="vol-log-shift">
          <div style={{ ...eyebrow, marginBottom: 10 }}>Log a shift</div>
          {people.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select aria-label="Volunteer" value={form.personId} onChange={e => setForm({ ...form, personId: e.target.value })} style={{ ...inp, minWidth: 180, flex: narrow ? "1 1 100%" : "0 1 auto" }}>
                <option value="">Who volunteered?</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input aria-label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} />
              <input aria-label="Hours" type="number" step="0.25" min="0.25" max="24" placeholder="Hours" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} style={{ ...inp, width: 90 }} />
              <input aria-label="What they did" placeholder="What they did" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} />
              <button onClick={log} disabled={!form.personId || !form.date || !form.hours} style={{ ...btnPrimary, opacity: !form.personId || !form.date || !form.hours ? 0.5 : 1 }}>Log shift</button>
            </div>
          ) : <div style={{ fontSize: 13, color: T.ink3 }}>Nobody is on the roster yet. Import hours below, or tag someone Volunteer on their record.</div>}
          {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{msg}</div>}
        </div>
      )}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={eyebrow}>Recent shifts</div>
          {!isReadOnly && <button onClick={() => setImporting(true)} style={btnQuiet} data-testid="vol-import-open">Import hours from Wranglr or VolunteerHub</button>}
        </div>
        {!data ? <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>
          : !data.shifts.length ? <div style={{ fontSize: 13, color: T.ink3 }}>No shifts logged yet.</div>
          : data.shifts.map(s => (
            <div key={s.id} data-testid="vol-shift-row" style={{ display: "grid", gridTemplateColumns: narrow ? "1fr auto" : "96px minmax(140px,1.4fr) 64px 1.4fr 1.4fr auto", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13 }}>
              {narrow ? <>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <button onClick={() => onOpen({ id: s.person_id, name: s.person_name })} style={{ ...btnLink, color: T.ink }}>{s.person_name}</button>
                  <span style={{ fontSize: 12, color: T.ink3 }}>{s.date}{s.role ? " · " + s.role : ""} · logged by {via(s)}</span>
                </div>
                <span style={{ fontWeight: 700, color: T.ink, whiteSpace: "nowrap" }}>{s.hours} h</span>
              </> : <>
                <span style={{ color: T.ink3 }}>{s.date}</span>
                <button onClick={() => onOpen({ id: s.person_id, name: s.person_name })} style={{ ...btnLink, color: T.ink }}>{s.person_name}</button>
                <span style={{ fontWeight: 700, color: T.ink }}>{s.hours} h</span>
                <span style={{ color: T.ink }}>{s.role || ""}</span>
                <span style={{ color: T.ink3 }}>Logged by {via(s)}</span>
                {!isReadOnly ? <button onClick={() => remove(s.id)} style={{ ...btnLink, color: T.ink3, fontWeight: 600 }} aria-label={`Remove the shift on ${s.date}`}>Remove</button> : <span />}
              </>}
            </div>
          ))}
        {data && <Definitions items={[["Recent shifts", data.sentence]]} />}
      </div>
      {importing && <HoursImportModal onClose={() => setImporting(false)} onDone={() => { load(); onChanged(); }} Modal={Modal} Papa={Papa} presets={HOURS_PRESETS_MOD} />}
    </div>
  );
}

// ── Sign-up link ────────────────────────────────────────────────────────────
function SignupView() {
  const [link, setLink] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/volunteer-hub/signup-link").then(setLink).catch(e => setMsg(errorMessage(e, "The link did not load."))); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setMsg("Link copied."); }
    catch { setMsg("Select the link and copy it."); }
  };
  return (
    <div style={card} data-testid="vol-signup">
      <div style={{ ...eyebrow, marginBottom: 8 }}>Your volunteer sign-up link</div>
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6, marginBottom: 12, maxWidth: 640 }}>
        Put this on your website, in a newsletter, or on a poster. Whoever fills it in joins your roster as a Volunteer, on one record: if their email is already here, that person gains the Volunteer role.
      </div>
      {link && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input readOnly value={link.url} aria-label="Sign-up link" onFocus={e => e.target.select()} style={{ ...inp, flex: "1 1 260px", minWidth: 0 }} />
          <button onClick={copy} style={btnPrimary}>Copy link</button>
        </div>
      )}
      {link && <div style={{ fontSize: 12, color: T.ink3, marginTop: 10, lineHeight: 1.6 }}>{link.sentence} What they write about when they can help lands in their internal notes.</div>}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// ── Volunteers who give ─────────────────────────────────────────────────────
function GiversView({ narrow, onOpenRecord, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => { apiFetch("/volunteer-hub/givers").then(setData).catch(() => setData({ people: [], sentence: "The list did not load." })); }, []);
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;
  return (
    <div style={card} data-testid="vol-givers">
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6, marginBottom: 10 }}>{data.sentence}</div>
      {data.people.map(p => (
        <div key={p.id} data-testid="vol-giver-row" style={{ display: "grid", gridTemplateColumns: narrow ? "1fr auto" : "minmax(180px,2fr) 1fr 1fr auto", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <button onClick={() => onOpen(p)} style={{ ...btnLink, color: T.ink, fontSize: 14 }}>{p.name}</button>
            {narrow && <span style={{ fontSize: 12, color: T.ink3 }}>{hrs(p.hundredths)} hours in all · last gift {p.lastGiftDate || "not recorded"}</span>}
          </div>
          {!narrow && <span style={{ color: T.ink }}>{hrs(p.hundredths)} hours in all</span>}
          {!narrow && <span style={{ color: T.ink3 }}>Last gift {p.lastGiftDate || "not recorded"}</span>}
          <button onClick={() => onOpenRecord(p.id)} style={btnLink}>Open record</button>
        </div>
      ))}
      <Definitions items={[["Hours in all", "Every shift ever logged for this person, to the hundredth of an hour."], ["Last gift", "The date of the most recent gift on their record. Their giving is on the record itself."]]} />
    </div>
  );
}

// ── One volunteer: internal notes, a shift, their own link ─────────────────
function PersonPanel({ person, isReadOnly, onClose, onChanged, onOpenRecord }) {
  const [hours, setHours] = useState(null);
  const [notes, setNotes] = useState(null);
  const [form, setForm] = useState({ kind: "training", noteDate: "", body: "" });
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    apiFetch(`/donors/${person.id}/volunteer-hours`).then(setHours).catch(() => setHours(null));
    apiFetch(`/volunteer-hub/notes?personId=${encodeURIComponent(person.id)}`).then(setNotes).catch(() => setNotes({ notes: [] }));
  }, [person.id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setMsg("");
    try {
      await apiFetch("/volunteer-hub/notes", { method: "POST", body: JSON.stringify({ personId: person.id, ...form }) });
      setForm({ kind: form.kind, noteDate: "", body: "" }); load();
    } catch (e) { setMsg(errorMessage(e, "That note did not save.")); }
  };
  const del = async id => {
    setMsg("");
    try { await apiFetch("/volunteer-hub/notes/delete", { method: "POST", body: JSON.stringify({ id }) }); load(); }
    catch (e) { setMsg(errorMessage(e, "That note was not removed.")); }
  };
  const copyLink = async () => {
    setMsg("");
    try { const r = await apiFetch(`/donors/${person.id}/volunteer-link`, { method: "POST" }); await navigator.clipboard.writeText(r.url); setMsg(`Link copied. ${r.sentence}`); }
    catch (e) { setMsg(errorMessage(e, "Could not make the link.")); }
  };
  return (
    <Modal onClose={() => { onChanged(); onClose(); }} width={560} ariaLabel={`${person.name}, volunteer`} padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="vol-person">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, color: T.ink }}>{person.name}</div>
          <button onClick={() => onOpenRecord(person.id)} style={btnLink}>Open their record</button>
        </div>
        {hours && (
          <div title={hours.sentence}>
            <span style={{ fontSize: 20, fontWeight: 800, color: T.ink }}>{hrs(hours.hundredths)}</span>
            <span style={{ fontSize: 13, color: T.ink3 }}> hours across {hours.shiftCount} {hours.shiftCount === 1 ? "shift" : "shifts"}{hours.lastShift ? `, the last on ${hours.lastShift}` : ""}.</span>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>{hours.sentence}</div>
          </div>
        )}
        {!isReadOnly && <button onClick={copyLink} style={{ ...btnLink, fontSize: 12 }}>Copy their link to log their own hours</button>}

        <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 12 }}>
          <div style={{ ...eyebrow, marginBottom: 4 }}>Internal notes</div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, marginBottom: 10 }}>{notes ? notes.sentence : ""}</div>
          {!isReadOnly && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select aria-label="Kind of note" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={inp}>
                  {NOTE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
                <input aria-label="Date" type="date" value={form.noteDate} onChange={e => setForm({ ...form, noteDate: e.target.value })} style={inp} />
              </div>
              <textarea aria-label="Note" rows={3} placeholder="Cleared on the 5th; trained on the barn crew; free Saturday mornings…" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} style={{ ...inp, resize: "vertical" }} />
              <div><button onClick={add} disabled={!form.body.trim()} style={{ ...btnPrimary, opacity: form.body.trim() ? 1 : 0.5 }} data-testid="vol-note-add">Add note</button></div>
            </div>
          )}
          {notes && !notes.notes.length && <div style={{ fontSize: 13, color: T.ink3 }}>No notes yet.</div>}
          {notes && notes.notes.map(n => (
            <div key={n.id} data-testid="vol-note" style={{ padding: "9px 0", borderBottom: "1px solid " + T.bg2 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, color: T.ink3, flexWrap: "wrap" }}>
                <strong style={{ color: T.ink }}>{KIND_LABEL[n.kind] || n.kind}</strong>
                {n.note_date && <span>{n.note_date}</span>}
                <span>by {n.created_by_name || "someone on your team"}</span>
                {!isReadOnly && <button onClick={() => del(n.id)} style={{ ...btnLink, color: T.ink3, fontSize: 12, fontWeight: 600, marginLeft: "auto" }}>Remove</button>}
              </div>
              <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, marginTop: 3, whiteSpace: "pre-wrap" }}>{n.body}</div>
            </div>
          ))}
        </div>
        {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
      </div>
    </Modal>
  );
}

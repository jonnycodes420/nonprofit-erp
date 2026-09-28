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
import { useState, useEffect, useCallback } from "react";
import Papa from "papaparse";
import { apiFetch, API } from "../api";
import { T, PageTitle, SectionTabs, EmptyState, Modal, activeMark } from "./shared";
import { HoursImportModal } from "./VolunteerPanel";
import * as HOURS_PRESETS_MOD from "../../../shared/volunteerHours.js";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";

// ── VOL-1 · THE SAME SHAPE FUNDRAISING GOT ────────────────────────────────
// Four sections, each one a question a coordinator actually asks, with the
// old views folded in as parts underneath. Nothing was dropped: Roster,
// Shifts and hours, Sign-up link and Volunteers who give are all still here,
// under the question they answer.
//
// `giving: true` marks a part that IS about money. A volunteer coordinator
// does not get those, and the server refuses them independently.
const VOL_SECTIONS = [
  { id: "people", label: "People", question: "Who volunteers, and what have they given?",
    parts: [
      { id: "roster", label: "Roster" },
      { id: "givers", label: "Volunteers who give", giving: true },
    ] },
  { id: "schedule", label: "Schedule", question: "What is coming up, and who is coming?",
    parts: [
      { id: "opportunities", label: "Opportunities and shifts" },
      { id: "kiosk", label: "Check-in" },
    ] },
  { id: "records", label: "Records", question: "What has been given, and what is about to lapse?",
    parts: [
      { id: "shifts", label: "Shifts and hours" },
      { id: "credentials", label: "Waivers and checks" },
      { id: "report", label: "Hours report" },
    ] },
  { id: "reach", label: "Reach", question: "How do people find you, and who should be asked?",
    parts: [
      { id: "signup", label: "Sign-up link" },
      { id: "crossover", label: "Gives and volunteers", giving: true },
    ] },
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

export function VolunteersHub({ isReadOnly, onNavigate, role }) {
  const [section, setSection] = useState("people");
  const [partOf, setPartOf] = useState({ people: "roster", schedule: "opportunities", records: "shifts", reach: "signup" });
  const [roster, setRoster] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);   // the person whose panel is open
  const narrow = useNarrow();

  // A VOLUNTEER COORDINATOR DOES NOT SEE GIVING, and the parts that ARE
  // giving are not rendered behind a lock either: a locked preview of a
  // donor's giving is still a screen that is not for them (BUILD-87's rule).
  // They are simply not there, and the server refuses them independently, so
  // hiding a tab is the courtesy and the server is the boundary.
  const isCoordinator = role === "volunteer_coordinator";
  const sections = VOL_SECTIONS
    .map(sec => ({ ...sec, parts: sec.parts.filter(p => !(p.giving && isCoordinator)) }))
    .filter(sec => sec.parts.length);

  const loadRoster = useCallback(() => {
    apiFetch("/volunteer-hub/roster").then(r => { setRoster(r); setErr(""); })
      .catch(e => setErr(errorMessage(e, "The roster did not load.")));
  }, []);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  const openRecord = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const sec = sections.find(x => x.id === section) || sections[0];
  const part = (sec.parts.find(p => p.id === partOf[sec.id]) || sec.parts[0]).id;
  const setPart = id => setPartOf(m => ({ ...m, [sec.id]: id }));

  return (
    <div data-testid="volunteers-hub" className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <PageTitle main="Your" accent="volunteers." sub={roster && roster.people.length ? roster.sentence : " "} />
      <SectionTabs tabs={sections.map(x => ({ id: x.id, label: x.label }))} active={sec.id}
        onSelect={setSection} className="finance-tabbar fr-tabbar" dataKey="vol-section"
        stripProps={{ "data-vol-strip": "", "aria-label": "Volunteers" }} style={{ marginBottom: 12 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "0 0 10px" }}>
        <div style={{ fontSize: 13, color: T.ink3 }}>{sec.question}</div>
      </div>
      {sec.parts.length > 1 && (
        <div data-vol-parts="" role="navigation" aria-label={sec.label}
          style={{ display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 18, borderBottom: "1px solid " + T.bg2 }}>
          {sec.parts.map(p => {
            const on = part === p.id;
            return (
              <button key={p.id} data-vol-part={p.id} aria-current={on ? "true" : undefined} onClick={() => setPart(p.id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: T.ink3,
                         border: "none", borderRadius: "6px 6px 0 0", padding: "6px 12px", fontSize: 12.5,
                         fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", ...activeMark(on, "bottom") }}>
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
      {part === "roster" && <RosterView roster={roster} narrow={narrow} onOpen={setOpen} coordinator={isCoordinator} />}
      {part === "shifts" && <ShiftsView roster={roster} narrow={narrow} isReadOnly={isReadOnly} onChanged={loadRoster} onOpen={setOpen} />}
      {part === "signup" && <SignupView />}
      {part === "givers" && <GiversView narrow={narrow} onOpenRecord={openRecord} onOpen={setOpen} />}
      {part === "opportunities" && <OpportunitiesView isReadOnly={isReadOnly} narrow={narrow} />}
      {part === "kiosk" && <KioskView isReadOnly={isReadOnly} />}
      {part === "credentials" && <CredentialsView isReadOnly={isReadOnly} onOpenRecord={openRecord} />}
      {part === "report" && <HoursReportView narrow={narrow} />}
      {part === "crossover" && <CrossoverView onOpenRecord={openRecord} />}
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
                  <span style={{ fontSize: 12, color: T.ink3 }}>{displayDate(s.date)}{s.role ? " · " + s.role : ""} · logged by {via(s)}</span>
                </div>
                <span style={{ fontWeight: 700, color: T.ink, whiteSpace: "nowrap" }}>{s.hours} h</span>
              </> : <>
                <span style={{ color: T.ink3 }}>{displayDate(s.date)}</span>
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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch("/volunteer-hub/signup-link").then(setLink).catch(e => setMsg(errorMessage(e, "The link did not load."))); }, []);
  // FIX-1 — a link shared somewhere it should not be can be taken back: a new
  // link, and the old one stops working the moment the server answers.
  const regenerate = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch("/volunteer-hub/signup-link/regenerate", { method: "POST", body: "{}" });
      setLink(r); setConfirming(false); setMsg("New link made. The old one no longer works.");
    } catch (e) { setMsg(errorMessage(e, "The new link was not made.")); }
    setBusy(false);
  };
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
      {link && !confirming && (
        <button data-testid="vol-signup-regenerate" onClick={() => setConfirming(true)} style={{ ...btnQuiet, marginTop: 12 }}>Make a new link</button>
      )}
      {link && confirming && (
        <div data-testid="vol-signup-confirm" style={{ marginTop: 12, padding: "12px 14px", border: "1px solid " + T.bg3, borderRadius: 10, fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
          The link you have shared will stop working, everywhere it is posted. Anyone who opens it will be asked for your current link.
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button data-testid="vol-signup-regenerate-confirm" disabled={busy} onClick={regenerate} style={btnPrimary}>{busy ? "Making it…" : "Make a new link"}</button>
            <button onClick={() => setConfirming(false)} style={btnQuiet}>Keep this link</button>
          </div>
        </div>
      )}
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
                {n.note_date && <span>{displayDate(n.note_date)}</span>}
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

// ═══════════════════════════════════════════════════════════════════════════
//  VOL-1 · THE NEW VIEWS
// ═══════════════════════════════════════════════════════════════════════════

// A small hook for a read that reloads. Every view below is the same shape:
// fetch, show the sentence, show the rows, let a number open.
function useLoad(path, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    setErr("");
    apiFetch(path).then(setData).catch(e => setErr(errorMessage(e, "That did not load.")));
  }, [path]);                                          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]);       // eslint-disable-line react-hooks/exhaustive-deps
  return [data, load, err, setData];
}

const Sentence = ({ children }) => (
  <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 680 }}>{children}</p>
);

// ── Opportunities and shifts ───────────────────────────────────────────────
// The coordinator's week. An opportunity is a standing thing to do; a shift
// is one dated occurrence of it with a capacity. The public link is the
// thing she actually needs, so it is on the card, copyable, not buried.
function OpportunitiesView({ isReadOnly, narrow }) {
  const [data, reload, err] = useLoad("/volunteer-hub/opportunities");
  const [newOpp, setNewOpp] = useState(null);
  const [newSlot, setNewSlot] = useState(null);   // opportunity id
  const [openSlot, setOpenSlot] = useState(null); // slot id whose people are shown
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function createOpp(body) {
    setBusy(true);
    try { await apiFetch("/volunteer-hub/opportunities", { method: "POST", body: JSON.stringify(body) }); setNewOpp(null); reload(); }
    catch (e) { setNote(errorMessage(e, "Could not create that.")); }
    setBusy(false);
  }
  async function createSlot(body) {
    setBusy(true);
    try { await apiFetch("/volunteer-hub/slots", { method: "POST", body: JSON.stringify(body) }); setNewSlot(null); reload(); }
    catch (e) { setNote(errorMessage(e, "Could not add that shift.")); }
    setBusy(false);
  }

  if (err) return <div style={card}><div role="alert" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;

  return (
    <div data-testid="vol-opportunities" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Sentence>{data.sentence}</Sentence>
      {note && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{note}</div>}
      {!isReadOnly && (
        <div>
          <button data-testid="vol-new-opp" onClick={() => setNewOpp({ name: "", description: "", location: "", program: "" })} style={btnPrimary}>
            New opportunity
          </button>
        </div>
      )}
      {!data.opportunities.length && (
        <div style={card}>
          <EmptyState title="No opportunities yet"
            message="An opportunity is a standing thing to do, like a Saturday clean-up. A shift is one dated occurrence of it, with a capacity. Make one and Steward gives you a public page to share." />
        </div>
      )}
      {data.opportunities.map(o => (
        <div key={o.id} data-testid="vol-opp-card" style={card}>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{o.name}</span>
            {o.program && <span style={{ fontSize: 12, color: T.ink3 }}>{o.program}</span>}
            {o.requiresWaiver && <span style={pillQuiet}>Waiver needed</span>}
            {o.requiresBackgroundCheck && <span style={pillQuiet}>Background check needed</span>}
          </div>
          {o.location && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{o.location}</div>}
          {o.description && <div style={{ fontSize: 13, color: T.ink2, marginTop: 6, lineHeight: 1.5 }}>{o.description}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <code data-testid="vol-opp-url" style={{ fontSize: 11.5, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 9px", color: T.ink2, wordBreak: "break-all" }}>{o.publicUrl}</code>
            <button onClick={() => { try { navigator.clipboard.writeText(o.publicUrl); setNote("Link copied. Share it wherever your volunteers will see it."); } catch { setNote(o.publicUrl); } }}
              style={btnQuiet}>Copy the link</button>
            {!isReadOnly && <button data-testid={"vol-new-slot-" + o.id} onClick={() => setNewSlot(o.id)} style={btnQuiet}>Add a shift</button>}
          </div>

          <div style={{ marginTop: 12 }}>
            {!o.slots.length && <div style={{ fontSize: 12.5, color: T.ink3 }}>No dates up yet.</div>}
            {o.slots.map(s => (
              <div key={s.id} data-testid="vol-slot-row"
                style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(160px,1.6fr) 1fr auto",
                         gap: 10, alignItems: "center", padding: "10px 2px", borderTop: "1px solid " + T.bg2 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{s.when}</div>
                <div style={{ fontSize: 12.5, color: s.full ? T.gold700 : T.ink3 }} title="Capacity is decided when somebody signs up, not when this page was drawn.">{s.sentence}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button data-testid={"vol-slot-open-" + s.id} onClick={() => setOpenSlot(s.id)} style={{ ...btnQuiet, padding: "6px 11px", fontSize: 12 }}>Who is coming</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {newOpp && <NewOpportunityModal busy={busy} onClose={() => setNewOpp(null)} onSave={createOpp} />}
      {newSlot && <NewSlotModal busy={busy} opportunityId={newSlot} onClose={() => setNewSlot(null)} onSave={createSlot} />}
      {openSlot && <SlotPeopleModal slotId={openSlot} isReadOnly={isReadOnly} onClose={() => { setOpenSlot(null); reload(); }} />}
    </div>
  );
}

function NewOpportunityModal({ onClose, onSave, busy }) {
  const [f, setF] = useState({ name: "", description: "", location: "", program: "", requiresWaiver: false, requiresBackgroundCheck: false });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal onClose={onClose} title="New opportunity">
      <label style={lbl}>What is it called</label>
      <input data-testid="opp-name" value={f.name} onChange={e => set("name", e.target.value)} style={inp} placeholder="Saturday harbour clean-up" />
      <label style={lbl}>What it is</label>
      <textarea value={f.description} onChange={e => set("description", e.target.value)} style={{ ...inp, minHeight: 72 }} />
      <label style={lbl}>Where</label>
      <input value={f.location} onChange={e => set("location", e.target.value)} style={inp} />
      <label style={lbl}>Program (for the hours report)</label>
      <input value={f.program} onChange={e => set("program", e.target.value)} style={inp} />
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, display: "flex", gap: 7, alignItems: "center" }}>
          <input type="checkbox" checked={f.requiresWaiver} onChange={e => set("requiresWaiver", e.target.checked)} style={{ width: 16, height: 16 }} />
          Needs a signed waiver
        </label>
        <label style={{ fontSize: 13, display: "flex", gap: 7, alignItems: "center" }}>
          <input type="checkbox" checked={f.requiresBackgroundCheck} onChange={e => set("requiresBackgroundCheck", e.target.checked)} style={{ width: 16, height: 16 }} />
          Needs a background check
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button data-testid="opp-save" disabled={!f.name.trim() || busy} onClick={() => onSave(f)}
          style={{ ...btnPrimary, opacity: (!f.name.trim() || busy) ? 0.5 : 1 }}>{busy ? "Saving…" : "Create it"}</button>
        <button onClick={onClose} style={btnQuiet}>Not now</button>
      </div>
    </Modal>
  );
}

function NewSlotModal({ opportunityId, onClose, onSave, busy }) {
  const [f, setF] = useState({ date: "", startTime: "09:00", endTime: "13:00", capacity: "", notes: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal onClose={onClose} title="Add a shift">
      <label style={lbl}>Date</label>
      <input data-testid="slot-date" type="date" value={f.date} onChange={e => set("date", e.target.value)} style={inp} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label style={lbl}>Starts</label><input type="time" value={f.startTime} onChange={e => set("startTime", e.target.value)} style={inp} /></div>
        <div><label style={lbl}>Ends</label><input type="time" value={f.endTime} onChange={e => set("endTime", e.target.value)} style={inp} /></div>
      </div>
      <label style={lbl}>How many people</label>
      <input data-testid="slot-capacity" type="number" min="0" max="1000" value={f.capacity} onChange={e => set("capacity", e.target.value)} style={inp} placeholder="Leave empty for no limit" />
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>
        Leave it empty and there is no limit. Set a number and anybody who signs up after it fills goes on the waiting list, in order; if somebody drops out the first person waiting takes the place.
      </div>
      <label style={lbl}>Anything they should know</label>
      <textarea value={f.notes} onChange={e => set("notes", e.target.value)} style={{ ...inp, minHeight: 60 }} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button data-testid="slot-save" disabled={!f.date || busy} onClick={() => onSave({ ...f, opportunityId })}
          style={{ ...btnPrimary, opacity: (!f.date || busy) ? 0.5 : 1 }}>{busy ? "Saving…" : "Add it"}</button>
        <button onClick={onClose} style={btnQuiet}>Not now</button>
      </div>
    </Modal>
  );
}

function SlotPeopleModal({ slotId, onClose, isReadOnly }) {
  const [data, reload, err] = useLoad(`/volunteer-hub/slots/${slotId}/signups`);
  const [busy, setBusy] = useState(null);
  async function cancel(id) {
    setBusy(id);
    try { const r = await apiFetch(`/volunteer-hub/signups/${id}/cancel`, { method: "POST", body: "{}" }); window.alert(r.message); reload(); }
    catch (e) { window.alert(errorMessage(e, "Could not cancel that.")); }
    setBusy(null);
  }
  return (
    <Modal onClose={onClose} title={data ? `${data.slot.opportunityName} · ${data.slot.when}` : "Who is coming"}>
      {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
      {!data ? <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div> : (
        <>
          <Sentence>{data.slot.sentence}</Sentence>
          {!data.people.length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody yet.</div>}
          {data.people.map(p => (
            <div key={p.signupId} data-testid="vol-slot-person"
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid " + T.bg2, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, minWidth: 120 }}>{p.name}</span>
              <span style={{ ...pillQuiet, background: p.status === "waitlisted" ? T.gold100 : T.green100,
                             color: p.status === "waitlisted" ? T.gold700 : T.greenDk }}>{p.status === "waitlisted" ? "Waiting list" : p.status}</span>
              {p.groupName && <span style={{ fontSize: 12, color: T.ink3 }}>{p.groupName}</span>}
              {/* The credential state, where it matters: she is looking at
                  who is coming on Saturday. */}
              {data.slot.requiresWaiver && (
                <span style={{ fontSize: 12, color: (p.waiver && p.waiver.ok) ? T.ink3 : T.gold700 }}
                  title={(p.waiver && p.waiver.sentence) || "No waiver on file."}>
                  {(p.waiver && p.waiver.ok) ? "Waiver current" : "No waiver"}
                </span>
              )}
              {data.slot.requiresBackgroundCheck && (
                <span style={{ fontSize: 12, color: (p.backgroundCheck && p.backgroundCheck.ok) ? T.ink3 : T.gold700 }}
                  title={(p.backgroundCheck && p.backgroundCheck.sentence) || "No background check on file."}>
                  {(p.backgroundCheck && p.backgroundCheck.ok) ? "Check current" : "No check"}
                </span>
              )}
              {!isReadOnly && <button onClick={() => cancel(p.signupId)} disabled={busy === p.signupId}
                style={{ ...btnQuiet, marginLeft: "auto", padding: "5px 10px", fontSize: 12 }}>Take off</button>}
            </div>
          ))}
          <Definitions items={Object.entries(data.definitions || {})} />
        </>
      )}
    </Modal>
  );
}

// ── Check-in ───────────────────────────────────────────────────────────────
// A tablet at the door. Big targets, one tap to check in, one tap to check
// out, and the hours are the difference. Nothing else is on the screen.
function KioskView({ isReadOnly }) {
  const [opps] = useLoad("/volunteer-hub/opportunities");
  const [slotId, setSlotId] = useState("");
  const [board, setBoard] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    if (!slotId) { setBoard(null); return; }
    apiFetch(`/volunteer-hub/kiosk/${slotId}`).then(setBoard).catch(e => setNote(errorMessage(e, "That shift did not load.")));
  }, [slotId]);
  useEffect(() => { load(); }, [load]);

  const allSlots = (opps?.opportunities || []).flatMap(o => o.slots.map(s => ({ ...s, oppName: o.name })));

  async function tap(p) {
    setBusy(p.signupId);
    try {
      const r = await apiFetch("/volunteer-hub/checkin", { method: "POST", body: JSON.stringify({ signupId: p.signupId, kiosk: true }) });
      setNote(r.message); load();
    } catch (e) { setNote(errorMessage(e, "That did not work.")); }
    setBusy(null);
  }

  return (
    <div data-testid="vol-kiosk" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Sentence>
        A tablet at the door, or a phone in your hand. Tap a name to check somebody in and tap it again when they
        leave; the hours are the time between the two, rounded to the nearest quarter hour, and you can change
        them afterwards on the shift.
      </Sentence>
      <div style={card}>
        <label style={lbl}>Which shift</label>
        <select data-testid="kiosk-slot" value={slotId} onChange={e => setSlotId(e.target.value)} style={inp}>
          <option value="">Pick a shift…</option>
          {allSlots.map(s => <option key={s.id} value={s.id}>{s.oppName} · {s.when}</option>)}
        </select>
      </div>
      {note && <div role="status" data-testid="kiosk-note" style={{ fontSize: 13, color: T.ink2 }}>{note}</div>}
      {board && (
        <div style={card} data-testid="kiosk-board">
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 2 }}>{board.slot.opportunityName}</div>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 12 }}>{board.slot.when}</div>
          {!board.people.length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody is signed up for this one.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
            {board.people.map(p => {
              const out = !!p.checkedOutAt, inNow = !!p.checkedInAt && !out;
              return (
                <button key={p.signupId} data-testid={"kiosk-tap-" + p.signupId}
                  disabled={isReadOnly || out || busy === p.signupId} onClick={() => tap(p)}
                  style={{ textAlign: "left", minHeight: 74, borderRadius: 12, padding: "14px 16px", cursor: out ? "default" : "pointer",
                           fontFamily: "inherit", border: "1.5px solid " + (inNow ? T.greenDk : T.bg3),
                           background: out ? T.bg2 : inNow ? T.green100 : T.white, opacity: busy === p.signupId ? 0.6 : 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, color: out ? T.ink3 : inNow ? T.greenDk : T.ink3, marginTop: 3 }}>
                    {out ? "Checked out" : inNow ? "Here. Tap to check out." : p.status === "waitlisted" ? "On the waiting list" : "Tap to check in"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Waivers and background checks ──────────────────────────────────────────
function CredentialsView({ isReadOnly, onOpenRecord }) {
  const [data, reload, err] = useLoad("/volunteer-hub/credentials");
  const [adding, setAdding] = useState(false);
  if (err) return <div style={card}><div role="alert" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;
  const tone = st => st === "lapsed" ? T.gold700 : st === "expiring" ? T.gold600 : T.ink3;
  return (
    <div data-testid="vol-credentials" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Sentence>{data.sentence}</Sentence>
      {!isReadOnly && <div><button data-testid="cred-add" onClick={() => setAdding(true)} style={btnPrimary}>Record a waiver or a check</button></div>}

      {!!data.needsYou.length && (
        <div style={card} data-testid="vol-cred-needs-you">
          <div style={eyebrow}>Needs you</div>
          {data.needsYou.map(c => (
            <div key={c.personId + c.kind} style={{ padding: "10px 0", borderBottom: "1px solid " + T.bg2 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{c.nextStep ? c.nextStep.label : c.name}</div>
              <div style={{ fontSize: 12.5, color: tone(c.status), marginTop: 2 }}>{c.sentence}</div>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={eyebrow}>Everything on file</div>
        {!data.credentials.length && <div style={{ fontSize: 13, color: T.ink3, marginTop: 8 }}>Nothing recorded yet.</div>}
        {data.credentials.map(c => (
          <div key={c.personId + c.kind} data-testid="vol-cred-row"
            style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "10px 0", borderBottom: "1px solid " + T.bg2, flexWrap: "wrap" }}>
            <button onClick={() => onOpenRecord && onOpenRecord(c.personId)} style={{ ...btnLink, color: T.ink, fontSize: 13.5, minWidth: 140 }}>{c.name}</button>
            <span style={{ fontSize: 12.5, color: T.ink3, minWidth: 130 }}>{c.kind === "waiver" ? "Waiver" : "Background check"}</span>
            <span style={{ fontSize: 12.5, color: tone(c.status) }}>{c.sentence}</span>
          </div>
        ))}
        <Definitions items={Object.entries(data.definitions || {})} />
      </div>

      {adding && <AddCredentialModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddCredentialModal({ onClose, onSaved }) {
  const [roster] = useLoad("/volunteer-hub/roster");
  const [f, setF] = useState({ personId: "", kind: "background_check", signedOn: "", expiresOn: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true); setErr("");
    try { await apiFetch("/volunteer-hub/credentials", { method: "POST", body: JSON.stringify(f) }); onSaved(); }
    catch (e) { setErr(errorMessage(e, "Could not record that.")); }
    setBusy(false);
  }
  return (
    <Modal onClose={onClose} title="Record a waiver or a check">
      <label style={lbl}>Who</label>
      <select data-testid="cred-person" value={f.personId} onChange={e => set("personId", e.target.value)} style={inp}>
        <option value="">Pick a volunteer…</option>
        {(roster?.people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label style={lbl}>What</label>
      <select data-testid="cred-kind" value={f.kind} onChange={e => set("kind", e.target.value)} style={inp}>
        <option value="background_check">Background check</option>
        <option value="waiver">Waiver</option>
      </select>
      <label style={lbl}>Signed or completed on</label>
      <input data-testid="cred-signed" type="date" value={f.signedOn} onChange={e => set("signedOn", e.target.value)} style={inp} />
      <label style={lbl}>Expires on</label>
      <input data-testid="cred-expires" type="date" value={f.expiresOn} onChange={e => set("expiresOn", e.target.value)} style={inp} />
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>
        Leave the expiry empty if it does not expire. Steward warns you thirty days before, because a background
        check takes two to three weeks to come back.
      </div>
      <label style={lbl}>Your reference (optional)</label>
      <input value={f.reference} onChange={e => set("reference", e.target.value)} style={inp} />
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>Steward records that the check happened. It never holds the report.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.terracotta, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button data-testid="cred-save" disabled={!f.personId || !f.signedOn || busy} onClick={save}
          style={{ ...btnPrimary, opacity: (!f.personId || !f.signedOn || busy) ? 0.5 : 1 }}>{busy ? "Saving…" : "Record it"}</button>
        <button onClick={onClose} style={btnQuiet}>Not now</button>
      </div>
    </Modal>
  );
}

// ── The hours report ───────────────────────────────────────────────────────
// Every number opens its rows. The export is the one a funder will accept.
function HoursReportView({ narrow }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const qs = `${range.from ? `from=${range.from}&` : ""}${range.to ? `to=${range.to}` : ""}`;
  const [data, reload, err] = useLoad(`/volunteer-hub/report${qs ? "?" + qs : ""}`, [qs]);
  const [rows, setRows] = useState(null);

  async function openRows(key, label) {
    try {
      const r = await apiFetch(`/volunteer-hub/report/rows?rows=${encodeURIComponent(key)}&from=${data.from}&to=${data.to}`);
      setRows({ ...r, label });
    } catch (e) { window.alert(errorMessage(e, "Could not open those rows.")); }
  }
  function download() {
    const token = localStorage.getItem("npe_token");
    fetch(`${API}/volunteer-hub/report/export.csv?from=${data.from}&to=${data.to}`, { headers: { Authorization: "Bearer " + token } })
      .then(r => r.blob()).then(b => {
        const u = URL.createObjectURL(b); const a = document.createElement("a");
        a.href = u; a.download = `volunteer-hours-${data.from}-to-${data.to}.csv`; a.click(); URL.revokeObjectURL(u);
      }).catch(() => window.alert("The export did not download."));
  }

  if (err) return <div style={card}><div role="alert" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;

  const Block = ({ title, items, keyOf, labelOf, def }) => (
    <div style={card}>
      <div style={eyebrow} title={def}>{title}</div>
      {!items.length && <div style={{ fontSize: 13, color: T.ink3, marginTop: 8 }}>Nothing in this period.</div>}
      {items.map(r => (
        <button key={keyOf(r)} data-testid="vol-report-row" onClick={() => openRows(r.rows, labelOf(r))}
          style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 12,
                   padding: "9px 2px", borderBottom: "1px solid " + T.bg2, background: "none", border: "none",
                   borderBottomStyle: "solid", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ fontSize: 13.5, color: T.ink }}>{labelOf(r)}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{r.hours} hours</span>
        </button>
      ))}
    </div>
  );

  return (
    <div data-testid="vol-report" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Sentence>{data.sentence}</Sentence>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div><label style={lbl}>From</label><input type="date" value={range.from || data.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} style={{ ...inp, width: 170 }} /></div>
        <div><label style={lbl}>To</label><input type="date" value={range.to || data.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} style={{ ...inp, width: 170 }} /></div>
        <button data-testid="vol-report-export" onClick={download} style={btnPrimary}>Download for a funder</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 14 }}>
        <Block title="By person" items={data.byPerson} keyOf={r => r.personId} labelOf={r => r.name} def={data.definitions.person} />
        <Block title="By program" items={data.byProgram} keyOf={r => r.program} labelOf={r => r.program} def={data.definitions.program} />
      </div>
      <Block title="By month" items={data.byMonth} keyOf={r => r.month} labelOf={r => r.month} def={data.definitions.total} />
      <Definitions items={Object.entries(data.definitions || {})} />
      {rows && (
        <Modal onClose={() => setRows(null)} title={`${rows.label} · ${rows.totalHours} hours`}>
          <Sentence>{rows.sentence}</Sentence>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {rows.rows.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13 }}>
                <span>{r.date} · {r.name}</span>
                <span style={{ fontWeight: 700 }}>{r.hours} h</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── The crossover ──────────────────────────────────────────────────────────
// The thing nobody else does: volunteers who give and givers who volunteer,
// on one record.
function CrossoverView({ onOpenRecord }) {
  const [data, , err] = useLoad("/volunteer-hub/crossover");
  const [rows, setRows] = useState(null);
  if (err) return <div style={card}><div role="alert" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;
  async function open(f) {
    try { setRows({ ...(await apiFetch(`/volunteer-hub/crossover/rows?which=${f.key}`)), label: f.label }); }
    catch (e) { window.alert(errorMessage(e, "Could not open those rows.")); }
  }
  return (
    <div data-testid="vol-crossover" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!data.figures.length && (
        <div style={card}><EmptyState title="Nothing to cross over yet"
          message="When a volunteer gives, or a donor volunteers, they are one record with both on it and they appear here." /></div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {data.figures.map(f => (
          <button key={f.key} data-testid={"vol-cross-" + f.key} onClick={() => open(f)} title={f.sentence}
            style={{ ...card, cursor: "pointer", textAlign: "left", minWidth: 200, fontFamily: "inherit" }}>
            <div style={eyebrow}>{f.label}</div>
            <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, color: T.ink, lineHeight: 1.1 }}>{f.value}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6, lineHeight: 1.5, maxWidth: 320 }}>{f.sentence}</div>
          </button>
        ))}
      </div>
      {data.nextStep && (
        <div style={{ ...card, borderLeft: "3px solid " + T.greenDk }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{data.nextStep.label}</div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 3, lineHeight: 1.5 }}>{data.nextStep.why}</div>
        </div>
      )}
      {rows && (
        <Modal onClose={() => setRows(null)} title={`${rows.label} · ${rows.count}`}>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {rows.rows.map(r => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13.5 }}>
                <button onClick={() => onOpenRecord && onOpenRecord(r.id)} style={{ ...btnLink, color: T.ink }}>{r.name}</button>
                <span style={{ color: T.ink3 }}>{r.hours} hours{r.lifetimeGiving ? ` · ${fmtUsd(r.lifetimeGiving)}` : ""}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

const fmtUsd = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const lbl = { display: "block", fontSize: 12, fontWeight: 700, color: T.ink3, margin: "12px 0 4px" };
const pillQuiet = { fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "2px 9px", background: T.bg2, color: T.ink3 };

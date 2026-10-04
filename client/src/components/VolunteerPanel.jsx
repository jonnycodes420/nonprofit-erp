// BUILD-98 (switch) Part 5 — a person's volunteer hours, on their record.
//
// Shown on every profile that has hours or is a Volunteer. Hours are a count
// with its sentence (BUILD-97 Part 2): every shift logged, by staff, by the
// volunteer from their own link, or from an import. The self-log link is
// COPIED, never sent — Steward does not email a volunteer on its own.
import { useState, useEffect } from "react";
import { apiFetch, API } from "../api";
import { Figure } from "./Figure";
import { T, Modal } from "./shared";
import { AVAILABILITY } from "../../../shared/volunteerApply.js";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };

export const VOLUNTEER_HOURS_CHANGED = "steward:volunteer-hours-changed";
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const eyebrow = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 };
const QUAL_WORD = { skill: "Skill", certification: "Certification", tag: "Tag" };
const NOTE_KINDS = [["note", "Note"], ["training", "Training"], ["availability", "Availability"], ["background_check", "Background check"]];
const emptyEntry = { opportunityId: "", date: "", mode: "hm", hours: "", minutes: "", startTime: "", endTime: "", note: "" };
const changed = () => { try { window.dispatchEvent(new CustomEvent(VOLUNTEER_HOURS_CHANGED)); } catch { /* old browser */ } };
const entryBody = f => ({ opportunityId: f.opportunityId || null, date: f.date, note: f.note,
  ...(f.mode === "times" ? { startTime: f.startTime, endTime: f.endTime } : { hours: f.hours || "0", minutes: f.minutes || "0" }) });

// PARITY-3 Part 1 — THE VOLUNTEER RECORD. On the profile's main column for
// anyone with hours (under More for a volunteer with none yet): this year and
// lifetime, each opening the shifts it adds up; the hours log with its
// filters and its CSV; adding, changing and removing hours; qualifications,
// checks and waivers; their application answers; and notes, internal and the
// ones the volunteer can see, kept apart.
export function VolunteerPanel({ donor, isReadOnly, always = false }) {
  const [data, setData] = useState(null);
  const [prof, setProf] = useState(null);
  const [filt, setFilt] = useState({ from: "", to: "", opportunityId: "" });
  const [form, setForm] = useState(emptyEntry);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);
  const [qual, setQual] = useState({ kind: "skill", name: "", expiresOn: "" });
  const [note, setNote] = useState({ kind: "note", body: "", visibility: "internal" });
  const [msg, setMsg] = useState("");
  const [all, setAll] = useState(false);   // the log shows its latest eight until asked
  const qs = new URLSearchParams(Object.entries(filt).filter(([, v]) => v)).toString();
  const load = () => apiFetch(`/donors/${donor.id}/volunteer-hours${qs ? "?" + qs : ""}`).then(setData).catch(() => setData(null));
  const loadProf = () => apiFetch(`/donors/${donor.id}/volunteer-profile`).then(setProf).catch(() => setProf(null));
  useEffect(() => { load(); }, [donor.id, qs]);                 // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadProf(); }, [donor.id]);                 // eslint-disable-line react-hooks/exhaustive-deps
  // FIX-24 Part 1: "Make a volunteer" (More) says so with this event, and the
  // panel comes in without a reload.
  useEffect(() => {
    const again = () => { load(); loadProf(); };
    window.addEventListener(VOLUNTEER_HOURS_CHANGED, again);
    return () => window.removeEventListener(VOLUNTEER_HOURS_CHANGED, again);
  }, [donor.id, qs]);                                          // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  // In the main column for anyone with hours or a volunteer record (FIX-24);
  // somebody with neither has it under More, opened with `always`.
  if (!always && !data.shiftCount && !(prof && prof.record)) return null;
  const act = async (fn, fallback) => {
    setMsg("");
    try { const r = await fn(); load(); loadProf(); changed(); return r; }
    catch (e) { setMsg(errorMessage(e, fallback)); return null; }
  };
  const save = () => act(async () => {
    await apiFetch(`/donors/${donor.id}/volunteer-hours`, { method: "POST", body: JSON.stringify(entryBody(form)) });
    setForm(emptyEntry); setAdding(false); setMsg("Hours saved.");
  }, "Those hours did not save.");
  const saveEdit = () => act(async () => {
    await apiFetch(`/volunteer-shifts/${edit.id}`, { method: "PATCH", body: JSON.stringify(entryBody(edit)) });
    setEdit(null); setMsg("Changed.");
  }, "That change did not save.");
  const remove = s => act(async () => {
    await apiFetch(`/volunteer-shifts/${s.id}`, { method: "DELETE" }); setMsg(`Removed ${s.hours} hours on ${displayDate(s.date)}.`);
  }, "That did not come off.");
  const download = () => {
    const token = localStorage.getItem("npe_token");
    fetch(`${API}/donors/${donor.id}/volunteer-hours.csv${qs ? "?" + qs : ""}`, { headers: { Authorization: "Bearer " + token } })
      .then(r => r.blob()).then(b => { const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "volunteer-hours.csv"; a.click(); URL.revokeObjectURL(u); })
      .catch(() => setMsg("The file did not download."));
  };
  const copyLink = async () => {
    setMsg("");
    try { const r = await apiFetch(`/donors/${donor.id}/volunteer-link`, { method: "POST" }); await navigator.clipboard.writeText(r.url); setMsg(`Link copied. ${r.sentence}`); }
    catch (e) { setMsg(errorMessage(e, "Could not make the link.")); }
  };
  const shownTotal = data.shifts.reduce((a, s) => a + Math.round(s.hours * 100), 0) / 100;
  // A plain function, not a component: a component defined in here would be
  // a new type every render and the inputs would lose focus on each key.
  const entryFields = (f, set) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label="Opportunity" value={f.opportunityId || ""} onChange={e => set({ ...f, opportunityId: e.target.value })} style={inp}>
        <option value="">No opportunity</option>
        {data.opportunities.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input aria-label="Date" type="date" value={f.date} onChange={e => set({ ...f, date: e.target.value })} style={inp} />
      <select aria-label="How to give the hours" value={f.mode} onChange={e => set({ ...f, mode: e.target.value })} style={inp}>
        <option value="hm">Hours and minutes</option><option value="times">Start and end time</option>
      </select>
      {f.mode === "times" ? <>
        <input aria-label="Start time" type="time" value={f.startTime} onChange={e => set({ ...f, startTime: e.target.value })} style={inp} />
        <input aria-label="End time" type="time" value={f.endTime} onChange={e => set({ ...f, endTime: e.target.value })} style={inp} />
      </> : <>
        <input aria-label="Hours" inputMode="numeric" placeholder="Hours" value={f.hours} onChange={e => set({ ...f, hours: e.target.value })} style={{ ...inp, width: 64 }} />
        <input aria-label="Minutes" inputMode="numeric" placeholder="Min" value={f.minutes} onChange={e => set({ ...f, minutes: e.target.value })} style={{ ...inp, width: 56 }} />
      </>}
      <input aria-label="Notes" placeholder="Notes" value={f.note || ""} onChange={e => set({ ...f, note: e.target.value })} style={{ ...inp, flex: "1 1 140px" }} />
    </div>
  );
  return (
    <div data-testid="volunteer-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={eyebrow}>Volunteering</span>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }} data-testid="volunteer-total">
        {[data.thisYear, data.lifetime].map(t => (
          <div key={t.label} style={{ minWidth: 120 }}>
            <div style={{ fontSize: 11, color: T.ink3 }}>{t.label}</div>
            <Figure value={t.hours} kind="count" variant="inline" label={t.label} definition={t.sentence} source={t.source} figureKey={`vol-${t.label}`} />
          </div>))}
        <div style={{ fontSize: 12.5, color: T.ink3, alignSelf: "flex-end" }}>across {data.shiftCount} {data.shiftCount === 1 ? "shift" : "shifts"}</div>
      </div>
      {/* FIX-25: what they said they can give (Make a volunteer saves it), up
          here beside the hours they have given, not only at the foot. */}
      {prof && prof.record && (prof.record.hoursPerWeek != null || prof.record.availability.length > 0 || (prof.record.roles || []).length > 0) && (
        <div data-testid="volunteer-record-line" style={{ fontSize: 13, color: T.ink, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700 }}>Can give: </span>
          {[prof.record.hoursPerWeek != null ? `${prof.record.hoursPerWeek} ${prof.record.hoursPerWeek === 1 ? "hour" : "hours"} a week` : null,
            prof.record.availability.length ? prof.record.availability.join(", ") : null,
            (prof.record.roles || []).length ? `as ${prof.record.roles.join(", ")}` : null].filter(Boolean).join(" · ")}
        </div>)}
      <div data-testid="volunteer-crossover" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
        {Number(donor.total || donor.total_giving || donor.totalGiving || 0) > 0
          ? "Gives and volunteers. Their hours and their giving are on this one record."
          : "Volunteers, and has never given. They already say yes with their time."}
      </div>
      {!!(data.upcoming || []).length && (
        <div data-testid="volunteer-upcoming" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700 }}>Coming up: </span>{data.upcoming.map(u => u.when).join(" · ")}
        </div>)}

      {/* THE HOURS LOG */}
      <div data-testid="volunteer-log-table" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...eyebrow, marginRight: 4 }}>Hours log</span>
          <input aria-label="From" type="date" value={filt.from} onChange={e => setFilt({ ...filt, from: e.target.value })} style={inp} />
          <span style={{ fontSize: 12, color: T.ink3 }}>to</span>
          <input aria-label="To" type="date" value={filt.to} onChange={e => setFilt({ ...filt, to: e.target.value })} style={inp} />
          <select aria-label="Filter by opportunity" value={filt.opportunityId} onChange={e => setFilt({ ...filt, opportunityId: e.target.value })} style={inp}>
            <option value="">Every opportunity</option>
            {data.opportunities.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {data.filtered && <button style={btnLink} onClick={() => setFilt({ from: "", to: "", opportunityId: "" })}>Clear</button>}
          <button style={{ ...btnLink, marginLeft: "auto" }} onClick={download} data-testid="volunteer-csv">Download CSV</button>
        </div>
        <div style={{ fontSize: 12, color: T.ink3 }}>{data.shifts.length} {data.shifts.length === 1 ? "shift" : "shifts"}, {shownTotal} hours{data.filtered ? " in this filter" : ""}.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
            <thead><tr style={{ textAlign: "left", color: T.ink3, fontSize: 11 }}>
              <th style={{ padding: "4px 6px" }}>Date</th><th>Opportunity</th><th style={{ textAlign: "right", paddingRight: 10 }}>Hours</th><th>Entered</th><th>By</th><th>Notes</th><th />
            </tr></thead>
            <tbody>
              {(all ? data.shifts : data.shifts.slice(0, 8)).map(s => edit && edit.id === s.id ? (
                <tr key={s.id} style={{ borderTop: "1px solid " + T.bg2 }}><td colSpan={7} style={{ padding: 6 }}>
                  {entryFields(edit, setEdit)}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button style={btnQuiet} onClick={saveEdit}>Save</button><button style={btnLink} onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                </td></tr>
              ) : (
                <tr key={s.id} data-shift-row={s.id} style={{ borderTop: "1px solid " + T.bg2 }}>
                  <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>{displayDate(s.date)}</td>
                  <td>{s.opportunityName || s.role || ""}</td>
                  <td style={{ textAlign: "right", paddingRight: 10, fontWeight: 700 }}>{s.hours}{s.startTime ? <span style={{ fontWeight: 400, color: T.ink3 }}> ({s.startTime} to {s.endTime})</span> : null}</td>
                  <td style={{ whiteSpace: "nowrap", color: T.ink3 }}>{s.enteredAt ? displayDate(String(s.enteredAt).slice(0, 10)) : ""}</td>
                  <td style={{ color: T.ink3, whiteSpace: "nowrap" }}>{s.enteredBy}</td>
                  <td style={{ color: T.ink3, maxWidth: 200 }}>{s.note || ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{!isReadOnly && <>
                    <button style={btnLink} onClick={() => setEdit({ id: s.id, opportunityId: s.opportunityId || "", date: s.date, mode: s.startTime ? "times" : "hm",
                      hours: String(Math.floor(s.hours)), minutes: String(Math.round((s.hours % 1) * 60)), startTime: s.startTime || "", endTime: s.endTime || "", note: s.note || "" })}>Edit</button>{" "}
                    <button style={{ ...btnLink, color: T.ink3 }} onClick={() => remove(s)}>Remove</button></>}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
        {data.shifts.length > 8 && <button style={{ ...btnLink, alignSelf: "flex-start" }} onClick={() => setAll(v => !v)}>{all ? "Show the latest eight" : `Show all ${data.shifts.length}`}</button>}
        {!isReadOnly && (adding ? (
          <div style={{ background: T.bg, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {entryFields(form, setForm)}
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnQuiet} onClick={save} disabled={!form.date} data-testid="volunteer-log">Save hours</button>
              <button style={btnLink} onClick={() => { setAdding(false); setForm(emptyEntry); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button style={btnQuiet} onClick={() => setAdding(true)} data-testid="volunteer-add-hours">Add hours</button>
            <button style={btnLink} onClick={copyLink}>Copy their link to log hours</button>
          </div>))}
      </div>

      {/* QUALIFICATIONS, CHECKS AND WAIVERS */}
      {prof && (
        <div data-testid="volunteer-quals" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={eyebrow}>Tags and qualifications</span>
          {prof.credentials.map(c => (
            <div key={c.kind} style={{ fontSize: 12.5, color: c.ok === false ? T.gold700 : T.ink }}>{c.sentence}</div>))}
          {!prof.credentials.length && <div style={{ fontSize: 12.5, color: T.ink3 }}>No background check or waiver on file.</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {prof.qualifications.map(q => (
              <span key={q.id} style={{ fontSize: 12, border: "1px solid " + (q.expired ? T.gold : T.bg3), borderRadius: 999, padding: "2px 9px", color: T.ink }}>
                {QUAL_WORD[q.kind]}: {q.name}{q.expiresOn ? `, ${q.expired ? "ran out" : "to"} ${displayDate(q.expiresOn)}` : ""}
                {!isReadOnly && <button aria-label={`Remove ${q.name}`} style={{ ...btnLink, color: T.ink3, marginLeft: 6 }} onClick={() => act(() => apiFetch(`/volunteer-qualifications/${q.id}`, { method: "DELETE" }), "That did not come off.")}>×</button>}
              </span>))}
          </div>
          {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select aria-label="Kind" value={qual.kind} onChange={e => setQual({ ...qual, kind: e.target.value })} style={inp}>
              <option value="skill">Skill</option><option value="certification">Certification</option><option value="tag">Tag</option>
            </select>
            <input aria-label="Name" placeholder={qual.kind === "certification" ? "First aid" : qual.kind === "tag" ? "Saturday regular" : "Spanish"} value={qual.name} onChange={e => setQual({ ...qual, name: e.target.value })} style={inp} />
            {qual.kind === "certification" && <input aria-label="Runs out on" type="date" value={qual.expiresOn} onChange={e => setQual({ ...qual, expiresOn: e.target.value })} style={inp} />}
            <button style={btnQuiet} disabled={!qual.name.trim()} onClick={() => act(async () => { await apiFetch(`/donors/${donor.id}/volunteer-qualifications`, { method: "POST", body: JSON.stringify(qual) }); setQual({ kind: qual.kind, name: "", expiresOn: "" }); }, "That did not save.")}>Add</button>
          </div>}
        </div>)}

      {/* WHAT THEY TOLD YOU WHEN THEY APPLIED */}
      {prof && prof.applications.length > 0 && (
        <div data-testid="volunteer-answers" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={eyebrow}>{prof.applications[0].via === "page" ? "Their application" : "Volunteer record"}</span>
          {prof.applications.slice(0, 1).map(a => (
            <div key={a.id} style={{ fontSize: 12.5, color: T.ink, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ color: T.ink3 }}>{a.via !== "page"
                ? `Made a volunteer${a.decidedBy ? " by " + a.decidedBy : ""} on ${displayDate(String(a.decidedAt || a.submittedAt).slice(0, 10))}.`
                : `${a.status === "approved" ? `Approved${a.decidedBy ? " by " + a.decidedBy : ""}` : a.status === "declined" ? "Declined" : "Waiting for a decision"}, sent ${displayDate(String(a.submittedAt).slice(0, 10))}.`}</div>
              {a.answers.map((x, i) => <div key={i}><strong>{x.question}</strong> {x.answerText || String(x.answer ?? "")}</div>)}
              {a.hoursPerWeek != null && <div data-testid="volunteer-hours-week"><strong>Hours a week:</strong> {a.hoursPerWeek}</div>}
              {a.availability.length > 0 && <div><strong>Available:</strong> {a.availability.join(", ")}</div>}
              {(a.roles || []).length > 0 && <div><strong>Roles:</strong> {a.roles.join(", ")}</div>}
            </div>))}
        </div>)}

      {/* NOTES: INTERNAL, AND THE ONES THE VOLUNTEER CAN SEE */}
      {prof && (
        <div data-testid="volunteer-notes" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[["internal", "Internal notes", "For staff only."], ["volunteer", "Notes the volunteer can see", "These show on their own page."]].map(([vis, title, sub]) => {
            const list = prof.notes.filter(n => n.visibility === vis);
            return (
              <div key={vis}>
                <span style={eyebrow}>{title}</span> <span style={{ fontSize: 11.5, color: T.ink3 }}>{sub}</span>
                {!list.length && <div style={{ fontSize: 12.5, color: T.ink3 }}>None.</div>}
                {list.map(n => <div key={n.id} style={{ fontSize: 12.5, color: T.ink, padding: "3px 0" }}>{n.body} <span style={{ color: T.ink3 }}>· {n.by}, {displayDate(String(n.at).slice(0, 10))}</span></div>)}
              </div>);
          })}
          {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select aria-label="Note kind" value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })} style={inp}>
              {NOTE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input aria-label="Note" placeholder="Write a note" value={note.body} onChange={e => setNote({ ...note, body: e.target.value })} style={{ ...inp, flex: "1 1 200px" }} />
            <select aria-label="Who can see it" value={note.visibility} onChange={e => setNote({ ...note, visibility: e.target.value })} style={inp}>
              <option value="internal">Internal</option><option value="volunteer">The volunteer can see it</option>
            </select>
            <button style={btnQuiet} disabled={!note.body.trim()} onClick={() => act(async () => { await apiFetch("/volunteer-hub/notes", { method: "POST", body: JSON.stringify({ personId: donor.id, ...note }) }); setNote({ ...note, body: "" }); }, "That note did not save.")}>Add note</button>
          </div>}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

// Hours from Wranglr or VolunteerHub. The preset reads the file; every row the
// server refuses comes back with its line and its reason, and importing the
// same export twice adds nothing.
export function HoursImportModal({ onClose, onDone, Modal, Papa, presets }) {
  const [plan, setPlan] = useState(null);
  const [out, setOut] = useState(null);
  const [msg, setMsg] = useState("");
  const read = file => {
    setMsg(""); setOut(null);
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => {
      const headers = r.meta.fields || [];
      const key = presets.detectHoursPreset(headers);
      if (!key) { setMsg("This does not look like a Wranglr or VolunteerHub hours export."); setPlan(null); return; }
      const map = presets.mapHoursColumns(headers, key);
      setPlan({ key, label: presets.HOURS_PRESETS[key].label, ...presets.rowsToShifts(r.data, map) });
    } });
  };
  const go = async () => {
    try { setOut(await apiFetch("/volunteer-hours/import", { method: "POST", body: JSON.stringify({ shifts: plan.shifts }) })); onDone && onDone(); }
    catch (e) { setMsg(errorMessage(e, "The hours did not import.")); }
  };
  return (
    <Modal onClose={onClose} width={560} ariaLabel="Import volunteer hours" padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="hours-import">
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>Import volunteer hours</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>An hours export from Wranglr or VolunteerHub. People are matched by email, then by name; anyone new is added as a Volunteer. Importing the same file twice adds nothing.</div>
        <input type="file" accept=".csv" onChange={e => e.target.files[0] && read(e.target.files[0])} />
        {plan && <div style={{ fontSize: 13, color: T.ink }}>{plan.label}: {plan.shifts.length} shifts ready{plan.refused.length ? `, ${plan.refused.length} left out (${plan.refused.slice(0, 3).map(r => `line ${r.line}: ${r.why}`).join("; ")}${plan.refused.length > 3 ? "; and more" : ""})` : ""}.</div>}
        {out && <div role="status" style={{ fontSize: 13, color: T.ink }}>{out.imported} shifts imported{out.alreadyThere ? `, ${out.alreadyThere} were already here` : ""}{out.peopleCreated ? `, ${out.peopleCreated} new volunteers added` : ""}.</div>}
        {msg && <div role="alert" style={{ fontSize: 13, color: T.terracotta }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={go} disabled={!plan || !plan.shifts.length || !!out} style={{ background: T.gold, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" }}>Import hours</button>
          <button onClick={onClose} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "9px 14px", fontSize: 13, color: T.ink3, cursor: "pointer" }}>{out ? "Done" : "Cancel"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── VOL-2 item 1, FIX-24 Part 1 · ADD A VOLUNTEER, OR MAKE ONE OF A PERSON ──
// A name, maybe an email, maybe a phone, because that is what a coordinator
// has when somebody signs up at a table; and, since FIX-24, how many hours a
// week they can give, the days they can come and the roles they will do.
//
// `person` is the profile's "Make a volunteer": name, email and phone come from
// their record and the save is that person (POST /donors/:id/make-volunteer).
// Without it this is Volunteers > Add a volunteer, and typing a name searches
// the people already on file: picking one links THAT person, never a new one.
// Both end in makeVolunteer on the server, the function the Agent calls too.
const addInp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, fontFamily: "inherit" };
const addPrimary = { background: T.green, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer" };
const addQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: T.ink, cursor: "pointer" };
const addLabel = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink3 };
const blankAdd = { name: "", email: "", phone: "", hoursPerWeek: "", availability: [], roles: "" };
export function AddVolunteerModal({ person = null, onClose, onDone }) {
  const [form, setForm] = useState(person ? { ...blankAdd, name: person.name || "", email: person.email || "", phone: person.phone || "" } : blankAdd);
  const [linked, setLinked] = useState(person);          // somebody already on file
  const [found, setFound] = useState([]);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const term = (form.name.trim().length >= 2 ? form.name : form.email).trim();
  useEffect(() => {
    if (linked || term.length < 2) { setFound([]); return undefined; }
    let gone = false;
    const t = setTimeout(() => {
      apiFetch(`/volunteer-hub/people/search?q=${encodeURIComponent(term)}`)
        .then(r => { if (!gone) setFound(r.people || []); }).catch(() => { if (!gone) setFound([]); });
    }, 250);
    return () => { gone = true; clearTimeout(t); };
  }, [term, linked]);
  const record = { hoursPerWeek: form.hoursPerWeek, availability: form.availability, roles: form.roles };
  const save = async () => {
    setMsg(""); setBusy(true);
    try {
      const r = linked
        ? await apiFetch(`/donors/${linked.id}/make-volunteer`, { method: "POST", body: JSON.stringify(record) })
        : await apiFetch("/volunteer-hub/people", { method: "POST", body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, ...record }) });
      setOut(r); changed(); onDone && onDone(r);
    } catch (e) { setMsg(errorMessage(e, "That volunteer was not added.")); }
    finally { setBusy(false); }
  };
  const pick = p => { setLinked(p); setForm({ ...form, name: p.name, email: p.email || "", phone: p.phone || "" }); setFound([]); };
  const toggleDay = d => setForm({ ...form, availability: form.availability.includes(d) ? form.availability.filter(x => x !== d) : [...form.availability, d] });
  const can = !!linked || !!form.name.trim() || !!form.email.trim();
  const title = person ? `Make ${person.name} a volunteer` : "Add a volunteer";
  return (
    <Modal onClose={onClose} width={500} ariaLabel={title} padding={24}>
      <div data-testid="vol-add" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.ink }}>{title}</div>
        {!out ? (
          <>
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
              {linked
                ? `They stay the one record they have${person ? "" : ` (${linked.name})`}, and become a volunteer on it.`
                : "They join the roster as a volunteer. Nothing on their record says donor, because they have not given."}
            </div>
            {linked ? (
              <div data-testid="vol-add-person" style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
                <strong>{form.name}</strong>{form.email ? ` · ${form.email}` : ""}{form.phone ? ` · ${form.phone}` : ""}
                <div style={{ fontSize: 12, color: T.ink3 }}>From their record. Change these with Edit record.</div>
                {!person && <button style={{ ...btnLink, marginTop: 4 }} data-testid="vol-add-unlink" onClick={() => { setLinked(null); setForm(blankAdd); }}>Not them: add somebody new</button>}
              </div>
            ) : (
              <>
                <label style={addLabel}>
                  Name
                  <input data-testid="vol-add-name" value={form.name} autoFocus style={addInp}
                    onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                {found.length > 0 && (
                  <div data-testid="vol-add-found" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 12, color: T.ink3 }}>Already on file? Pick them and they keep their one record:</div>
                    {found.map(p => (
                      <button key={p.id} data-testid="vol-add-pick" onClick={() => pick(p)}
                        style={{ textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: T.ink }}>
                        <strong>{p.name}</strong>{p.email ? ` · ${p.email}` : ""}{p.volunteer ? " · already a volunteer" : ""}
                      </button>))}
                  </div>)}
                <label style={addLabel}>
                  Email
                  <input data-testid="vol-add-email" type="email" value={form.email} style={addInp}
                    onChange={e => setForm({ ...form, email: e.target.value })} />
                </label>
                <label style={addLabel}>
                  Phone
                  <input data-testid="vol-add-phone" value={form.phone} style={addInp}
                    onChange={e => setForm({ ...form, phone: e.target.value })} />
                </label>
              </>
            )}
            <label style={addLabel}>
              Hours a week they can give (optional)
              <input data-testid="vol-add-hours" inputMode="decimal" value={form.hoursPerWeek} style={{ ...addInp, width: 120 }}
                onChange={e => setForm({ ...form, hoursPerWeek: e.target.value })} />
            </label>
            <div style={addLabel} role="group" aria-label="When they can come">
              When they can come (optional)
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {AVAILABILITY.map(d => (
                  <label key={d} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 99, padding: "4px 10px", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.availability.includes(d)} onChange={() => toggleDay(d)} data-testid="vol-add-day" />{d}
                  </label>))}
              </div>
            </div>
            <label style={addLabel}>
              Roles (optional, separated by commas)
              <input data-testid="vol-add-roles" value={form.roles} placeholder="Food drive, Driver" style={addInp}
                onChange={e => setForm({ ...form, roles: e.target.value })} />
            </label>
            {msg && <div role="alert" style={{ fontSize: 13, color: T.terra700 }}>{msg}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={busy || !can} style={{ ...addPrimary, opacity: busy || !can ? 0.5 : 1 }}
                data-testid="vol-add-save">{busy ? "Saving…" : person ? "Make them a volunteer" : "Add them"}</button>
              <button onClick={onClose} style={addQuiet}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div role="status" data-testid="vol-add-result" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.65 }}>{out.sentence}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {!person && <button onClick={() => { setOut(null); setLinked(null); setForm(blankAdd); }} style={addQuiet}>Add another</button>}
              <button onClick={onClose} style={addPrimary} data-testid="vol-add-done">Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

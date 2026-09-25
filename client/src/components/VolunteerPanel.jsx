// BUILD-98 (switch) Part 5 — a person's volunteer hours, on their record.
//
// Shown on every profile that has hours or is a Volunteer. Hours are a count
// with its sentence (BUILD-97 Part 2): every shift logged, by staff, by the
// volunteer from their own link, or from an import. The self-log link is
// COPIED, never sent — Steward does not email a volunteer on its own.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };

export function VolunteerPanel({ donor, isReadOnly }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ date: "", hours: "", role: "" });
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/donors/${donor.id}/volunteer-hours`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [donor.id]);
  const types = Array.isArray(donor.personTypes || donor.person_types) ? (donor.personTypes || donor.person_types) : [];
  if (!data || (!data.shiftCount && !types.includes("volunteer"))) return null;
  const log = async () => {
    setMsg("");
    try { await apiFetch(`/donors/${donor.id}/volunteer-hours`, { method: "POST", body: JSON.stringify(form) }); setForm({ date: "", hours: "", role: "" }); load(); }
    catch (e) { setMsg(errorMessage(e, "That shift did not save.")); }
  };
  const copyLink = async () => {
    setMsg("");
    try { const r = await apiFetch(`/donors/${donor.id}/volunteer-link`, { method: "POST" }); await navigator.clipboard.writeText(r.url); setMsg(`Link copied. ${r.sentence}`); }
    catch (e) { setMsg(errorMessage(e, "Could not make the link.")); }
  };
  return (
    <div data-testid="volunteer-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: T.greenDk }}>Volunteering</span>
      <div title={data.sentence} aria-label={data.sentence} tabIndex={0} data-testid="volunteer-total">
        <span style={{ fontSize: 22, fontWeight: 800, color: T.ink }}>{data.totalHours}</span>
        <span style={{ fontSize: 13, color: T.ink3 }}> hours across {data.shiftCount} {data.shiftCount === 1 ? "shift" : "shifts"}</span>
      </div>
      {data.shifts.slice(0, 6).map(s => (
        <div key={s.id} style={{ display: "flex", gap: 8, fontSize: 12, color: T.ink }}>
          <span style={{ color: T.ink3, minWidth: 84 }}>{s.date}</span><span>{s.hours} h</span><span style={{ color: T.ink3 }}>{s.role || ""}</span>
          {s.via === "self" && <span style={{ color: T.ink3, marginLeft: "auto" }}>logged by them</span>}
        </div>))}
      {!isReadOnly && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={inp} />
        <input type="number" step="0.25" min="0.25" max="24" placeholder="Hours" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} style={{ ...inp, width: 80 }} />
        <input placeholder="What they did" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ ...inp, width: 150 }} />
        <button onClick={log} disabled={!form.date || !form.hours} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" }} data-testid="volunteer-log">Log a shift</button>
        <button onClick={copyLink} style={{ background: "transparent", border: "none", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Copy their link to log hours</button>
      </div>}
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

// BUILD-100 (grants) Part 7 — THE FUNDER, ON THE ORGANISATION'S OWN RECORD.
//
// A funder is not a second kind of record: it is an organisation donor with a
// funder type, and this panel sits on that donor's profile. It reads
// GET /funders/:id/grants (the one funder read) and GET /funders/:id/documents
// (every document across every grant with them — "have we ever signed
// anything with these people" spans grants). Writes: PUT /funders/:id for the
// type and the EIN (a 409 `ein_already_on_file` means two records are one
// funder, so it offers the merge tool rather than an error), and
// POST /funders/:id/grants for a new request. The status and restriction
// vocabularies come back with the read, from shared/grantShape.js.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { errorMessage } from "../lib/domainError";
import { FUNDER_TYPES } from "../../../shared/grantShape";
import { DocumentRow } from "./GrantDocuments";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };
const label = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 };

export function FunderPanel({ donorId, isReadOnly, isTeam, onOpenGrant, onMerge }) {
  const [data, setData] = useState(null);
  const [docs, setDocs] = useState([]);
  const [type, setType] = useState("");
  const [ein, setEin] = useState("");
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [dup, setDup] = useState(false);
  const load = () => Promise.all([
    apiFetch(`/funders/${donorId}/grants`),
    apiFetch(`/funders/${donorId}/documents`).catch(() => ({ documents: [] })),
  ]).then(([g, d]) => { setData(g); setType(g.funder.funderType || ""); setEin(g.funder.ein || ""); setDocs(d.documents || []); })
    .catch(e => { setData({ error: errorMessage(e, "The funder details could not be loaded."), grants: [] }); });
  useEffect(() => { load(); }, [donorId]);

  const saveFunder = async () => {
    setMsg(""); setDup(false);
    try {
      const r = await apiFetch(`/funders/${donorId}`, { method: "PUT", body: JSON.stringify({ funderType: type || null, ein: ein || null }) });
      setEin(r.ein || ""); setMsg("Saved.");
    } catch (e) {
      if (e && e.code === "ein_already_on_file") setDup(true);
      setMsg(errorMessage(e, "That did not save."));
    }
  };
  const addGrant = async () => {
    setMsg("");
    try {
      await apiFetch(`/funders/${donorId}/grants`, { method: "POST", body: JSON.stringify(form) });
      setForm(null); load();
    } catch (e) { setMsg(errorMessage(e, "That request did not save.")); }
  };
  if (!data) return null;
  if (data.error) return <div style={{ fontSize: 13, color: T.ink3 }}>{data.error}</div>;
  const canWrite = isTeam && !isReadOnly;
  const statusLabel = k => (data.statuses || []).find(s => s.key === k)?.label || k;
  const restrictionOpt = (data.restrictions || []).find(r => r.key === form?.restriction);

  return (
    <div data-testid="funder-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={label}>As a funder</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink2 }}>Funder type
            <select value={type} disabled={!canWrite} onChange={e => setType(e.target.value)} style={inp} data-testid="funder-type">
              <option value="">Not a funder</option>
              {FUNDER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink2 }}>EIN
            <input value={ein} disabled={!canWrite} placeholder="12-3456789" onChange={e => setEin(e.target.value)} style={{ ...inp, width: 130 }} data-testid="funder-ein" />
          </label>
          {canWrite && <button style={quietBtn} onClick={saveFunder} data-testid="funder-save">Save</button>}
        </div>
        {dup && onMerge && <button style={{ ...quietBtn, marginTop: 8 }} onClick={onMerge} data-testid="funder-merge">Open the merge tool</button>}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={label}>Grants with them</div>
          {canWrite && !form && <button style={{ ...quietBtn, marginLeft: "auto" }} data-testid="funder-new-grant"
            onClick={() => setForm({ program: "", amountRequested: "", status: "researching", restriction: "unrestricted", restrictedUntil: "" })}>New grant request</button>}
        </div>
        {!data.grants.length && !form && <div style={{ fontSize: 13, color: T.ink3, marginTop: 6 }}>No grants with this funder yet.</div>}
        {data.grants.map(g => (
          <div key={g.id} data-testid="funder-grant" style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{g.program || "Untitled request"}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>
                {statusLabel(g.status)} · asked {fmtFull(g.amountRequested)}{g.amountAwarded != null ? ` · awarded ${fmtFull(g.amountAwarded)}` : ""}
              </div>
            </div>
            {onOpenGrant && <button style={quietBtn} onClick={() => onOpenGrant(g.id)}>Open</button>}
          </div>))}
        {form && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input placeholder="What it is for" value={form.program} onChange={e => setForm({ ...form, program: e.target.value })} style={{ ...inp, flex: "1 1 180px" }} data-testid="fg-program" />
            <input placeholder="Amount asked" inputMode="decimal" value={form.amountRequested} onChange={e => setForm({ ...form, amountRequested: e.target.value })} style={{ ...inp, width: 130 }} data-testid="fg-amount" />
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
              {(data.statuses || []).filter(s => s.kind === "open").map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={form.restriction} onChange={e => setForm({ ...form, restriction: e.target.value })} style={inp}>
              {(data.restrictions || []).map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            {restrictionOpt?.dated && <input type="date" value={form.restrictedUntil} onChange={e => setForm({ ...form, restrictedUntil: e.target.value })} style={inp} aria-label="Restricted until" />}
            <button style={primaryBtn} onClick={addGrant} data-testid="fg-save">Save request</button>
            <button style={quietBtn} onClick={() => setForm(null)}>Cancel</button>
          </div>)}
      </div>

      {docs.length > 0 && (
        <div>
          <div style={label}>Documents across every grant</div>
          {docs.map(d => <DocumentRow key={d.id} d={d} isReadOnly showGrant />)}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

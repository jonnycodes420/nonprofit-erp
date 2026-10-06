// GRANTS-1 · A GRANT'S REPORTS, AND WHAT WENT TO THE FUNDER.
//
// GrantReportsPanel sits in the grant profile: the reports due (when, what
// the funder asked for, draft or submitted), Build (outcomes, budget against
// actual, narrative from library pieces), each section editable with a
// "Draft from the library" button, Submit, and "What went to them".
// FunderHistoryPanel is every submitted report and everything sent to one
// funder across its grants. The figures are Steward's own, stored when the
// report is built; a submitted report is kept exactly as it went. Steward
// never sends a report: a person submits it and tells Steward where it went.
// Every write offers the shared Undo (routes/grantLibrary.js).

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box", fontFamily: "inherit" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36, fontFamily: "inherit" };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36, fontFamily: "inherit" };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" };
const eyebrow = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 4 };
const DRAFT_LABEL = "Draft. Read it and change it before you submit.";
const WHAT_LABEL = { document: "Document", library: "Library piece", report: "Report", email: "Email" };
const SOURCE_LABEL = { manual: "recorded by hand", mailbox: "from the mailbox", bcc: "from a BCC" };
const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
const put = (path, body) => apiFetch(path, { method: "PUT", body: JSON.stringify(body || {}) });
const money = c => { const n = Number(c) || 0; const s = (Math.abs(n) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }); return n < 0 ? "-" + s : s; };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function SendsList({ sends, onRemove, isReadOnly, showGrant = false }) {
  if (!sends.length) return <div style={{ fontSize: 13, color: T.ink3 }}>Nothing recorded yet.</div>;
  return sends.map(s => (
    <div key={s.id} data-testid="grant-send" style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid " + T.bg2, padding: "8px 0", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13, color: T.ink }}>
        <div>
          <span style={{ color: T.ink3 }}>{s.sentOn} · </span>
          {s.direction === "in" ? "Came in: " : ""}{WHAT_LABEL[s.what] || s.what}: {s.label || s.subject}
          {s.libraryVersion ? `, version ${s.libraryVersion}` : ""}
          {s.what === "report" && s.reportVersion ? `, report ${s.reportVersion}` : ""}
        </div>
        <div style={{ fontSize: 12, color: T.ink3 }}>
          {s.direction === "in" ? "From" : "To"} {s.sentToName || s.sentToEmail || s.funderName || "the funder"}
          {s.sentToName && s.sentToEmail ? ` (${s.sentToEmail})` : ""}
          {showGrant && s.program ? ` · ${s.program}` : ""} · {SOURCE_LABEL[s.source] || s.source}
        </div>
      </div>
      {!isReadOnly && onRemove && s.source === "manual" && s.what !== "report" && (
        <button style={quietBtn} onClick={() => onRemove(s)}>Remove</button>)}
    </div>));
}

function RecordSend({ grantId, pieces, reports, onDone }) {
  const [what, setWhat] = useState("library");
  const [docs, setDocs] = useState([]);
  const [itemId, setItemId] = useState("");
  const [version, setVersion] = useState("");
  const [sentOn, setSentOn] = useState(todayIso());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    apiFetch(`/grants/${grantId}/documents`).then(d => setDocs(d.documents || [])).catch(() => setDocs([]));
  }, [grantId]);
  const options = what === "library" ? pieces.map(p => ({ id: p.id, label: `${p.title} (version ${p.version})` }))
    : what === "document" ? docs.map(d => ({ id: d.id, label: `${d.fileName}${d.version > 1 ? `, version ${d.version}` : ""}` }))
    : reports.map(r => ({ id: r.id, label: r.title }));
  const save = async () => {
    setMsg("");
    const body = { what, sentOn, sentToName: name, sentToEmail: email };
    if (what === "library") { body.libraryPieceId = itemId; if (version) body.version = Number(version); }
    else if (what === "document") body.documentId = itemId;
    else body.reportId = itemId;
    try {
      const r = await post(`/grants/${grantId}/sends`, body);
      setItemId(""); setVersion(""); onDone();
      offerUndo({ message: `Recorded that ${r.send.label} went on ${r.send.sentOn}.`, undoAction: async () => { const x = await post(`/grant-sends/${r.send.id}/remove`); onDone(); return x; } }, "record");
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  return (
    <div data-testid="record-send" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
      <select aria-label="What went" value={what} onChange={e => { setWhat(e.target.value); setItemId(""); }} style={inp}>
        <option value="library">Library piece</option>
        <option value="document">Document</option>
        <option value="report">Report</option>
      </select>
      <select aria-label="Which one" value={itemId} onChange={e => setItemId(e.target.value)} style={{ ...inp, flex: "1 1 180px" }}>
        <option value="">Choose…</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {what === "library" && <input aria-label="Version" placeholder="Version (current)" value={version} onChange={e => setVersion(e.target.value.replace(/\D/g, ""))} style={{ ...inp, width: 130 }} />}
      <input aria-label="Date it went" type="date" value={sentOn} onChange={e => setSentOn(e.target.value)} style={inp} />
      <input aria-label="To whom" placeholder="To whom" value={name} onChange={e => setName(e.target.value)} style={{ ...inp, flex: "1 1 120px" }} />
      <input aria-label="Their email" placeholder="Their email" value={email} onChange={e => setEmail(e.target.value)} style={{ ...inp, flex: "1 1 160px" }} />
      <button style={primaryBtn} disabled={!itemId} onClick={save}>Record it</button>
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, width: "100%" }}>{msg}</div>}
    </div>
  );
}

function Figures({ f }) {
  if (!f || f.none) return null;
  const rows = [["Award", f.awardedCents], ["Received", f.receivedCents], ["Spent", f.spentCents], ["Remaining (received less spent)", f.remainingCents]];
  if (f.outstandingCents > 0) rows.push(["Still owed by the funder", f.outstandingCents]);
  return (
    <div data-testid="report-figures" style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", margin: "6px 0", fontSize: 12, color: T.ink }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{k}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(v)}</span></div>))}
      {f.sentence && <div style={{ color: T.ink3, marginTop: 4 }}>{f.sentence} As of {f.asOf}, from Steward's own records, kept as they were that day.</div>}
    </div>
  );
}

function ReportEditor({ report, grantId, pieces, isReadOnly, onChanged }) {
  const [r, setR] = useState(report);
  const [picked, setPicked] = useState([]);
  const [drafted, setDrafted] = useState({});   // section key -> sentence
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [sub, setSub] = useState({ toName: "", toEmail: "", submittedOn: todayIso() });
  const [newSection, setNewSection] = useState("");
  useEffect(() => { setR(report); setDirty(false); setDrafted({}); }, [report]);
  const draft = r.status === "draft" && !isReadOnly;
  const setSection = (key, patch) => { setR(x => ({ ...x, sections: x.sections.map(s => (s.key === key ? { ...s, ...patch } : s)) })); setDirty(true); };
  const togglePiece = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const build = async () => {
    setBusy("build"); setMsg("");
    try {
      const x = await post(`/grant-reports/${r.id}/build`, { pieceIds: picked });
      onChanged(x.report);
      offerUndo({ message: "Built the report from the grant's records.", undoAction: async () => { const y = await post(`/grant-reports/${r.id}/unbuild`); onChanged(y.report); return y; } }, "report");
    } catch (e) { setMsg(errorMessage(e, "The report could not be built.")); }
    finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save"); setMsg("");
    try {
      const x = await put(`/grant-reports/${r.id}`, { title: r.title, dueDate: r.dueDate || "", askedFor: r.askedFor, sections: r.sections.map(s => ({ key: s.key, title: s.title, text: s.text, confirmed: !!s.confirmed })) });
      const was = x.previous;
      onChanged(x.report); setDrafted({});
      offerUndo({ message: "Saved the report.", undoAction: async () => { const y = await put(`/grant-reports/${r.id}`, { title: was.title, dueDate: was.dueDate || "", askedFor: was.askedFor, sections: was.sections }); onChanged(y.report); return y; } }, "report");
    } catch (e) { setMsg(errorMessage(e, "The report did not save.")); }
    finally { setBusy(""); }
  };
  const draftSection = async s => {
    if (!picked.length) { setMsg("Tick the library pieces to draft from first."); return; }
    setBusy("draft:" + s.key); setMsg("");
    try {
      const x = await post(`/grants/${grantId}/draft-section`, { section: s.title, pieceIds: picked });
      setSection(s.key, { text: x.text });
      setDrafted(d => ({ ...d, [s.key]: x.sentence || DRAFT_LABEL }));
    } catch (e) { setMsg(errorMessage(e, "No draft this time.")); }
    finally { setBusy(""); }
  };
  const addSection = () => {
    const title = newSection.trim(); if (!title) return;
    let key = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36) || "section";
    while (r.sections.some(s => s.key === key)) key += "_2";
    setR(x => ({ ...x, sections: [...x.sections, { key, title, text: "" }] })); setNewSection(""); setDirty(true);
  };
  const submit = async () => {
    setBusy("submit"); setMsg("");
    try {
      if (dirty) await put(`/grant-reports/${r.id}`, { title: r.title, dueDate: r.dueDate || "", askedFor: r.askedFor, sections: r.sections.map(s => ({ key: s.key, title: s.title, text: s.text, confirmed: !!s.confirmed })) });
      const x = await post(`/grant-reports/${r.id}/submit`, sub);
      onChanged(x.report);
      offerUndo({ message: `Submitted ${x.report.title}.`, undoAction: async () => { const y = await post(`/grant-reports/${r.id}/reopen`); onChanged(y.report); return y; } }, "report");
    } catch (e) { setMsg(errorMessage(e, "The report was not marked submitted.")); }
    finally { setBusy(""); }
  };

  return (
    <div data-testid="report-editor" style={{ borderTop: "1px solid " + T.bg2, paddingTop: 10, marginTop: 8, display: "grid", gap: 10 }}>
      {draft ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Report title" value={r.title} onChange={e => { setR({ ...r, title: e.target.value }); setDirty(true); }} style={{ ...inp, flex: "2 1 220px" }} />
          <input aria-label="Due" type="date" value={r.dueDate || ""} onChange={e => { setR({ ...r, dueDate: e.target.value }); setDirty(true); }} style={inp} />
          <textarea aria-label="What the funder asked for" placeholder="What the funder asked for" value={r.askedFor} rows={2} onChange={e => { setR({ ...r, askedFor: e.target.value }); setDirty(true); }} style={{ ...inp, width: "100%" }} />
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.ink3 }}>
          Submitted on {r.submittedOn}{r.submittedToName || r.submittedToEmail ? ` to ${r.submittedToName || r.submittedToEmail}` : ""}{r.submittedByName ? ` by ${r.submittedByName}` : ""}. Kept exactly as it went.
          {r.askedFor ? <div>They asked for: {r.askedFor}</div> : null}
        </div>
      )}
      {draft && (
        <div style={{ background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
          <div style={eyebrow}>Library pieces to use</div>
          {pieces.length ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
              {pieces.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 4, alignItems: "center", color: T.ink }}>
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={() => togglePiece(p.id)} /> {p.title}
                </label>))}
            </div>
          ) : <div style={{ fontSize: 12, color: T.ink3 }}>The library is empty. Add your mission and program descriptions under Grants, Library.</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button style={primaryBtn} disabled={!!busy} onClick={build}>{busy === "build" ? "Building…" : "Build"}</button>
            <span style={{ fontSize: 12, color: T.ink3 }}>Puts in the grant's outcomes, the budget against actual from Steward's records, and the ticked pieces as the narrative.</span>
          </div>
        </div>
      )}
      {r.startedFrom && r.status === "draft" && r.sections.some(s => s.carriedFrom) && (
        <div style={{ fontSize: 12, color: T.ink3 }}>Started from {r.sections.find(s => s.carriedFrom).carriedFrom}, the last report this funder received.</div>)}
      {r.sections.map(s => (
        <div key={s.key} data-testid="report-section" style={{ borderTop: "1px solid " + T.bg2, paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.ink }}>{s.title}</div>
            {draft && <button style={quietBtn} disabled={!!busy} onClick={() => draftSection(s)}>{busy === "draft:" + s.key ? "Drafting…" : "Draft from the library"}</button>}
          </div>
          {s.note && <div style={{ fontSize: 12, color: T.ink3 }}>{s.note}</div>}
          {s.key === "budget" && <Figures f={r.figures} />}
          {drafted[s.key] && <div role="status" data-testid="draft-label" style={{ fontSize: 12, fontWeight: 700, color: T.ink, background: T.bg, borderLeft: "3px solid " + T.gold, padding: "4px 8px", margin: "4px 0" }}>{drafted[s.key]}</div>}
          {draft
            ? <textarea aria-label={s.title} value={s.text} rows={Math.min(14, Math.max(4, String(s.text || "").split("\n").length + 1))} onChange={e => setSection(s.key, { text: e.target.value })} style={{ ...inp, width: "100%", lineHeight: 1.5 }} />
            : <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: T.ink2 }}>{s.text || "(empty)"}</div>}
          {s.needsConfirm && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.ink, marginTop: 4 }}>
              <input type="checkbox" disabled={!draft} checked={!!s.confirmed} onChange={e => setSection(s.key, { confirmed: e.target.checked })} />
              I have read these and they are true.
            </label>)}
        </div>))}
      {draft && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input aria-label="New section" placeholder="Add a section (for example, Lessons learned)" value={newSection} onChange={e => setNewSection(e.target.value)} style={{ ...inp, flex: "1 1 220px" }} />
            <button style={quietBtn} onClick={addSection}>Add section</button>
            <button style={primaryBtn} disabled={!!busy || !dirty} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
          </div>
          <div style={{ background: T.bg, borderRadius: 8, padding: "8px 10px" }}>
            <div style={eyebrow}>Submit</div>
            <div style={{ fontSize: 12, color: T.ink3, marginBottom: 6 }}>Steward does not send the report. Send it the way the funder asked, then record here who it went to. It is kept read-only from then on.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input aria-label="Sent to" placeholder="Sent to" value={sub.toName} onChange={e => setSub({ ...sub, toName: e.target.value })} style={{ ...inp, flex: "1 1 140px" }} />
              <input aria-label="Their email" placeholder="Their email" value={sub.toEmail} onChange={e => setSub({ ...sub, toEmail: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} />
              <input aria-label="Date it went" type="date" value={sub.submittedOn} onChange={e => setSub({ ...sub, submittedOn: e.target.value })} style={inp} />
              <button style={primaryBtn} disabled={!!busy} onClick={submit}>{busy === "submit" ? "Saving…" : "Mark submitted"}</button>
            </div>
          </div>
        </>
      )}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

export function GrantReportsPanel({ grantId, funderId, isReadOnly = false }) {
  const [reports, setReports] = useState(null);
  const [sends, setSends] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", dueDate: "", askedFor: "" });
  const [msg, setMsg] = useState("");
  const loadReports = () => apiFetch(`/grants/${grantId}/reports`).then(d => setReports(d.reports || []))
    .catch(e => { setReports([]); setMsg(errorMessage(e, "The reports could not be loaded.")); });
  const loadSends = () => apiFetch(`/grants/${grantId}/sends`).then(d => setSends(d.sends || [])).catch(() => setSends([]));
  useEffect(() => {
    loadReports(); loadSends();
    apiFetch("/grant-library").then(d => setPieces(d.pieces || [])).catch(() => setPieces([]));
  }, [grantId]);
  const changed = rep => { setReports(rs => (rs || []).map(x => (x.id === rep.id ? rep : x))); loadSends(); };

  const create = async () => {
    setMsg("");
    try {
      const x = await post(`/grants/${grantId}/reports`, form);
      setAdding(false); setForm({ title: "", dueDate: "", askedFor: "" });
      await loadReports(); setOpen(x.report.id);
      if (x.startedFrom) setMsg(`Started from ${x.startedFrom.title}, the last report this funder received. Press Build to bring this grant's figures in.`);
      offerUndo({ message: `Started ${x.report.title}.`, undoAction: async () => { const y = await post(`/grant-reports/${x.report.id}/remove`); setOpen(null); loadReports(); return y; } }, "report");
    } catch (e) { setMsg(errorMessage(e, "The report was not started.")); }
  };
  const removeSend = async s => {
    try {
      await post(`/grant-sends/${s.id}/remove`); loadSends();
      offerUndo({ message: "Took that record off.", undoAction: async () => {
        const body = { what: s.what, sentOn: s.sentOn, sentToName: s.sentToName, sentToEmail: s.sentToEmail, documentId: s.documentId, libraryPieceId: s.libraryPieceId, version: s.libraryVersion, reportId: s.reportId };
        const y = await post(`/grants/${grantId}/sends`, body); loadSends(); return y; } }, "record");
    } catch (e) { setMsg(errorMessage(e, "That record was not taken off.")); }
  };

  if (!reports) return null;
  const drafts = reports.filter(r => r.status !== "submitted");
  const done = reports.filter(r => r.status === "submitted");
  const row = r => (
    <div key={r.id} data-testid="grant-report" style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{r.title}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>
            {r.status === "submitted" ? `Submitted ${r.submittedOn}${r.submittedToName ? ` to ${r.submittedToName}` : ""} · report ${r.version}` : `Draft${r.dueDate ? ` · due ${r.dueDate}` : ""}`}
            {r.askedFor ? ` · they asked for: ${r.askedFor.length > 80 ? r.askedFor.slice(0, 80) + "…" : r.askedFor}` : ""}
          </div>
        </div>
        <button style={quietBtn} onClick={() => setOpen(o => (o === r.id ? null : r.id))}>{open === r.id ? "Close" : "Open"}</button>
      </div>
      {open === r.id && <ReportEditor report={r} grantId={grantId} pieces={pieces} isReadOnly={isReadOnly} onChanged={changed} />}
    </div>);

  return (
    <div data-testid="grant-reports" style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...eyebrow, flex: 1, marginBottom: 0 }}>Reports</div>
          {!isReadOnly && !adding && <button style={quietBtn} onClick={() => setAdding(true)}>New report</button>}
        </div>
        {adding && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input aria-label="Title" placeholder="Title (for example, Year one report)" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={{ ...inp, flex: "2 1 200px" }} />
            <input aria-label="Due" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} style={inp} />
            <textarea aria-label="What the funder asked for" placeholder="What the funder asked for" rows={2} value={form.askedFor} onChange={e => setForm({ ...form, askedFor: e.target.value })} style={{ ...inp, width: "100%" }} />
            <button style={primaryBtn} onClick={create}>Start the report</button>
            <button style={quietBtn} onClick={() => setAdding(false)}>Cancel</button>
          </div>)}
        {!reports.length && !adding && <div style={{ fontSize: 13, color: T.ink3, marginTop: 4 }}>No reports yet. When this funder expects one, start it here; it begins from the last report they received.</div>}
        {drafts.map(row)}
        {done.length > 0 && <div style={{ ...eyebrow, marginTop: 10 }}>Submitted</div>}
        {done.map(row)}
        {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
      </div>
      <div style={card} data-testid="what-went">
        <div style={eyebrow}>What went to them</div>
        <SendsList sends={sends} isReadOnly={isReadOnly} onRemove={removeSend} />
        {!isReadOnly && <RecordSend grantId={grantId} pieces={pieces} reports={reports} onDone={loadSends} />}
      </div>
      {funderId && <FunderHistoryPanel key={`${done.length}:${sends.length}`} funderId={funderId} />}
    </div>
  );
}

export function FunderHistoryPanel({ funderId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([apiFetch(`/funders/${funderId}/reports`), apiFetch(`/funders/${funderId}/sends`)])
      .then(([r, s]) => { if (alive) setData({ name: r.funder.name, reports: r.reports || [], sends: s.sends || [] }); })
      .catch(e => { if (alive) setData({ name: "", reports: [], sends: [], err: errorMessage(e, "The funder's history could not be loaded.") }); });
    return () => { alive = false; };
  }, [funderId]);
  if (!data) return null;
  return (
    <div style={card} data-testid="funder-history">
      <div style={eyebrow}>Everything sent to {data.name || "this funder"}</div>
      {data.err && <div style={{ fontSize: 12, color: T.ink3 }}>{data.err}</div>}
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>Reports</div>
      {!data.reports.length && <div style={{ fontSize: 13, color: T.ink3 }}>No submitted reports yet.</div>}
      {data.reports.map(r => (
        <div key={r.id} style={{ borderTop: "1px solid " + T.bg2, padding: "6px 0", fontSize: 13, color: T.ink }}>
          <span style={{ color: T.ink3 }}>{r.submittedOn} · </span>{r.title}
          <span style={{ color: T.ink3 }}> · report {r.version}{r.program ? ` · ${r.program}` : ""}{r.submittedToName || r.submittedToEmail ? ` · to ${r.submittedToName || r.submittedToEmail}` : ""}</span>
        </div>))}
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 10 }}>Everything else</div>
      <SendsList sends={data.sends.filter(s => s.what !== "report")} isReadOnly showGrant />
    </div>
  );
}

export default GrantReportsPanel;

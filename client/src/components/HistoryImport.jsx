// IMPORT-2 · Bring your notes and history.
//
// One wizard for everything people wrote about their donors in the old system:
// notes, call and meeting reports, open tasks, attached letters, relationships,
// tags, and the communication preferences buried in the words. A CSV, an Excel
// file, or a zip of exports (with the attachments inside it), up to 25 MB a file.
//
// Three steps and nothing saved until the third:
//   1. the file,
//   2. the preview: counts by kind, ten rows as they will read on the timeline,
//      who matched and how, the rows that wait for a person (ambiguous,
//      unmatched), every row Steward cannot read and why, the day-first dates,
//      and every preference found in the words, each unticked until confirmed,
//   3. the result, with one Undo for all of it.
import { useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { analyzeCsvText, decodeSpreadsheetBytesDetailed } from "../../../shared/importShape";

const MAX_BYTES = 25 * 1024 * 1024;
const DATA_EXT = /\.(csv|txt|xlsx|xls)$/i;
const FIELD_LABELS = {
  externalId: "Old system's id", name: "Name", firstName: "First name", lastName: "Last name", email: "Email",
  address: "Address", date: "Date", kind: "Type", subject: "Subject", note: "Note text", author: "Written by",
  owner: "Task owner", status: "Task status", due: "Due date", attachment: "Attachment", relationship: "Relationship",
  relatedTo: "Related person", tags: "Tags",
};
const KIND_LABEL = { note: "Notes", call: "Calls", meeting: "Meetings", visit: "Visits", email: "Emails", letter: "Letters",
  text: "Texts", event: "Event conversations", task: "Tasks" };

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink,
  border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit" });

async function readTable(blob, name) {
  if (/\.(xlsx|xls)$/i.test(name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    return { headers: rows.length ? Object.keys(rows[0]) : [], rows };
  }
  const dec = decodeSpreadsheetBytesDetailed(new Uint8Array(await blob.arrayBuffer()));
  const a = analyzeCsvText(dec.text);
  return { headers: a.headers, rows: a.rows };
}

// A zip opens into its data files (read and joined when they share columns)
// and everything else, kept by name as the attachments the rows refer to.
async function openFile(file) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB. Split it and bring it in as two files.`);
  if (!/\.zip$/i.test(file.name)) {
    if (!DATA_EXT.test(file.name)) throw new Error(`${file.name} is not a CSV, Excel or zip file.`);
    return { ...(await readTable(file, file.name)), attachments: new Map(), files: [file.name] };
  }
  const JSZip = (await import("jszip")).default;
  const z = await JSZip.loadAsync(file);
  const attachments = new Map(); let headers = null; const rows = []; const files = []; const skipped = [];
  for (const e of Object.values(z.files)) {
    if (e.dir || /(^|\/)(__MACOSX|\.)/.test(e.name)) continue;
    const name = e.name.split("/").pop();
    const blob = await e.async("blob");
    if (blob.size > MAX_BYTES) { skipped.push(`${name} is larger than 25 MB`); continue; }
    if (DATA_EXT.test(name)) {
      const t = await readTable(blob, name);
      if (!headers) headers = t.headers;
      if (t.headers.join("|") !== headers.join("|")) { skipped.push(`${name} has different columns from the first file, so bring it in on its own`); continue; }
      rows.push(...t.rows); files.push(name);
    } else attachments.set(name.toLowerCase(), { name, blob });
  }
  if (!headers) throw new Error("That zip has no CSV or Excel file in it.");
  return { headers, rows, attachments, files, skipped };
}

const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

export default function HistoryImport({ onClose, onDone }) {
  const [file, setFile] = useState(null);         // { name, headers, rows, attachments, files, skipped }
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [picks, setPicks] = useState({});         // row index -> donor id
  const [create, setCreate] = useState({});       // group key -> true
  const [flags, setFlags] = useState({});         // "donorId|flag" -> true
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState(null);
  const [undone, setUndone] = useState(null);

  const runPreview = async (f, map, pk = picks) => {
    setBusy("preview"); setMsg("");
    try {
      const r = await apiFetch("/history-import/preview", { method: "POST",
        body: JSON.stringify({ fileName: f.name, headers: f.headers, rows: f.rows, mapping: map, picks: pk }) });
      setPreview(r); setMapping(r.mapping);
    } catch (e) { setMsg(e?.body?.sentence || errorMessage(e, "Steward could not read that file.")); }
    setBusy("");
  };

  const choose = async fl => {
    if (!fl) return;
    setBusy("read"); setMsg(""); setPreview(null); setResult(null);
    try {
      const opened = await openFile(fl);
      const f = { name: fl.name, ...opened };
      setFile(f);
      await runPreview(f, null, {});
    } catch (e) { setMsg(e.message || "That file could not be opened."); setBusy(""); }
  };

  const commit = async () => {
    setBusy("commit"); setMsg("");
    const importId = "imp_hist_" + Math.random().toString(36).slice(2, 12);
    const createIdx = (preview.unmatched || []).filter(g => create[g.key]).flatMap(g => g.indexes);
    const confirmFlags = Object.keys(flags).filter(k => flags[k]).map(k => { const [donorId, flag] = k.split("|"); return { donorId, flag }; });
    try {
      const r = await apiFetch("/history-import/commit", { method: "POST",
        body: JSON.stringify({ importId, fileName: file.name, headers: file.headers, rows: file.rows, mapping, picks, create: createIdx, confirmFlags }) });
      // The attachments the zip carried go onto the lines that named them.
      let kept = 0, missing = 0;
      for (const a of r.attachments || []) {
        const hit = file.attachments.get(String(a.fileName).toLowerCase());
        if (!hit) { missing++; continue; }
        try {
          await apiFetch(`/interactions/${encodeURIComponent(a.interactionId)}/attachments`, { method: "POST",
            body: JSON.stringify({ file: await toDataUrl(hit.blob), fileName: hit.name }) });
          kept++;
        } catch { missing++; }
      }
      setResult({ ...r, kept, missing });
      onDone && onDone();
    } catch (e) { setMsg(e?.body?.sentence || errorMessage(e, "That did not save. Nothing was brought in.")); }
    setBusy("");
  };

  const undo = async () => {
    setBusy("undo");
    try { const r = await apiFetch(`/imports/${encodeURIComponent(result.importId)}/reverse`, { method: "POST", body: "{}" }); setUndone(r.sentence); onDone && onDone(); }
    catch (e) { setMsg(e?.body?.message || errorMessage(e, "That did not undo.")); }
    setBusy("");
  };

  const c = preview?.counts;
  return (
    <Modal onClose={onClose} title="Bring your notes and history" width={860} ariaLabel="Bring your notes and history"
      subtitle="Notes, calls, meetings, open tasks and attached letters from your old system, each on the right person's timeline with its original date and author.">
      <div data-testid="history-import" style={{ display: "flex", flexDirection: "column", gap: 12, color: T.ink }}>
        {msg && <div role="alert" style={{ ...box, borderColor: T.gold500, fontSize: 13 }}>{msg}</div>}

        {!result && (
          <div style={box}>
            <div style={h3}>Your file</div>
            <div style={small}>A CSV or Excel export, or a zip of exports with the attached files inside it. Up to 25 MB a file. Bloomerang, DonorPerfect, Salesforce NPSP, Neon, Little Green Light, Raiser's Edge, Kindful, Givebutter, Zeffy or a plain spreadsheet.</div>
            <input data-testid="history-file" type="file" accept=".csv,.txt,.xlsx,.xls,.zip" style={{ marginTop: 8, maxWidth: "100%" }}
              onChange={e => choose(e.target.files && e.target.files[0])} />
            {busy === "read" || busy === "preview" ? <div style={{ ...small, marginTop: 6 }}>Reading…</div> : null}
            {file?.skipped?.length ? <div style={{ ...small, marginTop: 6, color: T.gold700 }}>Left out: {file.skipped.join("; ")}.</div> : null}
          </div>
        )}

        {preview && !result && (preview.needsMapping ? null : (
          <>
            <div style={box} data-testid="history-summary">
              <div style={h3}>{preview.preset?.label || "A spreadsheet"}{preview.preset?.ambiguous ? " (or another system with the same columns)" : ""}</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {c.rows.toLocaleString()} rows: {c.matched.toLocaleString()} matched to people, {c.ambiguous} to choose, {c.unmatched} matching nobody, {c.refused} Steward cannot read.
              </div>
              <div style={{ ...small, marginTop: 4 }}>
                Matched by the old system's id {c.byMethod.id.toLocaleString()}, by email {c.byMethod.email.toLocaleString()}, by name {c.byMethod.name.toLocaleString()}{c.byMethod.picked ? `, chosen by you ${c.byMethod.picked}` : ""}. {preview.definition}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, fontSize: 12.5 }}>
                {Object.entries(c.byKind).map(([k, n]) => <span key={k}><strong>{n.toLocaleString()}</strong> {KIND_LABEL[k] || k}</span>)}
              </div>
              <div style={{ ...small, marginTop: 6 }}>
                {c.openTasks} open {c.openTasks === 1 ? "task becomes a task" : "tasks become tasks"} on your list{c.openTasksOverdue ? `, ${c.openTasksOverdue} already past due` : ""}; {c.completedTasks} finished ones become history. {c.html} notes were written in HTML and come in as plain text. {c.attachments} rows name an attached file.
              </div>
            </div>

            <div style={box} data-testid="history-sample">
              <div style={h3}>Ten rows as they will read</div>
              {(preview.sample || []).map(s => (
                <div key={s.line} style={{ borderTop: "1px solid " + T.bg2, padding: "7px 0", fontSize: 12.5 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", color: T.ink3 }}>
                    <span>{s.date}</span><strong style={{ color: T.ink }}>{s.donorName}</strong><span>{s.kindLabel}{s.taskOpen ? `, due ${s.due}` : ""}</span>{s.author ? <span>by {s.author}</span> : null}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{s.text}</div>
                </div>
              ))}
            </div>

            {preview.prefs?.length > 0 && (
              <div style={box} data-testid="history-prefs">
                <div style={h3}>Preferences found in the notes ({preview.prefs.length})</div>
                <div style={small}>Nothing here is set until you tick it. Each one sets Steward's own flag on that person, which keeps them off appeals and call lists.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" style={btn(false)} data-testid="history-prefs-all"
                    onClick={() => setFlags(Object.fromEntries(preview.prefs.filter(p => !p.already).map(p => [`${p.donorId}|${p.flag}`, true])))}>Tick every one</button>
                  <button type="button" style={btn(false)} onClick={() => setFlags({})}>Clear</button>
                </div>
                <div style={{ maxHeight: 220, overflow: "auto", marginTop: 6 }}>
                  {preview.prefs.map(p => (
                    <label key={p.donorId + p.flag} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, padding: "4px 0", borderTop: "1px solid " + T.bg2 }}>
                      <input type="checkbox" data-pref={p.flag} disabled={p.already} checked={p.already || !!flags[`${p.donorId}|${p.flag}`]}
                        onChange={e => setFlags(f => ({ ...f, [`${p.donorId}|${p.flag}`]: e.target.checked }))} />
                      <span><strong>{p.name}</strong>: {p.label}{p.already ? " (already set)" : ""}. <span style={{ color: T.ink3 }}>"{p.phrase}", line {p.lines.slice(0, 4).join(", ")}{p.lines.length > 4 ? "…" : ""}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {preview.ambiguous?.length > 0 && (
              <div style={box} data-testid="history-ambiguous">
                <div style={h3}>Rows that could be more than one person ({preview.ambiguous.length})</div>
                <div style={small}>Choose who each one is about. A row you leave is not brought in.</div>
                {preview.ambiguous.map(a => (
                  <div key={a.line} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, padding: "5px 0", borderTop: "1px solid " + T.bg2 }}>
                    <span style={{ flex: "1 1 200px" }}>Line {a.line}: {a.who}</span>
                    <select value={picks[a.index] || ""} onChange={e => setPicks(p => ({ ...p, [a.index]: e.target.value }))}
                      style={{ flex: "1 1 220px", maxWidth: "100%", padding: "6px 8px", border: "1px solid " + T.bg3, borderRadius: 7, fontFamily: "inherit" }}>
                      <option value="">Leave it out</option>
                      {a.candidates.map(cd => <option key={cd.id} value={cd.id}>{cd.name}{cd.email ? ` · ${cd.email}` : ""}{cd.city ? ` · ${cd.city}` : ""}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {preview.unmatched?.length > 0 && (
              <div style={box} data-testid="history-unmatched">
                <div style={h3}>Rows that match nobody in Steward ({preview.unmatched.reduce((s, g) => s + g.lines.length, 0)} rows, {preview.unmatched.length} people)</div>
                <div style={small}>Tick "Create this person" to add them with these rows on their timeline. Anything left unticked is not brought in.</div>
                {preview.unmatched.map(g => (
                  <label key={g.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "5px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
                    <input type="checkbox" disabled={!g.canCreate} checked={!!create[g.key]} onChange={e => setCreate(cr => ({ ...cr, [g.key]: e.target.checked }))} />
                    <span style={{ flex: 1, minWidth: 0 }}>{g.who} <span style={{ color: T.ink3 }}>· line {g.lines.join(", ")}</span>{g.canCreate ? " · Create this person" : " · no name or email to create a person from"}</span>
                  </label>
                ))}
              </div>
            )}

            {(preview.refused?.length > 0 || preview.dayFirst?.length > 0) && (
              <div style={box} data-testid="history-refused">
                {preview.refused?.length > 0 && <>
                  <div style={h3}>Rows Steward cannot read ({preview.refused.length})</div>
                  {preview.refused.slice(0, 50).map(r => <div key={r.line} style={{ fontSize: 12.5 }}>Line {r.line}: {r.reason}</div>)}
                </>}
                {preview.dayFirst?.length > 0 && <>
                  <div style={{ ...h3, marginTop: preview.refused?.length ? 10 : 0 }}>Dates read day first ({preview.dayFirst.length})</div>
                  <div style={small}>{preview.dateRule}</div>
                  <div style={{ maxHeight: 140, overflow: "auto", marginTop: 4 }}>
                    {preview.dayFirst.slice(0, 200).map(d => <div key={d.line} style={{ fontSize: 12.5 }}>Line {d.line}: {d.raw} read as {d.read}</div>)}
                  </div>
                </>}
              </div>
            )}

            <details style={box}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Columns ({Object.keys(mapping || {}).length} read{preview.unmappedHeaders?.length ? `, ${preview.unmappedHeaders.length} left out` : ""})</summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8, marginTop: 8 }}>
                {(preview.fields || []).map(f => (
                  <label key={f} style={{ fontSize: 12 }}>{FIELD_LABELS[f] || f}
                    <select value={mapping?.[f] || ""} onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value) n[f] = e.target.value; else delete n[f]; return n; })}
                      style={{ display: "block", width: "100%", marginTop: 2, padding: "5px 7px", border: "1px solid " + T.bg3, borderRadius: 7, fontFamily: "inherit" }}>
                      <option value="">Not in this file</option>
                      {file.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={() => runPreview(file, mapping)}>Read it again with these columns</button>
            </details>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" style={btn(false)} onClick={() => runPreview(file, mapping)} disabled={!!busy}>Check again</button>
              <button type="button" data-testid="history-commit" style={btn(true)} onClick={commit} disabled={!!busy}>
                {busy === "commit" ? "Bringing it in…" : `Bring it in`}
              </button>
            </div>
          </>
        ))}

        {preview?.needsMapping && !result && (
          <div style={box}><div style={{ fontSize: 13 }}>{preview.sentence}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8, marginTop: 8 }}>
              {(preview.fields || []).map(f => (
                <label key={f} style={{ fontSize: 12 }}>{FIELD_LABELS[f] || f}
                  <select value={mapping?.[f] || ""} onChange={e => setMapping(m => { const n = { ...m }; if (e.target.value) n[f] = e.target.value; else delete n[f]; return n; })}
                    style={{ display: "block", width: "100%", marginTop: 2, padding: "5px 7px", border: "1px solid " + T.bg3, borderRadius: 7 }}>
                    <option value="">Not in this file</option>
                    {file.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" style={{ ...btn(true), marginTop: 8 }} onClick={() => runPreview(file, mapping)}>Read it with these columns</button>
          </div>
        )}

        {result && (
          <div style={box} data-testid="history-result">
            <div style={{ fontSize: 15, fontWeight: 700 }}>{undone || result.sentence}</div>
            {!undone && <>
              {(result.kept > 0 || result.missing > 0) && <div style={{ ...small, marginTop: 4 }}>
                {result.kept} attached {result.kept === 1 ? "file was" : "files were"} kept on the person. {result.missing ? `${result.missing} named in the file were not in it, so the timeline says they were attached in your old system.` : ""}
              </div>}
              <div style={{ ...small, marginTop: 6 }} data-testid="history-engagement">
                Engagement for the people it touched, before and after: {Object.entries(result.engagement?.before || {}).map(([k, n]) => `${n} ${k === "no_history" ? "with no history yet" : k}`).join(", ") || "none"} → {Object.entries(result.engagement?.after || {}).map(([k, n]) => `${n} ${k === "no_history" ? "with no history yet" : k}`).join(", ")}.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" style={btn(false)} data-testid="history-undo" onClick={undo} disabled={!!busy}>{busy === "undo" ? "Undoing…" : "Undo all of it"}</button>
                <button type="button" style={btn(true)} onClick={onClose}>Done</button>
              </div>
            </>}
          </div>
        )}
      </div>
    </Modal>
  );
}

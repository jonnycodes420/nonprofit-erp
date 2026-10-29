// SpreadsheetImport · IMPORT-3. (SheetImport.jsx is SHEETS-1, grants and board reports.)
// Any spreadsheet, read the way a person would.
//
// The file is read here (the one reader, shared/sheetRead.js, the same one the
// server walks), sent to POST /sheet-import/understand, and what Steward
// understood is shown before anything is written: the people new and matched,
// the gifts and pledges with their totals, the event, every row it could not
// read with its row number. It asks only what it truly cannot tell (when, a
// blank "paid?" cell, a column it cannot name, which of two people). One
// Import button; Undo removes the whole file.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { dismissUndo } from "./EditHistory";
import { T, Modal } from "./shared";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import ImportUndo from "./ImportUndo";
import ImportGiftLine from "./ImportGiftLine";   // FIX-58: one accounting
import { FirstLook } from "./Insights";   // INSIGHTS-1 the first look
import { errorMessage, isNetworkFailure } from "../lib/domainError";
import { pageOrgName } from "../lib/orgBinding";
import { decodeSpreadsheetBytesDetailed } from "../../../shared/importShape";
import { gridsFromWorkbook, gridFromText, SHEET_ROLES, pledgeMoneyWords } from "../../../shared/sheetRead";
import { told } from "../lib/stewardTold";   // HOME-3: the pages behind the window re-read

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const field = { flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit" };
const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, textDecoration: "underline", cursor: "pointer", fontSize: 12, fontFamily: "inherit" };
const chip = { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: T.bg, color: T.ink, marginLeft: 6 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink,
  border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit" });
const STD_ROLES = SHEET_ROLES.filter(r => r.key !== "ignore");
const money = c => (c < 0 ? "-$" : "$") + (Math.abs(Math.round(c)) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : (many || one + "s")}`;
const longDate = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SHEET_FILE_RE = /\.(csv|tsv|txt|xlsx|xlsm|xls|ods)$/i;

// FIX-55: a spreadsheet dropped on a page (Donors, Settings, Imports) opens
// this same reader with that file. Anything else dropped is not ours.
export function droppedSpreadsheet(e) {
  const fs = Array.from((e && e.dataTransfer && e.dataTransfer.files) || []).filter(f => SHEET_FILE_RE.test(f.name || ""));
  return filesAsOne(fs);
}
// IMPORT-5: two files from one system (a Salesforce Contacts export and its
// Donations export) are one import: read together, people linked by their ID.
// More than one file is one file-like thing whose sheets are every file's.
export function filesAsOne(list) {
  const fs = Array.from(list || []).filter(Boolean);
  if (fs.length <= 1) return fs[0] || null;
  return { name: fs.map(f => f.name).join(" + "), lastModified: Math.max(...fs.map(f => f.lastModified || 0)) || undefined, files: fs };
}
export function isFileDrag(e) {
  return !!(e && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
}

// FIX-55: a page that takes a dropped spreadsheet. While a file is dragged
// over it, it says so; the dropped file opens the one reader (onFile).
export function SheetDropTarget({ onFile, disabled, children, style, testId = "sheet-drop-page" }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (disabled) return <div style={style}>{children}</div>;
  return (
    <div data-testid={testId} style={{ position: "relative", ...style }}
      onDragEnter={e => { if (isFileDrag(e)) { depth.current++; setOver(true); } }}
      onDragOver={e => { if (isFileDrag(e)) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={e => { if (!isFileDrag(e)) return; e.preventDefault(); depth.current = 0; setOver(false); const f = droppedSpreadsheet(e); if (f) onFile(f); }}>
      {children}
      {over && (
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 50, borderRadius: 16, border: "2px dashed " + T.greenDk, background: T.white + "e6",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: T.greenDk, pointerEvents: "none" }}>
          Drop the spreadsheet to read it. Nothing is saved until you press Import.
        </div>
      )}
    </div>
  );
}

// Said after the window closes on a running import: the window is gone, the
// import is not. A plain node on the page, gone after a few seconds.
function sayAfterClose(text) {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("data-testid", "sheet-closed-note");
  el.textContent = text;
  Object.assign(el.style, { position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: "500", maxWidth: "calc(100vw - 32px)",
    background: T.ink, color: T.white, borderRadius: "10px", padding: "10px 16px", fontSize: "13.5px", fontWeight: "600", boxShadow: "0 6px 24px rgba(0,0,0,.25)" });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// Any file → sheets of cells. xlsx, xls, csv, tsv and a Google Sheets download
// all come through here.
export async function readSheetFile(file) {
  if (file && file.files) {
    // each file's sheets keep their file's name, so two CSVs are two sheets
    const out = [];
    for (const f of file.files) {
      const base = String(f.name || "file").replace(/\.[a-z]+$/i, "");
      const sh = await readSheetFile(f);
      for (const x of sh) out.push({ ...x, name: sh.length === 1 ? base : `${base} · ${x.name}` });
    }
    return out;
  }
  const name = String(file.name || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await import("xlsx");
    return gridsFromWorkbook(XLSX.read(buf, { type: "array", cellDates: true }), XLSX);
  }
  const dec = decodeSpreadsheetBytesDetailed(buf);
  return [{ name: "Sheet1", grid: gridFromText(dec.text) }];
}

// HOME-3 item 4 · THE PAGES BEHIND THE WINDOW KEEP UP. The Donors page still
// said "No donors yet" after a successful import until a reload: the window
// was closed while the import was still writing (it runs as a job on the
// server, FIX-52), so nothing behind it was told when it finished. Closing the
// window now tells every page that listens (told(), lib/stewardTold.js: the
// App's data, Donors, Home), at once when the import is done, and when it
// finishes if it is still running. One follower per import, outliving the window.
// FIX-57: closed after Import was pressed but before the server's answer set
// the job, it follows the run's own id (the job's id is the run id), and a
// 404 while the commit is still on its way is asked again for a while.
const followed = new Set();
function tellWhenDone(id, { inFlight = false } = {}) {
  if (!id || followed.has(id)) return;
  followed.add(id);
  let early = inFlight ? 20 : 0;
  const tick = async () => {
    try {
      const j = await apiFetch(`/sheet-import/jobs/${encodeURIComponent(id)}`);
      if (j && j.status === "running") { setTimeout(tick, 1500); return; }
      followed.delete(id);
      if (j && j.status === "done") told({ import: id });
    } catch (e) {
      if (e && e.status === 404 && early-- > 0) { setTimeout(tick, 1500); return; }
      if (e && e.status === 404) { followed.delete(id); return; }
      setTimeout(tick, 3000);   // a dropped read: ask again, never guess
    }
  };
  tick();
}

// onImported fires from Done only (the imports gotcha: firing it on completion
// closes the parent modal before she has read the result).
export default function SpreadsheetImport({ file: fileProp, onClose, onImported }) {
  const [file, setFile] = useState(fileProp || null);
  const [sheets, setSheets] = useState(null);
  const [u, setU] = useState(null);
  const [answers, setAnswers] = useState({});
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState("read");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState(null);
  const [undone, setUndone] = useState("");
  // FIX-52: the import is a job on the server. The modal shows its real
  // state (running with progress, done with the receipt, or not imported with
  // the reason) and never goes back to the start on its own.
  const [job, setJob] = useState(null);
  const [failed, setFailed] = useState(null);
  const [dateAsked, setDateAsked] = useState(null);   // the date question stays on screen once answered
  const [asideOpen, setAsideOpen] = useState(false);
  const [mergedOpen, setMergedOpen] = useState(false);   // IMPORT-5 (7c): the rows merged into someone
  const [undatedDate, setUndatedDate] = useState("");
  const [dated, setDated] = useState("");
  // FIX-55: a re-read is in flight, so what is on screen is the last answer's;
  // the numbers dim and Import waits until the preview matches the answers
  const [inFlight, setInFlight] = useState(false);
  const [readFor, setReadFor] = useState("");   // the answers the preview on screen was read with
  const [phase, setPhase] = useState("");
  const [notice, setNotice] = useState("");   // what Bring them back did, kept past the re-read
  const [dragOver, setDragOver] = useState(false);
  const fileKeyRef = useRef("");
  const suggestedDate = useMemo(() => {
    const t = file && file.lastModified ? new Date(file.lastModified) : null;
    return t && !isNaN(t) ? localIso(t) : null;
  }, [file]);
  // HARDEN-2: one run id per preview, not per click. A second click, a retry
  // after a failure or a reconnect sends the same id, so the server answers
  // with the job already there; a new preview (another file, another answer)
  // is a new run.
  const previewRun = useMemo(() => "imp_sheet_" + Math.random().toString(36).slice(2, 12), [u]);

  // FIX-55: the X, Escape and a click outside always close. Before Import
  // nothing has been written; while an import runs it keeps going on the server.
  // HOME-3: the pages behind the window re-read, now or when the job ends.
  const running = !!(job && job.status === "running") || busy === "commit";
  const finish = () => {
    if (result) told({ import: result.importId });
    else if (job && job.status === "running") tellWhenDone(job.id);
    else if (busy === "commit") tellWhenDone(previewRun, { inFlight: true });
    if (running && !result) sayAfterClose("It keeps going. Open Settings, Imports to see it.");
    if (result && onImported) onImported(); else if (onClose) onClose();
  };
  // FIX-54: the last delete's Undo comes down while a file is imported
  useEffect(() => { dismissUndo(); }, []);
  // Reopened while an import is running (a refresh, a closed tab): follow it.
  useEffect(() => {
    let live = true;
    apiFetch("/sheet-import/jobs?running=1").then(r => { const j = r && r.jobs && r.jobs[0]; if (live && j) setJob(j); }).catch(() => {});
    return () => { live = false; };
  }, []);
  // Follow the job until it ends, reading its state from the server.
  useEffect(() => {
    if (!job || job.status !== "running") return undefined;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const j = await apiFetch(`/sheet-import/jobs/${encodeURIComponent(job.id)}`);
        if (!live) return;
        if (j.status === "done") { setResult(j.result); setBusy(""); told({ import: j.id }); }
        else if (j.status === "failed") { setFailed(j); setBusy(""); }
        setJob(j);
      } catch (e) {
        if (!live) return;
        // the server has no such job: the commit never reached it
        if (e && e.status === 404) { setJob(null); setFailed({ sentence: "Not imported. Steward did not receive the file. Nothing was written." }); setBusy(""); return; }
        setJob(j0 => ({ ...j0 }));   // a dropped read: ask again, never guess
      }
    }, 700);
    return () => { live = false; clearTimeout(t); };
  }, [job]);
  useEffect(() => {
    if (!file) { setBusy(""); return undefined; }
    let live = true;
    setBusy("read");
    setPhase(`Opening ${file.name}`);
    fileKeyRef.current = "";
    (async () => {
      try {
        const s = await readSheetFile(file);
        if (!live) return;
        const rows = s.reduce((a, sh) => a + (sh.grid || []).length, 0);
        setPhase(`Read ${n(rows, "row")}${s.length > 1 ? ` on ${n(s.length, "sheet")}` : ""}. Matching the people in it with everyone already in Steward`);
        setSheets(s);
      }
      catch (e) { if (live) { setMsg("Steward could not open that file: " + errorMessage(e)); setBusy(""); } }
    })();
    return () => { live = false; };
  }, [file]);

  // Every answer re-reads the whole preview. FIX-55: the file's cells go up
  // once; a re-read sends its key (the server keeps the cells it read) and the
  // answers, and sends the cells again only if the server no longer has them.
  useEffect(() => {
    if (!sheets) return;
    let live = true;
    setBusy(b => b || "think");
    setInFlight(true);
    const asked = JSON.stringify([answers, overrides]);
    const ask = withCells => apiFetch("/sheet-import/understand", { method: "POST", body: JSON.stringify({ fileName: file.name,
      ...(withCells ? { sheets } : { fileKey: fileKeyRef.current }), answers: { ...answers, suggestedDate }, overrides }) });
    (async () => {
      try {
        let r;
        try { r = await ask(!fileKeyRef.current); }
        catch (e) { if (e && e.status === 409 && e.body && e.body.error === "file_needed") r = await ask(true); else throw e; }
        if (!live) return;
        if (r.fileKey) fileKeyRef.current = r.fileKey;
        setU(r); setReadFor(asked); setMsg(""); setPhase("");
      } catch (e) { if (live) setMsg(e?.body?.message || errorMessage(e, "Steward could not read that file.")); }
      finally { if (live) { setBusy(""); setInFlight(false); } }
    })();
    return () => { live = false; };
  }, [sheets, answers, overrides, file, suggestedDate]);

  const setAnswer = patch => setAnswers(a => ({ ...a, ...patch }));
  const setRow = (key, v) => setAnswers(a => ({ ...a, rows: { ...(a.rows || {}), [key]: v } }));
  const setPerson = (key, v) => setAnswers(a => ({ ...a, people: { ...(a.people || {}), [key]: v } }));
  const setDeleted = (key, v) => setAnswers(a => ({ ...a, deletedPeople: { ...(a.deletedPeople || {}), [key]: v } }));

  const commit = async () => {
    setBusy("commit"); setMsg(""); setFailed(null);
    const importId = previewRun;
    // the assistant's proposals from the preview go with it, so the write is this plan
    const payload = { importId, background: true, fileName: file.name, sheets, answers: { ...answers, suggestedDate }, overrides: { ...((u && u.modelOverrides) || {}), ...overrides },
      // HARDEN-1: the org this preview was read for; the server refuses the write if the session moved
      previewOrgId: (u && u.org && u.org.id) || undefined };
    try {
      const j = await apiFetch("/sheet-import/commit", { method: "POST", body: JSON.stringify(payload) });
      setJob(j);
    } catch (e) {
      // The request was lost or refused. Whether a job started is the
      // server's to say: look for it before saying anything.
      const seen = await apiFetch(`/sheet-import/jobs/${encodeURIComponent(importId)}`).catch(() => null);
      if (seen && seen.id) { setJob(seen); return; }
      // HARDEN-1: the connection dropped, so the server could not be asked.
      // The file may be importing: follow its id until the server answers,
      // rather than say "Nothing was written" about a file that was.
      if (!seen && isNetworkFailure(e)) {
        setJob({ id: importId, status: "running", fileName: file.name, phase: "Steward lost the connection. It will show what happened here as soon as it is back" });
        return;
      }
      setFailed({ sentence: `Not imported. ${e?.body?.message || errorMessage(e, "Steward did not receive the file.")} Nothing was written.` });
      setBusy("");
    }
  };

  const dateUndated = async () => {
    setBusy("date");
    try { const r = await apiFetch(`/imports/${encodeURIComponent(result.importId)}/date-undated`, { method: "POST", body: JSON.stringify({ date: undatedDate }) }); setDated(r.sentence); }
    catch (e) { setMsg(e?.body?.message || errorMessage(e, "Those gifts were not dated.")); }
    setBusy("");
  };
  useEffect(() => { if (result && !undatedDate && answers.eventDate) setUndatedDate(answers.eventDate); }, [result, undatedDate, answers.eventDate]);

  // the preview on screen is stale from the moment an answer changes, in the
  // same render, so Import can never be pressed on the last answer's plan
  const rereading = !!u && (inFlight || readFor !== JSON.stringify([answers, overrides]));
  const c = u && u.counts;
  const acct = u && u.columnAccount;
  const eventQ = u ? u.questions.find(q => q.id === "event") : null;
  const dateQ = (u && u.questions.find(q => q.id === "date")) || (u && u.needsDate && !(u.event && u.event.named) ? dateAsked : null);
  // IMPORT-5: the event's gifts and the file's pledges, each asked once; the
  // box stays on screen once answered so she can change her answer
  const eventGiftsQ = u ? u.questions.find(q => q.id === "eventGifts") : null;
  const pledgeDueQ = u ? u.questions.find(q => q.id === "pledgeDue") : null;
  const [giftsAsked, setGiftsAsked] = useState(null);
  const [pledgeAsked, setPledgeAsked] = useState(null);
  useEffect(() => { if (eventGiftsQ) setGiftsAsked(eventGiftsQ); }, [eventGiftsQ]);
  useEffect(() => { if (pledgeDueQ) setPledgeAsked(pledgeDueQ); }, [pledgeDueQ]);
  const giftsQ = eventGiftsQ || (typeof answers.useEventDate === "boolean" && answers.eventDate ? giftsAsked : null);
  const pledgeQ = pledgeDueQ || (answers.pledgeDue ? pledgeAsked : null);
  useEffect(() => { const q = u && u.questions.find(x => x.id === "date"); if (q && !dateAsked) setDateAsked(q); }, [u, dateAsked]);
  const otherQs = u ? u.questions.filter(q => !["date", "event", "eventGifts", "pledgeDue"].includes(q.id) && q.kind !== "column" && q.kind !== "deletedPerson") : [];
  const deletedQs = u ? u.questions.filter(q => q.kind === "deletedPerson") : [];
  const colQs = u ? u.questions.filter(q => q.kind === "column") : [];
  // everyone in the file who matches a person she deleted: blocked, or asked by name
  const deletedIds = u ? [...new Set([...(u.deletedMatches || []).map(x => x.id), ...deletedQs.map(q => q.deletedId)].filter(Boolean))] : [];
  const bringBack = async () => {
    setBusy("bring"); setNotice("");
    try {
      const r = await apiFetch("/sheet-import/bring-back", { method: "POST", body: JSON.stringify({ ids: deletedIds }) });
      setNotice(r.sentence || "");
      // read the file again: they now match, so their questions and their set-aside rows go
      setAnswers(a => { const { deletedPeople, ...rest } = a; return { ...rest }; });
    } catch (e) { setMsg(e?.body?.sentence || errorMessage(e, "Nobody was brought back.")); setBusy(""); }
  };
  const eventName = answers.eventName ?? (eventQ && eventQ.suggestedEventName) ?? (dateQ && dateQ.suggestedEventName) ?? "";
  const tablesRead = u ? u.tables.filter(t => t.kind === "gifts" || t.kind === "people") : [];
  // HARDEN-1: which org this file goes into, said at the top and on the button
  const intoOrg = (u && u.org && u.org.name) || pageOrgName() || "";

  return (
    <Modal className="commit-screen" onClose={finish} title="Import a spreadsheet" width={900} ariaLabel="Import a spreadsheet"
      subtitle="Steward reads your file the way you would, shows you what it understood, and asks only what it cannot tell.">
      <div data-testid="sheet-import" style={{ display: "flex", flexDirection: "column", gap: 12, color: T.ink }}>
        {intoOrg && <div data-testid="sheet-import-org" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, fontFamily: "'DM Serif Display',Georgia,serif" }}>
          <span style={{ ...small, display: "block", fontFamily: "inherit", fontWeight: 400 }}>Importing into</span>{intoOrg}</div>}
        {!file && (
          // FIX-55: choose a file or drop it here; the same reader either way
          <label data-testid="sheet-drop" style={{ ...box, display: "block", cursor: "pointer", borderStyle: "dashed", borderWidth: 2,
              borderColor: dragOver ? T.greenDk : T.bg3, background: dragOver ? T.bg : T.white, textAlign: "center", padding: "26px 16px" }}
            onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = droppedSpreadsheet(e); if (f) setFile(f); else setMsg("That is not a spreadsheet. Steward reads Excel (.xlsx, .xls), CSV and TSV files."); }}>
            <div style={{ ...h3, fontSize: 15 }}>Choose a file or drop it here</div>
            <div style={small}>Any spreadsheet: an event night's sheet, a list from another system, a bank or PayPal download. A pair from another system (Salesforce Contacts and Donations) goes in together: choose both. Excel (.xlsx, .xls), CSV, TSV, or a Google Sheets download.</div>
            <input data-testid="sheet-file" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ marginTop: 10, maxWidth: "100%" }}
              onChange={e => e.target.files && e.target.files[0] && setFile(filesAsOne(e.target.files))} />
          </label>
        )}
        {file && <div style={{ ...small }}><strong style={{ color: T.ink }}>{file.name}</strong></div>}
        {msg && <div role="alert" style={{ ...box, borderColor: T.gold500, fontSize: 13 }}>{msg}</div>}
        {notice && u && !result && <div role="status" data-testid="sheet-notice" style={{ ...box, fontSize: 13 }}>{notice}</div>}
        {!u && busy && (
          <div style={box} data-testid="sheet-reading" role="status">
            <div style={{ fontSize: 13.5 }}>{phase || "Reading your file"}…</div>
            <div aria-hidden style={{ height: 6, borderRadius: 3, overflow: "hidden", margin: "8px 0 0", background: T.bg2 }}>
              <div style={{ width: sheets ? "70%" : "25%", height: "100%", background: T.greenDk, transition: "width .6s" }} />
            </div>
          </div>
        )}

        {job && job.status === "running" && !result && (
          <div style={{ ...box, borderColor: T.greenDk }} data-testid="sheet-job">
            <div style={h3}>Importing {job.fileName || (file && file.name) || "your file"}</div>
            <div style={{ fontSize: 13.5 }}>{job.phase || "Starting"}…</div>
            <div aria-hidden style={{ height: 6, borderRadius: 3, overflow: "hidden", margin: "8px 0 4px", background: T.bg2 }}>
              <div style={{ width: `${job.total ? Math.round((100 * job.done) / job.total) : 4}%`, height: "100%", background: T.greenDk, transition: "width .4s" }} />
            </div>
            <div style={small}>It keeps going if you close this window. Reopen Import, or Settings, Imports, to see where it is.</div>
          </div>
        )}
        {failed && !result && (
          <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-failed" role="alert">
            <div style={h3}>Not imported</div>
            <div style={{ fontSize: 13.5 }}>{failed.sentence || "Not imported. Nothing was written."}</div>
          </div>
        )}
        {u && !result && !(job && job.status === "running") && (
          <>
            {rereading && (
              <div role="status" data-testid="sheet-rereading" style={{ ...small, color: T.ink, fontWeight: 700 }}>Updating the preview with your answer…</div>
            )}
            {u.savedMapping && (
              <div data-testid="sheet-saved-mapping" style={{ ...small, color: T.ink }}>
                Using your saved mapping from {longDate(String(u.savedMapping.savedAt || "").slice(0, 10))}
                {" · "}<button type="button" data-testid="sheet-saved-mapping-change" onClick={() => setAnswer({ savedMapping: "off" })}
                  style={{ background: "none", border: 0, padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", font: "inherit" }}>Change</button>
              </div>
            )}
            <div style={{ ...box, opacity: rereading ? 0.55 : 1, transition: "opacity .15s" }} data-testid="sheet-understood">
              <div style={h3}>What Steward understood</div>
              {u.knownShape && <div data-testid="sheet-known-shape" style={{ fontSize: 13.5, fontWeight: 700, color: T.greenDk, marginBottom: 4 }}>{u.knownShape.sentence}</div>}
              <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{fileSentence(u, tablesRead, eventName)}</div>
              {u.totalsSentence && u.totalsSentence.length > 0 && <div data-testid="sheet-totals" style={{ fontSize: 13.5, marginTop: 6 }}>{u.totalsSentence.join(" ")}</div>}
              {u.totals.filter(t => !t.matches).map(t => (
                <div key={t.sheet + t.line + t.column} style={{ ...small, color: T.gold700, marginTop: 4 }}>
                  Row {t.line} of {t.sheet} says {money(t.statedCents)} for "{t.column}", but the rows above it add up to {money(t.sumCents)}.
                </div>))}
              {(u.figureChecks || []).map(f => (
                <div key={f.kind} data-testid="sheet-figure-check" style={{ ...small, marginTop: 4, color: f.agrees ? T.ink3 : T.gold700, fontWeight: f.agrees ? 400 : 700 }}>{f.sentence}</div>))}
              {(u.notesSheets || []).map(ns => (
                <div key={ns.sheet} data-testid="sheet-notes-sheet" style={{ ...small, marginTop: 6, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{ns.imported ? `Sheet '${ns.sheet}' looks like notes about people already on the list. You chose to import it.` : ns.sentence}</span>
                  <button type="button" style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }}
                    onClick={() => setAnswers(a => { const cur = new Set(a.notesSheets || []); if (cur.has(ns.sheet)) cur.delete(ns.sheet); else cur.add(ns.sheet); return { ...a, notesSheets: [...cur] }; })}>
                    {ns.imported ? "Leave it out" : "Import it anyway"}
                  </button>
                </div>))}
              {u.modelUsed && <div style={{ ...small, marginTop: 4 }}>Steward's assistant suggested what some columns are; each suggestion was checked against every row.</div>}
            </div>

            {/* FIX-54: people she deleted stay deleted unless she brings them back */}
            {/* HARDEN-1: a match by the name alone is hers to answer; Same person by default */}
            {/* FIX-55: many people she deleted, answered all at once; the per-person buttons stay for exceptions */}
            {(deletedQs.length + deletedIds.length > 1) && (
              <div style={{ ...box, borderColor: T.gold500, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="sheet-deleted-all">
                <span style={{ fontSize: 13, flex: "1 1 220px" }}>{n(deletedIds.length, "person", "people")} in this file {deletedIds.length === 1 ? "matches someone" : "match people"} you deleted.</span>
                {deletedQs.length > 0 && <button type="button" data-testid="sheet-deleted-all-same" disabled={rereading} style={{ ...btn(false), padding: "6px 10px", fontSize: 12 }}
                  onClick={() => setAnswers(a => ({ ...a, deletedPeople: Object.fromEntries(deletedQs.map(q => [q.key, "same"])) }))}>Same people for all (keep them out)</button>}
                <button type="button" data-commit data-testid="sheet-bring-all-back" disabled={!!busy || rereading} style={{ ...btn(false), padding: "6px 10px", fontSize: 12 }}
                  onClick={bringBack}>Bring them all back</button>
              </div>
            )}
            {deletedQs.length > 0 && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-deleted-questions">
                {deletedQs.map(q => {
                  const chosen = (answers.deletedPeople || {})[q.key];
                  return (
                    <div key={q.id} style={{ padding: "6px 0", fontSize: 13 }}>
                      <div>{q.text}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                        {(q.options || []).map(o => {
                          // FIX-55: Steward's suggestion is outlined; only her answer is filled
                          const suggested = !chosen && o.key === q.default;
                          return <button type="button" key={o.key} data-testid={`sheet-deleted-${o.key}`} aria-pressed={chosen === o.key}
                            data-suggested={suggested ? "1" : undefined}
                            style={{ ...btn(chosen === o.key), padding: "6px 10px", fontSize: 12, ...(suggested ? { border: "1px dashed " + T.greenDk } : {}) }}
                            onClick={() => setDeleted(q.key, o.key)}>{o.label}</button>;
                        })}
                        {!chosen && <span style={small}>Steward suggests {((q.options || []).find(o => o.key === q.default) || {}).label || "the first"}; it stands unless you choose.</span>}
                      </div>
                    </div>);
                })}
              </div>
            )}
            {(u.deletedMatches || []).length > 0 && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-deleted-matches">
                <div style={h3}>{u.deletedSentence}</div>
                <div style={small}>
                  {[...new Map(u.deletedMatches.map(x => [x.id, x])).values()].slice(0, 8).map(x => `${x.deletedName || x.name} (row ${String(x.line).split(":")[1] || x.line}, by ${x.by})`).join(", ")}
                  {new Set(u.deletedMatches.map(x => x.id)).size > 8 ? `, and ${new Set(u.deletedMatches.map(x => x.id)).size - 8} more` : ""}.
                  {" "}Their rows are set aside. Bring them back only if you meant to keep them; their gifts in this file are then imported with the rest.
                </div>
                {deletedQs.length + deletedIds.length <= 1 && (
                  <button type="button" data-commit data-testid="sheet-bring-back" disabled={!!busy || rereading} style={{ ...btn(false), marginTop: 8 }} onClick={bringBack}>
                    Bring them back
                  </button>
                )}
              </div>
            )}

            {(eventQ || (u.event && (u.event.fromEngagement || u.event.named))) && (
              <div style={{ ...box, borderColor: eventQ && !eventQ.optional ? T.gold500 : T.bg3 }} data-testid="sheet-question-event">
                <div style={h3}>{eventQ ? eventQ.text : "The event"}</div>
                {eventQ && eventQ.holds && <div style={{ ...small, color: T.ink }} data-testid="sheet-event-holds">Your file: {eventQ.holds}{eventName ? ` · ${eventName}` : ""}</div>}
                {eventQ && <div style={small}>{eventQ.hint}</div>}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", flex: "1 1 220px" }}>Called
                    <input type="text" data-testid="sheet-event-name" value={eventName} placeholder="The event's name" onChange={e => setAnswer({ eventName: e.target.value })} style={field} />
                  </label>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>{eventQ && eventQ.required ? "On" : "On (optional)"}
                    <input type="date" data-testid="sheet-event-date" required={!!(eventQ && eventQ.required)} value={answers.eventDate || ""} onChange={e => setAnswer({ eventDate: e.target.value })} style={{ ...field, flex: "0 0 auto" }} />
                  </label>
                </div>
                {eventQ && eventQ.canSayNotEvent && (
                  <button type="button" data-testid="sheet-not-event" style={{ ...linkBtn, marginTop: 8 }} onClick={() => setAnswer({ notEvent: true, eventDate: "", useEventDate: undefined, pledgeDue: answers.pledgeDue === "event" ? undefined : answers.pledgeDue })}>
                    This file isn't from an event
                  </button>
                )}
              </div>
            )}
            {answers.notEvent && !eventQ && (
              <div style={{ ...small, marginTop: -4 }}>Read as gifts, not an event. <button type="button" style={linkBtn} onClick={() => setAnswer({ notEvent: false })}>It was an event</button></div>
            )}

            {giftsQ && (
              <div style={{ ...box, borderColor: eventGiftsQ ? T.gold500 : T.bg3 }} data-testid="sheet-question-event-gifts">
                <div style={h3}>{giftsQ.text}</div>
                <div style={small}>{giftsQ.hint}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <button type="button" data-testid="sheet-event-gifts-yes" aria-pressed={answers.useEventDate === true} style={{ ...btn(answers.useEventDate === true), padding: "6px 12px", fontSize: 12.5 }}
                    onClick={() => setAnswer({ useEventDate: true })}>Yes, date them {answers.eventDate ? longDate(answers.eventDate) : "on the event's day"}</button>
                  <button type="button" data-testid="sheet-event-gifts-no" aria-pressed={answers.useEventDate === false} style={{ ...btn(answers.useEventDate === false), padding: "6px 12px", fontSize: 12.5 }}
                    onClick={() => setAnswer({ useEventDate: false })}>No, leave them No date</button>
                </div>
              </div>
            )}

            {pledgeQ && (
              <div style={{ ...box, borderColor: pledgeDueQ ? T.gold500 : T.bg3 }} data-testid="sheet-question-pledge-due">
                <div style={h3}>{pledgeQ.text}</div>
                <div style={small}>{pledgeQ.hint}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                  {(pledgeQ.options || []).map(o => (
                    <button type="button" key={o.key} data-testid={`sheet-pledge-due-${o.key}`} aria-pressed={answers.pledgeDue === o.key}
                      style={{ ...btn(answers.pledgeDue === o.key), padding: "6px 12px", fontSize: 12.5 }}
                      onClick={() => setAnswer({ pledgeDue: o.key })}>{o.label}{o.key === "event" && answers.eventDate ? ` (${longDate(answers.eventDate)})` : ""}</button>
                  ))}
                  {answers.pledgeDue === "choose" && (
                    <input type="date" data-testid="sheet-pledge-due-date" aria-label="First due date" value={answers.pledgeDueDate || ""} onChange={e => setAnswer({ pledgeDueDate: e.target.value })} style={{ ...field, flex: "0 0 auto" }} />
                  )}
                </div>
                {answers.pledgeDue === "event" && !answers.eventDate && <div style={{ ...small, marginTop: 6 }}>Give the event's date above first.</div>}
              </div>
            )}

            {dateQ && (
              <div style={box} data-testid="sheet-question-date">
                <div style={h3}>{dateQ.text}</div>
                <div style={small}>{dateQ.hint}</div>
                {(eventQ || u.event) && answers.eventDate && (
                  <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", marginTop: 8, color: T.ink }}>
                    <input type="checkbox" data-testid="sheet-use-event-date" checked={!!answers.useEventDate} onChange={e => setAnswer({ useEventDate: e.target.checked })} />
                    Use the event date ({longDate(answers.eventDate)}) for these {n(dateQ.count || c.undatedGifts, "gift")}
                  </label>
                )}
                {!eventQ && !(u.event && u.event.fromEngagement) && (
                  <>
                    {dateQ.suggestedEventName && suggestedDate && (
                      <button type="button" data-testid="sheet-date-event" style={{ ...btn(false), marginTop: 8, textAlign: "left" }}
                        onClick={() => setAnswer({ date: suggestedDate, eventName: dateQ.suggestedEventName, linkEvent: true })}>
                        {dateQ.suggestedEventName}, {longDate(suggestedDate)}
                      </button>
                    )}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Date them all (optional)
                        <input type="date" data-testid="sheet-date-input" value={answers.date || ""} onChange={e => setAnswer({ date: e.target.value })} style={{ ...field, flex: "0 0 auto" }} />
                      </label>
                      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", flex: "1 1 220px" }}>Event
                        <input type="text" value={eventName} placeholder="Name of the event (optional)" onChange={e => setAnswer({ eventName: e.target.value })} style={field} />
                      </label>
                    </div>
                    {eventName && (
                      <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", marginTop: 8, color: T.ink }}>
                        <input type="checkbox" checked={!!answers.linkEvent} onChange={e => setAnswer({ linkEvent: e.target.checked, eventName })} />
                        {u.events && u.events.length ? `Link every gift to ${u.events[0].name} on your calendar` : `Create the event "${eventName}" and link every gift to it`}
                      </label>
                    )}
                  </>
                )}
              </div>
            )}

            {otherQs.length > 0 && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-questions">
                <div style={h3}>{otherQs.length === 1 ? "One thing Steward can't tell" : `${otherQs.length} things Steward can't tell`}</div>
                {otherQs.map(q => (
                  <div key={q.id} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", fontSize: 13 }}>
                    <div>{q.text}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {(q.options || []).map(o => {
                        const cur = q.kind === "row" ? (answers.rows || {})[q.key] : (answers.people || {})[q.key];
                        return <button type="button" key={o.key} style={{ ...btn(cur === o.key), padding: "6px 10px", fontSize: 12 }}
                          onClick={() => (q.kind === "row" ? setRow(q.key, o.key) : setPerson(q.key, o.key))}>{o.label}</button>;
                      })}
                    </div>
                  </div>))}
              </div>
            )}

            {colQs.length > 0 && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-help">
                <div style={h3}>Help me with these</div>
                <div style={small}>Steward could not tell what {colQs.length === 1 ? "this column is" : "these columns are"}. Pick where each goes, or leave it out with a reason. Nothing is imported until you do.</div>
                {colQs.map(q => (
                  <div key={q.id} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{q.header}{q.sheet ? <span style={{ ...small, fontWeight: 400 }}> · {q.sheet}</span> : null}</div>
                      <div style={small}>{q.reason}. For example: {(q.sample || []).slice(0, 4).join(", ")}</div>
                    </div>
                    <div style={{ flex: "0 1 240px" }}>
                      <ColumnTargetSelect header={q.header} standardFields={STD_ROLES} allowNew={false} compact testId={"sheet-help-" + q.key} placeholder="Choose…"
                        value={overrides[q.key] ? (overrides[q.key] === "ignore" ? "ignore" : "std:" + overrides[q.key]) : ""}
                        onChange={v => setOverrides(o => ({ ...o, [q.key]: v === "ignore" ? "ignore" : String(v).replace(/^std:/, "") }))} />
                    </div>
                  </div>))}
              </div>
            )}

            <div style={{ ...box, counterReset: "layer", opacity: rereading ? 0.55 : 1, transition: "opacity .15s" }} data-testid="sheet-review" aria-busy={rereading}>
              <style>{".sheet-layer-n::before{content:counter(layer)}"}</style>
              <div style={h3}>Before anything is written</div>
              <Layer title="People" testId="layer-people"
                main={`${n(c.persons ?? c.people, "person", "people")}${c.households ? `, ${n(c.households, "household")}` : ""}${c.organizations ? `, ${n(c.organizations, "organization")}` : ""}`}
                sub={`${u.peopleLine ? u.peopleLine.sentence.replace(/^[^:]*: /, "") : `${u.newPeople} new, ${u.matchedPeople} already in Steward`}. Sheets that list the same people are read as one list, by ID first, then email, then name.`}
                notes={[
                        // IMPORT-5 (7c): every row is a person, merged into one, or set aside
                        u.rowAccount && <span key="rows" data-testid="sheet-row-account">{u.rowAccount.sentence}
                          {u.rowAccount.merged > 0 && <> <button type="button" data-testid="sheet-merged-see" style={{ ...linkBtn }} onClick={() => setMergedOpen(o => !o)}>{mergedOpen ? "(hide them)" : "(see them)"}</button></>}
                          {mergedOpen && <span style={{ display: "block", marginTop: 4 }} data-testid="sheet-merged-list">
                            {(u.merged || []).slice(0, 50).map(m => <span key={m.sheet + m.line} style={{ display: "block" }}>Row {m.line}: {m.name}, read into {m.into} (row {String(m.intoLine || "").split(":")[1] || m.intoLine}) by {m.by === "name" ? "the same name" : m.by}.</span>)}
                          </span>}
                        </span>,
                        // IMPORT-5 (7a): one address split, shown as it will land
                        u.addressExample && <span key="addr" data-testid="sheet-address-example">{n(c.addressesSplit || 0, "address", "addresses")} split into street, city, state and ZIP, for example "{u.addressExample.from}" → {[u.addressExample.address, u.addressExample.address2, u.addressExample.city, u.addressExample.state, u.addressExample.zip].filter(Boolean).join(" · ")}.</span>,
                        c.addressesToCheck ? `${n(c.addressesToCheck, "address", "addresses")} kept whole and marked "Check this address": Steward could not split ${c.addressesToCheck === 1 ? "it" : "them"} for sure.` : null,
                        // IMPORT-5 (7d): notes that say the contact info is bad
                        c.phonesMarkedWrong ? <span key="ph" data-testid="sheet-phones-wrong">{n(c.phonesMarkedWrong, "phone")} marked wrong from your notes: kept, struck through, and never dialed or texted from Steward.</span> : null,
                        c.addressesMarkedReturned ? `${n(c.addressesMarkedReturned, "address", "addresses")} marked as returned mail from your notes: kept, and left off mailings.` : null,
                        ...(u.placeholders || []).map(p => `The ${p.kind} ${p.value} is on ${p.people} different people, so it is treated as your own ${p.kind} and copied onto nobody.`),
                        ...(u.nearMisses || []).slice(0, 5).map(x => `${x.a} and ${x.b} (row ${x.line}): ${x.reason}.`)].filter(Boolean)} />
              <Layer title="Roles" testId="layer-roles"
                main={[c.donors && n(c.donors, "donor"), c.pledgers && n(c.pledgers, "pledger"), c.guests && n(c.guests, "event guest"), c.volunteers && n(c.volunteers, "volunteer"),
                       c.board && `${c.board} board`, c.staff && `${c.staff} staff`, c.prospects && n(c.prospects, "prospect"), c.contacts && n(c.contacts, "contact")].filter(Boolean).join(" · ") || "Contacts"}
                sub="From the data: a donor gave, a pledger promised, a prospect was invited and never gave. Someone with no gift comes in as a contact, never a donor." />
              {u.fileKind !== "people" && (
                <Layer title="Money" testId="layer-money"
                  main={`${n(c.gifts, "gift")} ${money(c.giftCents)}${c.undatedGifts ? ` (${c.undatedGifts.toLocaleString("en-US")} with no date)` : ""}${c.pledges ? ` · ${n(c.pledges, "pledge")}: ${pledgeMoneyWords({ dueThisYearCents: c.pledgeDueThisYearCents, openCents: c.pledgeOpenCents, years: c.pledgeYears, undatedCents: c.pledgeUndatedCents }, money)}` : ""}`}
                  sub={c.undatedGifts ? "A gift with no date still lands on its person, marked No date. It counts in Lifetime and the event's total, and not in This year, a goal or retention until it has a date." : "Every gift on its person, through the one gift path."}
                  notes={[c.monthly ? `${n(c.monthly, "monthly giver")} flagged for you to confirm, never charged.` : null,
                          ...u.pledges.slice(0, 3).map(p => `Row ${p.line}: ${p.who}, ${money(p.pledgeCents)}${p.openCents !== p.pledgeCents ? `, ${money(p.openCents)} to go` : ""}. ${p.why}.`)].filter(Boolean)} />
              )}
              {(u.event || c.optOuts || c.doNotContact || c.doNotMail || c.doNotCall) ? (
                <Layer title="Engagement" testId="layer-engagement"
                  main={[u.event && `${eventName || u.event.name || "The event"}: ${(c.invitedRecords ?? c.invited).toLocaleString("en-US")} invited, ${(c.rsvpRecords ?? c.rsvp).toLocaleString("en-US")} RSVP'd, ${(c.attendedRecords ?? c.attended).toLocaleString("en-US")} attended${c.invited !== c.invitedRecords && c.invitedRecords != null ? ` (rows; ${c.invited.toLocaleString("en-US")} invited people, a couple's row is two)` : ""}`,
                         c.optOuts && n(c.optOuts, "opt-out"), c.doNotContact && `${c.doNotContact} do not contact`, c.doNotMail && `${c.doNotMail} do not mail`, c.doNotCall && `${c.doNotCall} do not call`].filter(Boolean).join(" · ")}
                  sub="Attendance, table and party size go on each person's event. Every communication choice keeps where it came from." />
              ) : null}
              <Layer title="Everything else" testId="layer-kept"
                main={(u.keptHeaders || []).length ? `${n(u.keptHeaders.length, "column")} kept on each person: ${u.keptHeaders.map(k => k.header).join(", ")}` : "Nothing left over"}
                sub="A column Steward has no field for is kept under its own header, as a custom field on the person. Nothing is lost." />
              {u.aside.length > 0 && (
                <details data-testid="sheet-aside" style={{ marginTop: 10 }} open={asideOpen} onToggle={e => setAsideOpen(e.currentTarget.open)}>
                  <summary style={{ fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Set aside ({u.aside.length}), each with its reason</summary>
                  {u.aside.slice(0, 200).map(a => <div key={a.sheet + a.line} style={small}>Row {a.line}{a.sheet !== "Sheet1" ? ` of ${a.sheet}` : ""}: {a.who ? a.who + ", " : ""}{a.reason}{a.cents != null ? ` (${money(a.cents)})` : ""}.</div>)}
                  <button type="button" style={{ ...btn(false), marginTop: 6, padding: "5px 10px", fontSize: 12 }} onClick={() => downloadAside(u, file.name)}>Download the set-aside rows</button>
                </details>
              )}
              {u.notes.filter(x => !x.label).length > 0 && (
                <div style={{ ...small, marginTop: 8 }}>Notes on the sheet, kept out of the table: {u.notes.filter(x => !x.label).slice(0, 5).map(x => `"${x.text}" (row ${x.line})`).join("; ")}.</div>
              )}
            </div>

            {u.sample && <SampleCard p={u.sample} eventName={eventName || (u.event && u.event.name)} />}

            <details style={box} data-testid="sheet-columns">
              <summary style={{ ...h3, cursor: "pointer", margin: 0 }} data-testid="sheet-column-account">
                {acct ? `${n(acct.total, "column")}: ${acct.mapped} mapped · ${acct.kept} kept · ${acct.skipped} skipped${acct.question ? ` · ${acct.question} to answer` : ""}` : "What Steward read in each column"}
              </summary>
              {acct && <div aria-hidden style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", margin: "8px 0", background: T.bg2 }}>
                <div style={{ flex: acct.mapped, background: T.greenDk }} /><div style={{ flex: acct.kept, background: T.gold500 }} /><div style={{ flex: acct.skipped, background: T.bg3 }} />
              </div>}
              {u.tables.map(t => (
                <div key={t.key} style={{ marginTop: 8 }}>
                  <div style={small}>{t.sheet}, header on row {t.headerLine}{t.kind === "summary" ? ": a table of amounts with no names, read as a summary" : ""}</div>
                  {t.columns.map(col => (
                    <div key={col.index} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg2, padding: "6px 0" }}>
                      <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5 }}><strong>{col.header || `(column ${col.index + 1})`}</strong>
                        {col.disposition && <span style={{ ...chip, background: col.disposition === "mapped" ? T.bg : col.disposition === "kept" ? T.gold100 : T.bg2 }}>{col.disposition}</span>}
                        <span style={small}> {col.reason ? `· ${col.reason}` : ""}{col.sample && col.sample.length ? ` · ${col.sample.slice(0, 3).join(", ")}` : ""}</span></div>
                      <div style={{ flex: "0 1 220px" }}>
                        <ColumnTargetSelect header={col.header} standardFields={STD_ROLES} allowNew={false} compact placeholder="Choose…"
                          value={!col.role ? "" : col.role === "ignore" ? "ignore" : "std:" + col.role}
                          onChange={v => setOverrides(o => ({ ...o, [`${t.key}|${col.index}`]: v === "ignore" ? "ignore" : String(v).replace(/^std:/, "") }))} />
                      </div>
                    </div>))}
                </div>))}
            </details>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* FIX-55: the button is this preview's, and waits while the preview catches up with an answer */}
              <button type="button" data-commit data-testid="sheet-import-go" disabled={!u.ready || rereading || busy === "commit" || (job && job.status === "running")}
                onClick={() => (u.button && u.button.review && !asideOpen ? setAsideOpen(true) : commit())}
                style={{ ...btn(true), opacity: u.ready && !rereading ? 1 : 0.45, cursor: u.ready && !rereading ? "pointer" : "not-allowed", textAlign: "left", lineHeight: 1.4, maxWidth: "100%" }}>
                {busy === "commit" ? "Importing…" : rereading ? "Updating the preview…" : u.button ? (u.button.review && !asideOpen ? u.button.text : (u.button.importText ? u.button.importText + (intoOrg ? " into " + intoOrg : "") : u.button.text)) : "Import"}
              </button>
              <span style={small} data-testid="sheet-import-why">{rereading ? "One moment: Steward is reading the file again with your answer." : u.ready ? "Undo removes the whole import, for 30 days, from its receipt here or in Settings, Imports." : `Answer ${n(u.questions.filter(q => !q.optional).length, "question")} above first.`}</span>
            </div>
          </>
        )}

        {result && (
          <div style={box} data-testid="sheet-result">
            <div style={h3}>{undone ? "Undone" : "Imported"}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{undone || result.sentence}</div>
            {!undone && result.giftLine && <ImportGiftLine line={result.giftLine} importId={result.importId} style={{ marginTop: 4 }} />}
            {!undone && result.totalsSentence && result.totalsSentence.length > 0 && <div style={{ ...small, marginTop: 4 }}>{result.totalsSentence.join(" ")}</div>}
            {!undone && result.undatedGifts > 0 && (
              <div data-testid="sheet-undated" style={{ marginTop: 10, borderTop: "1px solid " + T.bg2, paddingTop: 10 }}>
                <div style={{ fontSize: 13 }}>{dated || `${n(result.undatedGifts, "gift")} came in with no date. They count in Lifetime and ${result.eventName || "the event"}'s total, not in This year.`}</div>
                {!dated && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    <input type="date" data-testid="sheet-undated-date" value={undatedDate} onChange={e => setUndatedDate(e.target.value)} style={{ ...field, flex: "0 0 auto" }} />
                    <button type="button" data-commit data-testid="sheet-undated-go" style={btn(false)} disabled={!undatedDate || busy === "date"} onClick={dateUndated}>
                      {busy === "date" ? "Dating…" : answers.eventDate && undatedDate === answers.eventDate ? `Use the event date for these ${n(result.undatedGifts, "gift")}` : `Date these ${n(result.undatedGifts, "gift")}`}
                    </button>
                    <span style={small}>Optional. You can also set each one on its profile.</span>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
              {!undone && result.importId && <div style={{ flex: "1 1 260px" }}><ImportUndo importId={result.importId} onUndone={r => setUndone(r.sentence || "Undone.")} /></div>}
              <button type="button" data-testid="sheet-done" style={btn(true)} onClick={finish}>Done</button>
            </div>
            {/* INSIGHTS-1: what the file says, before Home */}
            {!undone && <div style={{ marginTop: 14 }}><FirstLook isReadOnly={false} /></div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

// "An event workbook: a list of people and gifts for Finding Joy Dinner."
function fileSentence(u, tablesRead, eventName) {
  const ev = eventName || (u.event && u.event.name);
  const where = tablesRead.map(t => `${t.sheet}, ${n(t.rows, "row")} from row ${t.headerLine}`).join("; ");
  const kinds = new Set(tablesRead.map(t => t.kind));
  if (u.fileKind === "unknown") return "Steward could not find names or amounts yet. Tell it which columns they are below.";
  if (u.event && u.event.fromEngagement) {
    const what = kinds.has("gifts") && kinds.has("people") ? "a guest list and gifts" : kinds.has("gifts") ? "guests and their gifts" : "a guest list";
    return `An event workbook: ${what}${ev ? ` for ${ev}` : ""} (${where}).`;
  }
  if (tablesRead.some(t => t.isVolunteer)) return `A list of volunteers (${where}).`;
  if (u.fileKind === "gifts") return kinds.has("people") ? `A list of people and their gifts (${where}).` : `A gifts file: ${where}.`;
  return `A list of people with no gifts: ${tablesRead.map(t => `${t.sheet}, ${n(t.rows, "row")}`).join("; ")}.`;
}

// The layers are numbered by CSS counter, so a layer with nothing to say
// leaves no gap in the numbers.
function Layer({ title, main, sub, notes, testId }) {
  return (
    <div data-testid={testId} className="sheet-layer" style={{ display: "flex", gap: 10, borderTop: "1px solid " + T.bg2, padding: "9px 0", minWidth: 0, counterIncrement: "layer" }}>
      <div className="sheet-layer-n" style={{ flex: "0 0 22px", height: 22, borderRadius: 11, background: T.bg, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", color: T.ink3 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: T.ink3 }}>{title}</div>
        <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{main}</div>
        <div style={small}>{sub}</div>
        {(notes || []).map((x, i) => <div key={i} style={{ ...small, color: T.ink }}>{x}</div>)}
      </div>
    </div>
  );
}

// The one person shown as they will look after import.
function SampleCard({ p, eventName }) {
  const roleWord = { donor: "Donor", pledger: "Pledger", guest: "Event guest", volunteer: "Volunteer", board: "Board", staff: "Staff", prospect: "Prospect", contact: "Contact" };
  const at = p.attendance;
  const comm = Object.entries(p.comms || {}).filter(([k]) => k !== "optIn");
  return (
    <div style={box} data-testid="sheet-sample">
      <div style={h3}>One person, as they will look after import</div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{p.name}</div>
      <div style={small}>{[p.email, p.phone, p.household].filter(Boolean).join(" · ")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{(p.roles || []).map(r => <span key={r} style={chip}>{roleWord[r] || r}</span>)}</div>
      {(p.pledges || []).map((pl, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}><strong>Open pledge:</strong> {money(pl.pledgeCents)}{pl.years > 1 ? ` over ${pl.years} years` : ""}, {money(pl.paidCents)} received, {money(pl.openCents)} to go{pl.nextDue ? `, next due ${longDate(pl.nextDue)}` : ""}.</div>)}
      {(p.gifts || []).map((g, i) => (
        <div key={i} style={{ fontSize: 13, marginTop: 4 }}>{money(g.cents)} · {g.method || "Method not given"}{g.fund ? ` · ${g.fund}` : ""}{eventName ? ` · ${eventName}` : ""}{" "}
          {!g.date ? <span style={{ ...chip, background: T.gold100, color: T.gold700 }}>No date</span> : <span style={small}>{longDate(g.date)}</span>}
          {(g.flags || []).includes("method_unknown") && <span style={{ ...chip, marginLeft: 4 }}>Method as written: {g.methodOriginal || "blank"}</span>}
        </div>))}
      {at && <div style={{ fontSize: 13, marginTop: 6 }}>{eventName || "The event"}: {[at.invited && "invited", at.rsvp === true && "RSVP'd", at.attended && "attended", at.table, at.party && `party of ${at.party}`].filter(Boolean).join(", ")}</div>}
      {comm.map(([k, src]) => <div key={k} style={{ fontSize: 13, marginTop: 4 }}>{({ optOut: "Opted out of email", doNotContact: "Do not contact", doNotMail: "Do not mail", doNotCall: "Do not call", doNotEmail: "Do not email", deceased: "Deceased" })[k] || k}: <span style={small}>"{src.header}": {src.value}</span></div>)}
      {Object.keys(p.kept || {}).length > 0 && <div style={{ ...small, marginTop: 6 }}>From your import: {Object.entries(p.kept).map(([h, v]) => `${h}: ${v}`).join(" · ")}</div>}
    </div>
  );
}

function downloadAside(u, fileName) {
  const cell = v => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [["Sheet", "Row", "Who", "Amount", "Reason"].join(",")]
    .concat(u.aside.map(a => [a.sheet, a.line, a.who || "", a.cents != null ? (a.cents / 100).toFixed(2) : "", a.reason].map(cell).join(",")));
  const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  const el = document.createElement("a");
  el.href = url; el.download = `Set aside from ${String(fileName || "your file").replace(/\.[a-z]+$/i, "")}.csv`;
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Fig({ label, value, sub }) {
  return (
    <div style={{ background: T.bg, borderRadius: 9, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: T.ink3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>{value}</div>
      <div style={small}>{sub}</div>
    </div>
  );
}

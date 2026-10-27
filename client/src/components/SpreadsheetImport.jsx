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
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { dismissUndo } from "./EditHistory";
import { T, Modal } from "./shared";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import ImportUndo from "./ImportUndo";
import { errorMessage } from "../lib/domainError";
import { decodeSpreadsheetBytesDetailed } from "../../../shared/importShape";
import { gridsFromWorkbook, gridFromText, SHEET_ROLES } from "../../../shared/sheetRead";

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const field = { flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit" };
const chip = { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: T.bg, color: T.ink, marginLeft: 6 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink,
  border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit" });
const STD_ROLES = SHEET_ROLES.filter(r => r.key !== "ignore");
const money = c => (c < 0 ? "-$" : "$") + (Math.abs(Math.round(c)) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : (many || one + "s")}`;
const longDate = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Any file → sheets of cells. xlsx, xls, csv, tsv and a Google Sheets download
// all come through here.
export async function readSheetFile(file) {
  const name = String(file.name || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const XLSX = await import("xlsx");
    return gridsFromWorkbook(XLSX.read(buf, { type: "array", cellDates: true }), XLSX);
  }
  const dec = decodeSpreadsheetBytesDetailed(buf);
  return [{ name: "Sheet1", grid: gridFromText(dec.text) }];
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
  const [undatedDate, setUndatedDate] = useState("");
  const [dated, setDated] = useState("");
  const suggestedDate = useMemo(() => {
    const t = file && file.lastModified ? new Date(file.lastModified) : null;
    return t && !isNaN(t) ? localIso(t) : null;
  }, [file]);

  const finish = () => (result && onImported ? onImported() : onClose());
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
        if (j.status === "done") { setResult(j.result); setBusy(""); }
        else if (j.status === "failed") { setFailed(j); setBusy(""); }
        setJob(j);
      } catch { if (live) setJob(j0 => ({ ...j0 })); }   // a dropped read: ask again, never guess
    }, 700);
    return () => { live = false; clearTimeout(t); };
  }, [job]);
  useEffect(() => {
    if (!file) { setBusy(""); return undefined; }
    let live = true;
    setBusy("read");
    (async () => {
      try { const s = await readSheetFile(file); if (live) setSheets(s); }
      catch (e) { if (live) { setMsg("Steward could not open that file: " + errorMessage(e)); setBusy(""); } }
    })();
    return () => { live = false; };
  }, [file]);

  useEffect(() => {
    if (!sheets) return;
    let live = true;
    setBusy(b => b || "think");
    apiFetch("/sheet-import/understand", { method: "POST", body: JSON.stringify({ fileName: file.name, sheets, answers: { ...answers, suggestedDate }, overrides }) })
      .then(r => { if (live) { setU(r); setMsg(""); } })
      .catch(e => { if (live) setMsg(e?.body?.message || errorMessage(e, "Steward could not read that file.")); })
      .finally(() => { if (live) setBusy(""); });
    return () => { live = false; };
  }, [sheets, answers, overrides, file, suggestedDate]);

  const setAnswer = patch => setAnswers(a => ({ ...a, ...patch }));
  const setRow = (key, v) => setAnswers(a => ({ ...a, rows: { ...(a.rows || {}), [key]: v } }));
  const setPerson = (key, v) => setAnswers(a => ({ ...a, people: { ...(a.people || {}), [key]: v } }));
  const setDeleted = (key, v) => setAnswers(a => ({ ...a, deletedPeople: { ...(a.deletedPeople || {}), [key]: v } }));

  const commit = async () => {
    setBusy("commit"); setMsg(""); setFailed(null);
    const importId = "imp_sheet_" + Math.random().toString(36).slice(2, 12);
    // the assistant's proposals from the preview go with it, so the write is this plan
    const payload = { importId, background: true, fileName: file.name, sheets, answers: { ...answers, suggestedDate }, overrides: { ...((u && u.modelOverrides) || {}), ...overrides } };
    try {
      const j = await apiFetch("/sheet-import/commit", { method: "POST", body: JSON.stringify(payload) });
      setJob(j);
    } catch (e) {
      // The request was lost or refused. Whether a job started is the
      // server's to say: look for it before saying anything.
      const seen = await apiFetch(`/sheet-import/jobs/${encodeURIComponent(importId)}`).catch(() => null);
      if (seen && seen.id) { setJob(seen); return; }
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

  const c = u && u.counts;
  const acct = u && u.columnAccount;
  const eventQ = u ? u.questions.find(q => q.id === "event") : null;
  const dateQ = (u && u.questions.find(q => q.id === "date")) || (u && u.needsDate ? dateAsked : null);
  useEffect(() => { const q = u && u.questions.find(x => x.id === "date"); if (q && !dateAsked) setDateAsked(q); }, [u, dateAsked]);
  const otherQs = u ? u.questions.filter(q => q.id !== "date" && q.id !== "event" && q.kind !== "column" && q.kind !== "deletedPerson") : [];
  const deletedQs = u ? u.questions.filter(q => q.kind === "deletedPerson") : [];
  const colQs = u ? u.questions.filter(q => q.kind === "column") : [];
  const eventName = answers.eventName ?? (eventQ && eventQ.suggestedEventName) ?? (dateQ && dateQ.suggestedEventName) ?? "";
  const tablesRead = u ? u.tables.filter(t => t.kind === "gifts" || t.kind === "people") : [];

  return (
    <Modal onClose={finish} title="Import a spreadsheet" width={900} ariaLabel="Import a spreadsheet"
      subtitle="Steward reads your file the way you would, shows you what it understood, and asks only what it cannot tell.">
      <div data-testid="sheet-import" style={{ display: "flex", flexDirection: "column", gap: 12, color: T.ink }}>
        {!file && (
          <div style={box}>
            <div style={h3}>Your file</div>
            <div style={small}>Any spreadsheet: an event night's sheet, a list from another system, a bank or PayPal download. Excel (.xlsx, .xls), CSV, TSV, or a Google Sheets download.</div>
            <input data-testid="sheet-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" style={{ marginTop: 8, maxWidth: "100%" }}
              onChange={e => e.target.files && e.target.files[0] && setFile(e.target.files[0])} />
          </div>
        )}
        {file && <div style={{ ...small }}><strong style={{ color: T.ink }}>{file.name}</strong></div>}
        {msg && <div role="alert" style={{ ...box, borderColor: T.gold500, fontSize: 13 }}>{msg}</div>}
        {!u && busy && <div style={small}>Reading your file…</div>}

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
            <div style={box} data-testid="sheet-understood">
              <div style={h3}>What Steward understood</div>
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
            {deletedQs.length > 0 && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-deleted-questions">
                {deletedQs.map(q => {
                  const cur = (answers.deletedPeople || {})[q.key] || q.default;
                  return (
                    <div key={q.id} style={{ padding: "6px 0", fontSize: 13 }}>
                      <div>{q.text}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {(q.options || []).map(o => <button type="button" key={o.key} data-testid={`sheet-deleted-${o.key}`} style={{ ...btn(cur === o.key), padding: "6px 10px", fontSize: 12 }}
                          onClick={() => setDeleted(q.key, o.key)}>{o.label}</button>)}
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
                <button type="button" data-testid="sheet-bring-back" disabled={!!busy} style={{ ...btn(false), marginTop: 8 }}
                  onClick={async () => {
                    setBusy("bring");
                    try {
                      const r = await apiFetch("/sheet-import/bring-back", { method: "POST", body: JSON.stringify({ ids: [...new Set(u.deletedMatches.map(x => x.id))] }) });
                      setMsg(r.sentence || ""); setAnswers(a => ({ ...a }));   // read the file again: they now match
                    } catch (e) { setMsg(e?.body?.sentence || errorMessage(e, "Nobody was brought back.")); setBusy(""); }
                  }}>
                  Bring them back
                </button>
              </div>
            )}

            {(eventQ || (u.event && u.event.fromEngagement)) && (
              <div style={{ ...box, borderColor: eventQ && !eventQ.optional ? T.gold500 : T.bg3 }} data-testid="sheet-question-event">
                <div style={h3}>{eventQ ? eventQ.text : "The event"}</div>
                {eventQ && <div style={small}>{eventQ.hint}</div>}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", flex: "1 1 220px" }}>Called
                    <input type="text" data-testid="sheet-event-name" value={eventName} placeholder="The event's name" onChange={e => setAnswer({ eventName: e.target.value })} style={field} />
                  </label>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>On (optional)
                    <input type="date" data-testid="sheet-event-date" value={answers.eventDate || ""} onChange={e => setAnswer({ eventDate: e.target.value })} style={{ ...field, flex: "0 0 auto" }} />
                  </label>
                </div>
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

            <div style={{ ...box, counterReset: "layer" }} data-testid="sheet-review">
              <style>{".sheet-layer-n::before{content:counter(layer)}"}</style>
              <div style={h3}>Before anything is written</div>
              <Layer title="People" testId="layer-people"
                main={`${n(c.persons ?? c.people, "person", "people")}${c.households ? `, ${n(c.households, "household")}` : ""}${c.organizations ? `, ${n(c.organizations, "organization")}` : ""}`}
                sub={`${u.newPeople} new, ${u.matchedPeople} already in Steward. Sheets that list the same people are read as one list, by ID first, then email, then name.`}
                notes={[...(u.placeholders || []).map(p => `The ${p.kind} ${p.value} is on ${p.people} different people, so it is treated as your own ${p.kind} and copied onto nobody.`),
                        ...(u.nearMisses || []).slice(0, 5).map(x => `${x.a} and ${x.b} (row ${x.line}): ${x.reason}.`)]} />
              <Layer title="Roles" testId="layer-roles"
                main={[c.donors && n(c.donors, "donor"), c.pledgers && n(c.pledgers, "pledger"), c.guests && n(c.guests, "event guest"), c.volunteers && n(c.volunteers, "volunteer"),
                       c.board && `${c.board} board`, c.staff && `${c.staff} staff`, c.prospects && n(c.prospects, "prospect"), c.contacts && n(c.contacts, "contact")].filter(Boolean).join(" · ") || "Contacts"}
                sub="From the data: a donor gave, a pledger promised, a prospect was invited and never gave. Someone with no gift comes in as a contact, never a donor." />
              {u.fileKind !== "people" && (
                <Layer title="Money" testId="layer-money"
                  main={`${n(c.gifts, "gift")} ${money(c.giftCents)}${c.undatedGifts ? ` (${c.undatedGifts.toLocaleString("en-US")} with no date)` : ""}${c.pledges ? ` · ${n(c.pledges, "pledge")} ${money(c.pledgeOpenCents)} open` : ""}`}
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
              <button type="button" data-testid="sheet-import-go" disabled={!u.ready || busy === "commit" || (job && job.status === "running")}
                onClick={() => (u.button && u.button.review && !asideOpen ? setAsideOpen(true) : commit())}
                style={{ ...btn(true), opacity: u.ready ? 1 : 0.45, cursor: u.ready ? "pointer" : "not-allowed", textAlign: "left", lineHeight: 1.4, maxWidth: "100%" }}>
                {busy === "commit" ? "Importing…" : u.button ? (u.button.review && !asideOpen ? u.button.text : u.button.importText || u.button.text) : "Import"}
              </button>
              <span style={small}>{u.ready ? "Undo removes the whole import, for 30 days, from its receipt here or in Settings, Imports." : `Answer ${n(u.questions.filter(q => !q.optional).length, "question")} above first.`}</span>
            </div>
          </>
        )}

        {result && (
          <div style={box} data-testid="sheet-result">
            <div style={h3}>{undone ? "Undone" : "Imported"}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{undone || result.sentence}</div>
            {!undone && result.totalsSentence && result.totalsSentence.length > 0 && <div style={{ ...small, marginTop: 4 }}>{result.totalsSentence.join(" ")}</div>}
            {!undone && result.undatedGifts > 0 && (
              <div data-testid="sheet-undated" style={{ marginTop: 10, borderTop: "1px solid " + T.bg2, paddingTop: 10 }}>
                <div style={{ fontSize: 13 }}>{dated || `${n(result.undatedGifts, "gift")} came in with no date. They count in Lifetime and ${result.eventName || "the event"}'s total, not in This year.`}</div>
                {!dated && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    <input type="date" data-testid="sheet-undated-date" value={undatedDate} onChange={e => setUndatedDate(e.target.value)} style={{ ...field, flex: "0 0 auto" }} />
                    <button type="button" data-testid="sheet-undated-go" style={btn(false)} disabled={!undatedDate || busy === "date"} onClick={dateUndated}>
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

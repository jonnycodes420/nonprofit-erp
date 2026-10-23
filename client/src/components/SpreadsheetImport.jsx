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
import { T, Modal } from "./shared";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import { errorMessage } from "../lib/domainError";
import { decodeSpreadsheetBytesDetailed } from "../../../shared/importShape";
import { gridsFromWorkbook, gridFromText, SHEET_ROLES } from "../../../shared/sheetRead";

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink,
  border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit" });
const STD_ROLES = SHEET_ROLES.filter(r => r.key !== "ignore");
const money = c => "$" + (Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
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
  const [dateAsked, setDateAsked] = useState(null);   // the date question stays on screen once answered
  const suggestedDate = useMemo(() => {
    const t = file && file.lastModified ? new Date(file.lastModified) : null;
    return t && !isNaN(t) ? localIso(t) : null;
  }, [file]);

  const finish = () => (result && onImported ? onImported() : onClose());
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

  const commit = async () => {
    setBusy("commit"); setMsg("");
    const importId = "imp_sheet_" + Math.random().toString(36).slice(2, 12);
    try {
      const r = await apiFetch("/sheet-import/commit", { method: "POST", body: JSON.stringify({ importId, fileName: file.name, sheets, answers: { ...answers, suggestedDate }, overrides }) });
      setResult(r);
    } catch (e) { setMsg(e?.body?.message || errorMessage(e, "That did not save. Nothing was brought in.")); }
    setBusy("");
  };
  const undo = async () => {
    setBusy("undo");
    try { const r = await apiFetch(`/imports/${encodeURIComponent(result.importId)}/reverse`, { method: "POST", body: "{}" }); setUndone(r.sentence); }
    catch (e) { setMsg(e?.body?.message || errorMessage(e, "That did not undo.")); }
    setBusy("");
  };

  const c = u && u.counts;
  const dateQ = (u && u.questions.find(q => q.id === "date")) || (u && u.needsDate ? dateAsked : null);
  useEffect(() => { const q = u && u.questions.find(x => x.id === "date"); if (q && !dateAsked) setDateAsked(q); }, [u, dateAsked]);
  const otherQs = u ? u.questions.filter(q => q.id !== "date" && q.kind !== "column") : [];
  const colQs = u ? u.questions.filter(q => q.kind === "column") : [];
  const eventName = answers.eventName ?? (dateQ && dateQ.suggestedEventName) ?? "";
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

        {u && !result && (
          <>
            <div style={box} data-testid="sheet-understood">
              <div style={h3}>What Steward understood</div>
              <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
                {u.fileKind === "gifts" && <>A gifts file: {tablesRead.map(t => `${t.sheet}, ${n(t.rows, "row")} from row ${t.headerLine}`).join("; ")}.</>}
                {u.fileKind === "people" && <>A list of people with no gifts: {tablesRead.map(t => `${t.sheet}, ${n(t.rows, "row")}`).join("; ")}.</>}
                {u.fileKind === "unknown" && <>Steward could not find names or amounts yet. Tell it which columns they are below.</>}
              </div>
              {u.totalsSentence && u.totalsSentence.length > 0 && <div data-testid="sheet-totals" style={{ fontSize: 13.5, marginTop: 6 }}>{u.totalsSentence.join(" ")}</div>}
              {u.totals.filter(t => !t.matches).map(t => (
                <div key={t.sheet + t.line + t.column} style={{ ...small, color: T.gold700, marginTop: 4 }}>
                  Row {t.line} of {t.sheet} says {money(t.statedCents)} for "{t.column}", but the rows above it add up to {money(t.sumCents)}.
                </div>))}
              {u.modelUsed && <div style={{ ...small, marginTop: 4 }}>Steward's assistant suggested what some columns are; each suggestion was checked against every row.</div>}
            </div>

            {dateQ && (
              <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-question-date">
                <div style={h3}>{dateQ.text}</div>
                <div style={small}>{dateQ.hint}</div>
                {dateQ.suggestedEventName && suggestedDate && (
                  <button type="button" data-testid="sheet-date-event" style={{ ...btn(false), marginTop: 8, textAlign: "left" }}
                    onClick={() => setAnswer({ date: suggestedDate, eventName: dateQ.suggestedEventName, linkEvent: true })}>
                    {dateQ.suggestedEventName}, {longDate(suggestedDate)}
                  </button>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Date given
                    <input type="date" data-testid="sheet-date-input" value={answers.date || ""} onChange={e => setAnswer({ date: e.target.value })} style={{ padding: "6px 8px", border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit" }} />
                  </label>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", flex: "1 1 220px" }}>Event
                    <input type="text" value={eventName} placeholder="Name of the event (optional)" onChange={e => setAnswer({ eventName: e.target.value })} style={{ flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit" }} />
                  </label>
                </div>
                {eventName && (
                  <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", marginTop: 8, color: T.ink }}>
                    <input type="checkbox" checked={!!answers.linkEvent} onChange={e => setAnswer({ linkEvent: e.target.checked, eventName })} />
                    {u.events && u.events.length ? `Link every gift to ${u.events[0].name} on your calendar` : `Create the event "${eventName}" and link every gift to it`}
                  </label>
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
                <div style={small}>Steward could not tell what {colQs.length === 1 ? "this column is" : "these columns are"}. Pick where each goes, or leave it out. Nothing is imported until you do.</div>
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

            <div style={box} data-testid="sheet-review">
              <div style={h3}>Before anything is written</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                <Fig label="People" value={n(c.people, "person", "people")} sub={`${u.newPeople} new, ${u.matchedPeople} already in Steward${c.households ? `; ${n(c.households, "household")}` : ""}${c.organizations ? `; ${n(c.organizations, "organization")}` : ""}`} />
                {u.fileKind !== "people" && <Fig label="Gifts" value={money(c.giftCents)} sub={n(c.gifts, "gift") + " paid"} />}
                {u.fileKind !== "people" && <Fig label="Pledges" value={money(c.pledgeCents)} sub={`${n(c.pledges, "open pledge")}${c.pledgeCents !== c.pledgeThisYearCents ? `, ${money(c.pledgeThisYearCents)} of it this year` : ""}`} />}
                {c.monthly > 0 && <Fig label="Monthly givers" value={String(c.monthly)} sub={`"Recurring" in your file: flagged for you to confirm, never charged`} />}
                {answers.linkEvent && eventName && answers.date && <Fig label="Event" value={eventName} sub={`${longDate(answers.date)}, every gift and pledge linked`} />}
              </div>
              {u.pledges.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12.5, cursor: "pointer" }}>The {n(u.pledges.length, "pledge")}</summary>
                  {u.pledges.slice(0, 200).map(p => <div key={p.rowId} style={{ ...small, color: T.ink }}>Row {p.line}: {p.who}, {money(p.pledgeCents)}. {p.why}.</div>)}
                </details>
              )}
              {u.aside.length > 0 && (
                <div data-testid="sheet-aside" style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>Not read as gifts ({u.aside.length})</div>
                  {u.aside.slice(0, 200).map(a => <div key={a.sheet + a.line} style={small}>Row {a.line}{a.sheet !== "Sheet1" ? ` of ${a.sheet}` : ""}: {a.who ? a.who + ", " : ""}{a.reason}.</div>)}
                </div>
              )}
              {u.notes.filter(x => !x.label).length > 0 && (
                <div style={{ ...small, marginTop: 8 }}>Notes on the sheet, kept out of the table: {u.notes.filter(x => !x.label).slice(0, 5).map(x => `"${x.text}" (row ${x.line})`).join("; ")}.</div>
              )}
            </div>

            <details style={box} data-testid="sheet-columns">
              <summary style={{ ...h3, cursor: "pointer", margin: 0 }}>What Steward read in each column</summary>
              {u.tables.map(t => (
                <div key={t.key} style={{ marginTop: 8 }}>
                  <div style={small}>{t.sheet}, header on row {t.headerLine}{t.kind === "summary" ? ": a table of amounts with no names, read as a summary" : ""}</div>
                  {t.columns.map(col => (
                    <div key={col.index} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg2, padding: "6px 0" }}>
                      <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5 }}><strong>{col.header || `(column ${col.index + 1})`}</strong>
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
              <button type="button" data-testid="sheet-import-go" disabled={!u.ready || busy === "commit"} onClick={commit}
                style={{ ...btn(true), opacity: u.ready ? 1 : 0.45, cursor: u.ready ? "pointer" : "not-allowed" }}>
                {busy === "commit" ? "Importing…" : "Import"}
              </button>
              <span style={small}>{u.ready ? "Undo removes the whole import." : `Answer ${n(u.questions.length, "question")} above first.`}</span>
            </div>
          </>
        )}

        {result && (
          <div style={box} data-testid="sheet-result">
            <div style={{ fontSize: 15, fontWeight: 700 }}>{undone || result.sentence}</div>
            {!undone && result.totalsSentence && result.totalsSentence.length > 0 && <div style={{ ...small, marginTop: 4 }}>{result.totalsSentence.join(" ")}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {!undone && <button type="button" style={btn(false)} disabled={busy === "undo"} onClick={undo}>{busy === "undo" ? "Undoing…" : "Undo this import"}</button>}
              <button type="button" data-testid="sheet-done" style={btn(true)} onClick={finish}>Done</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
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

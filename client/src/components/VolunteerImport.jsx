// VOL-2 Part 2 — IMPORT VOLUNTEERS, THE SAME WAY DONORS AND GRANTS IMPORT.
//
// A preset on the ONE mapper, never a second importer (the BUILD-89d rule):
// the file is read by `parseFileToSheets`, the same parser the donor import
// uses, so CSV and XLSX both work and a workbook picks its biggest sheet.
// Everything that DECIDES anything happens on the server in
// POST /volunteer-hub/import/preview, which writes nothing; the import
// re-plans from the same rows and never trusts this screen's copy.
//
// The shape of the screen is the grant importer's, deliberately: pick a file,
// read what Steward found, see who is already here, press the button, and get
// a result you can undo. A coordinator leaving VolunteerHub should not have to
// learn a second import.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box", maxWidth: "100%" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 40 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 40 };
const eyebrow = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };

const Num = ({ n, label, testid }) => (
  <div data-testid={testid} style={{ minWidth: 0 }}>
    <div style={{ fontSize: 24, fontFamily: "'DM Serif Display', Georgia, serif", color: T.ink, lineHeight: 1.1 }}>{n}</div>
    <div style={{ fontSize: 12, color: T.ink3 }}>{label}</div>
  </div>);

export function VolunteerImport({ onClose, parseFile, onDone }) {
  const [meta, setMeta] = useState(null);          // the presets and the two sentences
  const [file, setFile] = useState(null);          // {name, headers, rows}
  const [preset, setPreset] = useState("");
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [undone, setUndone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { apiFetch("/volunteer-hub/import/presets").then(setMeta).catch(() => setMeta(null)); }, []);

  const preview = async (f = file, p = preset) => {
    if (!f) return;
    setMsg(""); setBusy(true);
    try {
      const body = { headers: f.headers, rows: f.rows, preset: p || undefined };
      const got = await apiFetch("/volunteer-hub/import/preview", { method: "POST", body: JSON.stringify(body) });
      setPlan(got);
      if (!p) setPreset(got.preset || "");
    } catch (e) { setPlan(null); setMsg(errorMessage(e, "That file could not be read.")); }
    finally { setBusy(false); }
  };

  const pick = f => {
    if (!f) return;
    setMsg(""); setPlan(null); setResult(null); setUndone(null); setPreset("");
    parseFile(f, {
      onSingle: (headers, rows) => { const x = { name: f.name, headers, rows }; setFile(x); preview(x, ""); },
      onMulti: () => setMsg("Save the volunteer sheet on its own and try again."),
      onWorkbook: ({ roled }) => {
        const s = [...roled].filter(r => r.rowCount > 0).sort((a, b) => b.rowCount - a.rowCount)[0];
        if (!s) { setMsg("No data rows found in this file."); return; }
        const x = { name: f.name + (roled.length > 1 ? ` (sheet ${s.name})` : ""), headers: s.headers, rows: s.rows };
        setFile(x); preview(x, "");
      },
      onError: m => setMsg(m),
    });
  };

  const commit = async () => {
    setMsg(""); setBusy(true);
    try {
      const r = await apiFetch("/volunteer-hub/import", {
        method: "POST",
        body: JSON.stringify({ headers: file.headers, rows: file.rows, preset, filename: file.name }),
      });
      setResult(r); onDone && onDone(r);
    } catch (e) { setMsg(errorMessage(e, "The import did not run. Nothing was written.")); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    setMsg(""); setBusy(true);
    try {
      const r = await apiFetch(`/volunteer-hub/import/${result.importId}/undo`, { method: "POST", body: "{}" });
      setUndone(r); onDone && onDone(r);
    } catch (e) { setMsg(errorMessage(e, "The undo did not run.")); }
    finally { setBusy(false); }
  };

  const counts = plan && plan.counts;
  const footer = result
    ? (
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", width: "100%" }}>
        {/* UNDO IS NOT A DESTRUCTIVE CONFIRM, so it is not red. It is the
            quiet button beside Done, which is where a person looks for it
            the moment they realise they imported the wrong file. */}
        {!undone
          ? <button style={quietBtn} onClick={undo} disabled={busy} data-testid="vol-import-undo">
              {busy ? "Undoing…" : "Undo this import"}</button>
          : <span style={{ fontSize: 12.5, color: T.ink3 }}>Undone.</span>}
        <button style={primaryBtn} onClick={onClose} data-testid="vol-import-done">Done</button>
      </div>)
    : (
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button style={quietBtn} onClick={onClose}>Cancel</button>
        {plan && counts && counts.people > 0 && (
          <button style={primaryBtn} disabled={busy} onClick={commit} data-testid="vol-import-commit">
            {busy ? "Importing…" : `Import ${counts.people} ${counts.people === 1 ? "volunteer" : "volunteers"}`}
          </button>)}
      </div>);

  return (
    <Modal onClose={onClose} title="Import volunteers" width={760} footer={footer} ariaLabel="Import volunteers">
      <div data-testid="vol-import" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!result && (
          <>
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.65 }}>
              {meta ? meta.sentence : "A CSV or Excel export from your volunteer system, or a spreadsheet you keep yourself."}
            </div>
            <div>
              <input type="file" accept=".csv,.xlsx,.xls,.txt" data-testid="vol-import-file"
                onChange={e => pick(e.target.files && e.target.files[0])}
                style={{ fontSize: 13, maxWidth: "100%" }} />
              {meta && (
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 8, lineHeight: 1.6 }}>
                  Steward knows {meta.presets.filter(p => p.key !== "spreadsheet").map(p => p.label).join(", ")},
                  {" "}and reads a plain spreadsheet when it does not recognise the file.
                </div>
              )}
            </div>

            {msg && <div role="alert" style={{ fontSize: 13, color: T.terra700, background: T.terra100,
                        border: "1px solid " + T.terra200, borderRadius: 9, padding: "9px 12px" }}>{msg}</div>}

            {plan && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={eyebrow}>What is in this file</span>
                    <label style={{ marginLeft: "auto", fontSize: 12, color: T.ink3, display: "flex", gap: 6, alignItems: "center" }}>
                      Read it as
                      <select data-testid="vol-import-preset" value={preset} style={{ ...inp, padding: "5px 8px" }}
                        onChange={e => { setPreset(e.target.value); preview(file, e.target.value); }}>
                        {(meta ? meta.presets : []).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 10 }}>
                    <Num n={counts.people} label={counts.people === 1 ? "person" : "people"} testid="vol-import-n-people" />
                    <Num n={counts.shifts} label={counts.shifts === 1 ? "shift" : "shifts"} testid="vol-import-n-shifts" />
                    <Num n={Math.round(counts.hundredths / 100)} label="hours" testid="vol-import-n-hours" />
                    <Num n={counts.credentials} label="waivers and checks" testid="vol-import-n-creds" />
                    <Num n={counts.refused} label="rows left out" testid="vol-import-n-refused" />
                  </div>
                  <div data-testid="vol-import-sentence" style={{ fontSize: 13, color: T.ink, lineHeight: 1.6 }}>{plan.sentence}</div>
                  <div data-testid="vol-import-match" style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, marginTop: 6 }}>{plan.matchSentence}</div>
                  <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, marginTop: 10 }}>
                    <strong style={{ color: T.ink }}>Writes:</strong> {plan.writes}<br />
                    <strong style={{ color: T.ink }}>Does not write:</strong> {plan.doesNotWrite}
                  </div>
                </div>

                {/* WHO IS COMING IN, before anything is written. The match is
                    named per person, because "linked to a record already here"
                    is the thing a coordinator most needs to check by eye. */}
                <div>
                  <div style={{ ...eyebrow, marginBottom: 8 }}>The people</div>
                  <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid " + T.bg3, borderRadius: 10 }}>
                    {plan.people.map((p, i) => (
                      <div key={p.email || p.name || i} data-testid="vol-import-person"
                        style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.2fr)", gap: 10,
                                 padding: "9px 12px", borderTop: i ? "1px solid " + T.bg2 : "none", alignItems: "baseline" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>{p.name}</div>
                          {p.email && <div style={{ fontSize: 11.5, color: T.ink3 }}>{p.email}</div>}
                        </div>
                        <div style={{ fontSize: 12.5, color: T.ink3 }}>
                          {p.shifts ? `${p.shifts} ${p.shifts === 1 ? "shift" : "shifts"}, ${p.hours} h` : "No hours in this file"}
                        </div>
                        <div style={{ fontSize: 12, color: p.matchedTo ? T.greenDk : T.ink3 }}>
                          {p.matchedTo ? `Already here, matched by ${p.matchedTo.by}` : "New volunteer"}
                          {p.credentials.map((c, k) => <div key={k} style={{ color: T.ink3 }}>{c}</div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* EVERY REFUSED ROW, BY LINE AND REASON. A row Steward will
                    not read is a row the coordinator has to fix, and it can
                    only be fixed if she is told which one and why. */}
                {!!(plan.refused || []).length && (
                  <div>
                    <div style={{ ...eyebrow, marginBottom: 8 }}>Left out, and why</div>
                    <div data-testid="vol-import-refused" style={{ maxHeight: 150, overflowY: "auto", fontSize: 12.5, color: T.ink3, lineHeight: 1.7 }}>
                      {plan.refused.map((r, i) => (
                        <div key={i}>Line {r.line}{r.name ? ` (${r.name})` : ""}: {r.why}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div data-testid="vol-import-result" style={{ fontSize: 14.5, color: T.ink, lineHeight: 1.65 }}>
              {undone ? undone.sentence : result.sentence}
            </div>
            {!undone && (
              <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6 }}>{result.undoSentence}</div>
            )}
            {undone && !!(undone.kept || []).length && (
              <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.7 }}>
                {undone.kept.map(k => <div key={k.id}>{k.name} was kept: {k.reason}.</div>)}
              </div>
            )}
            {msg && <div role="alert" style={{ fontSize: 13, color: T.terra700 }}>{msg}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default VolunteerImport;

// ONBOARD-4 items 5 and 6 · /ops → Onboarding: the Stuck column and "Send it to us".
//
// StuckColumn draws GET /ops/onboarding/stuck: who is stuck, why (a timestamp
// already kept), and a note drafted for Jonathan to send himself (Copy, or open
// it in his own mail). Steward sends nothing.
//
// ConciergeJobs draws GET /ops/onboarding/concierge: each file she sent, what the
// mapper understood, and Load. A workbook is read here by the importer's own
// reader (readSheetFile) and its cells go back for the first pass; Load is the
// one button that writes, and it runs the normal import (Undo in her Imports).
import { useEffect, useState } from "react";
import { apiFetch, API, getToken } from "../../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const card = { background: WHITE, borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: `1px solid ${INK}14` };
const says = { fontSize: 12.5, opacity: 0.72, margin: "0 0 10px", lineHeight: 1.45 };
const btn = primary => ({ fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: primary ? 0 : `1px solid ${INK}33`,
  background: primary ? EMERALD : WHITE, color: primary ? WHITE : INK, cursor: "pointer", fontFamily: "inherit", minHeight: 32, textDecoration: "none", display: "inline-flex", alignItems: "center" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = v => { if (!v) return ""; const d = new Date(v); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const usd = c => `$${(Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function StuckRow({ r, title }) {
  const [copied, setCopied] = useState(false);
  const d = r.draft || {};
  const mailto = d.to ? `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}` : null;
  const copy = async () => { try { await navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the note stays on screen to select */ } };
  return <div data-onb-stuck={r.key} data-rule={r.rule} style={{ borderTop: `1px solid ${CREAM}`, padding: "10px 0" }}>
    <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: INK, opacity: 0.6 }}>{title}</div>
    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{r.name}</div>
    <div style={{ fontSize: 13, marginTop: 2 }}><span style={{ background: `${BRASS}44`, padding: "0 5px", borderRadius: 5 }}>{r.says}</span></div>
    <details style={{ marginTop: 6 }}>
      <summary style={{ fontSize: 12.5, fontWeight: 700, color: EMERALD, cursor: "pointer" }}>Your note{d.to ? ` to ${d.to}` : ""}</summary>
      <div style={{ background: CREAM, borderRadius: 8, padding: "8px 10px", marginTop: 6, fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.45 }}><b>{d.subject}</b>{"\n\n"}{d.body}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" style={btn(false)} onClick={copy} data-onb-stuck-copy="1">{copied ? "Copied" : "Copy"}</button>
        {mailto && <a href={mailto} style={btn(true)}>Open in my mail</a>}
      </div>
    </details>
  </div>;
}

export function StuckColumn() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/ops/onboarding/stuck").then(setD).catch(() => setD({ ok: false })); }, []);
  return <aside data-testid="ops-onboarding-stuck" style={{ ...card, flex: "1 1 300px", minWidth: 0, alignSelf: "flex-start" }}>
    <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Stuck{d && d.ok ? ` · ${d.rows.length}` : ""}</h3>
    {!d ? <p style={says}>Reading…</p> : !d.ok ? <p style={says}>The Stuck column could not be read. Try again in a minute.</p> : <>
      <p style={says}>{d.sentence}</p>
      {d.rows.length === 0 ? <p style={says}>Nobody is stuck.</p> : d.rows.map(r => <StuckRow key={r.key} r={r} title={d.titles[r.rule]} />)}
    </>}
  </aside>;
}

function Job({ j, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileOf = async () => {
    const r = await fetch(`${API}/ops/onboarding/concierge/${encodeURIComponent(j.id)}/file`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) throw new Error("The file could not be read.");
    return new File([await r.blob()], j.fileName);
  };
  const map = async () => {
    setBusy(true); setMsg(null);
    try {
      const { readSheetFile } = await import("../../components/SpreadsheetImport");
      const sheets = await readSheetFile(await fileOf());
      await apiFetch(`/ops/onboarding/concierge/${encodeURIComponent(j.id)}/map`, { method: "POST", body: JSON.stringify({ sheets }) });
      onChanged();
    } catch (e) { setMsg((e && e.message) || "The file could not be read."); }
    setBusy(false);
  };
  const load = async () => {
    setBusy(true); setMsg(null);
    try { const r = await apiFetch(`/ops/onboarding/concierge/${encodeURIComponent(j.id)}/load`, { method: "POST", body: "{}" }); setMsg(`Loaded as import ${r.importId}. Its Undo is in the org's Imports.`); onChanged(); }
    catch (e) { setMsg((e && e.message) || "Load did not run. Nothing was loaded."); }
    setBusy(false);
  };
  const download = async () => { try { const f = await fileOf(); const url = URL.createObjectURL(f); const a = document.createElement("a"); a.href = url; a.download = j.fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); } catch (e) { setMsg(e.message); } };
  const m = j.mapping;
  return <div data-onb-job={j.id} data-state={j.key} style={{ borderTop: `1px solid ${CREAM}`, padding: "10px 0" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
      <b style={{ fontSize: 14 }}>{j.orgName}</b><span style={{ fontSize: 13 }}>{j.fileName}{j.source === "booking" ? " (sent at booking)" : ""}</span>
      <span style={{ fontSize: 12, fontWeight: 700, padding: "1px 8px", borderRadius: 10, background: j.key === "loaded" ? EMERALD : CREAM, color: j.key === "loaded" ? WHITE : INK }}>{j.words}{j.undone ? " (undone)" : ""}</span>
    </div>
    <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 2 }}>{j.steps.filter(s => s.at).map(s => `${s.words} ${dayWords(s.at)}`).join(" · ")}</div>
    {m ? <div style={{ fontSize: 13, marginTop: 6 }}>
      The importer read <b>{m.people}</b> {m.people === 1 ? "person" : "people"} and <b>{m.gifts}</b> {m.gifts === 1 ? "gift" : "gifts"} of {usd(m.giftCents)}{m.aside ? `, ${m.aside} rows set aside` : ""}.
      {m.unplaced.length ? <div style={{ marginTop: 2 }}>Columns it did not place: {m.unplaced.join(", ")}.</div> : null}
      {m.questions.filter(q => !q.optional && q.answer == null).length ? <div style={{ marginTop: 2, color: INK }}><span style={{ background: `${BRASS}44`, padding: "0 5px", borderRadius: 5 }}>
        {m.questions.filter(q => !q.optional && q.answer == null).length} question(s) need an answer; import it by hand in a support session.</span></div> : null}
    </div> : j.mapError ? <p style={says}>{j.mapError}</p> : <p style={{ ...says, margin: "6px 0 0" }}>Not read yet. A workbook is read here, by the importer's own reader.</p>}
    {j.loadError && <p style={{ ...says, opacity: 1 }}>{j.loadError}</p>}
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <button type="button" style={btn(false)} onClick={download}>Download</button>
      {(!j.importId || j.undone) && <button type="button" style={btn(!m)} disabled={busy} onClick={map} data-onb-map="1">{m ? "Read it again" : "Read the file"}</button>}
      {m && (!j.importId || j.undone) && <button type="button" style={btn(true)} disabled={busy} onClick={load} data-onb-load="1">{busy ? "Working…" : "Load"}</button>}
    </div>
    {msg && <p style={{ ...says, opacity: 1, marginTop: 6 }}>{msg}</p>}
  </div>;
}

export function ConciergeJobs() {
  const [d, setD] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => { apiFetch("/ops/onboarding/concierge").then(setD).catch(() => setD({ ok: false })); }, [n]);
  if (!d) return null;
  return <section data-testid="ops-onboarding-concierge" style={card}>
    <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Send it to us · {d.ok ? d.jobs.length : "–"}</h3>
    {!d.ok ? <p style={says}>The files could not be read. Try again in a minute.</p> : <>
      <p style={says}>{d.sentence}</p>
      {d.jobs.length === 0 ? <p style={says}>No file has been sent yet.</p> : d.jobs.map(j => <Job key={j.id} j={j} onChanged={() => setN(x => x + 1)} />)}
    </>}
  </section>;
}

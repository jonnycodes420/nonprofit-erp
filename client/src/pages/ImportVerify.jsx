// ONBOARD-1 · /imports/:importId/verify — the customer checks a staged import
// before it goes live. File against Steward, to the cent: people, gifts,
// dollars, dollars per year, each fund, and ten donors picked at random from
// the file. Every gap is the rows that make it up. Then one of two buttons:
// "These match, make it live" (recorded with who and when) or "Something's
// off" (a note to Jonathan). Until then the rows are in no count and no list.
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

const C = { ink: "#0F1A12", white: "#FFFFFF", cream: "#F0EDE6", emerald: "#0D5C3A", brass: "#C9A84C", muted: "#5a554f", line: "#ddd9d0" };
const SERIF = "'DM Serif Display',Georgia,serif";
const money = c => (c == null ? "—" : (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = n => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const mark = ok => <span aria-label={ok ? "matches" : "differs"} style={{ color: ok ? C.emerald : C.brass, fontWeight: 700 }}>{ok ? "✓" : "≠"}</span>;

function Table({ head, rows, testid }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid={testid} style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ textAlign: i ? "right" : "left", padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600, color: C.muted, fontSize: 12.5 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: j ? "right" : "left", padding: "7px 8px", borderBottom: `1px solid ${C.line}` }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function ImportVerify() {
  const { importId } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showFlag, setShowFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const load = () => apiFetch(`/imports/${encodeURIComponent(importId)}/verify`).then(setD).catch(e => setErr(e.message || "Could not open this import."));
  useEffect(() => { load(); }, [importId]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function accept() {
    setBusy(true); setErr(null);
    try { const r = await apiFetch(`/imports/${encodeURIComponent(importId)}/accept`, { method: "POST", body: JSON.stringify({ reason }) }); setDone(r.sentence); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function flag() {
    setBusy(true); setErr(null);
    try { const r = await apiFetch(`/imports/${encodeURIComponent(importId)}/flag`, { method: "POST", body: JSON.stringify({ note }) }); setDone(r.sentence); setShowFlag(false); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const card = { background: C.white, borderRadius: 12, padding: 20, marginTop: 14 };
  const shell = children => (
    <div style={{ minHeight: "100vh", background: C.cream, color: C.ink, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 16px 64px" }}>
        <a href="/app/settings" style={{ color: C.emerald, fontSize: 13 }}>← Back to Steward</a>
        {children}
      </div>
    </div>
  );
  if (err && !d) return shell(<div style={card}>{err}</div>);
  if (!d) return shell(<div style={card}>Opening…</div>);
  const imp = d.import;
  const m = d.money;

  return shell(<>
    <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: "14px 0 4px" }}>Check your file</h1>
    <p style={{ margin: 0, color: C.muted }}>{imp.name}{imp.by ? `, imported by ${imp.by}` : ""}.{" "}
      {imp.state === "staged" ? "These rows are in Steward but hidden from every count and list until you make them live." :
       imp.state === "accepted" ? `Live since ${new Date(imp.acceptedAt).toLocaleString()}, made live by ${imp.acceptedByName}${imp.acceptReason ? ` for the customer, because: ${imp.acceptReason}` : ""}.` :
       imp.state === "undone" ? "This import was undone." : "This import went in live."}</p>

    <div style={card} data-testid="verify-money">
      <div style={{ fontSize: 22, fontFamily: SERIF }} data-testid="verify-money-sentence">{m.sentence}</div>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 0" }}>{d.sentences.money}</p>
      {m.gaps.length ? <ul style={{ margin: "12px 0 0", paddingLeft: 18 }} data-testid="verify-gaps">{m.gaps.map((g, i) => <li key={i} style={{ marginBottom: 4 }}>{g.sentence}</li>)}</ul> : null}
    </div>

    <div style={card}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>File against Steward</h2>
      <Table testid="verify-lines" head={["", "Your file", "In Steward", ""]}
        rows={[...d.lines, ...d.byYear].map(l => [<span title={l.sentence}>{l.label}</span>, l.money ? money(l.file) : num(l.file), l.money ? money(l.held) : num(l.held), mark(l.matches)])} />
    </div>

    <div style={card}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Funds</h2>
      {d.funds ? <Table testid="verify-funds" head={["Fund", "Your file", "In Steward", ""]}
        rows={d.funds.map(f => [f.label, money(f.file), money(f.held), mark(f.matches)])} /> : <p style={{ margin: 0 }}>{d.fundsUnavailable}</p>}
    </div>

    <div style={card}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Ten donors, checked by hand</h2>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 10px" }}>{d.sentences.spot}</p>
      {d.spot.length ? <Table testid="verify-spot" head={["Donor", "File: lifetime · gifts · last", "Steward: lifetime · gifts · last", ""]}
        rows={d.spot.map(s => [s.name || s.key,
          `${money(s.file.cents)} · ${s.file.gifts} · ${s.file.last || "—"}`,
          s.held ? `${money(s.held.cents)} · ${s.held.gifts} · ${s.held.last || "—"}` : "Not found in Steward",
          mark(s.matches)])} /> : <p style={{ margin: 0 }}>{d.spotUnavailable}</p>}
    </div>

    {done ? <div style={{ ...card, borderLeft: `4px solid ${C.emerald}` }} data-testid="verify-done">{done}</div> : null}
    {err ? <div role="alert" style={{ ...card, fontWeight: 600 }}>{err}</div> : null}

    {d.canAccept ? (
      <div style={card} data-testid="verify-actions">
        {d.reasonRequired ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            You are making this live for the customer. Why? (shown on the record)
            <input data-testid="verify-reason" value={reason} onChange={e => setReason(e.target.value)} style={{ padding: "9px 11px", border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit" }} />
          </label>
        ) : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button data-testid="verify-accept" disabled={busy || (d.reasonRequired && reason.trim().length < 10)} onClick={accept}
            style={{ background: C.emerald, color: C.white, border: 0, borderRadius: 8, padding: "11px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || (d.reasonRequired && reason.trim().length < 10) ? 0.55 : 1 }}>
            These match, make it live</button>
          <button data-testid="verify-flag-open" onClick={() => setShowFlag(v => !v)}
            style={{ background: "transparent", color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "11px 16px", fontSize: 15, cursor: "pointer" }}>
            Something's off</button>
        </div>
        {showFlag ? (
          <div style={{ marginTop: 12 }}>
            <textarea data-testid="verify-flag-note" value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="What looks wrong? Jonathan reads this."
              style={{ width: "100%", boxSizing: "border-box", padding: 10, border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "inherit", fontSize: 14 }} />
            <button data-testid="verify-flag-send" disabled={busy || note.trim().length < 3} onClick={flag}
              style={{ marginTop: 8, background: C.ink, color: C.white, border: 0, borderRadius: 8, padding: "9px 14px", cursor: "pointer" }}>Send to Jonathan</button>
          </div>
        ) : null}
        {imp.flagNote ? <p style={{ fontSize: 13, color: C.muted, margin: "12px 0 0" }}>Noted by {imp.flaggedByName}: “{imp.flagNote}”</p> : null}
      </div>
    ) : null}
  </>);
}

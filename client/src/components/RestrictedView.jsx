// BUILD-100 (grants) Part 7 — RESTRICTED MONEY, IN FINANCE.
//
// Finance → Restricted draws GET /finance/restricted and nothing else. Every
// figure is the server's (shared/restrictedMoney.js, in integer cents) and
// carries its definition from the ONE registry (RESTRICTED_METRICS) as its
// hover. An overspent grant says so in its own sentence and shows the
// negative figure — it is never clamped to $0, because an award spent past
// what the funder paid is precisely the finding a treasurer needs to see.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { errorMessage } from "../lib/domainError";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };
const LABELS = { awarded: "Awarded", received: "Received", outstanding: "Still owed", spent: "Spent", remaining: "Remaining to spend" };
const KEYS = ["awarded", "received", "outstanding", "spent", "remaining"];
// Sign FIRST: fmtFull reads "$-5,500" (pinned elsewhere), and an overspent
// balance is the one figure on this screen that is meant to be negative, so it
// is written the way a treasurer writes it. The formatter stays INLINE at the
// render site so the number census (build97) can see it.

function Figure({ k, value, def, big }) {
  const neg = k === "remaining" && Number(value) < 0;
  return (
    <div title={def || ""} data-testid={"restricted-" + k} style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.ink3 }}>{LABELS[k]}</div>
      <div style={{ fontSize: big ? 22 : 15, fontWeight: 700, color: neg ? T.terracotta : T.ink, fontFamily: big ? "'DM Serif Display', Georgia, serif" : undefined }}>
        {Number(value) < 0 && "-"}{fmtFull(Math.abs(Number(value)))}
      </div>
    </div>
  );
}

function SpendPanel({ grantId, isReadOnly, onChanged }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState({ amount: "", spentOn: "", description: "" });
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/grants/${grantId}/restricted`).then(setD)
    .catch(e => { setD({ spend: [] }); setMsg(errorMessage(e, "The spending could not be loaded.")); });
  useEffect(() => { load(); }, [grantId]);
  const add = async () => {
    setMsg("");
    try {
      await apiFetch(`/grants/${grantId}/spend`, { method: "POST", body: JSON.stringify(form) });
      setForm({ amount: "", spentOn: "", description: "" }); load(); onChanged();
    } catch (e) { setMsg(errorMessage(e, "That spending line did not save.")); }
  };
  const del = async s => {
    setMsg("");
    try { await apiFetch(`/grants/spend/${s.id}`, { method: "DELETE" }); load(); onChanged(); }
    catch (e) { setMsg(errorMessage(e, "That line was not removed.")); }
  };
  if (!d) return null;
  return (
    <div data-testid="spend-panel" style={{ padding: "8px 0 4px 14px", borderLeft: "2px solid " + T.bg3, marginTop: 8 }}>
      {d.spendSourceNote && <div style={{ fontSize: 12, color: T.ink3, marginBottom: 6 }}>{d.spendSourceNote}</div>}
      {!d.spend.length && <div style={{ fontSize: 13, color: T.ink3 }}>No spending recorded against this award yet.</div>}
      {d.spend.map(s => (
        <div key={s.id} data-testid="spend-row" style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ minWidth: 86, color: T.ink3 }}>{s.spentOn}</span>
          <span style={{ flex: "1 1 160px", color: T.ink, overflowWrap: "anywhere" }}>{s.description}{s.byName ? <span style={{ color: T.ink3 }}> · {s.byName}</span> : null}</span>
          <span style={{ fontWeight: 700, color: T.ink }}>{fmtFull(s.amount)}</span>
          {!isReadOnly && <button style={quietBtn} onClick={() => del(s)}>Remove</button>}
        </div>))}
      {!isReadOnly && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input placeholder="Amount" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ ...inp, width: 110 }} data-testid="spend-amount" />
          <input type="date" value={form.spentOn} onChange={e => setForm({ ...form, spentOn: e.target.value })} style={inp} data-testid="spend-date" />
          <input placeholder="What it paid for" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} data-testid="spend-desc" />
          <button style={primaryBtn} onClick={add} data-testid="spend-save">Add spending</button>
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

export function RestrictedView({ isReadOnly, onNavigate }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/finance/restricted").then(setData)
    .catch(e => { setData({ grants: [], unrestricted: [], totals: {}, definitions: {} }); setMsg(errorMessage(e, "Restricted balances could not be loaded.")); });
  useEffect(() => { load(); }, []);
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  const defs = data.definitions || {};
  return (
    <div data-testid="restricted-view" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {data.sentence && <div data-testid="restricted-sentence" style={{ fontSize: 15, color: T.ink, lineHeight: 1.5 }}>{data.sentence}</div>}
      {data.grants.length > 0 && (
        <div data-testid="restricted-totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14, background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px" }}>
          {KEYS.map(k => <Figure key={k} k={k} value={data.totals[k]} def={defs[k]} big />)}
        </div>)}
      {!data.grants.length && (
        <div style={{ fontSize: 13, color: T.ink3 }}>No restricted awards yet. When a grant is awarded with a restriction, what is left to spend appears here.</div>)}
      {data.grants.map(g => (
        <div key={g.grantId} data-testid="restricted-grant" style={{ background: T.white, border: "1px solid " + (g.overspent ? T.terracotta : T.bg3), borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{g.funderName}{g.program ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {g.program}</span> : null}</div>
            {g.fundName && <span style={{ fontSize: 12, color: T.ink3 }}>Fund: {g.fundName}</span>}
          </div>
          <div data-testid="restricted-grant-sentence" style={{ fontSize: 13, color: g.overspent ? T.terracotta : T.ink3, margin: "4px 0 10px", lineHeight: 1.5 }}>{g.sentence}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
            {KEYS.map(k => <Figure key={k} k={k} value={g[k]} def={defs[k]} />)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={quietBtn} data-testid="restricted-expand" onClick={() => setOpen(open === g.grantId ? null : g.grantId)}>{open === g.grantId ? "Hide spending" : "Spending"}</button>
            {onNavigate && <button style={quietBtn} onClick={() => onNavigate("grants", { grantId: g.grantId })}>Open grant</button>}
          </div>
          {open === g.grantId && <SpendPanel grantId={g.grantId} isReadOnly={isReadOnly} onChanged={load} />}
        </div>))}
      {data.unrestricted.length > 0 && (
        <details>
          <summary style={{ fontSize: 13, color: T.ink3, cursor: "pointer" }}>{data.unrestricted.length} unrestricted {data.unrestricted.length === 1 ? "award" : "awards"}, not counted above</summary>
          {data.unrestricted.map(u => <div key={u.grantId} style={{ fontSize: 13, color: T.ink3, padding: "6px 0" }}>{u.funderName}{u.program ? ` · ${u.program}` : ""}: {u.sentence}</div>)}
        </details>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

// client/src/components/XeroSync.jsx, CONNECT-2 Part 3. XERO SYNC.
//
// Opens from the Xero card on Connections, the QuickBooks panel's shape:
//
//   1. WHAT STEWARD CAN SEE. "Read from Xero" reads the organisation's name
//      (the proof this is the right set of books) and its accounts. It sends
//      nothing.
//   2. WHERE EACH GIFT LANDS. Every fund, and "No fund named", mapped to an
//      income account; the bank account the money lands in; the fee account.
//      Chosen from the accounts Xero returned.
//   3. PENDING AND SYNC. Each gift becomes one bank transaction (money
//      received), only when somebody presses Sync, and never twice. Auto-sync
//      cannot be turned on until every fund is mapped.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const field = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px",
  fontSize: 12.5, minWidth: 0, maxWidth: "100%", width: 230, fontFamily: "inherit", color: T.ink };
const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "7px 0",
  borderTop: "1px solid " + T.bg2, fontSize: 13 };
const said = e => e?.body?.sentence || e?.sentence || errorMessage(e, "That did not work.");
const money = cents => "$" + (Math.round(Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = at => { if (!at) return null; const d = new Date(at); return isNaN(d) ? null : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

// An account chooser from the list Xero returned. Before Xero has been read,
// the saved choice is shown on its own so nothing looks unmapped that is not.
function Pick({ list, value, onChange, placeholder, disabled, testid, byId = false }) {
  const key = a => (byId ? a.id : a.code) || "";
  const cur = value ? key(value) : "";
  const known = (list || []).some(a => key(a) === cur);
  return (
    <select data-testid={testid} disabled={disabled} value={cur} style={field}
      onChange={e => { const a = (list || []).find(x => key(x) === e.target.value); onChange(a ? { id: a.id, code: a.code, name: a.name } : null); }}>
      <option value="">{placeholder}</option>
      {!known && cur && <option value={cur}>{value.name || cur}{value.code ? ` (${value.code})` : ""}</option>}
      {(list || []).map(a => <option key={key(a)} value={key(a)}>{a.name}{a.code ? ` (${a.code})` : ""}</option>)}
    </select>);
}

export default function XeroSync({ connectionId = null, isReadOnly, isAdmin }) {
  const [d, setD] = useState(null);
  const [seen, setSeen] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const can = !isReadOnly && isAdmin;
  const load = () => apiFetch("/xero").then(r => { setD(r); setDraft(null); }).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  if (!d || !d.connected || (connectionId && d.id !== connectionId)) return null;

  const m = draft || d.mapping || { funds: {} };
  const setMap = patch => setDraft({ ...m, ...patch });
  const setFund = (id, a) => setMap({ funds: { ...(m.funds || {}), [id]: a } });

  const read = async () => {
    setBusy("read"); setMsg("");
    try { setSeen(await apiFetch("/xero/preview", { method: "POST" })); load(); }
    catch (e) { setSeen({ ok: false, sentence: said(e) }); }
    finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save");
    try { const r = await apiFetch("/xero/mapping", { method: "PUT", body: JSON.stringify(m) }); setMsg(r.sentence); load(); }
    catch (e) { setMsg(said(e)); }
    finally { setBusy(""); }
  };
  const sync = async () => {
    setBusy("sync"); setMsg("");
    try { const r = await apiFetch("/xero/sync", { method: "POST", body: JSON.stringify({ all: true }) }); setMsg(r.sentence); load(); }
    catch (e) { setMsg(said(e)); }
    finally { setBusy(""); }
  };
  const toggleAuto = async () => {
    setBusy("auto");
    try { const r = await apiFetch("/xero/auto-sync", { method: "PUT", body: JSON.stringify({ on: !d.autoSync }) }); setMsg(r.sentence); load(); }
    catch (e) { setMsg(said(e)); }
    finally { setBusy(""); }
  };
  const autoBlocked = !d.autoSync && d.mappingReady === false;

  return (
    <Card data-testid="xero-sync" style={{ padding: "14px 16px", marginTop: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15, color: T.ink }}>Xero sync{d.tenantName ? `: ${d.tenantName}` : ""}</strong>
        {can && <button type="button" data-testid="xero-auto" disabled={busy === "auto" || autoBlocked} onClick={toggleAuto}
          title={autoBlocked ? "Map every fund first" : ""}
          style={{ ...btn(false), marginLeft: "auto", ...(autoBlocked ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}>
          {d.autoSync ? "Turn auto-sync off" : "Turn auto-sync on"}</button>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{d.definition}</div>
      <div data-testid="xero-status" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, marginTop: 4 }}>
        {d.autoSync ? "Auto-sync is on: once an hour Steward sends whatever is waiting." : "Auto-sync is off: nothing goes until somebody presses Sync."}
        {d.sent && d.sent.gifts > 0 ? ` ${d.sent.gifts} ${d.sent.gifts === 1 ? "gift has" : "gifts have"} been sent to Xero, ${money(d.sent.cents)} in all.` : " Nothing has been sent to Xero yet."}
        {d.lastSentAt ? ` Last sent ${when(d.lastSentAt)}.` : ""}
      </div>
      {!d.tenantChosen && <div style={{ fontSize: 12.5, color: T.gold700, lineHeight: 1.5, marginTop: 4 }}>
        Steward does not know which Xero organization to use yet. Connect Xero again and choose it.</div>}
      {d.lastError && <div data-testid="xero-last-error" style={{ fontSize: 12.5, color: T.gold700, lineHeight: 1.5, marginTop: 4 }}>{d.lastError}</div>}
      {d.mappingGaps && <div data-testid="xero-map-gaps" style={{ fontSize: 12.5, color: T.gold700, lineHeight: 1.5, marginTop: 4 }}>{d.mappingGaps.sentence}</div>}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}

      {can && d.tenantChosen && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={h}>What Steward can see</div>
          <button type="button" data-testid="xero-read" disabled={busy === "read"} onClick={read} style={{ ...btn(false), marginLeft: "auto" }}>
            {busy === "read" ? "Reading" : seen ? "Read again" : "Read from Xero"}</button>
        </div>
        <div data-testid="xero-read-sentence" style={{ fontSize: 12.5, color: seen && seen.ok === false ? T.gold700 : seen ? T.ink : T.ink3, lineHeight: 1.5, marginTop: 4 }}>
          {seen ? seen.sentence : "Reads the organization's name and its accounts, to show these are the right books and to fill the lists below. It sends nothing."}</div>
      </div>}

      {can && <div style={{ marginTop: 12 }}>
        <div style={h}>Where each gift lands</div>
        <div style={row}>
          <span style={{ flex: "1 1 160px" }}>Send gifts dated from</span>
          <input type="date" value={m.startDate || ""} onChange={e => setMap({ startDate: e.target.value })} style={field} />
        </div>
        <div style={row}>
          <span style={{ flex: "1 1 160px" }}>Money lands in</span>
          <Pick testid="xero-bank" byId list={seen && seen.bank} value={m.bankAccount} placeholder="Bank account" onChange={a => setMap({ bankAccount: a })} />
        </div>
        <div style={row}>
          <span style={{ flex: "1 1 160px" }}>Processing fees post to</span>
          <Pick list={seen && seen.expense} value={m.feeAccount} placeholder="Fee account" onChange={a => setMap({ feeAccount: a })} />
        </div>
        {(d.funds || []).map(f => (
          <div key={f.id} data-testid="xero-map-row" style={row}>
            <span style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{f.name}{f.restricted ? " (restricted)" : ""}</span>
            <Pick list={seen && seen.income} value={(m.funds || {})[f.id]} placeholder="Income account" onChange={a => setFund(f.id, a)} />
          </div>))}
        {!seen && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>Read from Xero first, and its accounts appear in these lists.</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" data-testid="xero-map-save" disabled={!draft || busy === "save"} onClick={save} style={btn(false)}>Save the mapping</button>
        </div>
      </div>}

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={h}>Waiting to go to Xero</div>
          {can && <button type="button" data-testid="xero-sync-all" disabled={busy === "sync" || !d.canSync || !(d.pending && d.pending.count)}
            onClick={sync} style={{ ...btn(true), marginLeft: "auto" }}>{busy === "sync" ? "Sending" : "Sync"}</button>}
        </div>
        <div data-testid="xero-pending" title={d.pending && d.pending.definition} style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, marginTop: 4 }}>
          {d.pending && d.pending.count ? `${d.pending.count} ${d.pending.count === 1 ? "gift" : "gifts"}, ${money(d.pending.cents)}.` : "Nothing is waiting."}
        </div>
        {(d.pending && d.pending.rows || []).slice(0, 10).map(r => (
          <div key={r.giftId} style={row}>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>{r.donorName || "A donor"}</span>
            <span style={{ color: T.ink3 }}>{r.date}</span><span>{money(r.cents)}</span>
            {r.problem && <span style={{ flex: "1 1 100%", fontSize: 12, color: T.gold700 }}>{r.problem}</span>}
          </div>))}
      </div>
    </Card>);
}

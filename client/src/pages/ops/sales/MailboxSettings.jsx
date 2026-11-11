// SALES-1 Part B · Sales settings → Mailbox. Jonathan connects his own mailbox
// (Microsoft 365, or Gmail); Steward reads only mail to or from a sales
// contact's address or a prospect domain, and sends nothing. Disconnect removes
// the connection; "Delete captured sales email" is a separate, confirmed wipe.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, TERRA, card, h2, says, btn, quiet, box, brassTag, whenWords } from "./salesBits";

const WORD = { microsoft: "Microsoft 365", google: "Gmail" };

export default function MailboxSettings() {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [domains, setDomains] = useState("");
  const [days, setDays] = useState("5");
  const [confirm, setConfirm] = useState("");
  const load = useCallback(() => apiFetch("/ops/sales/mailbox").then(r => { setD(r); setDomains((r.prospectDomains || []).join(", ")); setDays(String(r.noReplyDays)); })
    .catch(() => setD({ ok: false })), []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, after) => { setMsg(null); try { const r = await fn(); setMsg(after(r)); load(); } catch (e) { setMsg(e.message); } };
  const connect = p => act(() => apiFetch(`/ops/sales/mailbox/${p}/start`, { method: "POST", body: "{}" }), r => { window.location.assign(r.url); return "Opening the consent screen…"; });
  if (!d) return <section style={card}><p style={says}>Loading the mailbox…</p></section>;
  if (d.ok === false) return <section style={card}><p style={says}>The mailbox settings could not be read.</p></section>;
  return <section style={card} data-sales-mailbox="1">
    <h2 style={h2}>Mailbox</h2>
    <p style={says}>{d.sentence} {d.captured === 1 ? "1 email is" : `${d.captured} emails are`} stored now.</p>
    {d.mailboxes.length === 0 ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {d.providers.map(p => <button key={p.provider} type="button" style={p.configured ? btn : quiet} disabled={!p.configured} onClick={() => connect(p.provider)} data-mailbox-connect={p.provider}
        title={p.configured ? "" : "Not set up on this server"}>Connect {WORD[p.provider]}</button>)}
    </div> : d.mailboxes.map(m => <div key={m.id} style={{ background: CREAM, borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }} data-mailbox-row={m.id}>
      <b>{m.address}</b> · {WORD[m.provider]} · {m.status === "fixture" ? "a made-up fixture: nothing is read from it" : m.status === "active" ? (m.last_ok_at ? `last read ${whenWords(m.last_ok_at)}${m.found_last != null ? `, ${m.found_last} new` : ""}` : "first read on its way") : <span style={brassTag}>{m.last_error || "needs connecting again"}</span>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {m.status !== "fixture" ? <button type="button" style={quiet} onClick={() => act(() => apiFetch(`/ops/sales/mailbox/${m.id}/read`, { method: "POST", body: "{}" }), r => r.sentence)}>Read now</button> : null}
        <button type="button" style={quiet} onClick={() => act(() => apiFetch(`/ops/sales/mailbox/${m.id}/disconnect`, { method: "POST", body: "{}" }), () => "Disconnected. Mail already captured stays until you delete it below.")} data-mailbox-disconnect={m.id}>Disconnect</button>
      </div>
    </div>)}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 3, flex: "1 1 300px" }}>Prospect domains (mail with anyone at these is kept too)
        <input value={domains} onChange={e => setDomains(e.target.value)} placeholder="harborlight.org, fernhollow.org" style={box} data-mailbox-domains="1" /></label>
      <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 3 }}>"No reply" after (days)
        <input type="number" min={1} max={90} value={days} onChange={e => setDays(e.target.value)} style={{ ...box, width: 90 }} /></label>
      <button type="button" style={btn} onClick={() => act(() => apiFetch("/ops/sales/mailbox/settings", { method: "PUT", body: JSON.stringify({ prospectDomains: domains, noReplyDays: Number(days) }) }), () => "Saved.")}>Save</button>
    </div>
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${CREAM}` }}>
      <b style={{ fontSize: 13 }}>Delete captured sales email</b>
      <p style={says}>Removes every stored sales email from every record. The mailbox itself is not touched. Type DELETE to confirm.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE" style={{ ...box, width: 110 }} aria-label="Type DELETE to confirm" data-mailbox-confirm="1" />
        <button type="button" style={{ ...btn, background: TERRA }} disabled={confirm !== "DELETE"} data-mailbox-wipe="1"
          onClick={() => act(() => apiFetch("/ops/sales/mailbox/delete-captured", { method: "POST", body: JSON.stringify({ confirm }) }), r => { setConfirm(""); return `Deleted ${r.emails} captured emails.`; })}>Delete captured email</button>
      </div>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 8 }}>{msg}</p> : null}
  </section>;
}

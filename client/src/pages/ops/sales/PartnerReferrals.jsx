// SALES-2 item 8 · a partner's private referral link, and what came through it: referrals in,
// meetings, won, MRR and owed. The link is shown once, when it is made (Steward keeps only a
// fingerprint of it); making a new one turns the old one off. Nothing is emailed to anyone.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { CREAM, card, h2, says, btn, quiet, box, link, brassTag, usd, whenWords, failureWords } from "./salesBits";

export default function PartnerReferrals({ partnerId, open }) {
  const [d, setD] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => apiFetch(`/ops/sales/partners/${partnerId}/referrals`).then(setD).catch(e => setD({ ok: false, e })), [partnerId]);
  useEffect(() => { load(); }, [load]);
  const make = async () => { setMsg(null); try { const r = await apiFetch(`/ops/sales/partners/${partnerId}/referral-link`, { method: "POST", body: "{}" }); setFresh({ url: `${window.location.origin}${r.path}`, says: r.says }); load(); } catch (e) { setMsg(failureWords(e, "No link was made.")); } };
  const revoke = async () => { setMsg(null); try { await apiFetch(`/ops/sales/partners/${partnerId}/referral-link/revoke`, { method: "POST", body: "{}" }); setFresh(null); load(); } catch (e) { setMsg(failureWords(e, "Not revoked.")); } };
  if (!d) return <section style={card}><p style={says}>Loading…</p></section>;
  if (d.ok === false) return <section style={card}><p style={says}>{failureWords(d.e, "The referrals could not be read.")}</p></section>;
  const live = d.links.find(l => !l.revoked_at);
  const stat = (k, v, s) => <div key={k} title={s}><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div><div style={{ opacity: 0.7, fontSize: 13 }}>{k}</div></div>;
  return <section style={card} data-partner-referrals={partnerId}>
    <h2 style={h2}>Referral link</h2>
    <p style={says}>A private page with Steward's look, "Referred by" this partner, and a short form. What they send lands here as a deal in Lead, with this partner's first term attached, and a call-within-the-hour task. The page never shows them anything about other deals.</p>
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap", margin: "4px 0 12px" }}>
      {stat("Referrals in", d.referralsIn, d.sentences.referralsIn)}{stat("Meetings", d.meetings, d.sentences.meetings)}{stat("Won", d.won, d.sentences.won)}
      {stat("MRR", usd(d.mrrCents), d.sentences.mrr)}{stat("Owed", usd(d.owedCents), d.sentences.owed)}
    </div>
    {fresh ? <div style={{ background: CREAM, borderRadius: 8, padding: 10, marginBottom: 8 }} data-referral-fresh="1">
      <input readOnly value={fresh.url} style={{ ...box, width: "100%" }} aria-label="The new referral link" onFocus={e => e.target.select()} data-referral-url="1" />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={() => navigator.clipboard && navigator.clipboard.writeText(fresh.url)}>Copy link</button>
        <span style={{ fontSize: 12.5 }}>{fresh.says}</span></div>
    </div> : null}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" style={live ? quiet : btn} onClick={make} data-referral-make="1">{live ? "Make a new link (turns the old one off)" : "Make a referral link"}</button>
      {live ? <button type="button" style={quiet} onClick={revoke} data-referral-revoke="1">Turn the link off</button> : null}
      <span style={{ fontSize: 12.5, opacity: 0.75 }}>{live ? `A link has been live since ${whenWords(live.created_at)}.` : d.links.length ? "No link is live." : "No link yet."}</span>
    </div>
    {msg ? <p style={{ ...says, opacity: 1 }}><span style={brassTag}>Not done</span> {msg}</p> : null}
    {d.deals.length ? <div style={{ marginTop: 10 }}>{d.deals.map(x => <div key={x.id} style={{ fontSize: 13, padding: "4px 0", borderTop: `1px solid ${CREAM}` }}>
      <button type="button" style={link} onClick={() => open("deal", x.id)}>{x.name}</button> <span style={{ opacity: 0.7 }}>· {x.stage_name}{x.met ? " · met" : ""}{x.won_at ? " · won" : ""}</span></div>)}</div> : null}
  </section>;
}

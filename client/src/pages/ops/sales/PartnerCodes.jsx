// ONBOARD-4 item 3 · Sales settings → Partner codes. A code makes /book?partner=<code> say
// "Recommended by <name>" and tags the deal, so the give-back fund can count bookings by market.
// Code, name and market only: no commission (payout terms are SALES-1's Partners tab).
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { card, h2, says, btn, box, link, brassTag } from "./salesBits";

export default function PartnerCodes() {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ code: "", name: "", market: "" });
  const [msg, setMsg] = useState(null);
  const load = () => apiFetch("/ops/sales/partner-codes").then(r => setList(r.partners)).catch(() => setList(false));
  useEffect(() => { load(); }, []);
  const add = async () => {
    setMsg(null);
    try { const r = await apiFetch("/ops/sales/partner-codes", { method: "POST", body: JSON.stringify(f) }); setF({ code: "", name: "", market: "" }); setMsg(`Added. The link is www.stewardapp.dev${r.link}`); load(); }
    catch (e) { setMsg(e.message || "Not added."); }
  };
  const remove = async code => { setMsg(null); try { await apiFetch(`/ops/sales/partner-codes/${encodeURIComponent(code)}`, { method: "DELETE" }); setMsg(`Removed ${code}. Its link now books without a partner.`); load(); } catch (e) { setMsg(e.message || "Not removed."); } };
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  return <section style={card} data-sales-partner-codes="1">
    <h2 style={h2}>Partner codes</h2>
    <p style={says}>A partner's link is www.stewardapp.dev/book?partner=&lt;code&gt;. The booking page then says "Recommended by" the name, and the deal is tagged with the code and its market. Bookings counts the forms sent with each code.</p>
    {list === false ? <p style={says}>The codes could not be read.</p> : null}
    {list && list.length ? <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 10 }}>
      <thead><tr style={{ textAlign: "left", opacity: 0.7 }}><th>Code</th><th>Name</th><th>Market</th><th style={{ textAlign: "right" }}>Bookings</th><th></th></tr></thead>
      <tbody>{list.map(p => <tr key={p.code} data-partner-code={p.code}><td>{p.code}</td><td>{p.name}</td><td>{p.market}</td><td style={{ textAlign: "right" }}>{p.bookings}</td>
        <td style={{ textAlign: "right" }}><button type="button" style={{ ...link, fontSize: 12 }} onClick={() => remove(p.code)}>Remove</button></td></tr>)}</tbody>
    </table> : list ? <p style={says}>No partner codes yet.</p> : null}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input value={f.code} onChange={set("code")} placeholder="code, like mi-gulf-coast" aria-label="Code" style={box} data-partner-code-input="code" />
      <input value={f.name} onChange={set("name")} placeholder="Name, as the page shows it" aria-label="Name" style={{ ...box, minWidth: 200 }} data-partner-code-input="name" />
      <input value={f.market} onChange={set("market")} placeholder="Market, like Gulf Coast" aria-label="Market" style={box} data-partner-code-input="market" />
      <button type="button" style={btn} onClick={add} data-partner-code-add="1">Add the code</button>
    </div>
    {msg ? <p style={{ ...says, opacity: 1, marginTop: 8 }}>{/^(Added|Removed)/.test(msg) ? msg : <><span style={brassTag}>Not done</span> {msg}</>}</p> : null}
  </section>;
}

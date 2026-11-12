// SALES-2 item 8 · /refer/:token, a partner's private referral page. Steward's look, the
// partner's name ("Referred by …") and a short form, and nothing else: it never shows the
// partner (or anyone holding the link) any other deal. A hidden field catches bots. Nothing is
// emailed to anyone; the referral lands in Steward's own sales CRM for Jonathan to call.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const box = { fontSize: 15, padding: "10px 12px", border: `1px solid ${INK}33`, borderRadius: 8, fontFamily: "inherit", width: "100%", boxSizing: "border-box", background: WHITE, color: INK };
const lab = { display: "block", fontSize: 13, fontWeight: 700, margin: "12px 0 4px" };

export default function ReferralPage() {
  const { token } = useParams();
  const [who, setWho] = useState(null);   // { partner } | { missing: true }
  const [f, setF] = useState({ orgName: "", contactName: "", email: "", phone: "", note: "", website: "" });
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API}/public/referral/${encodeURIComponent(token)}`).then(r => r.json().then(b => (r.ok ? setWho(b) : setWho({ missing: true, message: b.message })))).catch(() => setWho({ missing: true }));
  }, [token]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const send = async e => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/public/referral/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const b = await r.json().catch(() => ({}));
      if (r.ok) setDone(b.message || "Thank you."); else setErr(b.message || "That didn't go through. Try again in a minute.");
    } catch { setErr("That didn't go through. Try again in a minute."); }
    setBusy(false);
  };
  return <main style={{ minHeight: "100vh", background: CREAM, color: INK, fontFamily: "'DM Sans',system-ui,sans-serif", padding: "40px 16px", boxSizing: "border-box" }} data-referral-page="1">
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, marginBottom: 18 }}>Steward</div>
      <section style={{ background: WHITE, borderRadius: 14, padding: "22px 22px 26px", border: `1px solid ${INK}14` }}>
        {!who ? <p>Loading…</p> : who.missing ? <p data-referral-missing="1">{who.message || "This referral link isn't working. Ask the person who sent it for a new one."}</p>
          : done ? <div data-referral-done="1"><h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Thank you</h1><p style={{ fontSize: 15, lineHeight: 1.5 }}>{done}</p></div>
          : <form onSubmit={send}>
            <div style={{ fontSize: 13, fontWeight: 700, color: EMERALD }} data-referral-by="1">{who.says}</div>
            <h1 style={{ fontSize: 22, margin: "6px 0 6px" }}>Introduce a nonprofit to Steward</h1>
            <p style={{ fontSize: 14.5, lineHeight: 1.5, opacity: 0.8, margin: 0 }}>Steward helps small nonprofits keep their donors giving. Tell us who to talk to, and Jonathan will reach out personally. Nobody is added to a mailing list.</p>
            <label style={lab} htmlFor="r-org">Organization</label>
            <input id="r-org" value={f.orgName} onChange={e => set("orgName", e.target.value)} style={box} required data-referral-org="1" />
            <label style={lab} htmlFor="r-name">Who to talk to</label>
            <input id="r-name" value={f.contactName} onChange={e => set("contactName", e.target.value)} style={box} required data-referral-name="1" />
            <label style={lab} htmlFor="r-email">Their email</label>
            <input id="r-email" type="email" value={f.email} onChange={e => set("email", e.target.value)} style={box} required data-referral-email="1" />
            <label style={lab} htmlFor="r-phone">Their phone (optional)</label>
            <input id="r-phone" type="tel" value={f.phone} onChange={e => set("phone", e.target.value)} style={box} />
            <label style={lab} htmlFor="r-note">Anything Jonathan should know (optional)</label>
            <textarea id="r-note" value={f.note} onChange={e => set("note", e.target.value)} rows={3} style={box} />
            <div aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
              <label htmlFor="r-website">Website</label><input id="r-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set("website", e.target.value)} />
            </div>
            {err ? <p style={{ fontSize: 14, background: `${BRASS}33`, padding: "8px 10px", borderRadius: 8, marginTop: 12 }}>{err}</p> : null}
            <button type="submit" disabled={busy} style={{ marginTop: 18, width: "100%", fontSize: 16, fontWeight: 700, padding: "12px 16px", borderRadius: 10, border: 0, background: EMERALD, color: WHITE, cursor: "pointer", fontFamily: "inherit" }} data-referral-send="1">
              {busy ? "Sending…" : "Send the introduction"}</button>
          </form>}
      </section>
    </div>
  </main>;
}

// SALES-3 item 2 · /quote/:token, the private quote Jonathan sends himself. Steward's look,
// the organization's name, the plan, the price, the day billing starts, what's included and
// the customer agreement, then Accept and sign (typed name, title, a tick). After signing, an
// optional "Add a card now" through Stripe (setup mode: a card is saved, nothing is charged).
// The page shows this quote only; a replaced, expired or used link says so and nothing else.
// The text on screen is the text the server hashed; the signature sends that hash back.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const box = { fontSize: 15, padding: "10px 12px", border: `1px solid ${INK}33`, borderRadius: 8, fontFamily: "inherit", width: "100%", boxSizing: "border-box", background: WHITE, color: INK };
const lab = { display: "block", fontSize: 13, fontWeight: 700, margin: "12px 0 4px" };
const go = { marginTop: 18, width: "100%", fontSize: 16, fontWeight: 700, padding: "12px 16px", borderRadius: 10, border: 0, background: EMERALD, color: WHITE, cursor: "pointer", fontFamily: "inherit" };
const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });

function Text({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p.replace(/`/g, "")}</span>));
  return <div style={{ fontSize: 14, lineHeight: 1.6 }} data-quote-text="1">{String(text).split(/\n\s*\n/).map((para, i) => {
    const t = para.trim();
    if (!t) return null;
    if (t === "---") return <hr key={i} style={{ border: 0, borderTop: `1px solid ${INK}1f`, margin: "18px 0" }} />;
    if (t.startsWith("# ")) return <h2 key={i} style={{ fontSize: 20, margin: "8px 0 8px" }}>{t.slice(2)}</h2>;
    if (t.startsWith("## ")) return <h3 key={i} style={{ fontSize: 15, margin: "16px 0 6px" }}>{t.slice(3)}</h3>;
    if (/^- /m.test(t) && t.split("\n").every(l => /^- /.test(l.trim()))) return <ul key={i} style={{ margin: "0 0 10px", paddingLeft: 20 }}>{t.split("\n").map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}</ul>;
    return <p key={i} style={{ margin: "0 0 10px" }}>{inline(t.replace(/\s*\n\s*/g, " "))}</p>;
  })}</div>;
}

export default function QuotePage() {
  const { token } = useParams();
  const [q, setQ] = useState(null);
  const [f, setF] = useState({ name: "", title: "", agree: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const url = `${API}/public/quote/${encodeURIComponent(token)}`;
  const read = () => fetch(url).then(r => r.json().then(b => setQ(r.ok ? b : { gone: true, message: b.message }))).catch(() => setQ({ gone: true }));
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("card") === "done" && p.get("session_id")) {
      fetch(`${url}/card/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: p.get("session_id") }) }).finally(read);
    } else read();
  }, [token]);   // eslint-disable-line react-hooks/exhaustive-deps
  const post = async (path, body) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const b = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) { setErr(b.message || "That didn't go through. Try again in a minute."); return null; }
      return b;
    } catch { setBusy(false); setErr("That didn't go through. Try again in a minute."); return null; }
  };
  const sign = async e => {
    e.preventDefault();
    const b = await post("/accept", { ...f, sha256: q.agreement.sha256 });
    if (b) read();
  };
  const card = async () => { const b = await post("/card"); if (b && b.url) window.location.assign(b.url); };

  return <main style={{ minHeight: "100vh", background: CREAM, color: INK, fontFamily: "'DM Sans',system-ui,sans-serif", padding: "40px 16px", boxSizing: "border-box" }} data-quote-page="1">
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, marginBottom: 18 }}>Steward</div>
      <section style={{ background: WHITE, borderRadius: 14, padding: "22px 22px 26px", border: `1px solid ${INK}14` }}>
        {!q ? <p>Loading…</p>
          : q.gone ? <p data-quote-gone="1">{q.message || "This quote link isn't working. Ask Jonathan for a new one."}</p>
          : q.state === "accepted" ? <div data-quote-signed="1">
            <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Thank you, {q.orgName}</h1>
            <p style={{ fontSize: 15, lineHeight: 1.5 }} data-quote-confirmation="1">{q.confirmation}</p>
            {q.cardSaved ? <p style={{ fontSize: 15 }} data-quote-card-saved="1">{q.card ? `${q.card} is saved.` : "Your card is saved."} Nothing has been charged.</p>
              : q.canAddCard ? <div style={{ background: CREAM, borderRadius: 10, padding: "12px 14px", marginTop: 12 }}>
                <b>Add a card now (optional)</b>
                <p style={{ fontSize: 14, lineHeight: 1.5, margin: "6px 0 0" }}>Stripe saves the card for the first charge on the day billing starts. Nothing is charged today. You can also add it later in Settings → Billing.</p>
                <button type="button" style={{ ...go, marginTop: 10 }} disabled={busy} onClick={card} data-quote-card="1">{busy ? "Opening Stripe…" : "Add a card"}</button></div>
              : <p style={{ fontSize: 14, opacity: 0.8 }}>Jonathan will set up the card with you; nothing is charged before billing starts.</p>}
            {err ? <p style={{ fontSize: 14, background: `${BRASS}33`, padding: "8px 10px", borderRadius: 8, marginTop: 12 }}>{err}</p> : null}
          </div>
          : <form onSubmit={sign}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, background: CREAM, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }} data-quote-summary="1">
              <div><div style={{ fontSize: 12, opacity: 0.7 }}>Plan</div><b>{q.plan}</b></div>
              <div><div style={{ fontSize: 12, opacity: 0.7 }}>Price</div><b data-quote-price="1">{usd(q.priceCents)} a month</b></div>
              <div><div style={{ fontSize: 12, opacity: 0.7 }}>Billing starts</div><b data-quote-start="1">{q.startWords}</b></div>
              <div><div style={{ fontSize: 12, opacity: 0.7 }}>Setup fee</div><b>{q.setupFeeCents ? `${usd(q.setupFeeCents)}, with the first charge` : "None"}</b></div>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto", border: `1px solid ${INK}14`, borderRadius: 10, padding: "4px 14px" }}><Text text={q.agreement.text} /></div>
            <label style={lab} htmlFor="q-name">Your full name</label>
            <input id="q-name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} style={box} required autoComplete="name" data-quote-name="1" />
            <label style={lab} htmlFor="q-title">Your title</label>
            <input id="q-title" value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} style={box} required autoComplete="organization-title" data-quote-title="1" />
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, marginTop: 12 }}>
              <input type="checkbox" checked={f.agree} onChange={e => setF(x => ({ ...x, agree: e.target.checked }))} style={{ marginTop: 3 }} data-quote-agree="1" />
              <span>I agree to this quote and the customer agreement above, for {q.orgName}. Typing my name is my signature.</span></label>
            {err ? <p style={{ fontSize: 14, background: `${BRASS}33`, padding: "8px 10px", borderRadius: 8, marginTop: 12 }} data-quote-err="1">{err}</p> : null}
            <button type="submit" style={go} disabled={busy || !f.agree} data-quote-accept="1">{busy ? "Signing…" : "Accept and sign"}</button>
            <p style={{ fontSize: 12.5, opacity: 0.7, marginTop: 8 }}>The time you sign and your connection's address are kept with your signature. Nothing is charged today.</p>
          </form>}
      </section>
    </div>
  </main>;
}

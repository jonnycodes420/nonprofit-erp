// ONBOARD-1 · /start/:token — the start link for an organization that already
// exists. One page: the org's name and logo, the one-page order form with its
// price and first charge date filled in, a typed name, title and "I agree",
// then Stripe Checkout to save the card. Nothing is charged today.
//
// The text on screen is exactly the text the server hashed: the page sends
// that hash back with the signature, and the server refuses a mismatch.
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

const C = { ink: "#0F1A12", white: "#FFFFFF", cream: "#F0EDE6", emerald: "#0D5C3A", brass: "#C9A84C", muted: "#5a554f" };
const SERIF = "'DM Serif Display',Georgia,serif";
const lbl = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 };
const inp = { padding: "10px 12px", border: "1px solid #ddd9d0", borderRadius: 8, fontSize: 15, fontFamily: "inherit", background: "#FFFFFF", color: "#0F1A12" };
const btn = disabled => ({ background: "#0D5C3A", opacity: disabled ? 0.55 : 1, color: "#FFFFFF", border: 0, borderRadius: 8, padding: "12px 18px",
  fontSize: 15, fontWeight: 600, cursor: disabled ? "default" : "pointer", fontFamily: "inherit" });

// The order form is a few headings, bold runs and paragraphs. Rendered here
// from the same bytes the server hashed; nothing is added or dropped.
function Agreement({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);
  return (
    <div data-testid="start-agreement" style={{ fontSize: 14.5, lineHeight: 1.6, color: C.ink }}>
      {String(text).split(/\n\s*\n/).map((para, i) => {
        const t = para.replace(/\s*\n\s*/g, " ").trim();
        if (!t) return null;
        if (t.startsWith("# ")) return <h1 key={i} style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: "0 0 12px" }}>{t.slice(2)}</h1>;
        if (t.startsWith("## ")) return <h2 key={i} style={{ fontSize: 15, fontWeight: 700, margin: "20px 0 6px" }}>{t.slice(3)}</h2>;
        return <p key={i} style={{ margin: "0 0 10px" }}>{inline(t)}</p>;
      })}
    </div>
  );
}

export default function StartPage() {
  const { token } = useParams();
  const done = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("done") === "1";
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);

  useEffect(() => {
    apiFetch(`/public/start/${encodeURIComponent(token)}`)
      .then(d => { setData(d); setName(d.contactName || ""); })
      .catch(e => setErr((e && e.message) || "This start link could not be opened."));
  }, [token]);

  async function sign(e) {
    e.preventDefault();
    setFormErr(null); setBusy(true);
    try {
      const r = await apiFetch(`/public/start/${encodeURIComponent(token)}/sign`, {
        method: "POST", body: JSON.stringify({ name, title, agree, sha256: data.agreement.sha256 }),
      });
      if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
    } catch (e2) {
      if (e2 && e2.error === "agreement_changed" && e2.agreement) setData(d => ({ ...d, agreement: e2.agreement }));
      setFormErr((e2 && e2.message) || "That did not go through. Try again.");
      setBusy(false);
    }
  }
  // After signing, the card step again (a closed Checkout tab must not cost her it).
  async function resumeCard() {
    setBusy(true); setFormErr(null);
    try { const r = await apiFetch(`/public/start/${encodeURIComponent(token)}/sign`, { method: "POST", body: "{}" }); if (r.checkoutUrl) window.location.assign(r.checkoutUrl); }
    catch (e2) { setFormErr((e2 && e2.message) || "That did not go through."); setBusy(false); }
  }

  const page = children => (
    <div style={{ minHeight: "100vh", background: C.cream, fontFamily: "'DM Sans',system-ui,sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 16px 64px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 21, marginBottom: 20 }}>Steward</div>
        {children}
      </div>
    </div>
  );
  const card = { background: C.white, borderRadius: 12, padding: "24px 24px", boxShadow: "0 1px 2px rgba(15,26,18,0.08)" };

  if (err) return page(<div style={card} data-testid="start-error"><h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: "0 0 8px" }}>This link can't be used</h1><p style={{ margin: 0 }}>{err}</p></div>);
  if (!data) return page(<div style={card}>Opening…</div>);

  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
      {data.logo ? <img src={data.logo} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 8, background: C.white }} /> : null}
      <div>
        <div style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.15 }} data-testid="start-org-name">{data.orgName}</div>
        <div style={{ fontSize: 13, color: C.muted }}>Start Steward: sign the order form, then save a card. Nothing is charged today.</div>
      </div>
    </div>
  );

  if (data.state === "completed" || (data.state === "signed" && done)) {
    return page(<>{head}<div style={card} data-testid="start-confirmation">
      <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: "0 0 10px" }}>You're set</h1>
      <p style={{ fontSize: 16, margin: 0 }}>{data.confirmation}</p>
    </div></>);
  }
  if (data.state === "signed") {
    return page(<>{head}<div style={card} data-testid="start-signed">
      <p style={{ margin: "0 0 14px" }}>The order form is signed. One step left: save a card. {data.confirmation}</p>
      <button onClick={resumeCard} disabled={busy} style={btn(busy)}>{busy ? "Opening…" : "Save a card"}</button>
      {formErr ? <p role="alert" style={{ color: C.ink, marginTop: 10 }}>{formErr}</p> : null}
    </div></>);
  }

  return page(<>
    {head}
    <div style={card}><Agreement text={data.agreement.text} /></div>
    <form onSubmit={sign} style={{ ...card, marginTop: 14 }} data-testid="start-sign-form">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={lbl}>Your full name<input data-testid="start-name" value={name} onChange={e => setName(e.target.value)} required style={inp} autoComplete="name" /></label>
        <label style={lbl}>Your title<input data-testid="start-title" value={title} onChange={e => setTitle(e.target.value)} required style={inp} placeholder="Executive Director" autoComplete="organization-title" /></label>
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "16px 0", fontSize: 14 }}>
        <input type="checkbox" data-testid="start-agree" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I agree to this order form for {data.orgName}, and I'm authorised to sign it.</span>
      </label>
      <button type="submit" data-testid="start-submit" disabled={busy || !agree || !name.trim() || !title.trim()} style={btn(busy || !agree || !name.trim() || !title.trim())}>
        {busy ? "Signing…" : "I agree, save a card"}
      </button>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 0" }}>Next is Stripe's secure card page. Nothing is charged today. First charge: {data.firstChargeDate}{data.priceUsd > 0 ? `, $${Number(data.priceUsd).toLocaleString("en-US")}` : ""}.</p>
      {formErr ? <p role="alert" data-testid="start-form-error" style={{ color: C.ink, fontWeight: 600, marginTop: 10 }}>{formErr}</p> : null}
    </form>
  </>);
}

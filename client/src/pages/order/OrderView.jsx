// ORDER-1 · the order on the close link (/start/:token when the link carries an order).
// Jonathan approved the mockup on 24 Nov 2026: steps across the top, who it's for, what
// you're getting, the short version of the terms, then Sign. After signing, the card
// (Stripe, nothing charged today), then the setup call.
//
// Every word and figure in the order cards is the server's snapshot, shown as it came;
// the page sends back the snapshot's hash with the signature, and the server refuses a
// mismatch (an order Jonathan edited, or a page left open past midnight, reloads).
import { useState } from "react";
import { apiFetch, API } from "../../api";
import { SlotPicker } from "../../marketing/booking/slots";

const C = { ink: "#0F1A12", white: "#FFFFFF", cream: "#F0EDE6", em: "#0D5C3A", brass: "#C9A84C" };
const DIM = "rgba(15,26,18,.62)", LINE = "rgba(15,26,18,.12)";
const SERIF = "'DM Serif Display',Georgia,serif";
const SIG_FACE = "'Brush Script MT','Segoe Script','Snell Roundhand',cursive";

const S = {
  page: { minHeight: "100vh", background: C.cream, color: C.ink, fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: 15, lineHeight: 1.55 },
  bar: { background: C.ink, color: C.white, padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  wrap: { maxWidth: 760, margin: "0 auto", padding: "28px 16px 60px", boxSizing: "border-box" },
  card: { background: C.white, border: `1px solid ${LINE}`, borderRadius: 14, padding: "22px 22px", marginBottom: 16, boxSizing: "border-box" },
  label: { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700, color: DIM },
  h1: { fontFamily: SERIF, fontWeight: 400, fontSize: 30, margin: "0 0 4px", lineHeight: 1.15 },
  lead: { color: DIM, margin: "0 0 20px" },
  input: { width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, borderRadius: 9, padding: "11px 12px", font: "inherit", color: C.ink, background: C.white },
  btn: off => ({ display: "block", width: "100%", background: C.em, color: C.white, border: 0, borderRadius: 11, padding: 15, font: "inherit",
    fontWeight: 700, fontSize: 16, marginTop: 18, cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.45 : 1 }),
  fine: { fontSize: 12.5, color: DIM, marginTop: 10, textAlign: "center" },
};

function Steps({ at }) {
  const names = ["Your details", "Review and sign", "Card on file", "Book your setup"];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }} data-order-steps={at}>
      {names.map((n, i) => {
        const done = i + 1 < at, on = i + 1 === at;
        return <div key={n} aria-current={on ? "step" : undefined} style={{ flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: 600, paddingTop: 8,
          color: on ? C.em : done ? C.ink : DIM, borderTop: `3px solid ${on ? C.em : done ? C.ink : LINE}` }}>{i + 1} · {n}</div>;
      })}
    </div>
  );
}

function Who({ s }) {
  const cell = (k, v, id) => <div><span style={{ ...S.label, fontSize: 10 }}>{k}</span><b style={{ display: "block", fontSize: 15, overflowWrap: "anywhere" }} data-order-field={id}>{v}</b></div>;
  return (
    <div style={S.card}>
      <div style={S.label}>Who this is for</div>
      <div className="order-grid" style={{ display: "grid", gap: "14px 24px", marginTop: 10 }}>
        {cell("Organization", s.orgName, "org")}
        {cell("Signing for the organization", `${s.signer.name}${s.signer.title ? `, ${s.signer.title}` : ""}`, "signer")}
        {cell("Billing email", s.billingEmail, "billing-email")}
        {cell("Order", s.orderNumber, "number")}
      </div>
    </div>
  );
}

function Lines({ s }) {
  const td = { padding: "11px 0", borderTop: `1px solid ${LINE}`, verticalAlign: "top" };
  const row = (l, total) => (
    <tr key={l.key} data-order-line={l.key}>
      <td style={{ ...td, ...(total ? { borderTop: `2px solid ${C.ink}`, fontSize: 16 } : {}) }}>
        {total ? <b>{l.label}</b> : l.label}<small style={{ display: "block", color: DIM, fontSize: 12.5 }}>{l.detail}</small>
      </td>
      <td style={{ ...td, ...(total ? { borderTop: `2px solid ${C.ink}`, fontSize: 16 } : {}), textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", paddingLeft: 12 }} data-order-amount={l.key}>{l.amount}</td>
    </tr>
  );
  return (
    <div style={S.card}>
      <div style={S.label}>What you're getting</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}><tbody>
        {s.lines.map(l => row(l, false))}
        {row(s.total, true)}
      </tbody></table>
      {s.note ? <div style={{ background: C.cream, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, marginTop: 14 }} data-order-note="1">{s.note}</div> : null}
    </div>
  );
}

function Terms({ s, pdfUrl }) {
  return (
    <div style={{ ...S.card, fontSize: 14 }}>
      <div style={S.label}>The short version of the terms</div>
      <ul style={{ paddingLeft: 20, margin: "10px 0" }}>{s.shortTerms.map(t => <li key={t} style={{ margin: "4px 0" }}>{t}</li>)}</ul>
      <a href="/terms" target="_blank" rel="noreferrer" style={{ color: C.em }}>Read the full Terms of Service</a>{" · "}
      <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: C.em }}>Privacy Policy</a>{" · "}
      <a href={pdfUrl} style={{ color: C.em }} data-order-pdf="1">Download this order as a PDF</a>
    </div>
  );
}

export default function OrderView({ token, data, setData, done }) {
  const order = data.order;
  const s = order.snapshot;
  const [name, setName] = useState(s.signer.name || "");
  const [title, setTitle] = useState(s.signer.title || "");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pdfUrl = `${API}/public/start/${encodeURIComponent(token)}/order.pdf`;
  const ready = agree && name.trim().length >= 2 && title.trim().length > 0;

  async function sign(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/public/start/${encodeURIComponent(token)}/sign`, { method: "POST", body: JSON.stringify({ name, title, agree, sha256: order.sha256 }) });
      if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
      else { setData(d => ({ ...d, state: r.completed ? "completed" : "signed", confirmation: r.confirmation, order: { ...d.order, signed: r.signed } })); setBusy(false); window.scrollTo(0, 0); }
    } catch (e2) {
      if (e2 && e2.error === "order_changed" && e2.order) { setData(d => ({ ...d, order: e2.order })); setAgree(false); window.scrollTo(0, 0); }
      setErr((e2 && e2.message) || "That didn't go through. Try again.");
      setBusy(false);
    }
  }
  async function card() {
    setBusy(true); setErr(null);
    try { const r = await apiFetch(`/public/start/${encodeURIComponent(token)}/sign`, { method: "POST", body: "{}" }); if (r.checkoutUrl) window.location.assign(r.checkoutUrl); }
    catch (e2) { setErr((e2 && e2.message) || "That didn't go through."); setBusy(false); }
  }

  const step = data.state === "completed" || (data.state === "signed" && done) ? 4 : data.state === "signed" ? 3 : 2;
  const signed = order.signed;
  const stampCard = signed ? (
    <div style={S.card} data-order-signed="1">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", background: C.em, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flex: "none" }}>✓</div>
        <div><b>{signed.stamp}.</b><br /><span style={{ color: DIM, fontSize: 14 }}>
          {signed.copySent ? `A signed copy is on its way to ${signed.email}.` : <>Keep a copy: <a href={pdfUrl} style={{ color: C.em }}>download the signed order</a>.</>}</span></div>
      </div>
    </div>
  ) : null;

  return (
    <div style={S.page}>
      <style>{`.order-grid{grid-template-columns:1fr 1fr}.order-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media (max-width:600px){.order-grid,.order-two{grid-template-columns:1fr}}`}</style>
      <div style={S.bar}>
        <div style={{ fontFamily: SERIF, fontSize: 22 }}>Steward</div>
        <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.75 }}>Secure · Prepared for {s.orgName}</div>
      </div>
      <div style={S.wrap}>
        <Steps at={step} />
        {step === 2 ? <form onSubmit={sign} data-order-form="1">
          <h1 style={S.h1}>Your Steward order</h1>
          <p style={S.lead}>Prepared by {s.preparedBy} on {s.preparedOn}. Read it, sign it, and you're one step from getting set up.</p>
          {order.updatedOn ? <div role="status" style={{ ...S.card, borderColor: C.brass, borderWidth: 2 }} data-order-updated="1">
            <b>This order was updated on {order.updatedOn}.</b> Read it again and sign this version.</div> : null}
          <Who s={s} />
          <Lines s={s} />
          <Terms s={s} pdfUrl={pdfUrl} />
          <div style={S.card}>
            <div style={S.label}>Sign</div>
            <div className="order-two">
              <div style={{ marginTop: 12 }}><label htmlFor="order-name" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 5 }}>Full name</label>
                <input id="order-name" style={S.input} value={name} onChange={e => setName(e.target.value)} autoComplete="name" data-order-input="name" /></div>
              <div style={{ marginTop: 12 }}><label htmlFor="order-title" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 5 }}>Title</label>
                <input id="order-title" style={S.input} value={title} onChange={e => setTitle(e.target.value)} autoComplete="organization-title" data-order-input="title" /></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Your signature</div>
              <div aria-label={`Signature: ${name}`} data-order-signature="1" style={{ fontFamily: SIG_FACE, fontSize: 30, color: C.ink, borderBottom: `1.5px solid ${C.ink}`, padding: "6px 2px", minHeight: 52, boxSizing: "border-box", overflowWrap: "anywhere" }}>{name}</div>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 14 }}>
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: C.em, flex: "none" }} data-order-input="agree" />
              <span>I'm authorized to sign for {s.orgName}, and I agree to this order and the Terms of Service.</span>
            </label>
            <button type="submit" disabled={!ready || busy} style={S.btn(!ready || busy)} data-order-submit="1">{busy ? "Signing…" : "Sign and continue to card"}</button>
            <div style={S.fine}>We'll email you a signed copy. Your card isn't charged today.</div>
            {err ? <p role="alert" style={{ fontWeight: 600, marginTop: 10 }} data-order-error="1">{err}</p> : null}
          </div>
        </form> : null}

        {step === 3 ? <div data-order-card-step="1">
          {stampCard}
          <h1 style={S.h1}>Card on file</h1>
          <p style={S.lead}>Nothing is charged until {s.figures.firstChargeOn}.</p>
          <div style={S.card}>
            <div style={S.label}>Card</div>
            <p style={{ margin: "10px 0 0" }}>Stripe's secure card page opens next. {s.total.label}: {s.total.amount}. Cancel any time before then in Settings and you pay nothing.</p>
            <button type="button" onClick={card} disabled={busy} style={S.btn(busy)} data-order-card="1">{busy ? "Opening…" : "Save card and book setup"}</button>
            {err ? <p role="alert" style={{ fontWeight: 600, marginTop: 10 }}>{err}</p> : null}
          </div>
        </div> : null}

        {step === 4 ? <div data-order-book-step="1">
          {stampCard}
          <h1 style={S.h1}>Book your setup</h1>
          <p style={S.lead}>Your card is on file. Nothing is charged until {s.figures.firstChargeOn}. Pick a time and Jonathan sets Steward up with you.</p>
          <div style={S.card}><SlotPicker name={signed ? signed.name : s.signer.name} email={signed ? signed.email : s.billingEmail} /></div>
        </div> : null}
      </div>
    </div>
  );
}

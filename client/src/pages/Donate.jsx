import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";

const T = {
  bg: "#f0ede6", bg2: "#e8e4db", bg3: "#e8e2d9",
  white: "#faf8f4", ink: "#1a1a1a", ink2: "#2a2a2a", ink3: "#6b6b6b",
  green: "#10b981", greenDk: "#1a6b4a",
};

const PRESETS = [25, 50, 100, 250, 500];

const inp = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: "1px solid " + T.bg3,
  borderRadius: 10, padding: "11px 14px",
  color: T.ink, fontSize: 14, outline: "none", fontFamily: "inherit",
};

export default function Donate() {
  const { orgSlug } = useParams();
  const [org, setOrg] = useState(null);
  const [funds, setFunds] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [donated, setDonated] = useState(false);

  const [preset, setPreset] = useState(100);
  const [customAmt, setCustomAmt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [fundId, setFundId] = useState("");
  const [frequency, setFrequency] = useState("one-time");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("donated") === "true") {
      setDonated(true);
      window.history.replaceState({}, "", `/give/${orgSlug}`);
    }
    fetch(`${API}/org/${orgSlug}/public`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setPageError(d.error); }
        else { setOrg(d.org); setFunds(d.funds || []); }
        setPageLoading(false);
      })
      .catch(() => { setPageError("Could not load this donation page."); setPageLoading(false); });
  }, [orgSlug]);

  const effectiveAmount = isCustom ? parseFloat(customAmt) || 0 : preset;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setSubmitErr("Please fill in your name and email."); return;
    }
    if (effectiveAmount < 1) { setSubmitErr("Please enter a valid amount."); return; }
    setSubmitting(true); setSubmitErr("");
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount, fundId, frequency, firstName, lastName, email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Something went wrong.");
      window.location.href = data.url;
    } catch (e) {
      setSubmitErr(e.message);
      setSubmitting(false);
    }
  };

  const isEmbed = window.self !== window.top;

  const BASE = {
    minHeight: "100vh", background: T.bg,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: isEmbed ? "20px 16px 40px" : "40px 16px 80px",
  };

  if (pageLoading) return (
    <div style={{ ...BASE, justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 32, height: 32, border: "3px solid " + T.bg3, borderTopColor: T.greenDk, borderRadius: "50%", animation: "sp 0.7s linear infinite" }} />
    </div>
  );

  if (pageError) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.2 }}>◈</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Page not found</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{pageError}</div>
    </div>
  );

  if (donated) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 64, height: 64, background: T.greenDk, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 28, color: "#fff" }}>✓</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.ink, marginBottom: 10, fontFamily: "'DM Serif Display', serif" }}>
        Thank you!
      </div>
      <div style={{ fontSize: 16, color: T.ink2, marginBottom: 6 }}>
        Your gift to <strong>{org.name}</strong> has been received.
      </div>
      <div style={{ fontSize: 14, color: T.ink3, maxWidth: 360, lineHeight: 1.6 }}>
        A receipt will be sent to your email. Thank you for your generosity — it makes a real difference.
      </div>
    </div>
  );

  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>

      {/* Header — hidden when embedded in an iframe */}
      {!isEmbed && (
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ width: 48, height: 48, background: T.greenDk, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif", letterSpacing: "-0.02em" }}>
            Give to {org.name}
          </h1>
          {org.mission && (
            <p style={{ margin: "8px 0 0", fontSize: 14, color: T.ink3, maxWidth: 400, lineHeight: 1.6 }}>{org.mission}</p>
          )}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Amount */}
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Donation Amount</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 12 }}>
            {PRESETS.map(p => (
              <button key={p} type="button"
                onClick={() => { setPreset(p); setIsCustom(false); setCustomAmt(""); }}
                style={{
                  background: !isCustom && preset === p ? T.greenDk : T.bg,
                  border: `1.5px solid ${!isCustom && preset === p ? T.greenDk : T.bg3}`,
                  borderRadius: 10, padding: "11px 4px",
                  color: !isCustom && preset === p ? "#fff" : T.ink2,
                  fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
                }}>
                ${p}
              </button>
            ))}
          </div>
          <input
            type="number" placeholder="Custom amount ($)"
            value={customAmt}
            onChange={e => { setCustomAmt(e.target.value); setIsCustom(true); }}
            onFocus={() => setIsCustom(true)}
            style={{
              ...inp,
              border: `1.5px solid ${isCustom ? T.greenDk : T.bg3}`,
              fontWeight: 700, fontSize: 16,
            }}
            min="1" step="1"
          />
        </div>

        {/* Frequency */}
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Frequency</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[["one-time", "One-time"], ["monthly", "Monthly"], ["annual", "Annual"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setFrequency(v)}
                style={{
                  background: frequency === v ? T.greenDk : T.bg,
                  border: `1.5px solid ${frequency === v ? T.greenDk : T.bg3}`,
                  borderRadius: 10, padding: "11px 8px",
                  color: frequency === v ? "#fff" : T.ink2,
                  fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
                }}>
                {l}
              </button>
            ))}
          </div>
          {frequency !== "one-time" && (
            <div style={{ marginTop: 10, fontSize: 12, color: T.ink3, background: T.greenDk + "10", border: "1px solid " + T.greenDk + "25", borderRadius: 8, padding: "8px 12px" }}>
              You'll be charged <strong>${effectiveAmount.toFixed(2)}</strong> {frequency === "monthly" ? "each month" : "each year"} until you cancel.
            </div>
          )}
        </div>

        {/* Fund selector */}
        {funds.length > 0 && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 24px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Designate My Gift (optional)</div>
            <select value={fundId} onChange={e => setFundId(e.target.value)}
              style={{ ...inp, cursor: "pointer" }}>
              <option value="">Where it's needed most</option>
              {funds.map(f => (
                <option key={f.id} value={f.id}>{f.name}{f.restricted ? " (Restricted)" : ""}</option>
              ))}
            </select>
          </div>
        )}

        {/* Contact info */}
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Your Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={inp} required />
            <input placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={inp} required />
          </div>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={inp} required />
        </div>

        {submitErr && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{submitErr}</div>
        )}

        <button type="submit" disabled={submitting}
          style={{
            background: submitting ? T.bg3 : T.greenDk,
            border: "none", borderRadius: 14, padding: "16px",
            color: "#fff", fontSize: 16, fontWeight: 800,
            cursor: submitting ? "not-allowed" : "pointer",
            letterSpacing: "-0.01em", transition: "background 0.15s",
            boxShadow: submitting ? "none" : "0 4px 20px rgba(26,107,74,0.3)",
          }}>
          {submitting ? "Redirecting to Stripe…" : `Give $${effectiveAmount > 0 ? effectiveAmount.toFixed(2) : "—"} ${frequency !== "one-time" ? `/ ${frequency === "monthly" ? "mo" : "yr"}` : ""}`}
        </button>

        <div style={{ textAlign: "center", fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
          Payments are processed securely by Stripe. {org.name} never stores your card details.
          <br />Powered by <span style={{ fontWeight: 700, color: T.greenDk }}>Steward</span>
        </div>
      </form>
    </div>
  );
}

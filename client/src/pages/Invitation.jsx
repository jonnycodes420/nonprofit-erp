import { useRef, useState } from "react";
import { API } from "../api";

// ── Request an invitation (invitation pivot, 2026-08-06) ─────────────────────
// Steward is invitation-only while the founding-partner group (five orgs) is
// being chosen. This module owns the ONE invitation form, rendered two ways:
//   - <InvitationSection/> — the full-width ink section on the landing page
//     (replaces the old founding-partner mailto ask)
//   - the default export — the standalone /invitation route the pricing page,
//     login page, and nav CTAs point to
// Design: a document, not a brochure. Ink field, cream type, one brass rule,
// centered 560px column, generous vertical space. NO photograph, NO CAPTCHA
// (honeypot + minimum-fill-time instead — the trust cost of a CAPTCHA is too
// high on a credibility page), no countdown, and never the word "waitlist" —
// this is choosing five organizations, not running a queue.
// All color values are the Steward palette (same set as Landing.jsx's C).

const C = {
  ink:   "#0f1a12",
  cream: "#f0ede6",
  cream2:"#e8e4db",
  white: "#ffffff",
  gold:  "#c9a84c",
  sage:  "#8fa896",
  greenDk: "#0d5c3a",
};

const DONOR_BANDS = ["Under 500", "500–2,500", "2,500–10,000", "More than 10,000"];

const inputStyle = {
  width: "100%", background: C.white, color: C.ink,
  border: `1px solid ${C.cream2}`, borderRadius: 6,
  padding: "14px 14px", fontSize: 16, fontFamily: "'DM Sans',system-ui,sans-serif",
  outline: "none", boxSizing: "border-box",
};
const labelStyle = {
  display: "block", fontSize: 14, color: C.cream, fontWeight: 600,
  marginBottom: 7, fontFamily: "'DM Sans',system-ui,sans-serif",
};

function Field({ label, children }) {
  // Labels are always ABOVE the field, never placeholder-only — this audience
  // skews older and placeholder-as-label is an accessibility failure.
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function InvitationSection({ headline }) {
  const [form, setForm] = useState({ name: "", email: "", organization: "", role: "", donorBand: "", hardestPart: "" });
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const mountedAt = useRef(Date.now());
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    setErr("");
    if (!form.name.trim() || !form.email.trim() || !form.organization.trim()) {
      setErr("Your name, email, and organization are all I need — the rest is optional.");
      return;
    }
    setSending(true);
    try {
      const r = await fetch(`${API}/invitation-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          website: honeypot,                       // honeypot — humans never see it
          elapsedMs: Date.now() - mountedAt.current, // timing check
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Something went wrong");
      setSent(true);
    } catch (ex) {
      setErr(ex.message === "Failed to fetch"
        ? "Couldn't reach the server — please try again, or write to jonathan@stewardapp.dev."
        : (ex.message || "Something went wrong — please try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="invitation" style={{ background: C.ink, padding: "128px 24px" }}>
      <style>{`
        .inv-input:focus { box-shadow: 0 0 0 2px ${C.gold}; border-color: ${C.gold} !important; }
        .inv-btn:hover { filter: brightness(1.05); }
        /* BUILD-40 P1: compress the section's desktop air at phone width.
           Inputs keep >=44px height and 16px type (no iOS zoom-on-focus). */
        @media (max-width: 768px) {
          #invitation { padding: 56px 22px !important; }
          #invitation form label { margin-bottom: 14px !important; }
          .inv-input { padding: 12px 13px !important; }
        }
      `}</style>
      <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{
          fontSize: 13, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase",
          color: C.gold, marginBottom: 18, fontFamily: "'DM Sans',system-ui,sans-serif",
        }}>
          Founding partners — five organizations
        </div>
        <h2 style={{
          fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400,
          fontSize: "clamp(34px, 4.4vw, 52px)", lineHeight: 1.12, color: C.cream, marginBottom: 26,
        }}>
          {headline || "Steward tells you who to call today, and what to say."}
        </h2>
        <div aria-hidden="true" style={{ width: 180, height: 3, background: C.gold, margin: "0 auto 28px" }} />
        <p style={{
          fontSize: 18, color: C.sage, lineHeight: 1.75, marginBottom: 14,
          fontFamily: "'DM Sans',system-ui,sans-serif",
        }}>
          I'm building it alongside five nonprofits before opening it more
          widely. Founding partners get their donors imported for them, a price
          locked for as long as they stay, and my direct line.
        </p>
        <p style={{ fontSize: 13.5, color: C.sage, marginBottom: 40, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
          Plans from <strong style={{ color: C.cream }}>$149/month</strong> when
          Steward opens in January — founding partners lock in below that.{" "}
          <a href="/pricing" style={{ color: C.cream, textDecoration: "underline", textUnderlineOffset: 3 }}>See pricing</a>
        </p>

        {sent ? (
          <div role="status" style={{ textAlign: "left", background: "rgba(240,237,230,0.04)", border: `1px solid ${C.gold}`, borderRadius: 10, padding: "30px 28px" }}>
            <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, color: C.cream, marginBottom: 12 }}>
              Thank you — that's with me.
            </div>
            <p style={{ fontSize: 15.5, color: C.sage, lineHeight: 1.75, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
              If your organization looks like a fit for the founding group,
              you'll hear from me within a few days. If it isn't the right
              moment, I'll tell you that honestly too.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} style={{ textAlign: "left" }} noValidate>
            {/* Honeypot — visually hidden, never announced, never tabbed to. */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off"
                  value={honeypot} onChange={e => setHoneypot(e.target.value)} />
              </label>
            </div>

            <Field label="Your name">
              <input className="inv-input" style={inputStyle} type="text" autoComplete="name" value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Email">
              <input className="inv-input" style={inputStyle} type="email" autoComplete="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Organization">
              <input className="inv-input" style={inputStyle} type="text" autoComplete="organization" value={form.organization} onChange={set("organization")} />
            </Field>
            <Field label="Your role">
              <input className="inv-input" style={inputStyle} type="text" autoComplete="organization-title" value={form.role} onChange={set("role")} />
            </Field>
            <Field label="Roughly how many donors are in your database?">
              <select className="inv-input" style={{ ...inputStyle, appearance: "auto" }} value={form.donorBand} onChange={set("donorBand")}>
                <option value="">Choose one…</option>
                {DONOR_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="What's the hardest part of keeping donors right now? (optional)">
              <textarea className="inv-input" rows={4} style={{ ...inputStyle, resize: "vertical" }} value={form.hardestPart} onChange={set("hardestPart")} />
            </Field>

            {err && (
              <p role="alert" style={{ fontSize: 14, color: "#e0a893", lineHeight: 1.6, marginBottom: 14, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
                {err}
              </p>
            )}

            <button type="submit" className="inv-btn" disabled={sending} style={{
              width: "100%", background: C.gold, color: C.ink, border: "none", borderRadius: 8,
              padding: "16px 20px", fontSize: 16, fontWeight: 800, cursor: sending ? "wait" : "pointer",
              fontFamily: "'DM Sans',system-ui,sans-serif",
            }}>
              {sending ? "Sending…" : "Request an invitation"}
            </button>
            <p style={{ fontSize: 14, color: C.sage, textAlign: "center", marginTop: 18, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
              I read every one of these myself. — Jonathan
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

export default function InvitationPage() {
  return (
    <div style={{ minHeight: "100vh", background: C.ink, display: "flex", flexDirection: "column" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet" />
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 60, borderBottom: "1px solid #1a2e1f" }}>
        <a href="/" style={{ textDecoration: "none" }}>
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: C.cream, letterSpacing: "-0.02em" }}>Steward</span>
        </a>
        <div style={{ display: "flex", gap: 20, alignItems: "center", fontFamily: "'DM Sans',system-ui,sans-serif" }}>
          <a href="/pricing" style={{ fontSize: 13, color: C.sage, textDecoration: "none" }}>Pricing</a>
          <a href="/login" style={{ fontSize: 13, color: C.sage, textDecoration: "none" }}>Log in</a>
        </div>
      </nav>
      <div style={{ flex: 1 }}>
        <InvitationSection />
      </div>
      <footer style={{ padding: "22px 32px", borderTop: "1px solid #1a2e1f", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: C.sage, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
          © 2026 Steward · <a href="mailto:jonathan@stewardapp.dev" style={{ color: C.sage }}>jonathan@stewardapp.dev</a>
        </span>
      </footer>
    </div>
  );
}

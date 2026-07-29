import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { T, fmtMoney } from "./publicTheme";

const PRESETS = [25, 50, 100, 250, 500];

// Donor-covers-fees display math — MUST mirror coverFeesGrossUpCents in
// server.js (2.9% + 30¢ standard card rate). Display only: the server
// re-derives the charged amount from the base + boolean and never trusts
// a client-computed total.
function grossUpCents(baseCents) {
  return Math.ceil((baseCents + 30) / (1 - 0.029));
}

const inp = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: "1px solid " + T.bg3,
  borderRadius: 10, padding: "11px 14px",
  color: T.ink, fontSize: 14, outline: "none", fontFamily: "inherit",
};

// A "Start your own fundraiser" modal, shown only on a parent Giving Page
// (never the org-wide page, never an existing personal fundraiser page —
// peer_fundraisers always belong to exactly one giving_pages row). Zero
// account setup by design: on success the supporter is redirected straight
// to their new live page, and a "manage your fundraiser" link is emailed
// as the entire auth model for editing it later (see ManageFundraiser.jsx).
function StartFundraiserModal({ orgSlug, pageSlug, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", personalGoalAmount: "", story: "", imageUrl: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setErr("Please enter your name and email."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch(`${API}/org/${orgSlug}/giving-page/${pageSlug}/fundraisers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start your fundraiser.");
      onCreated(d);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} style={{ background: T.white, borderRadius: 18, padding: "26px 24px", width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif" }}>Start your own fundraiser</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ink3, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 18, lineHeight: 1.5 }}>
          Get your own personal page to share with friends and family — no account needed.
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your name</div>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your email</div>
        <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>We'll send your "manage fundraiser" link here — keep it, there's no password.</div>
        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...inp, marginBottom: 12 }} required />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Personal goal ($, optional)</div>
        <input type="number" value={form.personalGoalAmount} onChange={e => setForm(f => ({ ...f, personalGoalAmount: e.target.value }))} placeholder="e.g. 500" style={{ ...inp, marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your story (optional)</div>
        <textarea value={form.story} onChange={e => setForm(f => ({ ...f, story: e.target.value }))} rows={3} placeholder="Tell people why this cause matters to you." style={{ ...inp, resize: "vertical", marginBottom: 12 }} />

        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Photo URL (optional)</div>
        <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" style={{ ...inp, marginBottom: 6 }} />

        {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginTop: 10 }}>{err}</div>}

        <button type="submit" disabled={saving}
          style={{ width: "100%", marginTop: 14, background: saving ? T.bg3 : T.greenDk, border: "none", borderRadius: 12, padding: "13px", color: "#fff", fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Creating your page…" : "Create my fundraiser →"}
        </button>
      </form>
    </div>
  );
}

export default function Donate() {
  const { orgSlug, pageSlug, fundraiserSlug } = useParams();
  const [org, setOrg] = useState(null);
  const [givingPage, setGivingPage] = useState(null);
  const [peerFundraiser, setPeerFundraiser] = useState(null);
  const [peerFundraisersSummary, setPeerFundraisersSummary] = useState(null);
  const [funds, setFunds] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [donated, setDonated] = useState(false);
  const [cardUpdated, setCardUpdated] = useState(false);
  const [showStartFundraiser, setShowStartFundraiser] = useState(false);
  // Set right after creating a fundraiser (see StartFundraiserModal below).
  // The create response deliberately no longer includes the manage link
  // itself (see server.js generateEditToken comment) — email is the only
  // channel for it, so this banner's whole job is making a failed send
  // visible instead of silently stranding the supporter with no way back in.
  const [justCreatedEmailSent, setJustCreatedEmailSent] = useState(null);

  const [preset, setPreset] = useState(100);
  const [customAmt, setCustomAmt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [fundId, setFundId] = useState("");
  const [frequency, setFrequency] = useState("one-time");
  const [coverFees, setCoverFees] = useState(false); // always opt-in, never pre-checked
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  // /give/:orgSlug/:pageSlug (a campaign-specific Giving Page) and
  // /give/:orgSlug/:pageSlug/:fundraiserSlug (a supporter's own personal
  // fundraiser under that page) both reuse this exact same component and
  // donation form — neither is a fork. The org-wide /give/:orgSlug route
  // (pageSlug undefined) behaves exactly as before.
  const basePath = fundraiserSlug ? `/give/${orgSlug}/${pageSlug}/${fundraiserSlug}`
    : pageSlug ? `/give/${orgSlug}/${pageSlug}`
    : `/give/${orgSlug}`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("donated") === "true") {
      setDonated(true);
      window.history.replaceState({}, "", basePath);
    }
    if (params.get("card_updated") === "true") {
      setCardUpdated(true);
      window.history.replaceState({}, "", basePath);
    }
    if (params.get("fundraiser_created") === "true") {
      setJustCreatedEmailSent(params.get("email_sent") === "true");
      window.history.replaceState({}, "", basePath);
    }
    const url = fundraiserSlug
      ? `${API}/org/${orgSlug}/giving-page/${pageSlug}/fundraiser/${fundraiserSlug}/public`
      : pageSlug
        ? `${API}/org/${orgSlug}/giving-page/${pageSlug}/public`
        : `${API}/org/${orgSlug}/public`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setPageError(d.error); }
        else {
          setOrg(d.org);
          setFunds(d.funds || []);
          if (d.givingPage) {
            setGivingPage(d.givingPage);
            // A giving page designated to a specific fund IS that fund's
            // ask — no separate fund selector shown, gift goes there. This
            // also governs a peer fundraiser's page one level down, since
            // it's raising money for the same campaign/fund as its parent.
            if (d.givingPage.fundId) setFundId(d.givingPage.fundId);
          }
          if (d.peerFundraiser) setPeerFundraiser(d.peerFundraiser);
          if (d.peerFundraisers) setPeerFundraisersSummary(d.peerFundraisers);
        }
        setPageLoading(false);
      })
      .catch(() => { setPageError("Could not load this donation page."); setPageLoading(false); });
  }, [orgSlug, pageSlug, fundraiserSlug]);

  const effectiveAmount = isCustom ? parseFloat(customAmt) || 0 : preset;
  const baseCents = Math.round(effectiveAmount * 100);
  const feeCents = baseCents >= 100 ? grossUpCents(baseCents) - baseCents : 0;
  const showCoverFees = org?.coverFeesEnabled && baseCents >= 100;
  const chargedAmount = showCoverFees && coverFees ? (baseCents + feeCents) / 100 : effectiveAmount;

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
        body: JSON.stringify({
          amount: effectiveAmount, fundId, frequency, firstName, lastName, email,
          givingPageId: givingPage?.id, peerFundraiserId: peerFundraiser?.id,
          coverFees: showCoverFees && coverFees,
        }),
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
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, marginBottom: 12, opacity: 0.6, letterSpacing: "-0.02em", color: T.ink }}>Steward</div>
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

  if (cardUpdated) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 64, height: 64, background: T.greenDk, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 28, color: "#fff" }}>✓</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.ink, marginBottom: 10, fontFamily: "'DM Serif Display', serif" }}>
        Card updated — thank you!
      </div>
      <div style={{ fontSize: 14, color: T.ink3, maxWidth: 360, lineHeight: 1.6 }}>
        Your recurring gift to <strong>{org.name}</strong> will continue as scheduled. We're grateful for your ongoing support.
      </div>
    </div>
  );

  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>

      {showStartFundraiser && (
        <StartFundraiserModal
          orgSlug={orgSlug} pageSlug={pageSlug}
          onClose={() => setShowStartFundraiser(false)}
          onCreated={d => { window.location.href = `${d.publicUrl}?fundraiser_created=true&email_sent=${d.emailSent}`; }}
        />
      )}

      {/* Header — hidden when embedded in an iframe. Three variants: a
          peer fundraiser's own personal page, a parent Giving Page, or the
          generic org-wide page — in that priority order. */}
      {!isEmbed && (
        peerFundraiser ? (
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
            {justCreatedEmailSent !== null && (
              justCreatedEmailSent ? (
                <div style={{ background: T.greenDk + "10", border: "1px solid " + T.greenDk + "30", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: T.ink2, marginBottom: 14 }}>
                  Your fundraiser is live! Check your email for a link to manage it later — bookmark it, there's no password.
                </div>
              ) : (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: "#dc2626", marginBottom: 14 }}>
                  Your fundraiser is live! We couldn't send your management email though — contact {org.name} directly if you need to update your page later.
                </div>
              )
            )}
            {givingPage && (
              <a href={`/give/${orgSlug}/${pageSlug}`} style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: T.greenDk, textDecoration: "none", marginBottom: 10 }}>
                ← Part of {givingPage.title}
              </a>
            )}
            {peerFundraiser.imageUrl && (
              <img src={peerFundraiser.imageUrl} alt={peerFundraiser.name}
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16, marginBottom: 20, display: "block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            )}
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Fundraising for {org.name}</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif", letterSpacing: "-0.02em" }}>
                {peerFundraiser.name}'s Fundraiser
              </h1>
              {peerFundraiser.story && (
                <p style={{ margin: "10px 0 0", fontSize: 14, color: T.ink2, lineHeight: 1.65, textAlign: "left" }}>{peerFundraiser.story}</p>
              )}
            </div>
            <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.greenDk, fontFamily: "'DM Serif Display', serif" }}>{fmtMoney(peerFundraiser.raisedAmount)}</div>
                {peerFundraiser.personalGoalAmount > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>of {fmtMoney(peerFundraiser.personalGoalAmount)} goal</div>}
              </div>
              {peerFundraiser.personalGoalAmount > 0 && (
                <div style={{ background: T.bg, borderRadius: 99, height: 10, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round((peerFundraiser.raisedAmount / peerFundraiser.personalGoalAmount) * 100))}%`,
                    background: T.greenDk, borderRadius: 99, transition: "width 0.6s ease",
                  }} />
                </div>
              )}
            </div>
          </div>
        ) : givingPage ? (
          <div style={{ width: "100%", maxWidth: 480, marginBottom: 28 }}>
            {givingPage.imageUrl && (
              <img src={givingPage.imageUrl} alt={givingPage.title}
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16, marginBottom: 20, display: "block" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            )}
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{org.name}</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif", letterSpacing: "-0.02em" }}>
                {givingPage.title}
              </h1>
              {givingPage.story && (
                <p style={{ margin: "10px 0 0", fontSize: 14, color: T.ink2, lineHeight: 1.65, textAlign: "left" }}>{givingPage.story}</p>
              )}
            </div>
            <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.greenDk, fontFamily: "'DM Serif Display', serif" }}>{fmtMoney(givingPage.raisedAmount)}</div>
                {givingPage.goalAmount > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>of {fmtMoney(givingPage.goalAmount)} goal</div>}
              </div>
              {givingPage.goalAmount > 0 && (
                <div style={{ background: T.bg, borderRadius: 99, height: 10, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, Math.round((givingPage.raisedAmount / givingPage.goalAmount) * 100))}%`,
                    background: T.greenDk, borderRadius: 99, transition: "width 0.6s ease",
                  }} />
                </div>
              )}
            </div>

            {/* Start-your-own-fundraiser CTA — Giving Pages only (never the
                org-wide page, never an existing personal fundraiser page).
                This is the growth loop: every willing supporter becomes
                their own micro-fundraising channel. */}
            <div style={{ background: T.greenDk + "10", border: "1px solid " + T.greenDk + "30", borderRadius: 16, padding: "16px 20px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
                Want to help more? <strong>Start your own fundraiser</strong> and share it with your own network.
              </div>
              <button onClick={() => setShowStartFundraiser(true)}
                style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                Start fundraising →
              </button>
            </div>

            {/* Leaderboard — real, computed, top peer fundraisers by amount
                raised. Nearly free once personal totals exist; standard
                P2P social-proof mechanic. */}
            {peerFundraisersSummary && peerFundraisersSummary.count > 0 && (
              <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px", marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                  {peerFundraisersSummary.count} Fundraiser{peerFundraisersSummary.count !== 1 ? "s" : ""} Raising For This
                </div>
                {peerFundraisersSummary.leaderboard.map((f, i) => (
                  <a key={f.id} href={`/give/${orgSlug}/${pageSlug}/${f.slug}`}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid " + T.bg3 : "none", textDecoration: "none" }}>
                    <div style={{ width: 22, fontSize: 12, fontWeight: 800, color: i < 3 ? T.gold : T.ink3, flexShrink: 0 }}>#{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: T.greenDk, flexShrink: 0 }}>{fmtMoney(f.raisedAmount)}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 32, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, background: T.greenDk, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 28, fontWeight: 400, color: "#fff", lineHeight: 1 }}>S</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif", letterSpacing: "-0.02em" }}>
              Give to {org.name}
            </h1>
            {org.mission && (
              <p style={{ margin: "8px 0 0", fontSize: 14, color: T.ink3, maxWidth: 400, lineHeight: 1.6 }}>{org.mission}</p>
            )}
          </div>
        )
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
              You'll be charged <strong>${chargedAmount.toFixed(2)}</strong> {frequency === "monthly" ? "each month" : "each year"} until you cancel.
            </div>
          )}
        </div>

        {/* Donor-covers-fees — optional, always unchecked by default, shown
            only when the org has it enabled. The fee shown is the standard
            card-processing estimate so the org nets the intended gift; the
            server re-derives this same number and never trusts ours. */}
        {showCoverFees && (
          <label style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={coverFees} onChange={e => setCoverFees(e.target.checked)}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: T.greenDk, cursor: "pointer", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
              Add <strong>${(feeCents / 100).toFixed(2)}</strong> to help cover card-processing costs
              {frequency !== "one-time" ? ` on each ${frequency === "monthly" ? "monthly" : "annual"} gift` : ""},
              so {org.name} receives your full ${effectiveAmount.toFixed(2)}.
            </span>
          </label>
        )}

        {/* Fund selector — hidden when this Giving Page (or its parent, for
            a peer-fundraiser page) already designates a fund; the page's
            own goal/story IS that fund's ask. */}
        {funds.length > 0 && !givingPage?.fundId && (
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
          {submitting ? "Redirecting to Stripe…" : `Give $${effectiveAmount > 0 ? chargedAmount.toFixed(2) : "—"} ${frequency !== "one-time" ? `/ ${frequency === "monthly" ? "mo" : "yr"}` : ""}`}
        </button>

        <div style={{ textAlign: "center", fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
          Payments are processed securely by Stripe. {org.name} never stores your card details.
          <br />Powered by <span style={{ fontWeight: 700, color: T.greenDk }}>Steward</span>
        </div>
      </form>
    </div>
  );
}

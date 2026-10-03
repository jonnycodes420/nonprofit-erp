// PARITY-2 Part 1: THE MEMBERSHIP PAGE. `/give/:orgSlug?memberships`.
//
// Every level the org sells and has not hidden, as a card: its name, its price
// and term, what it is for, what a member receives, and what the receipt will
// call deductible. Join opens that level's checkout in the card: the server
// prices it from the level (the `?membership=` rule), the webhook writes the
// membership, the gift and the receipt exactly as a single-level join does.
//
// A query MODE on the org's own giving page, never a path segment: a page
// slug "join" or "members" must stay free for the org (forms.md).
//
// A signed-in member (the portal's own magic link, the same session the give
// form reads, asked from this page even with the portal off: FIX-20) sees their level and its expiry on its card, with Renew. Nobody
// else is shown anything about anybody: an anonymous visit asks nothing.
//
// The colours, type and logo are the ORG's (resolveTheme in Donate.jsx hands
// them down as `th`); nothing here is Steward's.

import { useState, useEffect } from "react";
import { API } from "../api";
import { T } from "./publicTheme";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import ShareRow from "./ShareRow";

// `en-US`, named (the EVENTS-2 rule): $12.50 must never read as $13.
function fmtPrice(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const whole = v % 1 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(v);
}
const RENEW_WORD = { annual: "each year", monthly: "each month" };

function deductibleSentence(l) {
  return l.fmv > 0
    ? `${fmtPrice(l.fmv)} of each payment is the value of what members receive, so ${fmtPrice(l.deductible)} is tax-deductible.`
    : "All of it is tax-deductible.";
}

function LevelCard({ l, th, card, orgSlug, prefill, mine, isMember }) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(prefill?.firstName || "");
  const [lastName, setLastName] = useState(prefill?.lastName || "");
  const [email, setEmail] = useState(prefill?.email || "");
  const [autoRenew, setAutoRenew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // A signed-in visitor's own details arrive after the page has drawn.
  useEffect(() => {
    if (!prefill) return;
    setFirstName(f => f || prefill.firstName || "");
    setLastName(v => v || prefill.lastName || "");
    setEmail(v => v || prefill.email || "");
  }, [prefill]);

  const lifetimeHeld = mine && l.term === "lifetime";
  const canRenew = mine && !lifetimeHeld && !mine.autoRenew;
  const actionLabel = mine ? "Renew" : isMember ? "Move to this level" : "Join";

  async function pay(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setErr("Your first and last name and your email, for the receipt."); return;
    }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/donate/${orgSlug}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipLevelId: l.id, firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(),
          frequency: autoRenew && l.autoRenewFrequency ? l.autoRenewFrequency : "once" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong.");
      window.location.href = j.url;
    } catch (e2) { setErr(errorMessage(e2, "Something went wrong. Please try again.")); setBusy(false); }
  }

  const inp = { width: "100%", minWidth: 0, boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 10,
                padding: "11px 12px", fontSize: 15, color: T.ink, background: T.pureWhite, fontFamily: th.sans };
  const btn = { background: th.button, color: th.buttonFg, border: "none", borderRadius: 10, padding: "12px 16px",
                fontSize: 15, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: th.sans, width: "100%" };
  return (
    <div data-testid="membership-card" data-level={l.id}
      style={{ ...card, padding: 22, display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
               border: mine ? `2px solid ${th.primary}` : card.border }}>
      <div style={{ fontSize: 22, color: T.ink, fontFamily: th.serif, lineHeight: 1.2 }}>{l.name}</div>
      <div style={{ fontSize: 15, color: T.ink }}>
        <strong style={{ fontSize: 24, color: th.primary }}>{fmtPrice(l.price)}</strong>{" "}
        <span>{l.priceSuffix}</span>
        {l.scope === "household" ? <span style={{ color: T.ink3 }}> · for your household</span> : null}
      </div>
      {mine && (
        <div data-testid="membership-mine" style={{ fontSize: 14, color: T.ink, background: T.bg, borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}>
          Your membership: {l.name}{mine.expiresOn ? `, ${mine.status === "grace" ? "expired" : "expires"} ${displayDate(mine.expiresOn)}` : ", for life"}.
          {mine.autoRenew ? ` It renews by itself ${RENEW_WORD[l.autoRenewFrequency] || ""}.` : ""}
        </div>)}
      {l.description ? <div style={{ fontSize: 15, color: T.ink2, lineHeight: 1.55 }}>{l.description}</div> : null}
      {l.benefits.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: T.ink, lineHeight: 1.6 }}>
          {l.benefits.map((b, i) => <li key={i}>{b}</li>)}
        </ul>)}
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: "auto" }}>{deductibleSentence(l)}</div>
      {(lifetimeHeld || (mine && mine.autoRenew)) ? null : !open ? (
        <button type="button" data-testid="membership-join" onClick={() => setOpen(true)} style={btn}>
          {actionLabel}
        </button>
      ) : (
        <form onSubmit={pay} style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="membership-checkout">
          {isMember && !mine && (
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>Your new level starts the day after your current membership ends, so you lose no time.</div>)}
          {canRenew && (
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>Renewing early costs you nothing: the new term starts the day after this one ends.</div>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input aria-label="First name" placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} style={{ ...inp, flex: "1 1 120px" }} />
            <input aria-label="Last name" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} style={{ ...inp, flex: "1 1 120px" }} />
          </div>
          <input aria-label="Email" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
          {l.autoRenewFrequency && (
            <label style={{ fontSize: 13.5, color: T.ink, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
              <input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} />
              <span>Renew automatically {RENEW_WORD[l.autoRenewFrequency]} at {fmtPrice(l.price)}. You can cancel any time.</span>
            </label>)}
          {err && <div role="status" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
          <button type="submit" disabled={busy} style={btn}>
            {busy ? "One moment…" : `Pay ${fmtPrice(l.price)}`}
          </button>
        </form>
      )}
    </div>
  );
}

export default function MembershipsPage({ orgSlug, th, BASE, card, portalBase, sessionTick, signIn, monogram }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [me, setMe] = useState(null);   // { membership, prefill } for a signed-in visitor
  useEffect(() => {
    fetch(`${API}/org/${orgSlug}/memberships/public`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("This page is not available.")))
      .then(setData)
      .catch(e => setErr(errorMessage(e, "This page is not available.")));
  }, [orgSlug]);
  // The visitor's OWN membership, through their own session. FIX-20 Part 7:
  // asked whether or not the org's portal is on, since the membership page
  // signs a member in either way; anonymous is a 401 and changes nothing.
  // Asked again after a sign-in link is spent (sessionTick).
  useEffect(() => {
    let cancelled = false;
    fetch(`${portalBase}/${orgSlug}/give-default`, { credentials: "include", headers: { "Content-Type": "application/json" } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setMe({ membership: d.membership || null, prefill: d.prefill || null }); })
      .catch(() => { /* anonymous */ });
    return () => { cancelled = true; };
  }, [orgSlug, portalBase, sessionTick]);

  if (err) return <div style={BASE}><div style={{ ...card, padding: 28, color: T.ink }}>{err}</div></div>;
  if (!data) return <div style={BASE}><div style={{ color: T.ink3, fontSize: 14 }}>Loading…</div></div>;
  const mine = me?.membership || null;
  const pageUrl = `${window.location.origin}/give/${orgSlug}?memberships`;
  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 1040, boxSizing: "border-box" }} data-testid="memberships-page">
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {th.logo ? (
            <img src={th.logo} alt={th.displayName || data.orgName}
              style={{ maxHeight: 52, maxWidth: 220, objectFit: "contain", margin: "0 auto 12px", display: "block" }}
              onError={e => { e.target.style.display = "none"; }} />
          ) : (
            <div style={{ width: 46, height: 46, background: th.primary, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <span style={{ fontFamily: th.serif, fontSize: 24, fontWeight: 700, color: th.primaryFg, lineHeight: 1 }}>{monogram}</span>
            </div>)}
          <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{data.orgName}</div>
          <h1 style={{ margin: 0, fontSize: 28, color: T.ink, fontFamily: th.serif, letterSpacing: "-0.01em" }}>Become a member</h1>
          <p style={{ margin: "8px auto 0", maxWidth: 520, fontSize: 15, color: T.ink2, lineHeight: 1.6 }}>
            Choose a level. Membership is paid like a gift, and your receipt says how much of it is tax-deductible.
          </p>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>{signIn}</div>
        </div>
        {!data.levels.length ? (
          <div style={{ ...card, padding: 24, color: T.ink, textAlign: "center" }}>Memberships are not open right now.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16, alignItems: "stretch" }}>
            {data.levels.map(l => (
              <LevelCard key={l.id} l={l} th={th} card={card} orgSlug={orgSlug} prefill={me?.prefill || null}
                mine={mine && mine.levelId === l.id ? mine : null} isMember={!!mine} />))}
          </div>
        )}
        {mine && !data.levels.some(l => l.id === mine.levelId) && (
          <div data-testid="membership-mine" style={{ ...card, marginTop: 16, padding: 18, fontSize: 14, color: T.ink }}>
            Your membership: {mine.levelName}{mine.expiresOn ? `, expires ${displayDate(mine.expiresOn)}` : ""}.
            {mine.forSale && !mine.autoRenew && mine.term !== "lifetime" ? <>{" "}<a href={`/give/${orgSlug}?membership=${encodeURIComponent(mine.levelId)}`} style={{ color: th.primary, fontWeight: 700 }}>Renew it</a></> : null}
          </div>)}
        <div style={{ display: "flex", justifyContent: "center", textAlign: "center" }}>
          <ShareRow url={pageUrl} orgName={data.orgName} th={th} heading="Ask a friend to join"
            text={`Become a member of ${data.orgName}:`} subject={`Join ${data.orgName}`} />
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: T.ink3, lineHeight: 1.6, marginTop: 24 }}>
          {th.footerText ? <>{th.footerText}<br /></> : null}
          Payments are processed securely by Stripe. {data.orgName} never stores your card details.
          {th.poweredBy && <><br />Powered by Steward</>}
        </div>
      </div>
    </div>
  );
}

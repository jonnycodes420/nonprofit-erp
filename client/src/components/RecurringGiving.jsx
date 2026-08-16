import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../api";
import { T, fmtFull, interactive, EmptyState } from "./shared";

// BUILD-57 Part 1 — the recurring-giving surface a development office manages
// from. Two exports: RecurringView (the full Fundraising → Recurring page:
// movement summary, at-risk queue first, the roster, every staff action) and
// DashboardRecurring (the Home tab: EXCEPTIONS ONLY — counts and a path into
// this page, never a second copy of the roster).
//
// The pre-answered action rule (BUILD-57): anything that can MOVE MONEY
// (create / amount / frequency / card) is an INVITATION the donor completes;
// pause / resume / cancel / fund designation are staff-direct. Cancel is
// never blocked by read-only state — a donor asking to stop is honored.

const STATUS_META = {
  past_due: { label: "Past due", color: T.terra700, bg: T.terra100, border: T.terra200 },
  pending: { label: "Pending donor action", color: T.gold700, bg: T.gold100, border: T.gold300 },
  paused: { label: "Paused", color: T.ink3, bg: T.bg2, border: T.bg3 },
  active: { label: "Active", color: T.greenDk, bg: T.green100, border: T.green200 },
  canceled: { label: "Canceled", color: T.ink3, bg: T.bg2, border: T.bg3 },
};

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const per = interval => interval === "year" ? "/yr" : "/mo";
const money = n => n == null ? "—" : fmtFull(n);

function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.active;
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, border: `1px solid ${m.border}`, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

// ── The movement summary: MRR, the waterfall, 12-month retention ───────────
// Involuntary (card failure) and voluntary (donor chose) churn render as
// SEPARATE rows always — one is a technical problem you can fix, the other a
// relationship problem you can't. Never collapse them.
function MovementSummary({ movement }) {
  if (!movement) return null;
  const w = movement.waterfall || {};
  const row = (label, entry, sign, color) => {
    const amt = entry?.amount || 0;
    const count = entry?.count || 0;
    return (
      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "3px 0" }}>
        <span style={{ fontSize: 12.5, color: T.ink2 }}>{label}{count ? <span style={{ color: T.ink3 }}> · {count}</span> : null}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: amt ? color : T.ink3, fontVariantNumeric: "tabular-nums" }}>
          {amt ? `${sign}${fmtFull(amt)}` : "—"}
        </span>
      </div>
    );
  };
  const net = w.net || 0;
  return (
    <div style={{ background: T.bgCard, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: "20px 22px", display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(240px,1.4fr) minmax(200px,1fr)", gap: 28 }} className="rec-movement">
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>Monthly recurring revenue</div>
        <div style={{ fontSize: 34, fontWeight: 800, fontFamily: "'DM Serif Display',serif", color: T.ink, lineHeight: 1.15, margin: "6px 0 2px" }}>{fmtFull(movement.mrr)}</div>
        <div style={{ fontSize: 12, color: T.ink3 }}>
          {movement.healthyCount} active sustainer{movement.healthyCount === 1 ? "" : "s"}
          {movement.atRiskCount ? <span style={{ color: T.terra700, fontWeight: 700 }}> · {movement.atRiskCount} at risk</span> : null}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, marginBottom: 4 }}>Change this month</div>
        {row("New", w.new, "+", T.greenDk)}
        {row("Upgraded", w.upgraded, "+", T.greenDk)}
        {row("Resumed", w.resumed, "+", T.greenDk)}
        {row("Downgraded", w.downgraded, "−", T.ink2)}
        {row("Paused", w.paused, "−", T.ink2)}
        {row("Lost to card failure", w.involuntaryChurn, "−", T.terracotta)}
        {row("Canceled by donor", w.voluntaryChurn, "−", T.ink2)}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${T.bg3}`, marginTop: 6, paddingTop: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: T.ink }}>Net</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: net >= 0 ? T.greenDk : T.terracotta, fontVariantNumeric: "tabular-nums" }}>
            {net >= 0 ? "+" : "−"}{fmtFull(Math.abs(net))}
          </span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>Sustainer retention · 12 months</div>
        <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'DM Serif Display',serif", color: T.ink, lineHeight: 1.2, margin: "6px 0 2px" }}>
          {movement.retention12?.rate != null ? `${movement.retention12.rate}%` : "—"}
        </div>
        {movement.retention12?.rate != null ? (
          <div style={{ fontSize: 12, color: T.ink3 }}>{movement.retention12.retained} of {movement.retention12.cohortSize} still giving a year in</div>
        ) : (
          <div style={{ fontSize: 12, color: T.ink3 }}>No subscription is a year old yet.</div>
        )}
        {movement.benchmark && (
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 8, lineHeight: 1.45 }}>
            Sector benchmark: {movement.benchmark.value}% at 12 months ({movement.benchmark.source}).
          </div>
        )}
      </div>
    </div>
  );
}

// ── Per-row actions: one labeled menu, never a strip of sibling buttons ────
function ActionsMenu({ sub, isReadOnly, onAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const items = [];
  const push = (key, label, opts = {}) => items.push({ key, label, ...opts });
  if (sub.status !== "canceled") {
    if (["active", "recovered"].includes(sub.status)) {
      push("propose", "Propose a change…", { gated: true });
      push("pause", "Pause", { gated: true });
    }
    if (["past_due", "recovering"].includes(sub.status)) {
      push("cardlink", "Send card-update link");
      push("propose_card", "Propose card update…", { gated: true });
    }
    if (sub.status === "paused") push("resume", "Resume", { gated: true });
    if (sub.pendingProposal && sub.pendingProposal.resendCount === 0) push("resend_proposal", "Resend proposal");
    push("fund", "Change fund designation…", { gated: true });
    push("cancel", "Cancel subscription", { danger: true });
  }
  push("donor", "Open donor");
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        style={{ background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink2, cursor: "pointer", whiteSpace: "nowrap" }}>
        Actions ▾
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 60, background: T.bgCard, border: `1px solid ${T.bg3}`, borderRadius: 10, boxShadow: T.shadowMd, minWidth: 210, padding: 6 }}>
          {items.map(it => {
            const disabled = it.gated && isReadOnly;
            return (
              <button key={it.key} role="menuitem" disabled={disabled}
                title={disabled ? "Reactivate your subscription to make changes." : undefined}
                onClick={() => { setOpen(false); onAction(it.key, sub); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 7, padding: "8px 10px", fontSize: 12.5, fontWeight: 600, color: disabled ? T.ink3 : it.danger ? T.terra700 : T.ink2, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}
                onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = it.danger ? T.terra100 : T.green100; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Modal scaffold — PORTALED to document.body (the BUILD-22 lesson: a
// `.fade-in` ancestor's retained transform makes it the containing block for
// position:fixed, dropping overlays below the fold on tall pages). ─────────
function Modal({ title, onClose, children, width = 440 }) {
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(15,26,18,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={{ background: T.bgCard, borderRadius: 14, padding: "24px 26px", width, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: T.shadowLg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontFamily: "'DM Serif Display',serif", fontWeight: 400, color: T.ink }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", fontSize: 18, color: T.ink3, cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.bg3}`, fontSize: 13.5, color: T.ink, background: T.white };
const labelStyle = { display: "block", fontSize: 11.5, fontWeight: 700, color: T.ink3, margin: "12px 0 5px", letterSpacing: "0.04em", textTransform: "uppercase" };
const primaryBtnStyle = { background: T.gold500, border: "none", borderRadius: 10, padding: "11px 20px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" };
const quietBtnStyle = { background: "transparent", border: "none", padding: "11px 8px", color: T.ink3, fontSize: 13, fontWeight: 600, cursor: "pointer" };

// ── The invitation modal: propose a change on an existing subscription, or a
// brand-new subscription (donor completes on Stripe either way). ───────────
function ProposeModal({ sub, funds, presetKind, onClose, onDone }) {
  const isNew = !sub;
  const [kind, setKind] = useState(presetKind || (isNew ? "create" : "amount"));
  const [amount, setAmount] = useState(sub && sub.amount != null ? String(sub.amount) : "25");
  const [interval, setInterval_] = useState(sub?.interval === "year" ? "year" : "month");
  const [fundId, setFundId] = useState("");
  const [donor, setDonor] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!isNew || donor) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      apiFetch(`/donors?search=${encodeURIComponent(search.trim())}&limit=8`)
        .then(r => setResults(r.donors || []))
        .catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(debounceRef.current);
  }, [search, isNew, donor]);

  const submit = () => {
    setErr(null);
    const donorId = isNew ? donor?.id : sub.donorId;
    if (!donorId) { setErr("Pick a donor first."); return; }
    const body = { donorId, kind };
    if (!isNew) body.subId = sub.id;
    if (kind === "create" || kind === "amount") {
      const cents = Math.round(parseFloat(amount) * 100);
      if (!Number.isFinite(cents) || cents <= 0) { setErr("Enter a valid amount."); return; }
      body.amountCents = cents;
    }
    if (kind === "create" || kind === "frequency") body.interval = interval;
    if (kind === "create" && fundId) body.fundId = fundId;
    setBusy(true);
    apiFetch("/recurring/proposals", { method: "POST", body: JSON.stringify(body) })
      .then(() => { setBusy(false); onDone(); })
      .catch(e => { setBusy(false); setErr(e.message || "Couldn't send the proposal."); });
  };

  return (
    <Modal title={isNew ? "Propose a recurring gift" : "Propose a change"} onClose={onClose}>
      <p style={{ margin: "0 0 6px", fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
        The donor completes this from an email — nothing changes, and no money moves, until they do. The link expires in 14 days.
      </p>
      {isNew && (
        <>
          <label style={labelStyle}>Donor</label>
          {donor ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{donor.name}</span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{donor.email || "no email on file"}</span>
              <button onClick={() => { setDonor(null); setSearch(""); }} style={{ ...quietBtnStyle, padding: "2px 6px", fontSize: 12 }}>Change</button>
            </div>
          ) : (
            <>
              <input style={inputStyle} placeholder="Search donors by name or email…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              {results.length > 0 && (
                <div style={{ border: `1px solid ${T.bg3}`, borderRadius: 8, marginTop: 4, overflow: "hidden" }}>
                  {results.map(d => (
                    <button key={d.id} onClick={() => setDonor(d)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: T.bgCard, border: "none", borderBottom: `1px solid ${T.bg2}`, padding: "8px 12px", fontSize: 13, color: T.ink2, cursor: "pointer" }}>
                      {d.name} <span style={{ color: T.ink3, fontSize: 12 }}>{d.email || "no email"}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      {!isNew && (
        <>
          <label style={labelStyle}>What to propose</label>
          <select style={inputStyle} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="amount">Change the amount</option>
            <option value="frequency">Change the frequency</option>
            <option value="card_update">Update the card</option>
          </select>
        </>
      )}
      {(kind === "create" || kind === "amount") && (
        <>
          <label style={labelStyle}>{kind === "amount" ? `New amount (currently ${money(sub?.amount)}${sub ? per(sub.interval) : ""})` : "Amount"}</label>
          <input style={inputStyle} type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} />
        </>
      )}
      {(kind === "create" || kind === "frequency") && (
        <>
          <label style={labelStyle}>{kind === "frequency" ? `New frequency (currently ${sub?.interval === "year" ? "yearly" : "monthly"})` : "Frequency"}</label>
          <select style={inputStyle} value={interval} onChange={e => setInterval_(e.target.value)}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </>
      )}
      {kind === "create" && funds.length > 0 && (
        <>
          <label style={labelStyle}>Fund designation (optional)</label>
          <select style={inputStyle} value={fundId} onChange={e => setFundId(e.target.value)}>
            <option value="">General — no designation</option>
            {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </>
      )}
      {kind === "card_update" && (
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
          The donor updates their card securely on Stripe. Card details never touch Steward — or you.
        </p>
      )}
      {err && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.terra700, background: T.terra100, border: `1px solid ${T.terra200}`, borderRadius: 8, padding: "8px 12px" }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={quietBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={busy} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>{busy ? "Sending…" : "Send to donor"}</button>
      </div>
    </Modal>
  );
}

function PauseModal({ sub, onClose, onConfirm }) {
  const [resumeAt, setResumeAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = () => {
    setBusy(true); setErr(null);
    onConfirm(resumeAt || null).catch(e => { setBusy(false); setErr(e.message || "Couldn't pause."); });
  };
  return (
    <Modal title={`Pause ${sub.donorName}'s gift`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
        No charges will occur while paused. {sub.donorName} will be notified by email.
      </p>
      <label style={labelStyle}>Auto-resume date (optional)</label>
      <input style={inputStyle} type="date" value={resumeAt} onChange={e => setResumeAt(e.target.value)} />
      {err && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.terra700 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={quietBtnStyle}>Cancel</button>
        <button onClick={go} disabled={busy} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>{busy ? "Pausing…" : "Pause"}</button>
      </div>
    </Modal>
  );
}

function FundModal({ sub, funds, onClose, onConfirm }) {
  const [fundId, setFundId] = useState(sub.fundId || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = () => {
    setBusy(true); setErr(null);
    onConfirm(fundId || null).catch(e => { setBusy(false); setErr(e.message || "Couldn't change the designation."); });
  };
  return (
    <Modal title="Change fund designation" onClose={onClose}>
      <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
        Future charges on {sub.donorName}'s {money(sub.amount)}{per(sub.interval)} gift will be designated here. {sub.donorName} will be notified.
      </p>
      <label style={labelStyle}>Fund</label>
      <select style={inputStyle} value={fundId} onChange={e => setFundId(e.target.value)}>
        <option value="">General — no designation</option>
        {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {err && <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.terra700 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={quietBtnStyle}>Cancel</button>
        <button onClick={go} disabled={busy} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save designation"}</button>
      </div>
    </Modal>
  );
}

// ── The at-risk queue — failed and past-due cards, sorted first, visually
// distinct. This is the queue the "caught within the hour, recovered in your
// name" claim describes; it renders ABOVE the roster, always. ──────────────
function AtRiskQueue({ subs, isReadOnly, onAction }) {
  if (!subs.length) return null;
  return (
    <div style={{ background: T.terra100, border: `1px solid ${T.terra200}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.terra700 }}>Needs recovery</span>
        <span style={{ fontSize: 12, color: T.terra700 }}>{subs.length} failing card{subs.length === 1 ? "" : "s"} · {fmtFull(subs.reduce((s, x) => s + (x.interval === "year" ? (x.amount || 0) / 12 : (x.amount || 0)), 0))}/mo at risk</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subs.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.bgCard, borderRadius: 9, padding: "9px 12px", flexWrap: "wrap" }}>
            <button onClick={() => onAction("donor", s)}
              style={{ background: "transparent", border: "none", padding: 0, fontSize: 13.5, fontWeight: 700, color: T.ink, cursor: "pointer", textAlign: "left" }}>
              {s.donorName}
            </button>
            <span style={{ fontSize: 12.5, color: T.ink3 }}>{money(s.amount)}{per(s.interval)}</span>
            <span style={{ fontSize: 12, color: T.terra700 }}>
              failed {s.lastFailedAt ? fmtDate(s.lastFailedAt) : "recently"}{s.failureCount > 1 ? ` · ${s.failureCount} attempts` : ""} · recovery step {Math.min((s.dunningStep ?? 0) + 1, 4)} of 4
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button onClick={() => onAction("cardlink", s)}
                style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" }}>
                Send card-update link
              </button>
              <ActionsMenu sub={s} isReadOnly={isReadOnly} onAction={onAction} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── The full page ──────────────────────────────────────────────────────────
export function RecurringView({ onNavigate, isReadOnly }) {
  const [roster, setRoster] = useState(null);
  const [movement, setMovement] = useState(null);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {type, sub?}
  const [toast, setToast] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "status", dir: 1 });

  const load = () => Promise.all([
    apiFetch("/recurring/roster"), apiFetch("/recurring/movement"), apiFetch("/finance/funds").catch(() => []),
  ]).then(([r, m, f]) => {
    setRoster(r); setMovement(m); setFunds(Array.isArray(f) ? f : []); setLoading(false);
  }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const say = msg => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const doAction = (key, sub) => {
    if (key === "donor") { onNavigate("donors", { selectDonorId: sub.donorId }); return; }
    if (key === "propose") { setModal({ type: "propose", sub }); return; }
    if (key === "propose_card") { setModal({ type: "propose", sub, presetKind: "card_update" }); return; }
    if (key === "pause") { setModal({ type: "pause", sub }); return; }
    if (key === "fund") { setModal({ type: "fund", sub }); return; }
    if (key === "resume") {
      apiFetch(`/recurring/subs/${sub.id}/resume`, { method: "POST", body: JSON.stringify({}) })
        .then(() => { say(`${sub.donorName}'s gift resumed — they've been notified.`); load(); })
        .catch(e => say(e.message || "Couldn't resume."));
      return;
    }
    if (key === "cancel") {
      if (!window.confirm(`Cancel ${sub.donorName}'s ${money(sub.amount)}${per(sub.interval)} recurring gift? They won't be charged again, and they'll be notified.`)) return;
      apiFetch(`/recurring/subs/${sub.id}/cancel`, { method: "POST", body: JSON.stringify({}) })
        .then(() => { say(`Canceled — ${sub.donorName} has been notified.`); load(); })
        .catch(e => say(e.message || "Couldn't cancel."));
      return;
    }
    if (key === "cardlink") {
      apiFetch(`/recurring/${sub.donorId}/resend`, { method: "POST", body: JSON.stringify({}) })
        .then(() => say(`Card-update link sent to ${sub.donorName}.`))
        .catch(e => say(e.message || "Couldn't send the link."));
      return;
    }
    if (key === "resend_proposal" && sub.pendingProposal) {
      apiFetch(`/recurring/proposals/${sub.pendingProposal.id}/resend`, { method: "POST", body: JSON.stringify({}) })
        .then(() => { say("Proposal resent."); load(); })
        .catch(e => say(e.message || "Couldn't resend."));
    }
  };

  const resendInvitation = inv => {
    apiFetch(`/recurring/proposals/${inv.id}/resend`, { method: "POST", body: JSON.stringify({}) })
      .then(() => { say("Invitation resent."); load(); })
      .catch(e => say(e.message || "Couldn't resend."));
  };

  const subs = roster?.subs || [];
  const invitations = roster?.invitations || [];
  const atRisk = subs.filter(s => s.displayStatus === "past_due");

  const filtered = useMemo(() => {
    let rows = subs;
    if (statusFilter !== "all") rows = rows.filter(s => s.displayStatus === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(s => (s.donorName || "").toLowerCase().includes(q) || (s.donorEmail || "").toLowerCase().includes(q));
    }
    const STATUS_ORDER = { past_due: 0, pending: 1, paused: 2, active: 3, canceled: 4 };
    const cmp = {
      status: (a, b) => (STATUS_ORDER[a.displayStatus] ?? 9) - (STATUS_ORDER[b.displayStatus] ?? 9),
      donor: (a, b) => (a.donorName || "").localeCompare(b.donorName || ""),
      amount: (a, b) => (b.amount || 0) - (a.amount || 0),
      next: (a, b) => new Date(b.nextChargeAt || 0) - new Date(a.nextChargeAt || 0),
      started: (a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0),
      total: (a, b) => (b.totalGiven || 0) - (a.totalGiven || 0),
    }[sort.key] || (() => 0);
    return [...rows].sort((a, b) => sort.dir * cmp(a, b));
  }, [subs, statusFilter, search, sort]);

  const header = (key, label, align = "left") => (
    <th style={{ textAlign: align, padding: "8px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, whiteSpace: "nowrap" }}>
      <button onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }))}
        style={{ background: "transparent", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", letterSpacing: "inherit", textTransform: "inherit" }}>
        {label}{sort.key === key ? (sort.dir === 1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;

  const roTip = isReadOnly ? "Reactivate your subscription to make changes." : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {toast && (
        <div role="status" style={{ position: "fixed", bottom: 24, right: 24, zIndex: 400, background: T.ink, color: T.inkInverse, borderRadius: 10, padding: "12px 18px", fontSize: 13, boxShadow: T.shadowLg }}>{toast}</div>
      )}

      <MovementSummary movement={movement} />
      <AtRiskQueue subs={atRisk} isReadOnly={isReadOnly} onAction={doAction} />

      {invitations.length > 0 && (
        <div style={{ background: T.gold50, border: `1px solid ${T.gold300}`, borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.gold700, marginBottom: 8 }}>Invitations awaiting the donor</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {invitations.map(inv => (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, flexWrap: "wrap" }}>
                <button onClick={() => onNavigate("donors", { selectDonorId: inv.donorId })}
                  style={{ background: "transparent", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" }}>{inv.donorName}</button>
                <span style={{ color: T.ink3 }}>
                  {money(inv.proposedAmount)}{inv.proposedInterval === "year" ? "/yr" : "/mo"}{inv.fundName ? ` · ${inv.fundName}` : ""} · expires {fmtDate(inv.expiresAt)}
                </span>
                {inv.resendCount === 0 && (
                  <button onClick={() => resendInvitation(inv)} style={{ background: "transparent", border: `1px solid ${T.bg3}`, borderRadius: 7, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, color: T.ink2, cursor: "pointer" }}>Resend</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, width: 240 }} placeholder="Search sustainers…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, width: "auto" }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="past_due">Past due</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="pending">Pending donor action</option>
          <option value="canceled">Canceled</option>
        </select>
        <span style={{ marginLeft: "auto" }}>
          <button onClick={() => setModal({ type: "propose", sub: null })} disabled={isReadOnly} title={roTip}
            style={{ ...primaryBtnStyle, opacity: isReadOnly ? 0.5 : 1, cursor: isReadOnly ? "not-allowed" : "pointer" }}>
            Propose a recurring gift
          </button>
        </span>
      </div>

      {subs.length === 0 && invitations.length === 0 ? (
        <EmptyState title="No recurring gifts yet."
          line="When a donor starts a recurring gift — or you propose one and they accept — every subscription lands here: who, how much, what it supports, and which cards need rescue." />
      ) : (
        <div style={{ background: T.bgCard, border: `1px solid ${T.bg3}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.bg3}`, background: T.bg2 }}>
                {header("donor", "Donor")}
                {header("amount", "Amount", "right")}
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Fund</th>
                {header("status", "Status")}
                {header("next", "Next charge")}
                {header("started", "Started")}
                {header("total", "Total given", "right")}
                <th style={{ padding: "8px 10px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${T.bg2}`, background: s.displayStatus === "past_due" ? T.terra100 : "transparent" }}>
                  <td style={{ padding: "10px 10px" }}>
                    <button onClick={() => doAction("donor", s)}
                      style={{ background: "transparent", border: "none", padding: 0, fontSize: 13.5, fontWeight: 700, color: T.ink, cursor: "pointer", textAlign: "left" }}>
                      {s.donorName}
                    </button>
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {money(s.amount)}<span style={{ color: T.ink3, fontWeight: 500 }}>{per(s.interval)}</span>
                  </td>
                  <td style={{ padding: "10px 10px", fontSize: 12.5, color: s.fundName ? T.ink2 : T.ink3 }}>{s.fundName || "General"}</td>
                  <td style={{ padding: "10px 10px" }}><StatusPill status={s.displayStatus} /></td>
                  <td style={{ padding: "10px 10px", fontSize: 12.5, color: T.ink3, whiteSpace: "nowrap" }}>{s.displayStatus === "canceled" || s.displayStatus === "paused" ? "—" : fmtDate(s.nextChargeAt)}</td>
                  <td style={{ padding: "10px 10px", fontSize: 12.5, color: T.ink3, whiteSpace: "nowrap" }}>{fmtDate(s.startedAt)}</td>
                  <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 12.5, color: T.ink2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {s.linkedGiftCount > 0 ? `${fmtFull(s.totalGiven)} · ${s.linkedGiftCount}` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", textAlign: "right" }}>
                    <ActionsMenu sub={s} isReadOnly={isReadOnly} onAction={doAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === "propose" && (
        <ProposeModal sub={modal.sub} funds={funds} presetKind={modal.presetKind}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); say("Proposal sent — it shows as pending until the donor completes it."); load(); }} />
      )}
      {modal?.type === "pause" && (
        <PauseModal sub={modal.sub} onClose={() => setModal(null)}
          onConfirm={resumeAt =>
            apiFetch(`/recurring/subs/${modal.sub.id}/pause`, { method: "POST", body: JSON.stringify({ resumeAt }) })
              .then(() => { setModal(null); say(`Paused — ${modal.sub.donorName} has been notified.`); load(); })} />
      )}
      {modal?.type === "fund" && (
        <FundModal sub={modal.sub} funds={funds} onClose={() => setModal(null)}
          onConfirm={fundId =>
            apiFetch(`/recurring/subs/${modal.sub.id}/fund`, { method: "PUT", body: JSON.stringify({ fundId }) })
              .then(() => { setModal(null); say("Designation updated — the donor has been notified."); load(); })} />
      )}
    </div>
  );
}

// ── Home → Recurring: the EXCEPTIONS tab. Counts and short lists of what
// needs a human this morning, plus one path into the full page. Never the
// roster — if the same table renders twice, the design is wrong. ───────────
export function DashboardRecurring({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch("/recurring/exceptions").then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  if (!data) return null;
  const { counts } = data;
  const nothing = !counts.failedCards && !counts.aboutToLapse && !counts.pendingProposals && !counts.anniversaries;

  const donorRow = (item, detail, danger = false) => (
    <div key={(item.subId || item.id) + (item.date || "")} {...interactive(() => onNavigate("donors", { selectDonorId: item.donorId }), { label: `Open ${item.donorName}` })}
      style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 10px", borderRadius: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{item.donorName}</span>
      <span style={{ fontSize: 12, color: danger ? T.terra700 : T.ink3 }}>{detail}</span>
    </div>
  );

  const section = (title, count, accent, rows) => (
    <div style={{ background: T.bgCard, border: `1px solid ${count ? accent : T.bg3}`, borderRadius: 12, padding: "14px 14px 10px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 10px 6px" }}>
        <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Serif Display',serif", color: count ? T.ink : T.ink3 }}>{count}</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{title}</span>
      </div>
      {rows.length ? rows : <div style={{ padding: "0 10px 6px", fontSize: 12, color: T.ink3 }}>None right now.</div>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {nothing && (
        <div style={{ background: T.bgCard, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: "18px 20px", fontSize: 13.5, color: T.ink2 }}>
          Nothing needs you — no failed cards, nothing about to lapse, no proposals waiting on a donor.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }} className="dash-rec-grid">
        {section("Cards just failed", counts.failedCards, T.terra200,
          data.failedCards.map(s => donorRow(s, `${money(s.amount)}${per(s.interval)} · failed ${s.lastFailedAt ? fmtDate(s.lastFailedAt) : "recently"}`, true)))}
        {section("About to lapse", counts.aboutToLapse, T.terra200,
          data.aboutToLapse.map(s => donorRow(s, `${money(s.amount)}${per(s.interval)} · recovery emails exhausted`, true)))}
        {section("Waiting on a donor", counts.pendingProposals, T.gold300,
          data.pendingProposals.map(p => donorRow(p, `${p.kind === "create" ? "new gift invitation" : p.kind === "card_update" ? "card update" : "proposed change"} · expires ${fmtDate(p.expiresAt)}`)))}
        {section("Sustainer anniversaries", counts.anniversaries, T.gold300,
          data.anniversaries.map(a => donorRow(a, `${a.years} year${a.years === 1 ? "" : "s"} on ${fmtDate(a.date)} · ${money(a.amount)}${per(a.interval)} — worth a note`)))}
      </div>
      <div>
        <button onClick={() => onNavigate("fundraising", { frSection: "recurring" })}
          style={{ background: T.gold500, border: "none", borderRadius: 10, padding: "11px 20px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Open Recurring Giving
        </button>
      </div>
    </div>
  );
}

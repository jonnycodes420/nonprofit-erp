// CAPTURE-1 · ONE CARD IN "TO CONFIRM". The document on the left, what Steward
// read on the right, one question and one button. Every field can be changed
// in place before the tap, and nothing is logged until that tap: a gift or a
// pledge is always this card first. A guess is never made silently. A donor
// with several possible records shows the choices, an unsure fund is drawn in
// brass, and an amount the two readings of a check do not agree on is blank.
import { useState } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";

const KIND_LABEL = {
  check: "check", pledge: "pledge", daf_grant: "donor-advised fund grant", matching_gift: "matching gift",
  stock_gift: "stock gift", address_change: "address change", email_change: "email change", note: "note",
  document: "document", other: "document",
};
const SKIP_REASONS = [
  ["duplicate", "It's a duplicate"],
  ["not_a_gift", "It isn't a gift"],
  ["already_entered", "Already entered by hand"],
  ["other", "Something else"],
];
const FREQUENCIES = [["one_time", "All at once"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annually", "Yearly"]];

const money = c => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toCents = s => {
  const t = String(s ?? "").replace(/[$,\s]/g, "");
  if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
const centsToInput = c => (c == null ? "" : (Number(c) / 100).toFixed(2));
// A check is dated the way people write: 10/14/2026, or October 9, 2026.
// Month first (US checks); a date that cannot be read stays blank, never today.
const isoDate = s => {
  const t = String(s || "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m) return m[1];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (us) {
    const y = us[3].length === 2 ? "20" + us[3] : us[3];
    const mo = Number(us[1]), d = Number(us[2]);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
  }
  const named = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (named) {
    const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return mo ? `${named[3]}-${String(mo).padStart(2, "0")}-${String(Number(named[2])).padStart(2, "0")}` : "";
  }
  return "";
};

const label = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3 };
const input = { width: "100%", boxSizing: "border-box", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.ink, fontFamily: "inherit" };
const attention = { border: "2px solid " + T.gold, background: T.gold50 };
const linkBtn = { background: "none", border: "none", padding: 0, color: T.green, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" };

function Field({ title, children, wide }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: wide ? "1 1 100%" : "1 1 150px", minWidth: 0 }}>
      <span style={label}>{title}</span>
      {children}
    </label>
  );
}

function DocumentPane({ card }) {
  const isPdf = /pdf/i.test(card.contentType || "") || /\.pdf$/i.test(card.fileName || "");
  if (!card.fileUrl) {
    return <div style={{ padding: 24, color: T.ink3, fontSize: 13, background: T.bg, borderRadius: 10 }}>No file is stored for this card.</div>;
  }
  if (isPdf) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <iframe title={card.fileName || "Document"} src={card.fileUrl} className="capture-doc-frame"
          style={{ width: "100%", border: "1px solid " + T.bg2, borderRadius: 10, background: T.white }} />
        <a href={card.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: T.green, fontWeight: 700 }}>
          Open {card.fileName || "the document"}{card.page ? `, page ${card.page}` : ""}
        </a>
      </div>
    );
  }
  return (
    <a href={card.fileUrl} target="_blank" rel="noreferrer" title="Open the full image" style={{ display: "block" }}>
      <img src={card.fileUrl} alt={`The ${KIND_LABEL[card.kind] || "document"} as it arrived`} className="capture-doc-img"
        style={{ width: "100%", objectFit: "contain", borderRadius: 10, border: "1px solid " + T.bg2, background: T.bg, display: "block" }} />
    </a>
  );
}

function DonorPicker({ card, value, onChange, isReadOnly }) {
  const d = card.donor || { state: "new", choices: [], prefill: {} };
  const p = value.newPerson;
  const setNew = (k, v) => onChange({ ...value, newPerson: { ...p, [k]: v } });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 100%" }}>
      <span style={label}>From</span>
      {d.state === "matched" && value.mode === "existing" && (
        <div data-testid="capture-match" style={{ fontSize: 14, color: T.ink }}>
          <strong>{(d.choices.find(c => c.id === value.donorId) || d.choices[0] || {}).name || "A person in Steward"}</strong>
          {d.sentence && value.donorId === d.selectedId ? (
            <div style={{ color: T.ink3, fontSize: 12.5, marginTop: 2 }}>{d.sentence}</div>
          ) : (d.choices.find(c => c.id === value.donorId) || d.choices[0] || {}).why && (
            <span style={{ color: T.ink3, fontSize: 12.5 }}> · {(d.choices.find(c => c.id === value.donorId) || d.choices[0]).why}</span>
          )}
          {d.credit && value.donorId === d.selectedId && (
            <div data-testid="capture-joint" style={{ fontSize: 12.5, color: T.ink, marginTop: 4, lineHeight: 1.5 }}>{d.credit.sentence}</div>
          )}
        </div>
      )}
      {d.state !== "matched" && value.mode !== "new" && (
        <div role="radiogroup" aria-label="Which person is this?" data-testid="capture-choices"
          style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8, borderRadius: 8, ...(value.donorId ? {} : attention) }}>
          <div style={{ fontSize: 12.5, color: T.ink }}>
            {d.sentence || (d.state === "choices" ? "More than one person in Steward could be this. Pick one." : "Nobody in Steward matches. Pick who this is from.")}
          </div>
          {d.choices.map(c => (
            <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, color: T.ink, cursor: "pointer" }}>
              <input type="radio" name={`donor-${card.id}`} checked={value.donorId === c.id} disabled={isReadOnly}
                onChange={() => onChange({ ...value, mode: "existing", donorId: c.id })} />
              <span>{c.name}{c.why || c.history ? <span style={{ color: T.ink3, fontSize: 12 }}> · {[c.why, c.history].filter(Boolean).join(", ")}</span> : null}</span>
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, color: T.ink, cursor: "pointer" }}>
            <input type="radio" name={`donor-${card.id}`} checked={false} disabled={isReadOnly} data-testid="capture-new-donor"
              onChange={() => onChange({ ...value, mode: "new", donorId: null })} />
            <span>New donor{p.name ? `: ${p.name}` : ""}</span>
          </label>
        </div>
      )}
      {value.mode === "new" && (
        <div data-testid="capture-new-person" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10, borderRadius: 8, background: T.bg }}>
          <div style={{ flex: "1 1 100%", fontSize: 12.5, color: T.ink }}>
            A new donor, added when you log it.
          </div>
          <Field title="Name" wide><input style={input} value={p.name || ""} disabled={isReadOnly} onChange={e => setNew("name", e.target.value)} /></Field>
          <Field title="Email"><input style={input} type="email" value={p.email || ""} disabled={isReadOnly} onChange={e => setNew("email", e.target.value)} /></Field>
          <Field title="Street"><input style={input} value={p.line1 || ""} disabled={isReadOnly} onChange={e => setNew("line1", e.target.value)} /></Field>
          <Field title="City"><input style={input} value={p.city || ""} disabled={isReadOnly} onChange={e => setNew("city", e.target.value)} /></Field>
          <Field title="State"><input style={input} value={p.state || ""} disabled={isReadOnly} onChange={e => setNew("state", e.target.value)} /></Field>
          <Field title="ZIP"><input style={input} value={p.postal || ""} disabled={isReadOnly} onChange={e => setNew("postal", e.target.value)} /></Field>
        </div>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {value.mode === "existing" && d.state === "matched" && (
          <button type="button" style={linkBtn} disabled={isReadOnly} onClick={() => onChange({ ...value, mode: "new" })}>It's someone new</button>
        )}
        {value.mode === "new" && (
          <button type="button" style={linkBtn} disabled={isReadOnly}
            onClick={() => onChange({ ...value, mode: d.state === "matched" ? "existing" : "pick", donorId: d.state === "matched" ? (d.selectedId || d.choices[0].id) : null })}>
            {d.choices.length ? "Use a person already in Steward" : "Back"}
          </button>
        )}
      </div>
    </div>
  );
}

function initialDonor(card) {
  const d = card.donor || { state: "new", choices: [], prefill: {} };
  const prefill = { name: "", email: "", line1: "", city: "", state: "", postal: "", ...(d.prefill || {}) };
  if (d.state === "matched") return { mode: "existing", donorId: d.selectedId || (d.choices[0] && d.choices[0].id) || null, newPerson: prefill };
  // CHECK-2: with no clear match, nobody is chosen. "New donor" is a choice
  // she makes, never the silent default.
  return { mode: "pick", donorId: null, newPerson: prefill };
}

export function CaptureCard({ card, funds, isReadOnly, onChanged, onOpenThanks }) {
  const r = card.read || {};
  const isMoney = card.stakes === "money";
  const [amount, setAmount] = useState(centsToInput(card.amount && card.amount.cents));
  const [date, setDate] = useState(isoDate(r.date) || isoDate(card.receivedAt) || new Date().toISOString().slice(0, 10));
  const [fundId, setFundId] = useState((card.fund && card.fund.id) || "");
  const [fundTouched, setFundTouched] = useState(false);
  const [donor, setDonor] = useState(() => initialDonor(card));
  const [frequency, setFrequency] = useState(() => {
    const f = String(r.frequency || "").toLowerCase();
    return /month/.test(f) ? "monthly" : /quarter/.test(f) ? "quarterly" : /year|annual/.test(f) ? "annually" : "one_time";
  });
  const [installments, setInstallments] = useState(r.installments ? String(r.installments) : "");
  const [startDate, setStartDate] = useState(isoDate(r.startDate));
  const matchChoices = (card.matches && Array.isArray(card.matches.choices)) ? card.matches.choices : [];
  const advisorId = card.advisor && card.advisor.state === "matched" ? card.advisor.selectedId : null;
  const [matchesGiftId, setMatchesGiftId] = useState((card.matches && card.matches.giftId) || "");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("duplicate");
  const [skipText, setSkipText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  // VOICE-2: a check made out to somebody else waits for "Log it anyway".
  const payeeOff = isMoney && card.payee && card.payee.mismatch;
  const [logAnyway, setLogAnyway] = useState(false);
  // CHECK-2: what the memo said, offered and kept unless she unticks it.
  const [tributeOn, setTributeOn] = useState(!!card.tribute);
  const [pledgeOn, setPledgeOn] = useState(!!(card.pledge && card.pledge.pledgeId));

  const cents = toCents(amount);
  const amountBlank = cents == null;
  const fundUnsure = card.fund && card.fund.unsure && !fundTouched;
  const donorReady = donor.mode === "new" ? !!(donor.newPerson.name || "").trim() : !!donor.donorId;
  const canConfirm = !isReadOnly && !busy && donorReady && (!isMoney || (!amountBlank && cents > 0)) && (!payeeOff || logAnyway);
  const what = KIND_LABEL[card.kind] || "item";
  const btnLabel = isMoney
    ? (amountBlank ? `Log this ${what}` : `Log ${money(cents)} ${card.kind === "pledge" ? "pledge" : what}`)
    : "Confirm";

  const confirm = async () => {
    setBusy(true); setErr("");
    const body = { kind: card.kind, amountCents: cents, date, fundId: fundId || null };
    if (payeeOff && logAnyway) body.logAnyway = true;
    if (card.tribute && !tributeOn) body.tribute = null;
    if (card.pledge && !pledgeOn) body.applyPledge = false;
    if (donor.mode === "new") body.newPerson = donor.newPerson; else body.donorId = donor.donorId;
    if (card.kind === "pledge") { body.frequency = frequency; body.installments = installments ? Number(installments) : null; body.startDate = startDate || null; }
    if (card.kind === "matching_gift" && matchesGiftId) body.matchesGiftId = matchesGiftId;
    if (card.kind === "daf_grant" && advisorId) body.advisorDonorId = advisorId;
    try {
      // A low-stakes card that needed a choice is applied, never "logged".
      const resp = isMoney
        ? await apiFetch(`/capture/${encodeURIComponent(card.id)}/confirm`, { method: "POST", body: JSON.stringify(body) })
        : await apiFetch(`/capture/${encodeURIComponent(card.id)}/apply`, { method: "POST", body: JSON.stringify({ donorId: body.donorId }) });
      setDone(resp);
      onChanged && onChanged({ silent: true, batch: resp && resp.batch });
    } catch (e) { setErr(errorMessage(e, "This could not be logged. Nothing was saved; try again.")); }
    setBusy(false);
  };

  const skip = async () => {
    setBusy(true); setErr("");
    const reason = skipReason === "other" ? (skipText.trim() || "other") : skipReason;
    try {
      await apiFetch(`/capture/${encodeURIComponent(card.id)}/skip`, { method: "POST", body: JSON.stringify({ reason }) });
      setSkipOpen(false);
      onChanged && onChanged();
      offerUndo({
        message: `Skipped the ${what}. It is under Skipped in To confirm.`,
        listed: true,   // FIX-45: Recent changes lists a skipped card from the server
        undoAction: () => apiFetch(`/capture/${encodeURIComponent(card.id)}/unskip`, { method: "POST" }),
      }, what, () => onChanged && onChanged());
    } catch (e) { setErr(errorMessage(e, "It could not be skipped. Try again.")); }
    setBusy(false);
  };

  if (done) {
    return (
      <div data-testid="capture-card" data-card-id={card.id} data-card-state="confirmed"
        style={{ background: T.white, border: "1px solid " + T.bg2, borderLeft: "4px solid " + T.green, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div data-testid="capture-result" style={{ fontSize: 14.5, color: T.ink, lineHeight: 1.5 }}>{done.sentence || "Logged."}</div>
        {done.thankYouDraft && done.thankYouDraft.body && (
          <div data-testid="capture-draft" style={{ background: T.bg, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: T.ink, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            <div style={{ ...label, marginBottom: 6 }}>The thank-you draft, not sent</div>
            {done.thankYouDraft.body}
          </div>
        )}
        {done.thankYouDraftId && onOpenThanks && (
          <div><button type="button" style={linkBtn} data-testid="capture-open-thanks" onClick={onOpenThanks}>Read and send it from your thank-you list</button></div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="capture-card" data-card-id={card.id} data-card-kind={card.kind} className="capture-card"
      style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: 16 }}>
      <div className="capture-card-grid">
        <div className="capture-card-doc"><DocumentPane card={card} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3 }}>
              {what}{card.source === "email" ? " · from email" : card.source === "forward" ? " · forwarded" : card.source === "photo" ? " · photo" : ""}
            </div>
            <div data-testid="capture-headline" style={{ fontSize: 17, fontWeight: 700, color: T.ink, lineHeight: 1.35 }}>{card.headline}</div>
            {card.sentence && <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>{card.sentence}</div>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {isMoney && (
              <Field title="Amount">
                <input style={{ ...input, ...(amountBlank ? attention : {}) }} inputMode="decimal" placeholder="0.00" value={amount}
                  data-testid="capture-amount" disabled={isReadOnly} onChange={e => setAmount(e.target.value)} />
              </Field>
            )}
            <Field title={card.kind === "pledge" ? "Pledge date" : "Date"}>
              <input style={input} type="date" value={date} disabled={isReadOnly} onChange={e => setDate(e.target.value)} />
            </Field>
            {isMoney && (
              <Field title="Fund">
                <select style={{ ...input, ...(fundUnsure ? attention : {}) }} value={fundId} data-testid="capture-fund" disabled={isReadOnly}
                  onChange={e => { setFundId(e.target.value); setFundTouched(true); }}>
                  {!fundId && <option value="">Choose a fund</option>}
                  {(funds || []).filter(f => !f.retired_at || f.id === fundId).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          {payeeOff && (
            <div data-testid="capture-payee" style={{ fontSize: 13.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700 }}>{card.payee.sentence}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 13, cursor: isReadOnly ? "default" : "pointer", minHeight: 32 }}>
                <input type="checkbox" data-testid="capture-log-anyway" checked={logAnyway} disabled={isReadOnly || busy} onChange={e => setLogAnyway(e.target.checked)} />
                Log it anyway
              </label>
            </div>
          )}
          {isMoney && card.amount && !card.amount.settled && card.amount.sentence && (
            <div data-testid="capture-amount-note" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, lineHeight: 1.5 }}>{card.amount.sentence}</div>
          )}
          {isMoney && fundUnsure && card.fund.why && (
            <div style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, lineHeight: 1.5 }}>{card.fund.why}</div>
          )}
          {isMoney && card.tribute && (
            <label data-testid="capture-tribute" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink, cursor: isReadOnly ? "default" : "pointer", minHeight: 32 }}>
              <input type="checkbox" checked={tributeOn} disabled={isReadOnly || busy} onChange={e => setTributeOn(e.target.checked)} />
              {card.tribute.sentence} Keep it on the gift.
            </label>
          )}
          {isMoney && card.pledge && (card.pledge.pledgeId ? (
            <label data-testid="capture-pledge" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink, cursor: isReadOnly ? "default" : "pointer", minHeight: 32 }}>
              <input type="checkbox" checked={pledgeOn} disabled={isReadOnly || busy || donor.donorId !== (card.donor && card.donor.selectedId)} onChange={e => setPledgeOn(e.target.checked)} />
              {card.pledge.sentence}
            </label>
          ) : (
            <div data-testid="capture-pledge" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, lineHeight: 1.5 }}>{card.pledge.sentence}</div>
          ))}
          {card.kind === "pledge" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Field title="Paid">
                <select style={input} value={frequency} disabled={isReadOnly} onChange={e => setFrequency(e.target.value)}>
                  {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {frequency !== "one_time" && (
                <Field title="Payments">
                  <input style={input} inputMode="numeric" value={installments} disabled={isReadOnly} onChange={e => setInstallments(e.target.value.replace(/\D/g, ""))} />
                </Field>
              )}
              <Field title="First payment">
                <input style={input} type="date" value={startDate} disabled={isReadOnly} onChange={e => setStartDate(e.target.value)} />
              </Field>
            </div>
          )}
          {card.kind === "daf_grant" && (
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
              {r.advisorName && advisorId
                ? <>The gift is logged from the fund, with soft credit to <strong>{r.advisorName}</strong>, the advisor the letter names.</>
                : r.advisorName
                  ? <>The letter names <strong>{r.advisorName}</strong> as the advisor, who isn't in Steward yet, so no soft credit is added. Add them and give the credit from the gift.</>
                  : "The letter names no advisor, so no soft credit is added."}
            </div>
          )}
          {card.kind === "matching_gift" && (
            <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 6 }}>
              {matchChoices.length > 0 ? (
                <>
                  <span>Which gift does this match?</span>
                  <select style={{ ...input, ...(matchesGiftId ? {} : attention) }} value={matchesGiftId} disabled={isReadOnly} onChange={e => setMatchesGiftId(e.target.value)}>
                    <option value="">Choose the original gift</option>
                    {matchChoices.map(g => <option key={g.id} value={g.id}>{money(g.amountCents)} on {g.date}</option>)}
                  </select>
                </>
              ) : (
                <span>Steward couldn't find the gift this matches, so it can't be logged yet. Log the original gift first, or skip this.</span>
              )}
            </div>
          )}
          <DonorPicker card={card} value={donor} onChange={setDonor} isReadOnly={isReadOnly} />
          {err && <div style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{err}</div>}
          {skipOpen ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", padding: 10, background: T.bg, borderRadius: 10 }}>
              <Field title="Why skip it?">
                <select style={input} value={skipReason} onChange={e => setSkipReason(e.target.value)} data-testid="capture-skip-reason">
                  {SKIP_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {skipReason === "other" && (
                <Field title="Say why"><input style={input} value={skipText} onChange={e => setSkipText(e.target.value)} /></Field>
              )}
              <button type="button" data-testid="capture-skip-go" disabled={busy} onClick={skip}
                style={{ background: T.white, border: "1px solid " + T.ink, borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>Skip it</button>
              <button type="button" style={linkBtn} onClick={() => setSkipOpen(false)}>Keep it</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" data-testid="capture-confirm" disabled={!canConfirm} onClick={confirm}
                style={{ background: T.green, color: T.white, border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 700,
                         cursor: canConfirm ? "pointer" : "not-allowed", opacity: canConfirm ? 1 : 0.5, fontFamily: "inherit" }}>
                {busy ? "Logging…" : btnLabel}
              </button>
              <button type="button" data-testid="capture-skip" disabled={isReadOnly || busy} onClick={() => setSkipOpen(true)}
                style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: T.ink2, cursor: "pointer", fontFamily: "inherit" }}>
                Skip
              </button>
              {isMoney && !canConfirm && !isReadOnly && (
                <span style={{ fontSize: 12, color: T.ink3 }}>
                  {amountBlank ? "Fill in the amount from the image." : !donorReady ? "Choose who it is from." : payeeOff && !logAnyway ? "This check is made out to someone else. Tick Log it anyway to log it." : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

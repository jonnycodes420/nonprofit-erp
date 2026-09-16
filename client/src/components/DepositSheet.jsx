// BUILD-88b B.1 — THE DEPOSIT SHEET.
//
// A treasurer's Monday. She has a bank slip: a date, a total, and eleven lines
// of name / amount / memo. Before this, that was eleven trips through the gift
// form and nothing to tell her she had finished except adding it up herself.
//
// The screen has one shape: paste the slip, read what Steward can and cannot
// place, answer the short list, and press a button that says exactly what it is
// about to do. **Nothing is placed by guess** — the two states Steward will act
// on are the two it can state as facts, and everything else is a question.
//
// THE FOUR LINE STATES, IN THE FOUR COLOURS (the standing design rule):
//   ink         placed — a person on file and a fund the memo named
//   emerald     placed as a new donor — nobody on file answers to this name
//   brass       needs you — the short list, each with the answer it needs
//   warm grey   not a gift — a refund, a transfer, a store deposit, a subtotal
//
// The commit button is dead until the list is empty AND the cents add up; the
// server refuses the same two ways, so a stale tab cannot record a slip that
// does not foot. Nothing here sends anything.
import { useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T, Modal, fmtFull } from "./shared";
import { errorMessage, rethrowProgrammerError } from "../lib/domainError";

const STATE_META = {
  placed:           { label: "Placed",     colour: T.ink,      note: "" },
  placed_new_donor: { label: "New donor",  colour: T.greenDk,  note: "Nobody on file answers to this name. Steward will add them." },
  needs_you:        { label: "Needs you",  colour: T.gold600 || "#a97f22", note: "" },
  not_a_gift:       { label: "Not a gift", colour: T.ink3,     note: "Recorded on the record as a payment, out of every giving total." },
};
const cents = c => fmtFull((Number(c) || 0) / 100);

export function DepositSheetModal({ onClose, onRecorded, today }) {
  const [paste, setPaste] = useState("");
  const [depositDate, setDepositDate] = useState(today || new Date().toISOString().slice(0, 10));
  const [slipTotal, setSlipTotal] = useState("");
  const [plan, setPlan] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const askPlan = async (nextResolutions = resolutions) => {
    if (!paste.trim()) { setErr("Paste the slip's lines first."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/deposits/plan", { method: "POST", body: JSON.stringify({
        paste, depositDate, slipTotal: slipTotal === "" ? null : slipTotal, resolutions: nextResolutions }) });
      setPlan(r);
    } catch (e) { rethrowProgrammerError(e); setErr(errorMessage(e, "Steward could not read that slip.")); }
    setBusy(false);
  };

  // Every answer re-asks the server, because an answer can change another
  // line's state (a fund chosen once is not a rule, but a donor chosen can
  // reveal an instalment). The plan is the ONE authority on what will happen.
  const resolve = (line, patch) => {
    const next = { ...resolutions, [String(line)]: { ...(resolutions[String(line)] || {}), ...patch } };
    setResolutions(next);
    if (plan) askPlan(next);
  };

  const readFile = async (file) => {
    if (!file) return;
    setErr("");
    try {
      const text = await file.text();
      // A small CSV is the same table a paste is; the mapper reads both.
      setPaste(text.trim());
    } catch (e) { rethrowProgrammerError(e); setErr("That file could not be read as text. Paste the rows instead."); }
  };

  const commit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/deposits/commit", { method: "POST", body: JSON.stringify({
        paste, depositDate, slipTotal, resolutions }) });
      setDone(r);
      if (onRecorded) onRecorded(r);
    } catch (e) {
      rethrowProgrammerError(e);
      setErr(errorMessage(e, "Steward could not record that deposit."));
    }
    setBusy(false);
  };

  const needsYou = useMemo(() => (plan?.lines || []).filter(l => l.state === "needs_you"), [plan]);
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 11px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5, display: "block" };

  if (done) {
    return (
      <Modal onClose={onClose} width={620} ariaLabel="Deposit recorded" padding={26}>
        <div>
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, color: T.ink, marginBottom: 6 }}>
            {cents(done.giftCents)} recorded, in {done.gifts} gift{done.gifts === 1 ? "" : "s"}.
          </div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
            {done.donorsCreated > 0 && <>{done.donorsCreated} new {done.donorsCreated === 1 ? "person" : "people"} added. </>}
            {done.payments > 0 && <>{done.payments} line{done.payments === 1 ? "" : "s"} recorded as {done.payments === 1 ? "a payment" : "payments"}, out of every giving total. </>}
            {done.installmentsApplied > 0 && <>{done.installmentsApplied} pledge instalment{done.installmentsApplied === 1 ? "" : "s"} applied. </>}
            The slip said {cents(done.slipCents)} and the lines come to {cents(done.giftCents + done.notGiftCents)}.
            {done.footed ? " It foots." : " The database and the plan disagree — open the deposit on the Imports page."}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 18 }}>
            Nothing was sent. The thank-yous this earns are waiting on Home.
            This deposit can be undone as a whole for the next 24 hours, from Settings → Imports.
          </div>
          <button onClick={onClose} style={{ background: T.greenDk, border: "none", borderRadius: 9, padding: "10px 18px", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} width={plan ? 820 : 560} ariaLabel="Add a deposit" padding={26}>
      <div>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: T.ink, marginBottom: 2 }}>Add a deposit</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 16 }}>
          The slip's date and total, then its lines. Steward places what it can stand behind and asks about the rest.
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 170px" }}>
            <span style={lbl}>Deposit date</span>
            <input type="date" value={depositDate} max={today || undefined} onChange={e => setDepositDate(e.target.value)} style={{ ...inp, width: "100%" }} aria-label="Deposit date" />
          </div>
          <div style={{ flex: "0 1 170px" }}>
            <span style={lbl}>Slip total</span>
            <input value={slipTotal} onChange={e => setSlipTotal(e.target.value)} inputMode="decimal"
              placeholder="e.g. 4,973.83" aria-label="Slip total" data-testid="deposit-slip-total" style={{ ...inp, width: "100%" }} />
          </div>
        </div>

        {!plan && (<>
          <div style={{ marginBottom: 12 }}>
            <span style={lbl}>The lines</span>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} data-testid="deposit-paste"
              aria-label="Deposit lines"
              placeholder={"One line per cheque. Name, amount, memo.\n\nMargaret Chen\t250.00\tXenia trip\nWilliam Park\t1,000.00\tck 4417  General Operating"}
              style={{ ...inp, width: "100%", minHeight: 170, resize: "vertical", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12.5 }} />
            <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 5 }}>
              Tabs, two spaces or commas between the columns. Or{" "}
              <button onClick={() => fileRef.current?.click()} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>open a CSV</button>.
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" onChange={e => readFile(e.target.files?.[0])} style={{ display: "none" }} />
            </div>
          </div>
          {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700, marginBottom: 10 }}>{err}</div>}
          <button onClick={() => askPlan()} disabled={busy || !paste.trim()} data-testid="deposit-read"
            style={{ background: busy || !paste.trim() ? T.bg2 : T.greenDk, border: "none", borderRadius: 9, padding: "10px 18px", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy || !paste.trim() ? "not-allowed" : "pointer", opacity: busy || !paste.trim() ? 0.6 : 1 }}>
            {busy ? "Reading…" : "Read the slip"}
          </button>
        </>)}

        {plan && (<>
          {/* WHAT STEWARD CAN AND CANNOT PLACE, in the four colours. */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12, fontSize: 12.5 }}>
            {["placed", "placed_new_donor", "needs_you", "not_a_gift"].map(k => {
              const n = (plan.lines || []).filter(l => l.state === k).length;
              if (!n) return null;
              return <span key={k} style={{ color: STATE_META[k].colour, fontWeight: 700 }}>{n} {STATE_META[k].label.toLowerCase()}</span>;
            })}
          </div>

          <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {(plan.lines || []).map(l => {
                  const m = STATE_META[l.state] || STATE_META.placed;
                  return (
                    <tr key={l.line} data-deposit-line={l.line} data-deposit-state={l.state} style={{ borderTop: "1px solid " + T.bg3 }}>
                      <td style={{ padding: "9px 12px", width: 90, color: m.colour, fontWeight: 800, verticalAlign: "top" }}>{m.label}</td>
                      <td style={{ padding: "9px 12px", verticalAlign: "top" }}>
                        <div style={{ color: T.ink, fontWeight: 600 }}>{l.donorName || l.name || <em style={{ color: T.ink3 }}>no name</em>}</div>
                        <div style={{ color: T.ink3, marginTop: 2 }}>
                          {l.memo || <em>no memo</em>}{l.check ? ` · check ${l.check}` : ""}
                          {l.fundName ? <> · <span style={{ color: T.ink2 }}>{l.fundName}</span></> : null}
                          {l.installmentId ? " · pledge payment" : ""}
                        </div>
                        {l.state === "needs_you" && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ color: STATE_META.needs_you.colour, fontWeight: 600, marginBottom: 6 }}>{l.needs}</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {Array.isArray(l.funds) && l.funds.length > 0 && (
                                <select defaultValue="" data-testid={`deposit-fund-${l.line}`} aria-label={`Fund for line ${l.line}`}
                                  onChange={e => e.target.value && resolve(l.line, { fundId: e.target.value })} style={{ ...inp, padding: "6px 8px", fontSize: 12 }}>
                                  <option value="">Which fund?</option>
                                  {l.funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                              )}
                              {Array.isArray(l.candidates) && l.candidates.map(cd => (
                                <button key={cd.id} onClick={() => resolve(l.line, { donorId: cd.id })}
                                  style={{ background: "transparent", border: "1px solid " + T.greenDk, borderRadius: 7, padding: "5px 10px", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{cd.name}</button>
                              ))}
                              {Array.isArray(l.fundCandidates) && l.fundCandidates.map(fc => (
                                <button key={fc.fundId} onClick={() => resolve(l.line, { fundId: fc.fundId })}
                                  style={{ background: "transparent", border: "1px solid " + T.greenDk, borderRadius: 7, padding: "5px 10px", color: T.greenDk, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{fc.fundName}</button>
                              ))}
                              {l.nearInstallmentId && (<>
                                <button onClick={() => resolve(l.line, { installmentId: l.nearInstallmentId })}
                                  style={{ background: T.greenDk, border: "none", borderRadius: 7, padding: "5px 10px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>It is that instalment</button>
                                <button onClick={() => resolve(l.line, { installmentId: null })}
                                  style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 10px", color: T.ink3, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>A separate gift</button>
                              </>)}
                              {l.reason === "no_name" || l.reason === "unreadable_amount" || l.reason === "unreadable_line" ? null : (
                                <button onClick={() => resolve(l.line, { notAGift: true })}
                                  style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "5px 10px", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Not a gift</button>
                              )}
                            </div>
                          </div>
                        )}
                        {m.note && l.state !== "needs_you" && <div style={{ color: T.ink3, marginTop: 3, fontSize: 11.5 }}>{m.note}</div>}
                        {l.state === "not_a_gift" && (
                          <button onClick={() => resolve(l.line, { isGift: true, notAGift: false })}
                            style={{ background: "none", border: "none", padding: 0, marginTop: 4, color: T.greenDk, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>It is a gift</button>
                        )}
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right", width: 110, color: T.ink, fontWeight: 700, whiteSpace: "nowrap", verticalAlign: "top" }}>
                        {l.cents == null ? <span style={{ color: T.ink3 }}>{l.amount}</span> : cents(l.cents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* THE ARITHMETIC, SHOWN. Not a reassurance that it worked. */}
          <div data-testid="deposit-balance" style={{ fontSize: 12.5, color: plan.balanced === false ? (T.terra700 || "#8a3a24") : T.ink3, marginBottom: 12, lineHeight: 1.6 }}>
            {cents(plan.totals.giftCents)} in gifts
            {plan.totals.notGiftCents ? ` + ${cents(plan.totals.notGiftCents)} not gifts` : ""}
            {plan.totals.needsCents ? ` + ${cents(plan.totals.needsCents)} still to answer` : ""}
            {plan.totals.slipCents == null
              ? " · type the slip total so Steward can check its own arithmetic"
              : ` = ${cents(plan.totals.giftCents + plan.totals.notGiftCents + plan.totals.needsCents)} against a slip of ${cents(plan.totals.slipCents)}`}
            {plan.balanced === true && <span style={{ color: T.greenDk, fontWeight: 700 }}> · it foots</span>}
            {plan.balanced === false && <span style={{ fontWeight: 700 }}> · it does not foot</span>}
          </div>

          {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={commit} disabled={busy || !plan.canCommit} data-testid="deposit-commit"
              title={needsYou.length ? `${needsYou.length} line${needsYou.length === 1 ? "" : "s"} still need you` : undefined}
              style={{ background: busy || !plan.canCommit ? T.bg2 : T.greenDk, border: "none", borderRadius: 9, padding: "11px 20px", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy || !plan.canCommit ? "not-allowed" : "pointer", opacity: busy || !plan.canCommit ? 0.6 : 1 }}>
              {busy ? "Recording…" : plan.commitLabel}
            </button>
            <button onClick={() => { setPlan(null); setResolutions({}); }} disabled={busy}
              style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 9, padding: "11px 16px", color: T.ink3, fontSize: 13, cursor: "pointer" }}>← Back to the lines</button>
          </div>
        </>)}
      </div>
    </Modal>
  );
}

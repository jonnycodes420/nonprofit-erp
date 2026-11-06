// components/profile/ReceiptsAndStatements.jsx · FLOWS-1 item 4. A STATEMENT
// OR A RECEIPT ENDS WITH SOMETHING ON SCREEN.
//
// The Year-end statement defaulted to last tax year (often a year with no
// gifts), and "Generate & email" emailed it and closed after ~8 s showing
// nothing. Send receipt did the same for one gift. Now each is MADE first and
// shown: the statement with the org's name, every gift's date and amount and
// the total, then Download PDF and Email it; a receipt says "Receipt #N ready
// · Download · Email". Nothing is emailed without that last click.
//
// Moved out of DonorProfile.jsx (at its size cap) as one hook and two parts.
import { useEffect, useRef, useState } from "react";
import { API, apiFetch, getToken } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, fmtFull } from "../shared";
import { receiptOffered } from "../../../../shared/giftWords.js";   // FEEL-1

const linkBtn = { background: "none", border: "none", padding: "2px 4px", color: T.greenDk, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, fontFamily: "inherit" };
const yearOf = d => (d ? String(d).slice(0, 4) : "");

// The year a statement should open on: this year if it has gifts, else the
// most recent year that does, else this year.
export function defaultStatementYear(gifts, thisYear) {
  const years = [...new Set((gifts || []).filter(g => Number(g.amount) > 0).map(g => yearOf(g.date)).filter(y => /^\d{4}$/.test(y) && Number(y) <= thisYear))].sort();
  if (years.includes(String(thisYear))) return String(thisYear);
  return years.length ? years[years.length - 1] : String(thisYear);
}

export function useReceipts(donor, gifts) {
  const [donorReceipts, setDonorReceipts] = useState([]);
  const [receiptsEnabled, setReceiptsEnabled] = useState(false);
  const [receiptBusyId, setReceiptBusyId] = useState(null);
  const [receiptNote, setReceiptNote] = useState({});   // receipt id -> what Email did
  const loadDonorReceipts = () => apiFetch(`/donors/${donor.id}/receipts`).then(r => setDonorReceipts(r || [])).catch(() => setDonorReceipts([]));
  useEffect(() => {
    loadDonorReceipts();
    apiFetch("/org").then(o => setReceiptsEnabled(!!o.receipts_enabled)).catch(() => {});
  }, [donor.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const receiptForGift = giftId => donorReceipts.find(r => r.gift_id === giftId && !r.voided_at);

  // Make the receipt; it is emailed only from its own Email link.
  const sendReceipt = async giftId => {
    setReceiptBusyId(giftId);
    try {
      await apiFetch(`/gifts/${giftId}/receipt`, { method: "POST", body: JSON.stringify({ send: false }) });
      await loadDonorReceipts();
    } catch (e) { setReceiptNote(n => ({ ...n, ["gift:" + giftId]: (e && (e.sentence || e.message)) || errorMessage(e, "The receipt was not made.") })); }
    setReceiptBusyId(null);
  };
  const emailReceipt = async receiptId => {
    setReceiptBusyId(receiptId);
    try {
      const r = await apiFetch(`/receipts/${receiptId}/email`, { method: "POST", body: "{}" });
      setReceiptNote(n => ({ ...n, [receiptId]: r.sentence }));
      await loadDonorReceipts();
    } catch (e) { setReceiptNote(n => ({ ...n, [receiptId]: (e && e.sentence) || errorMessage(e, "That did not send.") })); }
    setReceiptBusyId(null);
  };
  // TRUTH-2: a receipt that should not stand is voided, never deleted: it is
  // marked void, her note is kept on it, and its number is never used again
  // (the org's receipt counter only goes up). Then the gift can be removed.
  const voidReceipt = async (receiptId, note) => {
    setReceiptBusyId(receiptId);
    try {
      await apiFetch(`/receipts/${receiptId}/void`, { method: "POST", body: JSON.stringify({ reason: note || "" }) });
      await loadDonorReceipts();
    } catch (e) { setReceiptNote(n => ({ ...n, [receiptId]: (e && e.sentence) || errorMessage(e, "The receipt was not voided.") })); }
    setReceiptBusyId(null);
  };
  const downloadReceiptPdf = async (receiptId, filenameHint) => {
    try {
      const resp = await fetch(`${API}/receipts/${receiptId}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!resp.ok) throw new Error("Could not download receipt");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = String(filenameHint).replace(/\.pdf$/, "") + ".pdf";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { setReceiptNote(n => ({ ...n, [receiptId]: errorMessage(e, "Could not download it.") })); }
  };

  // ── The year-end statement ──
  const thisYear = new Date().getFullYear();
  const [showYearEnd, setShowYearEnd] = useState(false);
  const [yearEndYear, setYearEndYearRaw] = useState(String(thisYear));
  const touched = useRef(false);
  const setYearEndYear = v => { touched.current = true; setYearEndYearRaw(v); };
  useEffect(() => { if (!touched.current) setYearEndYearRaw(defaultStatementYear(gifts, thisYear)); }, [gifts, thisYear]);
  const [yearEndBusy, setYearEndBusy] = useState(false);
  const [yearEndErr, setYearEndErr] = useState("");
  const [statement, setStatement] = useState(null);
  const sendYearEndStatement = async () => {
    setYearEndBusy(true); setYearEndErr(""); setStatement(null);
    try {
      const r = await apiFetch(`/donors/${donor.id}/year-end-statement`, { method: "POST", body: JSON.stringify({ year: parseInt(yearEndYear, 10), send: false }) });
      setStatement(r);
      await loadDonorReceipts();
    } catch (e) { setYearEndErr((e && (e.sentence || e.message)) || errorMessage(e, "Could not make the statement.")); }
    setYearEndBusy(false);
  };
  const toggleYearEnd = v => { const next = typeof v === "function" ? v(showYearEnd) : v; setShowYearEnd(next); if (!next) { setStatement(null); setYearEndErr(""); } };

  return { donorReceipts, receiptsEnabled, receiptBusyId, receiptForGift, sendReceipt, emailReceipt, voidReceipt, downloadReceiptPdf, receiptNote,
    showYearEnd, setShowYearEnd: toggleYearEnd, yearEndYear, setYearEndYear, yearEndBusy, yearEndErr, sendYearEndStatement, statement };
}

// A gift's receipt cell: make it, then Download and Email.
export function ReceiptCell({ g, rc, isReadOnly }) {
  const [voiding, setVoiding] = useState(false);
  const [voidNote, setVoidNote] = useState("");
  const r = rc.receiptForGift(g.id);
  const note = r ? rc.receiptNote[r.id] : rc.receiptNote["gift:" + g.id];
  if (r) return (
    <span data-testid="dp-receipt-made" style={{ fontSize: 11.5, color: T.ink, display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span>Receipt #{r.receipt_number} {r.sent_at ? "emailed ✓" : "ready"} ·
        <button type="button" data-testid="dp-receipt-download" style={linkBtn} onClick={() => rc.downloadReceiptPdf(r.id, `receipt-${r.receipt_number}`)}>Download</button>
        {!r.sent_at && !isReadOnly && <>·<button type="button" data-testid="dp-receipt-email" disabled={rc.receiptBusyId === r.id} style={linkBtn} onClick={() => rc.emailReceipt(r.id)}>{rc.receiptBusyId === r.id ? "Emailing…" : "Email"}</button></>}
        {!isReadOnly && !voiding && <>·<button type="button" data-testid="dp-receipt-void" style={linkBtn} onClick={() => setVoiding(true)}>Void</button></>}
      </span>
      {voiding && <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input data-testid="dp-receipt-void-note" value={voidNote} onChange={e => setVoidNote(e.target.value)} placeholder="Why it is void (kept on the receipt)"
          style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid " + T.bg3, borderRadius: 6, minWidth: 180 }} />
        <button type="button" data-testid="dp-receipt-void-confirm" disabled={rc.receiptBusyId === r.id} style={linkBtn}
          onClick={async () => { await rc.voidReceipt(r.id, voidNote); setVoiding(false); setVoidNote(""); }}>{rc.receiptBusyId === r.id ? "Voiding…" : `Void receipt #${r.receipt_number}`}</button>
        <button type="button" style={{ ...linkBtn, color: T.ink3 }} onClick={() => setVoiding(false)}>Keep it</button>
        <span style={{ color: T.ink3, whiteSpace: "normal", maxWidth: 260 }}>The receipt stays on file marked void, and its number is never used again.</span>
      </span>}
      {note && <span role="status" style={{ color: T.ink3, whiteSpace: "normal", maxWidth: 220 }}>{note}</span>}
    </span>);
  if (!rc.receiptsEnabled) return <span style={{ color: T.ink3, fontSize: 12 }}>Off</span>;
  // FEEL-1: a $0 gift has nothing to receipt, so nothing is offered.
  if (!receiptOffered(g)) return <span data-testid="dp-receipt-none" style={{ color: T.ink3, fontSize: 12 }} title="A tax receipt is for money given; this gift is $0.">No receipt for $0</span>;
  const busy = rc.receiptBusyId === g.id;
  return <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
    <button type="button" data-testid="dp-receipt-make" onClick={() => rc.sendReceipt(g.id)} disabled={busy || isReadOnly} title={isReadOnly ? "Reactivate your subscription to make changes." : "Makes the receipt. You choose to download or email it next."}
      style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 6, color: isReadOnly ? T.ink3 : T.greenDk, fontSize: 11, fontWeight: 600, cursor: isReadOnly ? "not-allowed" : "pointer", padding: "3px 8px", opacity: busy ? 0.6 : 1 }}>{busy ? "Making…" : "Send receipt"}</button>
    {note && <span role="alert" style={{ fontSize: 11.5, color: T.ink, whiteSpace: "normal", maxWidth: 220 }}>{note}</span>}
  </span>;
}

// The year-end panel: pick the year, make it, see it, then Download or Email.
export function YearEndPanel({ rc, donor, isReadOnly }) {
  const s = rc.statement;
  const snap = s && (typeof s.snapshot === "string" ? JSON.parse(s.snapshot) : s.snapshot);
  const note = s ? rc.receiptNote[s.id] : "";
  const fresh = s && rc.donorReceipts.find(r => r.id === s.id);
  return (
    <div data-testid="dp-year-end" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "16px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Year-end giving statement</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: T.ink3 }}>Tax year</span>
        <input type="number" data-testid="dp-year-end-year" value={rc.yearEndYear} onChange={e => rc.setYearEndYear(e.target.value)} style={{ width: 100, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 6, padding: "6px 8px", color: T.ink, fontSize: 12, outline: "none" }} />
        <button type="button" data-testid="dp-year-end-make" onClick={rc.sendYearEndStatement} disabled={rc.yearEndBusy || isReadOnly} style={{ background: T.greenDk, border: "none", borderRadius: 6, padding: "7px 12px", color: T.white, fontSize: 12, fontWeight: 700, cursor: rc.yearEndBusy ? "not-allowed" : "pointer" }}>
          {rc.yearEndBusy ? "Making it…" : s ? "Make it again" : "Make the statement"}
        </button>
        <button type="button" onClick={() => rc.setShowYearEnd(false)} style={{ background: T.bg, border: "none", borderRadius: 6, padding: "7px 10px", color: T.ink3, fontSize: 12, cursor: "pointer" }}>Close</button>
      </div>
      {rc.yearEndErr && <div role="alert" data-testid="dp-year-end-err" style={{ fontSize: 12, color: T.ink, marginTop: 8 }}>{rc.yearEndErr}</div>}
      {!s && <div style={{ fontSize: 11, color: T.ink3, marginTop: 8, lineHeight: 1.5 }}>Puts every {rc.yearEndYear} gift into one statement and shows it here. It replaces any earlier statement for that year. Nothing is emailed until you choose to.</div>}
      {s && snap && (
        <div data-testid="dp-year-end-preview" style={{ marginTop: 12, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px", background: T.bg }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }} data-testid="dp-year-end-org">{snap.orgLegalName}</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{snap.taxYear} giving statement for {snap.donorName} · #{snap.receiptNumber} · issued {snap.issueDate}</div>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <tbody>
              {(snap.lineItems || []).map((l, i) => (
                <tr key={i} data-testid="dp-year-end-line" style={{ borderTop: "1px solid " + T.bg2 }}>
                  <td style={{ padding: "4px 0", color: T.ink }}>{l.date}</td>
                  <td style={{ padding: "4px 0", textAlign: "right", color: T.ink }}>{fmtFull(l.amount)}</td>
                </tr>))}
              <tr style={{ borderTop: "1px solid " + T.ink }}>
                <td style={{ padding: "6px 0", fontWeight: 700 }}>Total given in {snap.taxYear}</td>
                <td data-testid="dp-year-end-total" style={{ padding: "6px 0", textAlign: "right", fontWeight: 700 }}>{fmtFull(snap.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>The total is every {snap.taxYear} gift above; the tax-deductible part is {fmtFull(snap.totalDeductible)}.</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" data-testid="dp-year-end-download" style={{ ...linkBtn, fontSize: 12.5 }} onClick={() => rc.downloadReceiptPdf(s.id, `${snap.taxYear}-giving-statement`)}>Download PDF</button>
            {!isReadOnly && !(fresh && fresh.sent_at) && <button type="button" data-testid="dp-year-end-email" disabled={rc.receiptBusyId === s.id} style={{ ...linkBtn, fontSize: 12.5 }}
              onClick={() => rc.emailReceipt(s.id)}>{rc.receiptBusyId === s.id ? "Emailing…" : donor.email ? `Email it to ${donor.email}` : "Email it"}</button>}
          </div>
          {note && <div role="status" data-testid="dp-year-end-note" style={{ fontSize: 12, color: T.ink, marginTop: 6 }}>{note}</div>}
        </div>)}
    </div>
  );
}

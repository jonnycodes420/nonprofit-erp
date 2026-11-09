// TRUTH-3 item 8 (W-1107-Atlas-17): every receipt the org issued, with search,
// its PDF and Void with a note (TRUTH-2's void, surfaced here). With receipts
// off, the panel says what turning them on does. GET /receipts.
import { useState, useEffect } from "react";
import { T, SectionLabel, fmtFull } from "../shared";
import { apiFetch, API, getToken } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import ReceiptDrift from "../ReceiptDrift";   // PLEDGES-3

export default function IssuedReceipts({ isAdmin, isReadOnly }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const load = (text = q) => apiFetch(`/receipts?q=${encodeURIComponent(text)}`).then(setData).catch(e => setErr(errorMessage(e)));
  useEffect(() => { load(""); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const pdf = async r => {
    const res = await fetch(`${API}/receipts/${r.id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { setErr("That receipt has no PDF on file."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = r.type === "year_end" ? `${r.tax_year}-giving-statement.pdf` : `receipt-${r.receipt_number}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const voidIt = r => apiFetch(`/receipts/${r.id}/void`, { method: "POST", body: JSON.stringify({ reason: note }) })
    .then(() => { setVoiding(null); setNote(""); load(); }).catch(e => setErr(errorMessage(e)));
  if (!data) return <div data-testid="issued-receipts" style={{ borderTop: "1px solid " + T.bg3, paddingTop: 20 }}><SectionLabel>Issued receipts</SectionLabel><div style={{ fontSize: 12.5, color: T.ink3 }}>{err || "Reading the receipts you have issued…"}</div></div>;
  return (
    <div data-testid="issued-receipts" style={{ borderTop: "1px solid " + T.bg3, paddingTop: 20 }}>
      <SectionLabel>Issued receipts</SectionLabel>
      {!data.receiptsEnabled && <div data-testid="receipts-off-words" style={{ fontSize: 12.5, color: T.ink, background: T.bg, borderRadius: 8, padding: "8px 12px", marginBottom: 10, lineHeight: 1.6 }}>{`Receipts are off. ${data.whenOff}`}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(); }} placeholder="Search a name, email, receipt number or year"
          aria-label="Search receipts" data-testid="receipts-search" style={{ flex: 1, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
        <button type="button" onClick={() => load()} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" }}>Search</button>
      </div>
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{data.sentence}</div>
      {err && <div style={{ fontSize: 12.5, color: T.ink, marginBottom: 8 }}>{err}</div>}
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {data.receipts.map(r => (
          <div key={r.id} data-testid="receipt-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid " + T.bg2, fontSize: 13 }}>
            <span style={{ minWidth: 70, fontWeight: 700 }}>#{r.receipt_number || "—"}</span>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>{r.donor_name || "Someone no longer on file"} · {r.type === "year_end" ? `${r.tax_year} statement` : displayDate(String(r.created_at).slice(0, 10))}</span>
            <span style={{ fontWeight: 700 }}>{fmtFull(r.amount)}</span>
            {r.voided_at ? <span style={{ fontSize: 12, color: T.ink3 }}>Voided: {r.void_reason}</span> : <>
              <ReceiptDrift receipt={r} isReadOnly={isReadOnly || !isAdmin} onDone={() => load()} />
              {r.has_pdf && <button type="button" onClick={() => pdf(r)} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>PDF</button>}
              {isAdmin && !isReadOnly && <button type="button" data-testid="receipt-void" onClick={() => { setVoiding(r.id); setNote(""); }} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>Void</button>}
            </>}
            {voiding === r.id && <div style={{ flexBasis: "100%", display: "flex", gap: 8 }}>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why it is voided (kept with the receipt)" aria-label="Why it is voided" style={{ flex: 1, border: "1px solid " + T.bg3, borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }} />
              <button type="button" onClick={() => voidIt(r)} style={{ background: T.white, border: "1.5px solid " + T.ink, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Void receipt #{r.receipt_number}</button>
              <button type="button" onClick={() => setVoiding(null)} style={{ background: "none", border: "none", fontSize: 12, cursor: "pointer", color: T.ink3 }}>Cancel</button>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

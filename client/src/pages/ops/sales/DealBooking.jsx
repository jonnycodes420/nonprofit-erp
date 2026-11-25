// ONBOARD-4 item 3 · the deal page's Booking panel: what she said on /book, word for word, the
// partner who recommended her and its market, and the file she sent (it waits for onboarding).
import { useEffect, useState } from "react";
import { apiFetch } from "../../../api";
import { says, link, whenWords, downloadCsv } from "./salesBits";

const row = (k, v) => <div style={{ fontSize: 12.5, padding: "3px 0" }}><span style={{ opacity: 0.7 }}>{k}: </span>{v || <span style={{ opacity: 0.6 }}>not given</span>}</div>;

export default function DealBooking({ dealId }) {
  const [b, setB] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiFetch(`/ops/sales/deals/${encodeURIComponent(dealId)}/booking`).then(setB).catch(() => setB({ failed: true })); }, [dealId]);
  if (!b) return null;
  if (b.failed) return <p style={says}>The booking could not be read.</p>;
  if (!b.bookings.length && !b.partner) return <p style={says}>This deal did not come from the booking page.</p>;
  return <div data-deal-booking={dealId}>
    {b.partner ? <p style={{ ...says, opacity: 1 }} data-deal-partner-code={b.partner.code}>Recommended by <b>{b.partner.name}</b> · {b.partner.market} market</p> : null}
    {b.bookings.map(x => <div key={x.id} style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 2 }}>Booked from the website {whenWords(x.created_at)}</div>
      {row("Phone", x.phone)}
      {row("Uses for donors today", x.current_system)}
      {row("Donors", x.donor_count)}
      {row("What would make it worth it", x.worth_it)}
      {x.file_name ? <div style={{ fontSize: 12.5, padding: "3px 0" }}><span style={{ opacity: 0.7 }}>File: </span>
        <button type="button" style={{ ...link, fontSize: 12.5 }} data-booking-file={x.id}
          onClick={() => downloadCsv(`/ops/sales/bookings/${encodeURIComponent(x.id)}/file`, x.file_name).catch(e => setMsg(e.message))}>{x.file_name}</button>
        <span style={{ opacity: 0.6 }}> · {Math.max(1, Math.round(x.file_size / 1024))} KB, waiting for onboarding</span></div> : row("File", null)}
    </div>)}
    {msg ? <p style={says}>{msg}</p> : null}
  </div>;
}

// profile/MoreActions.jsx · ATLAS-3. TWO MORE-MENU ITEMS THAT DO WHAT THEY NAME.
//
// Call script (POST /donors/:id/call-script): a script for a phone call, in
// five parts: the opening, what to thank them for, the ask or the check-in,
// questions to ask, and the close. Not an email.
// Impact summary (GET /donors/:id/impact-summary): the summary on screen,
// read from their gifts, with the PDF to download beside it. It used to
// download silently, or fail silently, and look as if it did nothing.
import { useEffect, useState } from "react";
import { Modal, T, fmtFull } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";

const H = { fontSize: 11, fontWeight: 800, color: T.ink3, letterSpacing: ".04em", textTransform: "uppercase", margin: "14px 0 4px" };
const P = { fontSize: 14, color: T.ink, lineHeight: 1.6, margin: 0 };
const btn = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

function useRead(path, method = "GET") {
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    apiFetch(path, method === "POST" ? { method: "POST", body: "{}" } : undefined).then(r => { if (live) setOut(r); })
      .catch(e => { if (live) setErr(errorMessage(e, "That couldn't be read just now.")); });
    return () => { live = false; };
  }, [path, method]);
  return [out, err];
}

export function CallScriptModal({ donor, onClose }) {
  const [out, err] = useRead(`/donors/${donor.id}/call-script`, "POST");
  const s = out && out.script;
  return (
    <Modal onClose={onClose} width={600} title={`Call script: ${donor.name}`}>
      <div data-testid="call-script">
        {err && <div role="alert" style={{ ...P, color: T.ink2 }}>{err}</div>}
        {!s && !err && <div style={{ ...P, color: T.ink3 }}>Reading {String(donor.name).split(" ")[0]}'s record…</div>}
        {s && <>
          <div style={H}>Opening</div><p data-part="opening" style={P}>{s.opening}</p>
          <div style={H}>Thank them for</div><p data-part="thank_for" style={P}>{s.thank_for}</p>
          <div style={H}>The ask or check-in</div><p data-part="ask" style={P}>{s.ask}</p>
          <div style={H}>Questions to ask</div>
          <ul data-part="questions" style={{ ...P, paddingLeft: 20 }}>{s.questions.map((q, i) => <li key={i} style={{ marginBottom: 4 }}>{q}</li>)}</ul>
          <div style={H}>Close</div><p data-part="close" style={P}>{s.close}</p>
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 14 }}>{out.source === "ai" ? "Written from their record. Every amount in it is on file." : "Steward's own wording, from their record."}</div>
        </>}
      </div>
    </Modal>
  );
}

export function ImpactSummaryModal({ donor, onClose, onDownload, downloading }) {
  const [d, err] = useRead(`/donors/${donor.id}/impact-summary`);
  return (
    <Modal onClose={onClose} width={600} title={`Impact summary: ${donor.name}`}>
      <div data-testid="impact-summary">
        {err && <div role="alert" style={{ ...P, color: T.ink2 }}>{err}</div>}
        {!d && !err && <div style={{ ...P, color: T.ink3 }}>Reading their gifts…</div>}
        {d && <>
          <p style={P}>{d.giftCount ? `${fmtFull(d.totalCents / 100)} given across ${d.giftCount} ${d.giftCount === 1 ? "gift" : "gifts"}${d.donorSince ? `, giving since ${d.donorSince}` : ""}.` : "No gifts on record yet."}</p>
          <div style={H}>Milestones reached</div>
          {d.milestones.length ? <ul style={{ ...P, paddingLeft: 20 }}>{d.milestones.map(m => <li key={m}>{m}</li>)}</ul> : <p style={{ ...P, color: T.ink3 }}>No milestones reached yet.</p>}
          <div style={H}>Their impact</div>
          {d.impactLines.length ? <ul style={{ ...P, paddingLeft: 20 }}>{d.impactLines.map(m => <li key={m}>{m}</li>)}</ul>
            : <p style={{ ...P, color: T.ink3 }}>No impact lines are set up yet. An admin adds them in Settings, and they appear here and on the PDF.</p>}
          {d.recentGifts.length > 0 && <><div style={H}>Recent gifts</div>
            <ul style={{ ...P, paddingLeft: 20 }}>{d.recentGifts.map((g, i) => <li key={i}>{g.date} · {g.campaign} · {fmtFull(g.cents / 100)}</li>)}</ul></>}
          <div style={{ fontSize: 12, color: T.ink3, margin: "12px 0" }}>{d.sentence}</div>
          <button type="button" data-testid="impact-download" style={btn} disabled={downloading} onClick={onDownload}>{downloading ? "Making the PDF…" : "Download the PDF"}</button>
        </>}
      </div>
    </Modal>
  );
}

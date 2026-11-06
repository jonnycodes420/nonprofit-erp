// profile/MoreActions.jsx · ATLAS-3. TWO MORE-MENU ITEMS THAT DO WHAT THEY NAME.
//
// Call script (POST /donors/:id/call-script): a script for a phone call, in
// five parts: the opening, what to thank them for, the ask or the check-in,
// questions to ask, and the close. Not an email.
// Impact summary (GET /donors/:id/impact-summary): the summary on screen,
// read from their gifts, with the PDF to download beside it. It used to
// download silently, or fail silently, and look as if it did nothing.
// ATLAS-4 · Add to a journey opens the rail's own journey picker (the same
// one, not a second); Export this person's data downloads their record, gifts
// and notes as a file and says so on screen (the download is a disclosure, so
// the audit trail writes its row: middleware/auditTrail.js, item 5).
import { useEffect, useState } from "react";
import { Modal, T, fmtFull } from "../shared";
import { apiFetch, API, getToken } from "../../api";
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

// ATLAS-4 · the rail's picker, brought to her: scrolled to, focused and opened.
// With no picker on the page (no journeys yet, or read-only), Journeys opens.
export function openJourneyPicker(onNavigate) {
  const el = typeof document !== "undefined" && document.querySelector("[data-testid=dp-journey-pick]");
  if (!el) { if (onNavigate) onNavigate("journeys"); return false; }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  try { if (typeof el.showPicker === "function") el.showPicker(); } catch { /* the focus is enough where showPicker is refused */ }
  return true;
}

// ATLAS-4 · the export, as a file, with what is in it.
export async function downloadPersonData(donor) {
  const r = await fetch(`${API}/donors/${encodeURIComponent(donor.id)}/export-data`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.message || b.error || "The export did not download. Try again."); }
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* still a file */ }
  const fileName = `${String(donor.name || "person").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "person"}-data.json`;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const n = k => (Array.isArray(data[k]) ? data[k].length : 0);
  return { fileName, gifts: n("gifts"), notes: n("notesEmailsAndMeetingsLogged") };
}

export function ExportDoneModal({ donor, result, onClose }) {
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return (
    <Modal onClose={onClose} width={520} title={result.error ? "The export did not download" : "Export downloaded"}>
      <div data-testid="export-done" role="status" style={P}>
        {result.error ? result.error
          : `${result.fileName} is in your downloads: ${donor.name}'s record, ${plural(result.gifts, "gift", "gifts")} and ${plural(result.notes, "note or conversation", "notes and conversations")}. The download is recorded in their History.`}
      </div>
    </Modal>
  );
}

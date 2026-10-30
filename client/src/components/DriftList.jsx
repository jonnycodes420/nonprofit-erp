// HOME-4 · DRIFT ON THE DONORS PAGE. Home no longer draws Drift's list: its
// people are moves in Your moves (insights.js withDrift), and one chip under
// the deck ("Drift · 2 early signs") opens this. It is GET /drift's own list,
// every confidence: the people past their own pattern, then the early signs,
// each under the words shared/driftWords.js gives every surface.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { DonorLink } from "./RecordLink";
import { driftCounts, driftBadgeLabel, EARLY_SIGNS_HEADING, EARLY_SIGNS_MEANING } from "../../../shared/driftWords";
import { countLabel } from "../../../shared/countWords.js";

export function DriftList({ onSelectDonor, onBack }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { apiFetch("/drift?all=1&includeMedium=1").then(setD).catch(() => setErr(true)); }, []);
  const c = driftCounts(d);
  const rows = (d && d.list) || [];
  const high = rows.filter(r => r.confidence !== "medium"), early = rows.filter(r => r.confidence === "medium");
  const row = r => (
    <li key={r.donorId} data-testid="drift-row" style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "12px 4px", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 260px", minWidth: 0 }}>
        <DonorLink id={r.donorId} onOpen={() => onSelectDonor && onSelectDonor(r.donorId)}
          style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 14.5, fontWeight: 700, color: T.ink, cursor: "pointer", textAlign: "left" }}>{r.donorName}</DonorLink>
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: T.gold700 }}>{driftBadgeLabel(r.confidence)}</span>
        <span style={{ display: "block", fontSize: 13, color: T.ink2, lineHeight: 1.5, marginTop: 2 }}>{r.reason}{r.earlySign ? ` ${r.earlySign}` : ""}</span>
        {r.meetingSet && <span style={{ display: "block", fontSize: 12.5, color: T.ink3 }}>{r.meetingSet}</span>}
      </span>
      {r.usualGift > 0 && <span style={{ fontSize: 13, color: T.ink }}>usually {fmtFull(Math.round(r.usualGift))}</span>}
    </li>
  );
  return (
    <section data-testid="donors-drift" aria-label="Drift" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 24px" }}>
      {onBack && <button type="button" onClick={onBack} style={{ background: "none", border: "none", padding: 0, marginBottom: 10, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>← All people</button>}
      <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, color: T.ink }}>Drift</h2>
      {err && <p style={{ fontSize: 14, color: T.ink }}>Drift could not be read just now. Reload the page to try again.</p>}
      {!d && !err && <p style={{ fontSize: 14, color: T.ink3 }}>Reading every donor's own pattern…</p>}
      {d && <>
        <p style={{ fontSize: 13.5, color: T.ink3, margin: "6px 0 10px", lineHeight: 1.5 }}>
          {c.high > 0 ? `${c.high} past their own pattern: ${fmtFull(d.atRiskAmount)} at risk, the sum of what they usually give. ` : ""}
          {c.medium > 0 ? `${countLabel(c.medium, "early sign")}: ${EARLY_SIGNS_MEANING}.` : ""}
          {!c.anyDrifting ? "Nobody is past their own pattern. Steward watches every donor's own giving rhythm." : ""}
        </p>
        {high.length > 0 && <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{high.map(row)}</ul>}
        {early.length > 0 && <>
          <div style={{ marginTop: 16, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: T.ink3 }}>{EARLY_SIGNS_HEADING}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{early.map(row)}</ul>
        </>}
      </>}
    </section>
  );
}

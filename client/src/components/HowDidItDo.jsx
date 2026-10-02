// ENGAGE-1 §4 — APPEAL-WHY. "How did it do?", inside the campaign's own edit
// panel (no new screen). This campaign against the one a year earlier, the
// reasons ranked by how much money each moved, and who to call. Every number is
// a <Figure> that opens its rows (figure source appeal-why). "Plan a follow-up"
// opens the existing planner: it adds a step to that person's Thread and sends
// nothing.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { DonorLink } from "./RecordLink";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const cell = { padding: "8px 10px", borderTop: "1px solid " + T.bg2, fontSize: 13.5 };

export function HowDidItDo({ campaignId, isReadOnly }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [planFor, setPlanFor] = useState(null);
  const [planned, setPlanned] = useState({});
  const load = () => apiFetch(`/campaigns/${campaignId}/how-did-it-do`).then(setD).catch(e => setErr(errorMessage(e, "This comparison could not be loaded.")));
  useEffect(() => { setD(null); load(); }, [campaignId]);
  const choose = async id => {
    try { await apiFetch(`/campaigns/${campaignId}/compare`, { method: "PUT", body: JSON.stringify({ compareId: id || null }) }); load(); }
    catch (e) { setErr(errorMessage(e, "That comparison could not be saved.")); }
  };
  if (err) return <div style={{ fontSize: 13, color: T.ink3 }}>{err}</div>;
  if (!d) return null;

  const chooser = (
    <label style={{ fontSize: 12.5, color: T.ink3, display: "inline-flex", gap: 6, alignItems: "center" }}>
      Compared with
      <select aria-label="Compare with" data-testid="how-compare" value={d.compare ? d.compare.id : ""} disabled={isReadOnly}
        onChange={e => choose(e.target.value)}
        style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px", fontSize: 12.5, fontFamily: "inherit", background: T.white, color: T.ink }}>
        <option value="">Choose a campaign</option>
        {d.candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
  if (!d.compare) return (
    <div data-testid="how-did-it-do" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={LABEL}>How did it do?</div>
      <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>{d.sentence}</div>
      {chooser}
    </div>
  );

  const money = (v, source, label) => <Figure value={v / 100} kind="money" label={label} source={source} variant="inline" />;
  const count = (n, source, label) => <Figure value={n} kind="count" label={label} source={source} variant="inline" />;
  const part = key => ({ key: "appeal-why", params: { campaign: d.campaign.id, compare: d.compare.id, part: key } });
  const rows = [
    ["Total", money(d.this.totalCents, d.this.source, `${d.campaign.name}: total`), money(d.last.totalCents, d.last.source, `${d.compare.name}: total`)],
    ["Gifts", count(d.this.gifts, d.this.source, `${d.campaign.name}: gifts`), count(d.last.gifts, d.last.source, `${d.compare.name}: gifts`)],
    ["Donors", count(d.this.donors, part("donorsThis"), `${d.campaign.name}: donors`), count(d.last.donors, part("donorsLast"), `${d.compare.name}: donors`)],
    ["Average gift", money(d.this.averageCents, part("avgThis"), `${d.campaign.name}: average gift`), money(d.last.averageCents, part("avgLast"), `${d.compare.name}: average gift`)],
    ["New donors", count(d.this.newDonors, part("newcomers"), "New donors"), ""],
    ["Gave to both", count(d.this.returning, part("returning"), "Gave to both"), ""],
    ["Not back yet", count(d.this.lapsed, part("notYet"), "Not back yet"), ""],
  ];
  return (
    <div data-testid="how-did-it-do" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={LABEL}>How did it do?</div>
        {chooser}
      </div>
      <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", background: T.bg, fontSize: 12, color: T.ink3, fontWeight: 700 }}>
          <div style={{ padding: "8px 10px" }} />
          <div style={{ padding: "8px 10px" }}>{d.campaign.name}</div>
          <div style={{ padding: "8px 10px" }}>{d.compare.name}</div>
        </div>
        {rows.map(([k, a, b]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr" }}>
            <div style={{ ...cell, color: T.ink3 }}>{k}</div><div style={{ ...cell, fontWeight: 700 }}>{a}</div><div style={cell}>{b}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
        Average gift is the total divided by the number of gifts, to the dollar. New donors gave their first gift to you through this campaign.
      </div>

      <div style={LABEL}>Why, largest first</div>
      <div data-testid="how-reasons" style={{ display: "flex", flexDirection: "column" }}>
        {d.reasons.map(r => (
          <div key={r.key} data-reason={r.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2, fontSize: 13.5 }}>
            <span style={{ color: T.ink }}>{r.label} <span style={{ color: T.ink3 }}>· {r.people} {r.people === 1 ? "person" : "people"}</span></span>
            <span style={{ fontWeight: 700, color: r.key === "notYet" || r.key === "less" ? T.gold700 : T.ink }}>
              <Figure value={r.cents / 100} kind="money" label={r.label} source={r.source} variant="inline" /> <span style={{ fontWeight: 400, color: T.ink3 }}>{r.words}</span>
            </span>
          </div>
        ))}
      </div>

      <div style={LABEL}>Who to call</div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{d.whoToCallSentence}</div>
      <div data-testid="how-who-to-call" style={{ display: "flex", flexDirection: "column" }}>
        {d.whoToCall.length === 0 && <div style={{ fontSize: 13, color: T.ink3 }}>Everyone who gave last time has given again.</div>}
        {d.whoToCall.map(p => (
          <div key={p.donorId} data-call-row={p.donorId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 10, alignItems: "center", padding: "8px 2px", borderTop: "1px solid " + T.bg2 }}>
            <div style={{ minWidth: 0 }}>
              <DonorLink id={p.donorId} style={{ fontWeight: 700, color: T.ink, textDecoration: "underline dotted" }}>{p.name}</DonorLink>
              <div style={{ fontSize: 12, color: T.ink3 }}>Gave {fmtFull(p.lastGiftCents / 100)} last time · engagement {p.engagement}{p.lastTouch ? ` · last touch ${p.lastTouch}` : ""}</div>
            </div>
            <span />
            {planned[p.donorId]
              ? <span style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 700 }}>Planned</span>
              : !isReadOnly && <button type="button" data-testid="how-plan" onClick={() => setPlanFor({ id: p.donorId, name: p.name })}
                  style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Plan a follow-up
                </button>}
          </div>
        ))}
      </div>
      {planFor && <PlanFollowUpModal donor={planFor} onClose={() => setPlanFor(null)}
        onSaved={() => { setPlanned(m => ({ ...m, [planFor.id]: true })); setPlanFor(null); }} />}
    </div>
  );
}

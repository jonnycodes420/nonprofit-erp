// ENGAGE-1 §4 — APPEAL-WHY. "How did it do?", inside the campaign's own edit
// panel (no new screen). This campaign against the one a year earlier; since
// WHY-1 the reasons and who to call are Ask why's answer (CampaignWhy below). Every number is
// a <Figure> that opens its rows (figure source appeal-why). "Plan a follow-up"
// opens the existing planner: it adds a step to that person's Thread and sends
// nothing.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure } from "./Figure";
import { askWhy, WhyAnswerBody } from "./WhyAnswer";
import { errorMessage } from "../lib/domainError";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const cell = { padding: "8px 10px", borderTop: "1px solid " + T.bg2, fontSize: 13.5 };

export function HowDidItDo({ campaignId, isReadOnly }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
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

      {/* WHY-1 — the reasons and who to call are now Ask why's answer for
          this campaign (the same math, ranked by dollars, every reason opening
          its rows, one step that plans and never sends). */}
      <div style={LABEL}>Why did this come in where it did?</div>
      <CampaignWhy campaignId={campaignId} compareId={d.compare.id} isReadOnly={isReadOnly} />
    </div>
  );
}

// The answer is asked again when the comparison changes, so the reasons are
// always against the campaign shown in the table above.
function CampaignWhy({ campaignId, compareId, isReadOnly }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setA(null);
    askWhy({ key: "appeal", campaign: campaignId }).then(r => live && setA(r)).catch(e => live && setErr(errorMessage(e, "Steward could not work that out just now.")));
    return () => { live = false; };
  }, [campaignId, compareId]);
  if (err) return <div style={{ fontSize: 13, color: T.ink3 }}>{err}</div>;
  if (!a) return <div style={{ fontSize: 13, color: T.ink3 }}>Working it out…</div>;
  return <div data-testid="campaign-why"><WhyAnswerBody answer={a} isReadOnly={isReadOnly} /></div>;
}

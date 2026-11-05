// home/DriftList.jsx · HOME-6. THE PEOPLE DRIFTING, AS A LIST YOU CAN SCAN.
//
// Under the moves deck: one row per person Drift says is past their own giving
// rhythm (server/insights/driftPeople.js, read from the deck's own answer, so
// the count and the people are Drift's, never a second rule). The most money
// at stake first. Five show; "Show all" opens the rest in place and folds them
// again. Every row has the same columns, so names, amounts and buttons line up;
// on a phone the amount sits under the name.
import { useState } from "react";
import { T } from "../shared";
import { fmtWhole } from "../../lib/money";
import { DonorLink } from "../RecordLink";
import { displayDateShort } from "../../../../shared/displayDate.js";

const FIRST = 5;
const CSS = `
.drift-list { list-style: none; margin: 0; padding: 0; }
.drift-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px 132px; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid ${T.bg2}; }
.drift-row:first-child { border-top: none; }
.drift-name { font-size: 15px; font-weight: 700; color: ${T.ink}; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.drift-name:hover { text-decoration: underline; }
.drift-why { font-size: 13px; color: ${T.ink3}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drift-amt { text-align: right; font-variant-numeric: tabular-nums; }
.drift-act { justify-self: end; width: 100%; min-height: 40px; border-radius: 10px; border: 1px solid ${T.bg3}; background: ${T.white}; color: ${T.ink}; font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
.drift-act:focus-visible, .drift-more:focus-visible { outline: 2px solid ${T.greenDk}; outline-offset: 2px; }
@container (max-width: 560px) {
  .drift-row { grid-template-columns: minmax(0, 1fr) 104px; grid-template-areas: "who act" "amt act"; row-gap: 2px; }
  .drift-who { grid-area: who; } .drift-amt { grid-area: amt; text-align: left; } .drift-act { grid-area: act; }
}
`;

export function DriftList({ drift, onNavigate, onShowAll, loadingAll }) {
  const [open, setOpen] = useState(false);
  const people = (drift && drift.people) || [];
  const count = (drift && drift.count) || 0;
  if (!count) return null;
  const shown = open ? people : people.slice(0, FIRST);
  const profile = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const toggle = () => { if (!open && people.length < count && onShowAll) onShowAll(); setOpen(o => !o); };
  return (
    <section aria-label="Drifting" data-testid="drift-list-card" className="home-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.ink }}>
          Drifting · <span data-testid="drift-list-count">{count.toLocaleString("en-US")}</span>
        </h3>
        <span style={{ fontSize: 13, color: T.ink3 }}>Past their own giving rhythm, the most at stake first</span>
      </div>
      <ul className="drift-list" data-testid="drift-list">
        {shown.map(p => (
          <li key={p.id} className="drift-row" data-testid="drift-row" data-id={p.id}>
            <div className="drift-who" style={{ minWidth: 0 }}>
              <DonorLink id={p.id} onOpen={() => profile(p.id)} className="drift-name" data-testid="drift-name">{p.name}</DonorLink>
              <div className="drift-why" title={p.reason}>{p.short}{p.early ? " · an early sign" : ""}</div>
            </div>
            <div className="drift-amt" data-testid="drift-amt">
              <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{p.lastCents != null ? fmtWhole(p.lastCents / 100) : "—"}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>{p.lastDate ? displayDateShort(p.lastDate) : "No date"}</div>
            </div>
            <button type="button" className="drift-act" data-testid="drift-open" onClick={() => profile(p.id)}>Open</button>
          </li>
        ))}
      </ul>
      {(count > FIRST) && (
        <button type="button" className="drift-more" data-testid="drift-show-all" aria-expanded={open} onClick={toggle}
          style={{ alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", fontFamily: "inherit", fontSize: 13.5, color: T.greenDk, fontWeight: 700, cursor: "pointer" }}>
          {open ? (loadingAll && people.length < count ? "Reading the rest…" : "Show fewer") : `Show all ${count.toLocaleString("en-US")}`}</button>
      )}
      <div style={{ fontSize: 12.5, color: T.ink3 }}>
        The last gift and its date. <button type="button" data-testid="drift-open-all" onClick={() => onNavigate && onNavigate("donors", { view: "drift" })}
          style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 12.5, color: T.greenDk, fontWeight: 700, cursor: "pointer" }}>Open Drift</button>
      </div>
    </section>
  );
}

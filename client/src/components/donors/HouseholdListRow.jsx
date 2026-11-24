// client/src/components/donors/HouseholdListRow.jsx · HOUSEHOLD-1 item 2. A household
// as one row of the Donors list ("Show households together"): both people's photos,
// the household's name, its people's giving added (each figure opens its rows), and
// a button that opens it to its people, each on their own row with their own details.
import { T } from "../shared";
import { Figure } from "../Figure";
import { HouseholdPhotos } from "../majorGifts/HouseholdName";

const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : many}`;

export function HouseholdListRow({ unit, open, onToggle, colGrid, gridMin, onOpenPerson }) {
  const others = unit.otherPeople || [];
  return (
    <div data-testid="dir-household-row" data-household={unit.householdId}
      style={{ display: "grid", gridTemplateColumns: colGrid, minWidth: gridMin, background: T.bg2, borderBottom: "1px solid " + T.bg3, alignItems: "center" }}>
      <div />
      <div style={{ gridColumn: "2 / -1", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", flexWrap: "wrap" }}>
        <HouseholdPhotos people={unit.people} size={30} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{unit.name}</div>
          <div style={{ fontSize: 11, color: T.ink3 }}>Household · {unit.people.map(p => p.name).join(" and ")}</div>
        </div>
        <div style={{ fontSize: 12, color: T.ink2, display: "flex", gap: 14, alignItems: "baseline" }}>
          <span>Lifetime <Figure variant="cell" kind="money" value={unit.lifetimeCents / 100} label={`${unit.name}'s combined lifetime giving`} source={unit.lifetimeSource} /></span>
          <span>This year <Figure variant="cell" kind="money" value={unit.thisYearCents / 100} label={`${unit.name}'s giving this fiscal year`} source={unit.thisYearSource} /></span>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" data-testid="dir-household-toggle" aria-expanded={open} onClick={onToggle}
          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
          {open ? "Hide people" : `Show ${n(unit.memberIds.length, "person", "people")}`}
        </button>
      </div>
      {open && others.length > 0 && (
        <div style={{ gridColumn: "2 / -1", padding: "0 12px 8px", fontSize: 11.5, color: T.ink3 }}>
          Also in this household, not in this list's filter: {others.map((p, i) => <span key={p.id}>{i ? ", " : ""}
            <button type="button" onClick={() => onOpenPerson && onOpenPerson(p)} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, cursor: "pointer", fontSize: 11.5, fontFamily: "inherit" }}>{p.name}</button></span>)}
        </div>
      )}
    </div>
  );
}

// "2 households and 5 people" beside the list's count, NUMBERS-4's words.
export function unitCountWords(c) {
  if (!c) return "";
  const solo = Math.max(0, c.units - c.households);
  return `${n(c.units, "row", "rows")}: ${n(c.households, "household", "households")} and ${n(solo, "person", "people")} on their own (${n(c.people, "person", "people")} in all)`;
}

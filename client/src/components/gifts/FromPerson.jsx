// FromPerson.jsx · FLOWS-7 (W-1112-Volunteers-03X). WHO THE GIFT IS FROM.
//
// The top-level "Record a gift" From box offered only "+ New person" for a
// donor typed in full, so the path it offered made a duplicate and split his
// history. Its suggestions were a browser <datalist> over a plain substring
// search, which a reader (or a walk) may never see. Now the matches are on
// the page, from the Donors list's own person search (/donors/pick
// match=person: personMatch, names first, an archived record labelled), and
// "+ New person" sits below them. Choosing New for a name that is exactly
// someone's asks first: "There's already a Bertrand Saltonstall. Use that record?"
import { useState } from "react";
import { T } from "../shared";
import { usePeoplePicker, personNamed } from "../../lib/people";

const SHOWN = 6;
const rowBtn = { display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", background: T.white, border: "none",
  borderTop: "1px solid " + T.bg2, padding: "7px 10px", fontSize: 13, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const linkBtn = { background: "none", border: "none", padding: "6px 0 0", color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

// value: the typed text; chosen: the person picked ({ id, name }) or null.
export default function FromPerson({ value, chosen, onType, onChoose, onNew, newPersonOk, inputStyle, testid }) {
  const typed = String(value || "").trim();
  const picking = typed && !(chosen && chosen.name === value);
  const [rows, pending] = usePeoplePicker(picking ? typed : "", { match: "person", limit: SHOWN, enabled: !!picking });
  const [already, setAlready] = useState(null);   // the person on file with exactly this name
  const askNew = async () => {
    const same = await personNamed(typed).catch(() => null);
    if (same) { setAlready(same); return; }
    onNew(typed);
  };
  return (
    <>
      <input value={value} onChange={e => { setAlready(null); onType(e.target.value); }} placeholder="Search people on file, or type a new name"
        data-testid={testid + "-who"} style={inputStyle} autoComplete="off" role="combobox" aria-expanded={!!(picking && rows.length)} aria-controls={testid + "-matches"} />
      {picking && rows.length > 0 && (
        <div id={testid + "-matches"} role="listbox" data-testid={testid + "-matches"} style={{ border: "1px solid " + T.bg3, borderRadius: 8, marginTop: 4, overflow: "hidden" }}>
          {rows.slice(0, SHOWN).map((d, i) => (
            <button type="button" role="option" aria-selected="false" key={d.id} data-testid={testid + "-match"} data-person={d.id}
              onClick={() => { setAlready(null); onChoose({ id: d.id, name: d.name }); }} style={{ ...rowBtn, borderTop: i ? rowBtn.borderTop : "none" }}>
              <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <span style={{ color: T.ink3, fontSize: 12, flexShrink: 0 }}>{d.archived ? "Archived · " : ""}{d.email || [d.city, d.state].filter(Boolean).join(", ")}</span>
            </button>
          ))}
        </div>
      )}
      {picking && !pending && rows.length === 0 && <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>Nobody on file matches “{typed}”.</div>}
      {already ? (
        <div data-testid={testid + "-already"} role="alert" style={{ border: "1px solid " + T.gold300, background: T.gold50, borderRadius: 10, padding: 10, marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, color: T.ink }}>There's already a {already.name}. Use that record?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" data-testid={testid + "-already-use"} onClick={() => { onChoose({ id: already.id, name: already.name }); setAlready(null); }}
              style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Use {already.name}</button>
            <button type="button" data-testid={testid + "-already-new"} onClick={() => { setAlready(null); onNew(typed); }}
              style={{ background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>No, add a new person</button>
          </div>
        </div>
      ) : newPersonOk && picking && !pending && (
        <button type="button" data-testid={testid + "-new-person"} onClick={askNew} style={linkBtn}>+ New person: '{typed}'</button>
      )}
    </>
  );
}

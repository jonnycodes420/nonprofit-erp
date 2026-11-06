// client/src/components/merge/KeptHeads.jsx · FLOWS-2 item 4.
// The compare screen's two sides, named for what happens to them: "Kept" and
// "Merged in". Two records with one name (the usual duplicate) were two
// identical headings, so nobody could tell which one stays. Under each name:
// the record's id, the day it was added and its lifetime giving.
import { T } from "../shared";
import { displayOrgDate } from "../../lib/orgDay";

const fmtMoney = c => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Side({ word, rec, lifetimeCents, testid }) {
  return (
    <div data-testid={testid} style={{ flex: "1 1 200px", minWidth: 0, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3 }}>{word}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{rec.name || "No name"}</div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
        <span data-testid={testid + "-id"}>{rec.id}</span>
        {" · added "}{rec.created_at ? displayOrgDate(rec.created_at) : "on a day not on file"}
        {" · lifetime "}{fmtMoney(lifetimeCents)}
      </div>
    </div>
  );
}

// The two headings, laid out over the two columns of choices below them.
export function KeptHeads({ kept, other, lifetimeCents }) {
  return (
    <div data-testid="merge-heads" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <Side word="Kept" rec={kept} lifetimeCents={lifetimeCents[kept.id]} testid="merge-kept" />
      <Side word="Merged in" rec={other} lifetimeCents={lifetimeCents[other.id]} testid="merge-other" />
    </div>
  );
}

// The confirm sentence: names the kept record by name and id.
export const keptSentence = (keptName, keptId, other) =>
  `${other.name || "The other record"} (${other.id}) is merged into ${keptName} (${keptId}), the record that is kept.`;

export default KeptHeads;

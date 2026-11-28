// IMPORT-13 · FOUR CHOICES A MESSY MIGRATION ASKS, EACH ONCE FOR THE FILE.
// Dates Steward couldn't read, people with only an email, gifts changed since
// the last import, and notes that read like a flag. Each lists its rows; the
// default is outlined (it stands unless she chooses), a choice is filled.
// The questions come from shared/importGiftRules.js and server/imports/knownGifts.js.
import { T } from "../shared";

export const FILE_CHOICE_IDS = ["unreadableDates", "emailOnly", "changedGifts", "noteFlags"];
const usd = c => (c == null ? "" : (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const btn = (on, suggested) => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: on ? "none" : suggested ? "1px dashed " + T.greenDk : "1px solid " + T.bg3,
  borderRadius: 9, padding: "6px 12px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" });
const rowWords = (q, r) => {
  const where = `${r.sheet && r.sheet !== "Sheet1" ? `${r.sheet} ` : ""}row ${r.line}`;
  if (q.id === "unreadableDates") return `${where}: ${r.who || "someone"}, ${usd(r.cents)}, "${r.words}"`;
  if (q.id === "emailOnly") return `${where}: ${r.email}${r.cents != null ? `, ${usd(r.cents)}` : ""}`;
  if (q.id === "changedGifts") return `${where}: ${r.who}, ${r.sentence}`;
  return `${where}: ${r.name}, "${r.note}"`;
};

export function FileChoices({ questions = [], answers = {}, setAnswer, disabled }) {
  const qs = questions.filter(q => FILE_CHOICE_IDS.includes(q.id));
  if (!qs.length) return null;
  return qs.map(q => {
    const chosen = answers[q.id];
    return (
      <div key={q.id} data-testid={`sheet-choice-${q.id}`} style={{ background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" }}>{q.text}</div>
        {q.hint && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{q.hint}</div>}
        <details style={{ marginTop: 6, fontSize: 12, color: T.ink }}>
          <summary style={{ cursor: "pointer" }}>{`See the ${q.count === 1 ? "row" : `${q.count.toLocaleString("en-US")} rows`}`}</summary>
          {(q.rows || []).map((r, i) => <div key={i} data-testid={`sheet-choice-${q.id}-row`}>{rowWords(q, r)}</div>)}
          {q.count > (q.rows || []).length && <div>{`and ${(q.count - q.rows.length).toLocaleString("en-US")} more`}</div>}
        </details>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          {(q.options || []).map(o => (
            <button type="button" key={o.key} data-testid={`sheet-choice-${q.id}-${o.key}`} aria-pressed={chosen === o.key} disabled={disabled}
              data-suggested={!chosen && o.key === q.default ? "1" : undefined} style={btn(chosen === o.key, !chosen && o.key === q.default)}
              onClick={() => setAnswer({ [q.id]: o.key })}>{o.label}</button>))}
          {!chosen && <span style={{ fontSize: 12, color: T.ink3 }}>{`Steward suggests "${(q.options.find(o => o.key === q.default) || {}).label}"; it stands unless you choose.`}</span>}
        </div>
      </div>
    );
  });
}

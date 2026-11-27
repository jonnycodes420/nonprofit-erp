// IMPORT-11 · WHAT EACH SHEET IS (shared/sheetWorkbook.js).
// A workbook of several sheets says what Steward read each sheet as, names
// every sheet it set aside and why, and lets her correct it: People, Gifts or
// Leave this sheet out (answers.sheetKinds). Her answer re-reads the preview.
import { T } from "../shared";
import { SHEET_KINDS } from "../../../../shared/sheetWorkbook.js";

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const sel = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px", fontSize: 12.5, fontFamily: "inherit", background: T.white, color: T.ink };

export function SheetKinds({ u, answers, setAnswers, disabled }) {
  const tables = (u && u.tables) || [];
  const aside = (u && u.sheetsSetAside) || [];
  const sheets = [...new Set([...tables.map(t => t.sheet), ...aside.map(a => a.sheet)])];
  if (sheets.length < 2) return null;
  const chosen = (answers && answers.sheetKinds) || {};
  const kindOf = name => {
    if (chosen[name]) return chosen[name];
    const ts = tables.filter(t => t.sheet === name);
    return ts.some(t => t.kind === "gifts") ? "gifts" : ts.some(t => t.kind === "people") ? "people" : "skip";
  };
  const pick = (name, k) => setAnswers(a => ({ ...a, sheetKinds: { ...(a.sheetKinds || {}), [name]: k } }));
  const hasTable = name => tables.some(t => t.sheet === name);
  return (
    <div style={box} data-testid="sheet-kinds">
      <div style={h3}>What each sheet is</div>
      {u.joinSentence && <div data-testid="sheet-join" style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>{u.joinSentence}</div>}
      {sheets.map(name => {
        const a = aside.find(x => x.sheet === name);
        return (
          <div key={name} data-testid="sheet-kind-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid " + T.bg2, padding: "6px 0", fontSize: 13 }}>
            <span style={{ flex: "1 1 220px", overflowWrap: "anywhere" }}>
              <b>{name}</b>
              {a && <span data-testid="sheet-set-aside" style={{ ...small, display: "block" }}>{a.sentence}</span>}
            </span>
            {hasTable(name) && (
              <select aria-label={`What sheet ${name} is`} data-testid="sheet-kind-select" value={kindOf(name)} disabled={disabled} style={sel}
                onChange={e => pick(name, e.target.value)}>
                {SHEET_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            )}
          </div>
        );
      })}
      {(u.sheetKindRefused || []).map(r => (
        <div key={r.sheet} style={{ ...small, color: T.gold700, marginTop: 4 }}>Sheet '{r.sheet}' cannot be gifts: {r.reason}.</div>
      ))}
    </div>
  );
}

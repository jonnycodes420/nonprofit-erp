// IMPORT-10 item 6 · THE SAME FILE TWICE IS ASKED (server/imports/importedBefore.js).
// "You imported this file on Nov 12 (251 gifts). Import again anyway?" Import
// waits until she says so; Close leaves it, and nothing is written.
import { T } from "../shared";

const btn = on => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: on ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "6px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });

export function ImportedBefore({ q, setAnswer, onClose, disabled }) {
  if (!q) return null;
  return (
    <div data-testid="sheet-imported-before" style={{ background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{q.text}</div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>Importing it again adds every gift in it a second time. Undo the earlier import from Settings, Imports if you meant to replace it.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" data-testid="sheet-imported-before-close" style={btn(true)} onClick={onClose}>Close, don't import</button>
        <button type="button" data-testid="sheet-import-again" disabled={disabled} style={btn(false)} onClick={() => setAnswer({ importAgain: q.importId })}>Import again anyway</button>
      </div>
    </div>
  );
}

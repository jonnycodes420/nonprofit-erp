// IMPORT-11 · WHAT EVERY GIFT ROW HAD TO CLEAR (shared/importRowChecks.js,
// server/imports/outliers.js). One component, three places: the preview
// (each heading with her choice), the receipt and the import check page
// (each counted, whichever way she chose).
import { T } from "../shared";

const box = { background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 4px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = on => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: "1px solid " + (on ? T.greenDk : T.bg3), borderRadius: 9,
  padding: "4px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });
const money = c => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDay = d => { const [y, m, dd] = String(d || "").split("-").map(Number); return y ? new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; };
const where = r => `${r.sheet && r.sheet !== "Sheet1" ? `${r.sheet} ` : ""}row ${r.line}`;
const n = (k, one, many) => `${Number(k).toLocaleString("en-US")} ${k === 1 ? one : many}`;

// The future-dated sentence, with the real dates (never "the next Jan 1").
export function futureSentence(f) {
  if (!f || !f.count) return "";
  const span = f.from === f.to ? `dated ${longDay(f.from)}` : `dated from ${longDay(f.from)} to ${longDay(f.to)}`;
  return `${n(f.count, "gift is", "gifts are")} ${span}, after today. Each one counts on its date, not before, and gets no thank-you until then.`;
}

function Choice({ testid, options, value, onPick, disabled }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {options.map(o => (
        <button key={o.key} type="button" data-testid={`${testid}-${o.key}`} aria-pressed={value === o.key} disabled={disabled}
          style={btn(value === o.key)} onClick={() => onPick(o.key)}>{o.label}</button>))}
    </div>
  );
}

// The preview: each heading, its rows by line, and her choice.
export function RowChecksPreview({ u, answers, setAnswers, disabled }) {
  const rc = (u && u.rowChecks) || {};
  const outliersAside = (u.aside || []).filter(a => a.outlier);
  if (!rc.overCap && !rc.copies && !rc.future && !rc.outliers && !outliersAside.length) return null;
  const copiesNow = answers.copies || (rc.copies && !rc.copies.imported ? "skip" : "import");
  const outNow = answers.outliers === "skip" ? "skip" : "import";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="sheet-row-checks">
      {rc.overCap && (
        <div style={box} data-testid="sheet-over-cap">
          <div style={h3}>Over the most one gift can be</div>
          <div style={{ fontSize: 13 }}>{rc.overCap.sentence}</div>
        </div>)}
      {(rc.outliers || outliersAside.length > 0) && (
        <div style={box} data-testid="sheet-outliers">
          <div style={h3}>Far outside the pattern</div>
          {(rc.outliers ? rc.outliers.rows : []).map(r => (
            <div key={r.key} style={{ fontSize: 13 }} data-testid="sheet-outlier-row">{where(r)}: {r.who}, {money(r.cents)}. {r.sentence}.</div>))}
          {outNow === "skip" && outliersAside.map(a => (
            <div key={a.sheet + a.line} style={{ fontSize: 13 }} data-testid="sheet-outlier-row">{where(a)}: {a.who}, {money(a.cents || 0)}. Set aside.</div>))}
          <Choice testid="sheet-outliers" disabled={disabled} value={outNow}
            options={[{ key: "import", label: "Import them" }, { key: "skip", label: "Set them aside" }]}
            onPick={k => setAnswers(a => k === "skip"
              ? { ...a, outliers: "skip", outlierRows: [...new Set([...(a.outlierRows || []), ...((rc.outliers && rc.outliers.keys) || [])])] }
              : { ...a, outliers: undefined, outlierRows: undefined })} />
        </div>)}
      {rc.copies && (
        <div style={box} data-testid="sheet-copies">
          <div style={h3}>Exact copies</div>
          <div style={{ fontSize: 13 }} data-testid="sheet-copies-sentence">{rc.copies.sentence}</div>
          <Choice testid="sheet-copies" disabled={disabled} value={copiesNow}
            options={[{ key: "skip", label: "Skip the copies" }, { key: "import", label: "Import them anyway" }]}
            onPick={k => setAnswers(a => ({ ...a, copies: k }))} />
        </div>)}
      {rc.future && (
        <div style={{ ...box, borderColor: T.bg3 }} data-testid="sheet-future">
          <div style={h3}>Dated after today</div>
          <div style={{ fontSize: 13 }} data-testid="sheet-future-sentence">{futureSentence(rc.future)}</div>
          <div style={small}>{rc.future.rows.slice(0, 12).map(r => `${where(r)}: ${r.who}, ${money(r.cents)}, ${longDay(r.date)}`).join(" · ")}{rc.future.rows.length > 12 ? ` · and ${rc.future.rows.length - 12} more` : ""}</div>
        </div>)}
    </div>
  );
}

// The receipt and the import check page: each one counted, whichever way she chose.
export function RowChecksCounted({ rc, testid = "row-checks-counted" }) {
  if (!rc) return null;
  const lines = [];
  if (rc.overCap) lines.push(`${n(rc.overCap.count, "row", "rows")} over $100,000,000, set aside.`);
  if (rc.copies) lines.push(`${n(rc.copies.count, "row was an exact copy", "rows were exact copies")} of another row: ${rc.copies.imported ? "imported anyway" : "skipped"}.`);
  if (rc.outliers) lines.push(`${n(rc.outliers.count, "gift", "gifts")} far outside the pattern, imported.`);
  if (rc.outliersSetAside) lines.push(`${n(rc.outliersSetAside, "gift", "gifts")} far outside the pattern, set aside by you.`);
  if (rc.future) lines.push(futureSentence(rc.future));
  // IMPORT-13: unreadable dates, no-ID twins and gifts changed since the last import, each on its own line
  if (rc.unreadable) lines.push(rc.unreadable.sentence);
  if (rc.twins) lines.push(rc.twins.sentence);
  if (rc.changed && rc.changed.count) lines.push(`${n(rc.changed.count, "gift", "gifts")} changed since your last import: ${rc.changed.updated ? "updated to the file's amount, as you chose" : "set aside, Steward's gift unchanged"} (${rc.changed.rows.slice(0, 3).map(r => r.sentence).join("; ")}).`);
  if (!lines.length) return null;
  return <div data-testid={testid} style={{ ...small, color: T.ink }}>{lines.map(l => <div key={l}>{l}</div>)}</div>;
}

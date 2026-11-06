// IMPORT-9 · A MESSY FILE SAYS WHAT IT GUESSED (shared/sheetGuesses.js).
// The preview's three parts that say what the reader could not be sure of:
//   · the date question, once per column, which blocks Import until answered
//   · the rows a date column wrote another way, with what each was read as
//   · the amounts it tidied ("We tidied 6 amounts. See them.")
import React from "react";
import { T } from "../shared";

const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "12px 14px" };
const h3 = { fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" };
const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = on => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: on ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "6px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });

export function DateOrderQuestions({ questions, answers, onAnswer, disabled }) {
  if (!questions.length) return null;
  const chosen = answers.dateOrder || {};
  return (
    <div style={{ ...box, borderColor: T.gold500 }} data-testid="sheet-date-order">
      <div style={h3}>{questions.length === 1 ? "Which way are the dates written?" : `Which way are the dates written? (${questions.length} columns)`}</div>
      {questions.map(q => (
        <div key={q.id} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", fontSize: 13 }} data-testid="sheet-date-order-q">
          <div style={{ fontWeight: 700 }}>{q.text}</div>
          <div style={small}>{q.header}{q.sheet ? ` · ${q.sheet}` : ""}. {q.hint}</div>
          {(q.examples || []).length > 0 && (
            <div style={{ ...small, marginTop: 4 }}>
              {q.examples.map(x => `Row ${x.line}: ${x.raw} is ${x.month} or ${x.day}`).join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {(q.options || []).map(o => (
              <button type="button" key={o.key} data-testid={`sheet-date-order-${o.key}`} aria-pressed={chosen[q.key] === o.key} disabled={disabled}
                style={btn(chosen[q.key] === o.key)} onClick={() => onAnswer(q.key, o.key)}>{o.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GuessNotes({ u }) {
  const said = (u.dateGuesses || []).filter(g => g.sentence);
  const mixed = (u.dateGuesses || []).map(g => g.mixed).filter(Boolean);
  const tidy = u.tidiedAmounts;
  if (!said.length && !mixed.length && !tidy) return null;
  return (
    <div style={box} data-testid="sheet-guesses">
      <div style={h3}>What Steward tidied or read a particular way</div>
      {said.map(g => <div key={g.key} style={{ fontSize: 13, marginTop: 4 }} data-testid="sheet-date-order-said">{g.sentence}</div>)}
      {mixed.map(m => (
        <details key={m.sheet + m.header} style={{ fontSize: 13, marginTop: 6 }} data-testid="sheet-mixed-dates">
          <summary style={{ cursor: "pointer" }}>{m.sentence} <span style={{ color: T.greenDk, fontWeight: 700 }}>See them.</span></summary>
          <div style={{ ...small, marginTop: 4 }}>
            {m.rows.map(r => <div key={r.line}>Row {r.line}: "{r.raw}" read as {r.readAs || "no date (it could not be placed in a day)"}</div>)}
            {m.count > m.rows.length ? <div>and {(m.count - m.rows.length).toLocaleString("en-US")} more</div> : null}
          </div>
        </details>
      ))}
      {tidy && (
        <details style={{ fontSize: 13, marginTop: 6 }} data-testid="sheet-tidied-amounts">
          <summary style={{ cursor: "pointer" }}>We tidied {tidy.count.toLocaleString("en-US")} {tidy.count === 1 ? "amount" : "amounts"}. <span style={{ color: T.greenDk, fontWeight: 700 }}>See them.</span></summary>
          <div style={{ ...small, marginTop: 4 }}>
            {tidy.rows.map(r => <div key={r.sheet + r.line}>Row {r.line}{r.sheet ? ` of ${r.sheet}` : ""}: "{r.raw}" is {r.shown}</div>)}
            {tidy.count > tidy.rows.length ? <div>and {(tidy.count - tidy.rows.length).toLocaleString("en-US")} more</div> : null}
          </div>
        </details>
      )}
    </div>
  );
}

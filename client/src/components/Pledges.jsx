// FUNDRAISING-2 · PLEDGES. One view of every open pledge: what is still to
// come on it, what falls due this fiscal year, what is overdue, and each
// installment. The three totals are numbers.pledgeSummary, the figures Home
// and Fundraising's Overview read, and each pledge's "due this year" counts
// to the same day the profile does (GET /fundraising/pledges).
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmtFull, EmptyState } from "./shared";
import { Figure } from "./Figure";
import { DonorLink } from "./RecordLink";
import { displayDate } from "../../../shared/displayDate";

const row = { display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1.4fr) repeat(3, minmax(90px,1fr))", gap: 12, alignItems: "center", padding: "11px 18px", fontSize: 13, color: T.ink };
const head = { fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3, background: T.bg };
const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" };
const linkBtn = { background: "none", border: "none", padding: 0, font: "inherit", color: T.greenDk, cursor: "pointer", textAlign: "left" };
// On a phone the five columns become two: who and what is left, then the rest.
const PHONE_CSS = `@media (max-width: 640px) { .pledge-row-grid { grid-template-columns: 1fr 1fr !important; } .pledges-head { display: none !important; } }`;

export function PledgesView({ onNavigate }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => { apiFetch("/fundraising/pledges").then(setD).catch(() => setErr("Pledges did not load. Try again in a moment.")); }, []);
  if (err) return <div style={{ fontSize: 13, color: T.ink3, padding: 24 }}>{err}</div>;
  if (!d) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  const person = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const madeAt = m => !m ? null : m.kind === "event"
    ? <button onClick={() => onNavigate && onNavigate("events", { eventId: m.id })} style={linkBtn}>{m.name}</button>
    : <span>{m.name}</span>;
  return (
    <div data-testid="pledges-view" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        {[["open", "Still to come, all years"], ["dueThisYear", "Due this fiscal year"], ["overdue", "Overdue"]].map(([k, label]) => (
          <Figure key={k} kind="money" whole value={d[k]} label={label} definition={d.definitions[k]} source={d.sources[k]} figureKey={"pledges." + k} />
        ))}
      </div>
      {d.pledges.length === 0 ? (
        <EmptyState title="No open pledges" message="A pledge recorded on a person, or imported from an event file, shows here with what is due and when." />
      ) : (
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, boxShadow: T.shadow, overflow: "hidden" }}>
          <style>{PHONE_CSS}</style>
          <div className="pledges-head pledge-row-grid" style={{ ...row, ...head }}>
            <span>Who</span><span>Made at</span><span style={num}>Still to come</span><span style={num}>Due this year</span><span style={num}>Overdue</span>
          </div>
          {d.pledges.map(p => (
            <div key={p.id} data-testid="pledge-row" style={{ borderTop: "1px solid " + T.bg2 }}>
              <div className="pledge-row-grid" style={row}>
                <span style={{ minWidth: 0 }}>
                  <DonorLink id={p.donorId} onOpen={() => person(p.donorId)}>{p.donorName}</DonorLink>
                  {p.installments.length > 1 && (
                    <button onClick={() => setOpen(open === p.id ? null : p.id)} style={{ ...linkBtn, marginLeft: 8, fontSize: 12, color: T.ink3 }}>
                      {p.installments.length} installments {open === p.id ? "▴" : "▾"}
                    </button>
                  )}
                </span>
                <span style={{ fontSize: 12.5, color: T.ink2, minWidth: 0 }}>{madeAt(p.madeAt) || <span style={{ color: T.ink3 }}>Not tied to one</span>}</span>
                <span style={num}>{fmtFull(p.balance)}</span>
                <span style={num}>{p.dueThisYear ? fmtFull(p.dueThisYear) : "None"}</span>
                <span style={{ ...num, color: p.overdue ? T.gold700 : T.ink3, fontWeight: p.overdue ? 700 : 400 }}>{p.overdue ? fmtFull(p.overdue) : "None"}</span>
              </div>
              {(open === p.id || p.installments.length === 1) && p.installments.length > 0 && (
                <div style={{ padding: "0 18px 12px", display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {p.installments.map(i => (
                    <span key={i.id} style={{ fontSize: 12, borderRadius: 99, padding: "3px 10px", background: i.paid ? T.bg2 : i.overdue ? T.gold100 : T.bg,
                                              border: "1px solid " + (i.overdue ? T.gold300 : T.bg3), color: i.paid ? T.ink3 : T.ink }}>
                      {fmtFull(i.amount)} · {i.dueDate ? displayDate(i.dueDate) : "No date"} · {i.paid ? "paid" : i.overdue ? "overdue" : "due"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


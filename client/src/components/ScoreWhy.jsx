// ENGAGE-1 — the two scores on a donor's record, and "See why".
//
// The card sits in the profile rail under Next step (no new layout: one more
// panel in the panel that is already there). The numbers come from
// GET /donors/:id/scores; the words that explain them come from
// shared/engagementWeights.js through the same response, so the screen cannot
// describe a weight the arithmetic does not use. Every part's points open the
// rows it counted (figure sources donor-engagement-part / donor-generosity-part).
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal, fmtFull } from "./shared";
import MetricBreakdownPanel from "./MetricBreakdownPanel";

const BAND_COLOUR = { close: T.greenDk, warm: T.ink, distant: T.gold700 };

export function useScores(donorId) {
  const [s, setS] = useState(null);
  useEffect(() => {
    let live = true;
    setS(null);
    apiFetch(`/donors/${donorId}/scores`).then(r => { if (live) setS(r); }).catch(() => { if (live) setS(false); });
    return () => { live = false; };
  }, [donorId]);
  return s;
}

export function ScoreCard({ donorId, scores, children }) {
  const [why, setWhy] = useState(false);
  const s = scores;
  if (!s) return null;
  return (
    <div data-testid="dp-scores" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "14px 16px", color: T.ink }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>Engagement</span>
        <button type="button" data-testid="dp-score-engagement" onClick={() => setWhy(true)} title="See how this was worked out"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'DM Serif Display',serif", fontSize: 26, color: T.ink }}>
          {s.engagement}
        </button>
        <span data-testid="dp-score-band" style={{ fontSize: 13, fontWeight: 700, color: BAND_COLOUR[s.band] || T.ink }}>{s.bandLabel}</span>
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: T.ink2 }}>
          Generosity{" "}
          <button type="button" data-testid="dp-score-generosity" onClick={() => setWhy(true)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 800, fontSize: 14, color: T.ink, fontFamily: "inherit" }}>
            {s.generosity}
          </button>
        </span>
      </div>
      {s.reason && <div data-testid="dp-score-reason" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55, marginTop: 4 }}>{s.reason}</div>}
      <button type="button" data-testid="dp-score-why" onClick={() => setWhy(true)}
        style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
        See why
      </button>
      {why && <ScoreWhyModal s={s} onClose={() => setWhy(false)} />}
      {/* PROSPECT-1 — Room to give and an organization's public filing sit
          in this card, for the people allowed to see them. */}
      {children}
    </div>
  );
}

function rawWords(score, p) {
  if (score === "engagement") return p.count ? `${p.count} ${p.count === 1 ? p.one : p.many}` : "None in 24 months";
  if (p.key === "consistency") return `${p.raw} of the last 5 years`;
  if (p.key === "monthly") return p.raw ? "A recurring gift is running" : "No recurring gift";
  if (p.key === "upgrade" && !p.raw) return "Not giving more than the year before";
  return fmtFull(p.raw / 100);
}

function PartsTable({ score, parts, total, onOpen }) {
  return (
    <div data-testid={"score-parts-" + score} style={{ border: "1px solid " + T.bg3, borderRadius: 10, overflow: "hidden" }}>
      {parts.map(p => (
        <div key={p.key} data-score-part={p.key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "9px 12px", borderTop: "1px solid " + T.bg2, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{p.label}{p.weight ? <span style={{ color: T.ink3, fontWeight: 400 }}> · {Math.round(p.weight * 100)}%</span> : null}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>
              {rawWords(score, p)}{score === "generosity" && p.pct ? ` · ${p.pct} of 100 among your donors` : ""}
            </div>
          </div>
          <button type="button" data-part-points={p.points} onClick={() => onOpen(p)} title={`Open the rows behind ${p.label.toLowerCase()}`}
            style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontWeight: 800, fontSize: 13.5, color: T.ink, cursor: "pointer", fontFamily: "inherit", minWidth: 48 }}>
            {p.points}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", background: T.bg, borderTop: "1px solid " + T.bg3, fontSize: 13 }}>
        <span style={{ color: T.ink3 }}>The parts add up to the score</span>
        <strong data-testid={"score-total-" + score}>{total}</strong>
      </div>
    </div>
  );
}

export function ScoreWhyModal({ s, onClose }) {
  const [open, setOpen] = useState(null);   // { part, score }
  return (
    <Modal onClose={onClose} title="How these scores were worked out" width={560}>
      <div data-testid="score-why" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginBottom: 4 }}>Engagement {s.engagement} · {s.bandLabel}</div>
          <p style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, margin: "0 0 8px" }}>{s.explanation.engagement}</p>
          <PartsTable score="engagement" parts={s.parts.engagement} total={s.engagement} onOpen={p => setOpen({ p, score: "engagement" })} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginBottom: 4 }}>Generosity {s.generosity}</div>
          <p style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, margin: "0 0 8px" }}>{s.explanation.generosity}</p>
          <PartsTable score="generosity" parts={s.parts.generosity} total={s.generosity} onOpen={p => setOpen({ p, score: "generosity" })} />
        </div>
        <p style={{ fontSize: 12, color: T.ink3, margin: 0 }}>{s.explanation.parts}{s.computedFor ? ` Worked out for ${s.computedFor}.` : ""}</p>
      </div>
      {open && (
        <MetricBreakdownPanel open onClose={() => setOpen(null)} title={`${open.p.label}: ${open.p.points} of ${open.score === "engagement" ? s.engagement : s.generosity}`}
          explanation={open.p.how ? `Counts ${open.p.how}.` : undefined} source={open.p.source} />
      )}
    </Modal>
  );
}

// "Largest gift $2,000, last three averaged $1,500 and rising: ask $2,500".
export function SuggestedAskLine({ ask, style }) {
  if (!ask) return null;
  return (
    <div data-testid="suggested-ask" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.55, ...style }}>
      <strong style={{ color: T.ink }}>{ask.monthly ? "Suggested monthly ask:" : "Suggested one-time ask:"}</strong> {ask.sentence} <span style={{ color: T.ink3 }}>{ask.screening ? "From their own gifts and the screening file." : "From their own gifts only."}</span>
    </div>
  );
}

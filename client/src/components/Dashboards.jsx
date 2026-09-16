// BUILD-86 C.3 — DASHBOARDS, PLURAL. A left rail of four, each one question.
//
// Nothing on any of these screens appears without a one-sentence definition,
// available on hover and printed in the PDF footnote. The definition comes
// from shared/dashboards.js over the wire, so the sentence a board member
// reads here and the one printed in the packet are the same string rather
// than two copies that drift.
//
// Every number is a number a board can define. That is the whole rule, and it
// is why "stewardship debt" is not on any of them.
import { useEffect, useState } from "react";
import { apiFetch, API } from "../api";
import { T, fmtFull, Spin } from "./shared";
import { makeT } from "../../../shared/vocabulary";

const money = v => fmtFull(Number(v) || 0);

// The definition, on hover and reachable by keyboard. A tooltip nobody can
// reach is a definition that does not exist for half the people who need it.
function Def({ text }) {
  return (
    <span tabIndex={0} title={text} aria-label={text}
      style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: T.ink3, border: "1px solid " + T.bg3,
               borderRadius: 99, width: 15, height: 15, display: "inline-flex", alignItems: "center",
               justifyContent: "center", cursor: "help", verticalAlign: "middle" }}>?</span>
  );
}

function Figure({ m }) {
  const v = m.value;
  const blank = v === null || v === undefined;
  const text = blank ? "—"
    : m.kind === "money" ? money(v)
    : m.kind === "percent" ? `${v}%`
    : String(v);
  return (
    <div style={{ padding: "14px 18px", borderRight: "1px solid " + T.bg3, minWidth: 150, flex: "1 1 150px" }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3 }}>
        {m.label}<Def text={m.definition} />
      </div>
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, color: T.ink, marginTop: 4 }}>{text}</div>
      {/* A BLANK IS SAID, NOT GUESSED. A rate over nobody is not zero per cent. */}
      {blank && <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>not enough history yet</div>}
    </div>
  );
}

function Breakdown({ m }) {
  const rows = Array.isArray(m.value) ? m.value : [];
  return (
    <div style={{ borderTop: "1px solid " + T.bg3 }}>
      <div style={{ padding: "12px 18px 6px", fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3 }}>
        {m.label}<Def text={m.definition} />
      </div>
      {rows.length === 0
        ? <div style={{ padding: "0 18px 14px", fontSize: 12.5, color: T.ink3 }}>Nothing here yet.</div>
        : <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "7px 18px", fontSize: 13, color: T.ink, borderTop: i ? "1px solid " + T.bg3 : "none" }}>
                    {r.label}{r.when ? <span style={{ color: T.ink3 }}> · due {r.when}</span> : null}
                  </td>
                  <td style={{ padding: "7px 18px", fontSize: 13, fontWeight: 700, color: T.ink, textAlign: "right",
                               borderTop: i ? "1px solid " + T.bg3 : "none", whiteSpace: "nowrap" }}>
                    {/* The metric DECLARES whether its rows are money. */}
                    {r.suffix ? `${r.value}${r.suffix}`
                      : r.goal ? `${money(r.value)} of ${money(r.goal)}${r.percent != null ? ` · ${r.percent}%` : ""}`
                      : (m.rowsAre === "money" || r.money) ? money(r.value)
                      : r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
    </div>
  );
}

export function Dashboards({ data, onNavigate }) {
  const [rail, setRail] = useState([]);
  const [key, setKey] = useState("board");
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const t = makeT(data?.org?.vocabulary);

  useEffect(() => { apiFetch("/dashboards").then(r => setRail(r.dashboards || [])).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    apiFetch(`/dashboards/${key}`).then(r => { setBoard(r); setLoading(false); }).catch(() => setLoading(false));
  }, [key]);

  const figures = (board?.metrics || []).filter(m => m.kind !== "breakdown");
  const breakdowns = (board?.metrics || []).filter(m => m.kind === "breakdown");

  async function exportPdf() {
    // The PDF is fetched, not linked: it rides the same Authorization header
    // as every other read, so a board packet is never a URL somebody can pass
    // around without a session.
    const r = await fetch(`${API}/dashboards/${key}/pdf`, { headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") } });
    if (!r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${key}-${board?.asOf || "dashboard"}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* The rail is the SERVER's list, so it cannot drift from what exists. */}
      <nav className="dash-rail" style={{ flex: "0 0 178px", display: "flex", flexDirection: "column", gap: 2 }}>
        {rail.map(d => (
          <button key={d.key} onClick={() => setKey(d.key)}
            style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                     border: "none", background: key === d.key ? T.greenDk : "transparent",
                     color: key === d.key ? "#fff" : T.ink }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{d.label}</div>
            {/* The token, not a copy of it: sage400 IS cream-at-70% since C.1. */}
            <div style={{ fontSize: 11, color: key === d.key ? T.sage400 : T.ink3, marginTop: 1 }}>{d.question}</div>
          </button>
        ))}
      </nav>

      <div style={{ flex: "1 1 520px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, color: T.ink }}>{board?.question || ""}</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
              As of {board?.asOf || ""}. Numbers a board can read. Every one has a definition; hover the mark.
            </div>
          </div>
          <button onClick={exportPdf} disabled={!board}
            style={{ background: "transparent", border: "1px solid " + T.greenDk, borderRadius: 8, padding: "7px 13px",
                     color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: board ? "pointer" : "not-allowed" }}>
            Export PDF
          </button>
        </div>

        {loading && <div style={{ padding: 30 }}><Spin /></div>}
        {!loading && board && (
          <div style={{ background: "#fff", border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
            {figures.length > 0 && <div style={{ display: "flex", flexWrap: "wrap" }}>{figures.map(m => <Figure key={m.key} m={m} />)}</div>}
            {breakdowns.map(m => <Breakdown key={m.key} m={m} />)}
          </div>
        )}
        {!loading && board?.key === "people" && (
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 10, lineHeight: 1.6 }}>
            Drift watches every {t("giver", 1)}’s own giving pattern.{" "}
            <button onClick={() => onNavigate && onNavigate("dashboard")}
              style={{ background: "none", border: "none", color: T.greenDk, fontSize: 11.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
              See who is drifting today
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

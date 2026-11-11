// home/PortfolioCard.jsx · ACCESS-3. "YOUR PORTFOLIO", THE RAIL OF SOMEONE WHO
// SEES ONLY THEIR OWN PEOPLE.
//
// A Campaign cabinet member's rail was one line in a blank column. It is one
// card about their people now, read from GET /home/portfolio
// (server/home/portfolioCard.js), where every figure is shared/numbers over
// their people only:
//   their count, given this fiscal year, and how many have a step overdue
//   their top 5 people by this year's giving, each opening the profile
//   the next 3 touches, tasks or follow-ups on their Top 100 rows, with dates
// An empty portfolio is a sentence, never a row of zeros. Each figure carries
// its sentence (title) and opens the list it counts: the people on Donors,
// the overdue ones on Tasks.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { displayDateShort } from "../../../../shared/displayDate";

const card = { border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 16px 14px", background: T.white, display: "flex", flexDirection: "column", gap: 14 };
const eyebrow = { fontSize: 10, fontWeight: 800, color: T.ink3, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 };
const link = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: T.ink, cursor: "pointer", textAlign: "left" };
const dollars = cents => "$" + Math.round((Number(cents) || 0) / 100).toLocaleString("en-US");
const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function PortfolioCard({ onNavigate, openProfile }) {
  const [p, setP] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch("/home/portfolio").then(r => { if (live) setP(r || {}); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const go = (tab, opts) => onNavigate && onNavigate(tab, opts);
  if (failed) return <section data-testid="home-portfolio" style={card}><div style={eyebrow}>Your portfolio</div>
    <div style={{ fontSize: 13.5, color: T.ink2 }}>Your people could not be read just now. Your Donors list has them.</div></section>;
  if (!p) return <section data-testid="home-portfolio" aria-busy="true" style={{ ...card, minHeight: 220 }}><div style={eyebrow}>Your portfolio</div></section>;
  if (!p.scoped) return null;
  if (p.empty) return (
    <section data-testid="home-portfolio" style={card}>
      <div><div style={eyebrow}>Your portfolio</div>
        <div data-testid="portfolio-empty" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{p.sentence}</div></div>
    </section>
  );
  const S = p.sentences || {};
  return (
    <section data-testid="home-portfolio" aria-label="Your portfolio" style={card}>
      <div>
        <div style={eyebrow}>Your portfolio</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" data-testid="portfolio-people" title={S.people} onClick={() => go("donors")}
            style={{ ...link, fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, lineHeight: 1.1 }}>{plural(p.people, "person", "people")}</button>
          <div data-testid="portfolio-given" title={S.given} style={{ fontSize: 13.5, color: T.ink2 }}>
            <span style={{ color: T.ink, fontWeight: 700 }}>{dollars(p.givenCents)}</span> given this fiscal year</div>
          {p.overdue > 0
            ? <button type="button" data-testid="portfolio-overdue" title={S.overdue} onClick={() => go("tasks", { scope: "mine", view: "overdue" })}
                style={{ ...link, fontSize: 13.5, color: T.ink, fontWeight: 600 }}><span style={{ color: T.gold700, marginRight: 4 }}>●</span>{p.overdue.toLocaleString("en-US")} with a next step overdue</button>
            : <div data-testid="portfolio-overdue" title={S.overdue} style={{ fontSize: 13.5, color: T.ink2 }}>No next step is overdue.</div>}
        </div>
      </div>

      <div data-testid="portfolio-top" title={S.top}>
        <div style={eyebrow}>Gave most this year</div>
        {p.top && p.top.length
          ? <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {p.top.map(t => (
                <li key={t.id}>
                  <button type="button" onClick={() => openProfile && openProfile(t.id)}
                    style={{ ...link, width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{t.name}</span>
                    <span style={{ color: T.ink2, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{dollars(t.cents)}</span>
                  </button>
                </li>
              ))}
            </ol>
          : <div style={{ fontSize: 13.5, color: T.ink2 }}>None of your people has given yet this fiscal year.</div>}
      </div>

      <div data-testid="portfolio-next" title={S.next}>
        <div style={eyebrow}>Next on your Top 100</div>
        {p.next && p.next.length
          ? <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {p.next.map(n => (
                <li key={n.kind + n.id}>
                  <button type="button" onClick={() => openProfile && openProfile(n.donorId)} style={{ ...link, width: "100%", display: "flex", gap: 10, alignItems: "baseline" }}>
                    <span style={{ flexShrink: 0, width: 52, fontSize: 12.5, fontWeight: 700, color: n.overdue ? T.gold700 : T.ink2 }}>{n.due ? displayDateShort(n.due, new Date()) : "No date"}</span>
                    <span style={{ minWidth: 0, lineHeight: 1.4 }}>{n.label}<span style={{ color: T.ink3 }}> · {n.name}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          : <div style={{ fontSize: 13.5, color: T.ink2 }}>{p.onTop100 ? "Nothing is planned for your people on the Top 100." : "None of your people is on the Top 100."}</div>}
      </div>
    </section>
  );
}

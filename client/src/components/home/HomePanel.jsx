// home/HomePanel.jsx · HOME-7 items 2 and 5. THE TABBED PANEL, AND THE BOTTOM ROW.
//
// Under the five: The Thread, Thank-yous, Recent gifts and Drift, each tab with
// its count, and each count the number its full list shows (HOME-6). The Thread
// is the default; each person's last tab is remembered. The bottom row's two
// cards (four recent gifts, three drifting people) read exactly what the tabs
// read: GET /home/cards (server/reports/homeCards.js) and the five's drift list
// (server/insights/driftPeople.js). No second rule anywhere.
import { useEffect, useState } from "react";
import { T } from "../shared";
import { Figure } from "../Figure";
import { fmtWhole } from "../../lib/money";
import { displayDateShort } from "../../../../shared/displayDate.js";

const TABS = [["thread", "The Thread"], ["thanks", "Thank-yous"], ["gifts", "Recent gifts"], ["drift", "Drift"]];
const LI = { display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderTop: "1px solid " + T.bg2, fontSize: 14 };
const NAME = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 14, color: T.ink, fontWeight: 700, cursor: "pointer", textAlign: "left" };
const LNK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" };
const DEF = { fontSize: 12.5, lineHeight: 1.45, color: T.ink3, margin: "2px 0 6px" };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOf = d => DAY[new Date(String(d).slice(0, 10) + "T12:00:00Z").getUTCDay()];
const money = cents => fmtWhole((Number(cents) || 0) / 100);
const tabKey = uid => `steward.homeTab.${uid || "me"}`;
export const openHomeTab = k => {
  window.dispatchEvent(new CustomEvent("steward:home-tab", { detail: k }));
  const el = document.querySelector('[data-testid="home-panel"]');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

// A Thread row's day: "2 days late" (brass, never red), Today, or the weekday / date it is due.
function when(x, today) {
  const due = x.nextStep && x.nextStep.due ? String(x.nextStep.due).slice(0, 10) : null;
  if (x.overdue) { const n = Math.max(1, x.overdueDays || 1); return { late: true, words: n === 1 ? "1 day late" : `${n} days late` }; }
  if (x.band === "today" || due === today) return { words: "Today" };
  if (!due) return { words: "" };
  const days = Math.round((Date.parse(due + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
  return { words: days > 0 && days < 7 ? dayOf(due) : displayDateShort(due, new Date()) };
}

export function HomePanel({ userId, today, threads, threadOpen, finishRow, onSeeThread, cards, drift, thankYouDrafts, onNavigate, openProfile, isReadOnly }) {
  const [tab, setTab] = useState(() => { try { const k = localStorage.getItem(tabKey(userId)); return TABS.some(t => t[0] === k) ? k : "thread"; } catch { return "thread"; } });
  const pick = k => { setTab(k); try { localStorage.setItem(tabKey(userId), k); } catch { /* private mode */ } };
  useEffect(() => { const on = e => pick(e.detail); window.addEventListener("steward:home-tab", on); return () => window.removeEventListener("steward:home-tab", on); }, []);
  const ty = cards && cards.thankYous, rg = cards && cards.recentGifts;
  const counts = { thread: threadOpen, thanks: ty ? ty.n : null, gifts: rg ? rg.gifts : null, drift: drift ? drift.count : null };
  const who = (id, name) => <button type="button" style={NAME} onClick={() => openProfile(id)}>{name}</button>;

  const body = () => {
    if (tab === "thread") {
      const rows = (threads || []).slice(0, 6);
      return <>
        <p style={DEF}>The Thread is one open next step per person. Each stays here until it's done.</p>
        {!rows.length && <div style={{ ...LI, color: T.ink2 }}>Nothing is waiting on you.</div>}
        {rows.map(x => { const w = when(x, today); return (
          <div key={x.id} data-testid="panel-thread-row" style={LI}>
            <span style={{ flex: "0 0 88px", fontSize: 13, fontWeight: 600, color: w.late ? T.gold700 || T.gold : T.ink2 }}>{w.words}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{who(x.donorId, x.donorName)} <span style={{ color: T.ink2 }}>· {x.nextStep ? x.nextStep.label : ""}</span></span>
            {!isReadOnly && <button type="button" data-testid="panel-thread-done" style={LNK} onClick={() => finishRow(x)}>Done</button>}
          </div>
        ); })}
        {threadOpen > 0 && <div style={{ paddingTop: 12 }}><button type="button" data-testid="panel-thread-all" style={LNK} onClick={onSeeThread}>See all {threadOpen.toLocaleString("en-US")} in the Thread</button></div>}
      </>;
    }
    if (tab === "thanks") return ty ? <>
      <p style={DEF}>{ty.sentence}</p>
      {(ty.rows || []).slice(0, 6).map(g => (
        <div key={g.id} style={LI}><span style={{ flex: 1, minWidth: 0 }}>{who(g.donorId, g.name)} <span style={{ color: T.ink2 }}>· {displayDateShort(g.date, new Date())}{g.fund ? ` · ${g.fund}` : ""}</span></span>
          <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(g.cents)}</span></div>
      ))}
      {ty.n > 0 && <div style={{ paddingTop: 12, fontSize: 13.5 }}>
        <Figure variant="inline" value={ty.n} label="Gifts waiting to be thanked" definition={ty.definition} source={ty.source} figureKey="home-thanks-tab" why={false} /> {ty.n === 1 ? "gift waits" : "gifts wait"} in all.</div>}
      {thankYouDrafts}
    </> : null;
    if (tab === "gifts") return rg ? <>
      <p style={DEF}>{rg.definition}</p>
      <GiftRows rows={(rg.rows || []).slice(0, 8)} who={who} />
      {rg.gifts === 0 && <div style={{ ...LI, color: T.ink2 }}>No gifts in the last 7 days.</div>}
      {rg.gifts > 0 && <div style={{ paddingTop: 12, fontSize: 13.5 }}>
        <Figure variant="inline" value={rg.gifts} label="Gifts in the last 7 days" definition={rg.definition} source={rg.source} figureKey="home-gifts-tab" why={false} /> {rg.gifts === 1 ? "gift" : "gifts"} in the last 7 days.</div>}
    </> : null;
    return drift ? <>
      <p style={DEF}>People whose giving pattern changed, with the reason beside each.</p>
      <DriftRows people={(drift.people || []).slice(0, 6)} who={who} />
      {!drift.count && <div style={{ ...LI, color: T.ink2 }}>Nobody is past their own giving rhythm.</div>}
      {drift.count > 0 && <div style={{ paddingTop: 12 }}><button type="button" style={LNK} onClick={() => onNavigate && onNavigate("donors", { view: "drift" })}>See all {drift.count.toLocaleString("en-US")} in Drift</button></div>}
    </> : null;
  };

  return (
    <section aria-label="The Thread, thank-yous, recent gifts and Drift" data-testid="home-panel" className="home-card" style={{ paddingTop: 0 }}>
      <div role="tablist" style={{ display: "flex", gap: 20, borderBottom: "1px solid " + T.bg2, overflowX: "auto" }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={"panel-tab-" + k} data-count={counts[k] ?? ""} onClick={() => pick(k)}
            style={{ font: "600 14px inherit", fontFamily: "inherit", background: "none", border: "none", borderBottom: "2px solid " + (tab === k ? T.greenDk : "transparent"), color: tab === k ? T.ink : T.ink2, padding: "14px 2px", cursor: "pointer", minHeight: 44, whiteSpace: "nowrap" }}>
            {label}{counts[k] != null ? ` · ${Number(counts[k]).toLocaleString("en-US")}` : ""}</button>
        ))}
      </div>
      <div role="tabpanel" data-testid={"panel-" + tab} style={{ paddingTop: 12 }}>{body()}</div>
    </section>
  );
}

function GiftRows({ rows, who }) {
  return rows.map(g => (
    <div key={g.id} data-testid="home-gift-row" style={{ ...LI, alignItems: "flex-start" }}>
      <span style={{ flex: 1, minWidth: 0 }}>{who(g.donorId, g.name)}<div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{[dayOf(g.date), g.how, g.fund].filter(Boolean).join(" · ")}</div></span>
      <span style={{ textAlign: "right" }}><span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtWhole(g.cents / 100)}</span>
        <div style={{ fontSize: 12.5, color: g.status === "To thank" ? T.gold700 || T.gold : T.ink3, marginTop: 2 }}>{g.status}</div></span>
    </div>
  ));
}
function DriftRows({ people, who }) {
  return people.map(p => (
    <div key={p.id} data-testid="home-drift-row" style={{ ...LI, alignItems: "flex-start" }}>
      <span style={{ flex: 1, minWidth: 0 }}>{who(p.id, p.name)}<div style={{ fontSize: 13, color: T.ink2, marginTop: 2, lineHeight: 1.45 }}>{p.reason}</div></span>
    </div>
  ));
}

// The bottom row: four recent gifts and three drifting people, the tabs' own reads.
export function HomeBottomRow({ cards, drift, openProfile }) {
  const rg = cards && cards.recentGifts;
  const who = (id, name) => <button type="button" style={NAME} onClick={() => openProfile(id)}>{name}</button>;
  const head = (title, n, link, onLink) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.ink }}>{title}</h3>
      {n > 0 && <button type="button" style={LNK} onClick={onLink}>{link}</button>}
    </div>
  );
  return (
    <div className="home-pair" data-testid="home-bottom-row">
      {rg && <section className="home-card" data-testid="home-gifts-card">
        {head("Recent gifts", rg.gifts, "All gifts", () => openHomeTab("gifts"))}
        <p style={DEF}>{rg.definition}</p>
        <GiftRows rows={(rg.rows || []).slice(0, 4)} who={who} />
        {!rg.gifts && <div style={{ ...LI, color: T.ink2 }}>No gifts in the last 7 days.</div>}
      </section>}
      {drift && <section className="home-card" data-testid="home-drift-card">
        {head("Drift", drift.count, `All ${(drift.count || 0).toLocaleString("en-US")}`, () => openHomeTab("drift"))}
        <p style={DEF}>People whose giving pattern changed, with the reason beside each.</p>
        <DriftRows people={(drift.people || []).slice(0, 3)} who={who} />
        {!drift.count && <div style={{ ...LI, color: T.ink2 }}>Nobody is past their own giving rhythm.</div>}
      </section>}
    </div>
  );
}

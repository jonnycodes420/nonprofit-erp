// HOME-4 · THE RIGHT RAIL, FAST AND CALM. It drew piece by piece after the
// page (each part asked for its own read and drew nothing until it came back),
// and what it drew was three zeros, a long list and a box of explanation.
//
// Now every read the rail needs is asked for at once, in its own bundle beside
// the deck's (lib/homeReads.js RAIL_READS, started with Home). Until they are
// all back the rail draws placeholders in its final shape, so nothing jumps.
// Then: Today as one card with no zeros, the calls with the top three, To
// confirm as one line, and the automatic email line as SEND-GATE-2 placed it.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { SkeletonBar } from "./Skeleton";
import { openCheckSnap } from "./CheckSnap";
import { reloadMailTypes } from "../lib/mailTypes";

const card = { border: "1px solid " + T.bg3, borderRadius: 14, padding: "12px 14px", background: T.white };
const eyebrow = { fontSize: 10, fontWeight: 800, color: T.ink3, marginBottom: 6 };
const link = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: T.greenDk, fontWeight: 700, cursor: "pointer", textAlign: "left" };

// The rail's own reads: the calls, the goal under them, the To confirm count
// and the automatic email line. Each one settles (answer or failure) once, and
// the rail is ready when all of them have.
export function useRailReads() {
  const [calls, setCalls] = useState(undefined);
  const [goal, setGoal] = useState(undefined);
  const [clock, setClock] = useState(undefined);
  const [mail, setMail] = useState(false);
  useEffect(() => {
    let alive = true;
    const loadClock = () => apiFetch("/thank-yous/clock").then(r => { if (alive) setClock(r || null); }).catch(() => { if (alive) setClock(null); });
    apiFetch("/home/calls").then(r => { if (alive) setCalls(r || null); }).catch(() => { if (alive) setCalls(null); });
    apiFetch("/home/annual-goal").then(r => { if (alive) setGoal(r && r.goal ? r.goal : null); }).catch(() => { if (alive) setGoal(null); });
    loadClock();
    Promise.resolve(reloadMailTypes()).finally(() => { if (alive) setMail(true); });
    // CHECK-2: a check read from anywhere moves the waiting line at once.
    window.addEventListener("steward:capture-changed", loadClock);
    return () => { alive = false; window.removeEventListener("steward:capture-changed", loadClock); };
  }, []);
  return { calls, goal, clock, ready: calls !== undefined && goal !== undefined && clock !== undefined && mail };
}

// Today: only what is not zero, as short lines with counts. Nothing due is one line.
export function TodayCard({ items }) {
  const live = items.filter(i => typeof i.n === "number" && i.n > 0);
  return (
    <div data-testid="home-today" style={card}>
      <div style={eyebrow}>Today</div>
      {live.length === 0
        ? <div data-testid="home-today-none" style={{ fontSize: 13.5, color: T.ink2 }}>Nothing due today.</div>
        : <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6 }}>
            {live.map((i, k) => (
              <span key={i.key}>{k > 0 && <span aria-hidden style={{ color: T.ink3 }}> · </span>}
                <button type="button" data-testid={"home-today-" + i.key} onClick={i.onOpen} title={i.definition}
                  style={{ ...link, color: T.ink, fontWeight: 600 }}>{i.n.toLocaleString("en-US")} {i.n === 1 ? i.one : i.many}</button>
              </span>
            ))}
          </div>}
    </div>
  );
}

// To confirm: the count and the action, or, with none waiting, one short line and Snap a check.
export function ToConfirmLine({ clock, onNavigate }) {
  if (!clock) return null;
  const n = Number(clock.waiting) || 0;
  return (
    <div data-testid="home-to-confirm" style={{ ...card, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 13.5, color: T.ink }}>
      {n > 0 ? <>
        <span data-testid="home-to-confirm-count">{n.toLocaleString("en-US")} {n === 1 ? "gift" : "gifts"} waiting to confirm</span>
        <span aria-hidden style={{ color: T.ink3 }}>·</span>
        <button type="button" data-testid="home-to-confirm-review" style={link} onClick={() => onNavigate && onNavigate("fundraising", { frSection: "toconfirm" })}>Review</button>
      </> : <>
        <span style={{ color: T.ink2 }}>A check can be read from a photo.</span>
        <button type="button" data-testid="home-snap-check" style={link} onClick={() => openCheckSnap({ camera: true })}>Snap a check</button>
      </>}
    </div>
  );
}

// Placeholders in the rail's final shape: Today, the calls, To confirm, the email line.
export function HomeRailSkeleton() {
  const line = (w, h = 12) => <div style={{ margin: "6px 0" }}><SkeletonBar width={w} height={h} /></div>;
  return (
    <div data-testid="home-rail-loading" aria-busy="true" aria-label="Loading Today" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>{line(44, 9)}{line("70%")}</div>
      <div style={{ padding: "4px 0" }}>{line(120, 18)}{[0, 1, 2].map(i => <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid " + T.bg2 : "none" }}>{line("80%")}{line("45%", 10)}</div>)}</div>
      <div style={card}>{line("75%")}</div>
      {line("90%")}
    </div>
  );
}

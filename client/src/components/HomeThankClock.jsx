// CAPTURE-1 · Home's "Gift to thank-you" tile (approved from the mockup in
// docs/capture-1/home-mockup/). One line, the same number Acknowledgments
// shows (GET /thank-yous/clock, figure source gift-to-thanked), its 30 days as
// bars, and the cards waiting in To confirm. Draws nothing until it has an
// answer, and nothing at all for an org with no thanked gift and no card.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure } from "./Figure";
import { openCheckSnap } from "./CheckSnap";

const BAR_H = 56;

export function HomeThankClock({ onNavigate }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => apiFetch("/thank-yous/clock").then(r => { if (alive) setC(r); }).catch(() => {});
    load();
    // CHECK-2: a check read from anywhere moves the waiting line at once.
    window.addEventListener("steward:capture-changed", load);
    return () => { alive = false; window.removeEventListener("steward:capture-changed", load); };
  }, []);
  if (!c) return null;
  // CHECK-2: the tile's own way in. A check snapped here (the camera on a
  // phone) becomes a card in the same window as anywhere else.
  const snap = (
    <button type="button" data-testid="home-snap-check" onClick={() => openCheckSnap({ camera: true })}
      style={{ marginTop: 12, background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
      Snap a check
    </button>
  );
  if (!c.count && !c.waiting) {
    return (
      <div data-testid="home-thank-clock" style={{ border: "1px solid " + T.bg3, borderRadius: 14, padding: "14px 16px", background: T.white }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>To confirm</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>A check that arrives can be read from a photo. Nothing is logged until you confirm it.</div>
        {snap}
      </div>
    );
  }
  const trend = Array.isArray(c.trend) ? c.trend : [];
  const top = Math.max(1, ...trend.map(d => d.days || 0));
  const openWaiting = () => onNavigate && onNavigate("fundraising", { frSection: "toconfirm" });
  return (
    <div data-testid="home-thank-clock" style={{ border: "1.5px solid " + T.green, borderRadius: 14, padding: "14px 16px", background: T.white }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>Gift to thank-you</div>
      <div style={{ fontSize: 14.5, lineHeight: 1.45, color: T.ink }}>
        {c.days == null ? `No gifts were thanked in the last 30 days.` : (
          <>Average time from gift to thank-you, last 30 days:{" "}
            <strong>
              <Figure variant="inline" kind="count" value={Number(c.days)} suffix={Number(c.days) === 1 ? " day" : " days"}
                label="Average time from gift to thank-you" definition={c.definition} source={{ key: c.source || "gift-to-thanked", params: {} }}
                figureKey="home-gift-to-thanked" />
            </strong></>
        )}
      </div>
      {c.count > 0 && trend.length > 0 && (
        <div data-testid="home-thank-trend" aria-label="Average days to thank-you, by the day it was thanked, over the last 30 days" role="img" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: BAR_H }}>
            {trend.map(d => (
              <div key={d.date} title={d.days == null ? `${d.date}: nothing thanked` : `${d.date}: ${d.count} thanked, ${d.days.toFixed(1)} days on average`}
                style={{ flex: "1 1 0", minWidth: 0, borderRadius: 2,
                         height: d.days == null ? 2 : Math.max(4, Math.round((d.days / top) * BAR_H)),
                         background: d.days == null ? T.bg3 : T.green, opacity: d.days == null ? 1 : 0.75 }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.ink3, marginTop: 4 }}>
            <span>30 days ago</span><span>today</span>
          </div>
        </div>
      )}
      {c.waiting > 0 && (
        <button type="button" data-testid="home-thank-waiting" onClick={openWaiting}
          style={{ display: "block", marginTop: 12, padding: 0, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                   fontSize: 14.5, fontWeight: 700, color: T.green, textAlign: "left" }}>
          {c.waiting} {c.waiting === 1 ? "gift" : "gifts"} waiting to be confirmed
        </button>
      )}
      {snap}
      <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: T.ink3 }}>
        From when a gift arrives (the check date or the email) to when its thank-you is sent, or marked thanked by a call or a note. The number opens its gifts, slowest first.
      </div>
    </div>
  );
}

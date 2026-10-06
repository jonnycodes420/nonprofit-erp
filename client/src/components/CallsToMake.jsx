// PARITY-1 Part C · HOME'S "CALLS TO MAKE", in the right column under Today.
//
// This week's first-time donors and the big gifts nobody has thanked by phone
// yet (callsToMake.js on the server says exactly which). Each row names the
// person (opening their record), the gift (a figure that opens that gift), the
// day, and two actions: Mark called logs a thank-you call she made, and Snooze
// hides the row for a week. Steward lists and logs; the call is hers.
//
// Under it, the org's annual goal, drawn by the same GoalRow the Fundraising
// dashboard uses from the same server row, so the raised figure opens its gifts.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure, FigureContext } from "./Figure";
import { DonorLink } from "./RecordLink";
import { GoalRow } from "./Dashboards";

const dollars = c => "$" + (Math.round(Number(c) || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const smallBtn = { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 7, padding: "4px 9px", fontSize: 12,
                   fontWeight: 600, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

export function CallsToMake({ isAdmin = false, isReadOnly = false, onOpenPerson, limit = 0 }) {
  // HOME-TIDY: on Home the first `limit` people show and the rest open in place.
  const [all, setAll] = useState(false);
  const [data, setData] = useState(undefined);
  const [goal, setGoal] = useState(undefined);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [editFloor, setEditFloor] = useState(false);
  const [floorIn, setFloorIn] = useState("");

  const load = () => apiFetch("/home/calls").then(setData).catch(() => setData(null));
  useEffect(() => {
    load();
    apiFetch("/home/annual-goal").then(r => setGoal(r && r.goal ? r.goal : null)).catch(() => setGoal(null));
  }, []);

  async function act(row, kind) {
    setBusy(row.giftId + kind); setErr(null);
    try {
      await apiFetch(`/gifts/${encodeURIComponent(row.giftId)}/${kind === "called" ? "thank-call" : "call-snooze"}`, { method: "POST", body: "{}" });
      // The row leaves by the list's own rule; the count is asked again so it
      // stays the number of rows its source opens.
      setData(d => d ? { ...d, rows: d.rows.filter(r => r.giftId !== row.giftId) } : d);
      load();
    } catch (e) { setErr(e?.message || "That did not save."); }
    setBusy(null);
  }
  async function saveFloor() {
    setErr(null);
    try {
      await apiFetch("/settings/call-floor", { method: "PUT", body: JSON.stringify({ amount: floorIn }) });
      setEditFloor(false); load();
    } catch (e) { setErr(e?.message || "That did not save."); }
  }

  if (data === undefined) return null;
  const allRows = data?.rows || [];
  const rows = limit && !all ? allRows.slice(0, limit) : allRows;
  return (
    <FigureContext.Provider value={{ openPerson: onOpenPerson || null }}>
      <div data-testid="home-calls" style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid " + T.bg2 }}>
        {data && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Calls to make</span>
              <span style={{ fontSize: 14, color: T.ink }}>
                <Figure variant="cell" figureKey="calls-to-make" value={data.count.value} kind="count" label={data.count.label}
                  definition={data.count.definition} source={data.count.source} />
              </span>
            </div>
            {limit ? <div style={{ margin: "2px 0 8px" }}><span tabIndex={0} title={data.count.definition} aria-label={data.count.definition} data-testid="calls-def"
                style={{ fontSize: 11.5, color: T.ink3, cursor: "help", textDecoration: "underline dotted" }}>Who is on this list?</span></div>
              : <div style={{ fontSize: 11.5, lineHeight: 1.45, color: T.ink3, margin: "4px 0 10px" }}>{data.count.definition}</div>}
            {rows.length === 0
              ? <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>Nobody is waiting on a thank-you call.</div>
              : rows.map((r, i) => (
                <div key={r.giftId} data-testid="home-call-row" style={{ padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid " + T.bg2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                      <DonorLink id={r.donorId} onOpen={onOpenPerson ? () => onOpenPerson(r.donorId) : undefined}
                        style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 13.5, fontWeight: 600, color: T.ink,
                                 cursor: "pointer", textAlign: "left" }}>{r.name}</DonorLink>
                      {r.firstTime && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: T.ink, background: T.bg2,
                                                     border: "1px solid " + T.gold, borderRadius: 99, padding: "1px 7px", whiteSpace: "nowrap" }}>1st time</span>}
                    </span>
                    <span style={{ fontSize: 13.5, flexShrink: 0 }}>
                      <Figure variant="cell" figureKey={"call-gift-" + r.giftId} value={r.amount} kind="money" label={`${r.name} · the gift`}
                        definition="This one gift, at its own amount." source={r.source} />
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: T.ink3 }}>{r.dateLabel}</span>
                    {!isReadOnly && <span style={{ display: "flex", gap: 6 }}>
                      <button data-testid="home-call-called" disabled={!!busy} onClick={() => act(r, "called")}
                        style={limit ? { ...smallBtn, color: T.greenDk, borderColor: T.greenDk } : { ...smallBtn, background: T.greenDk, borderColor: T.greenDk, color: T.white }}>{limit ? "Called" : "Mark called"}</button>
                      <button data-testid="home-call-snooze" disabled={!!busy} onClick={() => act(r, "snooze")}
                        title={`Hide this for ${data.snoozeDays} days`} style={limit ? { ...smallBtn, border: "none", color: T.ink3 } : smallBtn}>Snooze</button>
                    </span>}
                  </div>
                </div>
              ))}
            {limit > 0 && allRows.length > limit && (
              <button data-testid="calls-see-all" onClick={() => setAll(v => !v)}
                style={{ background: "none", border: "none", padding: 0, marginTop: 6, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {all ? "Show three" : `Show ${allRows.length - limit} more`}</button>
            )}
            {data.more > 0 && (!limit || all) && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>and {data.more} more, in the count above.</div>}
            {isAdmin && !isReadOnly && (!limit || all) && (
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 10 }}>
                {editFloor ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    Gifts of $<input aria-label="Gift size for a thank-you call" value={floorIn} onChange={e => setFloorIn(e.target.value)} inputMode="decimal"
                      style={{ width: 80, border: "1px solid " + T.bg3, borderRadius: 6, padding: "3px 6px", fontSize: 12, fontFamily: "inherit" }} /> or more
                    <button onClick={saveFloor} style={{ ...smallBtn, color: T.greenDk, borderColor: T.greenDk }}>Save</button>
                    <button onClick={() => setEditFloor(false)} style={smallBtn}>Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => { setFloorIn(String(Math.round(data.floorCents) / 100)); setEditFloor(true); }}
                    style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11.5, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
                    Change the gift size ({dollars(data.floorCents)})
                  </button>
                )}
              </div>
            )}
            {err && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{err}</div>}
          </>
        )}
        {goal && (
          <div data-testid="home-annual-goal" style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>Annual goal</div>
            <GoalRow r={goal} first />
          </div>
        )}
      </div>
    </FigureContext.Provider>
  );
}

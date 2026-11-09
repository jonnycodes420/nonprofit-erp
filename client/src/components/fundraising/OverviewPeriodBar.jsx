// client/src/components/fundraising/OverviewPeriodBar.jsx · TRUTH-5.
//
// W-1109-Fundraising-07: Fundraising Overview had no period switch, so last
// fiscal year could not be compared. This FY (the default) / Last FY / custom
// days, kept in the address bar (frPeriod, frFrom, frTo) so a link opens the
// same period. The overview's figures are read over the span by the one
// computation Reports reads, so they match Reports for the same dates.
//
// W-1108-Fundraising-15: the tile beside it says LYBUNT, the one population
// that word names (shared/lapseWords.js), defined on hover, and its number is
// the LYBUNT report's own header (the rows on screen), read from the report.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { LAPSE_WORDS } from "../../../../shared/lapseWords.js";

const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
// The overview's address for the period in the bar's address (or the default).
export function overviewUrl(search = typeof window !== "undefined" ? window.location.search : "") {
  const q = new URLSearchParams(search);
  const p = q.get("frPeriod");
  if (p === "last_fy") return "/fundraising/overview?period=last_fy";
  if (p === "custom" && isDay(q.get("frFrom")) && isDay(q.get("frTo"))) return `/fundraising/overview?period=custom&from=${q.get("frFrom")}&to=${q.get("frTo")}`;
  return "/fundraising/overview";
}
function writePeriod(key, from, to) {
  const u = new URL(window.location.href);
  for (const k of ["frPeriod", "frFrom", "frTo"]) u.searchParams.delete(k);
  if (key !== "this_fy") u.searchParams.set("frPeriod", key);
  if (key === "custom") { u.searchParams.set("frFrom", from); u.searchParams.set("frTo", to); }
  window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
}

const chip = on => ({ background: on ? T.ink : T.white, color: on ? T.white : T.ink, border: "1px solid " + (on ? T.ink : T.bg3), borderRadius: 8,
  padding: "6px 12px", fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit" });

export function OverviewPeriodBar({ overview, onPicked, onNavigate }) {
  const key = (overview && overview.periodKey) || "this_fy";
  const p = (overview && overview.period) || {};
  const [from, setFrom] = useState(key === "custom" ? p.start || "" : "");
  const [to, setTo] = useState(key === "custom" ? p.end || "" : "");
  const [lybunt, setLybunt] = useState(null);
  const fiscal = overview && overview.yearMode !== "calendar";
  const year = key !== "custom" && p.end ? Number(String(p.end).slice(0, 4)) : null;
  useEffect(() => {
    if (!year) { setLybunt(null); return; }
    let live = true;
    apiFetch(`/reports/lybunt?year=${year}&yearMode=${fiscal ? "fiscal" : "calendar"}`)
      .then(r => { if (live) setLybunt({ n: (r.units || r.rows || []).length, people: (r.rows || []).length }); }).catch(() => { if (live) setLybunt(null); });
    return () => { live = false; };
  }, [year, fiscal]);
  const pick = (k, f, t) => { writePeriod(k, f, t); onPicked && onPicked(); };
  return (
    <div data-testid="fr-period" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: T.ink3 }}>Period</span>
      <button type="button" data-testid="fr-period-this" aria-pressed={key === "this_fy"} style={chip(key === "this_fy")} onClick={() => pick("this_fy")}>{fiscal ? "This FY" : "This year"}</button>
      <button type="button" data-testid="fr-period-last" aria-pressed={key === "last_fy"} style={chip(key === "last_fy")} onClick={() => pick("last_fy")}>{fiscal ? "Last FY" : "Last year"}</button>
      <input type="date" aria-label="From" data-testid="fr-period-from" value={from} onChange={e => setFrom(e.target.value)} style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px", fontSize: 12.5, fontFamily: "inherit" }} />
      <input type="date" aria-label="To" data-testid="fr-period-to" value={to} onChange={e => setTo(e.target.value)} style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px", fontSize: 12.5, fontFamily: "inherit" }} />
      <button type="button" data-testid="fr-period-custom" aria-pressed={key === "custom"} disabled={!isDay(from) || !isDay(to) || to < from} style={chip(key === "custom")} onClick={() => pick("custom", from, to)}>Show these days</button>
      <span style={{ fontSize: 12.5, color: T.ink3 }}>{overview && overview.periodLabel ? `Showing ${overview.periodLabel}` : ""}</span>
      {lybunt && (
        <button type="button" data-testid="fr-lybunt" title={LAPSE_WORDS.lybunt.definition} onClick={() => onNavigate && onNavigate("reports", { report: "lybunt" })}
          style={{ ...chip(false), marginLeft: "auto", display: "flex", gap: 6, alignItems: "baseline" }}>
          <abbr title={LAPSE_WORDS.lybunt.definition} style={{ textDecoration: "underline dotted", fontWeight: 700 }}>{LAPSE_WORDS.lybunt.word}</abbr>
          <span data-testid="fr-lybunt-count" style={{ fontWeight: 800 }}>{lybunt.n.toLocaleString("en-US")}</span>
          <span style={{ color: T.ink3 }}>{lybunt.n === lybunt.people ? (lybunt.n === 1 ? "donor" : "donors") : "donors and households"}, gave the year before, not yet in {overview.periodLabel}</span>
        </button>
      )}
    </div>
  );
}

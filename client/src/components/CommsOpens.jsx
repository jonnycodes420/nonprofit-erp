// FIX-40 · EVERYTHING IN COMMUNICATIONS OPENS. Communications was the one area
// where nothing did: an Audience row, an Analytics number, a bar, the people in
// Your email tool. The pieces that make each one open live here so the
// 2,700-line Communications.jsx only places them.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T, Spin, stageName } from "./shared";
import { DonorLink } from "./RecordLink";
import { Figure } from "./Figure";
import MetricBreakdownPanel from "./MetricBreakdownPanel";
import { errorMessage } from "../lib/domainError";

// "$55,000" for whole dollars, "$55,000.50" otherwise. One way to write money here.
export function dollars(n) {
  const v = Number(n) || 0;
  const whole = Math.round(v * 100) % 100 === 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

// A button that opens the rows behind a number through a figure source: the
// same drawer every <Figure> opens, for the places that write their own text
// (a bar, "1 gift, $55,000").
export function OpenRows({ source, title, value, kind = "count", children, testid, style }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid={testid} data-source-key={source.key} onClick={() => setOpen(true)}
        aria-label={`${title}. Opens the rows behind it.`} className="figure-inline"
        style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "inherit", cursor: "pointer", ...style }}>
        {children}
      </button>
      {open && <MetricBreakdownPanel open onClose={() => setOpen(false)} title={title} source={source}
        figure={{ value, kind }} />}
    </>
  );
}

// ── AUDIENCE ─────────────────────────────────────────────────────────────────
// Counted by the server with the rules a campaign sends by
// (GET /communications/audience). Each chip shows its people; every name opens
// the profile and every total opens the gifts behind it.
export function AudienceTab({ onEmailSegment }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [seg, setSeg] = useState("all");
  const [all, setAll] = useState(false);
  useEffect(() => {
    apiFetch("/communications/audience").then(setD).catch(e => setErr(errorMessage(e, "Audience did not load.")));
  }, []);
  if (err) return <div style={{ color: T.ink, padding: 20 }}>{err}</div>;
  if (!d) return <Spin />;
  const active = d.segments.find(s => s.id === seg) || d.segments[0];
  const shown = all ? active.rows : active.rows.slice(0, 50);
  const giving = active.rows.length > 0 && active.rows[0].totalGiving !== undefined;
  const cols = giving ? "1fr 200px 120px 110px" : "1fr 200px 120px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="audience-tab">
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Audience</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {d.segments.map(s => (
          <button key={s.id} type="button" aria-pressed={seg === s.id} data-testid="audience-seg" data-seg={s.id}
            onClick={() => { setSeg(s.id); setAll(false); }}
            style={{ background: T.white, border: "1px solid " + (seg === s.id ? T.ink : T.bg3), borderRadius: 8,
                     padding: "7px 14px", cursor: "pointer", color: seg === s.id ? T.ink : T.ink3, fontSize: 12.5,
                     fontWeight: seg === s.id ? 700 : 400, display: "flex", alignItems: "center", gap: 6 }}>
            {s.label}
            <span data-testid="audience-seg-count" style={{ background: T.bg3, borderRadius: 99, padding: "1px 7px", fontSize: 11, color: T.ink }}>
              {s.count.toLocaleString("en-US")}
            </span>
          </button>
        ))}
      </div>
      <div data-testid="audience-definition" style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.5, maxWidth: "70ch" }}>
        {active.definition}
        {active.id === "all" && d.donorTotal !== null && d.donorTotal !== active.count &&
          ` ${active.count.toLocaleString("en-US")} of your ${d.donorTotal.toLocaleString("en-US")} donors have one; Donors counts all of them.`}
      </div>
      {active.rows.length === 0 ? (
        <div style={{ color: T.ink3, fontSize: 13, padding: 20 }}>Nobody is in this audience today.</div>
      ) : (
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, padding: "9px 16px", fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
            <span>Name</span><span>Email</span><span>Stage</span>{giving && <span>Given in total</span>}
          </div>
          {shown.map(p => (
            <div key={p.id} data-testid="audience-row" className="audience-row"
              style={{ display: "grid", gridTemplateColumns: cols, padding: "10px 16px", borderTop: "1px solid " + T.bg3, fontSize: 13, gap: 8, alignItems: "center", minWidth: 0 }}>
              <DonorLink id={p.id} style={{ fontWeight: 600, color: T.ink }}>{p.name}</DonorLink>
              <span style={{ color: T.ink3, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.email}</span>
              <span style={{ fontSize: 11.5, color: T.ink3 }}>{p.stage ? stageName(p.stage) : "Not set"}</span>
              {giving && <span style={{ fontSize: 12.5, color: T.ink }}>
                <Figure variant="cell" kind="money" value={p.totalGiving} label={`${p.name}, given in total`}
                  source={{ key: "donor-lifetime", params: { donor: p.id } }} />
              </span>}
            </div>
          ))}
          {active.rows.length > 50 && (
            <button type="button" data-testid="audience-show-all" onClick={() => setAll(v => !v)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", fontSize: 12.5, color: T.green, fontWeight: 700,
                       background: "none", border: "none", borderTop: "1px solid " + T.bg3, cursor: "pointer" }}>
              {all ? "Show the first 50" : `Show all ${active.rows.length.toLocaleString("en-US")}`}
            </button>
          )}
        </div>
      )}
      {onEmailSegment && (
        <button type="button" onClick={onEmailSegment}
          style={{ alignSelf: "flex-start", background: T.green, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: "pointer" }}>
          Email this audience
        </button>
      )}
    </div>
  );
}

// ── SENDS PER MONTH ──────────────────────────────────────────────────────────
// One bar per month over the last twelve, labelled, each opening that month's
// sends (figure source emails-sent with the month's first and last day). Months
// are UTC, the same day the source reads off sent_at.
export function monthsBack(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    out.push({ key: d.toISOString().slice(0, 7), from: d.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10),
               label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), year: d.getUTCFullYear() });
  }
  return out;
}

export function SendsPerMonth({ campaigns }) {
  const months = monthsBack(12);
  const per = {};
  for (const c of campaigns) {
    if (!c.sent_at) continue;
    const k = new Date(c.sent_at).toISOString().slice(0, 7);
    per[k] = (per[k] || 0) + (Number(c.recipient_count) || 0);
  }
  const max = Math.max(1, ...months.map(m => per[m.key] || 0));
  return (
    <div data-testid="sends-per-month" role="group" aria-label="Sends per month, last 12 months"
      style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 6, alignItems: "end", height: 132 }}>
      {months.map(m => {
        const v = per[m.key] || 0;
        const bar = (
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: "100%" }}>
            <span style={{ fontSize: 10.5, color: T.ink2, fontWeight: v ? 700 : 400 }}>{v ? v.toLocaleString("en-US") : ""}</span>
            <span style={{ width: "70%", maxWidth: 36, height: v ? Math.max(4, Math.round(v / max * 84)) : 2, background: v ? T.green : T.bg3, borderRadius: "3px 3px 0 0" }} />
            <span style={{ fontSize: 10, color: T.ink3 }}>{m.label}</span>
          </span>
        );
        return (
          <div key={m.key} data-month={m.key} style={{ display: "flex", justifyContent: "center", minWidth: 0 }}>
            {v
              ? <OpenRows testid="sends-bar" source={{ key: "emails-sent", params: { from: m.from, to: m.to } }}
                  title={`Emails sent in ${m.label} ${m.year}`} value={v} style={{ width: "100%" }}>{bar}</OpenRows>
              : bar}
          </div>
        );
      })}
    </div>
  );
}

// "1 gift, $55,000" for Your email tool's Gifts within 30 days, opening the gifts.
export function EmailToolGifts({ campaign }) {
  if (!campaign.giftsWithin) return <span style={{ color: T.inkSoft }}>none</span>;
  const n = campaign.giftsWithin;
  const amount = (Number(campaign.giftCentsWithin) || 0) / 100;
  return (
    <OpenRows testid="emailtool-gifts" source={{ key: "email-tool-gifts", params: { campaign: campaign.id } }}
      title={`Gifts within 30 days of ${campaign.name}`} value={amount} kind="money"
      style={{ color: T.green, fontWeight: 600, textDecoration: "underline" }}>
      {`${n} ${n === 1 ? "gift" : "gifts"}, ${dollars(amount)}`}
    </OpenRows>
  );
}

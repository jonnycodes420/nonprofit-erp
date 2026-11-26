// FIX-40 · EVERYTHING IN COMMUNICATIONS OPENS. Communications was the one area
// where nothing did: an Audience row, an Analytics number, a bar, the people in
// Your email tool. The pieces that make each one open live here so the
// 2,700-line Communications.jsx only places them.
import { useState } from "react";
import { T } from "./shared";
import MetricBreakdownPanel from "./MetricBreakdownPanel";

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
// COMMS-3: moved to communications/AudienceView.jsx (who you can reach, the six cards, the list).
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

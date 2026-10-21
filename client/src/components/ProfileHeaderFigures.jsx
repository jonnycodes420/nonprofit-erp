// PROFILE-1 (header) · THE SEVEN NUMBERS, IN THE HEADER.
//
// The profile used to draw these as seven white boxes under the header (four
// figures, then First, Largest and Average in a second row). They are one row
// across the header's bottom edge now, divided by thin rules, and a two-column
// grid at 390. Nothing about a number changed: each is the same <Figure> over
// the same source, so it opens the same rows and foots the same way, and each
// keeps its "?" with the same census sentence.
//
//   Lifetime · This year · Last gift · Average gift · First / Largest ·
//   Last met · Last email
//
// Lifetime, This year, Last gift, Last met and Last email come with the donor
// (GET /donors/:id `figures`); First, Largest and Average come from
// GET /donors/:id/status `glance`, as they did in the old boxes.
import { T, fmtFull } from "./shared";
import { Figure } from "./Figure";
import { censusById } from "../../../shared/numberCensus.js";
import { displayDate, displayDateShort } from "../../../shared/displayDate";

const monthOf = d => (d ? displayDate(d).replace(/ \d{1,2},/, "") : null);

// POLISH-1 · the average says what it is the average OF, and what came off it.
function averageSub(a) {
  if (!a || !a.count) return null;
  const bits = [`of ${a.count} gift${a.count === 1 ? "" : "s"}`];
  if (a.refunds > 0) bits.push(`after ${fmtFull(a.refundCents / 100)} refunded`);
  if (a.importedCents > 0) bits.push(`not counting ${fmtFull(a.importedCents / 100)} given before Steward`);
  return bits.join(", ");
}

const LABEL = { fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 3, whiteSpace: "nowrap" };
const VALUE = { fontSize: 19, fontWeight: 800, fontFamily: "'DM Serif Display',serif", lineHeight: 1.15, color: T.ink };
const UNDER = { fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.35 };
const BLANK = { fontSize: 12.5, fontWeight: 400, color: T.ink3, lineHeight: 1.45, fontFamily: "'DM Sans',system-ui,sans-serif" };

function Def({ label, def }) {
  if (!def) return null;
  return (
    <span tabIndex={0} title={def} aria-label={def} data-testid={"dp-tile-def-" + label}
      style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: T.ink3, border: "1px solid " + T.bg3, borderRadius: 99, width: 13, height: 13,
        display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "help", verticalAlign: "middle" }}>?</span>
  );
}

// One number: its figure, or the sentence that says what will appear there.
function One({ f, kind, label, def, figureKey, suffix = "" }) {
  if (!f || f.value === null || f.value === undefined) {
    return <span data-figure={figureKey} data-figure-key={figureKey} data-blank="" style={BLANK}>{(f && (f.blankShort || f.blank)) || "Not yet."}</span>;
  }
  return <Figure value={f.value} kind={kind} suffix={suffix && Number(f.value) === 1 ? suffix.replace(/s$/, "") : suffix} label={label} definition={def || f.sentence}
    source={f.source} blank={f.blank} blankShort={f.blankShort} figureKey={figureKey} variant="inline" />;
}

function Cell({ label, def, children, under, testid, first = false, oneLine = false }) {
  return (
    <div className="dph-fig" data-testid={testid} style={{ minWidth: 0, padding: "10px 16px 2px", borderLeft: first ? "none" : "1px solid " + T.bg3 }}>
      <div style={LABEL}>{label}<Def label={label} def={def} /></div>
      <div style={VALUE}>{children}</div>
      {under && <div style={oneLine ? { ...UNDER, whiteSpace: "nowrap" } : UNDER} title={oneLine ? under : undefined}>{under}</div>}
    </div>
  );
}

const glanceFig = g => (g ? { ...g, blankShort: "No gifts yet." } : null);

export function ProfileHeaderFigures({ figures, glance }) {
  const F = figures || {};
  const g = glance || {};
  const today = new Date();
  const lg = F.lastGift && F.lastGift.under;
  const lm = F.lastMet && F.lastMet.under;
  const le = F.lastEmail && F.lastEmail.under;
  const avg = g.average;
  return (
    <div className="dph-figures" data-testid="dp-header-figures" style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))",
      borderTop: "1px solid " + T.bg3, margin: "6px -24px -12px", padding: "0 8px 10px" }}>
      <Cell first label="Lifetime" def={censusById("profile.lifetime").sentence} testid="dp-fig-lifetime">
        <One f={F.lifetime} kind="money" label="Lifetime" def={censusById("profile.lifetime").sentence} figureKey="profile.lifetime" />
      </Cell>
      <Cell label="This year" def={censusById("profile.thisYear").sentence} testid="dp-fig-thisYear">
        <One f={F.thisYear} kind="money" label="This year" def={censusById("profile.thisYear").sentence} figureKey="profile.thisYear" />
      </Cell>
      <Cell label="Last gift" def={censusById("profile.lastGift").sentence} testid="dp-fig-lastGift"
        under={lg && lg.date ? displayDate(lg.date) : null}>
        <One f={F.lastGift} kind="money" label="Last gift" def={censusById("profile.lastGift").sentence} figureKey="profile.lastGift" />
      </Cell>
      <Cell label="Average gift" testid="dp-fig-average" under={averageSub(avg)}>
        <One f={glanceFig(avg)} kind="money" label={(avg && avg.label) || "Average gift"} figureKey="profile.glance.average-gift" />
      </Cell>
      <Cell label="First / Largest" testid="dp-fig-firstLargest"
        under={g.first && g.first.value != null ? `${monthOf(g.first.date)}${g.largest && g.largest.value != null ? ` / ${monthOf(g.largest.date)}` : ""}` : null}>
        {g.first && g.first.value != null
          ? <><One f={g.first} kind="money" label={g.first.label || "First gift"} figureKey="profile.glance.first-gift" />
              <span style={{ color: T.ink3, fontWeight: 400 }}> / </span>
              <One f={g.largest} kind="money" label={(g.largest && g.largest.label) || "Largest gift"} figureKey="profile.glance.largest-gift" /></>
          : <One f={glanceFig(g.first)} kind="money" label="First gift" figureKey="profile.glance.first-gift" />}
      </Cell>
      <Cell label="Last met" def={censusById("profile.lastMet").sentence} testid="dp-fig-lastMet"
        under={lm && lm.date ? `${lm.what ? lm.what + ". " : ""}${displayDateShort(lm.date, today)}` : null} oneLine>
        <One f={F.lastMet} kind="count" suffix=" days" label="Last met" def={censusById("profile.lastMet").sentence} figureKey="profile.lastMet" />
      </Cell>
      <Cell label="Last email" def={censusById("profile.lastEmail").sentence} testid="dp-fig-lastEmail"
        under={le && le.date ? `${le.direction === "replied" ? "Replied" : le.direction === "sent" ? "Sent" : "Logged"} ${displayDateShort(le.date, today)}` : null}>
        <One f={F.lastEmail} kind="count" suffix=" days" label="Last email" def={censusById("profile.lastEmail").sentence} figureKey="profile.lastEmail" />
      </Cell>
    </div>
  );
}

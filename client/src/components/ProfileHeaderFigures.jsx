// PROFILE-1 (header) · POLISH-3 · FOUR NUMBERS IN THE HEADER, THE REST ON GIFTS.
//
// PROFILE-1 put seven figures across the header, each with a "?" on its label
// and another on its value. Jonathan's walk (26 Oct) found that too much, so
// the header keeps four:
//
//   Lifetime · This year · Last gift (with its date) · Last contact
//
// Last contact is the more recent of Last met and Last email, saying which it
// was. Average gift, First / Largest, Last met and Last email moved to the top
// of the Gifts & pledges tab (ProfileMoreNumbers below). Nothing about a
// number changed: each is the same <Figure> over the same source, so it opens
// the same rows and foots the same way. Each number has ONE "?", on its label.
//
// All of them come with the donor (GET /donors/:id `figures`). First, Largest
// and Average used to come from GET /donors/:id/status, a second read that a
// gift recorded from another door never refreshed (NUMBERS-1).
import { T, fmtFull } from "./shared";
import { Figure, FigureWhy } from "./Figure";
import { censusById } from "../../../shared/numberCensus.js";
import { displayDate, displayDateShort } from "../../../shared/displayDate";
import { countLabel } from "../../../shared/countWords.js";

// IMPORT-4: a gift with no date reads "No date", never "null".
const monthOf = d => (d ? displayDate(d).replace(/ \d{1,2},/, "") : "No date");

// POLISH-1 · the average says what it is the average OF, and what came off it.
function averageSub(a) {
  if (!a || !a.count) return null;
  const bits = [`of ${countLabel(a.count, "gift")}`];
  if (a.refunds > 0) bits.push(`after ${fmtFull(a.refundCents / 100)} refunded`);
  if (a.importedCents > 0) bits.push(`not counting ${fmtFull(a.importedCents / 100)} given before Steward`);
  return bits.join(", ");
}

const LABEL = { fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 3, whiteSpace: "nowrap" };
const VALUE = { fontSize: 19, fontWeight: 800, fontFamily: "'DM Serif Display',serif", lineHeight: 1.15, color: T.ink };
const UNDER = { fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.35 };
const BLANK = { fontSize: 12.5, fontWeight: 400, color: T.ink3, lineHeight: 1.45, fontFamily: "'DM Sans',system-ui,sans-serif" };

// The one "?" per number, on its label. A number with no census sentence
// says its source's sentence, read on the first press.
function Def({ label, def, source }) {
  if (!def && !(source && source.key)) return null;
  return <span data-testid={"dp-tile-def-" + label} style={{ marginLeft: 2 }}><FigureWhy definition={def} label={label} source={source} /></span>;
}

// One number: its figure, or the sentence that says what will appear there.
function One({ f, kind, label, def, figureKey, suffix = "" }) {
  if (!f || f.value === null || f.value === undefined) {
    return <span data-figure={figureKey} data-figure-key={figureKey} data-blank="" style={BLANK}>{(f && (f.blankShort || f.blank)) || "Not yet."}</span>;
  }
  return <Figure value={f.value} kind={kind} suffix={suffix && Number(f.value) === 1 ? suffix.replace(/s$/, "") : suffix} label={label} definition={def || f.sentence}
    source={f.source} blank={f.blank} blankShort={f.blankShort} figureKey={figureKey} variant="inline" why={false} />;
}

function Cell({ label, def, source, children, under, testid, first = false, oneLine = false }) {
  return (
    <div className="dph-fig" data-testid={testid} style={{ minWidth: 0, padding: "10px 16px 2px", borderLeft: first ? "none" : "1px solid " + T.bg3 }}>
      <div style={{ ...LABEL, display: "flex", alignItems: "center" }}>{label}<Def label={label} def={def} source={source} /></div>
      <div style={VALUE}>{children}</div>
      {under && <div style={oneLine ? { ...UNDER, whiteSpace: "nowrap" } : UNDER} title={oneLine ? under : undefined}>{under}</div>}
    </div>
  );
}

// IMPORT-4 · "1 gift with no date not counted", under a figure for a span of
// time. The count opens the undated gifts themselves.
export function UndatedNote({ u }) {
  if (!u || !u.count) return null;
  return (
    <span data-testid="dp-fig-undated">
      <Figure value={u.count} kind="count" suffix={u.count === 1 ? " gift" : " gifts"} label="Gifts with no date"
        definition="Gifts that came in with no date. They count in Lifetime, the gift count and the average, and in no figure for a span of time, because their year is not known."
        source={u.source} figureKey="profile.undated" variant="inline" /> with no date not counted
    </span>
  );
}

const glanceFig = g => (g ? { ...g, blankShort: "No gifts yet." } : null);

const src = f => (f && f.source) || null;
function pick(F, G) {
  return { first: F.first || G.first, largest: F.largest || G.largest, average: F.average || G.average };
}
const timeOf = d => (d ? new Date(String(d).length <= 10 ? d + "T12:00:00" : d).getTime() : -Infinity);

// Last contact: the more recent of the meeting and the email, saying which.
function lastContact(F, today) {
  const lm = F.lastMet && F.lastMet.value != null && F.lastMet.under && F.lastMet.under.date ? F.lastMet : null;
  const le = F.lastEmail && F.lastEmail.value != null && F.lastEmail.under && F.lastEmail.under.date ? F.lastEmail : null;
  if (!lm && !le) return { f: F.lastMet || F.lastEmail || null, key: "profile.lastMet", def: censusById("profile.lastMet").sentence, under: null };
  const met = lm && (!le || timeOf(lm.under.date) >= timeOf(le.under.date));
  if (met) {
    const u = lm.under;
    return { f: lm, key: "profile.lastMet", def: censusById("profile.lastMet").sentence,
      under: `Met${u.what ? `: ${u.what.replace(/\.$/, "")}` : ""}. ${displayDateShort(u.date, today)}` };
  }
  const u = le.under;
  return { f: le, key: "profile.lastEmail", def: censusById("profile.lastEmail").sentence,
    under: `Email ${u.direction === "replied" ? "replied" : u.direction === "sent" ? "sent" : "logged"} ${displayDateShort(u.date, today)}` };
}

export function ProfileHeaderFigures({ figures }) {
  const F = figures || {};
  const today = new Date();
  const lg = F.lastGift && F.lastGift.under;
  const lc = lastContact(F, today);
  return (
    <div className="dph-figures" data-testid="dp-header-figures" style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))",
      borderTop: "1px solid " + T.bg3, margin: "6px -24px -12px", padding: "0 8px 10px" }}>
      <Cell first label="Lifetime" def={censusById("profile.lifetime").sentence} testid="dp-fig-lifetime"
        under={(F.imported || (F.softCredit && F.softCredit.value)) ? <>
          {F.imported && <span data-testid="dp-fig-lifetime-imported" title={`From ${F.imported.source}${F.imported.on ? `, imported ${displayDate(F.imported.on)}` : ""}. Gifts in Steward dated after it are added to it; gifts dated before are already inside it.`}>{F.imported.words}</span>}
          {/* FIX-49: soft credit is its own figure, never inside Lifetime. */}
          {F.softCredit && F.softCredit.value ? <span data-testid="dp-fig-softCredit" style={{ display: "block" }}>Soft credit{" "}
            <One f={F.softCredit} kind="money" label="Soft credit" def={censusById("profile.softCredit").sentence} figureKey="profile.softCredit" /></span> : null}
        </> : null}>
        <One f={F.lifetime} kind="money" label="Lifetime" def={censusById("profile.lifetime").sentence} figureKey="profile.lifetime" />
      </Cell>
      <Cell label="This year" def={censusById("profile.thisYear").sentence} testid="dp-fig-thisYear"
        under={F.undated && F.undated.count ? <UndatedNote u={F.undated} /> : null}>
        <One f={F.thisYear} kind="money" label="This year" def={censusById("profile.thisYear").sentence} figureKey="profile.thisYear" />
      </Cell>
      <Cell label="Last gift" def={censusById("profile.lastGift").sentence} testid="dp-fig-lastGift"
        under={lg && lg.date ? displayDate(lg.date) : null}>
        <One f={F.lastGift} kind="money" label="Last gift" def={censusById("profile.lastGift").sentence} figureKey="profile.lastGift" />
      </Cell>
      <Cell label="Last contact" def={lc.def} testid="dp-fig-lastContact" under={lc.under} oneLine>
        <One f={lc.f} kind="count" suffix=" days" label="Last contact" def={lc.def} figureKey={lc.key} />
      </Cell>
    </div>
  );
}

// The numbers that left the header, at the top of Gifts & pledges. Same
// figures, same sources, same sentences.
export function ProfileMoreNumbers({ figures, glance }) {
  const F = figures || {};
  const g = pick(F, glance || {});
  const today = new Date();
  const lm = F.lastMet && F.lastMet.under;
  const le = F.lastEmail && F.lastEmail.under;
  const avg = g.average;
  return (
    <div className="dph-figures dp-more-numbers" data-testid="dp-more-numbers" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))",
      background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "4px 0 10px", marginBottom: 14 }}>
      <Cell first label="Average gift" source={src(avg)} testid="dp-fig-average" under={averageSub(avg)}>
        <One f={glanceFig(avg)} kind="money" label={(avg && avg.label) || "Average gift"} figureKey="profile.glance.average-gift" />
      </Cell>
      <Cell label="First / Largest" source={src(g.first)} testid="dp-fig-firstLargest"
        under={g.first && g.first.value != null ? `${monthOf(g.first.date)}${g.largest && g.largest.value != null ? ` / ${monthOf(g.largest.date)}` : ""}`
          : g.largest && g.largest.value != null ? `No date / ${monthOf(g.largest.date)}` : null}>
        {g.first && g.first.value != null
          ? <><One f={g.first} kind="money" label={g.first.label || "First gift"} figureKey="profile.glance.first-gift" />
              <span style={{ color: T.ink3, fontWeight: 400 }}> / </span>
              <One f={g.largest} kind="money" label={(g.largest && g.largest.label) || "Largest gift"} figureKey="profile.glance.largest-gift" /></>
          : g.largest && g.largest.value != null
            // IMPORT-4: every gift on file has no date, so the first is not known; Largest still is.
            ? <><span data-testid="dp-fig-first-unknown" style={BLANK}>Unknown</span>
                <span style={{ color: T.ink3, fontWeight: 400 }}> / </span>
                <One f={g.largest} kind="money" label={g.largest.label || "Largest gift"} figureKey="profile.glance.largest-gift" /></>
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

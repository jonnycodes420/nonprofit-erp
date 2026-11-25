// components/profile/ProfileNumbers.jsx (PROFILE-3, PROFILE-4) · THE NUMBERS STRIP.
//
// PROFILE-4: one strip under the name, four cells with thin dividers:
// Lifetime, This fiscal year, Last gift (its date beside it, smaller), Last
// contact. Each cell is a small label over the value at 18px; the quiet line
// that used to sit under a value sits beside it now, on one line, and the
// strip never wraps on a desktop (a long note ends in "…", whole on hover)
// (Jonathan, 24 Nov: "cut that white window in half"). On a phone it wraps two
// by two (shared.jsx). The definition opens on hover, focus or tap of the
// label. An empty value is an em dash in ink at 40%, never a sentence.
//
// The figures are the same <Figure>s over the same sources as
// ProfileHeaderFigures (PROFILE-1, POLISH-3), so each value still opens the
// rows behind it and foots the same way.
import { useState } from "react";
import { T } from "../shared";
import { Figure } from "../Figure";
import { censusById } from "../../../../shared/numberCensus.js";
import { displayDate, displayDateShort } from "../../../../shared/displayDate";
import { UndatedNote, fiscalYearWords, lastContactOf } from "../ProfileHeaderFigures";

const INK60 = "rgba(15,26,18,0.6)";
const INK40 = "rgba(15,26,18,0.4)";
const has = f => !!(f && f.value !== null && f.value !== undefined);

// The label is the definition's door: hover, focus or tap.
function LabelDef({ label, def }) {
  const [on, setOn] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" data-testid={"dp-tile-label-" + label} aria-expanded={on} aria-label={`${label}: how it is counted`}
        onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}
        onClick={e => { e.stopPropagation(); setOn(v => !v); }}
        style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: INK60, fontSize: 11.5, fontWeight: 600,
          letterSpacing: "0.01em", cursor: "help", whiteSpace: "nowrap", textAlign: "left" }}>{label}</button>
      {on && def && <span role="tooltip" data-testid="dp-tile-def"
        style={{ position: "absolute", zIndex: 60, top: 22, left: 0, width: 260, maxWidth: "70vw", background: T.ink, color: T.white, fontSize: 12,
          fontWeight: 400, lineHeight: 1.45, padding: "8px 10px", borderRadius: 8, whiteSpace: "normal", boxShadow: "0 6px 18px rgba(15,26,18,0.25)" }}>{def}</span>}
    </span>
  );
}

// The quiet note beside a value (a date, the old system's share, the fiscal
// year's dates) is one line; when the strip is short of room it ends in "…"
// and the whole note is its hover title. Only a cell with a note gives way,
// and Lifetime's (the long "from your old system" one) first: PROFILE-4b kept
// Last gift's date beside it.
const fullTitle = el => { if (el && el.innerText && el.scrollWidth > el.clientWidth) el.title = el.innerText.replace(/\s+/g, " "); else if (el) el.removeAttribute("title"); };

function Tile({ label, def, testid, f, kind, figureKey, suffix = "", under = null, giveWay = 1 }) {
  const filled = has(f);
  const noted = filled && !!under;
  return (
    <div className="dp3-tile dp4-cell" data-testid={testid} style={{ minWidth: 0, flex: noted ? `0 ${giveWay} auto` : "none", display: "flex", flexDirection: "column", gap: 1, padding: "6px 16px 8px 0", marginRight: 16, borderRight: "1px solid " + T.bg3 }}>
      <LabelDef label={label} def={def} />
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "nowrap", columnGap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: T.ink, whiteSpace: "nowrap", flex: "none" }}>
          {filled
            ? <Figure value={f.value} kind={kind} suffix={suffix && Number(f.value) === 1 ? suffix.replace("days", "day") : suffix} label={label} definition={def || f.sentence}
                source={f.source} blank={f.blank} blankShort={f.blankShort} figureKey={figureKey} variant="inline" why={false} />
            : <span data-figure={figureKey} data-figure-key={figureKey} data-blank="" aria-label={`${label}: none yet`} style={{ color: INK40 }}>—</span>}
        </span>
        {noted ? <span className="dp3-tile-under" ref={fullTitle} onMouseEnter={e => fullTitle(e.currentTarget)}
          style={{ fontSize: 11.5, color: INK60, lineHeight: 1.4, minWidth: 0, flex: "0 1 auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{under}</span> : null}
      </div>
    </div>
  );
}

export function ProfileNumbers({ figures }) {
  const F = figures || {};
  const today = new Date();
  const lg = F.lastGift && F.lastGift.under;
  const lc = lastContactOf(F, today, " · ");
  const fy = fiscalYearWords(F.thisYear && F.thisYear.source && F.thisYear.source.params && F.thisYear.source.params.from);
  const lifeUnder = (F.imported || has(F.softCredit)) ? <>
    {F.imported && <span data-testid="dp-fig-lifetime-imported" title={`From ${F.imported.source}${F.imported.on ? `, imported ${displayDate(F.imported.on)}` : ""}. Gifts in Steward dated after it are added to it; gifts dated before are already inside it.`}>{F.imported.words}</span>}
    {/* FIX-49: soft credit is its own figure, never inside Lifetime. */}
    {has(F.softCredit) && <span data-testid="dp-fig-softCredit">{F.imported ? " · " : ""}Soft credit{" "}
      <Figure value={F.softCredit.value} kind="money" label="Soft credit" definition={censusById("profile.softCredit").sentence} source={F.softCredit.source} figureKey="profile.softCredit" variant="inline" why={false} /></span>}
  </> : null;
  const fyUnder = (fy || (F.undated && F.undated.count)) ? <>
    {fy && <span data-testid="dp-fig-fiscal-dates">{fy}</span>}
    {F.undated && F.undated.count ? <>{fy ? " · " : ""}<UndatedNote u={F.undated} /></> : null}
  </> : null;
  return (
    <div className="dp4-strip" data-testid="dp-header-figures"
      style={{ display: "flex", flexWrap: "nowrap", alignItems: "stretch", margin: "10px 0 0 var(--dp-indent,58px)", borderTop: "1px solid " + T.bg3 }}>
      <Tile label="Lifetime" def={censusById("profile.lifetime").sentence} testid="dp-fig-lifetime" f={F.lifetime} kind="money" figureKey="profile.lifetime" under={lifeUnder} giveWay={10000} />
      <Tile label="This fiscal year" def={censusById("profile.thisYear").sentence} testid="dp-fig-thisYear" f={F.thisYear} kind="money" figureKey="profile.thisYear" under={fyUnder} />
      <Tile label="Last gift" def={censusById("profile.lastGift").sentence} testid="dp-fig-lastGift" f={F.lastGift} kind="money" figureKey="profile.lastGift"
        under={lg && lg.date ? `${displayDate(lg.date)}${lg.method && !/^(unknown|needs you)$/i.test(lg.method) ? ` · ${lg.method}` : ""}` : null} />
      <Tile label="Last contact" def={lc.def} testid="dp-fig-lastContact" f={lc.f} kind="count" suffix=" days ago" figureKey={lc.key} under={lc.under} />
    </div>
  );
}

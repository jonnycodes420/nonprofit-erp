// components/profile/ProfileNumbers.jsx (PROFILE-3) · THE NUMBERS BAND.
//
// Four calm tiles in one row: Lifetime, This fiscal year, Last gift, Last
// contact. Each is a small label, the value in the display serif and at most
// one quiet line under it. The definition opens on hover, focus or tap of the
// label (no "?" on a tile). An empty value is an em dash in ink at 40% with
// nothing under it, never a sentence: "No giving yet." under a dash said the
// same nothing twice, four times across the band.
//
// The figures are the same <Figure>s over the same sources as
// ProfileHeaderFigures (PROFILE-1, POLISH-3), so each value still opens the
// rows behind it and foots the same way.
import { useState } from "react";
import { T } from "../shared";
import { Figure } from "../Figure";
import { censusById } from "../../../../shared/numberCensus.js";
import { displayDate, displayDateShort } from "../../../../shared/displayDate";
import { UndatedNote, fiscalYearWords } from "../ProfileHeaderFigures";

const INK60 = "rgba(15,26,18,0.6)";
const INK40 = "rgba(15,26,18,0.4)";
const timeOf = d => (d ? new Date(String(d).length <= 10 ? d + "T12:00:00" : d).getTime() : -Infinity);
const has = f => !!(f && f.value !== null && f.value !== undefined);

// The label is the definition's door: hover, focus or tap.
function LabelDef({ label, def }) {
  const [on, setOn] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" data-testid={"dp-tile-label-" + label} aria-expanded={on} aria-label={`${label}: how it is counted`}
        onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}
        onClick={e => { e.stopPropagation(); setOn(v => !v); }}
        style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: INK60, fontSize: 12, fontWeight: 600,
          letterSpacing: "0.01em", cursor: "help", whiteSpace: "nowrap", textAlign: "left" }}>{label}</button>
      {on && def && <span role="tooltip" data-testid="dp-tile-def"
        style={{ position: "absolute", zIndex: 60, top: 22, left: 0, width: 260, maxWidth: "70vw", background: T.ink, color: T.white, fontSize: 12,
          fontWeight: 400, lineHeight: 1.45, padding: "8px 10px", borderRadius: 8, whiteSpace: "normal", boxShadow: "0 6px 18px rgba(15,26,18,0.25)" }}>{def}</span>}
    </span>
  );
}

function Tile({ label, def, testid, f, kind, figureKey, suffix = "", under = null }) {
  const filled = has(f);
  return (
    <div className="dp3-tile" data-testid={testid} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <LabelDef label={label} def={def} />
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 26, fontWeight: 400, lineHeight: 1.15, color: T.ink }}>
        {filled
          ? <Figure value={f.value} kind={kind} suffix={suffix && Number(f.value) === 1 ? suffix.replace("days", "day") : suffix} label={label} definition={def || f.sentence}
              source={f.source} blank={f.blank} blankShort={f.blankShort} figureKey={figureKey} variant="inline" why={false} />
          : <span data-figure={figureKey} data-figure-key={figureKey} data-blank="" aria-label={`${label}: none yet`} style={{ color: INK40 }}>—</span>}
      </div>
      {filled && under ? <div className="dp3-tile-under" style={{ fontSize: 12, color: INK60, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{under}</div> : null}
    </div>
  );
}

// Last contact: the more recent of the meeting and the email, saying which.
function lastContact(F, today) {
  const lm = has(F.lastMet) && F.lastMet.under && F.lastMet.under.date ? F.lastMet : null;
  const le = has(F.lastEmail) && F.lastEmail.under && F.lastEmail.under.date ? F.lastEmail : null;
  if (!lm && !le) return { f: null, key: "profile.lastMet", def: censusById("profile.lastMet").sentence, under: null };
  if (lm && (!le || timeOf(lm.under.date) >= timeOf(le.under.date))) {
    const u = lm.under;
    return { f: lm, key: "profile.lastMet", def: censusById("profile.lastMet").sentence,
      under: `Met${u.what ? `: ${u.what.replace(/\.$/, "")}` : ""} · ${displayDateShort(u.date, today)}` };
  }
  const u = le.under;
  return { f: le, key: "profile.lastEmail", def: censusById("profile.lastEmail").sentence,
    under: `Email ${u.direction === "from_them" ? "from them" : u.direction === "sent" ? "sent" : "logged"} · ${displayDateShort(u.date, today)}` };
}

export function ProfileNumbers({ figures }) {
  const F = figures || {};
  const today = new Date();
  const lg = F.lastGift && F.lastGift.under;
  const lc = lastContact(F, today);
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
    <div className="dph-figures dp3-numbers" data-testid="dp-header-figures"
      style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", columnGap: 24, rowGap: 16, padding: "24px 0 16px" }}>
      <Tile label="Lifetime" def={censusById("profile.lifetime").sentence} testid="dp-fig-lifetime" f={F.lifetime} kind="money" figureKey="profile.lifetime" under={lifeUnder} />
      <Tile label="This fiscal year" def={censusById("profile.thisYear").sentence} testid="dp-fig-thisYear" f={F.thisYear} kind="money" figureKey="profile.thisYear" under={fyUnder} />
      <Tile label="Last gift" def={censusById("profile.lastGift").sentence} testid="dp-fig-lastGift" f={F.lastGift} kind="money" figureKey="profile.lastGift"
        under={lg && lg.date ? `${displayDate(lg.date)}${lg.method && !/^(unknown|needs you)$/i.test(lg.method) ? ` · ${lg.method}` : ""}` : null} />
      <Tile label="Last contact" def={lc.def} testid="dp-fig-lastContact" f={lc.f} kind="count" suffix=" days ago" figureKey={lc.key} under={lc.under} />
    </div>
  );
}

// PARITY-1 Part 1 · the top of the donor profile.
//
// StatusTags     the giving level, lifecycle and Retained tags under the name.
//                Each opens the list of donors with that tag.
// ClosenessLine  "Warm: gave twice this year, came to the gala, ..." The word is
//                ENGAGE-1's band in words; each fact opens its rows.
// ProfileGlance  First gift, Largest gift and Average gift beside the four
//                tiles above it, then the highlights and the next action.
//
// Everything comes from GET /donors/:id/status (routes/profileStatus.js), and
// every number and tag carries the source its rows come from.
import { useContext, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure, FigureContext } from "./Figure";
import MetricBreakdownPanel from "./MetricBreakdownPanel";
import { displayDate } from "../../../shared/displayDate";
import { birthdayLabel } from "../../../shared/birthday.js";

// FIX-27 Part 5: `stepKey` moves whenever a next step is saved, so the
// summary's Next line is read again with the rail and The Ask, no reload.
export function useDonorStatus(donorId, refreshKey, stepKey) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    if (!donorId) return undefined;
    apiFetch(`/donors/${donorId}/status`).then(s => { if (live) setStatus(s || null); }).catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [donorId, refreshKey, stepKey]);
  return status;
}

// A word that opens rows: the tag pills and the facts in the closeness line.
function Opens({ source, title, explanation, children, style, testid, onSelectDonor: given }) {
  const [open, setOpen] = useState(false);
  const { openPerson } = useContext(FigureContext);
  const onSelectDonor = given || openPerson;
  return (
    <>
      <button type="button" data-testid={testid} data-source-key={source && source.key} onClick={() => setOpen(true)}
        title={explanation} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", ...style }}>
        {children}
      </button>
      {open && <MetricBreakdownPanel open onClose={() => setOpen(false)} title={title} explanation={explanation} source={source}
        onSelectDonor={onSelectDonor ? row => { setOpen(false); onSelectDonor(row.donorId); } : undefined} />}
    </>
  );
}

const TAG_TONE = {
  level: { background: T.green100, color: T.greenDk, border: `1px solid ${T.green200}` },
  lifecycle: { background: T.white, color: T.ink, border: `1px solid ${T.bg3}` },
  retained: { background: T.white, color: T.greenDk, border: `1px solid ${T.green200}` },
};

export function StatusTags({ status, onOpenDonor }) {
  if (!status || !status.tags || !status.tags.length) return null;
  return (
    <div data-testid="dp-status-tags" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
      {status.tags.map(t => (
        <Opens key={t.key} source={t.source} title={`Donors tagged ${t.label}`} explanation={t.sentence} testid={`dp-tag-${t.key}`} onSelectDonor={onOpenDonor}
          style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
            ...(t.key === "lapsed" ? { background: T.gold100, color: T.gold700, border: `1px solid ${T.gold300}` } : TAG_TONE[t.kind]) }}>
          {t.label}
        </Opens>
      ))}
    </div>
  );
}

export function ClosenessLine({ status, onOpenDonor }) {
  const c = status && status.closeness;
  if (!c) return null;
  return (
    <div data-testid="dp-closeness" style={{ fontSize: 12.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>
      <span title={c.sentence} style={{ fontWeight: 700, color: c.key === "cooling" ? T.gold700 : T.ink }}>{c.label}</span>
      {c.facts.length ? ": " : ""}
      {c.facts.map((f, i) => (
        <span key={i}>
          {i ? ", " : ""}
          <Opens source={f.source} title={f.text.charAt(0).toUpperCase() + f.text.slice(1)} explanation={c.sentence} testid={`dp-closeness-fact-${i}`} onSelectDonor={onOpenDonor}
            style={{ textDecoration: "underline dotted", textUnderlineOffset: 3, color: T.ink2 }}>{f.text}</Opens>
        </span>
      ))}
      {c.facts.length ? "." : ""}
    </div>
  );
}

function Tile({ label, figure, kind = "money", sub }) {
  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Serif Display',serif", lineHeight: 1.1, color: T.ink }}>
        {figure.value === null || figure.value === undefined
          ? <span data-blank="" style={{ fontSize: 12.5, fontWeight: 400, color: T.ink3, fontFamily: "'DM Sans',system-ui,sans-serif" }}>No gifts yet</span>
          : <Figure value={figure.value} kind={kind} label={figure.label || label} definition={figure.sentence} source={figure.source}
              figureKey={"profile.glance." + label.toLowerCase().replace(/\s+/g, "-")} variant="inline" />}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const monthOf = d => (d ? displayDate(d).replace(/ \d{1,2},/, "") : null);

export function ProfileGlance({ status, onOpenDonor, birthday }) {
  const [why, setWhy] = useState(false);
  if (!status) return null;
  // FIX-22: the birthday was stored and shown nowhere a person looks first.
  const bday = birthday ? birthdayLabel(birthday.month, birthday.day, birthday.year) : "";
  const g = status.glance || {};
  return (
    <div data-testid="dp-glance" style={{ padding: "8px 20px 4px 24px", flexShrink: 0 }}>
      {g.first && (
        <div className="donor-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          <Tile label="First gift" figure={g.first} sub={g.first.value != null ? monthOf(g.first.date) : null} />
          <Tile label="Largest gift" figure={g.largest} sub={g.largest && g.largest.value != null ? monthOf(g.largest.date) : null} />
          <Tile label="Average gift" figure={g.average} sub={g.average && g.average.count ? `of ${g.average.count} gift${g.average.count === 1 ? "" : "s"}` : null} />
        </div>
      )}
      {bday && (
        <div data-testid="dp-glance-birthday" style={{ marginTop: 8, fontSize: 13, color: T.ink2 }}>
          Birthday: {bday}
        </div>
      )}
      {/* PARITY-3 — the volunteer line, opening the shifts it adds up. */}
      {status.volunteer && (
        <div data-testid="dp-glance-volunteer" style={{ marginTop: 8, fontSize: 13, color: T.ink2 }}>
          <Opens source={status.volunteer.source} title={status.volunteer.sentence} explanation={status.volunteer.sentence} testid="dp-glance-volunteer-open" onSelectDonor={onOpenDonor}
            style={{ textAlign: "left", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{status.volunteer.line}</Opens>
        </div>
      )}
      {status.highlights && status.highlights.length > 0 && (
        <div data-testid="dp-highlights" style={{ marginTop: 10, background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 6 }}>Highlights</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
            {status.highlights.map(h => (
              <li key={h.key} style={{ fontSize: 13, color: T.ink2, lineHeight: 1.45 }}>
                <Opens source={h.source} title={h.text} explanation="The gifts this fact is drawn from." testid={`dp-highlight-${h.key}`} onSelectDonor={onOpenDonor}
                  style={{ textAlign: "left", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{h.text}</Opens>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status.next && (
        <div data-testid="dp-next-line" style={{ marginTop: 10, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>{status.next.text}</span>{" "}
          <button type="button" data-testid="dp-next-why" onClick={() => setWhy(w => !w)} aria-expanded={why}
            style={{ background: "transparent", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
            Why?
          </button>
          {why && (
            <div data-testid="dp-next-why-text" style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>
              {status.next.why}{status.next.ask ? ` ${status.next.ask.sentence}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// communications/AudienceView.jsx · COMMS-3 items 3, 4 and 5. COMMUNICATIONS → AUDIENCE.
//
// Built to Jonathan's approved mockup (_briefs/COMMS-3-mockup.html), top to bottom:
//   · Who you can reach: every donor split into has an email, mail only, no way to reach,
//     each count opening its people; beside it the biggest gap, what the mail-only donors gave,
//     with Send them a printed letter (Printed letters, that group chosen).
//   · Six cards, one per audience: its count, what it gave, its one-line definition, and at 0
//     why, in brass, from the data, with the step that fixes it.
//   · A list she can work: search, sort, a status pill, last gift, Lifetime that opens its gifts;
//     tick people for "N selected · $X given between them", Email these N, Add to a group.
// Every number comes from GET /communications/audience (server/outreach/audienceView.js) and
// opens through its figure source (server/outreach/audienceSources.js).
import { useMemo, useState } from "react";
import { apiFetch } from "../../api";
import { T, Spin } from "../shared";
import { Figure } from "../Figure";
import { DonorLink } from "../RecordLink";
import { AddToGroup } from "../Groups";
import { lettersFor } from "../letters/PrintedLetters";
import { errorMessage } from "../../lib/domainError";
import { useLiveRead } from "../../lib/liveRead";

const SERIF = "'DM Serif Display',Georgia,serif";
const BRASS_SOFT = "rgba(201,168,76,.18)", EM_SOFT = "rgba(13,92,58,.08)";
const PART = { email: { word: "have an email", color: T.green }, mail: { word: "mail only", color: T.gold }, none: { word: "no way to reach", color: T.bg3 } };
const PILL = { lap: { background: BRASS_SOFT, color: T.gold700 }, cur: { background: EM_SOFT, color: T.green }, new: { background: T.bg, color: T.ink }, none: { background: T.bg, color: T.ink3 } };
const btn = { border: "1px solid " + T.bg3, background: T.white, borderRadius: 9, padding: "8px 14px", fontWeight: 600, fontSize: 13, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const pri = { ...btn, background: T.green, borderColor: T.green, color: T.white };
const k = { fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 };
const panel = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "18px 20px", minWidth: 0 };
const n = v => Number(v || 0).toLocaleString("en-US");
const monthYear = d => (d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const money = v => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const th = { fontSize: 11.5, letterSpacing: ".05em", textTransform: "uppercase", color: T.ink3, textAlign: "left", padding: "11px 14px", borderBottom: "1px solid " + T.bg2, fontWeight: 700 };
const td = { padding: "11px 14px", borderBottom: "1px solid " + T.bg2, verticalAlign: "middle", fontSize: 13.5 };
const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); };

export function AudienceTab({ onEmailSegment, onNavigate, onOpenLetters }) {
  const read = useLiveRead("comms.audience", ["person", "gift", "totals"], () => apiFetch("/communications/audience"));
  const d = read.data;
  const [seg, setSeg] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("given");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const active = d ? (d.segments.find(s => s.id === seg) || d.segments[0]) : null;
  const giving = !!(active && active.given !== undefined);
  const list = useMemo(() => {
    if (!active) return [];
    const needle = q.trim().toLowerCase();
    const rows = needle ? active.rows.filter(r => (r.name || "").toLowerCase().includes(needle) || (r.email || "").toLowerCase().includes(needle)) : active.rows.slice();
    if (sort === "last") rows.sort((a, b) => String((b.lastGift || {}).date || "").localeCompare(String((a.lastGift || {}).date || "")));
    return rows;   // the server's order is given in total, largest first
  }, [active, q, sort]);
  if (read.error && !d) return <div style={{ color: T.ink, padding: 20 }}>{errorMessage(read.error, "Audience did not load.")}</div>;
  if (!d) return <Spin />;
  const shown = all ? list : list.slice(0, 50);
  const pickedRows = active.rows.filter(r => picked.has(r.id));
  const pickedGiven = pickedRows.reduce((s, r) => s + Math.round((r.totalGiving || 0) * 100), 0) / 100;
  const choose = id => { setSeg(id); setAll(false); setPicked(new Set()); setQ(""); };
  const flip = (id, on) => setPicked(s => { const x = new Set(s); if (on) x.add(id); else x.delete(id); return x; });
  const reach = d.reach, parts = Object.fromEntries(reach.parts.map(p => [p.id, p]));
  const go = action => {
    if (!action || !onNavigate) return;
    if (action.to === "stage-top") onNavigate("majorgifts", { subtab: "pipeline", scope: "all", stageTop: 1 });
    else if (action.to === "pipeline") onNavigate("majorgifts", { subtab: "pipeline", scope: "all" });
    else if (action.to === "giving-levels") onNavigate("settings", { section: "giving-levels" });
  };
  const printForMailOnly = () => { lettersFor({ group: "mail_only", from: yearAgo() }); if (onOpenLetters) onOpenLetters(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="audience-tab">
      <style>{`
        .aud-reach{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px}
        .aud-segs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
        .aud-seg:focus-visible{outline:2px solid ${T.green};outline-offset:2px}
        @media (max-width:820px){.aud-reach{grid-template-columns:1fr}.aud-segs{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:480px){.aud-segs{grid-template-columns:1fr}.aud-h1{font-size:26px !important}}
      `}</style>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <h2 className="aud-h1" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, margin: 0, lineHeight: 1.1, color: T.ink }}>Who you can reach</h2>
        {onEmailSegment && (
          <button type="button" data-testid="audience-start" style={{ ...pri, marginLeft: "auto", opacity: active.count ? 1 : 0.5, cursor: active.count ? "pointer" : "not-allowed" }}
            disabled={!active.count} onClick={() => onEmailSegment(active.campaignSeg, active.label)}>Start a campaign to {active.label}</button>
        )}
      </div>
      <p style={{ color: T.ink3, margin: 0, maxWidth: "70ch", fontSize: 14 }} data-testid="audience-lead">
        Every donor, split by how you can reach them, then the groups you plan an appeal around. <b style={{ color: T.ink }}>{n(parts.email.count)} of your {n(reach.total)} donors</b> have an email address.
      </p>

      <div className="aud-reach">
        <div style={panel} data-testid="audience-reach">
          <div style={k}>Your {n(reach.total)} donors</div>
          <div role="img" aria-label={reach.parts.map(p => `${n(p.count)} ${PART[p.id].word}`).join(", ")}
            style={{ height: 12, borderRadius: 99, background: T.bg, overflow: "hidden", display: "flex", margin: "12px 0 8px" }}>
            {reach.total > 0 && reach.parts.map(p => <i key={p.id} style={{ display: "block", height: "100%", width: `${(p.count / reach.total) * 100}%`, background: PART[p.id].color }} />)}
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: T.ink }}>
            {reach.parts.map(p => (
              <span key={p.id} data-testid="audience-reach-part" data-part={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 9, height: 9, borderRadius: "50%", display: "inline-block", background: PART[p.id].color }} />
                <Figure variant="cell" kind="count" value={p.count} label={`Donors who ${p.id === "email" ? "have an email" : p.id === "mail" ? "can be reached by mail only" : "have no way to reach"}`} definition={p.sentence}
                  source={{ key: "reach-part", params: { part: p.id } }} />{PART[p.id].word}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{reach.sentence} The three add to all of them.</div>
        </div>
        <div style={panel} data-testid="audience-gap">
          <div style={k}>Biggest gap</div>
          {reach.gap ? (
            <>
              <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1, marginTop: 8, color: T.ink }}>
                <Figure variant="cell" kind="money" whole value={reach.gap.given} label="Given by the mail-only donors" definition={`${parts.mail.sentence} ${reach.givenSentence}`}
                  source={{ key: "reach-part", params: { part: "mail", measure: "sum" } }} />
              </div>
              <p style={{ margin: "6px 0 10px", color: T.ink3, fontSize: 13.5 }}>{reach.gap.sentence}</p>
              <button type="button" style={btn} data-testid="audience-print" onClick={printForMailOnly}>Send them a printed letter</button>
            </>
          ) : <p style={{ margin: "8px 0 0", color: T.ink3, fontSize: 13.5 }}>Every donor you can't email has no postal address either, or every donor has an email. Nobody is reachable only on paper.</p>}
        </div>
      </div>

      <div className="aud-segs" role="tablist" aria-label="Audience">
        {d.segments.map(s => {
          const on = s.id === active.id;
          return (
            <div key={s.id} role="tab" tabIndex={0} aria-selected={on} data-testid="audience-seg" data-seg={s.id} className="aud-seg"
              onClick={() => choose(s.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); choose(s.id); } }}
              style={{ background: T.white, border: "1px solid " + (on ? T.green : T.bg2), boxShadow: on ? "inset 0 0 0 1px " + T.green : "none", borderRadius: 12, padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
                <b data-testid="audience-seg-count" style={{ fontSize: 22, fontVariantNumeric: "tabular-nums", color: s.count ? T.ink : T.ink3 }}>
                  <Figure variant="cell" kind="count" value={s.count} label={`${s.label}, people`} definition={s.definition} source={{ key: "audience-segment", params: { seg: s.id } }} />
                </b>
                {s.given !== undefined && s.count > 0 && <em style={{ fontStyle: "normal", color: T.ink3, fontSize: 13 }}>
                  <Figure variant="cell" kind="money" whole value={s.given} label={`${s.label}, given`} definition={`${s.definition} Given is each person's Lifetime giving, added up.`}
                    source={{ key: "audience-segment", params: { seg: s.id, measure: "sum" } }} /> given</em>}
              </span>
              <span style={{ fontWeight: 600, color: T.ink, fontSize: 14 }}>{s.label}</span>
              <span style={{ fontSize: 12.5, color: T.ink3 }}>{s.short}</span>
              {s.zeroWhy && (
                <span data-testid="audience-zero-why" data-no-stages={s.zeroWhy.noStages ? "1" : undefined}
                  style={{ fontSize: 12.5, color: T.gold700, background: BRASS_SOFT, borderRadius: 7, padding: "4px 8px", marginTop: 4 }}>
                  {s.zeroWhy.text}{s.zeroWhy.action && onNavigate && <>{" "}<button type="button" data-testid="audience-zero-action" onClick={e => { e.stopPropagation(); go(s.zeroWhy.action); }}
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>{s.zeroWhy.action.label}</button></>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div data-testid="audience-definition" style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.5, maxWidth: "80ch" }}>{active.definition}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} data-testid="audience-search" aria-label="Search the audience"
          placeholder={`Search ${n(active.count)} ${active.count === 1 ? "person" : "people"} by name or email`}
          style={{ flex: "1 1 240px", border: "1px solid " + T.bg3, borderRadius: 9, padding: "9px 12px", background: T.white, font: "inherit", fontSize: 14, color: T.ink, minWidth: 0 }} />
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort" data-testid="audience-sort"
          style={{ border: "1px solid " + T.bg3, borderRadius: 99, padding: "6px 11px", background: T.white, fontSize: 12.5, fontWeight: 600, color: T.ink, fontFamily: "inherit" }}>
          {giving && <option value="given">Sort: Given in total</option>}
          <option value="last">Sort: Last gift</option>
        </select>
      </div>

      {pickedRows.length > 0 && (
        <div data-testid="audience-selected" style={{ background: T.ink, color: T.white, borderRadius: 12, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <b>{n(pickedRows.length)} selected</b>
          {giving && <span style={{ opacity: 0.8 }}>{money(pickedGiven)} given between them</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: T.ink }}><AddToGroup donorIds={pickedRows.map(r => r.id)} /></span>
            {onEmailSegment && <button type="button" style={{ ...pri, borderColor: T.green }} data-testid="audience-email-these"
              onClick={() => onEmailSegment({ mode: "manual", donorIds: pickedRows.map(r => r.id) }, `${pickedRows.length} people`)}>Email these {n(pickedRows.length)}</button>}
            <button type="button" style={{ ...btn, background: "transparent", color: T.white, borderColor: "rgba(255,255,255,.35)" }} onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      )}

      {active.rows.length === 0 ? (
        <div style={{ color: T.ink3, fontSize: 13, padding: 20 }}>Nobody is in this audience today.{active.zeroWhy ? ` ${active.zeroWhy.text}` : ""}</div>
      ) : (
        <div style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, overflowX: "auto" }} data-testid="audience-table">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>
              <th style={th}><input type="checkbox" aria-label="Select everyone shown" checked={shown.length > 0 && shown.every(r => picked.has(r.id))}
                onChange={e => setPicked(s => { const x = new Set(s); for (const r of shown) { if (e.target.checked) x.add(r.id); else x.delete(r.id); } return x; })} /></th>
              <th style={th}>Name</th><th style={th}>Status</th><th style={th}>Last gift</th>{giving && <th style={{ ...th, textAlign: "right" }}>Given in total</th>}
            </tr></thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id} data-testid="audience-row" className="audience-row">
                  <td style={td}><input type="checkbox" checked={picked.has(p.id)} onChange={e => flip(p.id, e.target.checked)} aria-label={`Select ${p.name}`} /></td>
                  <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: "50%", background: EM_SOFT, color: T.green, fontWeight: 700, fontSize: 11.5, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initials(p.name)}</span>
                    <span style={{ minWidth: 0 }}><DonorLink id={p.id} style={{ fontWeight: 700, color: T.ink, display: "block" }}>{p.name}</DonorLink>
                      <small style={{ color: T.ink3, fontSize: 12.5, overflowWrap: "anywhere" }}>{p.email}</small></span>
                  </div></td>
                  <td style={td}><span data-testid="audience-pill" data-tone={p.pill.tone} style={{ ...PILL[p.pill.tone], fontSize: 12, fontWeight: 600, borderRadius: 99, padding: "2px 9px", whiteSpace: "nowrap" }}>{p.pill.text}</span></td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: T.ink }}>{p.lastGift ? `${money(p.lastGift.amount)} · ${monthYear(p.lastGift.date)}` : <span style={{ color: T.ink3 }}>None on file</span>}</td>
                  {giving && <td style={{ ...td, textAlign: "right" }}>
                    <Figure variant="cell" kind="money" value={p.totalGiving} label={`${p.name}, given in total`} source={{ key: "donor-lifetime", params: { donor: p.id } }} />
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: T.ink3, fontSize: 12.5, padding: "0 4px" }}>
        <span>Showing {n(shown.length)} of {n(list.length)}{q ? " that match" : ""} · sorted by {sort === "last" ? "last gift" : "given in total"}</span>
        {list.length > 50 && <button type="button" data-testid="audience-show-all" onClick={() => setAll(v => !v)}
          style={{ background: "none", border: "none", padding: 0, color: T.green, fontWeight: 700, cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}>
          {all ? "Show the first 50" : `Show all ${n(list.length)}`}</button>}
        {giving && <span>Every total opens its gifts</span>}
      </div>
    </div>
  );
}

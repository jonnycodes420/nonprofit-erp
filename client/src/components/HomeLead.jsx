// HOME-2 · Home's lead slot (approved from docs/home-2/mockups/). The one or
// two things that matter most for the person signed in today, each with the
// one line that says why it is there. The server decides (GET /home/lead,
// shared/homeLead.js); this draws it. "Not now" sets a card aside for the day,
// and three of a kind teaches Home to rank that kind lower for this person.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useStewardTold, told } from "../lib/stewardTold";
import { T } from "./shared";
import { DonorLink } from "./RecordLink";
import { openTellSteward } from "./TellSteward";
import { atlasName, linkTarget } from "../lib/atlas";   // AGENT-5
import { beforeLines } from "./BeforeYourMeeting";   // VOICE-3: the one list of what to know before a meeting

const SERIF = "'DM Serif Display', Georgia, serif";
const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const first = n => String(n || "").trim().split(/\s+/)[0] || "them";

const EYEBROW = { fontSize: 11, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" };
const B1 = { background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" };
const B2 = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 9, padding: "9px 15px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" };
const LNK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontFamily: "inherit" };

function Why({ text, dark }) {
  return (
    <p data-testid="home-lead-why" style={{ fontSize: 13, lineHeight: 1.5, color: dark ? T.inkInverse : T.ink3, opacity: dark ? 0.75 : 1, margin: "0 0 14px", paddingLeft: 13, position: "relative" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: ".55em", width: 6, height: 6, borderRadius: 99, background: T.gold }} />
      {text}
    </p>
  );
}

// POLISH-3 · WHAT ATLAS IS WAITING ON, AS A CARD OF HOME'S OWN. It was a thin
// strip bolted above Home; now each waiting line is a card at the top of For
// you today, in the same shape as the others, with its one tap and a Not now.
// The server leaves out anything already done elsewhere (a gift recorded on
// the Add Gift form stops asking), so a card here always still needs her.
const ATLAS_TAP = { gift: "Record it", pledge: "Record it", receipt: "Send both", held_back: "Keep as a note" };
function atlasTitle(n) {
  const line = String(n.line || "");
  if (n.kind === "gift" || n.kind === "pledge") return `Record the ${line.replace(/:\s*tap to record\.?$/i, "")}?`;
  if (n.kind === "receipt") return `Send ${line.replace(/:\s*tap to send.*$/i, "").replace(/^Receipt and thank-you to /, "the receipt and thank-you to ")}?`;
  return line;
}
function atlasWhen(at) {
  const d = new Date(at);
  if (isNaN(d)) return "";
  const today = new Date();
  return d.toDateString() === today.toDateString() ? "today" : "on " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function useAtlasWaiting() {
  const [notes, setNotes] = useState([]);
  const load = () => apiFetch("/atlas/notes?place=home").then(r => setNotes((r.notes || []).filter(n => n.waits))).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);
  useStewardTold(() => load());
  return [notes, load];
}
function AtlasCard({ n, onNavigate, isReadOnly, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const name = atlasName();
  const act = async path => {
    setBusy(true); setErr("");
    try { await apiFetch(path, { method: "POST", body: "{}" }); told(); await onDone(); }
    catch (e) { setErr((e && e.sentence) || "That didn't go through. Try again, or open it from the bell."); }
    setBusy(false);
  };
  const t = linkTarget(n.link);
  const why = n.kind === "gift" || n.kind === "pledge"
    ? `You told ${name} ${atlasWhen(n.at)}. It is not in your totals until you say yes.`
    : n.kind === "receipt" ? `It goes once the gift is recorded. You told ${name} ${atlasWhen(n.at)}.`
    : `From what you told ${name} ${atlasWhen(n.at)}.`;
  return (
    <article data-testid="home-atlas-card" data-kind={n.kind}
      style={{ position: "relative", borderRadius: 14, padding: "20px 22px 18px", background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.greenDk }}>
      {!isReadOnly && (
        <button type="button" data-testid="home-atlas-dismiss" aria-label={`Not now: ${atlasTitle(n)}`} disabled={busy} onClick={() => act(`/atlas/actions/${n.id}/no`)}
          style={{ float: "right", margin: "-4px -4px 6px 10px", background: "none", border: "none", fontSize: 12.5, fontWeight: 700, color: T.ink3, cursor: "pointer", fontFamily: "inherit" }}>
          Not now ×</button>
      )}
      <div style={{ ...EYEBROW, color: T.greenDk }}>{name} · waiting for your yes</div>
      <h2 data-testid="home-atlas-title" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 20, lineHeight: 1.2, margin: "6px 0 8px" }}>{atlasTitle(n)}</h2>
      <Why text={why} />
      {err && <p role="alert" style={{ fontSize: 13, color: T.ink, margin: "0 0 12px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!isReadOnly && ATLAS_TAP[n.kind] && <button type="button" data-testid="home-atlas-tap" disabled={busy} style={B1} onClick={() => act(`/atlas/actions/${n.id}/yes`)}>{busy ? "Working…" : ATLAS_TAP[n.kind]}</button>}
        {n.kind === "draft" && t && <button type="button" style={B1} onClick={() => onNavigate && onNavigate(t[0], t[1])}>Open the draft</button>}
        {n.donorId && <DonorLink id={n.donorId} onOpen={() => onNavigate && onNavigate("donors", { selectDonorId: n.donorId })} style={B2}>Open the record</DonorLink>}
      </div>
    </article>
  );
}

export function HomeLead({ lead: leadIn, onNavigate, onSetAside, isReadOnly }) {
  const [aside, setAside] = useState({});
  const [atlas, reloadAtlas] = useAtlasWaiting();
  const lead = leadIn || [];
  if (!lead.length && !atlas.length) return null;
  const openPerson = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  // The Drift list is a section of Home itself (#dash-drifting); with it hidden, the people who went quiet on Donors.
  const seeDrift = () => { const el = document.getElementById("dash-drifting"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" }); else if (onNavigate) onNavigate("donors", { view: "reengage" }); };
  const notNow = c => {
    setAside(a => ({ ...a, [c.key]: true }));
    apiFetch("/home/lead/dismiss", { method: "POST", body: JSON.stringify({ kind: c.kind, key: c.key }) })
      .then(() => onSetAside && onSetAside()).catch(() => setAside(a => ({ ...a, [c.key]: false })));
  };
  return (
    <section data-testid="home-lead" aria-label="For you today" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...EYEBROW, color: T.ink3 }}>For you today{lead.some(c => c.kind === "season") ? " · Year-end" : ""}</div>
      {atlas.slice(0, 3).map(n => <AtlasCard key={n.id} n={n} onNavigate={onNavigate} isReadOnly={isReadOnly} onDone={reloadAtlas} />)}
      {lead.filter(c => !aside[c.key]).map(c => {
        const dark = c.kind === "meeting";
        const brass = c.kind === "confirm";
        return (
          <article key={c.key} data-testid={"home-lead-card"} data-kind={c.kind}
            style={{ position: "relative", borderRadius: 14, padding: "20px 22px 18px",
              background: dark ? T.ink : brass ? T.gold50 : T.white, color: dark ? T.inkInverse : T.ink,
              border: "1px solid " + (dark ? T.ink : brass ? T.gold : T.bg3) }}>
            {c.kind !== "quiet" && !isReadOnly && (
              <button type="button" data-testid="home-lead-notnow" onClick={() => notNow(c)}
                style={{ float: "right", margin: "-4px -4px 6px 10px", background: "none", border: "none", fontSize: 12.5, fontWeight: 700, color: dark ? T.inkInverse : T.ink3, opacity: dark ? 0.65 : 1, cursor: "pointer", fontFamily: "inherit" }}>
                Not now ×</button>
            )}
            <div style={{ ...EYEBROW, color: dark ? T.gold : c.kind === "gift" || c.kind === "season" ? T.greenDk : brass ? T.gold700 : T.ink3 }}>{c.eyebrow}</div>
            <h2 data-testid="home-lead-title" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: c.kind === "meeting" || c.kind === "gift" || c.kind === "season" ? 25 : 20, lineHeight: 1.2, margin: "6px 0 8px" }}>{c.title}</h2>
            {c.kind === "season" && (
              <div style={{ marginBottom: 4 }}>
                <div role="img" aria-label={`${money(c.raised)} of ${money(c.goal)}`}
                  style={{ height: 10, borderRadius: 6, background: T.bg2, overflow: "hidden", position: "relative", margin: "6px 0 4px" }}>
                  <i style={{ display: "block", height: "100%", width: `${Math.min(100, (c.raised / c.goal) * 100)}%`, background: T.greenDk }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: T.ink3, marginBottom: 12 }}>
                  <span>{Math.round((c.raised / c.goal) * 1000) / 10}% of the goal</span><span>{money(Math.max(0, c.goal - c.raised))} to go</span>
                </div>
              </div>
            )}
            <Why text={c.why} dark={dark} />
            {c.kind === "meeting" && beforeLines(c.brief).length > 0 && (
              <dl data-testid="home-lead-before" aria-label="Before your meeting" style={{ display: "grid", gridTemplateColumns: "minmax(90px,118px) 1fr", gap: "7px 14px", fontSize: 14, margin: "4px 0 16px" }}>
                {beforeLines(c.brief).map(([k, v]) => [<dt key={k + "t"} style={{ color: T.inkInverse, opacity: 0.6, fontSize: 12.5 }}>{k}</dt>, <dd key={k + "d"} style={{ margin: 0 }}>{v}</dd>])}
              </dl>
            )}
            {c.kind === "gift" && c.draft && (
              <div style={{ borderLeft: "3px solid " + T.greenDk, background: T.ground, padding: "10px 14px", fontSize: 14, color: T.ink2, margin: "0 0 14px", borderRadius: "0 8px 8px 0" }}>
                <small style={{ display: "block", color: T.ink3, fontSize: 12, marginBottom: 3 }}>Draft thank-you, waiting for your yes</small>
                {c.draft.length >= 220 ? c.draft.replace(/\s\S*$/, "") + "…" : c.draft}
              </div>
            )}
            {c.kind === "confirm" && c.lines && c.lines.length > 0 && (
              <div style={{ margin: "2px 0 14px", borderTop: "1px solid " + T.bg2 }}>
                {[...c.lines, ...(c.more ? [{ label: `${c.more.count} more`, amount: c.more.amount }] : [])].map(l => (
                  <div key={l.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid " + T.bg2, fontSize: 14 }}>
                    {l.label}<span style={{ color: T.ink3 }}>{money(l.amount)}</span></div>))}
              </div>
            )}
            {c.kind === "quiet" && c.people && c.people.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                {c.people.map(p => <DonorLink key={p.donorId} id={p.donorId} onOpen={() => openPerson(p.donorId)} style={B2}>{p.name}</DonorLink>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {c.kind === "meeting" && <>
                <DonorLink id={c.donorId} onOpen={() => openPerson(c.donorId)} style={B1}>Open {first(c.donorName)}'s brief</DonorLink>
                {!isReadOnly && <button type="button" style={{ ...B2, background: "transparent", color: T.inkInverse, borderColor: T.ink3 }}
                  onClick={() => openTellSteward({ id: c.donorId, name: c.donorName })}>Afterwards, tell {atlasName()} how it went</button>}
              </>}
              {c.kind === "gift" && <>
                <button type="button" style={B1} onClick={() => onNavigate && onNavigate("donors", { selectDonorId: c.donorId })}>{c.draft ? "Review the thank-you" : "Thank them"}</button>
                <DonorLink id={c.donorId} onOpen={() => openPerson(c.donorId)} style={B2}>Open {c.donorName}</DonorLink>
              </>}
              {c.kind === "confirm" && <button type="button" style={B1} onClick={() => onNavigate && onNavigate("fundraising", { frSection: "toconfirm" })}>Confirm them</button>}
              {(c.kind === "drift" || c.kind === "seasonCall") && <>
                <DonorLink id={c.donorId} onOpen={() => openPerson(c.donorId)} style={B1}>Call {first(c.donorName)}</DonorLink>
                {/* FIX-55: "See all" is the Drift list on this page, never Data health */}
                {c.kind === "drift" && c.count > 1 && <button type="button" style={LNK} onClick={seeDrift}>See all {c.count}</button>}
              </>}
              {c.kind === "card" && <button type="button" style={B1} onClick={() => onNavigate && onNavigate("fundraising", { frSection: "recurring" })}>Send the link</button>}
              {/* FIX-55: the appeal and the event the card names, open */}
              {c.kind === "season" && <button type="button" style={B1} onClick={() => onNavigate && onNavigate("fundraising", c.campaignId ? { frSection: "campaigns", campaignId: c.campaignId } : { frSection: "campaigns" })}>Open the appeal</button>}
              {c.kind === "event" && <button type="button" style={B1} onClick={() => onNavigate && onNavigate("fundraising", c.eventId ? { frSection: "events", eventId: c.eventId } : { frSection: "events" })}>Open the event</button>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

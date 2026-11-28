// home/HomeCards.jsx · HOME-7 items 3 and 4. MAJOR GIFTS AND PLANNED GIVING, AND THE RAIL.
//
// Major gifts shows only when the org has Major Gifts turned on (NAV-2); its
// figures are the Major Gifts page's (GET /major-gifts/dashboard, read by
// server/reports/homeCards.js). Planned giving shows for every org with at least
// one sign: the deck's Planned tab, its count and its top three. The rail, top
// to bottom: Today, Year-end so far, Thank-yous, Retention, Your givers and
// Connections. Each figure opens its rows and says its sentence.
import { T, STAGES } from "../shared";
import { Figure } from "../Figure";
import { DonorLink } from "../RecordLink";
import { fmtWhole } from "../../lib/money";

const DEF = { fontSize: 12.5, lineHeight: 1.45, color: T.ink3, margin: "4px 0 0" };
const LNK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const NAME = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 14, color: T.ink, fontWeight: 700, cursor: "pointer", textAlign: "left" };
const BIG = { fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 28, lineHeight: 1.1, color: T.ink };
const LI = { padding: "10px 0", borderTop: "1px solid " + T.bg2, fontSize: 14 };
const EYEBROW = { fontSize: 12, fontWeight: 700, color: T.ink2, marginBottom: 6 };
const RAIL = { border: "1px solid " + T.bg3, borderRadius: 14, padding: "12px 16px", background: T.white };
const money = c => fmtWhole((Number(c) || 0) / 100);
const stageWord = s => (STAGES.find(x => x.id === s) || { label: s }).label;
const plural = (n, one, many) => `${Number(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Head({ title, link, onLink }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.ink }}>{title}</h3>
      {link && <button type="button" style={LNK} onClick={onLink}>{link}</button>}
    </div>
  );
}

export function MajorPlanned({ cards, planned, onNavigate, openProfile, onSeePlanned }) {
  const mj = cards && cards.major;
  if (!mj && !planned) return null;
  const toMg = () => onNavigate && onNavigate("majorgifts");
  return (
    <div className="home-pair" data-testid="home-major-planned">
      {mj && <section className="home-card" data-testid="home-major">
        <Head title="Major gifts" link="Open the pipeline" onLink={toMg} />
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 12 }}>
          <div><button type="button" style={{ ...NAME, ...BIG, fontWeight: 400 }} onClick={toMg} title={mj.open.definition || undefined} data-testid="home-major-open" data-cents={mj.open.cents}>{money(mj.open.cents)}</button>
            <div style={DEF}>in open asks{mj.open.people != null ? ` across ${plural(mj.open.people, "person", "people")}` : ""}</div></div>
          <div><button type="button" style={{ ...NAME, ...BIG, fontWeight: 400 }} onClick={toMg} title={mj.yes.definition || undefined} data-testid="home-major-yes" data-cents={mj.yes.cents}>{money(mj.yes.cents)}</button>
            <div style={DEF}>said yes this year, {plural(mj.yes.gifts, "gift", "gifts")}</div></div>
        </div>
        {mj.stages.length > 0 && <div style={{ marginTop: 14 }}>
          <div aria-hidden style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 }}>
            {mj.stages.map(s => <span key={s.stage} style={{ flex: s.n, background: (STAGES.find(x => x.id === s.stage) || {}).color || T.greenDk }} />)}
          </div>
          <div style={{ fontSize: 13, color: T.ink2, marginTop: 6, lineHeight: 1.5 }}>
            {mj.stages.map((s, i) => <span key={s.stage}>{i > 0 && " · "}<Figure variant="inline" value={s.n} label={`Prospects in ${stageWord(s.stage)}`} definition={mj.stagesDefinition} source={s.source} figureKey={"home-stage-" + s.stage} why={false} /> {stageWord(s.stage).toLowerCase()}</span>)}
          </div>
        </div>}
        <div style={{ marginTop: 10 }}>
          {mj.next.map(p => (
            <div key={p.donorId} style={LI}><DonorLink id={p.donorId} onOpen={() => openProfile(p.donorId)} className="attn-donor-name" style={{ ...NAME, textDecoration: "none" }}>{p.name}</DonorLink>
              <div style={{ fontSize: 13, color: T.ink2, marginTop: 2 }}>{[stageWord(p.stage), p.askCents ? money(p.askCents) : null, p.step, p.late ? `${p.late === 1 ? "1 day" : p.late + " days"} late` : null].filter(Boolean).join(" · ")}</div></div>
          ))}
        </div>
      </section>}
      {planned && <section className="home-card" data-testid="home-planned">
        <Head title="Planned giving" link={`See all ${planned.count.toLocaleString("en-US")}`} onLink={onSeePlanned} />
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 12 }}>
          {planned.bequests > 0 && <div><span style={BIG}><Figure variant="inline" value={planned.bequests} label="Told you you're in their will" source={planned.bequestSource} figureKey="home-bequests" why={false} /></span>
            <div style={DEF}>{planned.bequests === 1 ? "has" : "have"} told you you're in their will</div></div>}
          <div><button type="button" style={{ ...NAME, ...BIG, fontWeight: 400 }} onClick={onSeePlanned} data-testid="home-planned-count">{planned.count.toLocaleString("en-US")}</button>
            <div style={DEF}>{planned.count === 1 ? "shows a sign" : "show a sign"} worth a conversation</div></div>
        </div>
        <p style={{ ...DEF, marginTop: 10 }}>{planned.definition}</p>
        <div style={{ marginTop: 6 }}>
          {planned.top.map(p => (
            <div key={p.donorId} style={LI}><DonorLink id={p.donorId} onOpen={() => openProfile(p.donorId)} className="attn-donor-name" style={{ ...NAME, textDecoration: "none" }}>{p.name}</DonorLink>
              <div style={{ fontSize: 13, color: T.ink2, marginTop: 2 }}>{p.sign}</div></div>
          ))}
        </div>
      </section>}
    </div>
  );
}

// ── THE RAIL ───────────────────────────────────────────────────────────────
const timeOf = at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
function ago(at) {
  if (!at) return null;
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? "a minute ago" : `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function RailCards({ cards, owners, OwnersCard, onNavigate, openProfile, isAdmin, isReadOnly }) {
  if (!cards) return null;
  const { meetings = [], yearEnd: ye, thankYous: ty, retention: rt, connections: cn = [] } = cards;
  return <>
    <div data-testid="home-today" style={RAIL}>
      <div style={EYEBROW}>Today</div>
      {!meetings.length ? <div data-testid="home-today-none" style={{ fontSize: 13.5, color: T.ink2 }}>Nothing due today.</div>
        : meetings.map(m => (
          <div key={m.id} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13.5 }}>
            <span style={{ flex: "0 0 52px", color: T.ink2, fontVariantNumeric: "tabular-nums" }}>{m.startsAt ? timeOf(m.startsAt) : ""}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{m.people.length ? <>{m.title ? m.title.replace(m.people[0].name, "").trim() || "Meeting with" : "Meeting with"} <DonorLink id={m.people[0].id} onOpen={() => openProfile(m.people[0].id)} className="attn-donor-name" style={{ ...NAME, fontSize: 13.5, textDecoration: "none" }}>{m.people[0].name}</DonorLink>
              <div style={{ color: T.ink3, fontSize: 12.5, marginTop: 2 }}>Gave {money(m.people[0].cents)} this year. Open their page before you go.</div></> : m.title}</span>
          </div>
        ))}
      <button type="button" style={{ ...LNK, marginTop: 6 }} onClick={() => onNavigate && onNavigate("calendar")}>Open calendar</button>
    </div>
    {ye && <div data-testid="home-year-end" style={RAIL}>
      <div style={EYEBROW}>{ye.inSeason ? "Year-end so far" : "Year-end, last season"}</div>
      <div style={BIG}><Figure variant="inline" kind="money" whole value={ye.cents / 100} label="Given since Nov 1" definition={ye.sentence} source={ye.source} figureKey="home-year-end" why={false} /></div>
      <p style={DEF}>Given since Nov 1, every fund. Last year by this date: <Figure variant="inline" kind="money" whole value={ye.lastCents / 100} label="Last year by this date" source={ye.lastSource} figureKey="home-year-end-last" why={false} />.</p>
      {ye.goal && <div style={{ marginTop: 8 }}>
        <div aria-hidden style={{ height: 6, borderRadius: 3, background: T.bg2, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: Math.min(100, ye.goal.pct) + "%", background: T.greenDk }} /></div>
        <p style={DEF}>{ye.goal.pct}% of your {money(ye.goal.goalCents)} {ye.goal.name}{ye.daysLeft > 0 ? `, with ${ye.daysLeft} days to go` : ""}.</p>
      </div>}
    </div>}
    {ty && <div data-testid="home-rail-thanks" style={RAIL}>
      <div style={EYEBROW}>Thank-yous</div>
      <div><span style={BIG}><Figure variant="inline" value={ty.n} label="Gifts waiting to be thanked" definition={ty.definition} source={ty.source} figureKey="home-thanks-rail" why={false} /></span> <span style={{ fontSize: 13.5, color: T.ink2 }}>{ty.n === 1 ? "gift waiting" : "gifts waiting"}</span></div>
      <p style={DEF}>{ty.sentence}</p>
      {ty.n > 0 && <button type="button" style={{ ...LNK, marginTop: 6 }} onClick={() => onNavigate && onNavigate("fundraising", { frSection: "acknowledgments" })}>Open the thank-yous</button>}
    </div>}
    {rt && rt.rate != null && <div data-testid="home-retention" style={RAIL}>
      <div style={EYEBROW}>Retention</div>
      <div><span style={BIG}><Figure variant="inline" kind="percent" value={rt.rate} suffix="%" label="Retention" source={rt.source} figureKey="home-retention" why={false} /></span> <span style={{ fontSize: 13.5, color: T.ink2 }}>of last year's givers gave again</span></div>
      <p style={DEF}>{rt.sentence}</p>
    </div>}
    {isAdmin && !isReadOnly && OwnersCard && <OwnersCard owners={owners} onNavigate={onNavigate} />}
    {cn.length > 0 && <div data-testid="home-connections" style={RAIL}>
      <div style={EYEBROW}>Connections</div>
      {cn.map(c => {
        const att = c.state === "attention";
        return (
          <div key={c.id} data-testid="home-connection" data-state={c.state || ""} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", fontSize: 13.5, borderTop: "1px solid " + T.bg2, ...(att ? { borderLeft: "3px solid " + T.gold, paddingLeft: 8 } : {}) }}>
            <span style={{ fontWeight: 600, color: T.ink }}>{c.label}</span>
            <span style={{ color: att ? T.ink : T.ink3, textAlign: "right" }}>{att ? <button type="button" style={{ ...LNK, fontSize: 13 }} onClick={() => onNavigate && onNavigate("settings", { section: "connections" })}>{c.words}</button> : c.at ? `Last read ${ago(c.at)}` : c.words}</span>
          </div>
        );
      })}
    </div>}
  </>;
}

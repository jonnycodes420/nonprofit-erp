// LANDING-2 · the lean homepage, section for section as the reference's #home:
// hero, research strip, Why tabs, AI band, products, searchable features,
// people reel, guide band, FAQ, commitment, ready.
import { useState } from "react";
import { A, Pill, Photo, Icon, Ui, TeamReel, FaqList } from "../lib";
import { STATS, srcShort, SRC } from "../data/research";
import { FEAT, FEATURE_CATS, FEATURE_EXTRAS } from "../data/features";
import { HOME_FAQ } from "../data/faqs";

const TABS = [
  { label: "Keep more", h: <>See drift <b>while a call still fixes it.</b></>, p: "Each donor measured against their own rhythm, ranked by what is at stake, with the reason in plain words and a person named on the next step.", href: "/features/drift", bg: "brass-tint",
    ui: <Ui t="Going quiet" k="drift" rows={[["MC", "Margaret Chen", "Gives $15,000 each August · <em>no gift yet</em>", "Call"], ["WF", "Walter Fairbanks", "Monthly $250 · <em>card failed twice</em>", "Fix card"], ["RT", "Rosalind Thackeray", "Gave $21,529 · <em>14 months since a visit</em>", "Book visit"]]} /> },
  { label: "Raise more", h: <>Give in <b>under a minute.</b></>, p: "Giving pages on your brand, events with tickets and seating, and peer-to-peer teams, all landing on the same donor record. Gifts go to your own Stripe account with no platform fee.", href: "/features/forms", bg: "emerald-tint",
    ui: <Ui t="Spring appeal" k="forms" tots={[["Gifts", "one-time and monthly", "186"], ["Raised", "to your Stripe", "$24,610", 1], ["New monthly donors", "this month", "19"], ["Platform fee", "on every gift", "$0"]]} /> },
  { label: "Run lighter", h: <>Month end <b>without the scramble.</b></>, p: "Receipts and year-end statements in a batch, payouts matched to the cent and a gift file your bookkeeper trusts. Every change in the audit log.", href: "/features/finance", bg: "cream",
    ui: <Ui t="Month end · September" k="check" tots={[["Gifts recorded", "all sources", "412"], ["Stripe payouts", "matched", "$31,204.55", 1], ["Letters ready", "this week", "64"], ["Bookkeeper file", "ready", "Download"]]} /> },
  { label: "Focus more", h: <>Every number <b>opens.</b></>, p: "Retention, LYBUNT and SYBUNT, campaigns and board summaries. Click any figure and see the people behind it, so you always know where to spend the next hour.", href: "/features/reports", bg: "brass-tint",
    ui: <Ui t="Retention · this year" k="reports" tots={[["Donors last year", "2025", "1,184"], ["Gave again", "so far", "702"], ["Retention", "to date", "59.3%", 1], ["LYBUNT", "worth a call", "482"]]} /> },
];

const FINDER = Object.keys(FEAT).map(k => ({ n: FEAT[k].name, s: FEAT[k].short, i: FEAT[k].icon, h: "/features/" + k, c: FEATURE_CATS[k] || "keep" })).concat(FEATURE_EXTRAS);
const CHIPS = [["all", "All"], ["keep", "Keep"], ["raise", "Raise"], ["run", "Run"], ["focus", "Focus"]];

function StatMarquee() {
  const cards = STATS.map(s => (
    <div className="sc" key={s[0]} data-stat={s[0]}><b>{s[0]}</b><p>{s[1]}</p><span><A href={SRC[s[2]][1]} style={{ color: "inherit" }}>{srcShort(s[2])}</A></span></div>
  ));
  return (
    <div className="marq-s" aria-label="What the research says">
      <div className="wrap"><div className="eyebrow">What the research says</div></div>
      <div className="marq"><div className="track">
        {cards}
        <div style={{ display: "contents" }} data-dup aria-hidden="true">{STATS.map(s => <div className="sc" key={"b" + s[0]}><b>{s[0]}</b><p>{s[1]}</p><span>{srcShort(s[2])}</span></div>)}</div>
        <div style={{ display: "contents" }} data-dup aria-hidden="true">{STATS.map(s => <div className="sc" key={"c" + s[0]}><b>{s[0]}</b><p>{s[1]}</p><span>{srcShort(s[2])}</span></div>)}</div>
      </div></div>
    </div>
  );
}

function WhyTabs() {
  const [tab, setTab] = useState(0);
  return (
    <section id="why-tabs">
      <div className="wrap">
        <div className="eyebrow">Why Steward</div>
        <h2 className="mix h-l" style={{ marginTop: 22, maxWidth: 1100 }}>Donor software that keeps <b>more within reach.</b></h2>
        <p className="lede" style={{ marginTop: 22 }}>Steward brings your donors, gifts, events, volunteers and inbox together, then tells you each morning who needs you and why.</p>
        <div className="tabs" role="tablist">
          {TABS.map((t, i) => <button key={t.label} role="tab" type="button" aria-selected={tab === i ? "true" : "false"} onClick={() => setTab(i)}>{t.label}</button>)}
        </div>
        <div className="panes">
          {TABS.map((t, i) => (
            <div className="pane" key={t.label} role="tabpanel" hidden={tab !== i}>
              <div><h3 className="mix h-m">{t.h}</h3><p>{t.p}</p><Pill href={t.href}>Take a tour</Pill></div>
              <div className="stage"><div className="bg" style={{ background: "var(--" + t.bg + ")" }}></div>{t.ui}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureFinder() {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const term = q.toLowerCase().trim();
  const m = FINDER.filter(f => (cat === "all" || f.c.indexOf(cat) > -1) && (!term || (f.n + " " + f.s).toLowerCase().indexOf(term) > -1));
  const show = all || term ? m : m.slice(0, 12);
  return (
    <section className="pricing" id="feat-home">
      <div className="wrap">
        <div className="eyebrow">Features</div>
        <h2 className="mix h-l" style={{ marginTop: 22 }}>Everything included, <b>nothing to unlock.</b></h2>
        <div className="fbar">
          <input type="search" placeholder="Search features" aria-label="Search features" value={q} onChange={e => setQ(e.target.value)} />
          <div className="fchips" role="group" aria-label="Filter features">
            {CHIPS.map(([c, l]) => <button key={c} type="button" aria-pressed={cat === c ? "true" : "false"} onClick={() => setCat(c)}>{l}</button>)}
          </div>
        </div>
        <p className="fcount">Showing {show.length} of {m.length}</p>
        <div className="fgrid">
          {show.length ? show.map(f => (
            <A className="fc" href={f.h} key={f.n}><span className="ci"><Icon k={f.i} /></span><div><b>{f.n}</b><span>{f.s}</span></div></A>
          )) : <p>No features match. Try another word.</p>}
        </div>
        <div style={{ marginTop: 34 }} hidden={show.length >= m.length}>
          <button className="pill pill-soft" type="button" onClick={() => setAll(true)}><i></i>See more features</button>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div id="home">
      <section className="hero">
        <div className="wrap hero-g">
          <div>
            <div className="eyebrow">Steward donor CRM</div>
            <h1 className="mix h-xl">Keep the donors <b>you already have.</b></h1>
            <p className="lede">Steward shows you who is drifting while a phone call still fixes it, then runs the rest of your development office: gifts, events, volunteers, email and month end, in one calm place.</p>
            <div className="ctas">
              <Pill href="/demo">Book a demo</Pill>
              <Pill kind="soft" href="/platform">Tour Steward</Pill>
            </div>
            <div className="proof"><span>Move in about a day</span><span>Month to month</span><span>No platform fee</span></div>
          </div>
          <div className="collage">
            <Photo k="desk-phone" cls="p1" eager />
            <Photo k="volunteers-boxes" cls="p2" eager />
            <div className="float" aria-label="Example: donors going quiet this week"><small>GOING QUIET THIS WEEK</small><b>11 donors, $38,400 a year</b>
              <div><span>Margaret Chen</span><em>No August gift</em></div>
              <div><span>Walter Fairbanks</span><em>Card failed twice</em></div>
            </div>
          </div>
        </div>
      </section>

      <StatMarquee />
      <WhyTabs />

      <section style={{ paddingTop: 0 }}>
        <div className="ink"><div className="wrap ai-g" style={{ paddingBlock: 104 }}>
          <div>
            <div className="eyebrow">Human-centered AI</div>
            <h2 className="mix h-l" style={{ marginTop: 22, color: "var(--white)" }}>AI that drafts. <b>People who decide.</b></h2>
            <p style={{ fontSize: 21, marginTop: 22, color: "rgba(255,255,255,.88)" }}>Steward Agent prepares, drafts and organizes, then shows you the plan and waits. Nothing reaches a donor until a person sends it.</p>
            <div style={{ marginTop: 34 }}><Pill kind="white" href="/agent">Meet Steward Agent</Pill></div>
          </div>
          <div className="ai-list">
            <div><h4>Mission is the measure.</h4><p>Every assistant exists to help you keep a donor, raise a gift or save an hour.</p></div>
            <div><h4>Relationships stay human.</h4><p>The Agent drafts and recommends. Your staff approve and send.</p></div>
            <div><h4>Every action can be undone.</h4><p>Whatever it does is in the audit log with who approved it.</p></div>
          </div>
        </div></div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="eyebrow">Products</div>
          <h2 className="mix h-l" style={{ marginTop: 22 }}>Three products, <b>one record.</b></h2>
          <div className="prods">
            <div className="prod p1"><span className="tag">Steward CRM</span><h3>Keep more.</h3><p>See drift early, keep new donors close through their first year and give the board numbers that open.</p><Pill href="/crm">Learn about CRM</Pill></div>
            <div className="prod p2"><span className="tag">Steward Volunteer</span><h3>Count every hour.</h3><p>Shifts, kiosk check-in, waivers and hours, with volunteers and donors on one record.</p><Pill href="/volunteer">Learn about Volunteer</Pill></div>
            <div className="prod p3"><span className="tag">Steward Agent</span><h3>Say it. Approve it.</h3><p>Six assistants that draft and organize, show you the plan and wait for your yes.</p><Pill href="/agent">Learn about Agent</Pill></div>
          </div>
        </div>
      </section>

      <FeatureFinder />
      <TeamReel />

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="guide-band">
            <div className="gb-art"><div className="t">The first-year<br /><b>retention plan</b></div><small>Twelve touches in twelve months</small><span className="leaf"></span></div>
            <div className="gb-txt"><div className="eyebrow">Keep the second gift</div><h2 className="mix h-m">Only 19.4% of first-time donors <b>give again.</b></h2><p>A free, practical plan for a team of one or two: what to send, when to call and who owns each step, so new donors become repeat donors.</p><Pill href="/guides/first-year-retention">Get the free guide</Pill></div>
          </div>
        </div>
      </section>

      <section id="faq-home">
        <div className="wrap faq">
          <div><div className="eyebrow">Steward FAQ</div><h2 className="mix h-l" style={{ marginTop: 22 }}>Questions? <b>We've got answers.</b></h2><p style={{ marginTop: 22 }}><A href="/faq" style={{ fontWeight: 700, color: "var(--emerald)" }}>See every question →</A></p></div>
          <div><FaqList items={HOME_FAQ} /></div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="final"><div className="wrap" style={{ paddingBlock: 110 }}>
          <div className="eyebrow">Our commitment</div>
          <h2 className="mix h-l" style={{ marginTop: 22 }}>Every donor is a person. <b>Keep them.</b></h2>
          <p>Keep, raise and run more, with Steward.</p>
          <div className="ctas" style={{ marginTop: 36 }}><Pill kind="white" href="/demo">Book a demo</Pill></div>
        </div></div>
      </section>

      <section className="ready">
        <div className="wrap ready-g">
          <div><div className="eyebrow">Ready to get started?</div><h2 className="mix h-m" style={{ marginTop: 16 }}>Twenty minutes, <b>your own file.</b></h2><Pill href="/demo" style={{ marginTop: 26 }}>Book a demo</Pill></div>
          <div><div className="eyebrow">Want to see it first?</div><h2 className="mix h-m" style={{ marginTop: 16 }}>Walk through <b>the platform.</b></h2><Pill kind="soft" href="/platform" style={{ marginTop: 26 }}>Take a tour</Pill></div>
        </div>
      </section>
    </div>
  );
}

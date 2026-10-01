// LANDING-2 · the Resources menu: guides, templates, articles, the glossary,
// the FAQ, help, what's new, the three calculators and the legal drafts.
import React, { useState } from "react";
import { Hero, Crumbs, Cards, FaqS, FinalCta, StatBand, Steps, Photo, Pill, A } from "../lib";
import { GUIDES, GUIDE_SLUGS } from "../data/guides";
import { TEMPL } from "../data/templates";
import { ARTS, CHG } from "../data/articles";
import { GLOSS } from "../data/glossary";
import { FAQ_PAGE } from "../data/faqs";
import { SRC, QUOTES } from "../data/research";
import { LEGAL_ENTITY_NAME } from "../../../../shared/legalEntity.js";

export function Resources() {
  return <>
    <Hero eyebrow="Resources" crumbs={[["Resources"]]} h="Learn from people <b>who've done the work.</b>" lede="Guides, templates, free tools and the research behind them, for development teams of one to five." noCta />
    <Cards list={[["/guides", "Guides", "Five plans you can run this month.", "forms"], ["/templates", "Templates", "Thank-you letters, win-back emails and more.", "receipts"], ["/articles", "Articles", "Short reads on retention and stewardship.", "grants"], ["/glossary", "Glossary", "Fundraising terms in plain words.", "forms"], ["/tools", "Free tools", "Lost & Found and three calculators.", "reports"], ["/faq", "FAQ", "Answers to what most teams ask first.", "check"]]} />
    <StatBand n={4} dark />
    <FinalCta />
  </>;
}

export function Guides() {
  return <>
    <Hero eyebrow="Guides" crumbs={[["Resources", "/resources"], ["Guides"]]} h="Practical guides <b>for small teams.</b>" lede="Plans you can run this month, written for a development office of one to five people." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="res">
      {GUIDE_SLUGS.map(k => {
        const g = GUIDES[k];
        return <A className="rc" href={"/guides/" + k} key={k}><Photo k={g.p} /><span className="k">Guide · {g.min} min</span><h4>{g.t}</h4><p>{g.d}</p><span className="go">Read the guide →</span></A>;
      })}
    </div></div></section>
    <FinalCta />
  </>;
}

function jump(e, id) {
  e.preventDefault();
  const t = document.getElementById(id);
  if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
}

export function Guide({ slug }) {
  const g = GUIDES[slug];
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Guides", "/guides"], [g.t]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap hero-g">
      <div><div className="eyebrow">Guide · {g.min} minute read</div><h1 className="mix h-l">{g.t}</h1><p className="lede">{g.d}</p></div>
      <Photo k={g.p} cls="wide" eager />
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap art-g">
      <aside className="toc"><b>In this guide</b>{g.s.map((s, i) => <a key={i} href={"#g" + i} onClick={e => jump(e, "g" + i)}>{s[0]}</a>)}</aside>
      <article className="prose">
        {g.s.map((s, i) => <React.Fragment key={i}><h2 id={"g" + i}>{s[0]}</h2><p>{s[1]}</p></React.Fragment>)}
        <div className="callout"><b>Run this plan in Steward.</b><p>Journeys schedule every touch, name who owns it and put today's steps on your Home screen.</p><Pill href="/demo">Book a demo</Pill></div>
      </article>
    </div></section>
    <Cards eb="More guides" h="Keep <b>reading.</b>" list={GUIDE_SLUGS.filter(x => x !== slug).slice(0, 3).map(x => ["/guides/" + x, GUIDES[x].t, GUIDES[x].d, "forms"])} />
    <FinalCta />
  </>;
}

function Template({ t }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try { navigator.clipboard.writeText(t[1]); setCopied(true); } catch { /* the text stays selectable */ }
  }
  return (
    <div className="tmpl">
      <div className="th"><h4>{t[0]}</h4><button className="pill pill-soft" type="button" onClick={copy}><i></i>{copied ? "Copied" : "Copy"}</button></div>
      <pre>{t[1]}</pre>
    </div>
  );
}

export function Templates() {
  return <>
    <Hero eyebrow="Templates" crumbs={[["Resources", "/resources"], ["Templates"]]} h="Templates you can <b>use today.</b>" lede="Copy, adapt and send. Every template is free." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tmpls">{TEMPL.map(t => <Template t={t} key={t[0]} />)}</div></section>
    <FinalCta />
  </>;
}

export function Articles() {
  return <>
    <Hero eyebrow="Articles" crumbs={[["Resources", "/resources"], ["Articles"]]} h="Ideas worth <b>a coffee break.</b>" lede="Short reads on retention, stewardship and running a calm development office." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="res">
      {ARTS.map(a => <A className="rc" href={a[2]} key={a[0]}><Photo k={a[3]} /><span className="k">Article</span><h4>{a[0]}</h4><p>{a[1]}</p><span className="go">Read →</span></A>)}
    </div></div></section>
    <FinalCta />
  </>;
}

const Quote = ({ q }) => <blockquote data-quote="research">{q[0]}<cite>{q[1]}, {q[2]}</cite></blockquote>;

export function StateOfRetention() {
  return <>
    <Crumbs list={[["Resources", "/resources"], ["Articles", "/articles"], ["The state of donor retention"]]} />
    <section className="hero phero" style={{ paddingBottom: 40 }}><div className="wrap">
      <div className="eyebrow">Article · 5 minute read</div>
      <h1 className="mix h-l" style={{ maxWidth: 1000 }}>The state of donor retention, <b>in plain words.</b></h1>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap prose narrow">
      <p>Every quarter the Fundraising Effectiveness Project, a collaboration of AFP and GivingTuesday, publishes giving data from thousands of nonprofits. Its Q4 2025 report covered the full year, and the headline was mixed: dollars rose 5.0%, but the number of donors fell 3.6%.</p>
      <h2>Fewer people, bigger checks</h2>
      <p>Overall donor retention edged up to 43.3%. That still means more than half of the people who gave in 2024 did not give in 2025. Growth came mostly from larger gifts while small donors kept falling away.</p>
      <Quote q={QUOTES[0]} />
      <h2>The second gift</h2>
      <p>The gap between new and repeat donors is the most useful number in fundraising. In FEP's Q4 2024 report, 19.4% of new donors gave again, compared with 69.2% of repeat donors. Get the second gift and a donor is more than three times as likely to stay.</p>
      <h2>What moves the number</h2>
      <p>The research points to the same few habits: a fast, personal thank-you, proof that the gift mattered, and a renewal ask timed to the donor's own rhythm. Penelope Burk found that a thank-you call within 48 hours led to gifts 39% larger the next time. Adrian Sargeant's work suggests a 10% lift in retention can raise the lifetime value of a donor file by up to 200%.</p>
      <Quote q={QUOTES[1]} />
      <h2>What a small shop can do this week</h2>
      <p>Pull last year's donors who have not given this year. Call the top twenty. Thank every new gift within two days. Put a first-year plan on the calendar for every new donor. Steward does the sorting and the reminders. You do the part that only a person can.</p>
      <p className="srcnote">Sources: {["fep25", "fep24", "burk", "sarg"].map((k, i) => <React.Fragment key={k}>{i ? " · " : ""}<A href={SRC[k][1]}>{SRC[k][0]}</A></React.Fragment>)}</p>
    </div></section>
    <FinalCta />
  </>;
}

export function Glossary() {
  return <>
    <Hero eyebrow="Nonprofit glossary" crumbs={[["Resources", "/resources"], ["Glossary"]]} h="Fundraising terms, <b>in plain words.</b>" lede="The words you will hear in board meetings and on software demos, explained without jargon." noCta />
    <section style={{ paddingTop: 0 }}><dl className="wrap gloss" style={{ marginBlock: 0 }}>
      {GLOSS.map(g => <div key={g[0]}><dt>{g[0]}</dt><dd>{g[1]}</dd></div>)}
    </dl></section>
    <FinalCta />
  </>;
}

export function Faq() {
  return <>
    <Crumbs list={[["Resources", "/resources"], ["FAQ"]]} />
    <FaqS items={FAQ_PAGE} h="Questions? <b>We've got answers.</b>" as="h1" />
    <FinalCta />
  </>;
}

export function Help() {
  return <>
    <Hero eyebrow="Help centre" crumbs={[["Customers"], ["Help centre"]]} h="Help from <b>a real person.</b>" lede="A searchable help centre with an article for every screen is being written now. Until it is live, every question goes to a person who knows Steward inside out." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {[["Email support", "jonathan@stewardapp.dev. A human reads every message.", "mailto:jonathan@stewardapp.dev"], ["Book a help call", "Twenty minutes on screen together.", "/demo"], ["Common questions", "Answers to what most teams ask first.", "/faq"], ["What's new", "Every change we ship.", "/whats-new"]].map(c => (
        <A className="card" href={c[2]} key={c[0]}><h4>{c[0]}</h4><p>{c[1]}</p><span className="go">Open →</span></A>
      ))}
    </div></div></section>
    <FinalCta />
  </>;
}

export function WhatsNew() {
  return <>
    <Hero eyebrow="What's new" crumbs={[["Customers"], ["What's new"]]} h="What we <b>shipped lately.</b>" lede="Steward ships improvements every week. Here is the recent list, newest first." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap chg"><h3>Autumn 2026</h3>
      {CHG.map(c => <div key={c[0]}><span className="chip">New</span><div><b>{c[0]}</b><p>{c[1]}</p></div></div>)}
    </div></section>
    <FinalCta />
  </>;
}

// ── FREE TOOLS ─────────────────────────────────────────────────────────────
// Ported as they work in the reference. Everything is computed in the
// browser; nothing on these pages sends anything anywhere.
export function Tools() {
  return <>
    <Hero eyebrow="Free tools" crumbs={[["Resources", "/resources"], ["Free tools"]]} h="Free tools, <b>no signup.</b>" lede="Run them on your own numbers. Nothing you type leaves your browser." noCta />
    <Cards list={[["/tools/lost-and-found", "Lost & Found donor audit", "See who you are about to lose from your own giving export.", "drift"], ["/tools/retention", "Keep Rate calculator", "Your retention rate, and what a few points are worth.", "reports"], ["/tools/lapsed-cost", "Lapse Ledger", "What last year's lapsed donors used to give.", "finance"], ["/tools/thermometer", "Goal Gauge", "A campaign goal bar for your website.", "events"]]} />
    <FinalCta />
  </>;
}

export function ToolLostAndFound() {
  return <>
    <Hero eyebrow="Lost & Found · free tool" crumbs={[["Free tools", "/tools"], ["Lost & Found"]]} h="See who you're <b>about to lose.</b>"
      lede="Drop in a giving export and Lost & Found shows your lapsing donors and what they used to give. It runs entirely in your browser. Nothing is uploaded and nothing is stored."
      photo="kitchen-card" cta2={["Run the free audit", "/lost-and-found"]} />
    <Steps eb="How it works" h="A minute, <b>start to finish.</b>" list={[["Export your gifts", "Any spreadsheet with donor, date and amount."], ["Drop it in", "The audit reads it in your browser. Nothing is uploaded."], ["See who is slipping", "Lapsing donors ranked by what they used to give."]]} />
    <StatBand n={4} />
    <FinalCta />
  </>;
}

const num = v => +v || 0;
const usd = x => "$" + Math.round(x).toLocaleString();
function useFields(init) {
  const [v, setV] = useState(init);
  return [v, k => e => setV({ ...v, [k]: e.target.value })];
}

export function retentionMath(a, b, c) {
  const r = a ? b / a * 100 : 0;
  return { rate: r.toFixed(1) + "%", lift: usd(a * 0.05 * c), more: Math.round(a * 0.05) };
}
export function lapsedMath(a, b, c) {
  return { lost: usd(a * b), back: usd(a * b * c / 100) };
}
export function thermometerMath(g, r) {
  const p = g ? Math.min(100, r / g * 100) : 0;
  return { pct: p, raised: usd(r), goal: usd(g) };
}

export function ToolRetention() {
  const [v, on] = useFields({ a: "1000", b: "420", c: "250" });
  const m = retentionMath(num(v.a), num(v.b), num(v.c));
  return <>
    <Hero eyebrow="Keep Rate calculator" crumbs={[["Free tools", "/tools"], ["Keep Rate calculator"]]} h="What is your <b>retention worth?</b>" lede="Enter last year's donors and how many gave again. See your rate beside the national figure, and what a five-point lift would mean." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
      <div className="form">
        <label>Donors last year<input type="number" min="1" value={v.a} onChange={on("a")} /></label>
        <label>Of those, gave again this year<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
        <label>Average yearly gift ($)<input type="number" min="0" value={v.c} onChange={on("c")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <div className="big">{m.rate}</div><p>your retention, against 43.3% nationally in 2025</p>
        <div className="big sm">{m.lift}</div><p>more each year from a five-point lift ({m.more} more donors giving again)</p>
      </div>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap"><p className="srcnote">National figure: 43.3% overall retention in 2025, <A href={SRC.fep25[1]}>{SRC.fep25[0]}</A>.</p></div></section>
    <FinalCta />
  </>;
}

export function ToolLapsed() {
  const [v, on] = useFields({ a: "580", b: "180", c: "15" });
  const m = lapsedMath(num(v.a), num(v.b), num(v.c));
  return <>
    <Hero eyebrow="Lapse Ledger" crumbs={[["Free tools", "/tools"], ["Lapse Ledger"]]} h="What did last year's lapsed donors <b>used to give?</b>" lede="A quick way to put a dollar figure on the people who quietly stopped." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
      <div className="form">
        <label>Donors who did not give again<input type="number" min="0" value={v.a} onChange={on("a")} /></label>
        <label>Their average yearly gift ($)<input type="number" min="0" value={v.b} onChange={on("b")} /></label>
        <label>Share who might give again after a call (%)<input type="number" min="0" max="100" value={v.c} onChange={on("c")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <div className="big">{m.lost}</div><p>a year, given by donors who stopped</p>
        <div className="big sm">{m.back}</div><p>more a year if {num(v.c)}% give again after a call</p>
      </div>
    </div></section>
    <FinalCta />
  </>;
}

export function ToolThermometer() {
  const [v, on] = useFields({ n: "Spring appeal", g: "50000", r: "31250" });
  const m = thermometerMath(num(v.g), num(v.r));
  return <>
    <Hero eyebrow="Goal Gauge" crumbs={[["Free tools", "/tools"], ["Goal Gauge"]]} h="A goal bar <b>people want to fill.</b>" lede="Set your goal and amount raised and see the bar. The embeddable version comes with the live site." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap tool">
      <div className="form">
        <label>Campaign name<input value={v.n} onChange={on("n")} /></label>
        <label>Goal ($)<input type="number" value={v.g} onChange={on("g")} /></label>
        <label>Raised so far ($)<input type="number" value={v.r} onChange={on("r")} /></label>
      </div>
      <div className="out" aria-live="polite">
        <p style={{ fontWeight: 700, fontSize: 20 }}>{v.n}</p>
        <div className="therm"><span style={{ width: m.pct + "%" }}></span></div>
        <div className="big sm">{m.raised}</div><p>raised of {m.goal} · {m.pct.toFixed(0)}%</p>
      </div>
    </div></section>
    <FinalCta />
  </>;
}

// ── LEGAL (drafts) ─────────────────────────────────────────────────────────
// They ship with the "Draft for attorney review" badge, exactly as the
// reference shows. The live, in-effect documents stay at /privacy and /terms.
function Legal({ t, children }) {
  return <>
    <Crumbs list={[["Company"], [t]]} />
    <section className="hero phero" style={{ paddingBottom: 30 }}><div className="wrap">
      <div className="eyebrow">Legal</div><h1 className="mix h-l">{t}</h1>
      <p className="draft">Draft for attorney review. Not yet in effect.</p>
    </div></section>
    <section style={{ paddingTop: 0 }}><div className="wrap prose narrow">{children}</div></section>
  </>;
}

export function LegalPrivacy() {
  return <Legal t="Privacy policy">
    <h2>Who we are</h2><p>{LEGAL_ENTITY_NAME} ("Steward") provides donor management software to nonprofit organizations. Contact: jonathan@stewardapp.dev.</p>
    <h2>Two kinds of data</h2><p>Organizations that use Steward put information about their donors, volunteers and contacts into the service. That information belongs to the organization, and we process it only to provide Steward to them. Separately, we collect a small amount of information about the people who sign in to Steward, such as name, email and usage, to run the service.</p>
    <h2>Connected accounts</h2><p>When a user connects Google or Microsoft, Steward reads only email and calendar items involving people already in that organization's Steward account, and stores only what is needed to show them on the record. Steward does not use this data for advertising, does not sell it and does not use it to train general artificial intelligence models. Users can disconnect at any time.</p>
    <h2>Sharing</h2><p>We never sell personal information. We share it only with service providers that run Steward on our behalf, such as hosting and email delivery, under contract.</p>
    <h2>Your choices</h2><p>Organizations can export or delete their data at any time. Individuals can contact the organization that holds their information, or us.</p>
    <h2>Changes</h2><p>We will post changes here and tell customers by email.</p>
  </Legal>;
}

export function LegalTerms() {
  return <Legal t="Terms of service">
    <h2>The service</h2><p>Steward provides donor management software on a subscription basis, month to month or yearly.</p>
    <h2>Your data</h2><p>You own the data you put into Steward. You can export it at any time. After cancellation we delete it on request.</p>
    <h2>Payments</h2><p>Plans are billed in advance. Gifts made through Steward forms go to your own payment processor account. Steward charges no platform fee on gifts.</p>
    <h2>Acceptable use</h2><p>Use Steward only for lawful fundraising and organizational purposes, and only with data you have the right to use.</p>
    <h2>Cancellation</h2><p>Cancel any time. Monthly plans end at the close of the current month.</p>
  </Legal>;
}

export function LegalAccessibility() {
  return <Legal t="Accessibility">
    <p>We want everyone who works at a nonprofit, and everyone who gives to one, to be able to use Steward. We design to the Web Content Accessibility Guidelines 2.1 at level AA, test with keyboards and screen readers, and fix what we find.</p>
    <p>If anything in Steward or on this site is hard to use, email jonathan@stewardapp.dev and we will respond within two business days.</p>
  </Legal>;
}


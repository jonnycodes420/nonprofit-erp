// LANDING-4 · the homepage, rebuilt around the approved language
// (docs/MESSAGING.md, read through data/messaging.js): the headline, the
// vision, the six pillars each with a real Harborlight screen, how it works,
// the opening gift, and a word for the careful ones. The PROOF-2 retention
// band and the research strip stay, with their sources.
import { A, Pill, Photo, Portrait, Shot, PillarBand, FaqList, rich } from "../lib";
import { STATS, srcShort, SRC, SRC_ALL } from "../data/research";
import { HOME_FAQ } from "../data/faqs";
import { TEAM } from "../data/team";
import { HEADLINE, UNDER, FEELING, VISION, PILLAR, HOW_INTRO, HOW, HOW_CLOSE, CAREFUL, GIFT, GIFT_TERMS } from "../data/messaging";

// FIX-13 · a static row: the six research cards, each rendered ONCE. The
// marquee this replaced drew three copies and scrolled them, so a visitor
// saw the same card twice at once. Nothing here moves or repeats.
function StatStrip() {
  return (
    <div className="marq-s" aria-label="What the research says">
      <div className="wrap"><div className="eyebrow">What the research says</div>
        <div className="marq"><div className="track">
          {STATS.map(s => (
            <div className="sc" key={s[0]} data-stat={s[0]}><b>{s[0]}</b><p>{s[1]}</p><span><A href={SRC[s[2]][1]} style={{ color: "inherit" }}>{srcShort(s[2])}</A></span></div>
          ))}
        </div></div>
      </div>
    </div>
  );
}

// PROOF-2 · the retention gap, straight after the hero. Every figure is
// Momentive's, worded as the survey words it, and the source line links it.
function RetentionBand() {
  const src = SRC_ALL.momentive25;
  return (
    <section className="gapband" aria-label="Retention is a strategy">
      <div className="wrap">
        <div className="eyebrow">Retention is a strategy, not a hope</div>
        <h2 className="mix h-l" style={{ marginTop: 22, maxWidth: 1100 }}>Nonprofits with a donor retention strategy reported 77% retention. <b>Those without one: 61%.</b></h2>
        <p className="lede" style={{ marginTop: 40 }}>46% have no retention strategy at all. <b>Steward is one, built in.</b></p>
        <div className="gap-how">
          <A href="/features/drift"><b>Drift caught early.</b><span>Each donor is measured against their own rhythm and flagged while a call still fixes it.</span></A>
          <A href="/features/journeys"><b>Journeys planned.</b><span>A first year of thank-yous, updates and asks, with a person named on every step.</span></A>
          <A href="/platform"><b>Who to call, each morning.</b><span>Home names the people who need you today, and why.</span></A>
        </div>
        <p className="srcnote">Source: <A href={src[1]}>{src[0]}</A>, a survey of US nonprofit professionals, February to March 2025. Figures are as respondents reported them.</p>
      </div>
    </section>
  );
}

// "How does it work?" The three steps, then the why-demo as it runs in
// Steward: the question, the reasons, the rows, and planning the calls.
const SEQUENCE = [
  ["why-question", "You ask", "Ask why sits at the top of Home, with the questions people ask most.", "Home's Ask why row, with the question Why did Spring Appeal 2026 come in where it did?"],
  ["why-reasons", "It shows the reasons", "In dollars, largest first: 11 of last year's donors haven't given yet.", "The answer: Spring Appeal 2026 came in $11,650 under last year, with the reasons ranked in dollars"],
  ["why-rows", "Every number opens", "The people behind each reason, with what they gave last time.", "The people behind the answer, each with last year's gift and this year's"],
  ["why-plan", "You plan the calls", "One click puts the calls on your list. Nothing is sent.", "The Plan calls to the top five button, which adds steps for a person and sends nothing"],
];

function HowItWorks() {
  return (
    <section id="how" className="how-s"><div className="wrap">
      <div className="eyebrow">How does it work?</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>{HOW_INTRO.replace(/\.$/, "")}<b>.</b></h2>
      <div className="steps">
        {HOW.map((s, i) => <div className="step" key={s[0]}><span className="sn">{"0" + (i + 1)}</span><h4>{s[0]}</h4><p>{s[1]}</p></div>)}
      </div>
      <div className="seq" aria-label="Ask why, step by step">
        {SEQUENCE.map(([k, h, p, alt], i) => (
          <div className="seq-i" key={k}><Shot k={k} alt={alt} /><b><span>{i + 1}</span>{h}</b><p>{p}</p></div>
        ))}
      </div>
      <p className="lede how-close">{HOW_CLOSE}</p>
    </div></section>
  );
}

// MESSAGING.md's line for the careful ones, split into a heading and its close.
const [C1, C2, C3] = CAREFUL.split(/(?<=\.) /);
const CAREFUL_H = C1 + " <b>" + C2 + "</b>";
const CAREFUL_P = C3;

export default function Home() {
  const founder = TEAM[0];
  return (
    <div id="home">
      <section className="hero">
        <div className="wrap hero-g">
          <div>
            <div className="eyebrow">Steward</div>
            <h1 className="mix h-xl">{rich(HEADLINE)}</h1>
            <p className="lede">{UNDER}</p>
            <div className="ctas">
              <Pill href="/signup">Start now</Pill>
              <Pill kind="soft" href="/demo">Book a call</Pill>
            </div>
          </div>
          <div className="collage">
            <Photo k="desk-phone" cls="p1" eager />
            <Photo k="volunteers-boxes" cls="p2" eager />
            <div className="float feel"><b>{FEELING}</b></div>
          </div>
        </div>
      </section>

      <section className="vision"><div className="wrap">
        <div className="eyebrow">Why we built Steward</div>
        <p className="vision-p">{VISION}</p>
      </div></section>

      <RetentionBand />

      <PillarBand p={PILLAR[1]} tint="brass-tint" link={["/crm", "Steward CRM"]}>
        <Shot k="drift" alt="Home's Drift list in Steward: donors past their own giving pattern, each with what they usually give and a Log the call button" cap="Drift on Home: each donor against their own rhythm." />
        <Shot k="why-reasons" cls="inset" alt="Ask why's answer: Spring Appeal 2026 came in $11,650 under last year, mostly because 11 of last year's donors haven't given yet" cap="Ask why: the reasons, in dollars." />
      </PillarBand>
      <PillarBand p={PILLAR[2]} tint="emerald-tint" flip link={["/agent", "Steward Agent"]}>
        <Shot k="agent-plan" alt="A Steward Agent plan waiting for approval: make Rafael a volunteer and draft a welcome for you to read and send, with Run the plan and Not this one" cap="An Agent plan, waiting for your yes." />
      </PillarBand>
      <PillarBand p={PILLAR[3]} tint="cream" link={["/volunteer", "Steward Volunteer"]}>
        <Shot k="profile" alt="Rafael Quintero-Byrne's profile in Steward: his gifts, 20 hours volunteered, and that he came to an event, on one record" cap="One person: gifts, volunteer hours and an event." />
      </PillarBand>
      <PillarBand p={PILLAR[4]} tint="brass-tint" flip link={["/features/reports", "Reports"]}>
        <Shot k="figure-rows" alt="A figure opened in Steward: Raised for Annual Fund 2026, $1,379,364.56, with the definition and the gifts behind it" cap="Click a figure and the gifts behind it open." />
      </PillarBand>
      <PillarBand p={PILLAR[5]} tint="emerald-tint" link={["/connections", "Connections"]}>
        <Shot k="connections" alt="Steward's Connections settings: Stripe and PayPal connected, and Givebutter flagged because nothing has arrived through it in 64 days" cap="A connection that goes quiet is flagged." />
      </PillarBand>
      <PillarBand p={PILLAR[6]} tint="cream" flip link={["/leadership", "Who builds Steward"]}>
        <div className="partner">
          <Portrait src={founder[2]} name={founder[0]} />
          <div className="partner-c"><b>{founder[0]}</b><span>{founder[1]}</span>
            <ul><li>Month to month</li><li>No platform fee on your gifts</li><li>Email that reaches the founder</li></ul>
          </div>
        </div>
      </PillarBand>

      <HowItWorks />
      <StatStrip />

      <section className="gift-s" style={{ paddingTop: 0 }}><div className="wrap">
        <div className="guide-band">
          <div className="gb-art"><div className="t">Lost &amp;<br /><b>Found</b></div><small>{GIFT_TERMS}</small><span className="leaf"></span></div>
          <div className="gb-txt"><div className="eyebrow">An opening gift</div><h2 className="mix h-m">{rich(GIFT.replace(/^(.*?\.) (.*)$/, "$1 <b>$2</b>"))}</h2>
            <p>{GIFT_TERMS} Drop in a giving export and Lost &amp; Found shows who gave before and hasn't lately. It runs in your browser. Nothing is uploaded and nothing is stored.</p>
            <Pill href="/tools/lost-and-found">Open Lost &amp; Found</Pill></div>
        </div>
      </div></section>

      <section id="faq-home">
        <div className="wrap faq">
          <div><div className="eyebrow">Steward FAQ</div><h2 className="mix h-l" style={{ marginTop: 22 }}>Questions? <b>We've got answers.</b></h2><p style={{ marginTop: 22 }}><A href="/faq" style={{ fontWeight: 700, color: "var(--emerald)" }}>See every question →</A></p></div>
          <div><FaqList items={HOME_FAQ} /></div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="final"><div className="wrap" style={{ paddingBlock: 110 }}>
          <div className="eyebrow">For the careful ones</div>
          <h2 className="mix h-l" style={{ marginTop: 22, maxWidth: 980, marginInline: "auto" }}>{rich(CAREFUL_H)}</h2>
          <p>{CAREFUL_P}</p>
          <div className="ctas" style={{ marginTop: 36 }}><Pill kind="white" href="/demo">Book a call</Pill></div>
        </div></div>
      </section>
    </div>
  );
}

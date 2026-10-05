// LANDING-5 · the homepage, with fewer words and more people. The language is
// still docs/MESSAGING.md's (read through data/messaging.js), cut to a heading
// and one line wherever it can be. Every picture is a person first, with the
// product shown small in a corner. The PROOF-2 retention band and the
// research strip stay, with their sources.
import { A, Pill, Photo, Portrait, PersonPair, PillarBand, FaqList, PriceBlock, rich } from "../lib";
import { STATS, srcShort, SRC, SRC_ALL } from "../data/research";
import { HOME_FAQ } from "../data/faqs";
import { TEAM } from "../data/team";
import { HEADLINE, UNDER, FEELING, VISION_LINE, PILLARS, HOW_SHORT, HOW_CLOSE, CAREFUL, GIFT, GIFT_SHORT } from "../data/messaging";

// The three small chips under the hero buttons.
const HERO_CHIPS = ["Month to month", "No platform fee", "Your whole team"];

// Each pillar's band: its tint, which side the text sits, the link under the
// line, and the picture: a person at work with the Harborlight screen that
// shows the pillar overlapping its corner. Pillar 6 shows the founder's own
// portrait instead, so no stock photo ever stands in for a real person.
const BANDS = {
  1: { tint: "brass-tint", link: ["/crm", "Steward CRM"], photo: "phone-laughing", shot: "inset-drift" },
  2: { tint: "emerald-tint", flip: true, link: ["/agent", "Steward Agent"], photo: "laptop-delighted", shot: "inset-agent", pos: "center top" },
  3: { tint: "cream", link: ["/volunteer", "Steward Volunteer"], photo: "table-papers", shot: "inset-profile" },
  4: { tint: "brass-tint", flip: true, link: ["/features/reports", "Reports"], photo: "reading-letter", shot: "inset-figure", pos: "center bottom" },
  5: { tint: "emerald-tint", link: ["/connections", "Connections"], photo: "trainer-laptop", shot: "inset-connections" },
  6: { tint: "cream", flip: true, link: ["/leadership", "Who builds Steward"] },
};
// Which pillars Home shows. Jonathan picks four (1, 2, 3, 6) or all six.
export const HOME_PILLARS = [1, 2, 3, 4, 5, 6];

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

// PROOF-2 · the retention gap. Every figure is Momentive's, worded as the
// survey words it, and the source line links it.
function RetentionBand() {
  const src = SRC_ALL.momentive25;
  return (
    <section className="gapband" aria-label="Retention is a strategy">
      <div className="wrap">
        <div className="eyebrow">Retention is a strategy, not a hope</div>
        <h2 className="mix h-l" style={{ marginTop: 22, maxWidth: 1100 }}>Nonprofits with a donor retention strategy reported 77% retention. <b>Those without one: 61%.</b></h2>
        <p className="lede" style={{ marginTop: 40 }}>46% have no retention strategy at all. <b>With Steward, you have one from the first day.</b></p>
        <p className="srcnote">Source: <A href={src[1]}>{src[0]}</A>, a survey of US nonprofit professionals, February to March 2025. Figures are as respondents reported them.</p>
      </div>
    </section>
  );
}

function Pillars() {
  const founder = TEAM[0];
  return PILLARS.filter(p => HOME_PILLARS.includes(p.n)).map(p => {
    const b = BANDS[p.n];
    return (
      <PillarBand key={p.n} p={p} tint={b.tint} flip={b.flip} link={b.link}>
        {p.n === 6
          ? <div className="partner">
              <Portrait src={founder[2]} name={founder[0]} />
              <div className="partner-c"><b>{founder[0]}</b><span>{founder[1]}</span>
                <ul><li>Month to month</li><li>No platform fee on your gifts</li><li>Email that reaches the founder</li></ul>
              </div>
            </div>
          : <PersonPair k={b.photo} shot={b.shot} pos={b.pos} />}
      </PillarBand>
    );
  });
}

function HowItWorks() {
  return (
    <section id="how" className="how-s"><div className="wrap how-g">
      <div>
        <div className="eyebrow">How does it work?</div>
        <div className="steps how-steps">
          {HOW_SHORT.map((s, i) => <div className="step" key={s[0]}><span className="sn">{"0" + (i + 1)}</span><h4>{s[0]}</h4><p>{s[1]}</p></div>)}
        </div>
        <p className="lede how-close">{HOW_CLOSE}</p>
      </div>
      <div className="pillar-art" style={{ background: "var(--cream)" }}><PersonPair k="video-call" shot="inset-why" /></div>
    </div></section>
  );
}

// MESSAGING.md's line for the careful ones, split into a heading and its close.
const [C1, C2, C3] = CAREFUL.split(/(?<=\.) /);
const CAREFUL_H = C1 + " <b>" + C2 + "</b>";
const CAREFUL_P = C3;

export default function Home() {
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
            <ul className="hero-chips">{HERO_CHIPS.map(c => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="collage">
            <Photo k="desk-phone" cls="p1" eager />
            <Photo k="volunteers-boxes" cls="p2" eager />
            <div className="float feel"><b>{FEELING}</b></div>
          </div>
        </div>
      </section>

      <section className="vision-line" aria-label="Why we built Steward"><div className="wrap">
        <p className="mix">{rich(VISION_LINE)}</p>
      </div></section>

      <Pillars />
      <RetentionBand />
      <HowItWorks />
      <StatStrip />

      <section className="gift-s" style={{ paddingTop: 0 }}><div className="wrap">
        <div className="guide-band">
          <div className="gb-photo"><Photo k="laptop-coffee" /></div>
          <div className="gb-txt"><div className="eyebrow">An opening gift</div><h2 className="mix h-m">{rich(GIFT.replace(/^(.*?\.) (.*)$/, "$1 <b>$2</b>"))}</h2>
            <p>{GIFT_SHORT}</p>
            <Pill href="/tools/lost-and-found">Open Lost &amp; Found</Pill></div>
        </div>
      </div></section>

      <PriceBlock />

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

// LANDING-3 part 1 · /pricing, in the marketing shell, with the prices on the
// first screen.
//
// WHAT CHANGED AND WHY. On prod this route was the app's own Pricing.jsx: the
// old header, a three-line headline and the tier cards below the fold, so
// clicking Pricing showed everything except the prices. This page is the
// reference's: a short centred heading, one line of lede, the billing toggle,
// then the four cards. At 1440x900 the whole tier row is on the first screen.
//
// IT REPLACES THE APP ROUTE, AND THE CHECKOUT COMES WITH IT. /pricing is not
// only a marketing page: UpgradeModal, goToPricing() and two links in Settings
// send SIGNED-IN organisations here to change plan, and a real customer's
// upgrade runs through it. So the tier card keeps both behaviours it had:
//
//   · a visitor gets Start 30 days free, linking to /signup?plan=<id> so the
//     signup page opens on the band they picked;
//   · a signed-in org gets the same "Choose <tier>" button, which opens
//     Settings, Billing (FIX-22: a checkout started from here failed for an
//     org that already has a subscription), and the same "Your current plan"
//     label on the band it is already on.
//
// Dropping the second one would have made the brief's own words ("keep any
// query parameters the app reads") impossible to honour and broken billing
// for the organisations already paying.
//
// EVERY NUMBER COMES FROM pricing.json, the same list the signup route prices
// against and closeLink.js builds its Stripe plans from. A price on this page
// that disagrees with the price on the card is the defect BUILD-90 shipped a
// Stripe price-check for.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../main";
import PRICING from "../../../../pricing.json";
import { Crumbs, FaqS, FinalCta, Pill, Tick, A, rich } from "../lib";
import { SRC_ALL } from "../data/research";
import { RETENTION_GAP } from "../../../../shared/sources.js";

// PROOF-2 · the line under the prices links to the Keep Rate calculator with
// the survey's two rates filled in, so the claim is checked on her own count.
export const GAP_HREF = "/tools/retention?with=" + RETENTION_GAP.withStrategy + "&without=" + RETENTION_GAP.without;

const TIERS = PRICING.tiers;
const TALK = PRICING.talkToUs;

const money = n => "$" + Number(n).toLocaleString("en-US");
// FIX-13 · the Start link carries the tier AND the interval the toggle shows,
// and SignupPage reads both, so /signup opens on the plan and price she picked.
export const signupHref = (id, yearly) => "/signup?plan=" + id + (yearly ? "&interval=yearly" : "");

function Tier({ t, yearly, authed, orgPlan, busy, onChoose, err }) {
  const isCurrent = authed && orgPlan === t.id;
  const price = yearly ? t.yearlyUsd : t.monthlyUsd;
  return (
    <div className={"tier" + (t.featured ? " pop" : "")} data-tier={t.id}>
      <span className="tag">{t.featured ? PRICING.featuredBadge : "\u00a0"}</span>
      <h3>{t.name}</h3>
      <span className="sz">{t.band}</span>
      <div className="amt" data-price={t.id}>{money(price)}<small> {yearly ? "a year" : "a month"}</small></div>
      <p className="note">{yearly ? PRICING.yearlyNote : PRICING.monthToMonth}</p>
      {isCurrent
        ? <span className="cur" data-testid={"pricing-current-" + t.id}>Your current plan</span>
        : authed
          ? <>
              <button type="button" className="pill pill-ink" data-testid={"pricing-choose-" + t.id}
                disabled={busy} onClick={() => onChoose(t)}><i></i>{busy ? "Starting checkout…" : "Choose " + t.name}</button>
              {err && <p className="err" role="alert">{err}</p>}
            </>
          : <Pill href={signupHref(t.id, yearly)} data-testid={"pricing-start-" + t.id}>{PRICING.startCta}</Pill>}
    </div>
  );
}

export function Pricing() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const authed = !!auth?.token;
  const orgPlan = String(auth?.org?.plan || "");
  const [yearly, setYearly] = useState(false);

  // FIX-22: a signed-in visitor already has an account and a subscription
  // (trial or paid), so a fresh checkout from here failed ("Could not start
  // checkout"). Changing plan is Settings, Billing; this page sends them there.
  function choose() {
    navigate("/app/settings?section=billing");
  }

  return <>
    <Crumbs list={[["Pricing"]]} />
    <div className="price-page">
      <section className="pricing"><div className="wrap">
        <h1 className="mix h-l">Pricing that <b>respects your budget.</b></h1>
        <p className="lede">Every feature on every plan. You pick a size by active donors, and the rest of your history stays in Steward for nothing.</p>
        <div className="toggle" role="group" aria-label="Billing interval">
          <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>{PRICING.yearlyPill}</button>
        </div>
        <div className="tiers">
          {TIERS.map(t => (
            <Tier key={t.id} t={t} yearly={yearly} authed={authed} orgPlan={orgPlan}
              busy={false} onChoose={choose} err={null} />
          ))}
          <div className="tier talk" data-tier={TALK.id}>
            <span className="tag">&nbsp;</span>
            <h3>{TALK.name}</h3>
            <span className="sz">{TALK.band}</span>
            <div className="amt talk-amt">{TALK.copy}</div>
            <p className="note">Same product, priced for your size.</p>
            <Pill kind="soft" href="/demo">{TALK.cta}</Pill>
          </div>
        </div>
        <p className="gapline" data-testid="pricing-gap">The {RETENTION_GAP.withStrategy - RETENTION_GAP.without}-point retention gap is worth more than the subscription. <A href={GAP_HREF}>See the math with your own donor count</A>. <span className="srcnote" style={{ display: "block", marginTop: 8 }}>Gap: <A href={SRC_ALL[RETENTION_GAP.source][1]}>{SRC_ALL[RETENTION_GAP.source][0]}</A></span></p>
      </div></section>
    </div>

    <section className="pricing" style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">What's included</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>{rich(PRICING.includedHeading)}</h2>
      <div className="cards">
        {PRICING.includedGroups.map(g => <div className="card" key={g.name}><h4>{g.name}</h4><p>{g.copy}</p></div>)}
      </div>
      <div className="incl" style={{ marginTop: 34 }}>{PRICING.extras.map(x => <span key={x}><Tick />{x}</span>)}</div>
    </div></section>

    <section><div className="wrap">
      <div className="eyebrow">What counts as active</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>You only pay for <b>people who are giving.</b></h2>
      <p className="lede" style={{ marginTop: 22 }}>{PRICING.activeDonorSentence} Everyone else stays in Steward, searchable and reportable, at no cost.</p>
      <div className="cards">
        {[["Counts", "Gave $50 in March last year."], ["Counts", "No gifts, but volunteered last month."],
          ["Does not count", "Last gave in 2021."], ["Does not count", "A board member's spouse with no activity."]]
          .map(c => <div className="card" key={c[1]}><span className="k">{c[0]}</span><p style={{ color: "var(--ink)", fontSize: 19 }}>{c[1]}</p></div>)}
      </div>
    </div></section>

    <section className="pricing"><div className="wrap">
      <div className="eyebrow">Compare plans</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>Same features. <b>Different file sizes.</b></h2>
      <div className="tbl"><table>
        <thead><tr><th></th>{TIERS.map(t => <th key={t.id}>{t.name}</th>)}<th>{TALK.name}</th></tr></thead>
        <tbody>
          <tr><th>Active donors</th>{TIERS.map(t => <td key={t.id}>{t.maxDonors.toLocaleString("en-US")}</td>)}<td>Over {TALK.band.match(/[\d,]+/)[0]}</td></tr>
          <tr><th>Monthly</th>{TIERS.map(t => <td key={t.id}>{money(t.monthlyUsd)}</td>)}<td>Let's talk</td></tr>
          <tr><th>Yearly (2 months free)</th>{TIERS.map(t => <td key={t.id}>{money(t.yearlyUsd)}</td>)}<td>Let's talk</td></tr>
          {[["People on your team", "No limit"], ["Steward Volunteer", "Included"], ["Steward Agent", "Included"],
            ["Platform fee on gifts", "None"], ["Move done with you", "Yes"]].map(r => (
            <tr key={r[0]}><th>{r[0]}</th>{TIERS.map(t => <td key={t.id}>{r[1]}</td>)}<td>{r[1]}</td></tr>
          ))}
        </tbody>
      </table></div>
    </div></section>

    <FaqS h="Pricing <b>questions.</b>" items={[
      ["Is there a contract?", "No. Month to month, or yearly with two months free. Cancel any time."],
      ["What happens if we grow past our plan?", "We tell you before anything changes, and you move up a plan the next month. Nothing is locked."],
      ["Are there setup fees?", "No. The move and setup are included."],
      ["Does Steward take a percentage of donations?", "No. Your processor's card fee is the only fee on a gift."],
      ["Is there a free trial?", "Yes. Thirty days free, with the move done with you."]]} />
    <FinalCta />
  </>;
}

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
// only a marketing page: UpgradeModal and two links in Settings
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
// LANDING-5 · NO TIERS ON THE MARKETING SITE. The four cards and the compare
// table are gone: one block says where the price starts and that everything
// is included, and the one button is Book a call. Billing, the Stripe prices
// and the in-app plans are unchanged (pricing.json still lists them; the
// signup route and Settings, Billing still read them).
//
// A SIGNED-IN organisation that lands here to change plan (UpgradeModal)
// still gets its way through: one button to Settings, Billing.
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../main";
import PRICING from "../../../../pricing.json";
import { Crumbs, FaqS, FinalCta, PriceBlock, Tick, A, rich } from "../lib";
import { SRC_ALL } from "../data/research";
import { RETENTION_GAP } from "../../../../shared/sources.js";

// PROOF-2 · the line under the price links to the Keep Rate calculator with
// the survey's two rates filled in, so the claim is checked on her own count.
export const GAP_HREF = "/tools/retention?with=" + RETENTION_GAP.withStrategy + "&without=" + RETENTION_GAP.without;

export function Pricing() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const authed = !!auth?.token;

  // FIX-22: a signed-in visitor already has an account and a subscription
  // (trial or paid). Changing plan is Settings, Billing; this page sends them there.
  function choose() {
    navigate("/app/settings?section=billing");
  }

  return <>
    <Crumbs list={[["Pricing"]]} />
    <div className="price-page">
      <PriceBlock h1 />
      {authed && <p className="wrap price-authed"><button type="button" className="pill pill-soft" data-testid="pricing-change-plan" onClick={choose}><i></i>Change your plan in Settings</button></p>}
      <div className="wrap" style={{ paddingBottom: 72 }}><p className="gapline" data-testid="pricing-gap">The {RETENTION_GAP.withStrategy - RETENTION_GAP.without}-point retention gap is worth more than the subscription. <A href={GAP_HREF}>See the math with your own donor count</A>. <span className="srcnote" style={{ display: "block", marginTop: 8 }}>Gap: <A href={SRC_ALL[RETENTION_GAP.source][1]}>{SRC_ALL[RETENTION_GAP.source][0]}</A></span></p></div>
    </div>

    <section className="pricing" style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">What's included</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>{rich("Everything, <b>for your whole team.</b>")}</h2>
      <div className="cards">
        {PRICING.includedGroups.map(g => <div className="card" key={g.name}><h4>{g.name}</h4><p>{g.copy}</p></div>)}
      </div>
      <div className="incl" style={{ marginTop: 34 }}>{PRICING.extras.map(x => <span key={x}><Tick />{x}</span>)}</div>
    </div></section>

    <FaqS h="Pricing <b>questions.</b>" items={[
      ["Is there a contract?", "No. Month to month, or yearly with two months free. Cancel any time."],
      ["What does the price depend on?", "The size of your donor file. We'll tell you the number on the call, and before anything ever changes."],
      ["Are there setup fees?", "No. The move and setup are included."],
      ["Does Steward take a percentage of donations?", "No. Your processor's card fee is the only fee on a gift."],
      ["Is there a free trial?", "Yes. Thirty days free, with the move done with you."]]} />
    <FinalCta />
  </>;
}

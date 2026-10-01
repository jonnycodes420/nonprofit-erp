// LANDING-2 · the Platform menu: the platform overview, the three products,
// Connections, Onboarding, and the features index plus its one template.
import { Hero, Block, Ui, uiOf, Cards, FaqS, Incl, Steps, FinalCta, Related, Icon, featureCard } from "../lib";
import { FEAT, FEATURE_SLUGS, OPEN_API_HREF } from "../data/features";
import { CONNECTIONS } from "../data/connections";

export function Platform() {
  return <>
    <Hero eyebrow="The Steward Platform" crumbs={[["Platform"]]} h="One calm place for <b>the whole office.</b>"
      lede="Donors, gifts, events, volunteers, email and month end, on one record that watches itself. Steward tells you who needs you each morning, and every number opens to the people behind it."
      photo="team-pointing" cta2={["See every feature", "/features"]} proof={["Every feature on every plan", "Unlimited users", "Month to month"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <div className="eyebrow">How it fits together</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>Keep. Raise. <b>Run.</b></h2>
      <Block tint="brass-tint" h="Keep the donors you have." p="Drift alerts measure each donor against their own rhythm. Journeys keep new donors close through their first year. Major gifts and memberships each get their own pipeline, with a person named on every next step."
        sh="Know who needs you." sp="Home shows the handful of people worth a call today, ranked by what is at stake, with the reason in plain words."
        ui={<Ui t="Going quiet" k="drift" rows={[["MC", "Margaret Chen", "Gives $15,000 each August · <em>no gift yet</em>", "Call"], ["WF", "Walter Fairbanks", "Monthly $250 · <em>card failed twice</em>", "Fix card"], ["RT", "Rosalind Thackeray", "<em>14 months since a visit</em>", "Book visit"]]} />} />
      <Block flip tint="emerald-tint" h="Raise more from the same people." p="Giving pages on your brand, events with tickets and seating, peer-to-peer teams and grants, all feeding the same donor record. Gifts land in your own Stripe account."
        sh="No platform fee." sp="Your processor charges its normal card fee. Steward takes nothing from any gift."
        ui={<Ui t="Spring Gala" k="events" tots={[["Tickets sold", "of 220", "204"], ["Sponsors", "8 tables", "$42,500"], ["Raised tonight", "paddle raise", "$18,350", 1], ["Guests not yet thanked", "next step", "31"]]} />} />
      <Block tint="cream" h="Run the office without the spreadsheets." p="Receipts and year-end statements in a batch. A monthly gift file for your bookkeeper that foots to the cent. Volunteers, shifts and hours on the same record as giving. An audit log for everything."
        sh="Every number opens." sp="Click any total on any screen and see the gifts behind it. The board gets numbers you can defend."
        ui={<Ui t="Month end · September" k="finance" tots={[["Gifts recorded", "all sources", "412"], ["Stripe payouts", "matched", "$31,204.55", 1], ["Fees", "card processing", "$912.10"], ["Bookkeeper file", "ready", "Download"]]} />} />
    </div></section>
    <Cards eb="Explore the platform" h="Three products, <b>one record.</b>" list={[["/crm", "Steward CRM", "The donor record, drift, journeys, major gifts, forms, events and reports.", "people"], ["/volunteer", "Steward Volunteer", "Shifts, waitlists, kiosk check-in, waivers and hours.", "hand"], ["/agent", "Steward Agent", "Six assistants that draft and organize, then wait for your yes.", "spark"], ["/connections", "Connections", "Keep your giving tools. Steward watches every one.", "link"], ["/move", "Moving to Steward", "About a day of your time, matched to the cent.", "import"], ["/onboarding", "Onboarding and support", "A named person for the move and the first month.", "check"]]} />
    <FinalCta />
  </>;
}

export function Crm() {
  return <>
    <Hero eyebrow="Steward CRM" crumbs={[["Platform", "/platform"], ["Steward CRM"]]} h="Keep more donors, <b>without more staff.</b>"
      lede="A donor CRM built for a development team of one to five. It shows you who is drifting while a call still fixes it, keeps new donors close through their first year, and gives the board numbers that open to the people behind them."
      photo="phone-laughing" proof={["Move in about a day", "No platform fee", "Unlimited users"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="brass-tint" h="The donor record, finally complete." p="Gifts, pledges, recurring plans, soft credits, households, emails, events, volunteer hours and notes on one page. The right rail shows lifetime giving, the last gift and the next step at a glance."
        sh="Households and soft credits." sp="Couples give together and get thanked together. Donor-advised funds and peer-to-peer credit the person who made it happen."
        ui={<Ui t="Margaret Chen" k="people" rows={[["$", "Lifetime giving", "Since 2017 · 9 years in a row", "$61,200", "c"], ["✉", "Last email", "Thursday · replied in 2 hours", "Open"], ["→", "Next step", "Coffee on Tuesday · Dana", "Brief"]]} />} />
      <Block flip tint="emerald-tint" h="Drift you can act on." p="Each donor is measured against their own rhythm, not a generic rule. A monthly card that failed, an annual donor past their month, a major donor with no visit in a year. Ranked by what is at stake."
        sh="Journeys that run on time." sp="A first year of thank-yous, updates, visits and asks on a schedule, with a person named on every step and staff doing the sending."
        ui={<Ui t="Drift this week" k="drift" rows={[["WF", "Walter Fairbanks", "Monthly $250 · <em>card failed twice</em>", "Fix card"], ["HC", "Hope Community Church", "Quarterly $992 · <em>missed June</em>", "Write"], ["JL", "Joan Laramie", "Annual $1,200 · <em>3 weeks past her month</em>", "Call"]]} />} />
      <Block tint="cream" h="Reports where every number opens." p="Retention, LYBUNT and SYBUNT, gifts by fund and source, campaign progress and board summaries. Click any figure and see the gifts behind it."
        sh="No mystery math." sp="If a number is on the screen, you can explain it to your treasurer in one click."
        ui={<Ui t="Retention · this year" k="reports" tots={[["Donors last year", "2025", "1,184"], ["Gave again", "so far", "702"], ["Retention", "to date", "59.3%", 1], ["LYBUNT", "worth a call", "482"]]} />} />
    </div></section>
    <Cards eb="Everything in Steward CRM" h="Every feature, <b>every plan.</b>" list={["drift", "journeys", "major-gifts", "forms", "events", "p2p", "grants", "memberships", "reports", "receipts", "import", "audit"].map(featureCard)} />
    <FaqS items={[["Is Steward CRM priced per user?", "No. Every plan includes unlimited users. Pricing is based on active donors, anyone with a gift or activity in the last 24 months."], ["Can we keep our current giving tools?", "Yes. Steward connects to the giving tools you already use. Our own giving pages are included if you want them."], ["How long does it take to move in?", "About a day of your time for most organizations. We do the move with you and every total is checked to the cent."]]} />
    <FinalCta />
  </>;
}

export function Volunteer() {
  return <>
    <Hero eyebrow="Steward Volunteer" crumbs={[["Platform", "/platform"], ["Steward Volunteer"]]} h="Count every hour, <b>thank every helper.</b>"
      lede="Recruit, schedule and thank volunteers on the same record as giving. See which volunteers also give and which donors also serve, and hand your grant reports real hours instead of guesses."
      photo="aprons-produce" proof={["Kiosk and phone check-in", "Waivers on file", "Included on every plan"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="emerald-tint" h="Shifts that fill themselves." p="Post shifts with roles and capacity, open a waitlist when a shift fills, and let groups sign up together. Volunteers pick their own shifts from a simple page."
        ui={<Ui t="Saturday pantry" k="events" rows={[["AM", "Morning sort", "8 of 10 filled", "2 open"], ["PM", "Distribution", "12 of 12 filled", "Waitlist 3", "c"], ["GR", "Grace Church youth", "Group of 9", "Confirmed", "c"]]} />} />
      <Block flip tint="brass-tint" h="Check in from a tablet or a phone." p="Set a tablet by the door as a kiosk, or let volunteers check in from their own phones. Hours are counted automatically from check-in to check-out."
        sh="Waivers and background checks." sp="Signed waivers are stored on the person, and background-check dates are tracked so you know who is due."
        ui={<Ui t="Kiosk · today" k="hand" tots={[["Checked in", "this morning", "14"], ["Hours this month", "all programs", "612.5", 1], ["Waivers missing", "before next shift", "2"], ["Checks due", "within 30 days", "3"]]} />} />
      <Block tint="cream" h="Volunteers who give, givers who serve." p="One person, one record. A volunteer who gives shows up in your donor lists. A donor who serves gets thanked for both. Volunteer hours appear on the profile beside gifts." photo="high-five-checkin" />
    </div></section>
    <Incl h="Everything Steward Volunteer <b>does today.</b>" list={["Shifts with roles and capacity", "Waitlists when a shift fills", "Group sign-ups", "Kiosk check-in on a tablet", "Check-in from a phone", "Hours counted automatically", "Signed waivers on the person", "Background-check dates tracked", "Hours reports for grants", "Coordinator logins with their own access", "Volunteer and giving on one record", "Thank-you lists by hours served"]} />
    <FaqS items={[["Is Steward Volunteer a separate subscription?", "No. It is included on every Steward plan."], ["Can a volunteer coordinator log in without seeing donor giving?", "Yes. Coordinators get their own sign-in that is scoped to volunteers."], ["Does Steward run background checks?", "Not today. Steward tracks the dates of checks you run with your existing provider so you know who is due."]]} />
    <FinalCta />
  </>;
}

const AGENTS = [["Writer", "Thank-yous, appeals and updates in your voice, from the donor's own history."], ["Researcher", "Briefs before a visit: giving, notes, emails and what changed since you last met."], ["Analyst", "Plain answers about your file, with every number linked to its rows."], ["Recurring", "Finds failed cards and paused plans and drafts the note to fix them."], ["Onboarding", "Builds a first-year journey for each new donor and names who owns each step."], ["Data", "Finds duplicates, fixes addresses and tidies records, all shown before it changes anything."]];

export function Agent() {
  return <>
    <Hero eyebrow="Steward Agent" crumbs={[["Platform", "/platform"], ["Steward Agent"]]} h="Say what you need. <b>Approve the plan.</b>"
      lede="Six assistants that read your whole file, show you exactly what they intend to do and wait for your yes. They draft and organize. They never send to a donor and never touch money."
      photo="laptop-coffee" proof={["Plan first, then approve", "Every action can be undone", "Never sends on its own"]} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="brass-tint" h="A plan you can read before anything happens." p={"Ask for \"thank-you drafts for everyone who gave over $500 this week\" and the Agent shows the list, the drafts and the steps. You change what you want, then approve."}
        ui={<Ui t="Agent · plan" k="spark" rows={[["1", "Find gifts over $500", "Since Monday · 23 donors", "Done", "c"], ["2", "Draft thank-you letters", "In your voice, signed by Dana", "Review"], ["3", "Add a call task for 4 board prospects", "Assigned to Dana", "Review"]]} />} />
      <Block flip tint="emerald-tint" h="Every action recorded, every action reversible." p="Whatever the Agent does is in the audit log with who approved it. Changed your mind? Undo it from the same screen." photo="team-pointing-wide" />
    </div></section>
    <section className="pricing"><div className="wrap">
      <div className="eyebrow">Six assistants</div>
      <h2 className="mix h-l" style={{ marginTop: 22 }}>One engine, <b>six jobs.</b></h2>
      <div className="cards">{AGENTS.map(a => <div className="card" key={a[0]}><span className="ci"><Icon k="spark" size={26} /></span><h4>{a[0]}</h4><p>{a[1]}</p></div>)}</div>
    </div></section>
    <FaqS items={[["Will the Agent email our donors?", "Never on its own. It drafts. Your staff review and send."], ["Can it move money or change a gift?", "No. The Agent never touches payments, and gift changes go through the normal screens with the audit log."], ["Is the Agent included?", "Yes, on every plan."]]} />
    <FinalCta />
  </>;
}

export function Connections() {
  return <>
    <Hero eyebrow="Connections" crumbs={[["Platform", "/platform"], ["Connections"]]} h="Keep your tools. <b>Steward watches them.</b>"
      lede="Gifts flow in from the giving tools you already use. Steward checks every payout against its gifts and tells you the day a connection goes quiet, before a month of gifts goes missing."
      photo="desk-notes" />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint="cream" h="A quiet connection is a warning." p="If a tool that usually sends four gifts a week sends none for twelve days, Steward flags it on Home. Most lost gifts are a broken connection nobody noticed."
        ui={<Ui t="Connections" k="link" rows={[["St", "Stripe", "142 gifts · $18,240 this month", "Healthy", "c"], ["Pp", "PayPal", "37 gifts · $2,915", "Healthy", "c"], ["Gb", "Givebutter", "Usually 4 a week · none in 12 days", "Quiet", "q"]]} />} />
    </div></section>
    <section className="pricing"><div className="wrap">
      <div className="eyebrow">Every connection, honestly labeled</div>
      <h2 className="mix h-m" style={{ marginTop: 22 }}>What works today, <b>and what is next.</b></h2>
      <p className="lede" style={{ marginTop: 18 }}>Live means you can switch it on yourself. Set up with you means it works and we connect it on your onboarding call. Coming means it is being built.</p>
      <div className="conn">
        {CONNECTIONS.map(c => {
          const k = c[2] === "Live" ? "" : c[2] === "Coming" ? " soon" : " q";
          return <div className="cn" key={c[0]} id={c[0] === "Open API" ? "api" : undefined}><div><b>{c[0]}</b><span>{c[1]}</span></div><span className={"chip" + k}>{c[2]}</span></div>;
        })}
      </div>
    </div></section>
    <FaqS items={[["Do we have to stop using our giving platform?", "No. Keep it. Steward pulls the gifts in and watches the connection."], ["What does Steward read from my inbox?", "Only emails with people who are already in Steward. Everything else is ignored, and you can pause or hide any thread."], ["Can our developer build on Steward?", "Yes. The open API has scoped keys and webhooks. See the developer page."]]} />
    <FinalCta />
  </>;
}

export function Onboarding() {
  return <>
    <Hero eyebrow="Onboarding and support" crumbs={[["Platform", "/platform"], ["Onboarding and support"]]} h="Your move, <b>done with you.</b>"
      lede="Every new organization gets a real person for the move, the setup and the first month. You will know their name and their email address."
      photo="trainer-laptop" cta2={["How the move works", "/move"]} />
    <Steps eb="Your first 30 days" h="Four steps <b>to settled.</b>" list={[["Kickoff call", "Twenty minutes. We look at where your donors live today and what you need first."], ["The move", "You export, we map it with you, and the Move Report checks every total to the cent."], ["Connect your tools", "Stripe, Mailchimp, your inbox and the rest, connected together on a call."], ["First month check-in", "We review drift, journeys and your first month-end file together."]]} />
    <Incl eb="Included" h="What every organization <b>gets.</b>" list={["A named person for the move", "Mapping of your old fields", "Connections set up on a call", "Thirty days free while you settle in", "Staff training on a call", "Email answers from a person", "Your data exported any time", "Undo the move for 30 days"]} />
    <FinalCta />
  </>;
}

export function Features() {
  return <>
    <Hero eyebrow="Features" crumbs={[["Features"]]} h="Everything included, <b>nothing to unlock.</b>" lede="Every feature is on every plan. No add-ons, no premium tier and no surprise invoice when you grow." />
    <Cards list={FEATURE_SLUGS.map(featureCard).concat([["/volunteer", "Steward Volunteer", "Shifts, hours, waivers and kiosk.", "hand"], ["/agent", "Steward Agent", "Six assistants that draft, then wait for your yes.", "spark"], [OPEN_API_HREF, "Open API", "Scoped keys and webhooks.", "code"]])} />
    <FinalCta />
  </>;
}

// The one template for all fourteen feature pages.
export function Feature({ slug }) {
  const f = FEAT[slug];
  return <>
    <Hero eyebrow={f.name} crumbs={[["Features", "/features"], [f.name]]} h={f.h} lede={f.lede} photo={f.photo} />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="problem"><span className="eyebrow">The problem</span><p>{f.problem}</p></div></div></section>
    <Steps eb="How it works" h="Three steps, <b>no manual.</b>" list={f.steps} />
    <section style={{ paddingTop: 0 }}><div className="wrap">
      <Block tint={["brass-tint", "emerald-tint", "cream"][slug.length % 3]} h="What it looks like." p="A real screen from Steward with example data." ui={uiOf(f.ui)} />
    </div></section>
    <Incl h={f.name + ", <b>included.</b>"} list={f.incl} />
    {f.faq && <FaqS items={f.faq} />}
    <Related slugs={f.rel || ["drift", "journeys", "reports"]} />
    <FinalCta />
  </>;
}


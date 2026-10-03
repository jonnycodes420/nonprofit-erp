// CONTENT-1 · the glossary, in ONE module: every term's definition, why it
// matters, the arithmetic when it is a number, how Steward shows it, three
// related terms and two articles or tools. /glossary lists them and each one
// has its own page at /glossary/<slug> (routes.js reads this list).
//
// Percentages live only inside a term's `calc` block, which is worked example
// arithmetic, not a statistic: the PROOF-2 guard strips those blocks. Any
// other figure must be a claim in shared/sources.js, named in `src`.
export const GLOSSARY = [
  {
    slug: "lybunt",
    term: "LYBUNT",
    aka: "Last year but unfortunately not this year",
    def: "LYBUNT stands for \"last year but unfortunately not this year.\" It is a donor who gave to you last year and has not given yet this year.",
    why: [
      "Your LYBUNT list is the most valuable call list you have. These people chose you a few months ago. They know your work, and most of them have simply not been asked, thanked or reminded since. A personal note or a short call before your year ends costs little and keeps a relationship from going cold.",
      "Pull the list early, not in the last week of December. Sort it by what each person gave last year, start at the top, and split it across your team and board. Every name you reach before the year closes is one less donor to find from scratch next year.",
    ],
    steward: [
      "In Steward, Reports has a group called Who stopped giving, and LYBUNT is in it. It lists each donor with what they gave last year, their last gift, their lifetime giving, who they are assigned to and their email, and it totals how much of last year's giving is at stake. Download it as a CSV or a PDF.",
      "A soft credit never moves anyone on or off the list. Only a donor's own gifts count.",
    ],
    related: ["sybunt", "lapsed-donor", "donor-retention-rate"],
    see: ["/tools/lybunt-sybunt", "/articles/lybunt-sybunt-before-year-end"],
  },
  {
    slug: "sybunt",
    term: "SYBUNT",
    aka: "Some year but unfortunately not this year",
    def: "SYBUNT stands for \"some year but unfortunately not this year.\" It is a donor who gave in some past year, but not last year and not yet this year.",
    why: [
      "SYBUNT donors have been quiet longer than LYBUNT donors, so they need a different approach. A plain appeal often misses. A note that names their last gift and tells them what it made possible gives them a reason to read on.",
      "The list also tells you how leaky your file is. If your SYBUNT list is long and full of people who gave once, the gap is usually in what happens after a first gift. That is the place to fix first, because each new name costs far more to find than an old one costs to keep.",
    ],
    steward: [
      "SYBUNT sits next to LYBUNT under Who stopped giving in Steward's Reports. It lists everyone who has given before but not this year, with their last gift, lifetime giving and owner, and it downloads as a CSV or a PDF.",
    ],
    related: ["lybunt", "reactivation", "lapsed-donor"],
    see: ["/tools/lybunt-sybunt", "/articles/lybunt-sybunt"],
  },
  {
    slug: "donor-retention-rate",
    term: "Donor retention rate",
    def: "Donor retention rate is the share of last year's donors who gave again this year. It is the clearest single measure of whether your donors stay with you.",
    why: [
      "Finding a new donor takes far more time and money than keeping one you have. When your retention rate slips, you have to raise more just to stand still. When it rises, every other number on your board report gets easier.",
      "Read it in two parts. First-year donors and repeat donors behave very differently, so one blended rate can hide a problem. Track both, compare each year with the one before, and pick one change to make, such as a faster thank-you or a second touch within ninety days.",
    ],
    calc: {
      formula: "Donor retention rate = donors who gave last year and again this year ÷ donors who gave last year × 100",
      example: [
        "Last year 300 donors gave.",
        "This year 126 of those same 300 gave again.",
        "126 ÷ 300 × 100 = 42%. Your donor retention rate is 42%.",
      ],
    },
    steward: [
      "Steward's Retention report, under Who stopped giving in Reports, shows each year's prior-year donors, how many were retained, the rate, the share of last year's dollars that came back, and first-year retention. You can read it by calendar year, fiscal year or the last twelve months, and clicking a figure opens the donors behind it.",
    ],
    related: ["first-year-retention", "repeat-donor-retention", "attrition"],
    see: ["/tools/retention", "/articles/donor-retention-rate"],
  },
  {
    slug: "first-year-retention",
    term: "First-year retention",
    aka: "New donor retention",
    def: "First-year retention is the share of donors who gave for the first time last year and then gave again this year. It measures how well you turn a first gift into a second one.",
    why: [
      "Your first-year donors are the group you are most likely to lose. They gave once, often in response to one appeal, and they do not know you yet. What you do in the first few months decides whether they become regular donors or a name you never hear from again.",
      "The fixes are simple and repeatable: a thank-you within a couple of days, a call or note from a real person, a short update on what their gift did, and a second ask that is not rushed. Write that plan down once and run it for every new donor.",
    ],
    calc: {
      formula: "First-year retention = new donors from last year who gave again this year ÷ all new donors from last year × 100",
      example: [
        "Last year 80 people gave to you for the first time.",
        "This year 20 of those 80 gave again.",
        "20 ÷ 80 × 100 = 25%. Your first-year retention is 25%.",
      ],
    },
    steward: [
      "Steward's Retention report shows first-year donors and first-year retention for each year beside the overall rate. Journeys includes a New donor, first year starting point that puts each step in front of your team. Every step waits for a person, and nothing is sent on its own.",
    ],
    related: ["donor-retention-rate", "repeat-donor-retention", "donor-journey"],
    see: ["/guides/first-year-retention", "/articles/first-year-donor-plan"],
  },
  {
    slug: "repeat-donor-retention",
    term: "Repeat donor retention",
    def: "Repeat donor retention is the share of your repeat donors, people who gave last year and in at least one year before that, who gave again this year.",
    why: [
      "Repeat donors are the steady core of your file. They stay at a much higher rate than first-year donors, which is exactly why a drop here deserves attention. When a long-time donor stops, it is rarely an accident. Something changed, and a personal call usually tells you what.",
      "Tracking repeat retention apart from first-year retention also keeps your overall rate honest. A good year of new donors can mask a slow loss of loyal ones, and the reverse is true too.",
    ],
    calc: {
      formula: "Repeat donor retention = repeat donors from last year who gave again this year ÷ all repeat donors from last year × 100",
      example: [
        "Last year 220 donors had also given in an earlier year.",
        "This year 154 of those 220 gave again.",
        "154 ÷ 220 × 100 = 70%. Your repeat donor retention is 70%.",
      ],
    },
    steward: [
      "Steward's Retention report shows overall and first-year retention side by side for each year, and clicking a figure opens the donors behind it. Drift on Home flags a regular donor who has gone quiet past their own giving pattern, before they lapse.",
    ],
    related: ["donor-retention-rate", "first-year-retention", "drift"],
    see: ["/articles/read-retention", "/articles/second-gift"],
  },
  {
    slug: "donor-lapse",
    term: "Donor lapse",
    def: "Donor lapse is the moment a donor stops giving for longer than you would expect, usually a full year or more without a gift. The donor is then called lapsed.",
    why: [
      "Lapse is rarely a decision. Most donors drift away because nobody thanked them well, nobody told them what their gift did, or nobody asked again. That means a lot of lapse can be prevented if you notice the quiet early.",
      "Decide what lapse means for your organization and write it down. Twelve months without a gift is the common rule for annual donors. A monthly donor whose card fails, or a major donor who usually gives every spring, needs a much shorter clock.",
    ],
    steward: [
      "Steward watches each donor against their own giving pattern. Drift on Home lists the people who have gone quiet past their usual rhythm, so you can call before they lapse. When a donor does stop, Steward moves them to the Lapsed stage and logs the move on their timeline.",
    ],
    related: ["lapsed-donor", "drift", "attrition"],
    see: ["/tools/lost-and-found", "/articles/no-retention-strategy"],
  },
  {
    slug: "lapsed-donor",
    term: "Lapsed donor",
    def: "A lapsed donor is someone who gave to your organization in the past but has not given within the period you expect, most often twelve months or more.",
    why: [
      "Lapsed donors already know you, which makes them easier to reach than strangers. Many will give again if someone asks them personally and tells them what has happened since their last gift.",
      "Sort your lapsed list by how recently each person gave and how much. A donor who lapsed last spring after five years of giving is a phone call. A donor who gave once, eight years ago, is a light-touch letter at most. Spend your time where the relationship is warmest.",
    ],
    steward: [
      "Steward moves a donor who has stopped giving to the Lapsed stage on its own and logs the move. It skips anyone with an open ask or anyone an officer moved forward since their last gift. A view on the Donors list gathers your lapsed donors, and the LYBUNT and SYBUNT reports list them with their history.",
    ],
    related: ["donor-lapse", "reactivation", "sybunt"],
    see: ["/tools/lapsed-cost", "/articles/lybunt-sybunt"],
  },
  {
    slug: "reactivation",
    term: "Reactivation",
    aka: "Lapsed donor reactivation",
    def: "Reactivation is when a lapsed donor gives again after a gap, usually a year or more. It also names the outreach you do to make that second start happen.",
    why: [
      "A reactivated donor is worth treating like a new one. They have just told you they still care, but the habit is fragile. Thank them quickly and personally, mention that you noticed they came back, and plan a second touch.",
      "Reactivation works best when it is specific. Name the last gift, say what it did, and tell them what is different now. Asking every lapsed donor the same way, every year, teaches them to ignore you.",
    ],
    steward: [
      "When a donor at the Lapsed stage gives again, Steward moves them out of Lapsed automatically and logs that move on their timeline, so the team can see who just came back and thank them properly.",
    ],
    related: ["lapsed-donor", "sybunt", "stewardship"],
    see: ["/tools/lapsed-cost", "/articles/thank-you-call"],
  },
  {
    slug: "donor-lifetime-value",
    term: "Donor lifetime value",
    aka: "LTV",
    def: "Donor lifetime value is the total amount a donor is likely to give over the whole time they support you. You estimate it from their average gift, how often they give and how long they stay.",
    why: [
      "Lifetime value shows why keeping donors matters more than any single appeal. A modest gift from someone who stays for years adds up to far more than a large gift from someone who never gives again.",
      "It also tells you what you can sensibly spend to find and keep a donor. If an average donor is worth about a thousand dollars over their life with you, a few dollars on a thank-you call is an easy decision.",
    ],
    calc: {
      formula: "Donor lifetime value = average gift × gifts per year × years retained",
      example: [
        "Your average gift is $100.",
        "Your donors give 2 times a year.",
        "They stay with you for 5 years.",
        "$100 × 2 × 5 = $1,000. Each donor is worth about $1,000 over their life with you.",
      ],
    },
    steward: [
      "Every donor profile in Steward shows their Lifetime giving in the header, and clicking it opens the gifts behind it. The Donors list shows lifetime giving for each person, and Top donors in Reports ranks them by it.",
    ],
    related: ["average-gift", "donor-retention-rate", "recurring-gift"],
    see: ["/tools/retention", "/articles/state-of-retention"],
  },
  {
    slug: "average-gift",
    term: "Average gift",
    aka: "Average gift size",
    def: "Average gift is the total amount given in a period divided by the number of gifts in that period. It tells you what a typical gift to your organization looks like.",
    why: [
      "Average gift helps you set ask amounts, plan an appeal and spot a shift in your file. If it climbs while your donor count falls, you may be leaning on a few bigger donors. If it falls, you may have added many small first-time gifts.",
      "Do not mix it up with average giving per donor, which divides total dollars by the number of donors instead of the number of gifts. A donor who gives every month is one donor but twelve gifts, so the two numbers can be very different.",
    ],
    calc: {
      formula: "Average gift = total dollars given in the period ÷ number of gifts in the period",
      example: [
        "Last year you received 400 gifts.",
        "Together they came to $48,000.",
        "$48,000 ÷ 400 = $120. Your average gift is $120.",
      ],
    },
    steward: [
      "In Steward, each group page shows its people's average gift beside what they gave this fiscal year and how many gifts that is. Click any of those numbers to see the gifts behind it.",
    ],
    related: ["donor-lifetime-value", "gift-range-chart", "major-gift"],
    see: ["/articles/read-retention", "/tools/retention"],
  },
  {
    slug: "gift-range-chart",
    term: "Gift range chart",
    aka: "Gift table",
    def: "A gift range chart is a table that lists how many gifts you need at each size, and how many prospects you need for them, to reach a campaign goal.",
    why: [
      "A gift range chart turns a goal into a plan. It shows the board that a campaign is won or lost on a handful of top gifts, and it tells you how many names you need at each level before you announce anything.",
      "Build it from your own file. If you cannot list enough real prospects for the top rows, lower the goal or spend more time on cultivation first. A chart that rests on hope is not a plan.",
    ],
    calc: {
      formula: "Start with a lead gift of about 20% of the goal. At each lower level, halve the gift size and double the number of gifts until the rows add up to the goal. Plan for 3 to 4 prospects for each gift you need.",
      example: [
        "Goal: $100,000.",
        "1 gift of $20,000 = $20,000 (3 to 4 prospects).",
        "2 gifts of $10,000 = $20,000 (6 to 8 prospects).",
        "4 gifts of $5,000 = $20,000 (12 to 16 prospects).",
        "8 gifts of $2,500 = $20,000 (24 to 32 prospects).",
        "20 gifts of $1,000 = $20,000 (60 to 80 prospects).",
        "35 gifts in total reach $100,000.",
      ],
    },
    steward: [
      "Steward does not build a gift range chart for you. Each campaign carries its goal, with what has been raised and what has been pledged shown as separate figures, and Top donors in Reports helps you list who could fill each row.",
    ],
    related: ["capital-campaign", "major-gift", "capacity"],
    see: ["/tools/thermometer", "/guides/major-donor-visits"],
  },
  {
    slug: "moves-management",
    term: "Moves management",
    def: "Moves management is a structured way to plan and log each deliberate step, or move, that brings a donor closer to a gift: from identifying them, through cultivation and the ask, to stewardship after.",
    why: [
      "Major gifts rarely happen by accident. They come from a series of planned contacts, each with a purpose. Moves management makes those steps visible, so nobody waits a year for a follow-up and nobody gets asked before they are ready.",
      "For a small team, the discipline matters more than the software. Know each top prospect's stage, write down the next move and its date, and review the list every week.",
    ],
    steward: [
      "Steward has a major gifts pipeline under Fundraising. Moving a donor from one stage to the next asks what happened, and that note is saved as a move on their timeline. Steward may suggest a move, but it never moves a donor forward on its own. The officer decides.",
    ],
    related: ["portfolio", "cultivation", "major-gift"],
    see: ["/guides/major-donor-visits", "/articles/thank-you-call"],
  },
  {
    slug: "portfolio",
    term: "Portfolio",
    aka: "Caseload",
    def: "A portfolio is the group of donors and prospects assigned to one fundraiser, who is responsible for building a personal relationship with each of them.",
    why: [
      "A portfolio makes ownership clear. Every important donor has one name next to them, so calls get made and nobody hears from three different staff members in the same week.",
      "Keep it small enough that you can actually know each person. Review it each quarter, move out people who have not responded, and add the donors whose giving or engagement says they are ready for more attention.",
    ],
    steward: [
      "In Steward, assigning a donor to an officer is what puts them in that officer's portfolio. The pipeline can show your own portfolio or everyone's once two or more officers hold donors, and only admins can see other officers' portfolios. Donor history is still shared across the whole team.",
    ],
    related: ["moves-management", "major-gift", "capacity"],
    see: ["/guides/major-donor-visits", "/articles/no-retention-strategy"],
  },
  {
    slug: "major-gift",
    term: "Major gift",
    def: "A major gift is a gift large enough that your organization handles it personally, with visits, a tailored ask and close stewardship. The dollar threshold is set by each organization, not by the sector.",
    why: [
      "For a small shop, a major gift might be $1,000 or $10,000. What matters is that you pick a number based on your own file and treat everyone above it differently: a personal thank-you from the director, a real conversation about impact, and a plan for the next gift.",
      "Major gifts usually come from donors who have given smaller amounts for years. Watch your loyal mid-level donors closely. They are often your next major donors.",
    ],
    steward: [
      "When you set up a Major donor journey in Steward, it asks what a big gift is for you and fills in a suggestion from your own gift history, with the gifts behind it one click away. A major donor journey outranks the first-year welcome, so a large first gift is treated as a major gift first.",
    ],
    related: ["moves-management", "portfolio", "planned-gift"],
    see: ["/guides/major-donor-visits", "/articles/thank-you-call"],
  },
  {
    slug: "planned-gift",
    term: "Planned gift",
    aka: "Legacy gift",
    def: "A planned gift is a gift a donor arranges now that usually reaches you later, most often through a will, a trust, or a beneficiary designation on a retirement account or life insurance policy.",
    why: [
      "Planned gifts often come from loyal, modest donors rather than your largest ones. People who have given steadily for years are the best prospects, and many would say yes if someone simply asked.",
      "Start small. Add a line about leaving a gift in your will to your newsletter and website, and thank anyone who tells you they have done it. The details of trusts and annuities belong with the donor's own advisor, so check with your accountant or an attorney before you promise anything.",
    ],
    steward: [
      "Each donor profile in Steward has a Planned giving line where you mark a confirmed planned gift, a planned-giving prospect or estate giving. There is also a Planned Giving list for the type, such as a bequest or a charitable remainder trust, and an estimated value.",
    ],
    related: ["major-gift", "stewardship", "gift-acceptance-policy"],
    see: ["/guides/major-donor-visits", "/articles/state-of-retention"],
  },
  {
    slug: "soft-credit",
    term: "Soft credit",
    def: "A soft credit recognizes a person who influenced or arranged a gift that someone else legally made, such as a spouse, a peer-to-peer fundraiser, or the donor who recommended a donor-advised fund grant.",
    why: [
      "Soft credits let you see the full picture of a relationship without counting money twice. The person who raised $2,000 on a peer-to-peer page did not give $2,000, but they deserve a thank-you that says they made it happen.",
      "Keep the rule simple. The dollars belong to the hard credit donor and go on their tax receipt. The soft credit is recognition only, so it never belongs in your financial totals.",
    ],
    steward: [
      "When you add a gift in Steward you can soft credit a person already on file. The donor profile shows their own giving and their giving with soft credit as two labelled figures, lists the gifts behind it, and shows what they raised on a fundraising page.",
      "A soft credit never changes a donor's lifetime total, last gift or LYBUNT standing, and the bookkeeper export leaves it out because it is not money.",
    ],
    related: ["hard-credit", "peer-to-peer-fundraising", "donor-advised-fund"],
    see: ["/articles/thank-you-call", "/articles/read-retention"],
  },
  {
    slug: "hard-credit",
    term: "Hard credit",
    def: "Hard credit is the credit for a gift given to the legal donor, the person or organization whose money it was. The hard credit donor is the one who receives the tax receipt.",
    why: [
      "Hard credit keeps your numbers honest. Each gift counts once, on one donor, so your totals match the bank and your accountant. A gift from a family foundation or a donor-advised fund is hard credited to that fund, even when a person you know recommended it.",
      "Getting this right protects your receipts. A tax receipt belongs to the hard credit donor, and anyone else connected to the gift gets a soft credit and a thank-you instead.",
    ],
    steward: [
      "Steward counts every gift once, on the person or organization whose money it was. The donor profile shows their own giving apart from any soft credit, and a household shows hard credit, soft credit and the household combined.",
    ],
    related: ["soft-credit", "donor-advised-fund", "tax-receipt"],
    see: ["/articles/read-retention", "/articles/january-week"],
  },
  {
    slug: "donor-advised-fund",
    term: "Donor-advised fund (DAF)",
    aka: "DAF",
    def: "A donor-advised fund (DAF) is a giving account held at a sponsoring charity. The donor puts money in, takes the tax deduction then, and later recommends grants from the fund to charities like yours.",
    why: [
      "A DAF grant comes from the sponsoring charity, not from the person. The donor already took their deduction, so you send the tax acknowledgment to the fund and a warm personal thank-you to the donor who recommended it.",
      "DAF grants generally should not pay for anything the donor receives in return, such as a gala ticket or a membership benefit. Rules here are specific, so check with your accountant when a DAF grant arrives tied to an event or a pledge.",
    ],
    steward: [
      "In Steward, a DAF is an organization on file like any other. Log the grant on the fund's profile with DAF as the payment method, and soft credit the person who recommended it. The bookkeeper export lists the grant as money under the fund that sent it.",
    ],
    related: ["hard-credit", "soft-credit", "tax-receipt"],
    see: ["/articles/january-week", "/articles/thank-you-call"],
  },
  {
    slug: "matching-gift",
    term: "Matching gift",
    def: "A matching gift is a gift from an employer that matches a donation its employee made to your organization, often dollar for dollar, through the company's matching gift program.",
    why: [
      "Matching gifts are money your donors have already earned for you and often forget to claim. A line in your thank-you asking whether their employer matches gifts can add real dollars at no cost.",
      "Track the match separately from the employee's gift. The employee gets the hard credit for their own gift, the company gets the hard credit for its match, and you thank both.",
    ],
    steward: [
      "When you add a gift in Steward, you can name the employer that will match it. Steward holds the match as a pledge on the employer's profile, not as money, until the match actually arrives. Steward never chases a company for it.",
    ],
    related: ["hard-credit", "soft-credit", "pledge"],
    see: ["/articles/thank-you-call", "/articles/january-week"],
  },
  {
    slug: "recurring-gift",
    term: "Recurring gift",
    aka: "Monthly gift",
    def: "A recurring gift is a donation the donor sets up once to repeat on a schedule, most often monthly, charged automatically to a card or bank account until they change or stop it.",
    why: [
      "Recurring gifts give you steady, predictable income, and the donors who set them up tend to stay much longer than one-time donors. Over a year, a modest monthly gift often adds up to more than the donor would give in a single appeal.",
      "The main risk is not donors changing their minds. It is cards that expire or fail. Watch failed payments closely and reach out quickly and personally when one happens.",
    ],
    steward: [
      "Steward shows recurring gifts under Fundraising and on the Recurring dashboard in Reports. Home has a section for monthly gifts that need you, and a Today tile for monthly givers whose card failed this week. Staff can propose a new recurring gift, and nothing changes until the donor accepts it.",
    ],
    related: ["sustainer", "donor-lifetime-value", "pledge"],
    see: ["/articles/monthly-donors", "/tools/retention"],
  },
  {
    slug: "sustainer",
    term: "Sustainer",
    aka: "Monthly donor",
    def: "A sustainer is a donor who gives through a recurring gift, usually every month, rather than in one-time gifts. Many organizations give their sustainers a program name.",
    why: [
      "Sustainers are some of your most loyal donors, and they are easy to forget because their gifts arrive without anyone asking. Thank them as people, not as transactions. A short update every season reminds them what their monthly gift does.",
      "Ask your most loyal one-time donors to become sustainers. Someone who has given every year for several years already has the habit. A monthly gift just makes it easier.",
    ],
    steward: [
      "In Steward you choose what you call your monthly givers, and that word is used across the app. Home shows the monthly givers whose card failed this week, so a person can reach out before the gift lapses.",
    ],
    related: ["recurring-gift", "donor-lifetime-value", "stewardship"],
    see: ["/articles/monthly-donors", "/articles/second-gift"],
  },
  {
    slug: "pledge",
    term: "Pledge",
    def: "A pledge is a donor's promise to give a set amount in the future, paid all at once or in installments over an agreed schedule.",
    why: [
      "Pledges let donors make bigger commitments than they could in one payment, which is why they are common in campaigns. Treat each pledge as a relationship with dates attached: thank them when they pledge, remind them kindly, and thank them again as each payment arrives.",
      "Keep pledged money and received money apart in every report. A campaign is not funded until the pledges are paid. How your books count an unconditional pledge is an accounting question, so check with your accountant.",
    ],
    steward: [
      "In Steward, a pledge lives on the donor's Gifts & Pledges tab with its amount, due date and campaign. When a payment comes in, you pick the pledge it fulfils. A campaign shows raised and pledged as separate figures and never adds them together.",
    ],
    related: ["matching-gift", "capital-campaign", "recurring-gift"],
    see: ["/tools/thermometer", "/articles/january-week"],
  },
  {
    slug: "in-kind-gift",
    term: "In-kind gift",
    def: "An in-kind gift is a donation of goods or services instead of money, such as food, equipment, auction items, office space or professional work given for free.",
    why: [
      "In-kind gifts can save you real money and deserve a real thank-you. Log them with the donor's history, so you see the full picture of what each person gives.",
      "Receipting is different from cash. For a gift of $250 or more, your written acknowledgment describes the item but does not state its value. Placing a value on it for a tax deduction is the donor's job. Donated services are generally not deductible, so check with your accountant.",
    ],
    steward: [
      "Steward keeps in-kind gifts at fair market value, never as cash. An import routes in-kind rows to their own place, and a donated auction item can be logged as an in-kind gift from the event. Steward's tax receipts cover cash gifts only, so you write the acknowledgment for an in-kind gift yourself.",
    ],
    related: ["acknowledgment-letter", "tax-receipt", "gift-acceptance-policy"],
    see: ["/tools/thank-you-letter", "/articles/january-week"],
  },
  {
    slug: "restricted-gift",
    term: "Restricted gift",
    def: "A restricted gift is a donation the donor has limited to a specific purpose, program or time period. Your organization must use it only as the donor directed.",
    why: [
      "Restricted gifts are a promise. Spending them on something else, even for a good reason, can damage trust and create problems with your auditor. Track each restriction from the day the money arrives until it is fully spent.",
      "Too many restricted gifts can also squeeze your operating budget. When you can, invite donors to give where the need is greatest, and save restricted asks for projects you were going to run anyway.",
    ],
    steward: [
      "In Steward, a fund can be marked restricted when a donor or grant restricted it. Every gift carries a fund, and restricted money shows what was received, what was spent and what remains, with any overspend shown plainly.",
    ],
    related: ["unrestricted-gift", "gift-acceptance-policy", "capital-campaign"],
    see: ["/articles/read-retention", "/articles/january-week"],
  },
  {
    slug: "unrestricted-gift",
    term: "Unrestricted gift",
    aka: "General operating support",
    def: "An unrestricted gift is a donation with no limits on how it is used. Your organization can spend it wherever the need is greatest, including salaries, rent and programs.",
    why: [
      "Unrestricted money is the most valuable money you raise. It pays for the people and systems that make every program work, and it lets you respond when something unexpected happens.",
      "Make the case for it plainly. Tell donors what flexible support makes possible, and thank unrestricted donors as warmly as those who fund a named project. Most annual fund gifts are unrestricted.",
    ],
    steward: [
      "In Steward, a gift a staff member enters without a fund goes to your organization's unrestricted default fund. A gift a donor makes online without choosing a purpose stays undesignated, so nothing is assigned by guess.",
    ],
    related: ["restricted-gift", "annual-fund", "average-gift"],
    see: ["/articles/state-of-retention", "/articles/no-retention-strategy"],
  },
  {
    slug: "stewardship",
    term: "Stewardship",
    def: "Stewardship is everything a nonprofit does after a gift arrives: thanking the donor, showing them what the gift did, and keeping the relationship warm so they choose to give again.",
    why: [
      "Most small shops spend their energy on the ask and very little on what comes after it. But the next gift is decided in the months after the last one. A prompt thank-you, a short update on what the money paid for, and a call that asks for nothing are what turn a one-time donor into a regular one.",
      "Good stewardship does not need a big team. It needs a habit: every gift thanked within a couple of days, every donor hearing from you at least once between asks, and someone noticing when a regular giver goes quiet.",
    ],
    steward: [
      "When a gift comes in, Steward drafts a thank-you and puts it on Home under \"Thank-yous ready\". You read it, send it from your own email and mark it sent. Steward does not send it for you.",
      "Home also lists donors who have gone quiet past their own giving pattern (Drift), and Journeys put each stewardship step in front of the person who owns the relationship at the right time.",
    ],
    related: ["acknowledgment-letter", "donor-journey", "drift"],
    see: ["/articles/thank-you-call", "/tools/thank-you-letter"],
  },
  {
    slug: "cultivation",
    term: "Cultivation",
    def: "Cultivation is the work of building a relationship with a donor or prospect before you ask for a gift: visits, tours, updates and conversations that deepen their interest in your mission.",
    why: [
      "An ask that arrives cold is easy to decline. An ask that follows a site visit, a lunch with your program director and a few honest updates feels like the natural next step. Cultivation is how you earn the right to ask for a larger gift.",
      "For a small team, cultivation works best as a short written plan for each prospect: two or three touches, each with a date and an owner, ending in a clear ask. Without the plan, cultivation quietly turns into waiting.",
    ],
    steward: [
      "In Fundraising, under Major gifts, Plans lets you lay out a cultivation plan as a series of steps. Only one step is open at a time, and each one lands on The Thread for the person who owns the relationship. A plan never sends anything.",
      "Events can be typed as cultivation events, and every conversation you log joins the donor's timeline, so the history of the relationship is in one place when the ask comes.",
    ],
    related: ["solicitation", "major-gift", "moves-management"],
    see: ["/articles/second-gift", "/articles/thank-you-call"],
  },
  {
    slug: "solicitation",
    term: "Solicitation",
    def: "Solicitation is a direct request for a gift, made in person, by phone, by letter or by email. In major giving it usually means a specific ask for a specific amount and purpose.",
    why: [
      "Many donors who could give more never do, simply because nobody asked them clearly. A good solicitation names an amount, says what it will do, and then waits for the answer. Vague asks get vague results.",
      "Keep track of every ask you make: who asked, how much, for what, and what happened. That history stops two people asking the same donor in the same month, and it tells you next year what each donor said yes to.",
    ],
    steward: [
      "On a donor's profile you can start a proposal with \"+ New proposal\", which holds the amount you asked for and where it stands. An open ask is never counted as a gift. When a donor gives, the gift is entered on its own and linked to the ask.",
      "\"Request a gift\" in the profile's More menu gives you a link the donor can give through, which you send yourself.",
    ],
    related: ["cultivation", "case-for-support", "capacity"],
    see: ["/articles/second-gift", "/articles/thank-you-call"],
  },
  {
    slug: "case-for-support",
    term: "Case for support",
    aka: "Case statement",
    def: "Case for support means the written argument for why someone should give to your organization: the need, what you do about it, the results, and what a gift will make possible now.",
    why: [
      "The case for support is the source document for everything else you write. Appeal letters, grant narratives, giving pages and the talking points for a board member's visit all borrow from it. When it is clear, every ask gets easier to write and sounds like the same organization.",
      "A useful case is short. Name the problem in plain words, show what you do with one real story and a few honest numbers, and say exactly what the next gift will pay for. Update it every year, and write a focused version for a capital campaign or a big new program.",
    ],
    steward: [
      "Steward does not write your case for support. When you create a campaign, the \"What donors see\" section holds the story and photo for its public page, which is where a short version of your case usually ends up.",
    ],
    related: ["capital-campaign", "solicitation", "annual-fund"],
    see: ["/articles/no-retention-strategy", "/tools/thank-you-letter"],
  },
  {
    slug: "annual-fund",
    term: "Annual fund",
    def: "Annual fund is the name for the money a nonprofit raises every year, usually unrestricted, to pay for day-to-day operations. It is renewed each year through appeals, events and ongoing asks.",
    why: [
      "The annual fund keeps the lights on: salaries, rent and the programs that do not have a grant behind them. Because it is usually unrestricted, it is the most flexible money you raise, and the hardest to replace if it falls.",
      "Its health depends on renewal. A donor who gives to the annual fund every year is worth far more over time than one who gives once, so the annual fund is really a retention program. Watch who gave last year and has not given yet this year, and ask them first.",
    ],
    steward: [
      "Each gift can be assigned to a fund, and each fund is marked restricted or unrestricted. Reports, under Who stopped giving, lists LYBUNT and SYBUNT donors and your retention, with every figure opening the donors behind it.",
    ],
    related: ["unrestricted-gift", "year-end-appeal", "lybunt"],
    see: ["/articles/lybunt-sybunt-before-year-end", "/tools/lybunt-sybunt"],
  },
  {
    slug: "capital-campaign",
    term: "Capital campaign",
    def: "Capital campaign means a fundraising effort with a set goal and deadline to pay for something big and lasting, such as a building, a major renovation or an endowment, usually on top of the annual fund.",
    why: [
      "Capital campaigns usually start with a quiet phase, when a large share of the goal is raised from board members and a few lead donors, before a public launch to everyone else. Many gifts arrive as multi-year pledges, so tracking what was promised against what has been paid matters as much as the headline total.",
      "For a small organization, the risk is that the campaign pulls every donor's attention away from the annual fund. Plan for both: ask campaign donors to keep their regular gift, and keep thanking everyone who gives to either.",
    ],
    steward: [
      "A campaign in Fundraising has a goal amount, a start date and a deadline, and its public page shows a goal bar that says what it counts. Pledges sit on each donor's Gifts & Pledges tab, and a gift can be marked as a payment on the pledge it fulfils.",
      "Only one open proposal per fund is allowed per household, so a couple is not asked twice for the same campaign.",
    ],
    related: ["pledge", "case-for-support", "gift-range-chart"],
    see: ["/tools/thermometer", "/articles/second-gift"],
  },
  {
    slug: "peer-to-peer-fundraising",
    term: "Peer-to-peer fundraising",
    aka: "P2P fundraising",
    def: "Peer-to-peer fundraising is when supporters raise money on your behalf, each with a personal fundraising page they share with friends, family and colleagues, often for a walk, run or birthday.",
    why: [
      "Peer-to-peer reaches people you could never reach yourself. A gift made because a friend asked is a real gift to your organization, and that donor is someone you now have a chance to steward.",
      "The work is in the follow-through: thank the fundraisers as well as the donors, give fundraisers simple words to send, and decide what a fundraiser is allowed to see about the people who gave through their page.",
    ],
    steward: [
      "In Steward a peer-to-peer campaign is a giving page with peer-to-peer turned on. Supporters sign up for their own page, can start or join teams, and every gift counts toward the one page total. The fundraiser gets a soft credit, and the gift stays on the donor who gave it.",
      "A fundraiser never sees a donor's email, and sees a donor's name only if that donor chose to share it. Steward emails none of a fundraiser's contacts: the draft messages are words the fundraiser sends from their own email.",
    ],
    related: ["soft-credit", "giving-day", "acquisition"],
    see: ["/articles/first-year-donor-plan", "/tools/thermometer"],
  },
  {
    slug: "giving-day",
    term: "Giving day",
    def: "Giving day means a single, publicized day of fundraising, either a global day like GivingTuesday or a local community day, when an organization asks everyone at once and often uses a matching gift to build urgency.",
    why: [
      "A giving day gives you a reason to ask that people already understand, and a deadline that makes them act. The best results come from preparation, not the day itself: a matching gift lined up in advance, the appeal written two weeks out, and posts planned for morning, midday and evening.",
      "The day after matters most. Thank every giving day donor within two days, and treat first-time donors as the start of a relationship, not a line in a total.",
    ],
    steward: [
      "Fundraising has a GivingTuesday campaign template. It works out this year's date (the Tuesday after US Thanksgiving), sets up a campaign page, and adds a dated plan of tasks for your team, from drafting the appeal to thanking every donor. Nothing the template creates sends anything.",
    ],
    related: ["year-end-appeal", "matching-gift", "peer-to-peer-fundraising"],
    see: ["/tools/thermometer", "/articles/thank-you-call"],
  },
  {
    slug: "year-end-appeal",
    term: "Year-end appeal",
    def: "Year-end appeal is the name for the letter and email campaign a nonprofit sends in November and December, when many donors make their giving decisions before the tax year closes.",
    why: [
      "For many small organizations the last weeks of December are the busiest giving weeks of the year, and the final few days are the busiest of all. A year-end appeal that is planned in October, posted by early December and followed by short reminder emails catches donors when they are deciding.",
      "The appeal that works looks back before it looks forward: what this year made possible, then what next year needs. Start with the people most likely to give, the ones who gave last year but not yet this year, and call your largest donors rather than emailing them.",
    ],
    steward: [
      "Fundraising has a Year-end campaign template. It sets up a campaign page and a dated plan of tasks for the last six weeks of the year, from drafting the letter to thanking every donor. Nothing it creates sends anything.",
      "After the year closes, year-end giving statements run from Settings, under Tax Receipts, when an admin starts them, with a dry run first.",
    ],
    related: ["lybunt", "annual-fund", "tax-receipt"],
    see: ["/articles/lybunt-sybunt-before-year-end", "/tools/lybunt-sybunt"],
  },
  {
    slug: "acknowledgment-letter",
    term: "Acknowledgment letter",
    aka: "Gift acknowledgment, thank-you letter",
    def: "Acknowledgment letter is the name for the thank-you a nonprofit sends after a gift. It thanks the donor personally and, when it includes the required details, also serves as their written acknowledgment for tax purposes.",
    why: [
      "The acknowledgment is the first stewardship step and the one donors notice most. Sent within a few days, warm and specific about what the gift will do, it tells the donor their money landed somewhere that pays attention.",
      "Under IRS rules, a donor needs a written acknowledgment to deduct any single contribution of $250 or more. It should state the amount (or describe non-cash property), and say whether the donor received any goods or services in return, with a good-faith estimate of their value if so. Check the exact wording with your accountant.",
    ],
    steward: [
      "In Fundraising, under Money in, Acknowledgments lists gifts nobody has marked thanked. Choose a template, tick the gifts, preview, then print the letters and mailing labels. Each donor gets one letter listing every gift in the batch. Printing changes nothing; you press \"Mark as sent\" once the letters are in the post.",
      "Thank-you emails are drafted on Home under \"Thank-yous ready\", and you send them from your own mail.",
    ],
    related: ["tax-receipt", "stewardship", "quid-pro-quo"],
    see: ["/tools/thank-you-letter", "/articles/thank-you-call"],
  },
  {
    slug: "tax-receipt",
    term: "Tax receipt",
    aka: "Donation receipt, contemporaneous written acknowledgment",
    def: "Tax receipt is the name for the written confirmation a nonprofit gives a donor so they can deduct a gift. A US donor needs one to deduct any single contribution of $250 or more.",
    why: [
      "A receipt should carry your organization's legal name and EIN, the date and amount of the gift (or a description of non-cash property), and a statement of whether the donor received goods or services in return, with a good-faith estimate of their value if they did. The donor needs it by the time they file their return.",
      "Many organizations receipt every gift and also send a year-end statement listing each donor's giving for the year, which saves donors from hunting for single receipts in April. Rules have exceptions, so check the details with your accountant.",
    ],
    steward: [
      "In Settings, under Tax Receipts, you enter your legal name, EIN and receipt address and turn receipts on. For a gift entered by hand, \"Send receipt\" on the gift's row emails it. The receipt prints your organization's details, never Steward's.",
      "Year-end giving statements run only when an admin starts them. A dry run shows how many donors and gifts were found and who has no email address before anything is sent.",
    ],
    related: ["acknowledgment-letter", "quid-pro-quo", "in-kind-gift"],
    see: ["/tools/thank-you-letter", "/articles/january-week"],
  },
  {
    slug: "quid-pro-quo",
    term: "Quid pro quo contribution",
    def: "Quid pro quo contribution means a payment to a nonprofit that is partly a gift and partly in exchange for goods or services, such as a gala ticket that includes dinner. Only the part above the value received is deductible.",
    why: [
      "Under IRS rules, when a donor pays more than $75 and receives something in return, you must give them a written disclosure. It tells them that only the amount above the value of what they received is deductible, and gives a good-faith estimate of that value. A $150 ticket to a dinner worth $60 means a $90 deductible gift.",
      "This comes up at galas, auctions, paid events and memberships with benefits. Set the fair market value of each ticket level or item before you sell it, and put the disclosure on the receipt. Some token items and benefits are exempt, so check the specifics with your accountant.",
    ],
    steward: [
      "Event ticket levels, membership levels and auction items each carry a fair market value that you set. Steward never estimates it, and refuses a value higher than the price. The donor's receipt then states the deductible part, and the full amount they paid still counts in your totals.",
    ],
    related: ["tax-receipt", "acknowledgment-letter", "in-kind-gift"],
    see: ["/tools/thank-you-letter", "/articles/january-week"],
  },
  {
    slug: "ncoa",
    term: "NCOA",
    aka: "National Change of Address",
    def: "NCOA (National Change of Address) is the US Postal Service's database of people and businesses who have filed a change of address. Running your mailing list through it updates addresses for donors who have moved.",
    why: [
      "Donors move, and few of them tell you. Every letter sent to an old address costs postage and printing and reaches nobody, and a donor who stops hearing from you is a donor who quietly stops giving. Mail that comes back undeliverable is a sign your list needs cleaning.",
      "NCOA processing is done by licensed service providers, often your mail house, and the Postal Service requires a move update check for discounted presorted mail. Run your list before each big mailing, such as the year-end appeal, and update the new addresses in your donor system so the next mailing starts clean.",
    ],
    steward: [
      "Data health, on the Donors screen, has a card called People who moved. It prepares an address update file of your donors' mailing addresses to send to an NCOA provider, and when the provider sends back its results you bring the file in. Each change of address then waits for you: review the moves, apply the ones you accept and skip the rest. Steward never changes an address on its own, and the old address is kept in the donor's history.",
      "The NCOA matching itself is done by a licensed provider, not by Steward. When you print acknowledgment letters, donors with no postal address are left out by name, so you can see whose address is missing.",
    ],
    related: ["deduplication", "year-end-appeal", "household"],
    see: ["/articles/spreadsheet-to-donor-system", "/articles/lybunt-sybunt-before-year-end"],
  },
  {
    slug: "deduplication",
    term: "Deduplication",
    aka: "Dedupe, merging duplicates",
    def: "Deduplication is finding donors who appear more than once in your database and merging them into one profile, so each person has one giving history, one set of contact details and one total.",
    why: [
      "Duplicates creep in from online forms, event sign-ups, imports and typos. They cost real money: two thank-yous to one person, a lifetime total split in half so a major donor looks small, and retention numbers that count one returning donor as one lapsed and one new.",
      "Check for duplicates after every import and on a regular schedule. Match first on email, then look at similar names by hand, and when you merge, keep every gift and carry over any do-not-contact flag.",
    ],
    steward: [
      "Data health, on the Donors screen, lists possible duplicates as pairs, each with the reason in words and a confidence of high, medium or low. You choose which profile to keep and press merge. Every gift, note and task moves across, and the money is checked to the cent before anything is saved. A do-not-contact or deceased flag is always kept.",
      "Any merge can be undone for 30 days, and undo brings back both people exactly as they were. Mark a pair \"Not a duplicate\" and it stays that way, even after your next import. When you import a file, people already on file are matched rather than added twice.",
    ],
    related: ["household", "ncoa", "soft-credit"],
    see: ["/articles/spreadsheet-to-donor-system", "/tools/lost-and-found"],
  },
  {
    slug: "wealth-screening",
    term: "Wealth screening",
    aka: "Prospect screening",
    def: "Wealth screening is running a list of donors through an outside service that estimates their giving capacity from public information such as property, business ownership, stock holdings and gifts to other charities.",
    why: [
      "A screening can point to donors whose giving to you is small compared with what they could do, which helps a small team decide whom to visit first. It is a starting point for a conversation, not a verdict, and the estimates are often wrong for individual people.",
      "Screen with care. Donors can be uncomfortable when an organization knows too much about their finances, so keep the results to the people who need them and never mention them to the donor. A donor's own giving history and closeness to your work usually tell you more.",
    ],
    steward: [
      "Steward does not run wealth screenings. If a file from your old donor system carries a screening's rating, capacity or date, the import keeps them as written and never folds them into Steward's own figures.",
      "The \"Proven capacity\" filter in the donor directory groups people by the largest and most consistent giving they have actually done with you, from your own file only.",
    ],
    related: ["capacity", "affinity", "major-gift"],
    see: ["/articles/second-gift", "/tools/lapsed-cost"],
  },
  {
    slug: "capacity",
    term: "Capacity",
    aka: "Giving capacity",
    def: "Capacity is an estimate of how much a donor could give if they chose to, usually over several years, based on their wealth and income rather than on what they have given so far.",
    why: [
      "Capacity tells you how big an ask could be. Affinity tells you whether the donor cares enough to say yes. The best major gift prospects have both, and a donor with high capacity and no connection to your work is a long cultivation, not a quick ask.",
      "For a small shop, the most reliable signal of capacity is often already in your own data: the largest gift a donor has made, how steadily they give, and what they have told you in conversation. Outside estimates can add to that picture but should not replace it.",
    ],
    steward: [
      "Steward does not estimate wealth. The \"Proven capacity\" filter groups donors by the largest and most consistent giving they have actually done with you, and the directory's Giving strength column ranks how much, how recently and how often each person has given. Neither looks outside your own file.",
    ],
    related: ["wealth-screening", "affinity", "gift-range-chart"],
    see: ["/articles/second-gift", "/tools/lapsed-cost"],
  },
  {
    slug: "affinity",
    term: "Affinity",
    def: "Affinity is how strongly a donor is connected to your organization and its cause: how much they care, how involved they are, and which parts of your work matter most to them.",
    why: [
      "Affinity predicts whether someone will give, and capacity predicts how much they could. A volunteer who has served for six years, a parent whose child went through your program and a donor who has given every year for a decade all have high affinity, whatever their means.",
      "Knowing what a donor cares about also tells you what to ask for. A donor who has always given to the scholarship fund will hear a scholarship ask far more readily than a general one. Note the programs each donor supports and the reasons they give.",
    ],
    steward: [
      "A donor's Funds tab shows what they support: their gifts grouped by fund, restricted against unrestricted, with suggested asks. Their engagement score counts meetings, events, calls, replies and volunteer shifts, so closeness shows up alongside giving.",
    ],
    related: ["capacity", "engagement-score", "cultivation"],
    see: ["/articles/second-gift", "/articles/thank-you-call"],
  },
  {
    slug: "engagement-score",
    term: "Engagement score",
    def: "Engagement score means a number that sums up how involved a person is with your organization, based on actions such as meetings, event attendance, volunteering, calls and email replies, with recent actions usually counting more.",
    why: [
      "Giving totals only show part of a relationship. A donor who gives modestly but comes to every event and volunteers each month is closer to you than their gifts suggest, and is often your best prospect for a larger gift or a board seat.",
      "A score is only useful if you can see how it was worked out. If nobody on the team can explain why a donor scored what they did, the number will be ignored, or worse, trusted when it is wrong.",
    ],
    steward: [
      "Each profile shows an engagement score and a generosity score, both from 0 to 100 and measured against your own people. Engagement counts meetings, events attended, calls, email replies, survey answers, volunteer shifts and newsletter opens and clicks from the last 24 months, with recent touches counting most.",
      "\"See why\" shows how each score was worked out, and every part opens the rows behind it. Under the name, a closeness word (Close, Warm, Cooling or New) says the same thing in plain language.",
    ],
    related: ["affinity", "donor-journey", "drift"],
    see: ["/articles/read-retention", "/articles/second-gift"],
  },
  {
    slug: "donor-journey",
    term: "Donor journey",
    def: "Donor journey means the planned series of touches a donor experiences with your organization, from their first gift through thanks, updates and later asks, set out in advance so nobody falls through the cracks.",
    why: [
      "Without a written journey, what a donor hears from you depends on who remembers. A journey writes it down once: when someone gives for the first time, they get a thank-you within days, a call in the first weeks, an impact update a few months later, and a second ask at a sensible moment.",
      "The first year matters most, because that is when a new donor decides whether to give again. Start with one journey for first-time donors and one for monthly givers, then add more once those run smoothly.",
    ],
    steward: [
      "Journeys in Steward start when something happens to a person, such as a first gift, and put each step in front of whoever owns the relationship at the right time. A journey never sends anything. If a step has a draft, Steward writes it for you to read, and it is yours to send.",
      "You can start from a ready-made card, such as \"New donor, first year\".",
    ],
    related: ["stewardship", "first-year-retention", "engagement-score"],
    see: ["/articles/first-year-donor-plan", "/articles/second-gift"],
  },
  {
    slug: "board-giving",
    term: "Board giving",
    aka: "Board giving participation",
    def: "Board giving is the personal gifts made by members of a nonprofit's board. Board giving participation is the share of board members who have made a gift in the current year.",
    why: [
      "Foundations and major donors often ask whether every board member gives, because it shows the people closest to the organization believe in it with their own money. The amount matters less than participation. A gift the board member can be proud of, whatever its size, is the standard most organizations set.",
      "Make it easy. Ask early in the fiscal year, have the board chair ask personally, and track who has given so the last few can be reminded quietly before a grant deadline.",
    ],
    calc: {
      formula: "Board giving participation = board members who gave this year ÷ total board members × 100",
      example: [
        "Your board has 12 members.",
        "9 of them have made a gift this fiscal year.",
        "9 ÷ 12 × 100 = 75%. Your board giving participation is 75%.",
      ],
    },
    steward: [
      "Put your board in a group kept by hand. The group's page shows how many people are in it and what they gave this fiscal year, and clicking the figure shows the gifts behind it, so you can see who has given and who has not.",
    ],
    related: ["annual-fund", "capital-campaign", "major-gift"],
    see: ["/articles/no-retention-strategy", "/tools/thermometer"],
  },
  {
    slug: "acquisition",
    term: "Acquisition",
    aka: "Donor acquisition",
    def: "Acquisition is the work of finding new donors and getting their first gift, through appeals, events, peer-to-peer campaigns, giving days and online giving pages.",
    why: [
      "Every organization needs new donors, because some existing donors will always move, change priorities or stop giving. But acquisition is expensive, and a first gift can cost more to raise than it brings in. The return comes only if the donor gives again.",
      "That is why acquisition and retention are one plan. Before spending more to find new donors, check how many of last year's new donors gave a second time. If few did, the money is better spent on thanking and keeping the ones you have.",
    ],
    calc: {
      formula: "Cost per new donor = what you spent on acquisition ÷ new donors it brought in",
      example: [
        "You spent $3,000 on an acquisition mailing.",
        "It brought in 60 new donors.",
        "$3,000 ÷ 60 = $50. Each new donor cost $50 to acquire.",
      ],
    },
    steward: [
      "Steward is built for what happens after the first gift. The \"New donor, first year\" journey starts when someone gives for the first time and puts each step in front of the person who owns the relationship.",
    ],
    related: ["first-year-retention", "attrition", "donor-journey"],
    see: ["/articles/first-year-donor-plan", "/tools/retention"],
  },
  {
    slug: "attrition",
    term: "Attrition",
    aka: "Donor attrition, donor churn",
    def: "Attrition is the loss of donors from one year to the next. The attrition rate is the share of last year's donors who did not give again this year, the opposite of the retention rate.",
    why: [
      "Attrition is the quiet leak in every fundraising program. Each donor who drops away has to be replaced just to stand still, and new donors usually cost more to find than existing ones cost to keep.",
      "Attrition is highest among first-time donors, so that is where to start. Thank every new donor quickly, show them what their gift did, and ask for a second gift within the year. Pull the list of donors who gave last year but not yet this year before your year-end appeal.",
    ],
    calc: {
      formula: "Attrition rate = donors who gave last year but not this year ÷ donors who gave last year × 100",
      example: [
        "Last year 300 donors gave.",
        "174 of them have not given this year.",
        "174 ÷ 300 × 100 = 58%. Your attrition rate is 58%.",
      ],
    },
    steward: [
      "Reports, under Who stopped giving, shows retention by calendar year, fiscal year or rolling 12 months, and lists LYBUNT, SYBUNT and lapsed donors. Each figure opens the donors behind it, so you can see exactly who is in the leak.",
    ],
    related: ["donor-retention-rate", "lybunt", "drift"],
    see: ["/articles/donor-retention-rate", "/tools/retention"],
  },
  {
    slug: "drift",
    term: "Drift",
    def: "Drift is Steward's term for a donor moving away from their own usual giving rhythm before they lapse: they are well past the date their pattern says their next gift was due, but not yet gone.",
    why: [
      "Most systems only notice a donor once they have lapsed, usually after a year or more without a gift. By then the moment has passed. A donor who has given every spring for five years and has not given by late summer is telling you something months earlier.",
      "Drift catches that earlier signal. A quarterly giver who is two months late and an annual giver who is four months late can both be drifting, even though a one-size rule would miss one of them. A personal call at that point, asking nothing, is often all it takes.",
    ],
    steward: [
      "Steward works out each donor's own giving rhythm, including a donor who gives in the same month every year, and flags them once they are clearly past their expected next gift. Drift appears on Home, with a sentence saying why, and as a badge in the donor directory and on the donor's profile.",
      "Donors who are a little past their rhythm, not far enough to be sure, are grouped under \"Early signs\" and kept out of the headline dollars. Logging a conversation quiets the list for a while, never the badge.",
    ],
    related: ["donor-lapse", "lapsed-donor", "attrition"],
    see: ["/articles/read-retention", "/tools/lapsed-cost"],
  },
  {
    slug: "gift-acceptance-policy",
    term: "Gift acceptance policy",
    def: "Gift acceptance policy means a board-approved document setting out which gifts a nonprofit will accept, which it will refuse, and who decides the unusual ones, such as property, stock, vehicles or gifts with conditions.",
    why: [
      "Most gifts are simple. The hard ones arrive without warning: a house with a mortgage, a stake in a family business, a gift that comes with naming rights or a say in hiring. A written policy lets staff say yes or no calmly, with the board's backing, instead of deciding under pressure.",
      "A good policy covers the kinds of gifts you accept, how non-cash gifts are valued and sold, what restrictions you will take, when legal or financial review is needed, and how you handle gifts from sources that could harm your reputation. Have your accountant and, for complex gifts, a lawyer review it.",
    ],
    steward: [
      "Steward does not hold or check your gift acceptance policy. In-kind gifts are entered at the fair market value you give them, never as cash.",
    ],
    related: ["in-kind-gift", "restricted-gift", "planned-gift"],
    see: ["/articles/no-retention-strategy", "/articles/spreadsheet-to-donor-system"],
  },
  {
    slug: "household",
    term: "Household",
    def: "Household means a group of donors who live together, such as a married couple, linked in your donor system so they can be thanked, counted and asked together rather than as strangers.",
    why: [
      "Couples often give from a joint account and think of the gift as theirs together. Thanking only one of them, mailing two appeals to the same kitchen table, or asking each spouse separately for the same project all tell donors you do not know them.",
      "Households also give you a truer picture of giving. A couple who each give $500 is a $1,000 relationship, and seeing that combined figure can change who gets a personal visit. Keep each person's own giving too, so tax receipts stay with the person whose money it was.",
    ],
    steward: [
      "Steward lets you group people into a household with a primary member. The household shows combined giving, each member's own giving and their household soft credit, all worked out from the same gifts, so nothing is ever counted twice and your totals do not change.",
      "Only one open proposal per fund is allowed per household, so a couple is not asked twice for the same thing.",
    ],
    related: ["soft-credit", "deduplication", "hard-credit"],
    see: ["/articles/spreadsheet-to-donor-system", "/tools/thank-you-letter"],
  },
];

export const TERM = Object.fromEntries(GLOSSARY.map(g => [g.slug, g]));
export const GLOSSARY_UPDATED = "2026-10-03";

// LANDING-3 · the six new articles, the reference's ART2 table.
//
// Bodies are structured the way GUIDES are, a lede, then [heading,
// paragraphs], rather than HTML strings, so nothing on this site is rendered
// with dangerouslySetInnerHTML. `src` names the SRC entries a sourced number
// must keep its link to.
//
// 'state-of-retention' is the LANDING-2 article and keeps its own page; it is
// listed here so the index and the Keep reading rows carry all seven.
export const ART2 = {
  "state-of-retention": null,
  "second-gift": {
    t: "The second gift", b: "matters most", k: "Retention", min: 4,
    h: "Why the second gift <b>matters more than the first.</b>",
    d: "The gap between first-time and repeat donors is the most useful number in fundraising.",
    lede: "Every development office celebrates new donors. The research says the real celebration should wait for their second gift.",
    s: [
      ["The numbers", ["In the Fundraising Effectiveness Project's Q4 2024 report, 19.4% of new donors gave again the following year. Among repeat donors, 69.2% did. Once a donor has given twice, the odds that they keep giving are far better."]],
      ["What changes after the second gift", ["A first gift is often a response to a moment: an event, a friend's ask, a story in the news. A second gift is a decision. It means the donor heard back from you, felt it mattered and chose you again."]],
      ["How to earn it", ["Thank them within two days, by phone if you can. Show them what the first gift did within a month. Invite them to see the work. Ask for the second gift on the anniversary of the first, for an amount close to what they gave."]],
      ["In Steward", ["Every new donor can start a first-year journey with each step assigned to a person, and drift flags a first-time donor who goes quiet before the year is out."]],
    ],
    src: ["fep24"],
  },
  // PROOF-2 · the retention-strategy article. Every figure is Momentive's or
  // Sage's, worded as the source words it; both are linked below the body.
  "no-retention-strategy": {
    t: "No retention", b: "strategy yet", k: "Retention", min: 5,
    h: "Why nearly half of nonprofits have no retention strategy, <b>and how to start one this month.</b>",
    d: "Nearly half of nonprofits in a 2025 survey reported having no donor retention strategy. Here is a four-week way to start one.",
    lede: "In Momentive Software's 2025 Nonprofit Trends Report, 46% of organizations reported having no donor retention strategy at all. The ones that had a strategy reported keeping noticeably more of their donors.",
    s: [
      ["What the survey reported", ["Momentive surveyed US nonprofit professionals in February and March 2025. Organizations with a donor retention strategy reported donor retention rates of 77%. Organizations lacking one reported 61%. And 56% of organizations with a strategy reported revenue growth.", "A survey records what people reported, not what caused it. Organizations organized enough to write a strategy may differ in other ways too. Still, a gap of that size is worth taking seriously, and the first step costs nothing."]],
      ["Why so many have none", ["The report does not say why. One pressure shows up clearly in other research: in Sage's 2025 Nonprofit Technology Impact Report, 58% of more than 350 nonprofit leaders said hiring and retention is their biggest external challenge, ahead of competition for funding (55%) and economic uncertainty (49%).", "A retention strategy usually lives in one person's head and one person's inbox. When that person leaves, or never had the hours to begin with, the strategy goes too."]],
      ["Week one: find who is slipping", ["Pull last year's donors who have not given this year and sort them by what they gave. That list is your strategy's first page."]],
      ["Week two: call the top twenty", ["A thank-you, not an ask. Say what last year's gift did and ask what they care about now. Write down what you hear."]],
      ["Week three: give every new donor a first year", ["A call within two days, a short story of what the gift did within a month, an invitation to see the work, and a renewal ask near the anniversary of the first gift. Put a person's name on every step."]],
      ["Week four: write it where the next person will find it", ["Notes, next steps and owners belong on each donor's profile, not in a notebook or an inbox. Then the plan survives a busy season and a staff change."]],
      ["In Steward", ["Drift flags donors going quiet against their own rhythm, journeys run the first year with a person named on every step, and Home lists who to call each morning. If you want to start with week one today, the free Lost & Found audit reads a giving export in your browser and shows who is slipping."]],
    ],
    src: ["momentive25", "sage25"],
    end: "lost-and-found",
  },
  "lybunt-sybunt": {
    t: "LYBUNT", b: "and SYBUNT", k: "Lists", min: 4,
    h: "LYBUNT and SYBUNT: <b>the two lists that pay for themselves.</b>",
    d: "Who they are, how to find them and what to say when you call.",
    lede: "Two unlovely acronyms describe the most valuable people in your database.",
    s: [
      ["LYBUNT", ["Last Year But Unfortunately Not This year. These people gave last year and have not given yet this year. They already know you and already said yes once. They are your best prospects for any appeal."]],
      ["SYBUNT", ["Some Year But Unfortunately Not This year. Anyone who gave in any past year but not this one. A longer list, a colder one, and still warmer than any stranger."]],
      ["What to do with them", ["Sort LYBUNT by last year's gift and call the top twenty before your next appeal. Do not open with an ask. Say thank you for last year, share one thing their gift made possible, and ask what they care about now. Then include them in the appeal with a note that mentions last year."]],
      ["In Steward", ["Both lists are one click from Reports, and every count opens to the people behind it."]],
    ],
  },
  "read-retention": {
    t: "Your retention", b: "rate, read right", k: "Basics", min: 5,
    h: "How to read <b>your retention rate.</b>",
    d: "One number, three ways to get it wrong, and what to compare it to.",
    lede: "Donor retention is the share of last year's donors who gave again this year. It sounds simple. It is easy to get wrong.",
    s: [
      ["Count people, not gifts", ["A donor who gave three times last year is one donor. Count each person or household once."]],
      ["Compare like with like", ["New donors and repeat donors retain at very different rates, so a year with many new donors will look worse even if nothing changed. Look at first-year and repeat retention separately."]],
      ["Know the benchmark", ["Across the sector, overall retention was 43.3% in 2025 according to the Fundraising Effectiveness Project. Your own trend over three years matters more than any single comparison."]],
      ["In Steward", ["Retention, first-year retention and repeat retention are on the Reports screen, and every figure opens to the donors behind it. Try the free Keep Rate calculator to see what a five-point lift is worth."]],
    ],
    src: ["fep25"],
  },
  "thank-you-call": {
    t: "The thank-you", b: "call", k: "Stewardship", min: 3,
    h: "Why the thank-you call <b>beats the letter.</b>",
    d: "A short look at the research on calling donors within 48 hours.",
    lede: "A letter is expected. A call is remembered.",
    s: [
      ["What the research found", ["In Penelope Burk's research for Donor-Centered Fundraising, donors who received a thank-you call from a board member within 48 hours of their gift gave 39% more the next time they were asked."]],
      ["Who should call", ["Board members are ideal, because the call costs them nothing but a few minutes and means a great deal to the donor. Staff calls work too. What matters is speed and sincerity."]],
      ["What to say", ["Thank them by name for the specific gift. Say one sentence about what it will do. Do not ask for anything. If you reach voicemail, keep it under thirty seconds and say there is no need to call back."]],
      ["In Steward", ["New gifts can create a call task for a named person the same day, and the call is logged on the donor when it is done."]],
    ],
    src: ["burk"],
  },
  "monthly-donors": {
    t: "Monthly", b: "donors", k: "Recurring", min: 4,
    h: "Monthly donors are <b>the quiet engine.</b>",
    d: "Why recurring gifts deserve their own care, and the one problem that ends most of them.",
    lede: "A monthly donor gives without being asked twelve times a year. That makes them easy to forget.",
    s: [
      ["Why they matter", ["Recurring gifts arrive in every month, including the quiet ones, and make budgeting less of a guess. They also tend to come from people who feel part of the work."]],
      ["The problem that ends most plans", ["Many monthly gifts stop not because the donor changed their mind but because a card expired or failed. If nobody notices, the relationship ends by accident."]],
      ["What to do", ["Watch for failed and expiring cards every week and reach out personally the same day. Thank monthly donors on their own schedule, with a quarterly update just for them and a call once a year."]],
      ["In Steward", ["Failed cards and missed recurring gifts show on Home as drift, with the donor, the amount and a next step."]],
    ],
  },
  "january-week": {
    t: "The first week", b: "of January", k: "Year end", min: 3,
    h: "What to do in <b>the first week of January.</b>",
    d: "The year-end rush is over. These five tasks set up the whole year.",
    lede: "The busiest giving season just ended. Before the inbox fills up again, a few hours in the first week of January make the rest of the year easier.",
    s: [
      ["Send statements early", ["Donors appreciate getting their year-end statement before they need it."]],
      ["Thank every December donor", ["Many gave on the last two days of the year. Make sure every gift got a thank-you, and call the largest."]],
      ["Start first-year plans", ["Every first-time December donor should begin a first-year plan now, not in March."]],
      ["Pull your LYBUNT list", ["Last year's donors who did not give in December are this year's first calls."]],
      ["Look at retention", ["Compare last year's retention to the year before, and pick one thing to improve."]],
    ],
  },
};

export const ART2_SLUGS = Object.keys(ART2);

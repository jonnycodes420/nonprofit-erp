// PROOF-2 · every statistic the marketing site quotes, in ONE list.
//
// A number on the site is only allowed if it is here: the guard in
// tests/landing2-marketing.test.js (section PROOF-2) reads every percentage
// and every "x times" figure in the marketing copy and fails the battery when
// one has no entry below, or when the page showing it does not also show that
// entry's link. /research renders this whole list so anyone can check us.
//
// Each entry: who published it, the report, its year and sample, the link,
// the date a person last opened that link and found the number there, and
// each claim in the source's own words. A figure inside a claim's words (the
// 10% in Sargeant's sentence) counts as that source's too. `label` is the citation line the
// pages print; the first five are the reference's SRC titles, character for
// character (the LANDING-2 guard compares them to docs/landing/steward-site.html).
//
// Survey findings are "reported", never "proven". Wording on a page follows
// the `claim`, not a rounder version of it.
//
// The in-app benchmarks (M+R sustainer retention, the FEP figure on the
// donor screens) live in shared/thresholds.js. They are product, not
// marketing copy, and the marketing site does not quote them.

export const SOURCES = {
  fep25: {
    source: "Fundraising Effectiveness Project (AFP and GivingTuesday)",
    report: "Q4 2025 report",
    year: 2025,
    sample: "Giving data from thousands of US nonprofits, full year 2025",
    url: "https://afpglobal.org/news/fundraising-effectiveness-project-reports-strongest-revenue-growth-five-years-even-fewer",
    label: "Fundraising Effectiveness Project, Q4 2025 report (AFP and GivingTuesday)",
    checked: "2026-10-03",
    claims: [
      { figure: "43.3%", claim: "Overall retention edged up from 43.1% to 43.3%, with repeat donor retention improving." },
      { figure: "5.0%", claim: "Total charitable dollars raised grew by an estimated 5.0% (±0.5%) in 2025 compared to 2024." },
      { figure: "3.6%", claim: "The number of donors declined by 3.6% (±0.5%), continuing a downward trend that began in 2021." },
      { figure: "5th", claim: "We are serving fewer donors for the fifth consecutive year (Woodrow Rosenbaum, GivingTuesday)." },
    ],
  },
  fep24: {
    source: "Fundraising Effectiveness Project (AFP and GivingTuesday)",
    report: "Q4 2024 Quarterly Benchmark Report",
    year: 2024,
    sample: "Giving data from thousands of US nonprofits, full year 2024",
    url: "https://afpglobal.org/sites/default/files/attachments/resource/FEP_Report_Q4_2024_Final.pdf",
    label: "Fundraising Effectiveness Project, Q4 2024 Quarterly Benchmark Report",
    checked: "2026-10-03",
    claims: [
      { figure: "19.4%", claim: "New donor retention rate: 19.4% retained." },
      { figure: "69.2%", claim: "Repeat donor retention rate: 69.2% retained." },
    ],
  },
  burk: {
    source: "Penelope Burk, as summarized by Big Duck",
    report: "Donor-Centered Fundraising",
    year: 2003,
    sample: "Donor research reported in the book; summary article by Big Duck",
    url: "https://bigduck.com/insights/how-one-phone-call-can-increase-donor-retention/",
    label: "Penelope Burk, Donor-Centered Fundraising, as summarized by Big Duck",
    checked: "2026-10-03",
    claims: [
      { figure: "39%", claim: "Donors who received a thank you call from a board member within 48 hours of making a gift gave 39% more the next time they were solicited." },
    ],
  },
  sarg: {
    source: "Adrian Sargeant, as summarized by Clairification",
    report: "Donor retention research",
    year: 2014,
    sample: "Research summarized in an article by Clairification (2014)",
    url: "https://clairification.com/2014/01/29/secret-mindblowing-fundraising-improve-donor-retention-just-10/",
    label: "Adrian Sargeant, donor retention research, as summarized by Clairification",
    checked: "2026-10-03",
    claims: [
      { figure: "200%", claim: "A 10% increase in donor retention can increase the lifetime value of your donors by as much as 200%." },
    ],
  },
  gusa: {
    source: "Giving USA, as reported by The NonProfit Times",
    report: "Giving USA 2026: The Annual Report on Philanthropy for the Year 2025",
    year: 2026,
    sample: "Estimates of all US charitable giving in 2025",
    url: "https://thenonprofittimes.com/?p=216959",
    label: "Giving USA 2026: The Annual Report on Philanthropy for the Year 2025, as reported by The NonProfit Times",
    checked: "2026-10-03",
    claims: [
      { figure: "64%", claim: "Individuals again led all funders with an estimated $394.2 billion, which was 64% of all giving." },
    ],
  },
  momentive25: {
    source: "Momentive Software",
    report: "2025 Nonprofit Trends Report",
    year: 2025,
    sample: "Survey of US nonprofit professionals, February to March 2025; published June 11, 2025",
    url: "https://momentivesoftware.com/newsroom/momentive-software-2025-nonprofit-trends-study",
    label: "Momentive Software, 2025 Nonprofit Trends Report",
    checked: "2026-10-03",
    claims: [
      { figure: "56%", claim: "56% of organizations with a donor retention strategy experienced revenue growth." },
      { figure: "77%", claim: "Organizations with a donor retention strategy reported donor retention rates of 77%." },
      { figure: "61%", claim: "Organizations lacking a retention strategy reported donor retention rates of 61%." },
      { figure: "46%", claim: "46% of organizations report having no donor retention strategy at all." },
    ],
  },
  sage25: {
    source: "Sage",
    report: "2025 Nonprofit Technology Impact Report",
    year: 2025,
    sample: "Survey of more than 350 nonprofit leaders",
    url: "https://www.sage.com/en-us/blog/nonprofit-tech-impact-report/",
    label: "Sage, 2025 Nonprofit Technology Impact Report",
    checked: "2026-10-03",
    claims: [
      { figure: "58%", claim: "58% said hiring and retention is their biggest external challenge." },
      { figure: "55%", claim: "Competition for funding (55%) ranked behind hiring and retention." },
      { figure: "49%", claim: "Economic uncertainty (49%) ranked behind hiring and retention." },
    ],
  },
};

export const SOURCE_KEYS = Object.keys(SOURCES);

// The research strip and StatBand rows: [figure, sentence, source key]. These
// are the reference's STATS, every number and every word.
export const STRIP = [
  ["43.3%", "of last year's donors gave again in 2025. More than half did not.", "fep25"],
  ["19.4%", "of first-time donors gave a second time the following year.", "fep24"],
  ["69.2%", "of repeat donors gave again. Get the second gift and everything changes.", "fep24"],
  ["5th", "straight year with fewer donors, even as total dollars rose 5.0%.", "fep25"],
  ["39%", "more on the next ask from donors thanked by phone within 48 hours.", "burk"],
  ["Up to 200%", "more lifetime value from a 10% lift in retention.", "sarg"],
  ["64%", "of all US giving in 2025 came from individuals: $394.2 billion.", "gusa"],
];

// The retention gap, as the homepage band and the pricing line use it.
export const RETENTION_GAP = { withStrategy: 77, without: 61, source: "momentive25" };

// "3 October 2026" from "2026-10-03", for the /research page and source lines.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const checkedOn = iso => { const [y, m, d] = iso.split("-").map(Number); return d + " " + MONTHS[m - 1] + " " + y; };

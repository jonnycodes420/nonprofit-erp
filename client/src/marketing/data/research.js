// The reference's SRC, STATS and QUOTES, exactly. Every number keeps its
// source. Do not add, round or reword a statistic: tests/landing2-marketing
// compares this file to docs/landing/steward-site.html.
export const SRC = {
  fep25: ["Fundraising Effectiveness Project, Q4 2025 report (AFP and GivingTuesday)", "https://afpglobal.org/news/fundraising-effectiveness-project-reports-strongest-revenue-growth-five-years-even-fewer"],
  fep24: ["Fundraising Effectiveness Project, Q4 2024 Quarterly Benchmark Report", "https://afpglobal.org/sites/default/files/attachments/resource/FEP_Report_Q4_2024_Final.pdf"],
  burk: ["Penelope Burk, Donor-Centered Fundraising, as summarized by Big Duck", "https://bigduck.com/insights/how-one-phone-call-can-increase-donor-retention/"],
  sarg: ["Adrian Sargeant, donor retention research, as summarized by Clairification", "https://clairification.com/2014/01/29/secret-mindblowing-fundraising-improve-donor-retention-just-10/"],
  gusa: ["Giving USA 2026: The Annual Report on Philanthropy for the Year 2025, as reported by The NonProfit Times", "https://thenonprofittimes.com/?p=216959"],
};

export const STATS = [
  ["43.3%", "of last year's donors gave again in 2025. More than half did not.", "fep25"],
  ["19.4%", "of first-time donors gave a second time the following year.", "fep24"],
  ["69.2%", "of repeat donors gave again. Get the second gift and everything changes.", "fep24"],
  ["5th", "straight year with fewer donors, even as total dollars rose 5.0%.", "fep25"],
  ["39%", "more on the next ask from donors thanked by phone within 48 hours.", "burk"],
  ["Up to 200%", "more lifetime value from a 10% lift in retention.", "sarg"],
  ["64%", "of all US giving in 2025 came from individuals: $394.2 billion.", "gusa"],
];

// Sourced research quotes. These are the ONLY quotes the site may carry: no
// testimonial or customer quote unless it is in APPROVED_TESTIMONIALS.
export const QUOTES = [
  ["The sector's strongest revenue growth in five years is encouraging, but it should not obscure the fact that we are serving fewer donors for the fifth consecutive year.", "Woodrow Rosenbaum", "Chief Data Officer, GivingTuesday", "fep25"],
  ["Long-term sustainability depends on a broader base of support. This report highlights the need for fundraisers to diversify their strategies.", "Ann Hale, CFRE", "Executive Vice President, AFP Foundations for Philanthropy", "fep25"],
];

// Testimonials and customer quotes cleared for the site. Empty until Jonathan
// approves one by name; the guard fails on any quote not in QUOTES or here.
export const APPROVED_TESTIMONIALS = [];

export const srcShort = key => SRC[key][0].split(",")[0];

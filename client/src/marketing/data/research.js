// The reference's SRC, STATS and QUOTES. PROOF-2 moved the numbers and their
// sources into shared/sources.js, the one list the whole site reads; this file
// keeps the reference's shapes so the pages and the LANDING-2 guard (which
// compares SRC, STATS and QUOTES to docs/landing/steward-site.html) are
// unchanged. Do not add, round or reword a statistic here: add it to
// shared/sources.js with its claim, link and the date it was checked.
import { SOURCES, STRIP } from "../../../../shared/sources.js";

// The reference's five, in its order, as [citation line, link].
const REFERENCE_KEYS = ["fep25", "fep24", "burk", "sarg", "gusa"];
export const SRC = Object.fromEntries(REFERENCE_KEYS.map(k => [k, [SOURCES[k].label, SOURCES[k].url]]));
// Every source, for pages that cite the newer ones (PROOF-2).
export const SRC_ALL = Object.fromEntries(Object.keys(SOURCES).map(k => [k, [SOURCES[k].label, SOURCES[k].url]]));

export const STATS = STRIP;

// Sourced research quotes. These are the ONLY quotes the site may carry: no
// testimonial or customer quote unless it is in APPROVED_TESTIMONIALS.
export const QUOTES = [
  ["The sector's strongest revenue growth in five years is encouraging, but it should not obscure the fact that we are serving fewer donors for the fifth consecutive year.", "Woodrow Rosenbaum", "Chief Data Officer, GivingTuesday", "fep25"],
  ["Long-term sustainability depends on a broader base of support. This report highlights the need for fundraisers to diversify their strategies.", "Ann Hale, CFRE", "Executive Vice President, AFP Foundations for Philanthropy", "fep25"],
];

// Testimonials and customer quotes cleared for the site. Empty until Jonathan
// approves one by name; the guard fails on any quote not in QUOTES or here.
export const APPROVED_TESTIMONIALS = [];

export const srcShort = key => SRC_ALL[key][0].split(",")[0];

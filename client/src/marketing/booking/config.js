// ONBOARD-4, BOOK-1 · WHAT /book READS. The booking link is shared/bookingLink.js's one value (the
// server reads the event's open times from it too); the page never names the booking tool.
export { BOOKING_URL } from "../../../../shared/bookingLink.js";

// BOOK-1 item 3: the quote is a customer's words (a paraphrase Jonathan approved). It stays hidden
// until she says yes; Jonathan flips this one value then.
export const showTestimonial = false;
export const TESTIMONIAL = {
  words: "When a $5,000 gift came in, Steward showed me the same donor gave $1,000 the year before and $500 before that. I took it straight to my executive director.",
  who: "Development Director, Kentucky",
};

// BOOK-1 item 4: Jonathan's photo, once he sends one (a path under client/public). Until then his
// initial in an emerald circle.
export const FOUNDER_PHOTO = null;

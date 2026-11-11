// server/give/checkoutName.js · TRUTH-3 item 8 (W-1107-Fundraising-34X). THE DONOR SEES THE CHARITY'S NAME.
//
// At Stripe's payment step a donor read the platform's name instead of the
// charity's. The session is created on the charity's own connected account
// (Stripe Connect, direct charge), and Stripe shows that account's public
// name, which an Express account may never have set. So every donation
// Checkout says the name itself, per org, where Stripe allows it:
//   · branding_settings.display_name  the name on the Checkout page
//   · statement_descriptor_suffix     the charity's name after the account's
//                                     prefix on the card statement (cards
//                                     take a suffix, not a full descriptor)
// The name is the donor-facing one (donorFacingOrgName: the public name if
// the org set one, else its name).
"use strict";

// Stripe: a descriptor is Latin letters, digits and spaces, at least one
// letter, none of < > \ ' " *, at most 22 characters with the prefix; the
// suffix is cut to fit (22 less a prefix of up to 10 and the "* " Stripe adds).
const SUFFIX_MAX = 10;
function descriptorSuffix(name) {
  const s = String(name || "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  let out = s.slice(0, SUFFIX_MAX).trim();
  if (s.length > SUFFIX_MAX) { const cut = s.slice(0, SUFFIX_MAX + 1).lastIndexOf(" "); if (cut >= 4) out = s.slice(0, cut).trim(); }
  return /[A-Z]/.test(out) ? out : null;
}

// The name on the Checkout page: the org's own words, at most 100 characters.
const displayName = name => (String(name || "").replace(/\s+/g, " ").trim().slice(0, 100) || null);

// What a donation Checkout session adds, for `name`. `card` is a one-time payment.
function checkoutIdentity(name, { oneTime = true } = {}) {
  const dn = displayName(name);
  const sfx = descriptorSuffix(name);
  return {
    session: dn ? { branding_settings: { display_name: dn } } : {},
    paymentIntent: oneTime && sfx ? { statement_descriptor_suffix: sfx } : {},
  };
}

// POLISH-9 (W-1110-Fundraising-02X): the LINE ITEM a donor reads on Checkout
// ("Donation to … Studio Scholarships") said the internal org name, "CREO Arts
// (Demo)". It takes the donor-facing name (`orgPublic`: donorFacingOrgName) and
// the fund's public name, never orgs.name or fin_funds.name when a public one
// is set. One builder, so no branch of the Checkout reads the internal name.
const fundLabel = fund => (fund && (String(fund.public_name || "").trim() || String(fund.name || "").trim())) || "";
function donationProductName({ orgPublic, auctionWin, memLevel, eventLevel, eventQty, eventRow, peerFundraiserId,
  pageTitle, fundraiserName, givingPageId, fund }) {
  const fundName = fundLabel(fund);
  if (auctionWin) return `${auctionWin.item.title}, ${auctionWin.auction.title} (auction), ${orgPublic}`;
  if (memLevel) return `${memLevel.name} membership · ${orgPublic}`;
  if (eventLevel) return `${eventQty} × ${eventLevel.name} · ${eventRow.name}`;
  if (peerFundraiserId) return `Donation to ${orgPublic} · ${pageTitle} (via ${fundraiserName}'s fundraiser)`;
  if (givingPageId) return `Donation to ${orgPublic} · ${pageTitle}`;
  return `Donation to ${orgPublic}${fundName ? ` ${fundName}` : ""}`;
}

module.exports = { checkoutIdentity, descriptorSuffix, displayName, donationProductName, fundLabel, SUFFIX_MAX };

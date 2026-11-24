// shared/contactDetails.js · CONTACT-1 item 1. HOW TO REACH A PERSON, READ ONE WAY.
//
// The rail's Contact section went missing on people who had a way to reach
// them. It asked only for `email`, `phone`, a contact person, or the rail
// read's address, so:
//   - a person with an address and no email or phone drew no Contact section
//     until GET /donors/:id/rail had answered, and none at all when that read
//     failed, while About offered "Add email or phone";
//   - a person whose workbook import filled `mobile` or `email2` (the second
//     email, the mobile column) and not `email`/`phone` drew none, and those
//     two never showed anywhere on the profile.
// The address line and the "is there anything" answer now come from here, for
// the rail read (server/donors/routes.js GET /donors/:id/rail) and the
// profile's rail (client RailAbout.jsx), from the person's own columns.
// Pure: no I/O.

const s = v => String(v == null ? "" : v).trim();
const HOME_COUNTRY = /^(us|usa|united states)$/i;

// One line: street, unit, "City, ST ZIP", and the country only when it is not
// the home country and there is an address to go with it ("US" alone is not
// an address). null when there is no address.
export function addressLine(d) {
  if (!d) return null;
  const street = [d.address, d.address2, [s(d.city), [s(d.state), s(d.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .map(s).filter(Boolean);
  if (!street.length) return null;
  const country = s(d.country);
  return [...street, ...(country && !HOME_COUNTRY.test(country) ? [country] : [])].join(", ");
}

// Every way to reach them that the person's own record carries, each once.
// The second email and the mobile are dropped when they repeat the first.
export function contactLines(d) {
  if (!d) return { email: null, email2: null, phone: null, mobile: null, address: null };
  const email = s(d.email) || null, phone = s(d.phone) || null;
  const e2 = s(d.email2), m = s(d.mobile);
  const digits = v => v.replace(/\D/g, "");
  return {
    email,
    email2: e2 && (!email || e2.toLowerCase() !== email.toLowerCase()) ? e2 : null,
    phone,
    mobile: m && (!phone || digits(m) !== digits(phone)) ? m : null,
    address: addressLine(d),
  };
}

// Is there anything for the Contact section to say? The person's own columns
// answer before the rail read lands; the rail's facts (a preference, a flag,
// the privacy row) add to it once it has.
export function hasContactDetails(d, contact, contactPerson) {
  const c = contactLines(d), cx = contact || {};
  return !!(c.email || c.email2 || c.phone || c.mobile || c.address || s(contactPerson)
    || cx.address || cx.preferred || cx.privacyOn || cx.isClient || (cx.flags || []).length);
}

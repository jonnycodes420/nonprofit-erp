// shared/dpa.js — TRUST-2 Part 3. THE DATA PROCESSING AGREEMENT, DRAFT.
//
// DRAFT PENDING ATTORNEY REVIEW. It is not published until Jonathan says an
// attorney has read it (DPA_PUBLISHED=1 on the server). Until then /dpa says
// it is with the attorney, and only a super-admin can read the draft.
//
// Every security measure below is true on the day this was written and is
// named on /security. Nothing here promises what the product does not do.
import { SUBPROCESSORS, WHEN_WORDS } from "./subprocessors.js";
import { LEGAL_ENTITY_NAME } from "./legalEntity.js";

export const DPA_DRAFT_LABEL = "Draft pending attorney review";
export const DPA_VERSION = "2026-10-01 draft";

export function dpaSections() {
  return [
    { h: "1. Who does what", p: [
      `This agreement is between your organisation (the "Customer") and ${LEGAL_ENTITY_NAME} ("Steward"). The Customer controls the personal data it puts into Steward and decides why it is used. Steward processes that data only to provide the service the Customer signed up for, and only on the Customer's instructions, which are this agreement, the terms of service and what the Customer does in the product.`,
    ] },
    { h: "2. What Steward processes", p: [
      "Information about the Customer's donors, members, volunteers and other contacts: names, contact details, addresses, giving history, notes, logged emails and meetings, event registrations and volunteer hours. Information about the Customer's staff who use Steward: names, email addresses, roles and sign-in records.",
      "Steward does not sell this data, does not use it to advertise, and does not combine it with any other customer's data.",
    ] },
    { h: "3. Staff and confidentiality", p: [
      "Only Steward staff who need access to provide or support the service can reach Customer data, and they are bound to keep it confidential.",
    ] },
    { h: "4. Security measures in place today", p: [
      "Every connection to Steward uses HTTPS. Credentials for the Customer's other tools are encrypted per organisation and never shown back in a browser. Every change, export, download and sign-in is written to an audit log the application cannot edit. Staff can use two-factor sign-in, and an owner can require it for the whole team. Each signed-in session can be seen and ended. Roles limit what volunteer coordinators and staff can reach. Database backups are handled by the database provider.",
    ] },
    { h: "5. Subprocessors", p: [
      "Steward uses the subprocessors listed at the end of this agreement and at stewardapp.dev/subprocessors. Steward will update that list before adding a new subprocessor that receives Customer data, and the Customer may object by writing to Steward.",
    ] },
    { h: "6. Requests from people about their data", p: [
      "Steward gives the Customer tools to answer a person's request: export everything held about one person in one file, and erase a person, which removes their name, contact details, notes and logged messages while keeping their gifts as anonymous gifts so the Customer's financial records stay accurate. Steward will help the Customer with any request the tools do not cover.",
    ] },
    { h: "7. If something goes wrong", p: [
      "If Steward becomes aware of a breach affecting Customer personal data, it will tell the Customer without undue delay, and will say what happened, what data was involved, and what Steward is doing about it.",
    ] },
    { h: "8. At the end", p: [
      "The Customer can export all of its data at any time from Settings. When the Customer's account closes, Steward deletes the Customer's data on request, except where the law requires Steward to keep a record.",
    ] },
    { h: "9. Subprocessor list", list: SUBPROCESSORS.map(s => `${s.name}. ${s.what} ${s.why} ${WHEN_WORDS[s.when]}.`) },
  ];
}

export default { dpaSections, DPA_DRAFT_LABEL, DPA_VERSION };

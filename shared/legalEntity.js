// The registered legal owner of Steward. Filed in Kentucky, 12 September 2026.
//
// ONE constant, in the shared seam BUILD-79 established (client imports it as
// ../../../shared/legalEntity, the server and the Node-side guards import it as
// ./shared/legalEntity.js, and shared/package.json's type:module marker makes
// both work). The name is a legal identification that has to be IDENTICAL on
// the © line, in Terms and in Privacy; three copies of a string is how two of
// them end up saying different things. So: no string literal of this name
// anywhere else in source — tests/legal-entity.test.js fails the build if one
// appears.
//
// THE PRODUCT IS STILL CALLED "Steward". This module is the legal OWNER, and it
// belongs only where an owner is named: the footer copyright, the Terms and
// Privacy party definitions, and any "operated by" line. It is not the app
// title, not the nav, not the email From name, not the domain.
//
// THE TAX ID IS NOT HERE, and is not anywhere in this repository. The legal
// name and the address are public; the EIN is not. tests/legal-entity.test.js
// enforces that permanently, against an allowlist of the synthetic demo EINs
// that were already in the tree (audit/FIX-legal-entity-FINDINGS.md §F).

export const LEGAL_ENTITY_NAME = "Steward Software LLC";

// Kentucky. Governing-law clauses say "the Commonwealth of Kentucky" — the
// long form is the one the documents already used, so both are exported and
// neither is spelled out a second time in a page.
export const LEGAL_ENTITY_STATE = "Kentucky";
export const LEGAL_ENTITY_STATE_LONG = "the Commonwealth of Kentucky";

// The address of record. Structured, because a receipt lays it out over lines
// and a paragraph runs it inline, and a second hand-written copy of a street
// address is how a ZIP gets transposed.
export const LEGAL_ENTITY_ADDRESS = {
  line1: "101 W Main St Apt 3",
  city:  "Wilmore",
  state: "KY",
  zip:   "40390",
};

export const LEGAL_ENTITY_ADDRESS_LINE =
  `${LEGAL_ENTITY_ADDRESS.line1}, ${LEGAL_ENTITY_ADDRESS.city}, ${LEGAL_ENTITY_ADDRESS.state} ${LEGAL_ENTITY_ADDRESS.zip}`;

// The © line, with the year COMPUTED. A hardcoded year is a claim that silently
// goes stale on 1 January; the landing page carried "© 2026" as a literal until
// this pass. The parameter exists so a test can pin the format without pinning
// the clock (the rule from BUILD-84: pin the input, never synchronise with the
// calendar).
export function copyrightLine(year = new Date().getFullYear()) {
  return `© ${year} ${LEGAL_ENTITY_NAME}`;
}

// The one sentence that turns "we" into a named party. Both legal documents
// were missing a counterparty entirely; this defines the term once, at the top,
// and every existing "Steward" in the body then resolves to the LLC without a
// word of the body changing.
export function operatedByLine() {
  return `Steward is operated by ${LEGAL_ENTITY_NAME}, a ${LEGAL_ENTITY_STATE} limited liability company, ${LEGAL_ENTITY_ADDRESS_LINE}.`;
}

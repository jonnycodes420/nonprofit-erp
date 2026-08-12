# BLOCKED — legal surface of the giving network (attorney pass, not code)

BUILD-46 §5 flags these for counsel BEFORE the flags are switched on in prod
(everything donor-visible is currently OFF — `DONOR_ACCOUNTS_ENABLED` /
`NETWORK_SIGNUP_ENABLED` unset). None of this was attempted in code.

1. **Consumer-account privacy policy.** Steward now (behind flags) holds a
   consumer relationship: donor emails, password hashes, cross-org giving
   aggregates computed at read time. The existing privacy page covers orgs'
   use of the CRM, not Steward's own consumer surface. Needs: what we store,
   the org-blindness promise ("each nonprofit sees only its own relationship
   with you"), alias verification, unlink semantics, deletion (account + links
   + PII deleted; each org's own records of its donors are unaffected — that
   exact sentence is already in the donor-facing copy and
   audit/portal-data-handling.md).
2. **ToS for the Portal tier.** Self-serve orgs agree to: truthful EIN/identity,
   the review gate, auto-delisting conditions (IRS list drop, Stripe
   restriction), content rules for impact updates, and that their donor data
   remains theirs.
3. **State charitable-solicitation registration.** The dashboard shows a donor
   THEIR OWN giving and lets them give again via the org's own giving page.
   Steward never solicits, never touches funds (org's own Stripe), and lists
   only orgs a donor already gave to — but whether the "give again" button on
   a Steward-branded surface triggers any state's solicitation-registration or
   commercial-co-venturer rules needs a real answer per state before launch.
   (Discovery/search of NEW orgs is explicitly out of scope v1 partly for this
   reason.)
4. **IRS data use.** Pub 78 bulk data is public domain; confirm no notice
   requirements for displaying "IRS: verified" claims to donors.
5. **Receipt aggregation.** The tax-summary view is labeled "for your records —
   consult your tax preparer" and computes nothing beyond ledger totals;
   confirm that framing suffices.

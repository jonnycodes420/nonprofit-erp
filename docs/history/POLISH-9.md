## POLISH-9 · What donors and boards see reads right (2026-11-11)

The lead's 10 Nov list. Each item was reproduced first, by real clicks on a production build (`NODE_ENV=production`,
the built client) against main's own server, on a made-up org shaped like the fleet's description
(`tests/lib/polish9Fixture.js`). `tests/polish9.test.js` is that walk: 17 of its 22 checks were red on main, and
all 22 are green after.

**Checkout said "(Demo)" (W-1110-Fundraising-02X).** The Checkout page's name already read the public name
(TRUTH-3), but the line item, "Donation to … Studio Scholarships", was built from `orgs.name`. On main a donor's
session read "Donation to Wrenfield Arts (Demo) Studio Scholarships". One builder now
(`server/give/checkoutName.js` `donationProductName`), from the donor-facing name and the fund's public name. The
same leak was swept from the other donor-visible Stripe lines: one-tap giving's description, staff donation links,
the recurring proposal page and its product, the designation-change email, and a fundraiser's drafts and share
text. The Brand kit has no public-name field of its own; the public name is the Donor portal's "Your
organization's public name", which `donorFacingOrgName` reads, falling back to the org's name when none is set.

**Four names for one year (W-1107-Fundraising-05).** The Board said "Giving this year", "Same point last year" and
"Change on last year" under "FY 2026–27". `periodLabel.yearPairNames` names the year, the one before and that one
to the same day, and the Board's labels come from it: "Giving, FY 2026–27", "Giving, FY 2025–26 to Nov 11".

**"$30,3…" (W-1109-Fundraising-03). OPEN.** Not reproduced: the panel's amounts were whole at 390, 768, 1024,
1280, 1440 and 1920 wide on main, with $30,350.50 against a long fund name, and the PDF wraps rather than cuts.
There is no ellipsis in the Board's code. §3 now guards it at those six widths.

**7 months beside 12 (W-1108-Atlas-11X).** Both sentences were already computed from steps. The draft's steps
were a copy taken before FIX-4 retimed the template, and choosing the template again handed that copy back. A
never-used draft from an older template now says so with the template's sentence and offers "Use its timing";
choosing the template refreshes it; `scripts/ops/journey-older-template.js` lists (and with `--apply` updates)
the drafts that already carry the old copy.

**An old receipt failing for ever (W-1109-Atlas-13X).** An import committed before MONEY-4's footing whose counts
do not foot reads "Before Steward checked imports (Sep 30)" on the list and the receipt, with Archive
(`imports.archived_at`, additive). Decided at read time, so existing rows need no repair.

**Preview as could not find Jonathan (W-1107-Fundraising-17).** FLOWS-3 never changed the finder. Its SQL has no
gift or type filter, but it orders by total giving and stops at 8, so a contact who never gave sorts after every
giver whose name matches: with nine "Jonathan A…" givers, Jonathan Ashgrove never showed. FLOWS-3's walk had one
"Juno" and no crowd. The finder now asks for people who never gave on their own (`gave=0`) and lists them under
the givers, marked "never given". And "we are asking the people who have given before to go first" takes its
no-gift wording for every copy when the audience holds anyone who never gave (preview, send and subject).

**"Jonathan turned email on Nov 3" beside "Mike Henderson, Nov 6" (W-1107-Fundraising-20).** The line read a
stored string set only by Steward's own staff. It now names the latest change to any email setting from the audit
log: "Mike Henderson last changed what sends on Nov 11, 2026."

**The old number after a save (W-1107-Finance-04X).** The gift edit threw away its answer and waited for the
profile to be read again; with a second's read, the header said $400 after saving $650. The edit now answers with
the person's four figures and the header draws from them. **Finance-42/43, the 5 to 10 second loads: OPEN.** On
the demo org locally, Fundraising and the giving reports were idle in under 1 s, and in 2.0 to 2.4 s with 400 ms
added to every read. The lead for the next brief: Fundraising reads the whole LYBUNT list to show one count.

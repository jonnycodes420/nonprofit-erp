import { Link } from "react-router-dom";
import { LEGAL_ENTITY_NAME, LEGAL_ENTITY_STATE, LEGAL_ENTITY_ADDRESS_LINE } from "../../../shared/legalEntity";

// Moved from "June 2, 2025" on 2026-09-12: the party/controller definition
// above is a change to the document, and a stale last-updated date beside a
// changed document is itself a false statement.
const LAST_UPDATED = "September 12, 2026";

// BUILD-96 Part 5 — THE PALETTE CENSUS RATCHETS, so this page names its four
// colours once instead of thirteen times.
//
// The subprocessor table added four more hex literals to a file that already
// repeated the same three, and the census (tests/palette-census.test.js) counts
// literals across the client and refuses to let the number grow. It was right
// to: this is a public page with its own palette, deliberately not T's, and
// "its own palette" is exactly the thing that turns into thirteen slightly
// different greys if nobody names it.
const INK = "#0f1a12";       // headings, and the nav
const BODY = "#3d4a42";      // running text
const RULE = "#ddd9d0";      // every hairline on the page
const GROUND = "#f0ede6";    // the page itself

function Nav() {
  return (
    <nav style={{ background: INK, padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <span style={{ fontSize: 20, fontWeight: 400, color: GROUND, fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
      </Link>
      <Link to="/" style={{ fontSize: 13, color: "rgba(240,237,230,0.7)", textDecoration: "none" }}>← Back to home</Link>
    </nav>
  );
}

const S = {
  page: { background: GROUND, minHeight: "100vh", fontFamily: "'DM Sans',system-ui,sans-serif" },
  body: { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.02em", lineHeight: 1.15, margin: "0 0 8px" },
  meta: { fontSize: 13, color: "rgba(240,237,230,0.7)", marginBottom: 48 },
  h2: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: "40px 0 12px", paddingTop: 8, borderTop: "1px solid " + RULE },
  p: { fontSize: 15, color: BODY, lineHeight: 1.75, margin: "0 0 16px" },
  li: { fontSize: 15, color: BODY, lineHeight: 1.75, marginBottom: 6 },
  ul: { paddingLeft: 20, margin: "0 0 16px" },
  a: { color: "#0d5c3a", textDecoration: "none" },
  // BUILD-96 Part 3 — the subprocessor table. `tableWrap` is not decoration:
  // this table has four columns on a 720px page and a phone is narrower than
  // its narrowest useful width, so it scrolls INSIDE its own box rather than
  // pushing the whole agreement sideways.
  tableWrap: { overflowX: "auto", margin: "0 0 16px", WebkitOverflowScrolling: "touch" },
  table: { borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 13.5, color: BODY },
  th: { textAlign: "left", verticalAlign: "top", padding: "8px 12px 8px 0", borderBottom: "1px solid " + RULE,
        fontWeight: 700, color: INK, lineHeight: 1.5 },
  td: { textAlign: "left", verticalAlign: "top", padding: "10px 12px 10px 0", borderBottom: "1px solid " + RULE,
        lineHeight: 1.6 },
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
      <Nav />
      <div style={S.body}>
        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.meta}>Last updated: {LAST_UPDATED}</p>

        {/* THE PARTY DEFINITION. This agreement named no counterparty at all
            until 2026-09-12 — "we" was an undefined term through fifteen
            sections. This paragraph fills that blank and nothing else: every
            existing "Steward" in the body below now resolves to the named
            entity, so no other wording changed. Source of truth for the
            wording of this document remains steward-terms-draft.md in Cowork
            (audit/FIX-legal-entity-FINDINGS.md, Part 3). */}
        <p style={S.p}>Steward is operated by <strong>{LEGAL_ENTITY_NAME}</strong>, a {LEGAL_ENTITY_STATE} limited liability company, {LEGAL_ENTITY_ADDRESS_LINE}. In these Terms, "Steward," "we," "us," and "our" mean {LEGAL_ENTITY_NAME}.</p>

        <p style={S.p}>Please read these Terms of Service ("Terms") carefully before using Steward. By accessing or using Steward, you agree to be bound by these Terms. If you do not agree, do not use the service.</p>

        <h2 style={S.h2}>1. Acceptance of Terms</h2>
        <p style={S.p}>By creating an account or using the Steward platform ("Service"), you agree to these Terms on behalf of yourself and the organization you represent. You represent that you have authority to bind your organization to these Terms.</p>

        <h2 style={S.h2}>2. Description of Service</h2>
        <p style={S.p}>Steward is a Software-as-a-Service (SaaS) customer relationship management platform designed for nonprofits, churches, and mission-driven organizations. The Service includes tools for donor management, grant tracking, email campaigns, financial reporting, and related features.</p>
        <p style={S.p}>We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time with reasonable notice.</p>

        <h2 style={S.h2}>3. User Accounts and Responsibilities</h2>
        <p style={S.p}>You are responsible for:</p>
        <ul style={S.ul}>
          <li style={S.li}>Maintaining the confidentiality of your account credentials</li>
          <li style={S.li}>All activity that occurs under your account</li>
          <li style={S.li}>Ensuring that all users you invite comply with these Terms</li>
          <li style={S.li}>Providing accurate and complete registration information</li>
          <li style={S.li}>Promptly notifying us of any unauthorized account access at <a href="mailto:legal@stewardapp.dev" style={S.a}>legal@stewardapp.dev</a></li>
        </ul>
        <p style={S.p}>You must be at least 18 years old to use the Service. Accounts may not be shared between organizations.</p>

        <h2 style={S.h2}>4. Payment and Billing</h2>
        <p style={S.p}><strong>Free Trial.</strong> Your first thirty days are free. The first charge is made thirty days after you sign up, on the date shown to you at checkout and in Settings &rarr; Billing. You may cancel at any time before that date and you will pay nothing. Nothing that happens inside those thirty days &mdash; importing your data, importing it again, or rescheduling onboarding &mdash; changes the date.</p>
        <p style={S.p}><strong>Reminder before the first charge.</strong> Seven days before the first charge we email your account administrator the date, the amount, the last four digits of the card on file, and a link that cancels the subscription in one click.</p>
        <p style={S.p}><strong>Subscription Plans.</strong> After your trial, continued use requires a paid subscription. Current plans and pricing are displayed at <a href="/pricing" style={S.a}>stewardapp.dev/pricing</a>. Prices are in USD and billed monthly.</p>
        <p style={S.p}><strong>Billing.</strong> Subscriptions are billed in advance on a monthly basis. You authorize us to charge your payment method for all fees incurred. All fees are non-refundable except as required by law or expressly stated herein.</p>
        <p style={S.p}><strong>Cancellation.</strong> You may cancel your subscription at any time through the billing portal in Settings. Cancellation takes effect at the end of the current billing period. You retain access to the Service until that date.</p>
        <p style={S.p}><strong>Failed Payments.</strong> If payment fails, we will attempt to retry. If payment is not resolved within 7 days, your account may be suspended. Your data is retained for 30 days after suspension before deletion.</p>
        <p style={S.p}><strong>Price Changes.</strong> We may change pricing with 30 days' advance notice. Continued use after the effective date constitutes acceptance of new pricing.</p>

        <h2 style={S.h2}>5. Data Ownership</h2>
        <p style={S.p}>You retain full ownership of all data you import, enter, or generate within the Service, including donor records, financial data, and documents ("Your Data").</p>
        <p style={S.p}>You grant us a limited license to store and process Your Data solely as necessary to provide the Service. We do not sell, rent, or share Your Data with third parties for marketing purposes.</p>
        <p style={S.p}>You are responsible for ensuring you have lawful authority to import and store donor information, and that doing so complies with applicable privacy laws.</p>

        <h2 style={S.h2}>6. Acceptable Use</h2>
        <p style={S.p}>You agree not to use the Service to:</p>
        <ul style={S.ul}>
          <li style={S.li}>Violate any applicable law or regulation</li>
          <li style={S.li}>Send unsolicited bulk email (spam) or harass individuals</li>
          <li style={S.li}>Upload malicious code, viruses, or harmful content</li>
          <li style={S.li}>Attempt to gain unauthorized access to any system or network</li>
          <li style={S.li}>Reverse engineer, decompile, or attempt to extract source code</li>
          <li style={S.li}>Resell or sublicense the Service without our written permission</li>
          <li style={S.li}>Use the Service in ways that compete with Steward</li>
        </ul>
        <p style={S.p}>We reserve the right to suspend or terminate accounts that violate this policy without refund.</p>

        <h2 style={S.h2}>7. Privacy and Data Security</h2>
        <p style={S.p}>Our collection and use of personal information is governed by our <Link to="/privacy" style={S.a}>Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
        <p style={S.p}>We implement industry-standard security measures including encrypted data transmission (TLS), encrypted storage, and access controls. However, no system is completely secure, and we cannot guarantee absolute security.</p>
        <p style={S.p}>In the event of a data breach affecting your organization's data, we will notify you as required by applicable law.</p>

        <h2 style={S.h2}>8. Intellectual Property</h2>
        <p style={S.p}>The Service, including its software, design, logos, and content, is owned by Steward and protected by copyright, trademark, and other intellectual property laws. These Terms do not grant you any rights in our intellectual property.</p>
        <p style={S.p}>"Steward" and the Steward logo are trademarks of Steward. You may not use them without our prior written consent.</p>

        <h2 style={S.h2}>9. Termination</h2>
        <p style={S.p}>Either party may terminate these Terms at any time. You may terminate by canceling your subscription and ceasing use of the Service. We may terminate or suspend your access immediately if you materially breach these Terms.</p>
        <p style={S.p}>Upon termination, your right to use the Service ceases immediately. You may request an export of Your Data within 30 days of termination. After 30 days, we may permanently delete Your Data.</p>

        <h2 style={S.h2}>10. Limitation of Liability</h2>
        <p style={S.p}>TO THE MAXIMUM EXTENT PERMITTED BY LAW, STEWARD AND ITS OFFICERS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE.</p>
        <p style={S.p}>IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRIOR TO THE CLAIM OR (B) $100.</p>
        <p style={S.p}>SOME JURISDICTIONS DO NOT ALLOW LIMITATIONS ON CERTAIN WARRANTIES OR LIABILITIES, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.</p>

        <h2 style={S.h2}>11. Disclaimer of Warranties</h2>
        <p style={S.p}>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.</p>

        <h2 style={S.h2}>12. Governing Law</h2>
        <p style={S.p}>These Terms are governed by the laws of the Commonwealth of Kentucky, United States, without regard to its conflict-of-law provisions. Any dispute arising from these Terms shall be resolved in the state or federal courts located in Kentucky, and you consent to personal jurisdiction there.</p>

        <h2 style={S.h2}>13. Changes to Terms</h2>
        <p style={S.p}>We may update these Terms from time to time. We will notify you of material changes via email or a notice within the Service at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.</p>

        {/* BUILD-89S 89f — connected giving sources. An organisation hands
            Steward a read credential to an account holding its own money, so
            what Steward may do with it is a term, not a help article. INTERIM
            alongside section 15, same attorney pass pending. */}
        <h2 style={S.h2}>14. Connected Giving Sources</h2>
        <p style={S.p}><strong>Steward never holds or moves your money.</strong> You keep whatever you take gifts through today. When you connect a giving source (PayPal, Zeffy, your own Stripe account, Givebutter), Steward reads completed gifts from it and records them on your donor records. It does not hold funds, initiate payments, issue refunds, cancel or alter a donor&apos;s recurring gift, or change anything in your account with that provider. Access is read-only, and you can disconnect at any time from Settings; the gifts already read stay on your records, because the money did arrive that way.</p>
        <p style={S.p}><strong>The credentials you provide.</strong> You represent that you are authorized to grant access to the accounts you connect, and you agree to provide read-scoped credentials where the provider offers them. Credentials are encrypted before storage and are never displayed back to you or to us after they are saved. Disconnecting a source destroys the stored credential. We are not responsible for what a credential broader than read access permits at the provider, which is why we ask for the narrowest one each provider supports.</p>
        <p style={S.p}><strong>What Steward does not guarantee.</strong> Steward reads on a schedule and depends on each provider&apos;s own API and publication delays; it is not a real-time feed and is not a system of record for your provider account. Your provider&apos;s own statements remain authoritative for what you received. Cash App and Venmo offer no way for software to read an account, so gifts taken through them are recorded only from statement files you upload.</p>

        {/* INTERIM — attorney replacement pending per BLOCKED-legal-network.md.
            Scoped to the donor-account + network-signup surfaces. */}
        <h2 style={S.h2}>15. Donor Accounts &amp; the Nonprofit Network</h2>
        <p style={S.p}><strong>Donor accounts</strong> are personal, free, and optional. You agree to register only email addresses you control. You may delete your account at any time; deletion removes your account and its links but does not alter any nonprofit's own records of its donors. Each nonprofit sees only its own relationship with you — we never share your giving at one organization with another.</p>
        <p style={S.p}><strong>Nonprofit network signup (Portal tier):</strong> by applying you represent that the information you provide — organization name, EIN, website, contact email — is truthful and that you are authorized to act for the organization. Listings are granted only after EIN verification against the IRS tax-exempt list, completed Stripe onboarding (donations settle only into your organization's own Stripe account — Steward never holds funds), and human review. We may decline, hold, or remove a listing at any time, and listings are automatically suspended if an EIN leaves the IRS list or a Stripe account is disconnected or restricted. Content you publish to donor-facing surfaces (impact updates, branding) must be truthful and yours to publish. The Portal tier covers the donor portal, gift recording, receipts, and impact updates; it does not include the Steward CRM.</p>

        {/* BUILD-96 Part 3 — THE SUBPROCESSOR TABLE.
            There was no such table until now, which was the gap: Resend has
            held every donor's name and gift amount since BUILD-88c and the
            agreement never named it. Cheque reading is what forced it — a
            photograph of a cheque is the most sensitive thing the product
            handles — so the table names all of them, not only the new one.
            INTERIM, same attorney pass pending as sections 14 and 15. */}
        <h2 style={S.h2}>16. Service Providers (Subprocessors)</h2>
        <p style={S.p}>Steward uses the following third parties to run the Service. Each sees only what the table says, uses it only to provide its part of the Service, and is bound not to use it for anything else. We will give notice within the Service before adding a subprocessor that receives donor data.</p>
        <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Provider</th><th style={S.th}>Purpose</th><th style={S.th}>What it receives</th><th style={S.th}>Location</th></tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}><strong>Resend</strong></td>
              <td style={S.td}>sending email on your behalf — appeals, receipts, statements, reminders, sequences</td>
              <td style={S.td}>the recipient&apos;s email address, the subject and the message body, which for a receipt includes a donor&apos;s name, gift amount and date</td>
              <td style={S.td}>United States</td>
            </tr>
            <tr>
              <td style={S.td}><strong>Anthropic</strong></td>
              <td style={S.td}>reading amounts from cheque photographs an organization chooses to upload, and drafting text from an organization&apos;s own records on its instruction</td>
              <td style={S.td}>the cheque photograph alone (no donor record, and no name lookup outside your organization), or the instruction, your vocabulary and the rows Steward selected for it. Images and records are <strong>not retained by the provider for training</strong>. Off until you enable it, and switchable off per organization in Settings</td>
              <td style={S.td}>United States</td>
            </tr>
            <tr>
              <td style={S.td}><strong>Railway</strong></td>
              <td style={S.td}>hosting the Service and its database</td>
              <td style={S.td}>everything you store in Steward, encrypted in transit and at rest</td>
              <td style={S.td}>United States</td>
            </tr>
            <tr>
              <td style={S.td}><strong>Stripe</strong></td>
              <td style={S.td}>your own giving account, and separately Steward&apos;s own subscription billing</td>
              <td style={S.td}>for giving, what a donor enters at checkout — Steward never holds the funds; for billing, your organization&apos;s own payment details</td>
              <td style={S.td}>United States</td>
            </tr>
            <tr>
              <td style={S.td}><strong>The giving sources you connect</strong></td>
              <td style={S.td}>reading completed gifts from accounts you already hold (PayPal, Zeffy, Givebutter, Square)</td>
              <td style={S.td}>nothing. Steward only reads; see section 14</td>
              <td style={S.td}>per provider</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p style={S.p}>Providers that receive nothing are listed so the table is the whole answer rather than the convenient part of it.</p>

        <h2 style={S.h2}>17. Contact</h2>
        <p style={S.p}>For questions about these Terms, contact us at <a href="mailto:legal@stewardapp.dev" style={S.a}>legal@stewardapp.dev</a>.</p>
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";

const LAST_UPDATED = "June 2, 2025";

function Nav() {
  return (
    <nav style={{ background: "#0f1a12", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <span style={{ fontSize: 20, fontWeight: 400, color: "#f0ede6", fontFamily: "'DM Serif Display',Georgia,serif", letterSpacing: "-0.02em" }}>Steward</span>
      </Link>
      <Link to="/" style={{ fontSize: 13, color: "#8fa896", textDecoration: "none" }}>← Back to home</Link>
    </nav>
  );
}

const S = {
  page: { background: "#f0ede6", minHeight: "100vh", fontFamily: "'DM Sans',system-ui,sans-serif" },
  body: { maxWidth: 720, margin: "0 auto", padding: "56px 32px 80px" },
  h1: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 40, fontWeight: 400, color: "#0f1a12", letterSpacing: "-0.02em", lineHeight: 1.15, margin: "0 0 8px" },
  meta: { fontSize: 13, color: "#8fa896", marginBottom: 48 },
  h2: { fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, fontWeight: 400, color: "#0f1a12", letterSpacing: "-0.01em", margin: "40px 0 12px", paddingTop: 8, borderTop: "1px solid #ddd9d0" },
  p: { fontSize: 15, color: "#3d4a42", lineHeight: 1.75, margin: "0 0 16px" },
  li: { fontSize: 15, color: "#3d4a42", lineHeight: 1.75, marginBottom: 6 },
  ul: { paddingLeft: 20, margin: "0 0 16px" },
  a: { color: "#1a6b4a", textDecoration: "none" },
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
      <Nav />
      <div style={S.body}>
        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.meta}>Last updated: {LAST_UPDATED}</p>

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
        <p style={S.p}><strong>Free Trial.</strong> New accounts receive a 30-day free trial with full access to the Service. No credit card is required to start a trial.</p>
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

        <h2 style={S.h2}>14. Contact</h2>
        <p style={S.p}>For questions about these Terms, contact us at <a href="mailto:legal@stewardapp.dev" style={S.a}>legal@stewardapp.dev</a>.</p>
      </div>
    </div>
  );
}

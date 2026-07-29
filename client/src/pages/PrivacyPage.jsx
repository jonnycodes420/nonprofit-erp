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

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
      <Nav />
      <div style={S.body}>
        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.meta}>Last updated: {LAST_UPDATED}</p>

        <p style={S.p}>This Privacy Policy describes how Steward ("we," "us," or "our") collects, uses, and shares information when you use our platform. By using Steward, you agree to the practices described in this policy.</p>

        <h2 style={S.h2}>1. Information We Collect</h2>
        <p style={S.p}><strong>Account Information.</strong> When you create an account we collect your name, email address, organization name, and password (stored as a bcrypt hash — never in plaintext).</p>
        <p style={S.p}><strong>Donor and Organization Data.</strong> We store all data you import or enter into the platform, including donor records, contact information, giving history, grant data, financial records, and notes ("Your Data"). This data belongs to you — see Section 4.</p>
        <p style={S.p}><strong>Usage Data.</strong> We collect information about how you use the Service, including pages visited, features used, and actions taken. This helps us improve the platform.</p>
        <p style={S.p}><strong>Payment Information.</strong> Subscription billing is handled by Stripe. We do not store your full payment card details — Stripe processes and stores payment information under their own privacy policy.</p>
        <p style={S.p}><strong>Communications.</strong> If you contact us by email or through the support widget, we retain those communications to help resolve your issue and improve our service.</p>
        <p style={S.p}><strong>Cookies and Local Storage.</strong> We use browser localStorage to store your authentication token and session preferences. We do not use third-party advertising cookies.</p>

        <h2 style={S.h2}>2. How We Use Your Information</h2>
        <p style={S.p}>We use information collected to:</p>
        <ul style={S.ul}>
          <li style={S.li}>Provide, operate, and maintain the Steward platform</li>
          <li style={S.li}>Process transactions and send billing-related communications</li>
          <li style={S.li}>Respond to support requests and troubleshoot issues</li>
          <li style={S.li}>Send product updates, security notices, and service announcements</li>
          <li style={S.li}>Improve and develop new features based on usage patterns</li>
          <li style={S.li}>Comply with legal obligations</li>
        </ul>
        <p style={S.p}>We do not use Your Data (donor records, financial data, etc.) to train AI models or for any purpose other than providing the Service to you.</p>

        <h2 style={S.h2}>3. AI Features</h2>
        <p style={S.p}>Steward uses Anthropic's Claude API to power AI features such as donor briefings, grant strategy, and email drafting. When you use an AI feature, relevant context (donor records, interaction history) is sent to Anthropic's API to generate a response. Anthropic's data handling is governed by their <a href="https://www.anthropic.com/privacy" style={S.a} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>
        <p style={S.p}>AI-generated content is not stored by Anthropic for training purposes under our API agreement. You should not submit sensitive personal data (e.g., Social Security numbers, medical information) into AI prompts.</p>

        <h2 style={S.h2}>4. Data Ownership and Storage</h2>
        <p style={S.p}>You retain full ownership of all data you enter into Steward. We do not claim any rights over Your Data.</p>
        <p style={S.p}>Your Data is stored in PostgreSQL databases hosted by Supabase on servers located in the United States. Data is encrypted at rest and in transit (TLS 1.2+).</p>
        <p style={S.p}>You can export Your Data at any time from within the application. Upon account termination, you may request a data export within 30 days; after that period, we may permanently delete Your Data.</p>

        <h2 style={S.h2}>5. Third-Party Services</h2>
        <p style={S.p}>We use the following third-party services to operate Steward:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong>Supabase</strong> — database hosting (United States)</li>
          <li style={S.li}><strong>Railway</strong> — backend server hosting (United States)</li>
          <li style={S.li}><strong>Vercel</strong> — frontend hosting and analytics (United States)</li>
          <li style={S.li}><strong>Stripe</strong> — payment processing; governed by <a href="https://stripe.com/privacy" style={S.a} target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a></li>
          <li style={S.li}><strong>Resend</strong> — transactional email delivery</li>
          <li style={S.li}><strong>Anthropic</strong> — AI API for in-app AI features</li>
          <li style={S.li}><strong>Google Gmail API</strong> — if you connect your Gmail account, we access your Gmail to sync donor email history and send emails on your behalf. We request only the minimum necessary scopes and do not read emails unrelated to donors in your Steward account.</li>
          <li style={S.li}><strong>Intercom</strong> — customer support chat widget</li>
          <li style={S.li}><strong>Sentry</strong> — error monitoring (may capture anonymized error traces)</li>
        </ul>
        <p style={S.p}>We do not sell, rent, or share Your Data with third parties for marketing or advertising purposes.</p>

        <h2 style={S.h2}>6. Gmail Integration</h2>
        <p style={S.p}>If you choose to connect a Gmail account, Steward requests access to read and send Gmail messages. We use this access solely to:</p>
        <ul style={S.ul}>
          <li style={S.li}>Sync email conversations with donors already in your Steward account</li>
          <li style={S.li}>Send emails to donors on your behalf from within Steward</li>
        </ul>
        <p style={S.p}>We do not read, store, or process Gmail messages unrelated to donors in your Steward account. You can disconnect Gmail at any time from Settings. Disconnecting revokes our access token and stops all Gmail syncing.</p>
        <p style={S.p}>Steward's use of Gmail data complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={S.a} target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

        <h2 style={S.h2}>7. Data Retention</h2>
        <p style={S.p}>We retain Your Data for as long as your account is active. If you cancel your subscription, your account enters a 30-day grace period during which your data is preserved and exportable. After 30 days, your data may be permanently deleted.</p>
        <p style={S.p}>We retain account information (name, email, billing records) for up to 7 years to comply with applicable tax and accounting laws.</p>
        <p style={S.p}>Password reset tokens expire after 1 hour and are permanently invalidated after use.</p>

        <h2 style={S.h2}>8. Your Rights</h2>
        <p style={S.p}>Depending on where you are located, you may have the following rights regarding your personal information:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong>Access</strong> — request a copy of the personal information we hold about you</li>
          <li style={S.li}><strong>Correction</strong> — request that we correct inaccurate information</li>
          <li style={S.li}><strong>Deletion</strong> — request that we delete your personal information</li>
          <li style={S.li}><strong>Portability</strong> — request your data in a machine-readable format</li>
          <li style={S.li}><strong>Opt-out</strong> — opt out of non-essential communications</li>
        </ul>
        <p style={S.p}>To exercise any of these rights, contact us at <a href="mailto:privacy@stewardapp.dev" style={S.a}>privacy@stewardapp.dev</a>. We will respond within 30 days.</p>
        <p style={S.p}>California residents: Steward does not sell personal information as defined under the California Consumer Privacy Act (CCPA). You have the right to know what personal information is collected about you and to request its deletion.</p>

        <h2 style={S.h2}>9. Children's Privacy</h2>
        <p style={S.p}>Steward is not directed to children under 13 years of age. We do not knowingly collect personal information from children under 13. If we learn we have collected such information, we will delete it promptly.</p>

        <h2 style={S.h2}>10. Security</h2>
        <p style={S.p}>We implement industry-standard security measures including encrypted data transmission (TLS), encrypted storage at rest, access controls, and regular security reviews. However, no system is completely secure. In the event of a data breach affecting your organization's data, we will notify you as required by applicable law.</p>

        <h2 style={S.h2}>11. Changes to This Policy</h2>
        <p style={S.p}>We may update this Privacy Policy from time to time. We will notify you of material changes via email or a notice within the Service at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.</p>

        <h2 style={S.h2}>12. Governing Law</h2>
        <p style={S.p}>This Privacy Policy is governed by the laws of the Commonwealth of Kentucky, United States. Any disputes arising from this policy shall be resolved in the state or federal courts located in Kentucky.</p>

        <h2 style={S.h2}>13. Contact</h2>
        <p style={S.p}>For questions about this Privacy Policy or to exercise your privacy rights, contact us at <a href="mailto:privacy@stewardapp.dev" style={S.a}>privacy@stewardapp.dev</a>.</p>
        <p style={S.p}>For general legal inquiries, contact <a href="mailto:legal@stewardapp.dev" style={S.a}>legal@stewardapp.dev</a>.</p>
      </div>
    </div>
  );
}

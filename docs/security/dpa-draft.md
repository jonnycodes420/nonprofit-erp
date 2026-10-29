# Data processing agreement (draft for a nonprofit to sign)

*SECURE-2 draft, 29 October 2026. **Draft pending attorney review.** Not for signature until an
attorney has read it. It follows the in-product draft (`shared/dpa.js`, served at /dpa once
`DPA_PUBLISHED=1`) and the subprocessor list (`shared/subprocessors.js`, served at
/subprocessors). If this file and those two disagree, those two are right and this file is fixed.*

---

This agreement is between **[Nonprofit legal name]** (the "Customer") and **Steward Software
LLC** ("Steward"), and forms part of the terms under which the Customer uses Steward.

## 1. Roles

The Customer controls the personal data it puts into Steward and decides why it is used.
Steward processes that data only to provide the service, and only on the Customer's
instructions: this agreement, the terms of service, and what the Customer does in the product.

## 2. What Steward processes

- **About the Customer's contacts:** names, contact details, addresses, giving history, notes,
  logged emails and meetings, event registrations and volunteer hours, and, if the Customer uses
  wealth screening, the results a screening provider returns.
- **About the Customer's staff:** names, email addresses, roles and sign-in records.

Steward does not sell this data, does not use it to advertise, and does not combine it with any
other customer's data. Steward's AI provider does not train on it.

## 3. Confidentiality

Only Steward staff who need access to provide or support the service can reach Customer data,
and they are bound to keep it confidential.

## 4. Security measures in place today

- HTTPS on every connection (HSTS); an encrypted database connection.
- Each organization's records are looked up only within that organization, and an automated
  test of that runs before every release.
- Passwords stored only as salted bcrypt hashes; repeated wrong passwords slowed and then
  blocked.
- Two-factor sign-in for every user, which an admin can require for the whole organization;
  required for Steward's own staff.
- Sessions a person can see and end; changing a password ends the others.
- Credentials for the Customer's other tools encrypted per organization (AES-256-GCM) and never
  shown back in a browser.
- An audit log of every change, export and sign-in, which the application cannot edit or delete.
- Roles that limit what staff and volunteer coordinators can reach; whole-organization export
  and deleting money someone else entered take an admin.
- Card details never touch Steward: gifts are processed by Stripe.
- Database backups handled by the database provider (Supabase).

## 5. Subprocessors

Steward uses the subprocessors below. The full, current list, with exactly what each receives,
is at stewardapp.dev/subprocessors. Steward updates that list **before** adding a new
subprocessor that receives Customer data, and the Customer may object in writing.

| Subprocessor | What it is for | Used |
|---|---|---|
| Supabase | The Postgres database every record lives in | Always |
| Railway | Runs the application; application logs; uploaded files (in Railway's S3-compatible storage bucket) | Always |
| Vercel | Hosts the website and the app's pages | Always |
| Resend | Sends and receives email | Always |
| Sentry | Error reports when something breaks | Always |
| Stripe | Online gifts through the Customer's own connected account; Steward's own billing | If connected |
| Anthropic | Drafting, reading checks and analysis; nothing is sent once the Customer turns AI off | When switched on |

Others apply only if the Customer connects or uses them (OpenAI for voice memos, Google,
Microsoft, Mailchimp, Constant Contact, QuickBooks, Xero, PayPal, Square, Zeffy, Givebutter,
Geocodio, OpenStreetMap, Google Fonts, a screening provider) and are on the full list.

## 6. Requests from people about their data

Steward gives the Customer tools to answer a person's request: export everything held about one
person in one file, and erase a person (removing their name, contact details, notes and logged
messages while keeping their gifts as anonymous gifts so the books stay right). Steward helps with
any request the tools do not cover.

## 7. If something goes wrong

If Steward becomes aware of a breach affecting Customer personal data, Steward tells the Customer
**without undue delay and within 72 hours**, saying what happened, what data was involved and what
Steward is doing about it, and gives the Customer what it needs to tell anyone else it must.

## 8. At the end

The Customer can export all of its data at any time from Settings, including after it cancels.
When the account closes, Steward deletes the Customer's data on request, except where the law
requires Steward to keep a record.

## 9. Signatures

Customer: ______________________ Name/title: ______________________ Date: __________

Steward Software LLC: ______________________ Jonathan Atkinson, Founder Date: __________

---

**Notes for Jonathan (not part of the agreement):**
- The brief named **AWS S3**. The code (`assetStore.js`) stores files in a Railway bucket through
  its S3-compatible API (`PORTAL_ASSETS_S3_*`), not in AWS, and `shared/subprocessors.js` lists
  that under Railway. If prod's `PORTAL_ASSETS_S3_ENDPOINT` is in fact an AWS endpoint, add AWS
  to `shared/subprocessors.js` (the public list and the in-product DPA read it) and to the table.
- Section 7's "within 72 hours" is new relative to `shared/dpa.js` ("without undue delay"). It
  matches `breach-plan.md`. Make the two agree once the attorney has read it.

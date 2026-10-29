# How Steward protects your donors' information

*For nonprofits evaluating Steward. Updated 29 October 2026.*

Steward holds your donors' names, contact details and giving history. This page explains how that information is kept safe, in plain terms. If you need more detail for a board or an auditor, write to jonathan@stewardapp.dev.

## Your data is yours, and only yours

- **Each organization is walled off.** Every request is tied to the signed-in person's organization, and every record is looked up within it. An automated test signs in as one organization and tries to read, change or find every other organization's records through every part of Steward. It runs before every release, and a release can't ship if it fails.
- **You can take everything with you.** An admin can export all of your data as spreadsheets at any time, including after you cancel.
- **Nothing is sold or shared.** Your donor list is never used for anyone else or pooled with other organizations' lists, and our AI provider doesn't train on it.

## Who can do what

- **Roles.** Admins manage the account, users, billing, sending settings and exports. Staff do the day-to-day work. Exporting the whole database, removing people and deleting money records someone else entered all take an admin.
- **Sign-in.** Passwords are stored only as salted hashes (bcrypt). Repeated wrong passwords are slowed and then blocked. Two-factor sign-in is available to every user, and required for Steward's own staff. Changing or resetting a password signs out every other session.
- **Idle sign-out and new-browser alerts.** An admin chooses how long a quiet session stays signed in (15 minutes to 8 hours). Signing in from a browser Steward hasn't seen for you sends you an email.
- **Every export is recorded.** Who took it, when, what and how many rows, in the audit log. A staff member exporting more than 1,000 people needs an admin.
- **Links expire.** Password-reset links last one hour and work once. Donor sign-in links last fifteen minutes and work once. Invitations last seven days. Every link is long and random; reset and donor sign-in links are stored only as a one-way fingerprint.

## How the service is built

- **Encrypted everywhere.** All traffic uses HTTPS (HSTS), and the database connection is encrypted. Card details never touch Steward: gifts are processed by Stripe.
- **Hosting.** The app runs on Vercel and Railway, and the database on Supabase (PostgreSQL), with automatic backups.
- **Hardened pages.** Uploaded images are checked byte by byte and stored only as plain images. Anything a donor types is treated as text, never as code. Pages refuse to be embedded by other sites, except the forms you choose to embed. Webhooks from payment and email providers are checked against their signatures.
- **Quiet logs.** Server logs and error reports carry no donor's or staff member's name, email, phone, address, full IP, password or session token.
- **A strict script policy.** Steward's pages run only Steward's own code; an injected script is refused by the browser.
- **A full record.** Every change to a donor, gift or setting records who made it and when, in an audit log the application can't edit or delete.

## Email and AI

- **A person sends.** Steward drafts and suggests, but nothing reaches a donor unless someone on your team wrote it or turned it on. Receipts and failed-payment notices are the only exceptions.
- **AI is optional and narrow.** You can switch it off for your organization. When it's on, it writes sentences from facts Steward has already worked out. It never decides anything and never sends anything.

## When something goes wrong

- We monitor errors and uptime around the clock.
- If an incident affects your data, we tell you promptly what happened, what it touched and what we did about it.
- Our most recent review was an internal security review of the whole application (October 2026). An independent penetration test is planned as our customer base grows.

*Steward Software LLC · stewardapp.dev · jonathan@stewardapp.dev*

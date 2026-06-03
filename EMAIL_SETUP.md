# Email Deliverability Setup — stewardapp.dev + Resend

Steward uses [Resend](https://resend.com) to send all transactional email (invites, password resets, email campaigns, donor sequences). This guide covers verifying `stewardapp.dev` in Resend so that emails reach inboxes rather than spam folders.

> **Status note:** If CLAUDE.md already says "Resend domain verified: stewardapp.dev", your domain is likely already verified. Run through the checklist in **Step 4** to confirm, then skip to **Step 5** to set the env var.

---

## Overview of records needed

| Type  | Host / Name                          | Value                              | Purpose                         |
|-------|--------------------------------------|------------------------------------|---------------------------------|
| TXT   | `stewardapp.dev`                     | `v=spf1 include:amazonses.com ~all` | SPF — authorizes Resend to send |
| CNAME | `resend._domainkey.stewardapp.dev`   | *(value from Resend dashboard)*     | DKIM — cryptographic signing    |
| CNAME | `resend2._domainkey.stewardapp.dev`  | *(value from Resend dashboard)*     | DKIM — second selector          |
| TXT   | `_dmarc.stewardapp.dev`              | `v=DMARC1; p=quarantine; rua=mailto:dmarc@stewardapp.dev` | DMARC — policy enforcement |

> **Important:** `stewardapp.dev` uses Vercel nameservers. All DNS records must be added through the **Vercel Dashboard → your project → Settings → Domains**, not through a registrar like Google Domains or Namecheap.

---

## Step 1 — Add the domain in Resend

1. Log in to [resend.com](https://resend.com) and open your workspace.
2. Go to **Domains** in the left sidebar.
3. Click **Add Domain**.
4. Enter `stewardapp.dev` and click **Add**.
5. Resend will display a set of DNS records to add. **Keep this tab open** — you'll copy values from here.

---

## Step 2 — Add DNS records in Vercel

Because `stewardapp.dev` is managed via Vercel nameservers, all DNS changes go through the Vercel dashboard.

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard).
2. Open the project that owns `stewardapp.dev`.
3. Go to **Settings → Domains**.
4. Click the `stewardapp.dev` domain, then click **Manage DNS Records** (or navigate to the DNS tab).
5. Add each record below, copying the exact values from the Resend dashboard:

### SPF record (authorizes Resend to send on your behalf)

If `stewardapp.dev` has **no existing TXT record**, add:

| Type | Name           | Value                              | TTL  |
|------|----------------|------------------------------------|------|
| TXT  | `@`            | `v=spf1 include:amazonses.com ~all` | 3600 |

If there is **already an SPF record** (starts with `v=spf1`), edit it to add `include:amazonses.com` before the `~all`:

```
v=spf1 include:amazonses.com [existing includes] ~all
```

> Do not create two SPF TXT records — that breaks SPF. Merge into one.

### DKIM records (two CNAME records)

Copy the exact host/value pairs from the Resend dashboard. They will look like:

| Type  | Name (Host)                             | Value (Points to)                                    | TTL  |
|-------|-----------------------------------------|------------------------------------------------------|------|
| CNAME | `resend._domainkey`                     | `resend.domainkey.u12345.wl123.sendgrid.net`         | 3600 |
| CNAME | `resend2._domainkey`                    | `resend2.domainkey.u12345.wl123.sendgrid.net`        | 3600 |

> The values above are examples — use the **exact values Resend provides** for your account.

> In Vercel DNS, enter only the subdomain part as the Name (e.g. `resend._domainkey`, not the full `resend._domainkey.stewardapp.dev`).

### DMARC record (instructs receiving servers what to do with failed mail)

| Type | Name      | Value                                                     | TTL  |
|------|-----------|-----------------------------------------------------------|------|
| TXT  | `_dmarc`  | `v=DMARC1; p=quarantine; rua=mailto:dmarc@stewardapp.dev` | 3600 |

Start with `p=quarantine`. Once you have confirmed clean deliverability for a few weeks, upgrade to `p=reject` for maximum protection.

> The `rua=` address receives aggregate DMARC reports. You can change it to any email address you monitor, or omit it entirely while getting started: `v=DMARC1; p=quarantine;`

---

## Step 3 — Wait for DNS propagation

DNS records can take anywhere from a few minutes to 48 hours to propagate, though Vercel's nameservers typically update within 5–15 minutes.

To check propagation before going back to Resend:

```bash
# Check SPF
dig TXT stewardapp.dev +short

# Check DKIM
dig CNAME resend._domainkey.stewardapp.dev +short

# Check DMARC
dig TXT _dmarc.stewardapp.dev +short
```

Or use [dnschecker.org](https://dnschecker.org) to verify across multiple global resolvers.

---

## Step 4 — Verify the domain in Resend

1. Go back to the Resend dashboard → **Domains**.
2. Click **Verify** next to `stewardapp.dev`.
3. Resend will check all three record types. Each should show a green checkmark:
   - ✅ SPF
   - ✅ DKIM
   - ✅ DMARC *(optional but strongly recommended)*
4. Once the domain shows **Verified**, you're ready to send.

---

## Step 5 — Set Railway environment variables

Once verified, set these two env vars in your Railway service:

1. Go to [railway.app](https://railway.app) → your Steward backend service → **Variables**.
2. Add or update:

| Variable               | Value                     |
|------------------------|---------------------------|
| `DEMO_SMTP_FROM`       | `noreply@stewardapp.dev`  |
| `RESEND_DOMAIN_VERIFIED` | `true`                  |

> `DEMO_SMTP_FROM` controls the "From" address for all Resend sends (sequences, campaigns, invites, password resets). Setting it to `noreply@stewardapp.dev` uses your verified domain.
>
> `RESEND_DOMAIN_VERIFIED` suppresses the startup warning in `server.js`. It has no runtime effect — it's a signal to the team that setup is complete.

3. Railway will automatically redeploy after saving variables.

---

## Step 6 — Test deliverability with mail-tester.com

[mail-tester.com](https://mail-tester.com) gives your emails a deliverability score out of 10.

1. Go to [mail-tester.com](https://mail-tester.com).
2. Copy the unique test address shown (e.g. `test-xxxx@mail-tester.com`).
3. Trigger a real email send from Steward — the easiest way is to use the **Invite Team Member** flow in Settings with the mail-tester address.
4. Go back to mail-tester.com and click **Then check your score**.
5. You should see **9/10 or 10/10**. Review any items flagged.

Common issues and fixes:

| Score item                  | Fix                                                                 |
|-----------------------------|---------------------------------------------------------------------|
| SPF not found               | TXT record not yet propagated — wait 15 min and re-check           |
| DKIM invalid                | CNAME values were copied incorrectly — double-check in Resend      |
| No DMARC record             | Add the `_dmarc` TXT record from Step 2                            |
| Blacklist hits              | Check [mxtoolbox.com/blacklists](https://mxtoolbox.com/blacklists) |
| Message-ID missing          | Not applicable — Resend adds this automatically                    |

---

## Step 7 — If emails still land in spam

Work through this checklist in order:

**1. Confirm your sending domain is verified in Resend**
Dashboard → Domains → status must be "Verified", not "Pending".

**2. Warm up the sending IP gradually**
If you're sending to a brand-new domain for the first time, ISPs are suspicious of volume spikes. Start with low volume (< 100 emails/day) and increase over 2–3 weeks.

**3. Check MX records exist on stewardapp.dev**
Even for a send-only domain, some spam filters penalize domains with no MX record. Add a low-priority MX pointing to a catch-all if needed:

| Type | Name | Value             | Priority |
|------|------|-------------------|----------|
| MX   | `@`  | `inbound.resend.com` | 10    |

**4. Review email content**
Spam filters score message content heavily. Avoid:
- All-caps subject lines
- Excessive exclamation marks
- Phrases like "Click here", "Free offer", "Act now"
- Image-only emails with no text
- Broken HTML

**5. Avoid sending to invalid addresses**
Resend tracks bounce and complaint rates. High bounce rates hurt your sender reputation. Use double opt-in for campaign audiences and periodically clean your donor email list.

**6. Set up a Google Postmaster Tools account**
Register `stewardapp.dev` at [postmaster.google.com](https://postmaster.google.com) to get Gmail-specific deliverability metrics (domain reputation, IP reputation, spam rate). This is the ground truth for Gmail delivery.

**7. Check Resend's sending logs**
Resend dashboard → **Emails** — look for bounces, complaints, or blocked sends. Each entry shows the full delivery receipt.

**8. Escalate to Resend support**
If you're doing everything right and still landing in spam with major providers, contact Resend support. They can check your dedicated IP reputation and assist with warming schedules.

---

## Quick reference — env vars for email

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx         # From resend.com → API Keys
DEMO_SMTP_FROM=noreply@stewardapp.dev  # Must match verified Resend domain
RESEND_DOMAIN_VERIFIED=true            # Set after verifying domain in Resend
```

---

## How email is sent in this codebase

All email goes through the Resend SDK in `server.js`:

```js
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: process.env.DEMO_SMTP_FROM || "onboarding@resend.dev",
  to: recipientEmail,
  subject: "...",
  html: "...",
});
```

Use cases that send email:
| Trigger                        | From address               | File          |
|--------------------------------|----------------------------|---------------|
| Team invite                    | `DEMO_SMTP_FROM`           | `server.js`   |
| Password reset                 | `DEMO_SMTP_FROM`           | `server.js`   |
| Email campaigns                | `DEMO_SMTP_FROM`           | `server.js`   |
| Donor sequences (drip emails)  | `DEMO_SMTP_FROM`           | `server.js`   |

Until `DEMO_SMTP_FROM` is set in Railway, the fallback is `onboarding@resend.dev` (Resend's shared test domain). This works for development but **will land in spam** for real recipients.

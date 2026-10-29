# Breach plan

*SECURE-2, 29 October 2026. One page. Read it before you need it.*

A breach is any time someone who should not have it could have read, changed or deleted a
customer's data: a leaked key, a bug that showed one org another org's records, a stolen laptop
with a signed-in session, a provider telling us they were breached.

## Who decides

**Jonathan decides.** He declares the incident, decides who is told and signs every notice. A
builder (a person or an agent) who suspects a breach stops what they are doing, writes down what
they saw and when, and tells Jonathan straight away. A builder never contacts a customer, never
reads prod data to "check", and never deletes logs or rows to tidy up.

## The first hour

1. **Write the clock down.** The time we first knew. The 72 hours below count from here.
2. **Shut the door.** Rotate whatever leaked: `JWT_SECRET` in Railway (signs everyone out), the
   Stripe, Resend, Anthropic and Supabase keys from their own dashboards, and
   `STEWARD_CREDENTIAL_KEY` only with a plan to re-seal (rotating it unseals nothing on its own;
   sealed connections must be reconnected). If a bug is the door, ship the fix or take the route
   down. If one account is the door, sign it out everywhere and reset its two-factor (Settings,
   Team).
3. **Keep the evidence.** Do not delete anything. The audit log is append-only and stays. Save
   the Railway HTTP logs and the Sentry events for the window before they age out.

## What we check

- **Which orgs.** The audit log (`fin_audit_log`) by org, actor and time; Railway's HTTP log for the
  routes and status codes; Sentry for errors in the window.
- **Which people and which fields.** Donor names and contact details, giving, notes, staff
  accounts, connected-tool credentials (sealed per org; check whether the key also leaked).
- **Whether anything left.** Exports and downloads (logged in the audit trail), email sent
  through Resend, calls to Anthropic.
- **Whether it is still open.** Re-run the attempt that worked. It must now fail.
- **Whether a provider is the source.** Supabase, Railway, Vercel, Resend, Stripe, Anthropic,
  Sentry: their status pages and any notice they sent.

## Who we tell, and by when

| Who | When | How |
|---|---|---|
| Each affected customer's admins | **Within 72 hours** of knowing, sooner if we can | Email from jonathan@stewardapp.dev, then a call |
| A customer whose data was not touched | Only if they would reasonably worry (for example a public provider breach) | Email |
| Regulators and donors | The customer is the controller and decides; we give them what they need to do it, the same day they ask | Email with the facts |
| Providers involved | As soon as we know | Their security contact |

If we do not know everything at 72 hours, we send what we know and say when the next update comes.
A notice never guesses: it says what is confirmed and what is still being checked.

## Template notice

> **Subject: A security incident affecting your Steward account**
>
> Dear [name],
>
> On [date and time] we learned that [one plain sentence: what happened]. It affected your
> organization's [what data: e.g. donor names and email addresses] between [start] and [end].
> [It did / We have no sign that it did] leave Steward.
>
> What we have done: [closed the cause; rotated keys; signed everyone out].
>
> What we are still checking: [list, or "nothing; this is the full picture"].
>
> What you may want to do: [e.g. sign in again and check Settings, Activity; tell your donors.
> If you decide to tell donors, we will give you a list of exactly who was affected].
>
> We are sorry. I will write again by [date] with [what], and you can reach me directly at
> jonathan@stewardapp.dev or [phone].
>
> Jonathan Atkinson, Steward Software LLC

## Afterwards

Within a week: a short dated write-up in `docs/HISTORY.md` (what happened, how we knew, what
closed it, the test that now keeps it closed), and a line on the public security page if
customers would want to know.

## 0-INBOX · GMAIL AND OUTLOOK, AND WHAT EACH REVIEW NEEDS (2026-09-30)

INT-4 moved Gmail onto the same signed-state, sealed-token handshake every other
connection uses, and added Outlook beside it. Three things in the OLD Gmail
integration are fixed by that move and are worth knowing about, because they
were live: the state was the bare user id and unsigned, the tokens were stored
in plaintext, and it held a `gmail.send` scope this product must never use.

**Nothing is needed from you for the deploy itself.** `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` are already set, the old
`/gmail/callback` path still works as a forwarder, and existing connections are
sealed automatically on the first boot after this ships.

**Google, to go past 100 connected people.** Gmail read scopes are RESTRICTED.
  · The consent screen is **In production**, not Testing (corrected 2026-09-30;
    this entry said Testing). Publishing it is not the same as passing
    verification: unverified restricted scopes still show the "Google hasn't
    verified this app" screen and are capped at 100 users, which is plenty for
    CKRH and the next several customers.
  · Production needs OAuth app verification AND an independent security
    assessment (a CASA assessment through a Google-approved lab). It is a real
    cost and a several-week process, so it is worth starting only when the
    hundredth mailbox is in sight.
  · Steward now asks only for `gmail.readonly`, which is the narrowest scope
    that can read a body. Dropping `gmail.send` also removes the hardest part
    of that review to justify.

**Microsoft, for Outlook.**
  · Register an app at entra.microsoft.com → App registrations, multi-tenant
    ("Accounts in any organizational directory and personal Microsoft accounts").
  · Redirect URI, on the APP: `https://www.stewardapp.dev/oauth/microsoft/callback`
  · Railway variables: **`MICROSOFT_CLIENT_ID`**, **`MICROSOFT_CLIENT_SECRET`**,
    **`MICROSOFT_REDIRECT_URI`**.
  · Scopes Steward asks for and cannot widen: `Mail.Read`, `User.Read`,
    `offline_access`, `openid`, `email`. Nothing that sends.
  · Publisher verification is needed for the consent screen to stop warning
    people, and a customer whose own tenant requires admin consent will need
    their IT to approve Steward once.

**The BCC path, wired on 30 September and corrected by FIX-11 Part 5.** This
entry previously named the wrong route and the wrong authentication, and
described the adapter as done when it was not. What is true now:
  · The route is **`/inbound-email`**, not `/resend/inbound`. There is no
    `/resend/inbound`; `/resend/webhook` is the DELIVERY webhook and is a
    different thing.
  · It accepts **either** an Svix signature (`RESEND_WEBHOOK_SECRET`, already
    set for the delivery webhook) **or** the shared secret
    `INBOUND_EMAIL_SECRET`, sent as `?secret=…` in the webhook URL or as an
    `x-inbound-secret` header. FIX-11 Part 5 added the signature path, because
    a secret in a URL lands in every proxy log between Resend and here. A
    request that claims to be signed and is not is refused outright rather than
    falling through to the secret.
  · **The Resend adapter now exists, and it had to.** Resend nests the whole
    message under `data`, so the route's recipient lookup found nothing and
    every message would have been dropped as "no_org" with only the drop
    counter to show it. And Resend's webhook carries **no body at all** —
    metadata and an `email_id` only — so the body is a second call to
    `GET https://api.resend.com/emails/receiving/{id}` with the Resend API key.
    A message whose body cannot be fetched is stored nowhere rather than filed
    as a subject with an empty note.
  · Subdomain: `log.stewardapp.dev`, which carries no other mail. In
    Resend → Domains, add it for RECEIVING and use the MX record Resend shows
    for your account and region; it must be the lowest-priority MX there.
  · In Resend → Webhooks, point `email.received` at
    `https://nonprofit-erp-production.up.railway.app/inbound-email`.
  · Railway variables: **`INBOUND_EMAIL_ENABLED=1`**,
    **`INBOUND_EMAIL_DOMAIN=log.stewardapp.dev`** and
    **`INBOUND_EMAIL_SECRET`** (or rely on the Svix signature alone).
  · Each org BCCs `log+<org-slug>@log.stewardapp.dev`, and that address is now
    shown to every staff member on Settings → Account with a copy button. It is
    ONE address per organisation: Steward knows which staff member sent a
    message because the sender has to be one of its users.
  · BCC logging is per organisation (`orgs.inbound_email_enabled`), on by
    default and **off for the demo org**, whose people are fictional.

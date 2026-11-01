## FIX-32 · Signup lands signed in, not on the login screen (2026-10-07)

Jonathan signed up on prod (org_8065d0d5 "TEST STEWARD"): Checkout and the webhook both worked
within four seconds, but the close link's `success_url` was `/login?welcome=1`, a password form
for an account with no password. Now a one-time key in the success URL, checked against Stripe's
own session and spent once, signs her in on `/signed-up` and sends her to onboarding; the page
waits up to 30 seconds for the webhook and then offers a link by email. The demo door hung
because it sent a not-yet-onboarded org to `/dashboard`, which bounced it back; loading the sample
now finishes onboarding, and sample donors no longer read as an import. His cancel in Stripe two
minutes later met a webhook that wrote `plan='core'` and three days of grace, which is where
"Reactivate", "until Oct 10" and the Team locks came from: a cancel inside the trial now keeps
everything until the trial ends with "Keep Steward", and every Core/Team gate is gone (one plan).
Golden journey J11 proves the whole path and was red on main (74/13).

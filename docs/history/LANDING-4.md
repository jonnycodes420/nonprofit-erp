## LANDING-4 · The language everywhere (2026-10-05)

`docs/MESSAGING.md` is the approved language (Jonathan, 4 Oct). `client/src/marketing/data/messaging.js`
is the one module every marketing page reads it from. The homepage is the headline, the vision, six
pillar bands each with a real Harborlight screen (`client/public/marketing/product/`, captured from the
local demo seed), how it works as the Ask why sequence, Lost & Found as the opening gift, and the line for
the careful ones. Product, Why, About, move, feature and tool pages open with their pillar; `/demo` opens
with the one-question promise. In the app: sign-in, sign-up, onboarding, the five empty states, the
guardrails line and the help centre's top ten intros.

Kept true, against MESSAGING.md: pillar 5 says "your payments and your email" (no books until QuickBooks
is live); pillar 6 says "never holds your money" (a person can refund from Steward); the closing line of
"how it works" says "Steward never sends anything you haven't approved" (receipts an org turns on do send).
On prod today the Anthropic account is out of credit, so the Agent's model-planned instructions fail; the
rule-based paths the Agent page describes (a new volunteer, a gift you tell it about) still work, and Ask
why, drift and the plain thank-you drafts do not use the model.

landing2-marketing now reads every rendered page for em dashes, the avoided words, "users" outside the
technical pages and plan prices outside `/pricing`, and checks the six pillar headings on Home against
MESSAGING.md. Each check was planted red before it was trusted.

## 0-DEVELOPERS · THE PUBLIC API, AND WHAT IS NOT DONE YET (2026-09-30)

INT-5 gave API keys real permissions, a call log and rate limits, and added
signed webhooks out. **Nothing is needed from you for any of it**: no new
variables, no third party, no review. Existing keys keep working and gain no new
power.

What is NOT built yet, and is the first thing to pick up next:
  · **Donorbox.** BUILD-92 Track C never started, so there is no adapter to
    extend: it is a fresh build. Donorbox charges for API access (their Pro plan
    and above at the time of writing, so worth confirming the current price on
    their pricing page before an org is told). Until then TRANS-1's Donorbox CSV
    path is the honest fallback.
  · **The Zapier app** (`zapier/`) is now built, registered and pushed. What is
    left is in 0-ZAPIER above.
  · **The `/developers` page.** The API is real; there is nothing public
    documenting it yet.

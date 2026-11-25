# ONBOARD-5 · For the fleet

**Surfaces changed:** the new full-page **Setup** at /onboard/setup (ten steps: Make it yours, Bring your donors,
Receipts and letters, Funds campaigns and events, How you talk, Where gifts come in, QuickBooks, Email, Invite your
team, You're set); Home's **Finish setting up · N of 10** card (replaces ONBOARD-4's five-step "Set up Steward" card
for an org in onboarding); Settings → Account's **Open the setup** link (every org); /ops → Onboarding's new
**Setup** column (step and skips); household Addressee (profile household panel and the household export) now
follows the org's "A couple is addressed as" choice; OAuth return for a connection started from Setup.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Settings → Account → "Open the setup". The page shows ten thin bars, "Step N of 10 ·
   <name>" and "About N minutes left". Click the 7th bar: QuickBooks, its logo, "Takes about 2 minutes. You sign in on
   QuickBooks's own page." Press "What we can see": the scopes list opens. Nothing on the page says Mailchimp.
2. **(Needs a write: org_stagewalk.)** On Setup → QuickBooks press **Skip for now**: the page moves to Email. Go to
   Home: "Finish setting up" says "Not connected yet: QuickBooks. You skipped it for now." Reopen /onboard/setup with
   no step: it opens on Email (where you left), not on step 1.
3. **(Needs a write.)** Setup → How you talk → Major gift → Custom → type `2,500`: the line reads "Someone who gives
   $2,500 or more in a year is a major donor". Press Continue. Donors → filter Giving level: Major: the count moves to
   the people who gave $2,500+ in the last 12 months. Off the path: Custom word with one letter `x`: the line says to
   type both words, and Continue stays on the page with a sentence.
4. **(Needs a write.)** Setup → Funds, campaigns and events: two campaigns with the same name show the second in brass
   with "Merge into …". Press it: the kept one's gift count is the two added; Campaigns has the merge with Undo.
5. **(Needs a write.)** Setup → Invite your team: type an address, choose a role. Nothing is sent until **Send invites**;
   then Settings → Team → Invited lists it. Off the path: type `not-an-email`: the button stays off and says why.
6. **(Read only.)** Setup → You're set: press the lifetime giving figure: the drawer lists everyone and foots to the
   cent; "lapsed 12+ months" opens the Lapsed tag's rows.

**What could have broken nearby:** Home's first card for an org in onboarding (FirstSession is no longer inside it;
the totals redirect is unchanged); the household Addressee on the profile and in exports (default unchanged:
"Debbie and Jeff Vogel"); /orgs/branding, /org/vocabulary and the giving-level cut points (the same routes Settings
uses); OAuthCallback for QuickBooks, Outlook and Google (lands on Setup only when started there, else Connections as
before); the /ops Onboarding table (one more column).

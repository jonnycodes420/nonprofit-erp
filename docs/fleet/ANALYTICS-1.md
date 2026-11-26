# ANALYTICS-1 · For the fleet

PostHog is on only on the production site. On staging it must send nothing: every check below is that the screens
behave as before, and that no request leaves for posthog.com.

**Surfaces changed:** every app page and every marketing page (a script that starts 3 s after load, production only);
/book (the booking form); a person's profile (header, Giving tab's gift rows, Contact tab: a hidden `data-ph-mask`
attribute, nothing visible); the Record a gift dialog; Home's and the profile's thank-you drafts (Open in my email,
I sent it); the Ask rail and the Atlas box; Communications → a campaign's Send; Import (spreadsheet and workbook);
Reports; Settings → Connections (an API-key source, and the OAuth return page); the Privacy page (a new PostHog line
under 5. Third-Party Services, Last updated November 26, 2026).

**Clicks to try for the next three nights:**
1. **(Read only.)** On staging, open Home, then a person's profile, then Reports, with the browser's network log open.
   Wait 10 s on each. No request goes to `us.i.posthog.com` or `us-assets.i.posthog.com`, and the console shows no
   Content-Security-Policy error.
2. **(Read only.)** Open /book?partner=<a known code>. Click into Your name, type, pick a day and a time. The form behaves
   as before: "Recommended by …" eyebrow, the time button turns on, Book is enabled. Off the happy path: pick a time,
   then pick another day: the time clears and Book says "Pick a time above".
3. **(Needs a write: org_stagewalk.)** Record a $25 gift for a person from Home's Record a gift, then one from the
   profile's Giving tab. Both save and show on the profile as before; the gift rows look unchanged.
4. **(Needs a write.)** Home → Thank-yous → open a draft → Open in my email (your mail app opens addressed), then
   I sent it → "Marked sent: …" with Undo. Press Undo: the draft is back.
5. **(Read only.)** Ask rail: ask "who stopped giving this year". The answer comes as before. Atlas box: type a short
   question and send; the answer comes as before.
6. **(Read only.)** /privacy: section 5 lists PostHog after Sentry, and the date reads November 26, 2026.

**What could have broken nearby:** main.jsx's sign-in, sign-out and org refresh (each now also tells the analytics
module; a throw there would blank the app), the support session's open and leave on /admin, the CSP on every page
(two hosts added to script-src and connect-src), the /book form's submit, the import result screens.

**Needs a write:** 3 and 4, in org_stagewalk only.

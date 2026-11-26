# ANALYTICS-1 · Steward reports how it's used to PostHog (26 Nov 2026)

Jonathan, 26 Nov: connect PostHog so he can see what customers actually do in Steward, without screenshots or asking.
One PR, five items, no new suite (the landing suite gained section 20).

## What happened
- **One module, loaded late.** `client/src/lib/analytics.js` is the only file that imports `posthog-js` (pinned 1.447.12,
  published 11 Nov), and only by dynamic `import()`, started by main.jsx's `LaterBeacons` 3 s after the load event, the
  same moment as Vercel's beacons. Until then calls wait in a queue of at most 200. The library is about 125 KB gzipped.
  The slim core plus `extension-bundles.js` was tried and came to 129 KB: that file is one prebuilt bundle and does not
  tree-shake, so the full module stayed.
- **The door.** The first build imported `analytics.js` from every screen: its filters and config rode on the entry, and
  perf-app read Home's first-look JS at 255 KB against main's 251 (budget 252). Screens now import
  `lib/analyticsDoor.js`, a queue of a few hundred bytes that fetches `analytics.js` only on the production host after
  load; the landing suite fails if anything else imports `analytics.js`.
- **Where it runs.** Only `www.stewardapp.dev` and `stewardapp.dev`, never under `navigator.webdriver` (prod smoke and any
  Playwright walk), so staging, localhost, previews, the fleet and the battery send nothing. Decided here: never on a
  donor's pages (`DONOR_PATHS`: /give, /portal, /giving, /embed, the volunteer and membership pages and the API's
  server pages). Those visitors are an org's donors, not Steward's customers.
- **What an event may carry.** `clean()` keeps numbers, booleans and short labels with no spaces (so no sentence and no
  "First Last"), drops an email-shaped value and any key naming a person, contact, money or free text (camelCase is
  split first, so `donorName` is caught). Autocapture keeps no element text (`mask_all_text`), and `scrubEvent` (the
  `before_send` hook) strips every element attribute except class, id, data-testid, role and type, drops page titles,
  and keeps only the `partner`, `report`, `section`, `tab` and `ref` query keys (a search box's words stay home). Without
  this, a click on a donor's row or the profile's Email link would have sent her name and address.
- **Who.** `identify(user.id)` with name, role, org id, org name and org kind; `group('organization', org.id, { name,
  org_kind, plan })`. A support session is never identified: it registers `support_session: true`, groups the org, and
  stays under the super admin's own id. Every event and pageview carries `org_id`, `org_kind`, `support_session` and
  `is_super_admin` as super properties.
- **The moments.** `gift_recorded` (the gift dialog, the profile, Finance's routing, a meeting's panel),
  `thank_you_marked_sent`, `draft_opened_in_email` (the thank-you's Open in my email), `atlas_asked` (the Ask rail, with
  the answer's kind), `tell_steward_used` (the Atlas box's POST /atlas, typed or voice, with its status),
  `campaign_sent`, `import_finished` (numeric fields of the result only), `profile_opened`, `report_opened` (the report
  id), `connection_connected` (OAuth callback and an API-key giving source), and /book's `book_form_started`,
  `book_time_picked`, `book_submitted` (stage pick, confirm or booked).
- **Replay.** On, with `maskAllInputs` and `maskTextSelector: "[data-ph-mask]"` on the profile header (name and contact
  line), gift rows and the Contact tab. Off on /start (ORDER-1's order and card), /quote, /signed-up: at init, and
  stopped on a route change into one.
- **The site.** The CSP's script-src and connect-src allow us.i.posthog.com and us-assets.i.posthog.com (the recorder and
  remote config load from the assets host). The privacy policy lists PostHog and its date moved to 26 Nov.

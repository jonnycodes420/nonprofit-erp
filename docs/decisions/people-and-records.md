# People and records

Read this when you touch the person record: donors, organisations, non-donors, households, photos, merge and duplicates, deletion, the timeline, the profile, volunteers or events.

## Rules
- **Record a second role on the same row, never a second record.** Donor, Volunteer, Staff and board, and
  Other are values in `donors.person_types`. (BUILD-94, BUILD-98)
- **Let `normalizeTypes` validate person types.** It drops unknown keys, and it sets an empty list to
  `["other"]`, never `["donor"]`, because calling a mailing-list contact a donor corrupts giving totals. (BUILD-94)
- **Splice `donorOnly(alias)` / `donorOnlySql` wherever "donors" means money.** The predicate treats NULL
  as a donor. `solicitableSql` means contact permission only; never fold "is a giver" into it. (BUILD-94)
- **A gift makes the person a donor inside `recordGift`, and it replaces "other".** Logging hours marks the
  person a Volunteer (`markVolunteer`). Someone created from a volunteer file is a Volunteer, never a donor. (BUILD-94, BUILD-98)
- **Say "people" in a count sentence once a non-donor is on the page.** When every row is a donor, keep
  the output byte-identical ("donors"). (BUILD-94)
- **Treat an organisation as a donor.** `donors.kind` is person, organisation or anonymous (NULL means a
  legacy person). A person named beside the organisation goes in `contact_name`, never into the donor's name. (BUILD-84)
- **Treat a funder's EIN as identity.** `donors.funder_ein` is unique, and an `ein_already_on_file` 409 is
  a merge, so present it as one. (BUILD-100)
- **Never move hard credit.** Household totals and household soft credit are derived at read time from the
  same gift rows. Never store either on a column. (BUILD-14)
- **Store a gift soft credit as a row pointing at the gift (`gift_soft_credits`).** Nothing that totals
  money reads it. Reports stay hard unless `?credit=soft`, which adds a column and changes no total or
  rank. (BUILD-98)
- **Keep households loose.** A person belongs to at most one. Deleting a household unlinks its members
  (SET NULL) and never cascades. Only one proposal per fund may be open per household. (BUILD-14, BUILD-99)
- **Wire every new donor-scoped table into `POST /donors/merge`** (reassign it, or let the primary win on a
  unique key) **and into purge-trash's FK-safe order.** Merge also moves shifts, soft credits, tribute
  notices and honouree/employer pointers, and drops any soft credit that became self-credit. (BUILD-08, BUILD-98)
- **OR the mail-blocking flags on merge** (`deceased`, `do_not_contact`). A survivor never loses a restriction
  that the other record carried. (BUILD-58)
- **Check every client-supplied donor, member or household id with an org-scoped ownership check**
  (`orgOwns`). A foreign id is a 404 and writes nothing. (BUILD-14)
- **Serve person photos only through the signed, expiring `/person-photos/<assetId>?e=&s=` link.** The HMAC
  covers the org id on the stored row. Expired and wrong-org both get the same 403. Never use
  `/portal-assets`. (BUILD-94)
- **Store a photo as a 512px square WebP, typed by its content, and discard the original.** SVG is refused. (BUILD-94)
- **Keep every bare asset-id pointer, including `donors.photo_asset_id`, in `collectLiveAssetRefs`.**
  Otherwise the 90-day purge deletes a face that is still on a live profile. (BUILD-94)
- **Draw a person with `PersonMark` everywhere**: the photo, or else initials on `var(--org-accent)`, and
  never a grey silhouette. Row surfaces read `GET /people/photos` once through `PhotoContext`, and the
  profile signs its own link. (BUILD-94)
- **Fetch a URL that a spreadsheet supplied only from a drainable queue, outside the import transaction.**
  Pass it through `checkRemoteImageUrl` and check again on `r.url` after redirects. Each row ends with a
  terminal status and the reason stored on the row. (BUILD-94)
- **Geocode once, at write time** (imports and `PUT /donors/:id`), through `markDonorsForGeocoding` and
  `processGeocodeQueue`. Never geocode from the browser. Skip rows whose `geocode_key` is unchanged, and
  dedupe addresses before spending a request. (BUILD-84)
- **Geocode through Geocodio (`GEOCODIO_API_KEY`) or a self-hosted `GEOCODE_NOMINATIM_BASE` only.** The code
  refuses the public Nominatim host. With neither set, no address leaves the server. The map always renders
  and states in a sentence what it lacks. (BUILD-84)
- **Match names with `shared/textMatch.js`, respecting word boundaries.** "Ann Lee" sits inside "Joann
  Leewood", so substring matching lands a gift on the wrong person. (BUILD-84)
- **A gift's timeline entry links to it (`interactions.gift_id`) and holds no copy of the amount.** If it
  does, the profile shows the gift twice. (BUILD-88a)
- **Write event attendance to a person's timeline once,** after claiming `event_attendees.attendance_logged_at`. (BUILD-98)
- **Record an event ticket as a gift through `recordGift`, with `quidProQuoValue`.** A fair-market value
  above the price is refused. The fair-market value is the org's number to enter, and Steward never
  estimates it. (BUILD-98)
- **Record an unpaid sponsor as a pledge with one instalment, never as money.** (BUILD-98)
- **Count volunteer hours in integer hundredths.** A shift must be more than 0 and at most 24 hours, enforced
  by the route and a CHECK. An imported shift is unique on (person, day, hours, role). (BUILD-98)
- **Staff copy the volunteer self-log link; Steward never sends it.** It is an HMAC over org, person and a
  180-day expiry. Its GET only renders, and a bad token is a 404. (BUILD-98)
- **Leave `stage` NULL until a human places someone,** and keep inferred stages in `suggested_stage`. Boards
  and portfolios read `COALESCE(stage, suggested_stage)`, and the card says which one it shows. (BUILD-83)
- **Show the first name everywhere through `firstNameOf`.** Keep the wealth score hidden until
  `WEALTH_SCORE_DEFINITION` and `WEALTH_SCORE_SOURCE` hold real strings. A vendor wealth screen is kept as
  text and never feeds `wealth_score`. (BUILD-88a, BUILD-99)
- **Put a hard bounce or a complaint on the person, with the date and reason, on the profile and the
  timeline.** `email_unreachable` blocks transactional mail too. (BUILD-94)
- **Serialise live donor creation per email with `withAdvisoryLock('donor:org:email')`.** Never add
  UNIQUE(email). (BUILD-27)
- **Never create a donor from inbound email.** Mail to an address that several people share (a couple, for
  example) waits in Unmatched. (BUILD-87)
- **Give each profile panel its own "couldn't load" state.** Do not swallow a failed fetch into an empty
  read (`.catch(()=>setX([]))`). Report a failed async stream in its panel. (BUILD-84, BUILD-98)

## Gotchas
- **An `<img>` backend path missing from vercel.json fails exactly like "no photo uploaded".** Proxy
  `/person-photos` and every bare backend path before the SPA catch-all. `scripts/local-preview.js`
  derives its table from vercel.json. (BUILD-95)
- **An `http://169.254.169.254` fixture is refused by the protocol check** and never exercises the
  metadata rule. Use an https URL for that case. (BUILD-94)
- **A `//` comment inside a SQL template literal is SQL.** It raised 42601 inside `recordGift`. Put the
  comment above the `await run(`, or use `--`. (BUILD-94)
- **A fixture that deletes an org with `.catch(() => {})` hides an FK failure** that surfaces as a
  duplicate key on the next run. Reuse the org with `ON CONFLICT DO UPDATE`. (BUILD-94)
- **An untracked new root module (`geocode.js`, `personPhoto.js`) fails in prod with `ERR_MODULE_NOT_FOUND`.**
  `git add` it before `deploy-shape` will pass. (BUILD-84, BUILD-94)
- **The donor profile fires an AI "next move" stream every time it opens.** Its failure is handled in the
  panel. Changing it to fire only on the button is Jonathan's decision. (BUILD-98)

## Where the code is
- `shared/personType.js` — the four types, `normalizeTypes` and `donorOnlySql`; `donorOnly(alias)` in `server.js`
- `server.js` `recordGift` — the one gift path, which also sets person types and writes extras
- `server.js` `POST /donors/merge`, `GET /donors/duplicates`, `householdView` — merge, duplicates, households
- `personPhoto.js` — photo sign/verify/initials/SSRF guard; `PersonMark` in `client/src/components/shared.jsx`
- `assetStore.js` `collectLiveAssetRefs` — the list of live pointers that the purge respects
- `geocode.js` — geocoding provider seam; `server.js` `markDonorsForGeocoding` / `processGeocodeQueue`; `GET /geocode/status`
- `shared/volunteerHours.js`; `server.js` `markVolunteer`, `signVolunteerToken` / `verifyVolunteerToken`
- `shared/eventShape.js` — tickets, levels and fair-market value; `shared/giftCredit.js` — soft credit
- `shared/textMatch.js` — boundary-respecting name matching

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Database tables (moved from the old "Database — key tables and columns")

### donors
- wealth_score (integer), capacity_tier (text), score_confidence (text), score_last_updated (timestamptz), score_rationale (text) — wealth scoring system
- stage (text), total_giving, last_gift_date, last_gift_amount, gift_count, tags (jsonb), notes
- status (text) — giving tier: new/mid/major/lapsed (separate from stage!)
- assigned_to (text), assigned_to_name (text) — MGO portfolio assignment
- city, state, zip — for Donor Map geocoding
- planned_giving (boolean) — set true when first planned gift is indicated
- stripe_customer_id (text) — captured at subscription checkout completion; needed to build a card-update Checkout session without the donor logging in (see "Recurring gift recovery" below)

### Donor deletion (soft delete + purge)
- `DELETE /donors/:id` (requireAuth + requireAdmin) — **also a soft delete** as of 2026-07-16: sets `deleted_at=NOW()` exactly like bulk-delete (it was a leftover hard DELETE that threw FK violations for any donor with gifts — a recurring Sentry error). 404 on unknown/cross-org/already-trashed. Hard deletion is purge-trash's job only.
- `POST /donors/bulk-delete` (requireAuth + requireAdmin) — soft delete: sets `deleted_at=NOW()`. "Trash." Directory/reports/donors.csv exclude trashed donors, but their gifts/interactions stay in the DB (and appear in exports via LEFT JOINs).
- `POST /donors/purge-trash` (requireAuth + requireAdmin, no body, API-only — no UI yet) — **permanent** hard delete of every trashed donor in the org plus all donor-scoped children, in FK-safe order inside one transaction: receipts + pledges first (they FK both donors AND gifts), then milestone_drafts/note_reminders/donor_materials/planned_gifts/custom_field_values/sequence_enrollments/payment_recovery_events/recurring_subscriptions/tasks/interactions, then gifts, then donors. Volunteers are unlinked (donor_id→NULL), not deleted; event_attendees keep the attendance record (FK is ON DELETE SET NULL); donor_relationships/campaign_recipients cascade themselves. `fin_transactions` deliberately untouched (org bookkeeping; has no donor_id column — see Finance tables note). Returns `{purged, children:{table:count}}`. Idempotent. Like all DELETE-shaped routes, never `checkWriteAccess`-gated. Built 2026-07-16 for the CREO test-donor cleanup (the "future permanent-purge" the bulk-delete comment anticipated).

### Duplicate merge (BUILD-08 Phase C — 2026-07-17)
Data-hygiene tool in the Donors area ("⇆ Merge duplicates" toolbar button → `MergeDuplicatesModal` in Donors.jsx). Reference pattern: Givebutter Data Hygiene — merge into the chosen primary, keep the non-primary's data.
- **`GET /donors/duplicates`** (requireAuth, staff-level, org-scoped, read-only) — candidate groups, two tiers: `email` (same email case-insensitive, the confident tier) and `name` (same normalized name, or edit distance ≤2 within a first/last-token bucket so detection never goes O(n²) org-wide). Declared BEFORE `/donors/:id` (Express order). Caps at 50 groups.
- **`POST /donors/merge`** `{primaryId, secondaryId}` (requireAuth + `checkWriteAccess` — staff-level deliberately, matching the everyday-hygiene bar of note-reminder sends, not the admin bar of purge; write-gated because its purpose is consolidation, not deletion, so the DELETE-routes-ungated convention doesn't apply). 404 on unknown/cross-org/trashed donors, 400 on self-merge. One transaction: plain `donor_id` reassign across gifts/interactions/pledges/receipts/milestone_drafts/note_reminders/donor_materials/planned_gifts/payment_recovery_events/recurring_subscriptions/tasks/volunteers/campaign_recipients; the three UNIQUE(x, donor_id) tables (`custom_field_values`/field_id, `sequence_enrollments`/sequence_id, `event_attendees`/event_id) resolve conflicts as **primary's own row wins**, secondary's duplicate dropped, non-conflicting rows moved; `donor_relationships` re-points both sides then drops now-self-referencing rows; blank primary scalar fields fill from the secondary (never overwrites non-blank — the officer chose the primary for a reason), tags union, `planned_giving` ORs; secondary is **soft-deleted** (trash, recoverable until purge-trash); a merge note is logged as a `note` interaction on the primary with reassign counts. `recalcDonorSummary` runs after commit (its `parseInt` on total became `parseFloat` with the Phase B NUMERIC migration).
- UI: candidate groups with SAME EMAIL / SIMILAR NAME badges → expandable side-by-side compare table → radio "keep this record" → confirm → merges every other record in the group into the primary via sequential pairwise calls. `isReadOnly`-gated merge button with the standard tooltip. Warm empty state when the list is clean.
- **Verified** (tests/donor-merge.test.js — committed, local scratch stack): **50/50** — detection both tiers, all 13 plain child tables + 3 unique-constrained tables reassigned with conflicts resolved correctly, relationship self-reference dropped, fill-blanks/preserve/tags-union, aggregates recalced ($140.50/3 gifts incl. a cents amount), soft-delete + merge note, pair disappears from duplicates after merge, cross-org 404 both directions with no side effects, trial_expired org 402. Plus a live UI pass driving a real merge through the modal. Screenshots: docs/donor-merge-2026-07-17/.

### interactions
- type: call | meeting | email | gift | event | note | stewardship | stage_change | planned_gift | material | email_open
- created_by (user_id), logged_by_name (user name display string)
- metadata JSONB — Gmail interactions store `{gmail_message_id, from, to, subject, direction}`; stewardship stores `{stewardship_type, detail}`
- `DELETE /interactions/:id` (requireAuth, org-scoped, 404 on zero rows; no `checkWriteAccess` per the DELETE-routes convention) — removes a mis-logged touchpoint. Everything is deliberately deletable, including Gmail-synced rows: the route records the message id in `gmail_sync_exclusions` first (see Gmail integration → Tables) so the deletion sticks across sync passes. UI: hover-reveal 🗑 (class `tp-del-btn`, always visible ≤768px) on `TouchpointTimeline` entries (Overview tab) and the Activity Log cards in Donors.jsx — browser-confirm, optimistic removal, refetch on error. Grants.jsx also renders `TouchpointTimeline` but for `grant_interactions` rows — it passes no `onDelete`, so no icon there (this route only handles `interactions`)

### Voice memo capture (shelved)
Backend, Whisper transcription, and extraction logic are fully built and functional — **shelved from the UI only** (2026-07-12) as an unproven-adoption-assumption bet, not a broken feature. Re-enable by uncommenting the `VoiceMemoModal` import/state/button in App.jsx and Donors.jsx (marked `// SHELVED — ...` at each site).
- Two-step, human-in-the-loop flow: `POST /voice-memos/transcribe` uploads audio + transcribes via Whisper + runs one narrow Claude extraction pass, but **saves nothing** — the officer reviews the transcript and suggestions client-side first. `POST /voice-memos/save` (checkWriteAccess) is the only route that persists anything (the interaction, and optionally the extracted detail/follow-up task, only for whichever the officer confirmed).
- Requires `OPENAI_API_KEY` (Whisper) — was never actually added to Railway, so this was never live end-to-end even before being shelved. If unset, `/voice-memos/transcribe` returns a clear 500 rather than failing silently or stubbing a fake transcript.
- `VoiceMemoModal` component still lives in shared.jsx, unused but intact.

### DonorProfile tab system (left panel)
- Tabs: Overview | Gifts & Pledges | Funds | Materials | Activity
- Overview: stat cards, giving history chart, tags, notes, tasks, touchpoint timeline (unchanged)
- Gifts & Pledges: full gift table with inline edit/delete, Add Gift form with campaign attribution, CSV export, planned giving section
- Funds: fund affinity bars, restricted vs unrestricted split, suggested ask callouts
- Materials: drag-and-drop upload, base64 <1MB, view/delete grid
- Activity: mode toggle (Activity Log | Stewardship Timeline); type filter pills; Log Stewardship form (8 types); vertical timeline with auto-detected milestones

### Events tables
- `events` — id, org_id, name, event_type (gala/cultivation/site_visit/board_meeting/volunteer/webinar/other), date DATE, end_date DATE, location, description, capacity INTEGER, status (upcoming/completed/cancelled), revenue NUMERIC, cost NUMERIC, notes, created_at
- `event_attendees` — id, event_id (FK→events CASCADE), org_id, donor_id (FK→donors SET NULL), name, email, status (invited/confirmed/attended/no_show/cancelled), gift_amount NUMERIC, notes, UNIQUE(event_id, donor_id). PATCH to 'attended' + gift_amount > 0 auto-logs gift to donors/gifts/fin_transactions.
- Event type colors: gala=#8b5cf6, cultivation=#10b981, site_visit=#3b82f6, board_meeting=#0d5c3a, volunteer=#f59e0b, webinar=#ec4899, other=#6b7280
- Routes: GET/POST /events, PUT/DELETE/GET /events/:id, POST /events/:id/attendees, PATCH/DELETE /events/:id/attendees/:attendeeId, POST /events/:id/follow-up, GET /donors/:id/events

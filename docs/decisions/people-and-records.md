# People and records

Read this when you touch the person record: donors, organisations, non-donors, households, photos, merge and duplicates, deletion, the timeline, the profile, volunteers or events.

## Rules
- **The tags under a donor's name are computed, never stored, from one definition.** `donorStatus.js`
  `statusSql` gives the giving level (General, Mid, Major on the last 12 months against
  `orgs.giving_level_mid_cents` / `giving_level_major_cents`, Settings, Giving levels; defaults $1,000 and
  $10,000), the lifecycle (New, Current, Recaptured, Lapsed on two 12-month windows) and Retained (last
  calendar year and this one). The profile, the list filters, Groups, the dashboard's level chart and the
  `donors-by-status` source all read it. A refund comes off the 12-month total but never counts as "gave".
  `tests/parity1-donor-tags.test.js` pins the edges. (PARITY-1)
- **The closeness word is ENGAGE-1's band in words.** Close and Warm are the bands; Distant reads New
  when the person's first gift, conversation or shift is in the last 90 days, otherwise Cooling
  (`closenessFor` in shared/engagementWeights.js; `closenessSql` in donorStatus.js for lists). Never a
  second score. (PARITY-1)
- **A Group is an `audiences` row.** `kind` 'dynamic' keeps `rules` (the donor list filters, evaluated
  live by `groups.js buildDonorFilter`, so membership is never stored); 'static' keeps its people in
  `group_members`. No second list table. (PARITY-1)
- **An event has a GOAL, and what it RAISED is never typed.** `events.goal_amount` is what the
  night is measured against; raised is summed from gifts stamped `gifts.event_id`, which
  registration sets. Before this the only link was the campaign NAME, so a renamed event lost its
  money; the campaign match survives as a fallback for rows written before the column. (EVENTS-1)
- **Every event figure opens its rows, from the same SQL.** `EVENT_ROW_SQL` holds one query per
  number and both the figure and `GET /events/:id/rows` run it, so a count and its list cannot
  drift. The raised rows foot to the figure to the cent. The report says in its payload that it
  does not claim the event CAUSED a gift. (EVENTS-1)
- **A named guest is a person with a seat and NOT a second place.** A guest brought on somebody
  else's ticket carries `quantity 0` and `guest_of`. Counting them needs `quantity == null ? 1 :
  quantity`, never `quantity || 1`, which turns every zero back into a place. (EVENTS-1)
- **The public registration page is a REQUEST, not a payment.** `/e/:slug` wears the org's band
  from the one public shell (`shared/publicPage.js`, shared with the volunteer page), frames like
  a donation form, states the deductible part before the button, and says plainly that nothing is
  charged there. A registration lands as an attendee the office confirms, and confirming it runs
  `registerForEvent` — the one writer that turns a registration into a gift with its split. Taking
  the card inline is a Connect checkout plus a webhook branch that completes the registration, and
  half of that charges somebody for a seat they do not get. (EVENTS-1)
- **A name tag carries a name and a table and nothing else.** A badge that prints somebody's
  giving level tells the room what they gave. (EVENTS-1)
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
- **A merge is Data health's `mergePeople` (routes/dataHealth.js), and every person pointer is in `MERGE_REFS`.**
  `POST /donors/merge` delegates to it. A new column that points at a person (REFERENCES donors, or named
  donor_id / person_id / *_donor_id / *_person_id) goes into `MERGE_REFS` in the same commit, or into
  `NOT_MOVED` with the reason; `tests/clean1-merge.test.js` reads db.js and fails otherwise. A row that
  would break a unique key is set aside whole (the kept person's twin wins) and comes back on undo; a table
  where both rows are real records a person must end first (current membership, year-end statement, open
  proposal per fund, active plan, a source's recurring gift) is `refuse` and the merge stops with a sentence.
  The money foots inside the transaction or nothing is written. Undo restores both people and every row
  exactly for 30 days. Never merge two people from different households in bulk. (BUILD-08, BUILD-98, CLEAN-1)
- **Steward suggests; staff apply.** Data health (`dataHealth.js` is the pure rules) proposes duplicates,
  address tidies (offline, `parse-address`, flagged rather than guessed whenever a word would be lost),
  email fixes and change-of-address moves; each change is a POST a person pressed. "Not a duplicate" is a
  `data_health_dismissals` row by the two ids, so it survives every later import. A bounce mark clears only
  on a separate confirm. The old address is kept in `donor_address_history`. (CLEAN-1)
- **OR the mail-blocking flags on merge** (`deceased`, `do_not_contact`). A survivor never loses a restriction
  that the other record carried. (BUILD-58)
- **Check every client-supplied donor, member or household id with an org-scoped ownership check**
  (`orgOwns`). A foreign id is a 404 and writes nothing. (BUILD-14)
- **An email's attachment stays in the mailbox it came to.** Mailbox sync counts attachments and
  never stores them (the sentence a person agrees to when connecting says so). Every count the app
  shows links to the message in that Gmail or Outlook mailbox, on the email and under the
  Attachments filter (`routes/finance.js mailFileOf`). Storing them would change that promise: a
  decision for Jonathan, not a build. (FIX-22)
- **A file on a conversation or a note is a row in `interaction_attachments`, and its bytes live in the
  asset seam.** `assetStore.js` under kind `ixfile`: the S3-compatible bucket when `PORTAL_ASSETS_S3_*` is
  set, Postgres (`portal_assets`) otherwise. The cap is 10 MB of decoded file, and it and the 16mb body
  parser on `POST /interactions/:id/attachments` are one decision (move both or neither). The types are a
  closed list (PDF, PNG, JPEG, GIF, WebP, HEIC, Word, Excel, CSV, plain text; never SVG or HTML) and the first
  bytes must match the declared type where a signature exists (`interactionFiles.js`). A file opens only
  through `/interaction-files/<assetId>?e=&s=`, a thirty-minute link minted per read for signed-in staff of
  the org, always as a download with nosniff. Delete is soft (`deleted_at`); the bytes age out through the
  90-day retention sweep, and a live row keeps them (`collectLiveAssetRefs`). **Nothing scans these files for
  viruses**: Railway offers no scanner and Steward runs none, which the form says. Adding one means a ClamAV
  sidecar service (or a hosted scanning API) called between the byte check and `putThemeAsset`, with the file
  held back until it answers clean. (PARITY-1)
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
- **Whoever logged an entry, or an admin, may edit or delete it** (`mayEditLogged`, routes/crm.js).
  Conversations (`PUT /interactions/:id`), next steps (`PUT/DELETE /threads/:id`) and tasks. An edit
  stamps `edited_at/edited_by/edited_by_name`; the previous values live only in the audit row, which
  the "Edited" marker reads (`GET /records/:id/history`). A calendar meeting's time and place belong
  to the calendar: Steward refuses to change them and links there (`PUT /calendar/events/:id` edits
  only the note, next step and people). (FIX-14)
- **A delete that offers Undo moves the row to `deleted_records`** (`trashRow`) and Undo puts it back
  whole (`POST /deleted-records/:id/restore`). No reader learns a deleted_at column. (FIX-14)
- **Every Undo toast comes from the one host** (`offerUndo` in `EditHistory.jsx`, mounted on
  document.body). A screen never renders its own toast: one drawn inside the screen dies when that screen
  re-renders away. The ten seconds stop while the pointer or focus is on it or the tab is hidden. (FIX-25)
- **Pledges, asks, relationships and households follow the same rules** (owner or admin, `edited_*`,
  delete via `trashRow` with an `undoId`). Rows that go with a row (a pledge's instalments, a
  household's members, a calendar meeting's `interaction_id`) ride in `row_data.__with` and Undo puts
  them back (`TRASH_WITH` / `RESTORE_WITH`). A pledge with any payment applied is never deleted: 409
  with a sentence; write it off instead. (FIX-14 Part 2b)
- **An audit row's Description is built on read** (`auditTrail.describeAuditRow`, names resolved by
  id in `auditPeople`), and an edit carries `changes.record.donor_id` so it stays findable by person.
  The log's home is Settings, Audit log; Finance, Exports links there. (FIX-14)
- **A volunteer file is FOUR column families, not one.** `shared/volunteerImport.js` reads people,
  contact details, hours history, and the two dated things that decide whether somebody may work
  (waiver, background check) out of one file. Five presets: VolunteerHub, SignUpGenius, Wranglr,
  Bloomerang Volunteer, and a plain spreadsheet, which is what a small organisation usually has.
  The vendor preset maps first and the plain reader FILLS WHAT IT DID NOT NAME, because a real
  export has been edited: a "Waiver Signed" column somebody added to a SignUpGenius report was
  silently dropped until it did. A credential cell that is a TICK ("yes", "signed") and not a date
  is refused by line and reason, never given today's date: what a screening is worth is its date.
  A shift dated in the future is a sign-up, not hours worked, and is refused too. (VOL-2)
- **The preview writes nothing and the import re-plans.** Same shape as the donor and grant
  imports: the browser parses with `parseFileToSheets`, the SERVER decides everything in
  `POST /volunteer-hub/import/preview`, and `POST /volunteer-hub/import` re-plans from the rows
  rather than trusting the screen. People are matched by EMAIL FIRST, then by name when exactly
  one person has it, so a volunteer who already gives is linked to the record they already have.
  (VOL-2)
- **The undo is exact, by import id.** Every row an import creates is stamped with its
  `imports.id` (`volunteer_shifts.import_id`, `volunteer_credentials.import_id`,
  `donors.volunteer_import_id`), and the undo deletes by that id alone: a "remove everything from
  the last five minutes" undo would take the shift a coordinator logged by hand while it ran. A
  person the import merely MATCHED has no stamp and is never removed. A person it created but who
  has given, or has a shift it did not write, is KEPT and named with the reason. (VOL-2)
- **Nobody who arrives through Volunteers is a donor.** Add and import both write
  `person_types ["volunteer"]`, no gift, no donor tag. The record says donor when they give and
  not before, and the screens say so in words. (VOL-2)
- **Opened from Volunteers, a person is a volunteer first.** `GET /volunteer-hub/person/:id`
  answers with upcoming shifts, hours, waivers and checks, and groups; GIVING is the last field,
  present only when they have actually given, and absent from the payload entirely for the
  volunteer coordinator role. The role is a security boundary, so the server decides it rather
  than the screen choosing what to draw. (VOL-2)
- **A shift reminder is a DRAFT, and so is a shift's thank-you.** The hourly sweep writes one reminder
  draft per person confirmed on tomorrow's shifts, and check-in writes one thank-you draft (the org's
  COMMS-2 volunteer template, with the SURVEY-1 link) into `milestone_drafts`, keyed `vol:<kind>:<signup>`
  so a second pass writes nothing. Staff send them from Schedule, To send, in one tap, through
  `sendMilestoneDraft`, so every mail rule applies at the press; a refused one is marked failed with its
  reason and is not retried by the next press. Nothing reaches a volunteer without a person pressing Send.
  `volunteer_reminders_enabled` no longer decides anything. (PARITY-3, replacing VOL-2's sending sweep)
- **A shift has roles, and capacity is decided per role.** `volunteer_slot_roles` (name, needed); a sign-up
  carries `role_id`, and `signUp` counts and waitlists per role under the same slot lock, so a freed place
  goes to the first person waiting for THAT role. A shift with no roles keeps its one capacity. Every
  number under a shift (needed, scheduled, short, waitlisted, hours) is `VS.shiftFooter`, computed once
  in `scheduleRows` and read by the calendar, the roster, the public page and the CSV; short is counted
  role by role. A conflict is one person with a place on two shifts that overlap; back to back is not
  one. A draft shift (`published = false`) is the coordinator's: the public page and Your page cannot see
  or join it. (PARITY-3)
- **Check-in writes the hours, from the shift's own times, dated the day they are here** (the org's today, never the planned date, so an early check-in cannot write hours in the future). Linked to the opportunity and
  shift (`volunteer_shifts.opportunity_id/slot_id`), editable after on the person's record. Check-out
  only marks the sign-up done. (PARITY-3)
- **A group signs up on a screen now.** Volunteers → Schedule → Groups. A group is a LABEL on a
  set of sign-ups, never a person: every member is their own record with their own hours, and
  capacity is still decided by the database, so a group of twelve at an eight-place shift gets
  eight confirmed and four waitlisted. (VOL-2)
- **A birthday is a month and a day; the year is optional.** `donors.birth_month/birth_day/birth_year`,
  whole or empty by a CHECK, one parser for every door (`shared/birthday.js`: the profile, both import
  paths, the server's re-check). A cell it cannot read is refused, never guessed. February 29 is
  remembered on the 28th in a year without one, and the Birthday journey fires on the org's own date. (PARITY-3)
- **The volunteer record lives on the person.** The profile's Volunteering section (main column with
  hours, under More without): this year and lifetime through the one `volunteer-hours` figure source, the
  hours log filtered by dates and opportunity with its CSV, hours given as hours, hours and minutes, or
  start and end (`VH.validateShift`), edit and delete through the audit write, qualifications
  (`volunteer_qualifications`: skill, certification with expiry, tag), checks and waivers, application
  answers, and notes kept `internal` or shown to the volunteer on Your page. Each logged shift is on the
  timeline as Volunteer service. The glance line opens the same source. (PARITY-3)
- **Make a volunteer through `makeVolunteer`, and only through it.** The profile's More > Make a
  volunteer, Volunteers > Add a volunteer (which searches people on file and links the one picked)
  and the Agent all call it. It never makes a person: it marks the Volunteer role and keeps ONE
  approved `volunteer_applications` row on them (`via` staff, agent or page) with hours a week,
  days and roles; a second call updates that row. That row is what puts them in the Volunteers
  group. (FIX-24)
- **A volunteer applies; a coordinator approves.** `volunteer_applications` holds what the public page
  sent and is not a person. Approve matches by email under `withAdvisoryLock('donor:org:email')`: one match
  is that person (a donor stays one record, now also a Volunteer); two or more and staff choose; none and
  a person is made. Decline sends nothing. The page's words are stored only after `sanitizeRichText`
  (an allowlist: headings, lists, links to the web or mail, `/portal-assets/` or https images, YouTube
  and Vimeo players). A waiver upload is stored as kind `volapply`, never written into a public page, and
  served to signed-in staff only. (PARITY-3)
- **Show me's rules are donor list rules too.** `notGaveFrom`/`notGaveTo` (no gift above zero in the
  range; a refund is not a gift), `notDeceased`, `monthly` (a running monthly recurring gift), `city`
  (case-insensitive, whole name), `gaveEvent` (a gift stamped with that event) and `gaveOver` (more than N
  dollars in all, counting only gifts to `gaveEvent` and inside `gaveFrom`/`gaveTo` when those are set)
  are `buildDonorFilter` rule keys, so the list, its export and a Group run them. (PARITY-4)
- **The Volunteers list is the donor list's filter.** The volunteer rules (opportunity, on a shift in a
  range, hours over or under N in a range, gave in a range, qualification, application answer,
  availability, active) are `buildDonorFilter` rule keys, so a Group saved from the list is the same rows.
  A coordinator gets no giving column and a giving filter from one is refused (403). The default
  Volunteers group (rule `volunteer=1`: a logged hour or an approved application) is made by a POST from
  the screen, and its page adds "Volunteers who have never given" (`group-never-gave`). (PARITY-3)
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
- **"Meetings with this person" is `meetings.js` and nothing else.** Calendar meetings not logged
  afterwards plus meeting interactions, each dated by its civil day in the ORG's zone (never the UTC
  day), held when it has happened. Last met, Meetings this year, the rhythm strip, the timeline's
  Meetings chip, Coming up, No meeting since, meetings per staff, Visits YTD and the meeting brief
  all read it. A conversation date is the day the person chose, and a client "today" is
  `client/src/lib/orgToday.js`, never `toISOString()`. (FIX-14, `tests/fix14-meeting-counts`)
- **A note's suggestion is a chip, never a write.** Next step, spouse to household and planned-giving
  prospect come from the after-meeting engine (AI switch, the simple reader as fallback) and change
  nothing until a person presses one (`POST /interactions/:id/chips`). (FIX-14)
- **The profile has one of everything.** One timeline ("Everything with", calls and notes included),
  one next step (the rail, with Edit/Delete/Undo), one ask ("The ask": stage, proposals, moves), one
  Rhythm panel (past touches from the timeline's sources, planned journey steps and next steps, the
  journey picked or changed there). An empty section is one line with its add button. Drafting,
  Suggested, Brief me, Add a task, Erase and Delete are under More. (FIX-14 Part 3)

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
- `events` — id, org_id, name, event_type (gala/cultivation/site_visit/board_meeting/volunteer/webinar/other), date DATE, end_date DATE, location, description, capacity INTEGER, status (upcoming/completed/cancelled), revenue NUMERIC, cost NUMERIC, notes, created_at. PARITY-2 adds start_time/end_time (civil HH:MM, org zone), hero_image_url, hero_video_url, gallery JSONB [{path, caption}]; `event_levels.benefits` JSONB (one line each, sponsor cards).
- **Check-in at the door is the one kiosk (`EventKiosk`), reachable from both guest lists.** Fundraising > Events opens it from "Check in at the door"; it is not rebuilt per screen. (PARITY-2)
- **The drawn room extends the FIX-11 rows, never a second seating model.** `event_tables.shape` (round/long), `event_attendees.seat_no` (the chair) and `vip`. `seatPlaces` (shared/eventShape.js) decides who is on which chair for the screen, the print sheets and `applySeating` alike; a guest with no `seat_no` takes the lowest free chair. A chair someone else is on is refused by name, never swapped. (PARITY-4)
- **The camera reads the ticket; the server decides.** The kiosk uses the browser's BarcodeDetector where it reads QR, and jsQR where it does not (Safari, Firefox; loaded only when the camera starts, FIX-26), with the code box beside it, all into one handler that posts the whole string to `POST /events/:id/scan`. A second scan of a checked-in ticket (and a second check-in by name) answers `already_in` and writes nothing. (PARITY-4)
- `event_attendees` — id, event_id (FK→events CASCADE), org_id, donor_id (FK→donors SET NULL), name, email, status (invited/confirmed/attended/no_show/cancelled), gift_amount NUMERIC, notes, UNIQUE(event_id, donor_id). PATCH to 'attended' + gift_amount > 0 auto-logs gift to donors/gifts/fin_transactions.
- Event type colors: gala=#8b5cf6, cultivation=#10b981, site_visit=#3b82f6, board_meeting=#0d5c3a, volunteer=#f59e0b, webinar=#ec4899, other=#6b7280
- Routes: GET/POST /events, PUT/DELETE/GET /events/:id, POST /events/:id/attendees, PATCH/DELETE /events/:id/attendees/:attendeeId, POST /events/:id/follow-up, GET /donors/:id/events
- **A line on the timeline is written by `timelineLine.js`, once.** Every system act that lands on a person
  (came to, registered for, became a member, pledged, started giving, started a fundraising page, a grant's
  stage or award on the funder, joined or left a household) writes one `interactions` row through it, keyed
  by `metadata.line_key` so the same act never writes two. System lines use type `activity`, which is not
  a contact type: a line Steward wrote never counts as somebody talking to the donor. (WIRE-1)
- **A person arriving by any door is matched by `personMatch.js findPersonId`.** Email first (lower-cased,
  the oldest record when two share it), then a name only when exactly one person has it and no other email.
  Event registration, staff add-attendee, and the volunteer doors use it; the donation webhook, mailbox,
  auctions and peer-to-peer already matched by exact email. Never `LIMIT 2 ... length === 1` then create:
  two records sharing an email made a third. (WIRE-1)
- **Merge and purge follow `MERGE_REFS`, and so does nothing else.** `REF_SHAPE` covers array pointers
  (`calendar_events.person_ids`: swap, or drop when the kept id is already there; undo restores the array
  exactly) and entity pointers (`agent_writes`, `custom_field_events` when the entity is a donor). Purge
  walks the same list: the person's own rows go, money, ledger and history rows keep the row and lose the
  pointer. A new person pointer joins MERGE_REFS or `tests/clean1-merge.test.js` fails. (WIRE-1)

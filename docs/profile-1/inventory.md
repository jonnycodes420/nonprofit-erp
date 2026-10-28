# PROFILE-1 · inventory of today's donor profile (origin/main 6216535)

Every clickable thing on the donor profile before the redesign, where it goes, and how a test finds it.
"Figure → `key`" means a `<Figure source>` that opens `MetricBreakdownPanel` on that figure source
(`figureSources.js`) with the params shown. `DP` = `client/src/components/DonorProfile.jsx`.
The `Now` column says where each item is on the new page, read by `tests/profile1-everything-clicks.test.js`:
`where · probe · check`. `where` is the header, the More menu, the tab row, a tab or the rail. `check` is one of
`exists` (it is on the page there), `source:<key>` (it opens that figure source's rows), `dialog` (pressing it opens
the same dialog), `tab:<id>` (pressing it opens that tab), or `code` (it appears only with data the fixture does not
carry, e.g. a calendar or a household; the test checks the profile's code still draws it).

## 1. Header

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| hdr-back | ← Back | `onClose()` back to the list | `.dph-back` / aria-label "Back to donors" || header · `.dph-back` · exists |
| hdr-photo | Photo or initials (click or drop) | file picker → `PhotoAdjuster` modal → `POST /donors/:id/photo` (DP `DonorPhotoControl`) | `[data-testid=donor-photo-drop]` || header · `[data-testid=donor-photo-drop]` · exists |
| hdr-photo-remove | Remove photo (when a photo) | `DELETE /donors/:id/photo` | `[data-testid=donor-photo-remove]` || header · `donor-photo-remove` · code |
| hdr-drift | Drift badge (when drifting) | hover title only (`DriftBadge`, shared.jsx); reason line under the name | text of `donor.drift.reason` || header · `DriftBadge` · code |
| hdr-flags | Deceased / Do not contact / Do not solicit / Sustainer · not reconnected (when set) | hover title only | chip text || header · `Do not solicit` · code |
| hdr-role-add | + (add a role) | menu `role-add-menu` → `PUT /people/:id/roles` (DP `RoleLine`) | `[data-testid=role-add]`, `role-add-<key>` || header · `[data-testid=role-add]` · exists |
| hdr-role-chip | each role chip (Donor, Volunteer, Staff and board…) | `PUT /people/:id/roles` off (DP `RoleLine`) | `[data-testid=role-line] button` || header · `[data-testid=role-line]` · exists |
| hdr-tag | each status tag (giving level, lifecycle, Retained) | Figure-like drawer → `donors-by-status` {tag, today} (ProfileStatus `StatusTags`/`Opens`) | `[data-testid=dp-tag-<key>]` || header · `[data-testid=dp-status-tags] button` · source:donors-by-status |
| hdr-closeness-fact | each closeness fact ("gave twice this year"…) | drawer → the fact's source (`donor-gifts-between`, `volunteer-hours`, `donor-engagement-part`, `donor-membership`, `donor-fundraising`, `donor-contact-gap`) | `[data-testid=dp-closeness-fact-<i>]` || header · `dp-closeness-fact-` · code |
| hdr-group-out | × on a group chip (when in a static group) | `POST /groups/:gid/members/remove` (Groups.jsx `ProfileGroups`) | aria-label "Take out of <group>" || header · `Take out of` · code |
| hdr-group-add | Add to a group (select) + Add | `POST /groups/:gid/members` | `[data-testid=profile-groups] select` || header · `profile-groups` · code |
| hdr-import-refusals | See them (admin, when an import refused rows) | modal "Rows that couldn't be read" ← `GET status.importRefusals.rowsPath` (`/donors/:id/refused-rows`) | `[data-testid=dp-import-refusals-open]` || header · `dp-import-refusals-open` · code |
| hdr-log-call | Log a call | `LogConversationModal` (LogConversation.jsx) | `[data-testid=dp-primary]` || header · `[data-testid=dp-primary]` · dialog |
| hdr-plan-followup | Plan a follow-up (when no open thread) | `PlanFollowUpModal` | `[data-testid=dp-plan-followup]` || header · `dp-plan-followup` · code |
| hdr-more | More ▾ | opens `dp-more-menu` | `[data-testid=dp-more]` || header · `[data-testid=dp-more]` · exists |
| more-request-gift | Request a gift | `GiftLinkModal` → `POST /stripe/donation-page` | menuitem "Request a gift" || more · `[role=menuitem]:has-text("Request a gift")` · exists |
| more-draft-next | Draft the next move (team) | `getAI(donor,"nextmove")` + Suggested modal | menuitem "Draft the next move" || more · `[role=menuitem]:has-text("Draft the next move")` · exists |
| more-draft-outreach | Draft outreach (team) | `getAI(donor,"outreach")` + Suggested modal | menuitem "Draft outreach" || more · `[role=menuitem]:has-text("Draft outreach")` · exists |
| more-draft-email | Draft an email (team) | `getAI(donor,"email")` + Suggested modal (Copy the draft `dp-copy-draft`) | menuitem "Draft an email" || more · `[role=menuitem]:has-text("Draft an email")` · exists |
| more-call-script | Call script (team) | `getAI(donor,"callscript")` + Suggested modal | menuitem "Call script" || more · `[role=menuitem]:has-text("Call script")` · exists |
| more-suggested | Suggested (n) | Suggested modal `dp-suggested` (Try again `dp-suggested-retry-<kind>`) | menuitem "Suggested" || more · `[role=menuitem]:has-text("Suggested")` · exists |
| more-brief | Brief me | modal with `BriefPanel` (MajorGifts.jsx) → `POST /donors/:id/brief` | menuitem "Brief me", only when AI is on (FIX-55 item 6) || more · `setBriefOpen(true)` · code |
| more-prospect-brief | Write a prospect brief (major gifts) | `ProspectBriefModal` (RoomToGive.jsx) | `[data-testid=dp-prospect-brief]` || more · `dp-prospect-brief` · code |
| more-filing | Look up public filing (major gifts, organisation) | `PublicFilingLookupModal` | `[data-testid=dp-filing-lookup]` || more · `dp-filing-lookup` · code |
| more-video | Record a video thank-you (when email, not deceased/DNC) | `VideoThanksModal` | `[data-testid=dp-video-thanks]` || more · `[data-testid=dp-video-thanks]` · exists |
| more-volunteer | Volunteer record (volunteer) / Make a volunteer | modal `VolunteerPanel always` / `AddVolunteerModal` | `[data-testid=dp-volunteering]` / `dp-make-volunteer` || more · `[data-testid=dp-make-volunteer]` · exists |
| more-why-stop | Why did they stop? (lapsed) | `WhyPanel` {key:"stopped", donor} | `[data-testid=dp-why-stop]` || more · `dp-why-stop` · code |
| more-add-task | Add a task (when onAddTask) | `onAddTask()` (Donors.jsx task modal) | menuitem "Add a task" || more · `Add a task` · code |
| more-impact | Impact summary | `GET /donors/:id/impact-summary/pdf` download | menuitem "Impact summary" || more · `[role=menuitem]:has-text("Impact summary")` · exists |
| more-your-page | Send their page link (when email) | `POST /donors/:id/your-page-link`, status line `dp-your-page-msg` | menuitem "Send their page link" || more · `[role=menuitem]:has-text("Send their page link")` · exists |
| more-edit | Edit record | `onEdit()` → `EditDonorModal` → `PUT /donors/:id` | menuitem "Edit record" || more · `[role=menuitem]:has-text("Edit record")` · exists |
| more-export | Export this person's data (admin) | `GET /donors/:id/export-data` download | menuitem "Export this person's data" || more · `[role=menuitem]:has-text("Export this person")` · exists |
| more-erase | Erase this person (admin) | modal `dp-erase-confirm` → `POST /donors/:id/erase` | `[data-testid=dp-erase]` || more · `[data-testid=dp-erase]` · exists |
| more-delete | Delete donor (admin) | `onDelete(id)` (Donors.jsx confirm + `DELETE /donors/:id`) | `[data-testid=dp-delete]` || more · `[data-testid=dp-delete]` · exists |

## 2. The seven number boxes

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| fig-lifetime | Lifetime | Figure → `donor-lifetime` {donor} | `[data-figure-key="profile.lifetime"]` || header · `[data-testid=dp-header-figures] [data-figure-key="profile.lifetime"]` · source:donor-lifetime |
| fig-last-gift | Last gift | Figure → `donor-last-gift` {donor} | `[data-figure-key="profile.lastGift"]` || header · `[data-testid=dp-header-figures] [data-figure-key="profile.lastGift"]` · source:donor-last-gift |
| fig-last-met | Last met (days) | Figure → `donor-last-met` {donor, today} | `[data-figure-key="profile.lastMet"]` || gifts · `[data-testid=dp-more-numbers] [data-figure-key="profile.lastMet"]` · source:donor-last-met |
| fig-last-email | Last email (days) | Figure → `donor-last-email` {donor, today} | `[data-figure-key="profile.lastEmail"]` || gifts · `[data-testid=dp-more-numbers] [data-figure-key="profile.lastEmail"]` · source:donor-last-email |
| fig-first | First gift (month under) | Figure → `donor-first-gift` {donor} (ProfileStatus `Tile`) | `[data-figure-key="profile.glance.first-gift"]` || gifts · `[data-testid=dp-more-numbers] [data-figure-key="profile.glance.first-gift"]` · source:donor-first-gift |
| fig-largest | Largest gift (month under) | Figure → `donor-largest-gift` {donor} | `[data-figure-key="profile.glance.largest-gift"]` || gifts · `[data-testid=dp-more-numbers] [data-figure-key="profile.glance.largest-gift"]` · source:donor-largest-gift |
| fig-average | Average gift ("of N gifts…" under) | Figure → `donor-average-gift` {donor}, measure `per_gift` | `[data-figure-key="profile.glance.average-gift"]` || gifts · `[data-testid=dp-more-numbers] [data-figure-key="profile.glance.average-gift"]` · source:donor-average-gift |
| fig-def | "?" beside Lifetime / Last gift / Last met / Last email | hover + keyboard title = census sentence (no click target) | `[data-testid=dp-tile-def-<Label>]` || header · `[data-testid=dp-header-figures] [data-testid="dp-tile-def-Lifetime"]` · exists |

## 3. Glance lines, Ask, Giving by year

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| gl-birthday | Birthday: … (when set) | text only | `[data-testid=dp-glance-birthday]` || header · `[data-testid=dp-header-birthday]` · exists |
| gl-volunteer | volunteer line (when hours) | drawer → `volunteer-hours` | `[data-testid=dp-glance-volunteer-open]` || rail · `dp-rail-volunteering` · code |
| gl-highlight | each Highlight ("Gives every August"…) | drawer → `donor-gifts-between` / `donor-first-gift` / `donor-largest-gift` | `[data-testid=dp-highlight-<key>]` || overview · `dp-highlight-` · code |
| gl-next-why | Next line + Why? | toggles `dp-next-why-text` (status.next.why + suggested ask) | `[data-testid=dp-next-why]` || overview · `[data-testid=dp-ask-card] [data-testid=dp-next-why]` · exists |
| ask-why | Ask: Why … giving moved | `AskRail` mode why, scope donor (AskRail.jsx) | `[data-testid=ask-why]` in `donor-ask` || overview · `[data-testid=dp-ask] [data-testid=donor-ask]` · exists |
| ask-what | Ask: What to do next with … | `AskRail` mode what | `[data-testid=ask-what]` || overview · `[data-testid=dp-ask] [data-testid=donor-ask]` · exists |
| ask-kept | the kept Ask thread (when one) | `AskRail` replay | `[data-testid=ask-kept]` || overview · `ask-kept` · code |
| gby-bar | a bar on Giving by year | `MetricBreakdownPanel` → `gifts` {donor, from YYYY-01-01, to YYYY-12-31} | `[data-testid=dp-giving-by-year]` bars || gifts · `[data-testid=dp-giving-by-year]` · exists |
| gby-add | + Add a gift (no gifts) | switches to Gifts tab + opens the add-gift form | `[data-testid=dp-giving-by-year-add]` || gifts · `dp-giving-by-year-add` · code |

## 4. Tab row

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| tab-overview | Overview | `dpTab=overview` | `.dp-tabs [role=tab]` "Overview" || tabs · `[data-tab=overview]` · tab:overview |
| tab-gifts | Gifts & Pledges (count) | `dpTab=gifts` | "Gifts & Pledges" || tabs · `[data-tab=gifts]` · tab:gifts |
| tab-funds | Funds | `dpTab=funds` → `GET /donors/:id/fund-affinity` | "Funds" || tabs · `[data-tab=funds]` · tab:funds |
| tab-related | Related (count) | `dpTab=related` → `GET /donors/:id/relationships` | "Related" || tabs · `[data-tab=related]` · tab:related |
| tab-materials | Materials (count) | `dpTab=materials` → `GET /donors/:id/materials` | "Materials" || tabs · `[data-tab=files]` · tab:files |
| tab-activity | Activity | `dpTab=activity` | "Activity" || tabs · `[data-tab=conversations]` · tab:conversations |

## 5. "Everything with [name]" (Overview; MeetingPanels.jsx `RelationshipTimeline`)

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| tl-view-timeline | Timeline | view cards (pref saved) | `[data-view=cards]` || conversations · `[data-view=cards]` · exists |
| tl-view-list | List | `TimelineListView`; a row opens its card | `[data-view=list]` || conversations · `[data-view=list]` · exists |
| chip-all | All | filter all | `[data-filter=all]` || overview · `[data-testid=dp-lately]` · exists |
| chip-gifts | Gifts | bucket gift | `[data-filter=gift]` || tabs · `[data-tab=gifts]` · tab:gifts |
| chip-conversations | Conversations | bucket conversation (meetings, calls, visits, asks, stewardship, events) | `[data-filter=conversation]` || tabs · `[data-tab=conversations]` · tab:conversations |
| chip-tasks | Tasks | `GET /donors/:id/tasks` rows | `[data-filter=task]` || tabs · `[data-tab=tasks]` · tab:tasks |
| chip-notes | Notes | bucket note | `[data-filter=note]` || tabs · `[data-tab=notes]` · tab:notes |
| chip-emails | Emails | email threads + logged emails | `[data-filter=email]` || tabs · `[data-tab=emails]` · tab:emails |
| chip-attachments | Attachments | `GET /donors/:id/attachments` + mail files | `[data-filter=file]` || tabs · `[data-tab=files]` · tab:files |
| chip-service | Volunteer service (when shifts) | `GET /donors/:id/volunteer-hours` shifts | `[data-filter=service]` || conversations · `TAB_SUBCHIPS` · code |
| chip-stage | Stage changes (when any) | bucket stage | `[data-filter=stage]` || conversations · `[data-filter=stage]` · exists |
| chip-activity | Activity (when any) | bucket activity | `[data-filter=activity]` || conversations · `TAB_SUBCHIPS` · code |
| tl-hide-mass | Hide mass emails (when any) | filter toggle (pref saved) | `[data-testid=dp-hide-mass]` || emails · `dp-hide-mass` · code |
| tl-connect | Connect your inbox (no inbox, no mail) | `onNavigate("settings",{section:"connections",focus:"inbox"})` | `[data-testid=dp-connect-inbox] button` || conversations · `dp-connect-inbox` · code |
| tl-more | Show N more | limit +20 | button "Show … more" || conversations · `Show {Math.min(20` · code |
| tl-card | a card (any kind) | expands in place (`aria-expanded`); gift card id `gift-<id>` | `[data-testid=dp-timeline] [role=button]` || conversations · `[data-testid=dp-timeline] [role=button]` · exists |
| tl-item-menu | ⋯ on a logged entry (Edit, Delete) | Edit → `LogConversationModal`/`LogTouchpointModal`; Delete → `DELETE /interactions/:id` + Undo | `[data-testid=item-menu]` || conversations · `[data-testid=dp-timeline] [data-testid=item-menu]` · exists |
| tl-attach | Attach a file (open card, write) | `AttachButton` → upload to the interaction | button "Attach a file" || conversations · `AttachButton` · code |
| tl-file-chip | a file chip | download / Remove (EditHistory confirm) | `AttachmentChips` || files · `AttachmentChips` · code |
| tl-mail-file | Open the attachment in Gmail/Outlook | external `href` | `[data-testid=mail-file-link]` || emails · `mail-file-link` · code |
| tl-email-remove | Remove from the record (synced email) | confirm → `POST /mailbox/forget` | button "Remove from the record" || emails · `Remove from the record` · code |
| tl-log-how | Log how it went (calendar meeting, open) | `onLog(m)` → `AfterMeetingForm` modal | button "Log how it went" || conversations · `Log how it went` · code |

## 6. Overview cards

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| mtg-brief | Open the brief / Close the brief (next meeting) | expands `dp-brief-full` (MeetingPanels `MeetingCard`) | `[data-testid=dp-meeting-card]` "Open the brief" || overview · `Open the brief` · code |
| mtg-print | Print the brief | `window.print()` | "Print the brief" || overview · `Print the brief` · code |
| mtg-move | Move it | time form → `POST /calendar/events/:id/move` | "Move it" || overview · `Move it` · code |
| mtg-cancel | Cancel it | confirm → `POST /calendar/events/:id/cancel` | `[data-testid=dp-meeting-cancel]` || overview · `dp-meeting-cancel` · code |
| heard-chip | From your note: chip / Not now (within 30 days of a hand-logged note) | `POST /interactions/:id/chips` (MeetingPanels `ConversationChips`) | `[data-testid=dp-heard] [data-chip]` || overview · `[data-testid=dp-heard]` · exists |
| howdid | How did it go? · Write it down (meeting ended < 7 days, not logged) | `AfterMeetingForm` modal | `[data-testid=dp-how-did-it-go] button` || overview · `dp-how-did-it-go` · code |
| ask-new | + New ask | `ProposalForm` → `POST /donors/:id/proposals` (MajorGifts `ProposalsPanel`) | `[data-testid=dp-the-ask]` "+ New ask" || asks · `[data-testid=dp-the-ask] button:has-text("+ New ask")` · dialog |
| ask-stage | Stage buttons (Prospect, Qualify, Cultivate, Solicit, Ongoing care, Lapsed) (team) | `onStageChange(id, stage)` (Donors.jsx → `PUT /donors/:id`, stage) | `[data-testid=dp-move-stage] button[aria-pressed]` || overview · `[data-testid=dp-stage-bar] [data-stage=solicit]` · exists |
| ask-sug-accept | Accept → stage (smart move) | `onStageChange` + `POST /pipeline/:id/move` | "Accept →" || asks · `Accept →` · code |
| ask-sug-dismiss | Dismiss (smart move) | local dismiss | "Dismiss" || asks · `dismissSuggestion` · code |
| ask-row-move | Move (proposal row) | `MoveModal` → `PUT /proposals/:id` | proposal row "Move" || asks · `[data-testid=dp-the-ask] button[title="Move this proposal"]` · dialog |
| ask-row-edit | Edit (proposal row) | `ProposalForm` → `PUT /proposals/:id` | proposal row "Edit" || asks · `[data-testid=dp-the-ask] button[title="Edit this proposal"]` · dialog |
| ask-row-status | Asked / stage chip (proposal row) | label only (`StageChip`) | row chip || asks · `StageChip` · code |
| ask-row-menu | ⋯ (proposal row): Delete | `DELETE /proposals/:id` + Undo | `[data-testid=item-menu]` in row || asks · `[data-testid=dp-the-ask] [data-testid=item-menu]` · exists |
| ask-prob-line | "1 open proposal, no probability set" | text only (`d.weighted.sentence`) | text || asks · `[data-testid=dp-the-ask]:has-text("probability")` · exists |
| ask-suggested | Suggested ask line (when scores) | text (`SuggestedAskLine`) | `[data-testid=suggested-ask]` || overview · `SuggestedAskLine` · code |
| pipe-add | + Add to pipeline (team) | `POST /pipeline/add` | "+ Add to pipeline" || asks · `[data-testid=dp-the-ask] button:has-text("Add to pipeline")` · exists |
| pipe-ask | + Pipeline ask / Save (team) | `POST /donors/:id/opportunities` | "+ Pipeline ask" || asks · `[data-testid=dp-the-ask] button:has-text("Pipeline ask")` · exists |
| pipe-won | Won (open opportunity) | `PUT /opportunities/:id` status won | "Won" || asks · `closeAsk(o,"won")` · code |
| pipe-lost | Lost (open opportunity) | `PUT /opportunities/:id` status lost | "Lost" || asks · `closeAsk(o,"lost")` · code |
| hh-link | Household name (when in one) | `RecordLink` → `householdHref(id)` = `/donors?household=<id>` | `[data-record-link=household]` || overview · `data-record-link="household"` · code |
| hh-rename | Rename (household) | `window.prompt` → `PUT /households/:id` | `[data-testid=dp-household-rename]` || related · `dp-household-rename` · code |
| hh-remove | Remove (household) | `PUT`/`DELETE /households/:id` | `[data-testid=dp-household]` "Remove" || related · `removeFromHousehold` · code |
| hh-add | + Group into household | modal → `POST /households` | "+ Group into household" || overview · `[data-testid=dp-household-add]` · dialog |
| hh-member | a member row | `onSelectRelatedDonor(id)` | `[data-testid=dp-household]` rows || related · `onSelectRelatedDonor(m.id)` · code |
| hh-figs | Hard credit / Soft credit / Household combined / member totals | Figures → `softCredit.householdSources.*`, `household.combined_source`, `m.source` | household figures || related · `householdSources` · code |
| soft-credit | Soft credit panel (when soft credits) | text, hover titles (census `profile.creditHard` / `creditWithSoft`) | `[data-testid=soft-credit-panel]` || gifts · `[data-testid=soft-credit-panel]` · exists |
| pg-note | + Note planned giving | opens the designation toggles | `[data-testid=dp-planned-giving]` "+ Note planned giving" || overview · `[data-testid=dp-planned-giving-add]` · exists |
| pg-toggle | each designation toggle | `POST`/`DELETE /donors/:id/designations[/:kind]` | `[data-designation]` || overview · `data-designation` · code |
| mem-add | Add a membership | form → `POST /donors/:id/memberships` (Memberships `MembershipPanel`) | `[data-testid=membership-add]` || overview · `membership-add` · code |
| mem-renew | Renew (member) | `POST /memberships/:id/renew` | `[data-testid=membership-renew]` || overview · `membership-renew` · code |
| mem-card | Member card (PDF) (member) | `GET /memberships/:id/card.pdf` | `[data-testid=membership-card]` || overview · `membership-card` · code |
| seq-enroll | + Enroll in sequence → select → Enroll (team, active sequences) | `POST /sequences/:id/enroll` | `[data-testid=dp-sequences]` "+ Enroll in sequence" || overview · `dp-sequence-enroll` · code |
| vol-panel | Volunteer panel (when hours/record): Add hours, Edit, Remove, Download CSV, Copy their link, qualifications, hours Figures | `POST/PATCH/DELETE` volunteer-hours/shifts; Figure → `volunteer-hours` (VolunteerPanel.jsx) | `[data-testid=volunteer-panel]` || overview · `<VolunteerPanel donor` · code |
| funder-panel | Funder panel (organisation): Save type/EIN, New grant request, Open grant, merge | `PUT /funders/:id`, `POST /funders/:id/grants`, `onNavigate("grants",{grantId})` (FunderPanel.jsx) | `[data-testid=funder-panel]` || overview · `<FunderPanel` · code |
| matching | Matching gift note (when employer matches) | hover title only | text || overview · `matchingGift.companyName` · code |
| tags-notes | tags pills, notes box | text only | `Pill` || header · `[data-testid=dp-header-tags]` · exists |

## 7. Gifts & Pledges tab

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| gifts-csv | ↓ CSV | client CSV download (`exportGiftsCSV`) | "↓ CSV" || gifts · `button:has-text("CSV")` · exists |
| gifts-yearend | Year-end statement → Generate & email (receipts on) | `POST /donors/:id/year-end-statement` | "Year-end statement" || gifts · `Year-end statement` · code |
| gifts-add | + Add Gift / Record a gift → (empty) → Save | `POST /donors/:id/gifts` (form, More options `gift-more-toggle`) | "+ Add Gift" || gifts · `button:has-text("+ Add Gift")` · exists |
| gifts-recur-resend | Send card-update link (recurring at risk) | `POST /recurring/:id/resend` | "Send card-update link" || gifts · `Send card-update link` · code |
| gifts-receipt | Send receipt / receipt PDF | `POST /gifts/:id/receipt` / `GET /receipts/:id/pdf` | gift row receipt cell || gifts · `/receipt` · code |
| gifts-edit | Edit (gift row) → Save | `PUT /gifts/:id` (+ `/custom-fields`) | gift row "Edit" || gifts · `button:has-text("Edit")` · exists |
| gifts-delete | Delete (gift row) | `DELETE /gifts/:id` | gift row "Delete" || gifts · `button:has-text("Delete")` · exists |
| pledge-add | + Add Pledge → Save | `POST /donors/:id/pledges` | "+ Add Pledge" || gifts · `button:has-text("+ Add Pledge")` · exists |
| pledge-remind | Resend reminder (overdue) | `POST /pledges/:id/resend` | "Resend reminder" || gifts · `Resend reminder` · code |
| pledge-fulfil | Mark Fulfilled | `PUT /pledges/:id` status fulfilled | "Mark Fulfilled" || gifts · `button:has-text("Mark Fulfilled")` · exists |
| pledge-writeoff | Write Off | `PUT /pledges/:id` status written_off | "Write Off" || gifts · `button:has-text("Write Off")` · exists |
| pledge-edit | Edit (pledge) → Save | `PUT /pledges/:id` | `[data-testid=pledge-edit]` || gifts · `pledge-edit` · code |
| pledge-delete | × (pledge) | `DELETE /pledges/:id` | aria-label "Delete this pledge" || gifts · `[aria-label="Delete this pledge"]` · exists |
| planned-add | Planned Giving + Add → Save | `POST /donors/:id/planned-gifts` | "+ Add" || gifts · `planned-gifts` · code |
| planned-delete | × (planned gift) | `DELETE /planned-gifts/:id` | row × || gifts · `/planned-gifts/` · code |

## 8. Funds, Related, Materials, Activity tabs

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| funds-view | What they support / Restricted vs Unrestricted / Suggested Asks | text from `GET /donors/:id/fund-affinity` (no click targets) | Funds tab || funds · `text=What they support` · exists |
| rel-link | + Link to another donor → type → pick | `POST /donors/:id/relationships` | "+ Link to another donor" || related · `button:has-text("Link to another donor")` · exists |
| rel-row | a linked donor | `onSelectRelatedDonor(relatedDonorId)` | row name "→" || related · `r.relatedDonorId` · code |
| rel-type | Relationship select | `PUT /donor-relationships/:id` | aria-label "Relationship" || related · `aria-label="Relationship"` · code |
| rel-remove | Remove (link) | `DELETE /donor-relationships/:id` + Undo | "Remove" || related · `unlinkDonor(r.id)` · code |
| mat-upload | Drop a file / browse | `POST /donors/:id/materials` (`Uploader`) | Materials tab uploader || files · `text=Drop a file here` · exists |
| mat-view | View | opens the file (`viewMaterial`) | "View" || files · `viewMaterial(m)` · code |
| mat-delete | Delete | `DELETE /materials/:id` + Undo | "Delete" || files · `deleteMaterial(m.id)` · code |
| act-mode | Activity Log / Stewardship Timeline / History | `actMode`; History = `HistoryList` (audit log) | mode buttons || files · `[data-testid=dp-history]` · exists |
| act-filter | all, call, meeting, email, gift, event, stewardship, note | filters the log | filter buttons || tabs · `[data-tab=emails]` · tab:emails |
| act-stw | Log Stewardship → Save | `POST /donors/:id/interactions` type stewardship | "Log Stewardship" || conversations · `[data-testid=dp-log-stewardship]` · exists |
| act-touch | + Log Touchpoint | `onLogTouchpoint()` → `LogTouchpointModal` | "+ Log Touchpoint" || conversations · `[data-testid=dp-log-touchpoint]` · exists |
| act-row-menu | ⋯ on a log row (Edit, Delete) | `LogTouchpointModal` / `DELETE /interactions/:id` | `[data-testid=item-menu]` || conversations · `[data-testid=dp-timeline] [data-testid=item-menu]` · exists |
| act-inbox | InboxNudge connect line | `onNavigate("settings",…)` | InboxNudge || conversations · `<InboxNudge` · code |

## 9. Right rail

| id | What | Goes to | How to find it | Now |
|---|---|---|---|---|
| rail-mark-done | Mark done (open step) | `LogConversationModal` | `[data-testid=dp-mark-done]` || rail · `dp-mark-done` · code |
| rail-snooze | Snooze | `POST /threads/:id/dismiss` {revisit, +7 days} | `[data-testid=dp-snooze]` || rail · `dp-snooze` · code |
| rail-calendar | Put it on my calendar (thread) | `GET /threads/:id/calendar` (.ics / Google / Outlook) (LogConversation `PutItOnMyCalendar`) | compact calendar button || rail · `PutItOnMyCalendar` · code |
| rail-dismiss | … dismiss menu (revisit date, reasons) | `POST /threads/:id/dismiss` (LogConversation `ThreadDismissMenu`) | aria-label "More" in `dp-open-items` || rail · `ThreadDismissMenu` · code |
| rail-step-edit | Edit (thread step) → Save | `PUT /threads/:id` | `[data-testid=dp-step-edit-btn]` || rail · `dp-step-edit-btn` · code |
| rail-step-delete | Delete (thread step) | `DELETE /threads/:id` + Undo | `[data-testid=dp-step-delete]` || rail · `dp-step-delete` · code |
| rail-mtg-prep | Prep / Open the brief (meeting step) | `MEETING_ACTION` prep → MeetingCard opens brief | `[data-testid=dp-meeting-prep]` || rail · `dp-meeting-prep` · code |
| rail-mtg-resched | Reschedule (meeting step) | `MEETING_ACTION` reschedule → MeetingCard Move it | `[data-testid=dp-meeting-reschedule]` || rail · `dp-meeting-reschedule` · code |
| rail-mtg-howdid | How did it go? (after-meeting step) | `AfterMeetingForm` modal | `[data-testid=dp-meeting-howdid]` || rail · `dp-meeting-howdid` · code |
| rail-score-eng | Engagement band / parts | `ScoreWhyModal`; each part → `donor-engagement-part` {donor, part} (ScoreWhy.jsx) | `[data-testid=dp-score-engagement]` || rail · `[data-testid=dp-score-engagement]` · exists |
| rail-score-gen | Generosity / parts | `ScoreWhyModal`; part → `donor-generosity-part` {donor, part} | `[data-testid=dp-score-generosity]` || rail · `[data-testid=dp-score-generosity]` · exists |
| rail-score-why | See why | `ScoreWhyModal` | `[data-testid=dp-score-why]` || rail · `dp-score-why` · code |
| rail-score-log | Log a call / bring notes (no history) | `setConvoOpen` / event `steward:history-import` | `dp-log-first` / `dp-bring-notes` || rail · `dp-log-first` · code |
| rail-room | Room to give + Delete screening results (major gifts) | `GET /donors/:id/room-to-give`; `DELETE /donors/:id/screening` (RoomToGive.jsx) | `[data-testid=dp-room-to-give]` || rail · `<RoomToGiveBlock` · code |
| rail-filing | Public filing source link (organisation) | external `href` | `[data-testid=dp-public-filing] a` || rail · `<PublicFilingBlock` · code |
| rail-coming-up | Coming up rows (meetings) | text (RelationshipRail) | "Coming up" || rail · `[data-testid=dp-rail-coming-up]` · exists |
| rail-this-year | This year: Emails · from them · Meetings · Given | Figures → `y.emails.source`, `y.fromThem.source` (`donor-emails`), `y.meetings.source` (`meetings`), `y.given.source` (`donor-gifts-between`) | `[data-testid=dp-rail-relationship]` || rail · `[data-testid=dp-rail-relationship] [data-source-key=donor-gifts-between]` · source:donor-gifts-between |
| rail-book | Book a visit on your calendar → Add to my calendar | `POST /donors/:id/book-visit` | `[data-testid=dp-book-visit]` || rail · `[data-testid=dp-book-visit]` · exists |
| rail-journey-chip | Journey chip | `onNavigate("journeys",{journeyId})` | `[data-testid=dp-journey-chip]` || rail · `dp-journey-chip` · code |
| rail-journey-done | Mark done → Save and open the next | `POST /plan-steps/:id/done` | `[data-testid=dp-journey-done]` || rail · `dp-journey-done` · code |
| rail-journey-skip | Skip → reason | `POST /plan-steps/:id/skip` | `[data-testid=dp-journey-skip]` || rail · `dp-journey-skip` · code |
| rail-journey-menu | … Change journey / Stop → confirm | `POST /plans/:id/stop` | `[data-testid=dp-journey-more]` || rail · `dp-journey-more` · code |
| rail-journey-suggest | Start this journey (suggested) | `POST /journeys/:id/apply` | `[data-testid=dp-journey-suggest-start]` || rail · `dp-journey-suggest-start` · code |
| rail-journey-pick | Start a journey (select) → Put <name> in it | `GET /donors/:id/journey-preview`, `POST /journeys/:id/apply` | `[data-testid=dp-journey-pick]` || rail · `dp-journey-pick` · code |
| rail-journey-setup | Set one up (no journeys) | `onNavigate("journeys")` | `[data-testid=dp-journey-setup]` || rail · `[data-testid=dp-journey-setup]` · exists |
| rail-journey-all | See all journeys or build your own | `onNavigate("journeys")` | `[data-testid=dp-journey-all]` || rail · `dp-journey-all` · code |
| rail-contact | Contact: email, phone (tel: via `Phone`), birthday, recurring | phone is a `tel:` link; rest text | `[data-testid=dp-rail-contact]` || rail · `[data-testid=dp-rail-contact] a[href^="tel:"]` · exists |
| rail-owner | Relationship owner · Reassign → Confirm (admin, team) | `PATCH /donors/:id/assign` + interaction | `[data-testid=dp-rail-owner]` "Reassign" || rail · `[data-testid=dp-rail-owner] button:has-text("Reassign")` · exists |
| rail-cf | Custom fields Show/Hide, Edit → Save (when fields) | `PUT /donors/:id/custom-fields` | `[data-testid=dp-rail-custom-fields]` || rail · `dp-rail-custom-fields` · code |
| rail-plan | Cultivation plan Show/Hide | `PlanPanel` → `/donors/:id/plan`, `/plan-steps/:id/skip`, `/plans/:id/stop` | `[data-testid=dp-rail-plan]` || rail · `[data-testid=dp-rail-plan]` · exists |
| rail-events | Events Show n (when registered) | text rows from `GET /donors/:id/events` | `[data-testid=dp-rail-events]` || rail · `dp-rail-events` · code |

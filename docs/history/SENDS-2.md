# SENDS-2 · Nothing goes to a person until someone has seen exactly who it goes to

Five items from Jarvis's 22 Nov sweep (staging Harborlight, prod CREO Arts Demo, a2746ab). One PR, one new suite
(`tests/sends2.test.js`). Wave 1: the one finding that broke the core promise.

## What happened
- **"Send 33 emails" in one click.** A staff confirm (`sendGate.recordStaffConfirm`) is minted by the server inside the
  route, so "a person on staff sent it by hand" meant "an authenticated POST arrived". `POST /volunteer-hub/drafts/send`
  looped `sendDraft` (one confirm per draft), and Volunteers → To send preselected every draft with no dialog. Only the
  mail block stopped 33 stale reminders. Reproduced on a local production build of a2746ab with 33 past-shift
  reminders: 33 ticked, one click, no dialog, 33 emails reached the provider sink. Three more doors had the same shape:
  `/milestone-drafts/send-reviewed` (Communications' Send all reviewed), `/recurring/unlinked/send-reconnect`
  (Recurring giving's reconnect links) and Auctions' "Send all" (the browser pressing the single send once per winner).
- **The fix is a send plan** (`server/mail/sendPlan.js`): the server builds the list (names, addresses, subjects,
  what is refused and why), the person sees it in one dialog (`askSendPlan`), and the commit sends exactly it, once,
  by her, within 10 minutes; anything changed since is skipped and named. `confirmScope.js` refuses a second confirm
  in one request without a plan, every confirm records its `plan_id`, and `scripts/ci/send-plan-scan.js` (CI's guards
  job) fails on any loop that mints confirms outside a plan. On a2746ab's source it names exactly the four doors.
- **33 stale "Reminder for tomorrow" drafts.** `draftRemindersFor` keyed a draft by sign-up and nothing expired it;
  the list showed every `pending_review` row. Now the list hides a reminder whose shift is not tomorrow (org time),
  a send by id refuses it ("Ana's shift was Nov 14, so this reminder is out of date."), and the hourly volunteer sweep
  sets it `expired`. Rows already waiting are hidden at once and expire on the sweep's next pass; a dry-run repair
  (`scripts/ops/sends2-stale-reminders.js`) lists them per org.
- **Older drafts.** A volunteer draft older than 14 days is listed under an Older drafts fold, with the rule under the list.
- **"Send me a test".** Both test routes already refuse any address but the signed-in person's own; the campaign
  route's compare is now case-insensitive, as the template route's was.

## What was learned
A gate that trusts "the server minted a confirm" is only as strict as the loops around it. The confirm now has to
name the list a person saw, and a scan guards the loop shape rather than any one route.

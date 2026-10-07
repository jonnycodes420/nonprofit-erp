# FIX-33 · The real-account walk (15 minutes)

For Jonathan, on his own org **Test Steward** (`jonathan@stewardapp.dev`), with his own Outlook and Gmail.
A lead cannot sign in to these accounts, so this is the one check only you can run. Do it after the FIX-33
deploy and after the four Google settings in `NEEDS-JONATHAN.md` (0-FIX-33).

Pick one friend who will answer an email today. Below they are **Friend** with address **friend@…**.

## 0 · Before you start (1 minute)

Settings → Connections → Email and calendar. For Outlook you should see:

- `Connected as jonathan@stewardapp.dev · read N min ago` (never "not read yet" for long: it reads every 15 minutes).
- The health panel under it: **Mail read**, **Calendar read**, **Logged today**, **This week**, **Meetings found**,
  **Dates on your calendar**. No line in brass under it.

If it says *Steward hasn't been able to read your Outlook yet*, press **Reconnect** once, then **Read now**.

## 1 · Two people on file (2 minutes)

Donors → Add a person: **you** (your Gmail address) and **Friend** (friend@…). Same as any donor.

## 2 · One email each way, both mailboxes (4 minutes)

| Step | Do this | Then in Steward (press **Read now** on the card) |
|---|---|---|
| 2a | From **Outlook**, email Friend: subject "FIX-33 out" | Friend's profile timeline: an **Email** you sent, subject "FIX-33 out". This is the Sent Items fix. |
| 2b | Ask Friend to reply | Friend's timeline: their reply, marked as from them. Engagement moves (Email replies +3). |
| 2c | From **Gmail**, email your Outlook address: "FIX-33 gmail" | Your own person record shows it once in Gmail's card (if Gmail is connected) and once in Outlook's. |
| 2d | Email somebody who is NOT in Steward | Nothing anywhere. Search Steward for the subject: no result. |

Health panel after step 2: **Logged today** went up by 2 to 4, **Mail read** says "just now".

## 3 · Book a meeting in Steward (3 minutes)

Friend's profile → **Book a visit**: Friday 2:00 PM, place "Drinklings", leave "invite them" off.

Within a few seconds, on the profile:

- **Next step:** "Visit with Friend …, Fri 16 Oct, Drinklings" with **Prep** and **Reschedule**.
- **Tasks** (in the same list): "Prep for Friend: read the brief" on Thursday, "How did it go with Friend?" on Friday.
- **Timeline:** "Meeting booked for Fri 16 Oct".
- **Status line** (if Cooling or Drifting): "… Meeting set for 16 Oct."
- **Engagement:** up by 3 (Meetings, "Meeting booked").

In **Outlook**: the event on Friday at **2:00 PM in your own time zone** (not shown as UTC).
On **Home** and the **Thread**: the prep task on Thursday, the meeting on Friday.

## 4 · Move it in Outlook (2 minutes)

In Outlook, drag the event to Monday 10:00 AM. Back in Steward press **Read now** (or wait 15 minutes):

- Next step now says **Mon …**; the prep task moved to the Friday before; the after task to Monday.
- Timeline: "Meeting moved from Fri 16 Oct to Mon 19 Oct".

Then press **Reschedule** in Steward and move it back to Friday: Outlook shows Friday again.

## 5 · A dated task on your calendar (2 minutes)

Connections → turn on **Put my dates on my calendar**. On any person, add a next step "FIX-33 call" for next
Tuesday. Press **Read now**: an all-day "FIX-33 call: …" appears on Tuesday in Outlook. The meeting itself is
never added a second time. Turn the switch off: the Tuesday entry comes off.

## 6 · Cancel (1 minute)

On Friend's profile, the meeting card → **Cancel it**. Outlook: the event is gone. Steward: the two tasks are
gone from the list, the Next step is back to what it was before (or empty), the timeline says
"Meeting on Fri 16 Oct cancelled".

## What the health panel should read at the end

Mail read: just now · Calendar read: just now · Logged today: 4 or more · This week: the same or more ·
Meetings found: 0 (the cancelled one left) · Dates on your calendar: 0 (switch off). No brass error line, no
banner on Home. `npm run status` shows **mailbox sync ok**.

If any line here is not what you see, the step number is the bug report.

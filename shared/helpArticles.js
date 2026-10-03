// shared/helpArticles.js: HELP-1. One article per screen, plus the tasks people come for.
//
// Pure data, no imports. Every app tab id appears in exactly one article's
// `screens`; HELP_SCREEN_IDS at the bottom is the list a guard checks against.
// Pseudo-screens: "profile" is the donor profile, "settings:<id>" a Settings section.

export const HELP_ARTICLES = [
  // ── The tabs ──────────────────────────────────────────────────────────────
  {
    slug: `home`,
    title: `Home`,
    screens: [`dashboard`],
    summary: `Home is your morning screen: the people who need you today, each with one next step.`,
    sections: [
      { h: `What you see`, p: [
        `Home opens with today's date and a greeting. Below it are sections, in this order unless you change it: "Set up Steward" (a checklist while you are getting started), The Thread, Drift, monthly gifts that need you, thank-yous ready, Sequences, and "Tell Steward what to do".`,
        `The Thread shows "First thing": one person and their next step. Drift lists donors who have gone quiet past their own giving pattern. The right rail, "Today", has three tiles: "Open follow-ups", "Due today" and the monthly givers whose card failed this week. Click a tile to see the people behind it.`,
        `If you have connected a calendar and have meetings today, a short brief for each one appears at the top.`,
        `After a meeting, type what happened and Steward reads your note for a pledge, a gift, a fund and a next step, shown under "Steward heard". Each one quotes your own words, and nothing is recorded until you press save. With AI turned off, a simpler reader does the same job and says so. You can also get these meeting briefs by email each morning: tick "Your meetings today" in Settings, under Account.`,
      ]},
      { h: `Work through The Thread`, steps: [
        `Read the person and the step under "First thing".`,
        `Click "Open" with their name to see their record, or "Mark it done" to log the conversation.`,
        `If it is not for today, click "Not today" and choose "No longer a prospect", "Handled outside Steward" or a date to revisit, then "Snooze".`,
        `Click "Show them" to see everyone coming up this week, and "Done" on any row to log it.`,
      ]},
      { h: `Change the layout`, steps: [
        `Click "Edit" at the top right.`,
        `Drag a section to move it, or use "↑ Top" to send it to the top.`,
        `Click "Hide" on a section you do not want. Hidden sections wait in a tray, each with "Show".`,
        `Click "Done" to save, "Cancel" to discard, or "Reset to default".`,
      ]},
      { h: `Good to know`, p: [
        `The layout is yours alone and follows you to another browser. The Thread and "Tell Steward what to do" are always shown. Typing in "Tell Steward what to do" and pressing "Go" opens Agent with your words; nothing runs until you confirm a plan there.`,
      ]},
    ],
  },
  {
    slug: `tasks`,
    title: `Tasks`,
    screens: [`tasks`],
    summary: `Tasks is your list of follow-ups, grouped by when they are due.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your tasks." A line at the top counts what needs attention (overdue and due today), what is open and what is done. Tasks are grouped as Overdue, Due today, Upcoming and No date, with the soonest first.`,
        `Each row shows the task, its due date, the donor it is linked to (click the name to open their record), who it is assigned to, and a HIGH badge when it is high priority. Finished tasks fold into "Completed" at the bottom.`,
        `The "Mine / All" switch chooses between tasks assigned to you and every task in your organisation. Mine is the default.`,
      ]},
      { h: `Add a task`, steps: [
        `Click "+ New task".`,
        `Type what needs to happen, for example "Call Jane about the spring gala".`,
        `If you want, set "Due", "Priority" (high, medium or low) and "Linked donor (optional)".`,
        `Click "Add task", or press Enter.`,
      ]},
      { h: `Finish or reopen a task`, steps: [
        `Click the square box beside a task to mark it complete.`,
        `To reopen one, open "Completed" and click the task.`,
      ]},
      { h: `What this screen does not do`, p: [
        `A task you add here is always assigned to you; there is no field to assign it to someone else. You cannot edit or delete a task from this screen. Tasks also arrive from other places, such as a plan the Agent ran or a follow-up after an event.`,
        `If your subscription has lapsed, the buttons are greyed out with the note "Reactivate your subscription to make changes."`,
      ]},
    ],
  },
  {
    slug: `donors`,
    title: `Donors`,
    screens: [`donors`],
    summary: `Donors is the list of everyone on file, where you search, filter and open a person's record.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your donors." Along the top are the search box, the views (Directory, Team for admins, Re-engage and Map), "✦ Call List", "Log a conversation", "+ Add" and "↑ Import & tools ▾".`,
        `The Directory lists each person with their stage, owner, lifetime giving, last gift and giving strength. Use the stage, owner and designation menus to narrow it, or open "⊞ Filters" for more: stage, giving pattern, geography, last gift, lifetime giving and custom fields. Re-engage gathers lapsed donors. Map shows where people live.`,
      ]},
      { h: `Add a donor`, steps: [
        `Click "+ Add". A "New Donor" card opens.`,
        `Pick a stage, then fill in Full Name, Email and Phone.`,
        `Click "Save".`,
      ]},
      { h: `Record a gift`, p: [
        `There is no gift button on the list itself. Open the person, go to "Gifts & Pledges" and click "+ Add Gift". The "Gift Amount ($)" box on the new donor card sets their totals only and does not create a dated gift, so record the real gift on their record.`,
      ]},
      { h: `Act on several people at once`, steps: [
        `Click "Select" and tick the rows you want.`,
        `Choose "Plan a follow-up". On the Team plan you also get "+ Add to pipeline" and "Move to stage ▾", and admins can use "Assign owner ▾" and "Delete". "Delete" takes a donor off your lists and totals; Steward keeps the record, so support can bring it back. To remove a person for good, use Erase on their profile.`,
      ]},
      { h: `Good to know`, p: [
        `"Export CSV" exports what the search and the stage, owner and designation menus match. The advanced filters only narrow the page you are looking at, and a badge says so. To bring people in from a file, see Import donors.`,
      ]},
    ],
  },
  {
    slug: `groups`,
    title: `Groups`,
    screens: [`groups`],
    summary: `A group is a list of people with a name, kept by hand or by a rule, that works wherever a list does.`,
    sections: [
      { h: `Two kinds`, p: [
        `A group kept by hand holds the people you put in it until somebody takes them out. Add people from the Donors list (click "Select", tick them, then "Add to a group") or from a person's profile, under their name.`,
        `A group by rule carries a lightning mark. Its rule is the same filters the Donors list has: role, giving level, lifecycle, closeness, whether they have given, and stage. Every rule must hold. Who is in it is worked out fresh each time, so a gift that takes somebody to Mid moves them into a Mid group the moment it is recorded, and a refund that takes them back under moves them out. "Warm volunteers who have never given" is one rule: Volunteers, Warm, Has never given.`,
      ]},
      { h: `A group's page`, p: [
        `Each group shows how many people are in it, their average gift, what they gave this fiscal year and in total, how many gifts that is, and the last twelve months month by month. Click any number to see the people or gifts behind it. The list of people can be narrowed to Mid or Major.`,
      ]},
      { h: `Where a group works`, p: [
        `A group can be the audience of a campaign, a tag in your email tool (Settings, Connections), who a journey is for, what starts a journey ("They join a group"), who a survey goes to, and a filter on a saved dashboard and its board pack, where it narrows the gift figures to the group's people.`,
      ]},
    ],
  },
  {
    slug: `journeys`,
    title: `Journeys`,
    screens: [`journeys`, `settings:journeys`],
    summary: `A journey is how you look after somebody, written down once: it starts on its own and reminds your team one step at a time.`,
    sections: [
      { h: `What a journey is`, p: [
        `A journey starts when something happens to a person, such as a first gift, and then puts a step in front of whoever owns the relationship at the right time. It never sends anything. Every step waits for you. If a step has a draft, Steward writes it for you to read, and it is still yours to send.`,
        `You can open Journeys from the rail or from Settings, under Journeys. Both show the same builder. Only admins can create or change a journey; everyone else can read them.`,
      ]},
      { h: `Create a journey`, steps: [
        `Click "Create a journey", or pick one of the cards under "Start from one of these", such as New donor, first year.`,
        `Fill in "What it is called" and "One line about it".`,
        `Under "When it starts", choose the trigger, for example "They give for the first time" or "You put them in it yourself".`,
        `If you want, narrow "Who it is for" by stage, tag or gift size.`,
        `Click "Create it". The journey starts off, with one step.`,
      ]},
      { h: `Edit the steps`, steps: [
        `Open the journey and click a step.`,
        `Set "What happens", "What kind of step", "When" and "Whose step it is".`,
        `Choose "Draft in your voice" if you want Steward to prepare words for you, and add "A note for whoever does it".`,
        `Use "Add one after" or "Add a step before" to build it out.`,
        `Click "Save the journey", then choose who the change applies to.`,
      ]},
      { h: `Turn it on`, steps: [
        `Click "Turn it on".`,
        `To include people who already qualify, click "Apply to people who already qualify" and confirm.`,
      ]},
    ],
  },
  {
    slug: `communications`,
    title: `Communications`,
    screens: [`communications`],
    summary: `Communications is where you write and send email campaigns, build sequences and approve milestone emails.`,
    sections: [
      { h: `What you see`, p: [
        `The tabs are Overview, Campaigns, Templates, Audience, Analytics, Sequences, Your email tool and Drafts to review. Overview shows how many people you can reach, recent sends and your audiences. A campaign is a Draft, Scheduled, Sending or Sent.`,
      ]},
      { h: `Send a campaign`, steps: [
        `Open Campaigns and click "+ New Campaign". Start from a template with "Use this →" or from blank.`,
        `Fill in "Campaign Name", "Subject Line" and "Audience Segment".`,
        `Write the email under "Email Body". "Donation link" adds a link to give. The preview shows what one person will see.`,
        `Click "Send me a test" to check it in your own inbox.`,
        `Click "Save draft", or "↑ Send to" the number shown. Confirm the dialog, which reminds you it sends real emails.`,
      ]},
      { h: `Schedule instead`, p: [
        `Set "Send it later" before you save, and the send button becomes "Schedule". Leave it empty to send it yourself. Only admins see the send and schedule buttons; staff can save drafts for an admin to send.`,
      ]},
      { h: `Sequences`, steps: [
        `Open Sequences and click "New sequence".`,
        `Fill in "What is it called" and "What starts it", then add steps with "+ Add a step".`,
        `Click "Save, and leave it off".`,
        `Click "Preview" to read it, then "Turn on" and "Turn it on" when you are ready. "Turn off" stops it.`,
      ]},
      { h: `Drafts to review`, p: [
        `Steward drafts it. You send it. Emails Steward drafts for a giving milestone, an anniversary or a workflow you turned on wait here, and nothing goes to a donor until somebody sends it.`,
        `Each draft has "Send", "Mark reviewed", "Edit" and "Dismiss". Saving an edit also marks it reviewed. "Send all reviewed" sends every draft marked reviewed, and only those.`,
      ]},
      { h: `Good to know`, p: [
        `Your email tool reports on sends from Mailchimp or Constant Contact once connected. It cannot resend them. "Email This Segment →" on Audience opens a blank campaign, so pick the segment again in the campaign.`,
      ]},
    ],
  },
  {
    slug: `donor-portal`,
    title: `Donor Portal`,
    screens: [`portal`, `settings:portal`],
    summary: `Donor Portal turns on and shares your branded donor sign-in page. It is shown only to organisations on the Portal plan.`,
    sections: [
      { h: `Who sees this`, p: [
        `Donor Portal is hidden from the navigation for most organisations. Nothing behind it is deleted. If your organisation is on the Portal plan, it is your main screen, and Settings has a matching Donor Portal section with an "Open Donor Portal →" button.`,
      ]},
      { h: `What you see`, p: [
        `A card titled "Your donor portal" with a Live or Off marker and three buttons: "Edit the portal", "Open the live portal ↗" and "Copy link". Below it are campaign stories, Impact Updates, and engagement for the last 30 days: sign-ins, dashboard views, impact views and receipt downloads.`,
        `The switches and updates are for admins. Other roles see them greyed out.`,
      ]},
      { h: `Turn the portal on`, steps: [
        `Tick the portal switch so it reads on.`,
        `If you want donors to find you in the directory, tick "List this organization in donor dashboards" and fill in the one-line description, city and state. These save on their own.`,
        `Click "Copy link" and share it with your donors.`,
        `Click "Edit the portal" to change how it looks.`,
      ]},
      { h: `Post an impact update`, steps: [
        `Under "Impact Updates", click "+ New update".`,
        `Add a title, the story and any photos, and choose which donors it shows to.`,
        `Click "Publish update". It appears in the portal. It is not emailed.`,
      ]},
    ],
  },
  {
    slug: `fundraising`,
    title: `Fundraising`,
    screens: [`fundraising`],
    summary: `Fundraising is the place for money coming in: goals, campaigns, pages, recurring gifts, members, major gifts and deposits.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your fundraising." with four sections. Overview shows your goals, what you have raised this period, active campaigns, live giving pages and recent gifts. Campaigns & pages holds Campaigns, Giving pages & forms, Events, Peer-to-peer, Recurring and Members. Major gifts holds At a glance, Pipeline, Proposals, Portfolios and Plans. Money in holds Deposits, Acknowledgments and Funds.`,
      ]},
      { h: `Create a campaign`, steps: [
        `Open Campaigns & pages, then Campaigns, and click "+ New campaign".`,
        `Fill in "Campaign name", "Goal amount", "Type", "Start date" and "Deadline".`,
        `Under "What donors see", add the donor-facing name, a short description, the story and a photo.`,
        `Tick "Show goal progress to donors" if you want them to see it.`,
        `Click "Create campaign".`,
      ]},
      { h: `Record a deposit`, steps: [
        `Open Money in, then Deposits, and click "Add a deposit".`,
        `Fill in "Deposit date", "Slip total" and the lines, then click "Read the slip" and check it before you commit.`,
      ]},
      { h: `Good to know`, p: [
        `Giving pages are created in Settings, under Giving Pages. This screen lists them with "Open ↗" and "Copy link".`,
        `"Propose a recurring gift" under Recurring emails the donor a proposal. Nothing changes until they accept, and the link lasts 14 days.`,
        `The Pipeline is on the Team plan. On Core you see a locked preview. Moving a card asks what happened.`,
        `Proposals are started from a person's record with "+ New proposal". Plans never send anything.`,
        `"Mark as sent" under Acknowledgments records the gifts as thanked by letter. It does not send anything.`,
      ]},
    ],
  },
  {
    slug: `events`,
    title: `Events`,
    screens: [`events`],
    summary: `Events tracks galas, dinners, site visits and the like: who came, where they sat, and the follow-up.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your events." with tiles for events this year, total attendees, event revenue and average attendance. Switch between "Upcoming", "Past" and "All". Each event card shows its figures, and you can click them to see the rows behind them.`,
      ]},
      { h: `Create an event`, steps: [
        `Click "+ New Event".`,
        `Fill in "Event Name", "Event Type" and "Date". Add an end date, location, description, capacity and estimated cost if you have them.`,
        `Click "Create Event →".`,
      ]},
      { h: `Add guests`, steps: [
        `Open the event and click "Add Attendees".`,
        `Choose "From Directory" to pick people already on file, or "Add Guest" to type a name and an optional email.`,
        `Set each person's status: Invited, Confirmed, Attended, No Show or Cancelled.`,
      ]},
      { h: `On the night`, steps: [
        `Under "Tables and seating", click "Add tables", then "Seat everyone". Read the plan and click "Seat them", or "Leave it as it is".`,
        `Use "Print the chart" and "Print name tags" if you want paper.`,
        `Under "Check-in", scan a ticket or type a name, then tap the person to check them in. Tap again to undo.`,
      ]},
      { h: `Afterwards`, p: [
        `Click "✦ Create Follow-up Tasks" to give every attendee a task. "Draft a thank-you per sponsor" puts drafts in Agent for you to review; Steward sends none of them.`,
        `Ticket and sponsorship levels are set in Fundraising, under Campaigns & pages, then Events, not here. The event's goal shows "None set" because there is no goal field yet.`,
      ]},
    ],
  },
  {
    slug: `grants`,
    title: `Grants`,
    screens: [`grants`],
    summary: `Grants tracks applications from first research to award, with the deadlines Steward watches for you.`,
    sections: [
      { h: `What you see`, p: [
        `Three tabs: "Pipeline", "Deadlines" and "✦ Find Grants". Pipeline shows what is in the works, what has been received and the next deadline, as a board ("Kanban") or a "List".`,
      ]},
      { h: `Add a grant`, steps: [
        `Click "+ Add Grant".`,
        `Fill in "Funder", and if you have them, "Program / Grant Name", "Ask Amount ($)", "Program Officer", "Status" and "Deadline".`,
        `Click "Save Grant".`,
      ]},
      { h: `Add a deadline`, steps: [
        `Open the grant and click "Add a deadline".`,
        `Pick the kind: LOI due, Proposal due, Decision expected, Report due or Renewal window opens.`,
        `Pick the date, add a note if you want, and click "Add".`,
        `When it is handled, click "Done", or "Move to" a new date.`,
      ]},
      { h: `Deadlines tab`, p: [
        `Lists the open deadlines for the next twelve months. When one is near, a follow-up opens for the grant's officer. Admins can change how early that happens under "How early Steward reminds you" and "Save lead times".`,
      ]},
      { h: `Good to know`, p: [
        `The board and the list use different stage names. Awarded and LOI can only be set by dragging a card on the board. "Delete" on a grant is for admins. It asks you to confirm, then removes the grant for good.`,
        `There is no separate grant report tracker: you set a Report due deadline, and "✦ Report Outline" can draft an outline. To bring grants in from a file, use Donors, "↑ Import & tools ▾", "Import grants".`,
      ]},
    ],
  },
  {
    slug: `volunteers`,
    title: `Volunteers`,
    screens: [`volunteers`],
    summary: `Volunteers keeps your roster, schedules shifts, checks people in and records their hours and waivers.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your volunteers." in four sections. People holds the Roster. Schedule holds Opportunities and shifts, Groups and Check-in. Records holds Shifts and hours, Waivers and checks, and the Hours report. Reach holds your Sign-up link. Volunteers are people on file like everyone else, so they share one record and one timeline with their giving.`,
        `A volunteer coordinator does not see the giving parts of this screen.`,
      ]},
      { h: `Add a volunteer`, steps: [
        `In People, click "Add a volunteer".`,
        `Fill in their name, email and phone.`,
        `Click "Add them", then "Add another" or "Done".`,
      ]},
      { h: `Set up a shift`, steps: [
        `In Schedule, open Opportunities and shifts and click "New opportunity".`,
        `Name it, say what it is and where, and tick "Needs a signed waiver" or "Needs a background check" if it does. Click "Create it".`,
        `On the opportunity, click "Add a shift", set the date, times and how many people, and click "Add it".`,
        `Click "Copy sign-up link" to share it.`,
      ]},
      { h: `Record hours`, steps: [
        `In Records, open Shifts and hours and click "Log a shift".`,
        `Pick who volunteered, the date, the hours and what they did.`,
        `Click "Log shift".`,
      ]},
      { h: `Good to know`, p: [
        `Check-in rounds hours to the nearest quarter hour. "Import volunteers" takes a CSV or Excel file, and "Undo this import" is offered afterwards. "Download for a funder" in the Hours report gives you a file to send.`,
      ]},
    ],
  },
  {
    slug: `finance`,
    title: `Finance`,
    screens: [`finance`],
    summary: `Finance is the ledger: transactions, funds, budgets, payouts, restricted money and the month-end exports.`,
    sections: [
      { h: `Who sees this`, p: [
        `Finance is on the Team plan and is not shown on Core. It starts hidden for volunteer coordinators, who can show it again by customizing their sidebar.`,
      ]},
      { h: `What you see`, p: [
        `The screen is titled "Your money." with a "Year basis" switch for Fiscal Year or Calendar Year. Overview shows money in by month, what needs you, cash on hand, revenue, expenses and surplus, and your fund balances. Funds holds Funds and Budgets. Deposits and payouts holds Payouts and the Deposit sheet, whose "Open the deposit sheet" button opens the slip right there. Grants money holds Restricted. Exports holds Month close, Year-end statements and the Audit log.`,
      ]},
      { h: `Log a transaction`, steps: [
        `Open Transactions and click "+ Add transaction".`,
        `Choose "↑ Money in" or "↓ Money out".`,
        `Fill in the date, amount, description, account and fund.`,
        `Click "Save transaction".`,
        `If it looks like a donor's gift, Steward asks whether to "Log as a gift" instead.`,
      ]},
      { h: `Add a fund`, steps: [
        `Open Funds and click "+ Add fund".`,
        `Give it a name and description, and tick the restricted box if a donor or grant restricted it.`,
        `Click "Save".`,
      ]},
      { h: `Good to know`, p: [
        `Budgets are edited by clicking a cell. In Month close, the download stays greyed out until the month's deposits balance. Year-end statements is a pointer: the run itself is in Settings, under Tax Receipts. To record a bank deposit, use "Open the deposit sheet" here, or Fundraising, Money in, Deposits, "Add a deposit". Both open the same sheet.`,
      ]},
    ],
  },
  {
    slug: `reports`,
    title: `Reports`,
    screens: [`reports`],
    summary: `Reports holds every report and the four dashboards, and lets you build and save your own.`,
    sections: [
      { h: `What you see`, p: [
        `The screen is titled "Your Reports". The rail on the left has "Build a report", a search box, and groups: Dashboards (Board, Fundraising, People and Recurring), Your saved reports, Who stopped giving, Who gives the most, The year, Money in, Grants, and Volunteers and members.`,
        `Who stopped giving holds LYBUNT, SYBUNT, lapsed donors and retention. Every figure comes with the sentence that defines it, and clicking a figure shows the rows behind it.`,
      ]},
      { h: `Run and export a report`, steps: [
        `Pick a report in the rail.`,
        `Click "Download CSV". LYBUNT, SYBUNT, Retention and Top donors also offer "PDF".`,
        `On a dashboard, click "Export PDF" for a copy to share with your board.`,
      ]},
      { h: `Build your own`, steps: [
        `Click "Build a report".`,
        `Choose what it is about under "A report about…", then pick "Columns".`,
        `Add filters with "Add a filter", and group them with "Add a group" if you need to.`,
        `If you want totals, set "Group and total by". Click "Run it".`,
        `Type a name in "Name this report". Tick "Share with everyone here" or "Email it to me every Monday" if you want.`,
        `Click "Save report". It appears under Your saved reports.`,
      ]},
      { h: `Good to know`, p: [
        `A saved report cannot be edited or deleted yet; build a new one if you need a change. Solicitations and the Pipeline figure on the Fundraising dashboard are on the Team plan.`,
      ]},
    ],
  },
  {
    slug: `agent`,
    title: `Agent`,
    screens: [`agent`],
    summary: `Agent is where you tell Steward what to do in plain words, see the plan, and say yes or no.`,
    sections: [
      { h: `What you see`, p: [
        `Five tabs: Plans, Ask, Workflows, Waiting for you and Guardrails. Steward reads, counts, finds people and drafts. It never records money on its own, refunds, changes a pledge or a monthly gift, or issues a tax receipt.`,
      ]},
      { h: `What it can do for you`, p: [
        `Tell it in your own words and it does the work through the same buttons you would press, as you, and checks each result before it says Done:`,
        `People: change an email, phone or address; make a colleague someone's owner; move their stage; add them to or take them out of a group; put them in a household.`,
        `Conversations: log a call, meeting or email with its date, which updates last contact everywhere; set or replace their next step with a due date.`,
        `Volunteers: make someone a volunteer with hours a week, days and roles; sign them up for a shift; log hours they gave.`,
        `Journeys and events: start or stop a journey for one person or a list; put someone on the guest list of a free event.`,
        `Gifts: when you tell it a gift arrived, it prepares the gift as one card, and nothing is recorded until you press Record. It can mark a gift thanked.`,
        `Duplicates: it proposes that two records are one person, at the top of Data health, and you press Merge.`,
        `If part of what you asked is something it cannot do, the plan says so in one sentence at the top instead of leaving a note. If a name matches more than one person, it asks which before it changes anything. A step that ran but whose result is not there says Failed, with the reason, never Done. Everything it does is in the audit log as the Agent, approved by you, with your words as the reason, and can be undone for thirty days.`,
      ]},
      { h: `Ask for something`, steps: [
        `In Plans, type what you want, for example "Draft a thank-you to every donor who gave this month".`,
        `Click "Show me the plan". Steward lists each step.`,
        `Read it. Click "Run the plan" to go ahead, or "Not this one" to drop it.`,
        `A simple question, such as a count, is answered at once, and Steward writes nothing.`,
      ]},
      { h: `Review what is waiting`, steps: [
        `Open "Waiting for you". Items are oldest first.`,
        `Read each one: a gift to confirm, a thank-you draft, a note.`,
        `Click "Approve", or "Skip" and say why if you want.`,
      ]},
      { h: `Workflows`, p: [
        `Workflows are ready-made recipes you switch on, such as a follow-up when a monthly card fails. Each has "Turn on", its own settings and "View activity".`,
        `Steward drafts it. You send it. A recipe never emails a donor. When a recipe writes an email (the first-gift thank-you, the failed-card note, the optional re-engagement email), the draft waits in Communications under Drafts to review until somebody reads it and sends it.`,
      ]},
      { h: `Guardrails`, p: [
        `Guardrails lists what Steward may and may not do, every instruction you have given, and every change it made, each with "Undo" for thirty days. "Pause everything" stops it at once. Admins can use "Turn drafting off" or "Turn on drafting".`,
      ]},
    ],
  },
  {
    slug: `settings`,
    title: `Settings`,
    screens: [`settings`],
    summary: `Settings is where your organisation, team, connections, receipts, data and security are set up.`,
    sections: [
      { h: `The sections`, p: [
        `Organization: your name, mission, staff and board, and your brand. Team: who can sign in, and invites. Connections: every outside service in one place, from Stripe and PayPal to your inbox, your books and API keys, and whether each one is still working. Giving Pages: your time zone, donor-covers-fees and your giving pages. Customization: custom fields and impact metrics. Your words: what you call donors and gifts. Journeys. Tax Receipts. Imports. Audit log (admins). Your Data. Account. Security.`,
        `Organisations on the Portal plan also see a Donor Portal section.`,
      ]},
      { h: `Find a setting`, steps: [
        `Click Settings at the bottom of the sidebar.`,
        `Pick a section from the list.`,
        `Make your change and click its save button. Most sections save card by card, not all at once.`,
      ]},
      { h: `Who can change what`, p: [
        `Many settings are for admins only: inviting and removing people, Stripe, giving pages, custom fields, receipts, the audit log and the team two-factor rule. Staff can see most sections, but those controls are missing or greyed out for them. If your subscription has lapsed, saves are greyed out with "Reactivate your subscription to make changes."`,
      ]},
      { h: `Where to go next`, p: [
        `See Connect Stripe, Connect your inbox and calendar, Run year-end receipts, Set up two-factor and Import donors for step-by-step help.`,
      ]},
    ],
  },

  // ── The donor profile ────────────────────────────────────────────────────
  {
    slug: `donor-profile`,
    title: `The donor profile`,
    screens: [`profile`],
    summary: `The profile is one person's whole record: their figures, their history, their next step and your tools.`,
    sections: [
      { h: `What you see`, p: [
        `The header has their photo, name and stage, any flags such as Do not contact, and three buttons: "Log a conversation", "Plan a follow-up" and "More ▾". Four figures sit below: Lifetime, Last gift, Last met and Last email. Click any of them to see the rows behind it.`,
        `The tabs are Overview, Gifts & Pledges, Funds, Related, Materials and Activity. Overview has "What do I do next", the timeline, giving by year, recent conversations, household and tasks.`,
        `The rail on the right always shows their next step, contact details, relationship owner, journey and quick actions.`,
      ]},
      { h: `Log a conversation`, steps: [
        `Click "Log a conversation".`,
        `Fill in what happened. Add a gift if one came with it.`,
        `Save it. It joins their timeline.`,
      ]},
      { h: `Record a gift`, steps: [
        `Open "Gifts & Pledges" and click "+ Add Gift".`,
        `Enter the amount, date, type and payment method. Pick a campaign or a pledge it fulfils if it has one.`,
        `Tick "Acknowledgement sent" if you have already thanked them.`,
        `Click "Save".`,
        `Click "Send receipt" on the row to email a tax receipt.`,
      ]},
      { h: `Add a task`, steps: [
        `On Overview, find the tasks list and click "+ Add task".`,
      ]},
      { h: `More`, p: [
        `"More ▾" holds "Request a gift" (a link the donor can give through), "Impact summary", "Send their page link", "Edit record" and, for admins, "Export this person's data". "Erase this person" sits at the bottom of Overview, for admins. See Export or erase a donor.`,
      ]},
    ],
  },

  // ── Settings sections ────────────────────────────────────────────────────
  {
    slug: `settings-organisation-team`,
    title: `Organization and Team`,
    screens: [`settings:org`, `settings:team`],
    summary: `Organization holds your name, mission, staff and brand; Team holds who can sign in.`,
    sections: [
      { h: `Organization`, p: [
        `The first card shows your own name, email and role, and your organisation's name and mission. "Staff and board" lists the people you have marked as staff or board. To add one, open their record and tap the Staff and board chip under their name.`,
        `Under "Brand Identity", drop in your logo, pick your colour and click "Save branding". "Reset to Steward gold" undoes the colour.`,
      ]},
      { h: `Invite someone`, steps: [
        `Open Team and click "+ Invite Staff". Only admins see this.`,
        `Type their email address.`,
        `Pick a role: Staff can view and edit data. Volunteer coordinator sees volunteers and hours only. Admin has full access, including settings.`,
        `Click "Generate invite link" and send the link to them yourself.`,
      ]},
      { h: `Remove someone`, steps: [
        `Find them in "Team Members" and click "Remove".`,
        `Read the confirm and agree. They can no longer sign in, records they wrote keep their name, and their donors become unassigned.`,
      ]},
      { h: `Good to know`, p: [
        `You cannot remove yourself. When every seat on your plan is used, Team says so and offers "Upgrade your plan →".`,
      ]},
    ],
  },
  {
    slug: `settings-connections`,
    title: `Connections`,
    screens: [`settings:connections`, `settings:integrations`],
    summary: `Connections is the one page for every outside service: setting it up, and checking it is still working.`,
    sections: [
      { h: `What you see`, p: [
        `At the top, one line says how many services are connected and how many need attention. Click either number to see just those cards; click "Show every connection" to go back.`,
        `Then six sections, always in this order: Giving (Stripe, PayPal, Givebutter, Donorbox, Zeffy, Cash App, Venmo and statement imports), Email and calendar (Gmail and Outlook, and the BCC address), Email marketing (Mailchimp, Constant Contact), Books (QuickBooks, Xero and the bookkeeper file), Point of sale (Square, Toast) and Build your own (API keys, webhooks and Zapier).`,
        `Every card says the same things: what the service does, and its status. "Connected" shows when it last synced, "Not connected" means nothing comes through it, and "Needs attention" is in brass with the reason.`,
      ]},
      { h: `Connect, manage or fix`, steps: [
        `Find the service's card.`,
        `Click "Connect" to set it up. Some open the service's own sign-in page; others ask for a key, with "Test" to try it before you save.`,
        `Click "Manage" on a connected card to see what came through it, open its "Sync log", or "Check now".`,
        `Click "Fix" on a card that needs attention. It opens the same detail with the reason at the top.`,
      ]},
      { h: `Good to know`, p: [
        `Donorbox has no direct connection yet, so its card offers "Import a file": its gift export comes in as a statement.`,
        `For a bookkeeping tool, "Manage" opens "Where the money posts", where "Save the mapping" says which account each fund goes to. For an email tool, "Preview" then "Save and keep in step".`,
        `Your donation form's QR code and embed code are not connections. They are in Fundraising, under Giving pages and forms. Settings used to have a separate Integrations section; it is part of this page now, and old links to it land here.`,
      ]},
    ],
  },
  {
    slug: `settings-giving-pages`,
    title: `Giving Pages`,
    screens: [`settings:giving`],
    summary: `Giving Pages is where you create the pages donors give through, and set your time zone and processing fees.`,
    sections: [
      { h: `What you see`, p: [
        `Three cards: "Time Zone", "Let Donors Cover Processing Costs" and "Giving Pages". Your pages are listed with "Edit" and "Archive". Archived pages can be restored with "Reactivate". Fundraising lists the same pages with links to open and copy.`,
        `You need Stripe connected for a page to take card gifts. See Connect Stripe.`,
      ]},
      { h: `Create a giving page`, steps: [
        `Click "+ New Giving Page". Only admins see it.`,
        `Fill in the page.`,
        `Click "Create giving page".`,
        `To change it later, click "Edit", then "Save changes".`,
      ]},
      { h: `Let donors cover the fees`, steps: [
        `Under "Let Donors Cover Processing Costs", click "Enable donor-covers-fees".`,
        `Donors then see an option to add the processing cost to their gift. Click "Disable donor-covers-fees" to turn it off.`,
      ]},
      { h: `Set your time zone`, steps: [
        `Under "Time Zone", pick your organisation's zone. Only an admin can change it.`,
      ]},
    ],
  },
  {
    slug: `settings-customization-words`,
    title: `Customization and Your words`,
    screens: [`settings:customization`, `settings:words`],
    summary: `Customization adds your own fields and impact metrics; Your words sets what Steward calls things.`,
    sections: [
      { h: `Add a custom field`, steps: [
        `Open Customization. Under "Custom Fields", choose "Donor fields" or "Gift fields".`,
        `Click "+ Add Field". Only admins see it.`,
        `Name the field and pick its type. The type cannot change after you create it.`,
        `Save it. Use ↑ and ↓ to change the order.`,
      ]},
      { h: `Retire a field`, p: [
        `Click "Archive". Fields are never deleted, so the values already stored are kept. Open "Archived" and click "Restore" to bring one back.`,
        `If some stored values do not fit their field's type, a card lists them with a "Fix" button for each.`,
      ]},
      { h: `Impact metrics`, steps: [
        `Under "Impact Metrics", click "+ Add Metric".`,
        `Name it, set the gift amount it starts at, and write the outcome sentence, for example what that gift pays for.`,
        `Save it. Use "Edit" or "Delete" later.`,
      ]},
      { h: `Your words`, p: [
        `These are the questions you answered when you started: what you call your donors, your monthly givers and so on. Change an answer here and Steward uses your word across the app. Your words never change a receipt, a year-end statement or the donor portal.`,
      ]},
    ],
  },
  {
    slug: `settings-tax-receipts`,
    title: `Tax Receipts`,
    screens: [`settings:receipts`],
    summary: `Tax Receipts holds your legal details and turns receipts on, and is where you run year-end statements.`,
    sections: [
      { h: `Set up receipts`, steps: [
        `Open Settings, then Tax Receipts.`,
        `Fill in "Legal name", "EIN" and "Receipt address". These three are required.`,
        `If you want, add "Signature name (optional)", "Signature title (optional)" and "Custom message (optional)". Write {{donor_name}} in the message to use the donor's name.`,
        `Click "Save settings".`,
        `Click "Enable receipts". The badge changes to Enabled.`,
        `Click "Preview receipt" to see a sample receipt as a PDF.`,
      ]},
      { h: `What happens next`, p: [
        `Online gifts through your giving pages are receipted automatically. For a gift you record by hand, click "Send receipt" on the gift's row in the donor's Gifts & Pledges tab.`,
        `The sample in "Preview receipt" is a single gift receipt for a made-up donor, not a year-end statement.`,
      ]},
      { h: `Turn receipts off`, p: [
        `Click "Disable receipts". Receipts already sent are kept.`,
      ]},
      { h: `Year-end statements`, p: [
        `The "Year-End Giving Statements" card is for admins and appears once receipts are enabled. It never runs on its own in January; you start it each year. See Run year-end receipts.`,
      ]},
    ],
  },
  {
    slug: `settings-imports`,
    title: `Imports`,
    screens: [`settings:imports`],
    summary: `Imports is the record of every file you have brought in, with what each one added.`,
    sections: [
      { h: `What you see`, p: [
        `A table of every import, newest first: its name, date, who ran it, rows in, gifts created and dollars in. Open a row to see the receipt it showed when it finished. If an import does not add up, the row says "Does not reconcile" so you can open it and see why.`,
        `This page is a record. It does not undo an import, and there is no import button here. To import, go to Donors and use "↑ Import & tools ▾". See Import donors.`,
      ]},
      { h: `Add photos`, steps: [
        `Under "Add photos", click "Choose a folder".`,
        `Pick a folder of headshots. Steward matches each photo to a person by email, old-system ID or full name.`,
      ]},
      { h: `Moving from another system`, p: [
        `If you are moving from another database, a card asks whether you have moved. Click "Yes, we've moved" once you have stopped using the old one, or "Not yet". You can change your answer later.`,
      ]},
    ],
  },
  {
    slug: `settings-audit-log`,
    title: `Audit log`,
    screens: [`settings:audit`],
    summary: `The audit log is every change anyone made, who made it and when. Only admins can open it.`,
    sections: [
      { h: `What you see`, p: [
        `Each change in your organisation is one row: who did it, what they did and when. That includes sign-ins, role changes and downloads of donor files, as well as edits to records. Rows cannot be changed or removed, by anyone.`,
        `Someone who is not an admin sees "The audit log is available to your organization's admins."`,
      ]},
      { h: `Find a change`, steps: [
        `Open Settings, then Audit log.`,
        `Use the filters at the top to narrow the list.`,
        `Click "What changed" on a row to see the before and after. Click "Hide what changed" to close it.`,
        `Click "Clear" to reset the filters.`,
      ]},
      { h: `Good to know`, p: [
        `Finance has its own audit log under Exports, with "Export CSV", for the money side. Changes the Agent made are listed in Agent, under Guardrails, where each can be undone for thirty days.`,
      ]},
    ],
  },
  {
    slug: `settings-data-account`,
    title: `Your Data and Account`,
    screens: [`settings:data`, `settings:account`],
    summary: `Your Data exports everything you hold; Account holds billing, notifications, your sending address and sign out.`,
    sections: [
      { h: `Export your data`, steps: [
        `Open Settings, then Your Data.`,
        `Click "Export all data (CSV)" (admins) or "Export as JSON".`,
        `When it says "Your export is ready.", the file downloads. "Download it again" fetches it a second time.`,
      ]},
      { h: `Other things on Your Data`, p: [
        `"Reading and drafting" is the one switch for all of Steward's AI: cheque reading, drafts, briefs, scores, board summaries, Ask Steward and voice memos. Only admins can change it. When it is off, nothing is sent to Anthropic or OpenAI, and each of those features says "AI is turned off for your organization" and shows what it can without AI. "Demo Data" loads or clears sample donors so you can try things safely.`,
      ]},
      { h: `Account`, p: [
        `Billing shows your plan and card, with "Manage billing →", "Choose a plan →" and "Cancel subscription". "Email notifications" lets you choose which emails you get: gifts to your donors, task assignments, the daily reminder, The Thread, and "Your meetings today", which is off unless you tick it and sends you, and only you, the same meeting briefs Home shows. "Show other income on the board dashboard" adds one figure you keep elsewhere, shown beside giving and never added to it. "Sign out" is at the bottom.`,
      ]},
      { h: `Send from your own address`, steps: [
        `Under "Send from your own address", type the address you want mail to come from and click "Use this address". Admins only.`,
        `Add the records shown to your domain's DNS. "Copy" copies each value.`,
        `Click "Check". It can take a few minutes for the records to be seen.`,
        `"Use Steward's address instead" goes back to the default.`,
      ]},
      { h: `Your voice`, p: [
        `Paste a few of your own thank-yous under "Your voice, for the thank-yous Steward drafts" and click "Save my voice".`,
      ]},
    ],
  },
  {
    slug: `settings-security`,
    title: `Security`,
    screens: [`settings:security`],
    summary: `Security holds two-factor sign-in, the team rule, where you are signed in, and your password.`,
    sections: [
      { h: `What you see`, p: [
        `"Two-factor sign-in" says whether it is on for you. Admins also see "Require two-factor for everyone on the team" and a "Your team" card with each person's two-factor state. "Where you're signed in" lists every browser used in the last week. "Change your password" is at the bottom.`,
      ]},
      { h: `Sign out a lost device`, steps: [
        `Under "Where you're signed in", find the browser you do not recognise.`,
        `Click "Sign out" on that row, or "Sign out everywhere else" to end every session but this one.`,
      ]},
      { h: `Change your password`, steps: [
        `Type your current password.`,
        `Type a new one of 8 or more characters.`,
        `Click "Change password". Every other session is signed out.`,
      ]},
      { h: `For admins`, steps: [
        `Turn on two-factor for yourself first. Steward will not let you require it otherwise.`,
        `Tick "Require two-factor for everyone on the team". People without it set it up the next time they sign in.`,
        `If someone loses their phone, click "Reset two-factor" beside them. This ends their sessions and emails them.`,
        `"Sign out everywhere" beside a person ends all of their sessions.`,
      ]},
      { h: `Good to know`, p: [
        `See Set up two-factor for the step-by-step. Security also has a "Download everything" card for admins, which downloads all your data as JSON.`,
      ]},
    ],
  },

  // ── Tasks people come for ────────────────────────────────────────────────
  {
    slug: `import-donors`,
    title: `Import donors`,
    screens: [],
    summary: `Bring your donors, and their gift history if you have it, into Steward from a spreadsheet or another system.`,
    sections: [
      { h: `Before you start`, p: [
        `Steward reads .csv, .tsv, .xlsx and .xls files. You can also paste CSV text and click "Parse →". Steward has a short how-to for exporting from your old donor system.`,
      ]},
      { h: `Import`, steps: [
        `Open Donors and click "↑ Import & tools ▾".`,
        `Choose "Import + History" (recommended) to bring gifts too, or "Import donors only".`,
        `Under "Where are your donors today?", pick your old system and read its short how-to, then click "Continue". Or click "Skip this, I already have my file ready".`,
        `Drop your file where it says "Drop your spreadsheet here, or browse". If the workbook has a donors sheet and a gifts sheet, Steward offers to import both.`,
        `Check the mapping. Steward says what it detected. Click "✦ Auto-map" or set each column yourself.`,
        `For every column you have not mapped, choose "Store it" or "Discard". The import waits until each one is decided.`,
        `Click "Import" with the counts shown, for example "Import 412 donors + 1,906 gifts →".`,
        `Read the result. Duplicates are matched to existing people, and each merge has "Undo". Click "Done".`,
      ]},
      { h: `Afterwards`, p: [
        `Every import is listed in Settings, under Imports, with what it added and whether it adds up. That page is a record and does not undo an import.`,
        `To add gifts for people already on file, use "Add giving history" from the same menu. "Merge duplicates" is there too.`,
      ]},
    ],
  },
  {
    slug: `connect-stripe`,
    title: `Connect Stripe`,
    screens: [],
    summary: `Connect Stripe so your giving pages can take card gifts, paid straight to your organisation.`,
    sections: [
      { h: `What it does`, p: [
        `Steward creates a Stripe Express account for your organisation and Stripe pays you directly. Steward never touches your money. Only an admin can do this. Have your bank details to hand.`,
      ]},
      { h: `Connect`, steps: [
        `Open Settings, then Connections.`,
        `On the Stripe card under Giving, click "Connect".`,
        `Stripe's own pages open. Fill in your organisation's details and bank account and finish every step.`,
        `Stripe sends you back to Steward's Home screen.`,
        `Go back to Settings, Connections. Once Stripe says your account can take donations, the Stripe card says "Connected". Click "Manage" to see your account number and the date.`,
      ]},
      { h: `If you stop part way`, p: [
        `Until Stripe has everything it needs, the Stripe card says "Needs attention" and "Stripe setup isn't finished". Click "Fix" to pick up where you left off on the same account.`,
      ]},
      { h: `Check it is working`, steps: [
        `Open Settings, then Connections.`,
        `Find the Stripe card. Under "Take gifts on your giving pages" it should say it is on.`,
        `Make a small gift on your giving page and check it appears on the donor's record.`,
      ]},
      { h: `Good to know`, p: [
        `Accounts are set up for the United States. "Read your Stripe history" on the Connections card is a separate, read-only connection.`,
      ]},
    ],
  },
  {
    slug: `connect-inbox-calendar`,
    title: `Connect your inbox and calendar`,
    screens: [],
    summary: `Let your inbox and calendar keep the record, so emails and meetings with donors land on their timeline.`,
    sections: [
      { h: `What Steward reads`, p: [
        `Emails with people already in Steward, and meetings where one of them is invited: who, when, the subject and the body. It never reads mail with people who are not in Steward, does not open attachments (it only notes them), and never sends, deletes or moves an email. It adds to your calendar only when you book a visit from a donor's record.`,
        `Each person connects their own inbox.`,
      ]},
      { h: `Connect`, steps: [
        `Open Settings, then Connections, and find the "Gmail and Outlook" card under "Email and calendar". Click "Connect".`,
        `Click "Connect Gmail and Google Calendar" or "Connect Outlook and Microsoft 365".`,
        `Sign in to Google or Microsoft and allow access.`,
        `Back in Steward, you see what was logged: emails from the last two years, meetings from a month back to two months ahead, and how many people now have a history.`,
      ]},
      { h: `Keep some mail private`, steps: [
        `Under "Never log these", type an email address or a whole domain.`,
        `Click "Add". Click "Remove" to take one off.`,
      ]},
      { h: `Pause or disconnect`, p: [
        `"Sync now" reads straight away. "Pause" stops reading until you click "Turn back on". "Disconnect" stops it and keeps what was logged. "Disconnect and remove" also deletes what it logged, and cannot be undone.`,
      ]},
      { h: `Rather not connect`, p: [
        `Use your organisation's BCC address instead: BCC it on any email to a donor and the email lands on their record. Find it under "Log an email by BCC", with a "Copy" button. A message that names nobody on file is held for you to place, or stored nowhere.`,
      ]},
    ],
  },
  {
    slug: `thank-a-gift`,
    title: `Thank a gift`,
    screens: [],
    summary: `Every gift gets a thank-you written and sent by a person: Steward drafts it, you send it from your own mail.`,
    sections: [
      { h: `How it works`, p: [
        `When a gift is recorded, Steward drafts a thank-you and puts it on Home under "Thank-yous ready". Steward does not send it. It goes from your own mail. Donors marked deceased or do not contact are skipped.`,
      ]},
      { h: `Thank by email`, steps: [
        `On Home, find "Thank-yous ready".`,
        `Click "Read the draft".`,
        `Click "Copy" and paste it into a new email to the donor. Change any words you like there.`,
        `Send it from your own email.`,
        `Back in Steward, click "Mark sent". The gift is marked thanked and the thank-you is logged. Click "Skip" if you are thanking them another way.`,
      ]},
      { h: `Thank by letter`, steps: [
        `Open Fundraising, then Money in, then Acknowledgments. It lists gifts nobody has marked thanked.`,
        `Choose a template and tick the gifts. Gifts with a postal address are ticked for you.`,
        `Click "Preview", then "Print letters" and, if you want, "Mailing labels".`,
        `Sign and post the letters, then click "Mark as sent".`,
      ]},
      { h: `Already thanked them`, p: [
        `Tick "Acknowledgement sent" when you add the gift on the donor's Gifts & Pledges tab, or tick Ack on the gift row later.`,
      ]},
      { h: `Make the drafts sound like you`, p: [
        `Click "Teach Steward your voice →", or open Settings, Account, paste a few of your own thank-yous and click "Save my voice".`,
      ]},
      { h: `Not the same as a receipt`, p: [
        `A tax receipt is separate: "Send receipt" on the gift row emails it directly.`,
      ]},
    ],
  },
  {
    slug: `video-thank-you`,
    title: `Send a video thank-you`,
    screens: [],
    summary: `Record a short video for one donor on their record. Steward saves it and drafts the email with the link; you read the draft and send it.`,
    sections: [
      { h: `How it works`, p: [
        `A video thank-you is up to two minutes, recorded with your computer's or phone's camera. Saving it stores the video and puts one draft email to the donor, with the link in it, in Communications under "Drafts to review". Nothing is sent until you send it.`,
        `The donor opens the link to a small page in your organisation's colours with the video on it. The link is the only way in, and nothing else about the donor is on the page.`,
      ]},
      { h: `Record one`, steps: [
        `Open the donor's record and click "More".`,
        `Click "Record a video thank-you". Your browser asks to use the camera and microphone the first time; allow it.`,
        `Click "Start recording". The time left shows while you record, and it stops by itself at two minutes. Click "Stop" when you are done.`,
        `Watch it back. Click "Record again" if you want another take.`,
        `Click "Save and draft the email". Click "Open the page the donor will see" to check it, then "Done".`,
      ]},
      { h: `Send it`, steps: [
        `Open Communications, then "Drafts to review".`,
        `Read the draft. Change any words you like.`,
        `Send it.`,
      ]},
      { h: `Good to know`, p: [
        `"Record a video thank-you" is greyed out when the donor has no email address, is marked deceased or do not contact, or when you have read-only access.`,
        `On a phone without in-browser recording, the button opens your phone's own camera instead. A video must be WebM or MP4 and two minutes or less.`,
        `Videos you recorded before are listed under "Recorded before" in the same window, each with "Watched" and the date once the donor has played it, or "Not watched yet". Playing the video is what counts as watched; a mail scanner opening the link does not.`,
      ]},
    ],
  },
  {
    slug: `year-end-receipts`,
    title: `Run year-end receipts`,
    screens: [],
    summary: `Send every donor one statement of what they gave last year, for their taxes, when you choose to.`,
    sections: [
      { h: `Before you start`, p: [
        `Receipts must be set up and enabled in Settings, under Tax Receipts, with your legal name, EIN and receipt address. Only an admin can run statements. Steward never runs them on its own: you start the run each year.`,
      ]},
      { h: `Run the statements`, steps: [
        `Open Settings, then Tax Receipts, and scroll to "Year-End Giving Statements".`,
        `Check "Tax year". It starts on last year.`,
        `Click "Dry run". Steward shows how many donors and gifts it found, and how many donors have no email address. Nothing is sent.`,
        `Fix any missing emails you can on those donors' records, and run the dry run again.`,
        `Click "Generate & send" and confirm. This sends real emails.`,
        `Read the result: how many statements were made, emailed and skipped.`,
      ]},
      { h: `Donors with no email`, p: [
        `Their statement is still made, just not emailed, so plan to reach them another way.`,
      ]},
      { h: `One donor at a time`, steps: [
        `Open the donor and go to "Gifts & Pledges".`,
        `Click "Year-end statement", choose the "Tax year", and click "Generate & email".`,
        `It replaces any earlier statement for that year.`,
      ]},
      { h: `Good to know`, p: [
        `There is no preview of a real statement before the bulk send, so try one donor first if you want to see it. Finance has a Year-end statements card that brings you back here.`,
      ]},
    ],
  },
  {
    slug: `two-factor`,
    title: `Set up two-factor`,
    screens: [],
    summary: `Two-factor asks for a six-digit code as well as your password, so a stolen password is not enough.`,
    sections: [
      { h: `Turn it on`, steps: [
        `Open Settings, then Security, and find "Two-factor sign-in".`,
        `Click "Use an authenticator app" or "Use a code by email".`,
        `For an app, scan the QR code with your authenticator, or type the key shown. For email, open the code Steward sent you. It lasts 10 minutes.`,
        `Type the six-digit code and click "Turn it on".`,
        `Save your ten recovery codes with "Copy" or "Download". They are shown once only.`,
      ]},
      { h: `Signing in`, steps: [
        `Enter your email and password and click "Sign In →".`,
        `Type the six-digit code from your app or your email.`,
        `Tick "Trust this browser for 30 days" on a computer only you use.`,
      ]},
      { h: `Lost your phone`, p: [
        `Type one of your recovery codes instead of the six-digit code. Each works once, and Steward emails you when one is used. If you have none left, ask an admin to click "Reset two-factor" beside your name.`,
        `Five wrong codes in a row pause code entry for 15 minutes, and Steward emails you.`,
      ]},
      { h: `Manage it later`, p: [
        `In Security, type a current code to use "Make new recovery codes" (the old set stops working) or "Turn two-factor off". If your organisation requires two-factor, it stays on.`,
      ]},
      { h: `Require it for the team`, p: [
        `Admins: turn it on for yourself, then tick "Require two-factor for everyone on the team". Anyone without it sets it up at their next sign-in.`,
      ]},
    ],
  },
  {
    slug: `export-or-erase-a-donor`,
    title: `Export or erase a donor`,
    screens: [],
    summary: `Give a person a copy of what you hold about them, or remove them for good while your books still add up.`,
    sections: [
      { h: `Export one person's data`, steps: [
        `Open the person's record. You need to be an admin.`,
        `Click "More ▾", then "Export this person's data".`,
        `A JSON file named after them downloads at once.`,
      ]},
      { h: `What the export holds`, p: [
        `Their profile, gifts, pledges, receipts, logged notes, emails and meetings, calendar meetings, event attendance, volunteer hours, custom fields, relationships, and their email preferences. It does not include tasks or thank-you drafts. The download is recorded in the audit log.`,
      ]},
      { h: `Erase a person`, steps: [
        `Open the person's record. You need to be an admin.`,
        `On Overview, scroll to the bottom and click "Erase this person".`,
        `Read what will happen.`,
        `Type ERASE in capitals in the box.`,
        `Click "Erase for good", or "Cancel".`,
      ]},
      { h: `What erase removes and keeps`, p: [
        `Removed for good: their name, contact details, notes, tags, photo, custom fields, and every logged email, meeting and conversation, along with their tasks, drafts and journey steps. Their name is scrubbed from gift notes and from receipts already made.`,
        `Kept: their gifts, as anonymous gifts, so your books, issued receipts and every total still match to the cent. The record stays as "Erased person". If they asked not to be emailed, their address stays on your do-not-email list so they are never mailed again. The audit log notes that an erasure happened, not what was erased.`,
        `This cannot be undone. Export first if the person asked for a copy.`,
      ]},
    ],
  },
];

// Every app tab id found in client/src/lib/navGroups.js and App.jsx.
export const HELP_SCREEN_IDS = [
  `dashboard`, `tasks`, `donors`, `journeys`, `communications`, `portal`,
  `fundraising`, `events`, `grants`, `volunteers`, `finance`, `reports`,
  `agent`, `settings`,
];

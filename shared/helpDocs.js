// shared/helpDocs.js · SUPPORT-1. Built from docs/help/*.md by support/buildIndex.mjs. Do not edit by hand.
export const HELP_DOCS = [
 {
  "slug": "ask",
  "title": "Ask about your file",
  "summary": "The Ask box answers a plain question about your own records in one sentence, and every number in the answer opens the gifts or people behind it.",
  "screens": [
   "ask"
  ],
  "route": "/app/reports",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Type a question the way you would ask a colleague, and Steward answers from your own records. The box is labelled \"Ask\" on Reports, \"Ask about this campaign\" on a campaign's page, and \"Ask\" on the Calendar, where every question is about the dates on screen. On Home, the box under the greeting takes a question too. Under the box are a few suggestions, drawn from the questions your organization asks most."
    ]
   },
   {
    "h": "Ask a question",
    "steps": [
     "On Reports, click the box that says \"Ask anything about your file\", type your question and press Enter, or click one of the suggestions.",
     "Read the answer. Click any number to see the gifts or people behind it. \"Counted:\" says exactly what was counted.",
     "Click \"How Steward read this\" to see how your question was understood.",
     "Ask a follow-up in the box at the bottom, such as \"And last year?\" or \"Who are they?\", and click \"Ask\". It builds on the answer before.",
     "Press Escape, or the × at the top, to close."
    ]
   },
   {
    "h": "Keep an answer",
    "steps": [
     "Click \"Pin to Home\" to keep the answer on Home. It is worked out again every time Home opens, so the number is always today's. \"Unpin\" removes it.",
     "Click \"Save to a dashboard\", choose a dashboard and click \"Add\". Only the person who made a dashboard can add to it."
    ]
   },
   {
    "h": "An example",
    "p": [
     "You type \"How much did we raise last year from monthly donors?\". Steward answers in one sentence with the total, say $18,240, and \"Counted:\" under it. You click $18,240 and see each gift behind it. You ask \"Who are they?\" in the box at the bottom and see the people behind the answer, then click \"Pin to Home\"."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "The Ask box never changes a gift or a person's details, and never sends anything. When an answer offers to plan a step and you click it, the step goes on your Thread and nothing is sent. If Steward cannot answer from your records, it says so plainly. When your organization has an old system's report for a stretch Steward has no gifts for, the answer quotes it and never adds it into Steward's numbers."
    ]
   }
  ]
 },
 {
  "slug": "auctions",
  "title": "Auctions",
  "summary": "Auctions runs an online auction with its own public page: donated items, bidding that opens and closes on time, and winners who pay through your own Stripe account.",
  "screens": [
   "auctions"
  ],
  "route": "/app/fundraising?fr=auctions",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Auctions sits under Fundraising, in Campaigns & pages, and has its own entry in the sidebar under Raise. An auction can belong to an event or stand on its own. Each auction has a public page where people register to bid with their name, email and phone. Steward keeps the items, who is winning, who won, whether they have paid and who registered, and it prepares the notes you send. Nothing here sends by itself and nothing here moves money."
    ]
   },
   {
    "h": "Start an auction",
    "steps": [
     "Click \"New auction\".",
     "Give it a \"Title\", and choose \"Part of an event (optional)\" or leave it \"On its own\".",
     "Set \"Bidding opens\" and \"Bidding closes\", and add \"What it is for\".",
     "Click \"Create auction\". The auction opens, with its public page link at the top."
    ]
   },
   {
    "h": "Add an item",
    "steps": [
     "Inside the auction, click \"Add an item\".",
     "Fill in the \"Title\", \"Category\", \"Donated by\" (a name already on file), \"Fair market value\", \"Starting bid\" and \"Bid increment\". \"Buy now (optional)\" is there if you want it.",
     "Add a \"Description\" and up to five photos. The first photo is the main one.",
     "Click \"Save item\". Once an item has a donor and a fair market value, \"Record as in-kind gift\" records the donation on that person's record."
    ]
   },
   {
    "h": "Close out the winners",
    "steps": [
     "When bidding closes, each item's winner appears under \"Winners\": the highest bid, and between equal bids, the earliest.",
     "If someone won in the room, click \"Record the winner\" on the item, pick \"Who won it\" and the \"Winning bid\", then \"Save the winner\".",
     "Under \"Notes to bidders\", click \"Prepare the winners' emails\". Steward writes a draft for each winner with their pay link. Read each one and press \"Send\", or \"Send all\" when there are several. \"Preview the winner email\" shows what the winner sees.",
     "\"Copy pay link\" gives you a winner's link to share another way."
    ]
   },
   {
    "h": "Remind bidders before it closes",
    "steps": [
     "While the auction is open, click \"Prepare \"bidding closes soon\"\" under \"Notes to bidders\".",
     "Read the drafts and press \"Send\" on each, or \"Send all\"."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Raised: every payment a winner has made for an item in this auction, at the amount charged: the gift their payment recorded.",
     "Won, paid or not: the winning bid on every item whose bidding has closed, whether the winner has paid yet or not.",
     "Items sold: every item whose bidding has closed with a winning bid, with that bid.",
     "Items unsold: every item whose bidding has closed with no bid at all. An item still open is neither sold nor unsold.",
     "Bidders: every registered bidder who placed at least one bid, largest total of winning bids first.",
     "Click any of these numbers to see the items or people behind it."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never charges a winner and never sends a note on its own: winners pay on your own Stripe account, and every note waits for your Send. Without Stripe connected, winners cannot pay online, so take their payment as you would any gift. Steward does not issue refunds. If a payment needs refunding, the screen lists it under \"Payments to refund\"; refund it in Stripe, then click \"I refunded this in Stripe\". \"Archive\" takes the public page down and keeps every bid and winner."
    ]
   }
  ]
 },
 {
  "slug": "brand-kit",
  "title": "Brand kit",
  "summary": "The brand kit holds the colors, signature, address and tax language that every template, printed letter and receipt uses.",
  "screens": [
   "settings:brandkit"
  ],
  "route": "/app/settings?section=brandkit",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "The brand kit lives in Settings. Set it once and every template, printed letter and receipt reads it: two colors from a safe palette, the signature block, your organization's address and the tax language. Your logo is the logo you already uploaded."
    ]
   },
   {
    "h": "Choose your colors",
    "steps": [
     "Open Settings, then Brand kit.",
     "Pick a \"Main color\" and a \"Second color\". Only colors that stay readable on paper and on screen are offered.",
     "Click \"Save brand kit\"."
    ]
   },
   {
    "h": "Set the signature and address",
    "steps": [
     "Under \"Signature block\", fill in the \"Signer name\" and \"Signer title\". \"Another signature line\" adds a second signer.",
     "Add one more line if you want, such as a phone number or a P.S.",
     "Check the \"Organization address\".",
     "Click \"Save brand kit\". From then on, every template, printed letter and receipt uses it."
    ]
   },
   {
    "h": "Set your tax language",
    "steps": [
     "Under \"Tax language\", write the sentence printed at the foot of every receipt and statement. Your EIN follows it.",
     "Left empty, Steward uses the sentence shown in grey."
    ]
   },
   {
    "h": "Preview a letter with a real person",
    "steps": [
     "Under \"Preview with a real person\", find a person to preview with.",
     "Look at the letter with their details filled in.",
     "\"Print for this person\" downloads it, ready to print. \"Make a draft for this person\" puts it in your drafts to review; nothing is sent."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward does not let you pick a color that would be hard to read, and it never sends a letter from here. Changes are not used until you save them; the screen says \"Changed, not saved\" until you do."
    ]
   }
  ]
 },
 {
  "slug": "data-health",
  "title": "Data health",
  "summary": "Data health finds the tidying your records need, such as duplicates, messy addresses, people who moved and emails that bounce, and lets you fix each with one approval.",
  "screens": [
   "donors:health"
  ],
  "route": "/donors?view=health",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Data health is a view of Donors, beside Directory, Re-engage and Map. It shows one line for each kind of mess: a count that opens its rows, a sentence that says what the count is, and the one action that fixes it. Steward suggests, and a person approves. Nothing changes until you press the button, and a merge can be undone for 30 days."
    ]
   },
   {
    "h": "Merge duplicates",
    "steps": [
     "On \"Possible duplicates\", click \"Review pairs\". Each pair carries a High, Medium or Low confidence.",
     "Click \"Compare\" to see the two records side by side, then \"Compare and merge\" to choose which record to keep. \"Keep the other record instead\" swaps them.",
     "If they are not the same person, click \"Not a duplicate\".",
     "\"Merge all high-confidence pairs\" merges every high-confidence pair at once. Pairs from two different households are left for you to merge one at a time.",
     "Under \"Recent merges\", \"Undo\" brings back both records and every gift, note and row that moved, for 30 days."
    ]
   },
   {
    "h": "Tidy addresses",
    "steps": [
     "On \"Addresses to tidy\", click \"Review changes\".",
     "Each address is shown the standard US way: street words shortened the postal way, units on their own line, two-letter states, ZIP+4 written with a dash, capitals fixed. This is worked out on Steward's own server; no address is sent anywhere.",
     "Approve the ones that look right, or skip them. Addresses Steward cannot read are flagged rather than guessed at; open the person to fix those by hand."
    ]
   },
   {
    "h": "Update people who moved",
    "steps": [
     "On \"People who moved\", click \"Prepare or bring in a file\".",
     "Prepare an address update file and send it to a change-of-address provider you choose.",
     "When the provider sends results back, bring them in here and click \"Review moves\" to approve each new address."
    ]
   },
   {
    "h": "Fix emails",
    "steps": [
     "On \"Emails to look at\", click \"Review emails\". These bounce, are not valid, look like a typo, or are a shared office address on a person.",
     "A suggested fix is filled in where one is obvious. Nothing changes until you save it.",
     "A bounce mark stays until you confirm the new address is right with \"Yes, clear the bounce mark\"."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Possible duplicates: pairs that may be the same person, counted by high, medium and low confidence.",
     "Addresses to tidy: addresses that can be written the standard US way, plus any that cannot be read and are listed for you to fix by hand.",
     "People who moved: changes of address from the provider's file waiting for you.",
     "Emails to look at: emails that bounce, are not valid, look like a typo, or are a shared office address on a person.",
     "No way to reach: people with no email, no phone and no mailable address. Open a person to add one."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward does not merge, change an address or clear a bounce on its own. It does not run a change-of-address check for you: you send the prepared file to a provider of your choice and bring their results back."
    ]
   }
  ]
 },
 {
  "slug": "funds",
  "title": "Funds",
  "summary": "Funds shows each pot of money with a purpose: what is in it, what came in and went out, and whether it is restricted.",
  "screens": [
   "finance:funds"
  ],
  "route": "/app/finance?subtab=funds",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "A fund is a pot of money with a purpose, such as General Operating or a scholarship. Funds live in Finance, under the Funds tab, beside Budgets. Each fund has a card with its balance, what came in and went out this period, and whether it is Restricted or Unrestricted, with a sentence about the restriction. Fundraising also has a Funds part, under Money in, that shows each balance and an \"Open Finance → Funds\" button."
    ]
   },
   {
    "h": "Add a fund",
    "steps": [
     "Open Finance, then Funds.",
     "Click \"+ Add fund\".",
     "Type the \"Fund name\" and a \"Description\".",
     "Under \"Name donors see in a thank-you\", type the words a donor should read, or leave it blank to use the fund name.",
     "Tick \"Restricted fund (donor or grant restricted)\" if the money may only be spent for one purpose.",
     "Click \"Save\"."
    ]
   },
   {
    "h": "See what moved through a fund",
    "steps": [
     "Click a fund's card to open every gift and expense in it, with the net.",
     "Under \"Fund Accounting\", click \"View txns →\" on a fund to open its transactions, or \"Edit\" to change it."
    ]
   },
   {
    "h": "An example",
    "p": [
     "Margaret Chen gives $5,000 for the summer reading program. You add a fund named \"Summer Reading\", tick \"Restricted fund (donor or grant restricted)\", and under \"Name donors see in a thank-you\" type \"our summer reading program\". You pick that fund when you record her gift. Her thank-you names the program, and the Summer Reading card shows $5,000 in, marked Restricted."
    ]
   },
   {
    "h": "Remove a fund",
    "steps": [
     "Under \"Fund Accounting\", click \"More\" on the fund's row, then \"Remove\".",
     "If no gift is designated to it, it is deleted. If gifts are designated to it, it is retired instead: it is no longer offered for new gifts, and every past gift and report keeps it."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never moves money between funds and never holds or moves your money. Removing a fund never changes the gifts already designated to it."
    ]
   }
  ]
 },
 {
  "slug": "lost-and-found",
  "title": "Lost & Found",
  "summary": "Lost & Found is Steward's free donor audit: drop in the export your database already makes and see who is past their own usual time to give, with no account and without your file leaving your browser.",
  "screens": [
   "lostandfound"
  ],
  "route": "/lost-and-found",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Lost & Found is a free page on Steward's website, open to anyone, customer or not. You drop in a donor export and the whole audit runs in your browser tab. Your donor file never leaves your browser. Nothing is uploaded. Each donor is judged against their own rhythm, the usual gap between their gifts, so someone who gives every December is judged by December. Your results are free and complete with no email address."
    ]
   },
   {
    "h": "Run the audit",
    "steps": [
     "Open the Lost & Found page.",
     "Drag your file onto \"Drop your donor export here\", or click \"Run the free audit\" and pick it. A CSV or an Excel file with a donor, an amount and a date on each row is enough; nothing needs tidying first.",
     "Read the results: \"At risk\", \"Retention\" and \"On file\" at the top, then three groups: \"Call this week\", \"Call this month\" and \"Probably gone\".",
     "Click a group's \"See the names\" to see each donor, a year of their giving and one fact from your file about them.",
     "To audit a different file, click \"Audit another file\"."
    ]
   },
   {
    "h": "Get the board-ready PDF",
    "steps": [
     "Under \"The board-ready report\", fill in \"Your name\", \"Email\" and \"Organization\".",
     "Click \"Send me the PDF\". The PDF is built in your browser from the audit already on screen.",
     "Tick \"Add my anonymous totals to the nonprofit benchmark.\" only if you want to. It sends four numbers, never a name, an email or a single gift."
    ]
   },
   {
    "h": "An example",
    "p": [
     "Dana Reyes, the development director at a small food bank, exports the donor list as a CSV and drops it in. The audit shows 14 donors under \"Call this week\". Dana clicks \"See the names\" and finds Margaret Chen, who gave $250 every spring and has not given this spring. That is the first call."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "At risk: what every donor past their own usual time gave in their last year of giving, across all three groups.",
     "Retention: the share of last year's donors who gave again.",
     "Call this week: just past their usual gap between gifts.",
     "Call this month: further past it, or a recurring gift that stopped within the last year.",
     "Probably gone: past the lapse line, shown so you know, not as a call list."
    ]
   },
   {
    "h": "What Lost & Found doesn't do",
    "p": [
     "It looks backward once. It keeps nothing, and it does not put anyone into Steward. A donor with only one gift has no usual time to be past, so they are counted as not judged rather than guessed into a group. \"Start Steward with this file\" takes you to sign up; you bring the same file into Steward yourself."
    ]
   }
  ]
 },
 {
  "slug": "major-gifts",
  "title": "Major gifts",
  "summary": "Major gifts is where you keep every large ask in one place: who you are cultivating, what each ask is for, how much, and when you expect an answer.",
  "screens": [
   "fundraising:majorgifts"
  ],
  "route": "/app/fundraising?fr=majorgifts",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Major gifts is a tab in Fundraising. It has five parts: At a glance, Pipeline, Proposals, Portfolios and Plans. A proposal is one ask to one person: what it's for, how much, and when you expect an answer. Each proposal moves through six stages: Identified, Cultivating, Asked, Committed, Declined and Stewarding."
    ]
   },
   {
    "h": "Start a proposal",
    "steps": [
     "Open the person's record and go to the \"Asks & pipeline\" tab.",
     "Click \"+ New ask\".",
     "Fill in \"What is the ask for?\", \"Ask amount\", \"Expected close\" and the \"Stage\". Add \"Probability you'd put on it\" if you have one in mind, the \"Fund it lands in\" and the \"Officer who owns it\".",
     "Click \"Create proposal\"."
    ]
   },
   {
    "h": "Move a proposal along",
    "steps": [
     "Open Fundraising, then Major gifts, then Proposals.",
     "Click \"Move\" on the row, choose the new stage and click \"Save the move\".",
     "When you move it to Committed, Steward asks \"How did it come in?\". Choose \"As a pledge (they promised it)\" and Steward writes one pledge for the ask amount, or \"As a gift already on file\" to link a gift you have recorded.",
     "When you move it to Declined, choose a reason under \"Why?\". The reason stays on the record, even if you reopen it later."
    ]
   },
   {
    "h": "An example",
    "p": [
     "Margaret Chen has given $1,000 a year for six years. You add a proposal on her record: \"Lead gift for the new barn\", $25,000, expected close June 30, stage Cultivating, probability 50%. Her ask now counts in \"Open pipeline\", and $12,500 of it counts in \"Weighted\". In June she says yes and promises it over two years. You click \"Move\", choose Committed and \"As a pledge (they promised it)\", and the pledge closes itself when the money arrives."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Open pipeline: the ask amounts on every proposal still at Identified, Cultivating or Asked.",
     "Weighted: each open ask multiplied by the probability you set by hand. A proposal with no probability is left out.",
     "Due this quarter: open proposals whose expected close falls in this quarter.",
     "Asked this year: the ask amounts on proposals that reached Asked, Committed, Declined or Stewarding in this fiscal year.",
     "Committed this year: what people said yes to in this fiscal year."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never sets a probability for you, and never sends anything from this screen. A proposal is your record of the ask; the conversation stays yours."
    ]
   }
  ]
 },
 {
  "slug": "memberships",
  "title": "Memberships",
  "summary": "Memberships holds your membership levels, everyone who holds one, and who is coming up for renewal or has lapsed.",
  "screens": [
   "memberships"
  ],
  "route": "/app/fundraising?fr=members",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Memberships sits under Fundraising, in Campaigns & pages, and has its own entry in the sidebar under Raise. It shows your levels with their counts and every membership, sorted by when it expires. A membership payment is a gift, so it lands on the person's record with their other giving, and their receipt states the deductible part. Each person's own record also shows the membership they hold or held."
    ]
   },
   {
    "h": "Add a level",
    "steps": [
     "Click \"Add a level\". Setting a level's price, the value of its benefits and its term is for an admin.",
     "Give it a name, a price and a term: \"12 months\", \"Calendar year\", \"Monthly\" or \"Lifetime\", and whether it is \"Individual\" or \"Household\".",
     "Enter the value of the benefits members receive. This is your number: Steward never estimates it, and at $0 receipts call the whole payment deductible.",
     "Add a sentence or two for the card on your membership page, then click \"Save level\"."
    ]
   },
   {
    "h": "Put someone on a level",
    "steps": [
     "Open the person's record and find \"Membership\". If they are \"Not a member yet.\", click \"Add a membership\".",
     "Choose the level and answer \"How was it paid?\".",
     "Click \"Record membership\". To renew someone, click \"Renew\", then \"Record renewal\".",
     "\"Member card (PDF)\" makes a printable card for them."
    ]
   },
   {
    "h": "Share your membership page",
    "steps": [
     "Click \"Copy page link\" or \"Open page\". Your membership page lists every level that is for sale and not hidden, in the order shown here.",
     "\"Copy join link\" gives you the link to send someone who wants to join."
    ]
   },
   {
    "h": "Follow up on renewals and lapsed members",
    "steps": [
     "A renewal thread opens a set number of days before a membership expires, and an expired one stays in grace for a set number of days, then lapses. You choose both numbers on this screen.",
     "Steward drafts the renewal note; nothing is sent until a person sends it.",
     "Filter by \"Lapsed\" to see people whose most recent membership has lapsed and who hold none now."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Active, Grace and Lapsed members: each person counts once per membership. Active and in-grace members hold a current membership; lapsed ones have passed their grace period. Click a count to see the people.",
     "Years as a member: the membership terms they held.",
     "Still gives: a gift that was not a membership payment, so someone can be a lapsed member and a current donor at once.",
     "Their page: whether the member has opened their own page, which holds their card, their renewal and their receipts.",
     "\"Directory CSV\" downloads the member list for a spreadsheet."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward does not send renewal reminders on its own: it drafts them, and your team sends. Cancelling a membership stops it; it does not refund the payment, which is its own step on the gift."
    ]
   }
  ]
 },
 {
  "slug": "peer-to-peer",
  "title": "Peer-to-peer",
  "summary": "Peer-to-peer is where you run a walk, a ride or any campaign where supporters raise money on their own pages, alone or in teams.",
  "screens": [
   "p2p"
  ],
  "route": "/app/fundraising?fr=p2p",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Peer-to-peer sits under Fundraising, in Campaigns & pages, and has its own entry in the sidebar under Raise. A peer-to-peer campaign is a giving page with peer-to-peer turned on. Supporters sign up from the public page, make their own fundraiser page, and can start or join a team. This screen shows one campaign at a time: what it has raised, every team and fundraiser against their goal, and who has not raised anything yet, so someone can pick up the phone."
    ]
   },
   {
    "h": "Start a campaign",
    "steps": [
     "Click \"New peer-to-peer campaign\".",
     "Fill in the \"Name\", and if you want, a \"Goal ($)\" and \"Ends on\" date.",
     "Check the \"Public page address\". It comes from the name, and if it is taken, Steward adds a number.",
     "Tick \"New fundraiser pages need approval before they go public\" if you want to see each page first.",
     "Click \"Make the campaign\". An existing giving page that is \"Not peer-to-peer yet\" can be switched on with \"Turn it on\"."
    ]
   },
   {
    "h": "Add a team or a fundraiser yourself",
    "steps": [
     "Under Teams, click \"Add a team\", give it a name and a goal, and save.",
     "Under Fundraisers, click \"Add a fundraiser\", type \"Their name\", \"Their email\", a goal and a team if there is one, then click \"Add\".",
     "Steward finds the person by email, or adds them as a new person. Nobody is emailed. Use \"Copy their manage link\" to pass the link on yourself."
    ]
   },
   {
    "h": "Encourage the people who have not started",
    "steps": [
     "Look at the card that says how many fundraisers have not raised anything yet. It lists them by name.",
     "Open a fundraiser's options to see a suggested note, and click \"Open in my mail\" to write it from your own email.",
     "If you need approval on, new pages wait for you: click \"Approve\" on each. \"Take it down\" hides a page and \"Put it back\" restores it."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Raised: everything given through this campaign's page, added up from the gift rows themselves.",
     "Through people: what came in through fundraisers' own pages.",
     "Given directly: what was given to the campaign page without a fundraiser.",
     "Click \"Raised\" to see what it is made of: through teams, through fundraisers with no team, and given to the page directly. These three always add up to the total.",
     "A fundraiser's Raised: every gift given through that fundraiser's own page, added up to the cent.",
     "\"Fundraisers CSV\" downloads the list of fundraisers for a spreadsheet."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward does not email your fundraisers for you. Notes open in your own mail, and adding a fundraiser sends nothing. A fundraiser is matched to a person in your records by exact email only; one shown as \"no record matched\" has no soft credit recorded until their email matches someone on file."
    ]
   }
  ]
 },
 {
  "slug": "portal-editor",
  "title": "Portal editor",
  "summary": "The portal editor is where you arrange and style your donor portal, the page donors sign in to, while seeing it the way a donor will on a phone or a laptop.",
  "screens": [
   "portal:editor"
  ],
  "route": "/portal-editor",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "The portal editor shows your donor portal with sample donor data, never a real donor's, and lets you change it in place. It has two modes. \"Page\" arranges the widgets on the page. \"Design\" sets the look and the page details: Identity, Colors, Type & cards, Page details and Footer. Page changes are a draft that autosaves, and donors see nothing until you click \"Publish\". Design changes save on their own as you make them. Only an admin can open the editor."
    ]
   },
   {
    "h": "Open the editor",
    "steps": [
     "Open Donor Portal in the sidebar. It shows only for organizations on the donor portal plan; other organizations do not have this tab.",
     "Click \"Edit the portal\".",
     "Use \"Phone\" or \"Desktop\" to see the page the way a donor will."
    ]
   },
   {
    "h": "Arrange the page",
    "steps": [
     "If the page is empty, pick a layout under \"Start with a layout\".",
     "Click \"+ Add widget\" and choose one, such as \"Hero\", \"Give button\", \"My Giving\", \"Programs & funds\" or \"Impact feed\". It lands at the end of the page with its options open.",
     "Drag a widget to move it, or use its up and down arrows. The ✕ removes it.",
     "Click \"Publish\", then \"Publish\" again to confirm. Donors see it immediately.",
     "To throw away a draft, click \"Revert to published\", then \"Discard draft\"."
    ]
   },
   {
    "h": "An example",
    "p": [
     "You want donors to see where their money goes. In \"Page\" you add \"Programs & funds\" and picks the Summer Reading and Food Pantry funds, then move \"Impact feed\" up under the \"Hero\". In \"Design\" you set the Primary color to her organization's green. You check the page on \"Phone\", where the sample donor Sam Sample's giving shows in \"My Giving\", then click \"Publish\"."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "The editor never shows a real donor's information. It does not turn the portal on or off: that switch is on the Donor Portal tab. Nothing in the Page layout reaches donors until you publish."
    ]
   }
  ]
 },
 {
  "slug": "privacy-mode",
  "title": "Privacy",
  "summary": "Privacy lets an organization that serves clients keep their details out of Steward, and holds back health details found in anyone's email.",
  "screens": [
   "settings:privacy"
  ],
  "route": "/app/settings?section=privacy",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Some organizations serve people whose families are also donors, such as a therapy riding program. Privacy is for them. With the setting \"We serve clients whose details are private\" on, Steward will never bring in email, documents or notes about people you mark as clients, and it holds back health details it finds in anyone's email until you choose to keep them. With the setting off, nothing here runs."
    ]
   },
   {
    "h": "Turn privacy mode on",
    "steps": [
     "Open Settings, then Privacy. Only an admin can change this.",
     "Tick \"We serve clients whose details are private\".",
     "A line on the Connections card then says privacy mode is on, how many people are marked as clients and how many health details were held back this month."
    ]
   },
   {
    "h": "Mark people as clients",
    "steps": [
     "Click \"Mark people as clients\".",
     "Type names or emails, or pick a group and click \"Check this group\".",
     "Confirm the list. People already marked say so. \"Undo\" puts it back.",
     "You can also tick \"Client (never capture)\" on one person's record."
    ]
   },
   {
    "h": "See what was held back",
    "steps": [
     "Click the number of health details held back this month. Each one shows who and when, never what.",
     "A held sentence is replaced on the stored email with the line \"Mentioned a health matter. Open it in your mailbox.\""
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "People marked as clients: people who are never brought in from Gmail or Outlook, never logged from the BCC address, never a capture card and never a memo.",
     "Health details held back this month: sentences about a person's health that Steward replaced with one neutral line before storing the email."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward is not HIPAA compliant and has no business associate agreements, so do not rely on it for that. When your organization has Steward's AI turned off, it cannot check email for health details, so new email keeps only its date, who it was between and its subject."
    ]
   }
  ]
 },
 {
  "slug": "recurring-gifts",
  "title": "Recurring gifts",
  "summary": "Recurring is where every monthly and yearly gift lives: who gives, how much, what it supports, and which cards need rescue.",
  "screens": [
   "fundraising:recurring"
  ],
  "route": "/app/fundraising?fr=recurring",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Recurring sits under Fundraising, in Campaigns & pages. When a donor starts a recurring gift, or you propose one and they accept, it lands here. The cards that need you come first: past due, about to lapse and cards that just failed. Below them is every sustainer, with their amount, frequency, fund and next charge."
    ]
   },
   {
    "h": "Propose a recurring gift",
    "steps": [
     "Click \"Propose a recurring gift\".",
     "Search for the donor by name or email.",
     "Choose the amount and the frequency, \"Monthly\" or \"Yearly\", and a fund if you want one.",
     "Click \"Send to donor\". The proposal shows as pending until the donor completes it. Nothing is charged until they accept."
    ]
   },
   {
    "h": "Help a donor whose card failed",
    "steps": [
     "Find them under \"Needs recovery\" or filter the roster by \"Past due\".",
     "Click \"Propose card update…\" and then \"Send card-update link\". The donor updates their own card.",
     "If the email did not go, Steward says so; resend it from the roster or tell them yourself."
    ]
   },
   {
    "h": "Pause, change or cancel a gift",
    "steps": [
     "Open the row for the gift.",
     "Click \"Pause\" and, if you want, set an \"Auto-resume date (optional)\". A paused gift shows \"Resume\".",
     "\"Change fund designation…\" changes what it supports, straight away.",
     "To change the amount or frequency, click \"Propose a change…\". The donor confirms it themselves.",
     "\"Cancel subscription\" stops it. A donor asking to stop is always honored, even if your subscription has lapsed."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Monthly giving: every monthly gift charging successfully today, at what it brings in each month. A yearly gift counts as a twelfth of its amount.",
     "Change in monthly giving: monthly gifts started since the date shown, at what each adds a month, less those that ended in the same time.",
     "Cards updated automatically: monthly gifts still giving whose card the bank updated by itself since the date shown.",
     "Months on file: every monthly gift charging successfully today, with how many months it has been giving.",
     "Sustainer retention, 12 months: of the sustainers who started at least a year ago, how many are still giving a year in. It shows \"None yet\" until a subscription is a year old."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never changes an amount, a frequency or a card itself: anything that moves money is an invitation the donor completes. Whether a card is updated automatically depends on the card network and on your own Stripe account; a card that is not updated still goes to failed-card recovery. Recurring gifts here are the ones running through your Stripe account; sustainers from an imported file are shown separately as \"Sustainers from your file\"."
    ]
   }
  ]
 },
 {
  "slug": "search",
  "title": "Search",
  "summary": "The search box at the top of every screen finds any record in your organization: people, gifts, notes, meetings, campaigns, events, grants and more.",
  "screens": [
   "search"
  ],
  "route": "/dashboard",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "The search box sits in the top bar of every screen. Press ⌘K on a Mac, iPhone or iPad, or Ctrl K everywhere else, to jump to it from anywhere. On a phone, tap the magnifying glass at the top. It looks across everything your organization keeps: people (by name, email, phone or an organization's contact person), households, campaigns and appeals, events, giving pages, peer-to-peer pages, grants, auctions, membership levels, open tasks, saved reports and dashboards, past board reports, documents by file name, gifts, monthly plans, pledges, journeys, meetings, emails, notes and imports."
    ]
   },
   {
    "h": "Find a person",
    "steps": [
     "Press ⌘K or Ctrl K, or click the search box.",
     "Type part of a name, an email or a phone number. Two characters are enough to start.",
     "Pick the person from the list to open their record."
    ]
   },
   {
    "h": "Find a gift by amount or date",
    "steps": [
     "Type an amount, such as \"$500\", to see gifts, pledges and monthly plans of that amount.",
     "Type a day, such as \"Oct 3\", to see that day's gifts and meetings.",
     "Type a name and the word \"gift\", such as \"Rafael gift\", to see that person's gifts."
    ]
   },
   {
    "h": "See everything of one kind",
    "steps": [
     "Each group shows its first few results.",
     "Click \"See all\" on a group to see up to fifty of that kind."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Search only ever looks in your own organization. Deleted records do not show: a person who was deleted takes their gifts, plans, pledges, meetings, emails and notes out of search with them, and an archived journey is left out. A volunteer coordinator does not have search, because almost everything it finds carries giving. Searching never changes anything."
    ]
   }
  ]
 },
 {
  "slug": "set-up-steward",
  "title": "Set up Steward for me",
  "summary": "Set up Steward for me takes your donor files, your website and the tools you take gifts with, shows you a plan in plain sentences, and does the setup once you press Start.",
  "screens": [
   "setup"
  ],
  "route": "/setup",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "This is the quickest way to get going. You give Steward three things: your donor files, your website, and how you take gifts. Steward shows you a plan before anything happens. When you press Start, it imports and checks your files to the cent, fills in your profile and branding, sets up your funds, starter groups, thank-you drafts in your words and journeys (paused), and prepares invitations for your team. At the end it tells you who to call tomorrow. You can also choose \"Set it up yourself\" and do each step by hand."
    ]
   },
   {
    "h": "Start setup",
    "steps": [
     "Under \"Your donor files\", add your files. Any number, in any format the import reads: CSV or Excel, a Salesforce Contacts and Donations pair, DonorPerfect, Bloomerang, Neon, or a spreadsheet you kept.",
     "Under \"Your website\", give your address. Steward reads a few public pages for your mission, logo, colors, address, EIN and team. Anything it is not sure of becomes a question.",
     "Under \"How you take gifts\", tick the tools you use, such as Stripe, PayPal, Zeffy, Givebutter, Square or checks.",
     "Click \"Read my files and show me the plan\"."
    ]
   },
   {
    "h": "Read the plan and press Start",
    "steps": [
     "Under \"Here is the plan\", read what Steward will do. Nothing has happened yet.",
     "Answer any questions it asks. \"Change what I gave\" takes you back to the files.",
     "Click \"Start\".",
     "You can close the tab. Setup keeps going, and the page picks up where it is when you come back. If it stops, click \"Carry on from where it stopped\"."
    ]
   },
   {
    "h": "When Steward is ready",
    "steps": [
     "Read \"What Steward did\" and \"Waiting on you\".",
     "Invitations for your team are \"Prepared for your click\": each one waits until you press \"Send\". Connections wait for you to press \"Connect\".",
     "Click \"Go to my home screen\"."
    ]
   },
   {
    "h": "Undo everything",
    "steps": [
     "On the finished page, click \"Undo all of setup\".",
     "This removes every person, gift, fund, template and journey setup made. Click \"Yes, undo all of it\" to confirm."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Setup never emails anyone: team invitations wait for you to send them, and journeys are set up paused, so nothing reaches a donor until you turn it on. It does not connect your payment tools for you; signing in to each one is yours to do from Connections. Possible duplicates found on the way are left for you to review, now or later, from Data health."
    ]
   }
  ]
 },
 {
  "slug": "started-not-finished",
  "title": "Started, not finished",
  "summary": "Started, not finished lists the gifts someone began on one of your own giving forms, with an email given, and did not complete, so you can write to them once if you choose.",
  "screens": [
   "fundraising:unfinished"
  ],
  "route": "/app/fundraising?fr=unfinished",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Started, not finished sits under Fundraising, in Money in. When someone chooses an amount on one of Steward's own giving forms, gives their email and then does not pay, the gift appears here. It counts once an hour has passed or the payment page closed. When a gift from that email comes in, the row leaves the list on its own and moves under \"Finished later\", with a link to the gift. When there are new ones, Home shows one line, such as \"3 gifts were started on your giving forms and not finished, $150 in all.\", with \"See who\"."
    ]
   },
   {
    "h": "Write to someone",
    "steps": [
     "Open Fundraising, then Money in, then \"Started, not finished\".",
     "Read the row: the person, the amount, the form and the day it was started.",
     "Click \"Draft a note\". Steward drafts a short note in your organization's voice. Change any word in the Subject and Message.",
     "Click \"Send\", or \"Copy\" it to send from your own email. Only an admin can send from here.",
     "If you would rather leave it, click \"Set aside\"."
    ]
   },
   {
    "h": "An example",
    "p": [
     "On Tuesday, Margaret Chen chose $50 a month on your donation form and closed the page before paying. On Wednesday her row reads \"$50 a month\", with the form's name and the day she started. You click \"Draft a note\", soften the second sentence and click \"Send\". Because she is already in Steward, the email is logged on her record. If she gives on Friday, her row moves to \"Finished later\"."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Started and not finished this month: the total of gifts started this month on your own forms, with an email given, and not finished, at the amount each person chose. Click it to see the gifts behind it."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Nothing is sent until a person presses Send. Steward sends at most one note per person per form, and none to someone who has given since. Only Steward's own giving forms are counted: a gift started on a connected platform, such as PayPal or Givebutter, is not seen here."
    ]
   }
  ]
 },
 {
  "slug": "tell-steward",
  "title": "Tell Steward",
  "summary": "Tell Steward turns a few spoken or typed sentences about a meeting or a call into the paperwork: the conversation logged, the follow-up on your list, and anything sensitive held for your yes.",
  "screens": [
   "tell"
  ],
  "route": "/dashboard",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "After lunch with a donor or a phone call, you can tell Steward what happened instead of filling in forms. Open it with the \"Tell Steward\" button on Home, \"Tell Steward about\" a person on their record, from the sidebar, or from More on a phone. Steward logs the conversation on each person it names, puts the follow-up on your list with its date and notes their interests. Those are listed under \"Done for you\", with one Undo. Anything that matters more waits under \"Waiting for your yes\": a drafted email, every amount, a contact change and any personal detail."
    ]
   },
   {
    "h": "Tell Steward what happened",
    "steps": [
     "Click \"Tell Steward\".",
     "On a phone, hold to talk, or tap and talk; release, or tap \"Stop\", when you are done. On a laptop, type what happened, or use your keyboard's microphone.",
     "Read \"What Steward heard\" and change anything before you send.",
     "Click \"Send to Steward\"."
    ]
   },
   {
    "h": "Check what Steward did",
    "steps": [
     "Under \"Done for you\", read each line. \"Undo this memo\" takes all of it back.",
     "If Steward heard a name it could not place, \"Find the person\" or \"Pick the person\" lets you choose who it was, or add them as someone new.",
     "Under \"Waiting for your yes\", look at each card. A drafted email opens with \"Open the draft\"; it is never sent from here. An amount, a contact change or a personal detail is only saved when you say yes."
    ]
   },
   {
    "h": "When Steward could not file it",
    "steps": [
     "If Steward did not understand the memo, it says so and files nothing.",
     "Click \"Save as a note\" and only the words you sent go on the person's record, as a note."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never keeps a recording, only the words you send. Nothing is sent to anyone: a drafted email waits in your drafts for you to read and send. Amounts are never recorded until you confirm them. When your organization has Steward's AI turned off, the memo is saved as a note on the person you pick, and nothing else is read from it."
    ]
   }
  ]
 },
 {
  "slug": "to-confirm",
  "title": "To confirm",
  "summary": "To confirm is one place for every gift that arrived on paper or as a document, waiting as a card until a person confirms it.",
  "screens": [
   "fundraising:toconfirm"
  ],
  "route": "/app/fundraising?fr=toconfirm",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "To confirm sits under Fundraising, in Money in. A photographed check, a scanned batch, a pledge form or a fund's grant letter each becomes a card here. Steward reads the image and fills in what it can: who it is from, the amount, the date and the fund. Money never lands on its own; it waits for you to check the card and confirm it. Small changes, like an updated address or a document filed on a profile, are done right away and listed under \"Done for you\", each with Undo for 30 days. The Fundraising entry in the sidebar shows how many cards are waiting."
    ]
   },
   {
    "h": "Snap or drop in checks",
    "steps": [
     "On a phone, tap \"Snap a check\" and take the photo. Tap \"Snap another check\" for the next one.",
     "On a laptop, drag check images or a scanned PDF onto the drop area, or browse for the files.",
     "Each check becomes a card in \"Waiting\"."
    ]
   },
   {
    "h": "Confirm a card",
    "steps": [
     "Look at the image beside the form. \"Open the full image\" shows it larger.",
     "Check who it is from. If more than one person in Steward could be this, pick one. If nobody matches, \"It's someone new\" adds them when you confirm.",
     "Check the amount, the date and the fund. If the amount is blank, fill it in from the image.",
     "Click the button, which names what you are logging, for example \"Log $250 check\". The gift is recorded and a thank-you draft is prepared for you to read and send from your thank-you list. Nothing is sent."
    ]
   },
   {
    "h": "Skip a card, or bring one back",
    "steps": [
     "If a card is not a gift, click \"Skip it\" and choose a reason: \"It isn't a gift\", \"It's a duplicate\", \"Already entered by hand\" or \"Something else\".",
     "Skipped cards stay under \"Skipped\" for 30 days. Open \"Skipped\" to bring one back."
    ]
   },
   {
    "h": "What the numbers mean",
    "p": [
     "Waiting: cards that have not been confirmed or skipped yet.",
     "Skipped: cards a person skipped in the last 30 days."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Steward never logs money from a card by itself, and never sends a thank-you from here: the draft waits on your thank-you list. If a card is an employer's matching gift and Steward cannot find the original gift it matches, it cannot be logged yet; log the original gift first, or skip it. When a donor-advised fund's letter names an advisor who is not in Steward yet, no soft credit is added until you add them."
    ]
   }
  ]
 },
 {
  "slug": "welcome",
  "title": "Welcome, step by step",
  "summary": "The Welcome screen sets Steward up one step at a time: your organization, your donors, where gifts come in, how you look after a new donor, a first goal and a first impact metric.",
  "screens": [
   "welcome"
  ],
  "route": "/welcome",
  "sections": [
   {
    "h": "What this screen is for",
    "p": [
     "Welcome is the step-by-step way to set up Steward, a few minutes a step. It opens with \"Welcome to Steward.\" and two ways in: \"Import your file\", to set up with your own donors, or \"Explore the demo\", which loads sample donors, gifts and conversations into your own workspace so every screen has something on it. You can clear the sample whenever you like from Settings. If you started at \"Set up Steward for me\", the \"Set it up yourself\" link there brings you here."
    ]
   },
   {
    "h": "Set up step by step",
    "steps": [
     "Click \"Set up my organization →\".",
     "Under \"Tell us about your organization\", fill in \"Organization name\", \"Mission or tagline\" and \"Time zone\", then click \"Continue →\". Every date in Steward is read in that time zone.",
     "If your plan includes a team, \"Invite your team\" comes next. Add their emails and click \"Send invites →\", or \"I'll invite them later from Settings › Team\".",
     "Under \"Import your donors\", click \"Import a CSV or Excel file →\". Steward shows you what it found before it writes anything. \"I don't have a list ready yet, I'll do this later\" skips it.",
     "Under \"Where do gifts come in today?\", connect what you use, or click \"I'll do this later\".",
     "Under \"How do you look after a new donor?\", pick the closest one and click \"Use this one →\".",
     "Under \"Set your first goal\" and \"Define your first impact metric\", fill in the fields and click \"Continue →\".",
     "On \"You're ready.\", click \"Go to my home screen →\"."
    ]
   },
   {
    "h": "An example",
    "p": [
     "Dana Reyes runs a youth choir. Dana types \"Riverside Youth Choir\" and the choir's mission, imports last year's spreadsheet of 312 donors, connects nothing yet, and picks a journey. For the first goal she types \"Raise $25,000 this quarter\", with \"Total raised\" and a target of 25000. The first impact metric starts from Steward's template, \"Your ${amount} gift helps power Riverside Youth Choir's work in the community.\", and she keeps it."
    ]
   },
   {
    "h": "What Steward doesn't do here",
    "p": [
     "Nothing here sends to a donor. A journey's steps become reminders on your Thread on the day each is due. The team, donor file, gift sources and journey steps can each be left for later, and choosing the demo does not lock anything."
    ]
   }
  ]
 }
];
export default HELP_DOCS;

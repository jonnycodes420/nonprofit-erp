# ASK-4 · the score (6 October 2026)

Harborlight on the local scratch stack, AI on (claude-opus-5 through a counting proxy). Truth is SQL written
by hand in `docs/ask-4/eval.cjs`, sharing nothing with `askQuery.js` or `askEngine.js`. "Before" is main at
3676b0b on a copy of the same database.

| | Right | Wrong | Refused |
|---|---|---|---|
| 52 questions, before (main) | 11 | 12 | 29 |
| 52 questions, after | 52 | 0 | 0 |
| 15 held out, after (run once) | 14 | 1 | 0 |

Every answered sentence passes the plain-sentence check. The 52 were tuned against: the first run of this
branch scored 42 right, and its misses (old why questions taking questions with extra conditions, the ASK-2
model answering a neighbouring metric, a sort key, a calendar-ordered breakdown) were fixed before the second.
The 15 held-out questions were written after that and run once. Their one miss (#111, average gift in
Marblehead) is an ASK-2 template convention: no period named means this year so far, and the answer says so.

Model cost for the whole build, every run and probe: $4.19 in 214 calls (cap $9.35, never reached).

## The 52, after

| # | Question | Verdict | Answered by |
|---|---|---|---|
| 1 | How much came in by check this year? | right | query |
| 2 | How many gifts were made by card in September 2026? | right | query |
| 3 | What was the largest gift of stock we've ever received? | right | query |
| 4 | What's the average ACH gift? | right | query |
| 5 | How much did we raise for Youth Arts Access this year? | right | template |
| 6 | Which fund raised the most in 2025? | right | template |
| 7 | How many gifts from the last 30 days haven't been thanked? | right | query |
| 8 | How much did donors in Salem give this year? | right | template |
| 9 | How many DAF gifts did we get last year? | right | query |
| 10 | What's the total of gifts over $10,000 this year? | right | query |
| 11 | How many gifts were given in tribute? | right | query |
| 12 | Which month this year had the most gifts? | right | query |
| 13 | How many people gave by check this year? | right | query |
| 14 | How many people live in Marblehead? | right | query |
| 15 | How many donors have given more than $10,000 in their lifetime? | right | query |
| 16 | How many people have no email address on file? | right | query |
| 17 | How many people are marked do not contact? | right | query |
| 18 | What is the highest lifetime giving of any one donor? | right | query |
| 19 | How many people made their first gift in 2026? | right | query |
| 20 | How many donors in Beverly gave this year? | right | template |
| 21 | How many donors have made more than five gifts? | right | query |
| 22 | How many calls were logged this year? | right | query |
| 23 | How many meetings have we logged in total? | right | query |
| 24 | What kind of conversation do we log most often? | right | query |
| 25 | How many people have at least one conversation logged? | right | query |
| 26 | How many guests are on the Scholarship Supper list? | right | query |
| 27 | Which event has the most guests? | right | query |
| 28 | How many VIP guests are there across all our events? | right | query |
| 29 | How many people came to the Harbor Lights Gala and also gave this year? | right | query |
| 30 | What's the total fundraising goal across our events? | right | query |
| 31 | How many volunteer hours have been logged in total? | right | query |
| 32 | How many volunteer hours were logged this year? | right | query |
| 33 | Who has volunteered the most hours? | right | query |
| 34 | How many people have volunteered? | right | query |
| 35 | How many volunteers also gave a gift this year? | right | query |
| 36 | How many recurring gifts are active? | right | query |
| 37 | What do our active recurring gifts add up to each time they're charged? | right | query |
| 38 | How many recurring gifts are past due? | right | query |
| 39 | How many campaigns have a goal over $50,000? | right | query |
| 40 | What's the combined goal of all our campaigns? | right | query |
| 41 | How many open next steps are overdue? | right | query |
| 42 | How many open next steps does Dana own? | right | query |
| 43 | How many tasks are still not done? | right | query |
| 44 | How many open asks are there? | right | query |
| 45 | What's the total amount of our open asks? | right | query |
| 46 | How many grants have we been awarded? | right | query |
| 47 | How many memberships are active? | right | query |
| 48 | How many people in Danvers have given over $1,000 lifetime but never had a conversation logged? | right | query |
| 49 | How many people gave to Spring Appeal 2026 and came to the Harbor Lights Gala? | right | query |
| 50 | How many people have a recurring gift and also volunteer? | right | query |
| 51 | What's the weather going to be like for the Harbor Run? | right | answer |
| 52 | Which of our donors have the best credit scores? | right | list |

## Held out

| # | Question | Verdict | Truth | Answer |
|---|---|---|---|---|
| 101 | How much was given by cash last year? | right | 8522.00 | 8522 |
| 102 | How many emails were logged in the last 60 days? | right | 18 | 18 |
| 103 | How many people in Peabody have given more than $2,500 in their lifetime? | right | 35 | 35 |
| 104 | What's the smallest gift we received this year? | right | 10.00 | 10 |
| 105 | How many gifts to the General Operating fund were made in 2025? | right | 5 | 5 |
| 106 | How many guests are on the Harbor Run list? | right | 7 | 7 |
| 107 | Which payment method brought in the most money this year? | right | Card | card |
| 108 | How many people have never given a gift? | right | 100 | 100 |
| 109 | How many volunteer shifts were logged in 2025? | right | 0 | 0 |
| 110 | How many donors in Manchester gave by card this year? | right | 78 | 78 |
| 111 | What's the average gift from donors in Marblehead? | wrong | 1522.46 | 1202.55 |
| 112 | How many people gave both last year and this year? | right | 525 | 525 |
| 113 | How many people have had a meeting logged and given over $5,000 in their lifetime? | right | 9 | 9 |
| 114 | Which city do most of our donors live in? | right | Marblehead | marblehead |
| 115 | How many of our donors' horoscopes are Scorpio? | right |  |  |

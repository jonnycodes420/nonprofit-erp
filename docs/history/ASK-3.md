## ASK-3 · Why and What: guided questions, then a conversation (2026-10-05)

Jonathan asked Home "what can I do to get Flavia to give more" after the Spring Appeal answer and got a
sentence cut off mid-word about "these facts", over a Room to give list of 266 other people. Three causes:
"give more" matched the org-wide Room to give question before any name was read; the model's sentence
passed the number check (266 and 22 were real numbers) with internal words in it; and the sentence call ran
claude-opus-5 with its default thinking inside a 200-token budget, so the reply came back empty or cut off.

The Ask row on Home and the profile became two buttons, Why and What, each opening a rail of questions the
org's own records can answer (`shared/askGuide.js`, approved as a mockup first, `docs/ask-3/mockup/`). Every
answer offers two to four follow-ups of its own; the free box lives only in the rail, after an answer, with
AI on. A name is read against the thread first, then the org: one match answers, several ask which, none
says so. One person is a ninth answer in why.js (`person`: ask, next, changed), built from that person's
rows so every number opens them. A model sentence must be complete and plain (`sentenceIsPlain`) as well as
number-checked; the sentence call runs without thinking. Behind goal, an event's result and monthly giving
have no why yet and are refused by name and logged.

Score (`docs/ask-3/score.md`): the 25 person questions went from 3 right to 25 right with AI on (0 wrong
numbers, 0 broken sentences), 25 with AI off; the ASK-2 60 with AI on for the first time, 57 right, 2
refused correctly, 1 unverified. Model cost $0.64 behind a $10 counting proxy. Tests:
`ask3-person-thread` (the thread decides who "Flavia" is; every figure opens only her rows) and
`ask3-sentence-check` (a cut-off, internal-word or invented-number sentence shows the template), each proven
able to fail. `ask2-refuse` §2 changed on purpose: a restatement left broken by cutting its numbers out is
no longer shown.

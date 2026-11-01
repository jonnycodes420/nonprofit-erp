## VOICE-1 · Tell Steward: talk for 30 seconds, and the paperwork is done (2026-10-18)

A Tell Steward button on Home, on every donor profile, in the rail and first in the phone's menu opens one sheet.
On a phone with the browser's own speech recognition it listens (hold to talk, or tap and tap again) and shows the
words as they come; otherwise, and on a laptop, it is a text box and the phone keyboard's microphone does the
listening. No audio is recorded or stored and no paid speech service is used; the only paid call is one short
Anthropic read per memo (`shared/voiceMemo.js MEMO_TOOL`).

The memo is an Agent instruction with the new Notes persona (`shared/agentPersonas.js NOTES`, added at the end of
the file beside ONBOARD-1's Setup), compiled and validated like any plan and run by `agentRunPlan`, so every write
is on `agent_writes` and the memo's one Undo loops over its runs (`routes/voice.js`, `voice_memos`). The model says
what it heard; code decides what it may become: dates from her words (`dueFromMemo`, "in March" is 1 March, the next
one), amounts only when they are in her quote, funds by whole words, people by `agentNamedIn` (one match acts,
several ask which with last gift and last contact, a heard name nobody has is offered as a new person), and a
sensitive sentence (health, family crisis, money trouble, a child) is screened in code as well as by the model and
held back from the conversation, the steps, the draft and the memo as kept until she saves it in neutral words.
Money is a card whose yes is her own click on `recordGift`, the pledge route or the proposal route. With AI off the
memo is a note on the person she picks. Logging a conversation still asks for the wealth score's two sentences, as
any logged touch does; that call is not the memo's.

Gotchas: `agentRunPlan`'s ungrounded-claims check withheld her own words ("in two weeks"), so an instruction may
carry `grounded` text; the `log_conversation` executor now carries `how` and the memo link in `metadata`. A planted
"AI-off branch calls the model" stayed green because `anthropicFor` already refuses with AI off; the real plant is
the note path filing a whole conversation. The seed changed (`scripts/seed/voice1-memos.js`): three memos a week in.

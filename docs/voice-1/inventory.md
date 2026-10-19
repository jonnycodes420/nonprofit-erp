# VOICE-1 inventory: what a memo drives, and what it reuses

Written before building, 18 Oct 2026.

## What already exists that a memo should drive

| What the memo needs | What exists | Reused how |
|---|---|---|
| Log a conversation (lunch, call, visit) | `POST /donors/:id/interactions` (routes/crm.js), and the Agent's `log_conversation` executor (routes/agent.js), which calls that route as the person and writes the undo row | Reused. The executor only knew call / meeting / email; it now also carries `how` (lunch, visit, coffee) and the memo link in `metadata`, so a lunch is a meeting whose line says "Lunch". |
| A follow-up step on the Thread with a date | The Agent's `set_next_step` executor (`POST /donors/:id/threads` or `PUT /threads/:id`, one open thread per person) and `create_task` | Reused. The first follow-up is the Thread's next step; any further ones are tasks with due dates. |
| A date from her words ("circle back in March") | `shared/meetingNote.js dueFromText` (in a month, next week, tomorrow) | Reused, and extended in `shared/voiceMemo.js` with month names (in March = 1 March, mid March = the 15th, late March = the 25th, the next one after today) and weekdays. The date is computed in code, never taken from the model. |
| Interests ("the new arena") | Tags on the person (`add_tag` executor), funds (`fin_funds`) and campaigns (`campaigns`) | A phrase that matches a fund or campaign name by whole words becomes the tag `Interest: <Fund>`; otherwise a logged note (`log_note`). |
| A drafted email | The Agent's `draft_note` executor: an `agent_drafts` row, on the person's Thread and timeline, waiting for review | Reused unchanged. Nothing is sent: there is no send step in the Notes persona at all. |
| A pledge, a gift, an ask amount | `recordGift` (the one gift path), `POST /donors/:id/pledges`, `POST /donors/:id/proposals`; AGENT-2's prepared-gift confirm; FIX-12's meeting-note chips (`shared/meetingNote.js parseAmount`, every chip quotes the note) | A money card per amount. Nothing is written until she presses yes, and the yes calls the same route a person's click calls, as her. The amount must be in her own words (the same AMOUNT reader the meeting-note chips use). |
| A change to contact details | `PATCH /donors/:id/contact` through the Agent's `update_contact` executor | A card; the yes runs the executor, so it is on the undo ledger. |
| Undo | `agent_writes` (every executor writes one), `agentUndoWrite`, `POST /agent/writes/:id/undo` | One Undo on the memo undoes every `agent_writes` row of the memo's run, newest first, with the same restore. |
| The Agent's plan pipeline | `agent_instructions` + `compilePlan` + `validatePlan` + `dropOutOfScope` + `agentRunPlan` (routes/agent.js), the persona registry `shared/agentPersonas.js` | A memo is an instruction with persona `notes`, compiled and validated like any plan, and run by `agentRunPlan`. The run, the ai_log row and every write show in Agent activity like any other. |
| The audit write | `middleware/auditTrail.js` above every router; the Agent's in-process calls carry the signed `x-steward-agent` header | Unchanged. The memo routes are new routes, logged by default. |

## How a person is matched today

`agentNamedIn` (routes/agent.js) over `shared/agentShape.js namedIn`: whole tokens, a whole name or a
first name (an ordinary-word first name only when capitalised). One record per name acts; a name that
matches several records is `ambiguous` and `agentWhich` returns each one with email, last gift and
volunteer role, before anything is planned. Reused as it is. The memo adds:

- on a profile, that person is the memo's person unless the memo names somebody else;
- a name the model heard that matches nobody on file is offered as "Add <name> as a new person" (through `POST /donors`), and the memo waits until she adds them, picks somebody, or leaves them out;
- the pick list shows last gift and last contact.

## The old voice memo

There is a Whisper voice memo already (`POST /voice-memos/transcribe` and `/save` in routes/crm.js,
`VoiceMemoModal` in shared.jsx). It needs an OpenAI key, is shelved (its buttons are commented out),
and sends the audio to a paid service. VOICE-1 does not use it and does not delete it.

## Speech in the phone browsers we support

| Browser | Built-in speech recognition | What Tell Steward does |
|---|---|---|
| iOS Safari 14.5+ | `webkitSpeechRecognition` exists. It works only when Siri / Dictation is on in Settings, and Apple's servers do the recognition. Results are reliable for short memos; `continuous` stops after a pause, so the screen restarts it until she presses stop. | Speech on, live transcript. If it errors (`not-allowed`, `service-not-allowed`), the screen falls back to the text box. |
| Android Chrome | `webkitSpeechRecognition` exists and works (Google's speech service, free, no key). | Speech on, live transcript. |
| Firefox (any), in-app browsers (Instagram, Gmail's) | Not available. | The text box with "Use your keyboard's microphone": the iOS and Android keyboards both have a dictation key, which is free and on the device. |
| Laptop browsers | Chrome and Safari have it, but per the brief a laptop gets the text box ("Tell Steward what happened"). | Text box. |

No audio is recorded or uploaded by Steward in any of these: the browser hands the page text, and only
the text she sends is kept. The browser's own speech service is the browser vendor's, not a Steward
vendor, and costs nothing.

## AGENT-2 · An Agent that does the work (2026-10-03)

BUILD-97 promised an Agent that does the work; its tools were find, count, tag, note, draft, task, thread
and stage, so "ada just became a volunteer and wants to do 15 hours a week" ended as a note, a tag, a
"confirm which Ada" task and a draft. Measured first: 30 instructions a director would type, run on a
fixture org (`scripts/agent2/`) and scored from a row-level diff of the whole org, never from the plan's
own word. Before: 5 of 30 fully done, 1 partly, 24 notes, tags, tasks or nothing (`audit/agent2-before.json`).
Fifteen real actions were added, each calling the screen's own route as the confirming person
(`agentCall.js`), checked after it runs, audited with the Agent as actor, and undoable for 30 days.
After: 28 of 30 fully done (`audit/agent2-after1.json`; the harness scored 25, and three of its own checks
were wrong about updated threads and an abandoned plan, see the report), 1 said honestly it was a question
for Reports, 1 ("make Lena Ortiz the owner of the Sunrise Foundation") planned nothing. The re-run after
the harness fix could not happen: the Anthropic account ran out of credit (NEEDS-JONATHAN).

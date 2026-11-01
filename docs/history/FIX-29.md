## FIX-29 · The Agent's find-people tool was rejected by the API (2026-10-06)

Prod alert 10:10 PM: `filter_spec` (shared/showMe.js) sent 27 `["string","null"]` fields as a strict tool; the API
allows 16 union params and 24 optional ones per strict schema. It was 18 the day PARITY-4 wrote it, so the model
path of Show me and of the Agent's find never once worked in prod: both catches fell back to the templates without
a log. FIX-27 took it to 24, ASK-2 25, AI-FIX 27 (and made the Agent call it on every instruction the templates
could not fully read, which is when it surfaced), WIRE-1 36. Now one `filters: [{ field, value }]` array with
`field` an enum of SHOW_KEYS: 0 unions, 0 optional, every filter kept. Making the 36 fields optional instead was
probed and refused (optional limit 24). The Agent now answers `plan_failed` with one sentence and logs the error
when a model call fails, and Show me logs its fallback. Other tools counted: Agent plan 11, cheque read 6, brief and
grant outline 0 (strict); ask_plan is 71 but not strict, which the API accepts (probed).
The AI-on eval on a local Harborlight also caught the Agent's who-extraction leaving "note to every grant funder"
from "a thank-you note to…": no filter read it and the plan was made from everybody (wrong people). The lead now
takes a second noun. Still open: 42 drafted thank-yous truncate the Agent plan at 8,000 tokens (every strict step
carries ~35 required fields), and the Ask box reads "going quiet" as the lapse question but not "gone quiet".

# ASK-3 · the score (5 October 2026)

Harborlight on the local scratch stack (`steward_ask3`, seeded by `scripts/seed-demo.js`), today 2026-10-05
America/New_York. Each question was asked the way the rail asks it: in a thread, carrying the last answer's
people, person and appeal (`docs/ask-3/eval.cjs`, which mirrors `AskRail.jsx threadContext`). Truth is SQL
written separately from the Ask code (`truthFor` in eval.cjs): every number a true sentence about that person
could say. "Before" is `origin/main` (8f4a0df) on a copy of the same database, AI on.

## The 25 person-scoped questions

| | Right | Refused | Wrong | Broken |
|---|---|---|---|---|
| Before (main, AI on) | 3 | 20 | 1 | 1 |
| After (AI on) | **25** | 0 | 0 | 0 |
| After (AI off) | 25 | 0 | 0 | 0 |

Zero wrong numbers and zero broken sentences after. Before, #1 answered Flavia's question with Room to give
for other people, and #22 showed the model sentence Jonathan saw, cut off and talking about "facts": "The
facts here cover 283 donors, with 31 showing strong room to give and 252 showing some room, but they include
no information about".

Honest caveats. The first AI-off run of these 25 scored 22 right, 1 wrong, 2 refused; two defects it found
were fixed before the AI-on runs (a name two answers back, "what about Leopold?", is now read against the
whole thread, and a typed full name that matches nobody says so instead of listing other Bartholomews). The
first AI-on scoring showed 3 wrong on "17 volunteer hours"; 17 is true (14 shifts, SQL), and the truth
function was missing volunteer hours and events, so it was widened and both runs rescored with no new calls.

| # | Question | Expected | Before (main, AI on) | After (AI on) | After (AI off) |
|---|---|---|---|---|---|
| 1 | what can I do to get Flavia to give more | d_b72_44 · ask | wrong (about Henrietta Blackmoor, Beatrix Nettlefold) | right (ai) | right |
| 2 | and Margaret? | d_b72_12 · ask | refused (answer) | right (ai) | right |
| 3 | what's the next step with her? | d_b72_12 · next | refused (answer) | right (ai) | right |
| 4 | why did her giving change? | d_b72_12 · changed | refused (answer) | right (template) | right |
| 5 | what should I ask Zebulon Quatermaine for? | none | refused | right (no sentence) | right |
| 6 | what should I ask them for? | list d_b72_38,d_b72_39,d_b72_40,d_b72_52,d_b72_53 | refused | right (template) | right |
| 7 | why did Nerissa stop giving? | d_b72_38 · stopped | refused | right (ai) | right |
| 8 | what about Leopold? | d_b72_39 · stopped | refused (answer) | right (ai) | right |
| 9 | what should I ask him for? | d_b72_39 · ask | refused (answer) | right (ai) | right |
| 10 | the top five | list d_b72_38,d_b72_39,d_b72_40,d_b72_52,d_b72_53 | refused | right (template) | right |
| 11 | what should I ask Persis for? | d_b72_41 · ask | refused (answer) | right (ai) | right |
| 12 | why did Alaric Applewhite stop giving? | d_b72_32 · stopped | right | right (ai) | right |
| 13 | what should I ask him for? | d_b72_32 · ask | refused (answer) | right (ai) | right |
| 14 | what's the next step with him? | d_b72_32 · next | refused (answer) | right (ai) | right |
| 15 | what has he given to? | given d_b72_32 | refused | right (no sentence) | right |
| 16 | why did Ondine Cinderhalt stop giving? | d_b72_1076 · stopped | right | right (ai) | right |
| 17 | and what should I ask her for? | d_b72_1076 · ask | refused (answer) | right (ai) | right |
| 18 | what should I ask Persis for? | choose | refused (answer) | right (no sentence) | right |
| 19 | what should I ask Flavia for? | choose | refused (answer) | right (no sentence) | right |
| 20 | how has Margaret Chen's giving changed? | d_b72_12 · changed | refused (answer) | right (ai) | right |
| 21 | what's the next step with Flavia Pentreath? | d_b72_44 · next | refused (answer) | right (ai) | right |
| 22 | what can I do to get Margaret Chen to give more? | d_b72_12 · ask | broken (sentence fails the plain-sentence check) | right (ai) | right |
| 23 | why did Bartholomew Nobody stop giving? | none | refused | right (no sentence) | right |
| 24 | what should I ask her for? | refuse | right | right (no sentence) | right |
| 25 | what should I ask Alaric for? | d_b72_32 · ask | refused (answer) | right (ai) | right |

## The ASK-2 60, with AI on (first time)

57 right, 2 refused correctly (#59 donor age, #60 the weather), 1 unverified. ASK-2 scored them with AI off
only. #47 ("Which major donors haven't been asked…") reads the same filter as ASK-2's right answer (major,
no ask this year, not deceased; a template reading, not the model) and counts 24 today against ASK-2's hand
count of 25 on a different day's seed; it is not independently re-checked, so it is not counted right.
`docs/ask-2/truth.cjs` hard-codes 2026-10-04 as today; it was run with 2026-10-05 for this (first pass
before that change: 46 right, all twelve misses a day of gifts). Rows: `ask2-60-ai-on-score.json`.

## What the model cost

79 calls to claude-opus-5 through a counting proxy with a hard $10 stop (never reached): 84,619 input and
8,869 output tokens, **$0.64**. That covers both 25-question runs, the ASK-2 60, and four diagnostic calls.

## The defect the AI-on run found

The sentence call (`writeSentence`) asked claude-opus-5 for one sentence in 200 tokens with the model's
default thinking on. The thinking used the whole budget: the reply came back empty (template shown) or, with
a shorter thought, cut off mid-sentence. That is the shape of the broken sentence on Home. The call now turns
thinking off for this one-sentence job and shows nothing that did not finish (`stop_reason` not end_turn).
The forced-tool plan and Show me calls were checked and are unaffected.

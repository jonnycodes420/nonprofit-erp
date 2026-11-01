## ASK-4 · Any question about the org's own records (2026-10-06)

Jonathan: Steward's AI, Ask and Why/What "should have infinite answers… the AI has access to the entire system…
make it incredibly robust and hardened". The answer that keeps every promise Steward makes is a QUERY LAYER,
not a model with SQL: `askQuery.js` catalogues thirteen kinds of record and their fields, the model fills a
typed form, and Steward validates it, compiles it read-only and org-scoped with every value bound, and writes
the sentence, each number a figure (source `query`) that opens its rows. It answers last on every refusal
path, and FIRST for any question that is not asking why or for a recommendation, because the eval showed the
older paths answering the nearest question instead of the one asked (first gifts in 2026 read as "second
ask"; recurring AND volunteers read as monthly donors). The Agent's people-finder falls back to it too.
Hardening: aliases for harmless variants, sorting never refuses, a breakdown names its largest group, the
sentence model is given the question its facts answer. Score (`docs/ask-4/score.md`): 52 questions across
every record kind, main 11 right → 52 right; 15 held out, 14 right. $4.19 of model calls. Test:
`ask4-query-guard` (org isolation per entity, related records in their own org, SQL-looking values inert,
unknown fields refused, rows foot), proven able to fail by dropping the org condition.

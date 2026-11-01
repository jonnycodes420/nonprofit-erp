## SUPPORT-1 · a help assistant that knows Steward, and Jonathan one tap away (2026-10-19)

HELP-1 had articles and a one-shot Ask Steward. SUPPORT-1 made it a conversation
grounded in Steward's own sources: support/buildIndex.mjs builds support/index.json
(the 34 HELP-1 articles, eleven new docs/help/*.md, the FAQ and feature pages,
MESSAGING.md, and each connection's status from the code) and the committed file is
checked fresh by support1-answers, because .railwayignore leaves docs/ and client/
out of the backend. support/engine.js ranks (BM25, no vendor), decides hand-offs
(cancel and billing never answered; money, data loss, security and frustration
answered and offered), and writes the template answer AI-off uses. SUPPORT_TOOLS
is empty and the module writes only question_log and tickets. The org's facts
(connections, last sync, imports) show as read, above the model's words, and a
volunteer coordinator gets none. Writing it found fifteen HELP-1 articles stale
(Tasks still said "+ New task"); they were corrected from the code. The website's
chat answers without a model: a visitor has no org and so no AI budget.

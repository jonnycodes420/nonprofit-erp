## HELP-1 · help centre and Ask Steward (2026-10-01)

31 articles, one per app screen (14), the donor profile, the Settings sections
and seven tasks, written from what each screen does today; a guard in
landing2-marketing fails the battery when a routed screen has no article. The
"?" opens the article for the current screen beside the page. Ask Steward is
the Agent engine's help persona with no tools, and its prompt comes only from
buildHelpPrompt(question, articles) (help1-ask holds the route to that, byte
for byte, against a stand-in for the API). Questions to Ask Steward, the Agent
and the Analyst are logged as text only for twelve months. Ask a person makes
a ticket in super-admin and emails the support address; the reply promise and
the address are settings (SUPPORT_REPLY_PROMISE, SUPPORT_EMAIL) and Jonathan's
call. Writing the articles from the code surfaced real issues (workflow
recipes that email donors with no per-send review, a deposit link that opens
the donor import, a Delete donor that says it cannot be undone and can), which
are listed in the build report rather than fixed here.

## INT-4 — her own inbox, and the line around it (2026-09-30)

A development director's conversations with donors live in one person's
mailbox, and when she leaves they leave with her. Steward logs them onto the
donor's record so the organisation keeps its own history. `shared/mailboxLog.js`
holds the whole decision, pure, and Gmail and Outlook are two fetchers under it.

**THE RULE THAT MAKES IT ACCEPTABLE AT ALL.** Only messages to or from a person
already in that org's Steward. Everything else is never stored: not the subject,
not the address, not the body, not a count of how many there were. This is a
personal mailbox, with her doctor and her children's school and her job
applications in it, so "not stored" is the DEFAULT and logging is the narrow
exception. The provider is asked only for messages involving an address already
on file, and what comes back still has to pass the decision before one field of
it is written.

**WHAT THE FIRST GMAIL INTEGRATION WAS DOING, FOUND WHILE SURVEYING IT.** Three
things, all live in production until this build:
· `state` was the bare user id, unsigned, and the public callback believed it.
  Whoever completed a Google consent decided, by typing a different id into the
  URL, whose Steward record the mailbox was filed against. Nothing proved the
  person finishing the flow was the person who started it. This is exactly the
  hole INT-OAUTH's signed state closed for Xero, Intuit and Square, still open
  on the one connection that reads somebody's mail.
· The tokens were stored in PLAINTEXT: `access_token` and `refresh_token` as
  bare TEXT columns, a staff member's whole mailbox, while every other
  connection in the product sealed its credentials with the org as AAD.
· It asked for `gmail.send`, and had a `/gmail/send` route. Nothing in Steward
  should hold send access to a fundraiser's personal mailbox: the product's
  whole promise is that a human sends.

All three are fixed. The flow runs through `shared/oauth.js`; the tokens are
sealed and the old rows are migrated into the sealed table with their plaintext
columns emptied (and it FAILS CLOSED: without the key it leaves them alone and
says so, rather than inventing a fallback or deleting a working connection). The
scope is `gmail.readonly` and nothing else, and the send route is gone. The old
`/gmail/callback` survives as a forward-only route that writes nothing, so the
redirect URI already registered with Google keeps working and the deploy breaks
nobody.

**HER SWITCHES, NOT THE ORGANISATION'S.** A never-log list of addresses and
domains, a pause, and "do not log this one". Every route behind them is scoped
to her user id: an admin colleague in the same org cannot see, pause,
disconnect or purge her mailbox, and the one test pins that. A domain entry
matches on whole labels, so `example.com` covers `mail.example.com` and never
`notexample.com`.

**A CONVERSATION IS A TOUCH AND NEVER A GIFT.** It feeds last contact and it can
close a Thread step that asked for exactly this contact, as an OUTCOME naming
the conversation that closed it, which is what `threads_close_honest` requires.
The closeable step types are a deliberate SUBSET: a pledge reminder and a
membership renewal close when the money or the renewal arrives, not when
somebody was written to, and closing those on an email would mark a thing done
that has not happened.

Two things the work turned up on the way: the old writer left `created_by` NULL
on every interaction it wrote, against the standing actor rule; and the tenant
matrix's teardown list was two tables short of the tables INT-3 and INT-4 add,
which is the "a teardown list one table short is a suite that passes once"
failure it already carries a note about.

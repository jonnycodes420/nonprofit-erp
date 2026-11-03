## POLISH-4 · The P3 sweep, greetings once, and Re-engage that tells the truth (2026-11-02)

**Why.** `docs/defects.md` held 40 P3s (the brief counted 35): nothing wrong with a number, all of
them the reason Steward read "works" rather than "made with care". And on Justin's Place, Re-engage
(120 people, $163,244) held people who had pledged at this year's dinner and businesses whose owner
gave this year: a P1, because Re-engage is a list of people to ask.

**Re-engage reads one rule.** The badge (`/donors/counts` reengage), the list and its tiles read
`shared/numbers/lapse.js reengageSql`, on the server, once per row (`reengage` on `/donors/summaries`
and `/donors`). The stored stage is no longer read: an officer's Lapsed is their note, and a pledge or
a gift in the giving unit still keeps the person off the list. The client stopped computing
`d.stage==="lapsed" || isLapsed(...)` in two places (`DonorDirectory.jsx`, `Donors.jsx`).

**A person and their business are one giving unit.** Two new link types, stored person first:
`owner` ("Owns · Gives through") and `works_at`. `lapse.js` reads across them (`LINKED`,
`linkedLastSql`, `unitLast`): the unit's last gift is the later of the two, and either one's pledge
holds both, so every door that reads lapse.js (the tags, the Donors filters and groups, the counts,
the stage sweep, Home, the sequences) follows. Money stays credited to whoever gave it. An automatic
Lapsed clears when the unit gives (`unlapseHeldByPledge` now also clears "someone they give with
gave"); the after-change step widens to the linked people. TRUTH-1's key (`tests/keys/truthKey.js`)
reads the same links, so the truth check agrees with a linked pair. Households were not folded into
the per-person lapse rule: that would move every household member's Lapsed tag and the key with it,
and is its own build.

**Merge by hand.** Data health's merge (`/data-health/pair`, `/data-health/merge`, undo for 30 days)
was complete; nothing outside its detected pairs opened it. `profile/MergeWith.jsx` searches for the
other record and opens Data health's own `CompareModal` (exported, with a subtitle for a pair she chose
and more of what moves named), then Undo in place. More → Merge with… on the profile; Merge in the
Directory's bar when exactly two are ticked. `MergeDuplicatesModal` is still opened by nothing; it
belongs with the old wizard's PRUNE.

**Suggesting the links.** `dataHealth.js businessLinks`: a person and an organization when the
organization's name holds the person's full last name and they share an address, a phone or a work
email domain, or the person's work email is at the organization's domain or at one that starts with
its name ("lee@cmcenvironment.com" and "CMC, Inc"). Free mail is nobody's work domain; a last name
alone never fires. Data health shows it as "People and their businesses", one click links them as
Owner (stamped), Undo deletes the link to the trash, "Not linked" is remembered.

**Greetings, once.** `shared/greeting.js greetingLine(person, { word })` is the opening line: "Hi
Desmond and Ruth,", "Dear" whenever the name is formal, "Hello," only with no name. `greetingName`
learned the shapes that went wrong: a salutation that is a title alone takes the last name ("Dear Dr.
Ramirez,"), a title before a full name reads title and last name, a leading "&" is dropped, an initial
is never a first name, "Smith, John" is John, a word with a digit is no name, and a record kept as a
person whose name only a business carries ("Redshaw Holville Wine Spirits", "Corman Excavating") is
greeted as an organization. Every draft builder and transactional email that opened with its own
`split(" ")[0]` now calls it (Insights' moves, draftNote, the milestone and checking-in drafts, the
workflow drafts, Atlas, surveys, voice, video thanks, volunteer hours, the card-expiring, recovered
and reconnect emails, the year-end cover, auctions, the morning and weekly emails, the open-pledge
note, Tasks and the profile's payment-link email). The suite checks every name in the real-shaped,
messy and people-shapes fixtures (1,531).

**The P3s.** Fixed, by screen: Home (the setup card opens with its steps and remembers Hide; an empty
org's moves card stops offering Import a third time; a phone row's action keeps clear of the mic
button; Ask labels a refusal "No answer"; the Planned tab says its own people), Donors (Filters on a
phone; the view tabs never break "Re-engage"), the profile ("Email from them", not "replied"),
imports (the done screen says how many rows were read into one person), Communications (the timezone
in words; list subjects show "(first name)", never "Margaret"; the Journey switch inset), Finance
(budget lines read "$1,750 ahead" / "$300 over", in brass), giving pages (Stripe said once; the
switched-off portal names the org and links its giving page; "Your giving"), and the morning email's
date in words (a P2). Left, with reasons, in defects.md.

**Found by CI, fixed here.** campaign2-goal-bar went red on CI at 8 PM New York time: a matching
challenge dated the day it began as the database's UTC day (`to_char(match_started_at)`), so a gift
given that evening read as "before" the match and the public page said more of the match was left
than was. It now reads the org's day (server.js, the matchchallenge widget). Red on main with a UTC
database at 20:30 ET, green with the fix.

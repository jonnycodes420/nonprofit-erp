## WEALTH-1 · A Wealth Score on every person (2026-11-09)

Allie Barnett (Justin's Place, beta) asked for a field "where their address goes" to rank people, search
for everyone who is a 5, and sort the whole list by it. Jonathan's call: build it as she described.

- **A new column, not the old one.** `donors.wealth_score` already held an automatic 1 to 10 that
  `calcWealthScore` rewrites after gifts, on existing rows. Reusing it would have shown numbers nobody set as
  set scores and failed a 1 to 5 check. The score she sets is `donors.wealth_rating SMALLINT` (check 1 to 5,
  added NOT VALID then validated), with who and when beside it. The list, report and Atlas key is still
  `wealth_score`, the name she sees is "Wealth Score".
- **The leak that was nearly shipped.** `GET /donors` answers with `donors.*`, so any new column reaches
  every signed-in user. Rather than strip it route by route, the app's `json replacer` drops the column's
  keys from every JSON answer; the score leaves only through routes that check `maySee` first.
- **The decisions rule "Never render Wealth Score" (BUILD-100)** was about a computed figure. It now says so,
  and the Wealth Score is the hand-set 1 to 5.
- **Import fills, never overwrites.** A matched person with a score keeps it (the BUILD-78 fill-missing rule
  every import field follows). A bare "Wealth Score" header is now Steward's own; vendor scores (DS, iWave)
  and "Wealth rating" still go to the screen's text columns.
- **"My 5s" means the org's 5s.** Atlas reads the question by template (AI on or off) so the director, who
  owns nobody, gets her list.
- Settings.jsx sat at 1,496 lines; the major gifts checkbox moved to `settings/MajorGiftsCheckbox.jsx` so
  the new team switch did not grow it.

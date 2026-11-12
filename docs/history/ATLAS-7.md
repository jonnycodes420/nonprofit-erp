# ATLAS-7 · Atlas handles a group ask, makes the journey it was asked for, and never says "Done" when nothing was done (2026-11-11)

Why: on 11 Nov Jonathan told Atlas to log every donor who gave over 1000 in his Top 100 and put them in a Top 100 journey, a phone call every three months for a year. Atlas read one person ("them"), asked which of his two journeys he meant, never offered to make the one he described, and then answered "Done." over "I couldn't tell who that was about". Nothing had been done.

Reproduced first with real clicks on a production build (`NODE_ENV=production`, the built client) on a made-up org shaped like his (`tests/lib/atlas7Fixture.js`) and a stand-in model that reads his sentence the way prod's did. Staging was not used: the walk account's password is a secret, and typing into Harborlight would have moved the fleet's baselines.

- **Done means done** (`spokeFor`): the heading counted any line as an action, refused ones included.
- **A group is a group** (`server/atlas/groupAsk.js`): read in code before the model, through Show me's reader, so a group is only ever the Donors list's filters ("every donor who gave over 1000", "everyone in my Top 100", "lapsed donors in Lexington").
- **The money window** (`shared/numbers/gaveOver.js`): last 12 months, this calendar year, lifetime or one gift, asked once with each count read from the Donors list's `/donors/ids` for the same rules. `giftOver` is a new Donors list filter (one gift over the amount).
- **The journey he described** is the first choice, made through `POST /journeys` by hand: "a phone call every 3 months for a year" is four calls, 91 days apart.
- **One confirm, then act**: the card shows who (with "See the 30"), the list (added, already on it), the journey and its steps, who it leaves out, and when the first calls land. Do it is claimed once. Undo all of it reverses the enrollments, archives the new journey when nobody else is in it, and takes the list adds back off.
- **Spread**: more than 10 enrollments spread their first step over the next ten working days, largest givers first.
- Test: `tests/atlas7-group-ask.test.js` (15). Five planted defects, each red.

## VOL-2 — Volunteers stands on its own (2026-09-28)

VOL-1 built the machinery: opportunities, slots, sign-ups, capacity decided by
the database, check-in, waivers and checks, the coordinator boundary. What it
did not build was a way IN. The only route onto the roster was "go to Donors
and tag somebody Volunteer", which is the donor way in, on a screen that says
donor everywhere, discovered by accident.

**1. The two actions are up front.** "Add a volunteer" in emerald and "Import
volunteers" outlined, at the top of Volunteers → People, empty roster or full.
Adding one by hand is three fields, because that is what a coordinator has
when somebody signs up at a table. If the email is already on file the answer
says so, by name: one person, one record, and she finds out at the moment it
happens rather than from a duplicate she meets next week.

**2. The import reads a volunteer file, not an hours file.** VOL-1 could read
one column family. A real export has four: people, contact details, hours
history, and the two dated things that decide whether somebody may work at
all. `shared/volunteerImport.js` reads all four, with five presets
(VolunteerHub, SignUpGenius, Wranglr, Bloomerang Volunteer, and a plain
spreadsheet, which is what a small organisation usually actually has). It is a
preset on the ONE mapper: the browser parses with `parseFileToSheets`, so CSV
and XLSX both work, and the SERVER decides everything in a preview that writes
nothing.

**The first test file it was given found a defect in it.** A vendor preset
only lists the columns that vendor ships, and a real export has been edited:
somebody had added a "Waiver Signed" column to their SignUpGenius report,
because SignUpGenius does not have one. Mapping with the vendor preset alone
dropped it silently and the waivers arrived as nothing. The vendor preset maps
first and the plain reader now fills what it did not name, filling gaps only
and never overriding.

**And a tick is not a date.** A credential cell reading "yes" or "signed" is
refused by line and reason rather than given today's date, because what a
screening is worth is entirely its date. A shift dated in the future is a
sign-up, not hours worked, and is refused too: hours somebody has not given
yet are the fastest way to a grant report that lies.

**3. The undo is exact.** Every row an import creates is stamped with its own
`imports.id` across the three tables it writes, and the undo deletes by that
id alone. A "remove everything from the last five minutes" undo would take the
shift a coordinator logged by hand while the import ran. A person the import
merely MATCHED is never removed: they were here before the file arrived. A
person it created who has since given, or who has a shift it did not write, is
KEPT and named with the reason, which was proved by planting a gift on one and
watching the undo refuse to take them.

**4. Nobody who arrives this way is a donor.** Add and import both write
`person_types ["volunteer"]` and nothing else: no gift, no donor tag, no stage
that implies one. The empty state was rewritten to lead with the three
volunteer ways in as buttons ("Add your first volunteer, import from
VolunteerHub, SignUpGenius or a spreadsheet, or share your sign-up link"), and
tagging on a donor record is mentioned last, in small text, because it is
still true and it is still not the answer.

**5. Opened from Volunteers, a person is a volunteer first.** Upcoming shifts,
hours, waivers and checks, groups. Giving is the LAST field, present only when
they have actually given, and the server does not put it in the payload at all
for a volunteer coordinator: that role is a security boundary, so the server
decides it rather than the screen choosing what to draw.

**6. The two VOL-1 leftovers.** The group sign-up screen exists now (a group
is a LABEL on a set of sign-ups, never a person; capacity is still the
database's, so twelve people at an eight-place shift get eight confirmed and
four waitlisted, and the answer says which). And the reminder sweep has a
timer: hourly, off under DISABLE_BACKGROUND_TICKS, with nothing about who gets
mail changed. Hourly rather than daily because "tomorrow" is a different
instant in every org's timezone, and the per-row claim makes the extra passes
free.

**7. The stray brass bar.** Jonathan saw it; two pixel scans for brass near
both tab strips found nothing, so the answer came from asking rather than from
guessing, and it was not brass at all: the tab strip was a full-width flex row
with a border-bottom, so the rule carried on past the last tab to the right
edge — 835px of bare tan line on cream at 1440, which reads as a stray brass
bar because that is what a bare warm line on cream looks like. `fit-content`
with `max-width: 100%` ends the rule where the tabs end and keeps the phone
overflow-scroll.

**What the run cost, and what it taught.** The ALTER TABLE block went in beside
the shifts indexes and ABOVE the CREATE for `volunteer_credentials`: it worked
on every database that already had the table and killed all three battery
shards on a fresh one with `relation "volunteer_credentials" does not exist`.
An ALTER goes below the CREATE it alters, always, and a fresh database was
booted afterwards to prove it rather than assumed.

The tenant matrix then refused the build for a better reason: two new
parameterised routes nobody had probed across the org wall. Wiring them found
the trap underneath — the existing fixture's import row is shape `workbook`
and the volunteer undo only answers for shape `volunteers`, so probing with it
would have 404'd because of the SHAPE and gone green without touching the wall
at all. The fixture got a volunteers-shaped row per org.

`scripts/vol2-walk.js` is 59 assertions at 1440 and 390 plus a fresh empty org.
Three of its own assertions were wrong before they were right: it expected two
people from a three-person file, it used a fixed email so its second run met
its own last run, and it matched the empty state's text and found the BOX that
holds both lines, so "is it smaller and lower" compared the box with itself.

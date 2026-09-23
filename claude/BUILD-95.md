# BUILD-95 — the record

**Built 22 September 2026, written down 23 September 2026.** BUILD-95 was built
in one evening without a spec, so this file is the only account of it. It is a
RECORD, not a plan: what shipped, where, and the one sentence per item that a
future session must not break.

`BUILD-88.md` does not exist — the repo's convention for a build record is
`audit/BUILD-NN-FINDINGS.md` — so this follows that shape at the path BUILD-96
named.

**All of it is live.** `main`, Railway `/health.buildSha` and the client's
`<meta name="build-sha">` were all `38784ee` when this was written; prod was 0
commits behind main. CI green by workflow name (`CI`, `CodeQL`) on every commit
below.

---

## THE SEVEN THINGS

### 1 · Square, as a read source — `353a9e0`
`sources/square.js` + `shared/givingSources.js` + `shared/publicSources.js`.
**32 assertions** (`tests/build95-square.test.js`).

Every other provider Steward reads is a giving platform, where a row is a
donation unless it says otherwise. Square is a point of sale: the same row
shape carries a lesson fee, a bale of hay and a donation. So the adapter does
not classify — the **organisation** declares which locations are giving, or
which phrase their donation items use, and **nothing imports until one is
set**, loudly, because silence reads as "Square had no donations."

> **Do not break:** amounts are in **minor units** (`amount_money.amount` of 250
> is $2.50) and it is asserted first in the suite — this is the 100x error that
> nobody notices until year end. The `Square-Version` header is **pinned**, not
> floating. `giving_sources.config` is generic JSONB **merged, not replaced**, on
> PATCH: a rename that silently wiped the gate would stop every import with no
> error. And Square is mirrored in `publicSources` but is **NOT on the
> allowlist** and must not go there until a real dollar has come out of a real
> Square account (`BLOCKED-build95.md` §1).

### 2 · "Where giving comes in" moved under Integrations — `a52d5df`
`Settings.jsx`, `Dashboard.jsx`. Four test updates, each honest about what moved.

"Set up online giving" names two jobs — a card processor for Steward's pages,
and the places an org already takes gifts so Steward can **see** them. They
lived on two Settings tabs while the checklist button deep-linked to a third.
The panel is now beside the processor on Integrations.

> **Do not break:** `sources` survives as a **deep-link alias**, so no saved
> link dies. The checklist's two items land on two different screens **on
> purpose** — `tests/setup-checklist.test.js` pins that, and a future session
> that "fixes" them back to one screen is undoing this.

### 3 · The photo adjuster — `a52d5df` (and the prod FIX `cc59fbd` under it)
`Donors.jsx`, `shared.jsx`, `scripts/local-preview.js`, `vercel.json`.

Server-side centre-crop is fine for a logo and wrong for a face. Drag to move,
scroll or slider to zoom; **the circle is exactly what is saved**, cropped to
512 in the browser, so what she positioned is what the server stores rather
than a second opinion about where the face is.

> **Do not break:** `scripts/local-preview.js` now **derives** its rewrite table
> from `vercel.json` instead of hand-copying it. The hand-copied table is how
> `/person-photos` went missing locally while every suite stayed green — the
> suites call the API directly, so only a browser could see it. One list, one
> order, no transcription. *(BUILD-96 Part 6 adds the assertion that the two
> agree.)*

### 4 · A picture of the cheque — `36e448e`
`assetStore.js`, `DepositSheet.jsx`, `db.js`, `server.js`.
**20 assertions** (`tests/build95-cheque.test.js`).

A treasurer photographs each cheque as she enters it, so three months later
"did Margaret really write $250?" has an answer that is the cheque rather than
somebody's memory. Same signed, expiring, private door as a donor photo — a
cheque carries a name, an amount, a bank, an account number and a signature,
and is the most sensitive image this product will ever hold.

> **Do not break:** it is **not cropped square** — a square cheque is a cheque
> you cannot read — so it keeps its shape at 1600 on the long edge at a higher
> WebP quality than a headshot. `gifts.cheque_asset_id` is in
> `collectLiveAssetRefs`; drop it and the 90-day retention sweep destroys the
> only record of what the donor actually wrote. **A photo that will not store
> must never cost her the deposit**: the line commits and the failure is
> reported by line number, because she is holding the cheque at that moment and
> that is the only time re-taking it is free. Photos key by **line number** —
> the commit re-plans server-side and writes from `plan.lines`, so hanging an
> asset id on `body.lines` writes it nowhere.

### 5 · Cheque reading, which proposes and cannot post — `a16f8da`, `5c4f49f`
`shared/chequeRead.js`, `server.js`, `DepositSheet.jsx`,
`scripts/build95-cheque-drill.js`. **50 assertions**
(`tests/build95-cheque-read.test.js`).

A cheque carries its amount twice and a bank has a rule about it, because the
two disagree often enough to need one. Steward asks the model for **both
amounts transcribed independently** and checks them against each other through
the one money parser. **Agreement to the cent is the only outcome that fills in
an amount**; every other case leaves it blank (which the deposit sheet already
routes to `needs_you`) and says what it saw rather than picking a winner.

> **Do not break:** Steward deliberately does **not** apply the bank's
> words-win rule — a bank is reading a cheque it is about to pay; this is a
> photograph of one already banked. The model **reads glyphs and is given no
> money decisions**: the schema cannot express a fund, a donor, a confidence or
> a resolved amount, and the suite asserts that **by name** so one cannot be
> added quietly. The route **writes nothing**, proven by content-hashing the
> org's tables either side of the call rather than by reading the handler. The
> model boundary is **not** mocked in the suite, on purpose — a mock answering
> for it is the BUILD-57 mistake exactly.
>
> **Reading is unproven.** The drill has never run against a real photograph.
> *(BUILD-96 Part 3.)*

### 6 · The giving-page builder — `29f8cc6`, `54943de`, `38784ee`
`shared/pageWidgets.js`, `PortalWidgets.jsx`, `PortalEditor.jsx`, `Donate.jsx`,
`db.js`, `server.js`. **37 assertions** (`tests/page-widgets.test.js`) +
**53, 21 of them in a browser** (`tests/giving-page-builder.test.js`).

A widget used to be declared in three places nothing kept in step. Now
`shared/pageWidgets.js` is the one registry, all three consumers read from it,
and the suite walks each of them back to it — including that every registered
widget has a branch in the renderer. Giving pages became built pages on the
same widgets, the same renderer and the same draft/published rule the portal
has had since BUILD-54; one editor takes `?page=gp_…` and says which page it is
arranging.

> **Do not break:** **the surface filters at both ends** — the palette offers
> what belongs on a giving page and the server **refuses** the rest, so a
> hand-rolled request cannot put a donor's own giving history on a page a
> stranger opens from a flyer. **The form is not in the registry at all**: a
> page whose whole job is taking a gift must not be able to lose it. **A draft
> never reaches a donor and an unbuilt page is unchanged** — that is what makes
> this safe to ship. `pruneWidgetAssets` must read **every** page of the org,
> not just `portal_pages`; before `54943de` it would have soft-deleted a photo a
> live giving page was showing. The server reads the registry through the
> `depositMod()` convention, never a top-level `.then` assigning a module-scope
> array — that leaves a window at boot where every widget is refused.

### 7 · The first-run greeting, and Allie's org — `fc4b22e`, `2380a4b`
`shared.jsx`, `App.jsx`, `db.js`, `server.js`. **23 assertions**
(`tests/build94-welcome.test.js`).

A new organisation's first sign-in is the one moment the product gets to say
"this is yours" before it says anything else. `FirstRunWelcome` carries only the
org's own record. `org_justinsplace` — Allie's, equine-assisted services — was
provisioned on prod with the `horse` motif and a first-run welcome armed.

> **Do not break:** **"already welcomed" is the DEFAULT and being greeted is the
> exception.** `users.welcomed_at` defaults to `NOW()` with every existing row
> backfilled, and `register-org` sets it `NULL` by name. A NULL-means-greet
> column would throw a full-screen takeover in front of every existing user and
> every test fixture that inserts a user without thinking about it, which is all
> of them. `ADD COLUMN IF NOT EXISTS … DEFAULT x` does **nothing at all** when
> the column already exists, including the default — the `ALTER COLUMN SET
> DEFAULT` after it is the fix, not belt-and-braces. The test **pins the
> animation names**, so confetti cannot arrive without changing that line.
>
> **Allie's org holds sample data under a real organisation's name.**
> *(BUILD-96 Part 2 is the clearing of it.)*

---

## THE THREE THINGS THE EVENING COST, RECORDED SO THEY ARE NOT PAID AGAIN

1. **The TDZ class, third appearance** (`54943de`). A `useMemo` read a binding
   twenty lines above its `const`; the whole page rendered its error boundary
   while every server assertion above it passed. *(BUILD-96 Part 6 adds the rule
   and the grep to CLAUDE.md.)*
2. **A browser assertion that passed for the wrong reason** (`38784ee`). The
   palette assertions were reading the **closed** screen, where a widget's own
   chrome label carries its name, so Hero and "Programs & funds" passed off the
   page behind a collapsed palette. Opening it is what the assertion meant.
3. **A red battery run during edits tells you nothing** (`38784ee`). A full run
   while files were being edited and the server rebooted came back 12 red in
   1567s against ~475 clean. Re-run untouched: 5, of which 4 were real.

## WHAT WAS NOT PROVEN

- **Square has never seen a real payload** — `BLOCKED-build95.md` §1.
- **Zeffy has never seen a real payload** — `BLOCKED-build95.md` §2. Zeffy's
  public API is six endpoints, all GET; Steward can never process a Zeffy
  payment, only read one. **Zeffy recovers the card; Steward recovers the
  relationship.**
- **Cheque reading has never read a real cheque** — see §5.
- **The horse outline is traced from a supplied reference** whose provenance is
  recorded in `shared.jsx` and, as of BUILD-96, `docs/ASSETS.md`. If it came
  from a stock library, the licence wants checking before it ships beyond a demo
  org.

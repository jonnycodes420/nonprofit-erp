# Design system

Read this when you touch anything that reaches a screen: colours, tokens, modals, mobile layout, vocabulary, empty states, org branding or emoji.

## Rules
- **Use `Modal` from `shared.jsx` for every dialog in the authenticated app; never hand-roll a shell.** It
  portals to `document.body`, caps at 90vh with its own scroll, takes a sticky footer, ref-counts the
  body-scroll lock, closes on Escape and returns focus to the opener. (BUILD-87 F.1)
- **Never animate a transform with `animation-fill-mode: both` or `forwards`; use `backwards`.** A retained
  transform makes the element the containing block for every `position:fixed` descendant, which clips
  backdrops. (BUILD-87 F.1)
- **A dialog is defined by its translucent scrim (`rgba()` or hex with alpha).** A drawer, a takeover, a toast
  or an opaque loader is not a modal. Do not count it as one to move a number. (BUILD-87 F.1)
- **Keep `pages/Landing.jsx` and `ProductMark.jsx` free of any `shared.jsx` import.** Landing is the eager
  entry chunk. `Landing.jsx` and `Donate.jsx` are named exclusions in the modal guard. (BUILD-81, BUILD-87 F.1)
- **Give each row one emerald action.** Put secondary verbs such as Dismiss in a "…" menu. A reason line or
  label is never emerald, because on these screens emerald means "this is the button". (BUILD-87 F.3, BUILD-88d)
- **When four or more sibling action buttons appear, show one primary and a labelled menu.** (BUILD-33)
- **Keep Delete out of the top action row at every width.** Put it at the foot of the record as a quiet outline
  behind a confirm, never at thumb height beside Edit. (BUILD-41)
- **Write an empty state as one line, with the working behind a "why" (`OneLineEmpty`).** Unmount the detail
  rather than hiding it. Text that is present but invisible lets an empty state lie to a test. (BUILD-87 F.3)
- **Render an empty money tile as a warm-grey "—" plus a sentence, never `$0`.** A rate with no denominator
  is null and says "No decided asks yet", never 0%. (BUILD-45 D-2, BUILD-46)
- **Cards get the `#e8e4db` hairline (`T.bg2`), a 12px radius and no shadow.** The card edge never turns brass
  for overdue: the band, the row and the count already say it. (BUILD-87 F.3, BUILD-88d)
- **Show a colleague by first name (`firstNameOf`).** When the logger and the owner are the same person,
  show one name. (BUILD-87 F.3.7)
- **Send every piece of her vocabulary through `makeT`/`t()` in `shared/vocabulary.js`.** The defaults are
  today's strings, only the difference from them is stored, and the plural is stored rather than computed. (BUILD-86 B)
- **Never let vocabulary reach a receipt, a year-end statement or the donor portal.** A §170
  acknowledgment is a legal document. The vocabulary suite asserts this. (BUILD-86 B)
- **Apply vocabulary to rendered text only, never to identifiers.** A count that crosses person types says
  "people". Where every row is a donor, the output stays byte-identical to the default. (BUILD-86 A, BUILD-94)
- **A first-run prompt asks and never walls.** A blocking modal on Home would stop every existing org at its
  next login. (BUILD-86 B)
- **Org branding is a logo plus one accent, placed only on accent moments.** It is never a re-skin and never
  touches attention or destructive surfaces. It is not used in the Home greeting line. (BUILD-13, BUILD-88d)
- **Normalise the accent on save with `normalizeAccent` (branding.js), adjusting rather than rejecting.**
  Receipts freeze the accent and logo into their snapshot at issue. (BUILD-13)
- **Add a new colour as a `T` token in `shared.jsx` before using it.** `brand-allowlist` derives what is legal
  from `T` and runs inside the client build, so drift fails the deploy. (BUILD-33, BUILD-86 C.1)
- **Verify mobile at a true 390px Playwright viewport, never by resizing a window.** Chrome will not go
  below 500px and silently shows the desktop layout. (BUILD-40)
- **Always show hover-only metadata under `(hover:none),(pointer:coarse)`.** Toggle it with opacity rather
  than display so the row height holds, and reveal it on `:focus-within` for keyboard users. (BUILD-87 F.3)
- **On a phone, names wrap and never truncate.** Tap targets are at least 44px and card headers wrap, never
  run into their link. (BUILD-41, BUILD-88d)
- **Walks at 1440 and 390 assert that no two regions of a row overlap, every action sits inside its card, and
  nothing scrolls horizontally.** Look at the captures as well. The overlap bugs were found by eye. (BUILD-87 F.3, BUILD-41)
- **Never let content visibility depend on an animation succeeding.** Reveals fail open, stay off at phone
  width and turn off under `prefers-reduced-motion`. Animate only opacity and transform. (BUILD-40, BUILD-34)
- **Navigation is a real `<a href>` and `<button>` is for on-page actions.** A row whose main region links to
  a donor puts its action button beside the anchor as a sibling, never nested inside it. (BUILD-81, BUILD-45 D-1)
- **The rail is `PRIMARY_NAV` (five) plus a `MORE_NAV` disclosure.** More opens itself when the current
  surface lives inside it, a portal-tier org keeps Portal on the rail, and every `TABS` id must be reachable. (BUILD-87 F.3.5)
## Gotchas
- **Capture the dialog's opener during render, not in `useEffect`.** React applies a child's `autoFocus` at
  commit, before effects run. Keep the inline `onClose` out of effect dependencies, or every parent render
  re-runs open and close. (BUILD-87 F.1)
- **A raw hex inside a `var()` fallback string counts against the census ratchet.** Write
  `"var(--x, " + T.white + ")"`. (BUILD-94)
- **Masks are alpha-only, but `#000` still trips the allowlist.** Use ink `#0F1A12` in mask stops. (BUILD-41)
- **A grid item's auto min size is its content's min-content, so the column overflows.** Use
  `min-width:0` and `minmax(0,Nfr)` on columns that hold long names or tab rows. (BUILD-41, BUILD-88d)
- **To test `(hover:none)`, Playwright needs `hasTouch`/`isMobile`.** A window narrowed to 390px still reports
  a mouse. (BUILD-87 F.3)
- **`getComputedStyle` returns `24ch` in px, and `innerText` applies `text-transform`.** An uppercase label
  comes back as "MORE". Assert against that. (BUILD-87 F.3)
- **A control that commits on `onMouseDown` ignores a synthetic `.click()`.** Drive it with real pointer events. (BUILD-87 F.3)
- **A JSX comment cannot sit between an element's attributes.** A misplaced `</div>` inside a `<>…</>`
  produces an error that points at the fragment close, not at the cause. (BUILD-89, BUILD-87 F.3)
- **Palette and emoji guards must be taught that a comment is not a screen.** Otherwise they flag source
  comments as rendered text. (BUILD-86 C)
## Where the code is
- `client/src/components/shared.jsx` — `T` tokens, `Modal`, `interactive()`, `PageTitle`, `firstNameOf`, GlobalStyles
- `shared/vocabulary.js` — `VOCAB_KEYS`, `VOCAB_DEFAULTS`, `normalizeVocabulary`, `makeT`
- `branding.js` — `normalizeAccent`, `contrast`; `App.jsx` sets `--org-accent` and holds `PRIMARY_NAV`/`MORE_NAV`
- `client/src/components/ProductMark.jsx` — the one pill for the named products, with no dependencies
- `tests/brand-allowlist.test.js`, `palette.test.js`, `palette-census.test.js` — value guard, contrast guard, the ratchet
- `tests/modal-shell.test.js`, `no-emoji.test.js`, `brand-glyph.test.js`, `vocabulary.test.js` — the other design guards

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## THE DESIGN RULE (BUILD-86 — standing, applies to every build from here on)
**FOUR COLOURS reach a screen. Nothing else.**
- **Ink `#0F1A12`** — nav, headings, primary text, the one dark surface.
- **White `#FFFFFF`**, with **Cream `#F0EDE6`** as the page ground and **`#E8E4DB`** as a hairline. Cream is white's warm shade, **not a fifth colour**.
- **Emerald `#0D5C3A`** — the ONE action colour. Every primary button is emerald. **There is no second green.** `T.green`, `T.greenMid` and `T.greenDk` all point at it (BUILD-86 C.1); the names survive so 358 call sites did not have to move.
- **Brass `#C9A84C`** — emphasis, progress, the underline under a heading, the marker on an overdue row.

**Secondary text** is warm grey `#5A554F` on LIGHT surfaces and **cream at 70%** (`T.sage400`) on INK. Warm grey cannot take the dark job — it scores ~2.0:1 on ink and `tests/palette.test.js` would rightly refuse it; cream at opacity adds no colour and lands near 8.5:1. **Sage is deleted.**

**OVERDUE IS BRASS, NOT RED.** Red exists ONLY for a destructive confirm ("Delete this donor"), never for status. A screen that shouts in red every morning stops being read, and nothing on a follow-up list is dangerous — it is late.

**The token census RATCHETS DOWN, NEVER UP** (`tests/palette-census.test.js`). The finished parts are held at ZERO (no second green, no bright library red, overdue brass, sage gone from the app); every other count is a ceiling that may only fall, and the suite prints a note telling you to lower it when the gap opens. **A ratchet is not a weaker rule than "zero" — it is the same rule with a date on it, and unlike a TODO it cannot be quietly lost.** Public surfaces (landing, donor portal, giving dashboard) keep their own audited palettes and their own guards; they are excluded by name, with the reason, in the census.

## Design system
- Colors: cream #f0ede6, dark green #0f1a12, primary green #1a6b4a, accent green #10b981, gold #c9a84c, terracotta (gold-tinted brown accent) #b8593f
- Fonts: DM Serif Display + DM Sans
- **Five-color rule (established 2026-07-15, Home dashboard + STAGES pass)**: nothing outside this set (dark green shades, cream, gold, white, terracotta) anywhere in the authenticated app — no red/orange/teal/blue/purple, even for status/semantic coloring. Gold = positive/on-track/primary emphasis; terracotta = needs-attention/behind/urgent; multiple dark-green shades (ink `#0f1a12`, greenDk `#0d5c3a`, greenMid `#1a6b4a`, green accent `#10b981`, bgElevated `#1a2e1f`) are available and expected to be used deliberately varied (not near-identical shades side by side) when more than one neutral/positive category needs to be visually distinct — see `STAGES` below for the reference example. When a status needs to be visually distinct but doesn't cleanly map to gold/terracotta/green, lean on weight/size/label text before reaching for a color outside this set.
- **Color tokens are the SINGLE SOURCE OF TRUTH — the `T` object in `client/src/components/shared.jsx` (BUILD-12, 2026-07-18).** New or edited UI MUST reference a `T.*` token, never a raw hex literal. BUILD-12 enriched `T` with a full **green ramp** (`green950 #0e1a13` sidebar/ink → `green900 #102418` → `green800 #14352a` deep-pine dark panels → `green700 #1b5138` hover-on-dark → `green600 #1e6b45` primary/positive → `green500 #2f8f62` emerald links/accents → `green200 #dce7df` sage → `green100 #edf3ee` mist hover-wash) and a small **gold ramp** (`gold600 #a97f22` deep-gold large/accent text → `gold500 #c9a84c` primary = legacy `gold` → `gold300 #e7cf91` soft highlight → `gold100 #f6eccf` wash). Semantics are LOCKED: green = positive/up/primary, gold = brand/active/highlight, **terracotta `#b8593f` = negative/attention (never repurpose — a treasurer needs red to mean red)**. Depth goes on dark panels (goal cards use `green950→green800`, not flat near-black); warm hover washes use `green100/200`; extra gold rides eyebrows/active-tab wash (`gold100`, via `SectionTabs`' `.section-tab-on`)/hairline accents/key metrics. **Gold can't hit 4.5:1 body contrast on cream** (it's inherently light) — so gold highlights live on non-text surfaces (underlines, washes, hairlines) and large/accent text only; `gold600` (3.13:1) is large/accent-only. Enforced by `tests/palette.test.js` (WCAG AA on every green-on-cream/white-on-dark pairing + terracotta-value lock). **Pre-BUILD-12 inline hex still exists across components (~1300 literals, incl. deprecated Events/Board/Volunteers/Tasks) — a documented backlog, NOT a green grep-guard; the rule is "nothing new adds to it," and a full migration is a separate, deliberate, non-overnight pass (do not attempt as a risky repo-wide sed on the live app).**
- **Solid page titles (BUILD-19, 2026-07-18).** The shared `PageTitle` (shared.jsx) renders the **whole title in one solid color** — `main` and `accent` are both `T.ink`. The old two-tone treatment (muted `T.ink3` first word + dark accent word) read washed-out and was removed globally. The gold underline is kept and now tokenized (`T.gold500`, no raw hex). Guarded by `tests/pipeline-gating.test.js`.
- **No emoji, ever (BUILD-20 Part 1, 2026-07-18).** Steward reads serious and premium — **no color/pictographic emoji anywhere user-facing** (app UI, landing, AND email/receipt templates). Every emoji was purged (🎉💳🗑📊🔒⚠⭐… and all SMP pictographs + `U+FE0F`) — replaced with a plain word or the existing **monochrome icon set**. What stays and IS the icon set: geometric shapes (`◈ ♦ ◫ ◉ ◑ ◇ ▤ ● •`), arrows (`→ ← ↑ ↓ ↗ ↻ ⇆`), and text-default dingbats (`✓ ✕ ✗ ✎ ✦ ✉ ⚙`) — these render monochrome and read premium. When you need an icon, use one of those glyphs or a word, **never a color emoji**. The Workflows nav icon changed `⚡→◧`; Admin nav icons went from emoji to geometric. **Enforced by `tests/no-emoji.test.js`** — a grep-guard that scans tracked product source (client/src, server.js, db.js, branding.js, auth.js, index.html) and FAILS on any forbidden-emoji codepoint. "No emojis from now on" is automatic, not a memory: add nothing new that trips it.
- **The brand mark is the serif WORDMARK, not a glyph (FIX, 2026-07-29).** The old hexagon/diamond logo SVG (path `M8 2L13 5v6…`) is **retired everywhere** — it had leaked onto signup, sign-in, pricing, the legal pages (Privacy/Terms), the app splash/error screens, the donate page, the reset/forgot-password pages, the offline splash, and two server templates (the password-reset email + the unsubscribe page). Replace it with the **serif "Steward" wordmark** (DM Serif Display, weight 400, `-0.02em`, Georgia/Times stack in email); where a small avatar-sized mark is genuinely needed (a splash badge, the donate/greeting box), use a **serif "S"** in the brand green — never the hexagon. The **favicon/app-icon/OG image are already a serif "S"** (`favicon.svg` etc.) — leave them. **Empty-state ornaments carry NO logo-ish glyph**: `EmptyState` (shared.jsx) renders a restrained on-palette **gold rule** (`T.gold500`), not a diamond (`◇/◈/♦`) — the inert `icon=` props were stripped from all call sites. NB: `◈ ♦ ◇` etc. stay valid as the BUILD-20 **monochrome nav-icon set** (`icon:` colon-form in TABS/section configs) — that's functional iconography, not the retired brand mark. Dead `client/src/Login.jsx` (stale "Mission Suite" branding + an AI-gradient glyph) was deleted. Guarded by `tests/brand-glyph.test.js` (hexagon path absent from client/src, client/public, server.js, index.html; EmptyState has no diamond ornament; wordmark present on the public surfaces; no AI-gradient blue on the invite page).
- **The off-brand "AI green" is BANNED on public/auth surfaces + email templates, and guarded (FIX, 2026-07-30).** The bright Tailwind **emerald `#10b981`** (and its mint sibling `#34d399`) is the retired off-brand "AI green". The BUILD-20/brand-glyph public-surface sweep missed **sign-in**, which used it for the "Sign In" button, the "Sign up free" link, and the "Welcome back" underline. **Public auth pages now follow the PUBLIC brand convention** (matching the landing's "Start free" and the onboarding CTA): **primary action = gold** (`gold500 #c9a84c` with **ink text** `#0f1a12`, never white — gold+white fails contrast), **page-title underline = gold**, **links/accents = forest green** (`greenDk #0d5c3a`, WCAG-AA on cream). On the dark **invite** page (grey Tailwind theme), the emerald accents became **gold** (legible on dark; forest is too dark there). Swept: `LoginPage`, `SignupPage` (a tick), `ForgotPasswordPage`/`ResetPasswordPage` (success ticks + their mint circles → on-brand green), `InvitePage`, the dead `green` token in `publicTheme.js`, and the three server email CTAs (password-reset, invite, manage-fundraiser → gold bg + ink text). **Scope: PUBLIC/auth + email only.** The authenticated app still uses `#10b981` as its documented "accent green" — that's the ~1300-literal BUILD-12 backlog (a separate, deliberate pass; do NOT repo-wide-sed the live app). Guarded by `tests/brand-glyph.test.js` §6–8 (no `#10b981`/`#34d399` on any listed public surface or in server.js; sign-in button/underline gold + link forest; demo creds DEV-gated) and the AA contrast of ink-on-gold + forest-on-cream by `tests/palette.test.js`.
- **No demo credentials on production auth screens (FIX, 2026-07-30).** The sign-in page's `Demo: admin@creoarts.org / demo1234` hint is now gated to **`import.meta.env.DEV`** (Vite dead-code-eliminates it from prod bundles — verified absent from `dist/`). It's the public front door where beta users land — same reason demo-cred logging was pulled from server startup. A demo shortcut is fine locally, never in production.
- **No page-subtitle blurbs (BUILD-12).** Top-level tab pages render the `PageTitle` **title only** — no descriptive subtitle strip (Fundraising/Reports/Finance had one; removed). Also drop purely decorative grey per-subtab sentences (e.g. Reports' per-report "question this answers" line). **Keep** anything actionable: empty-state guidance, `StartHere` CTAs (Reports' "Open LYBUNT"), the Money-in "Connect Stripe" card, field help. If a removed subtitle carried a number shown nowhere else, surface it in a stat card instead of dropping it (Finance's vs-prior-period revenue delta → Revenue card caption `revDeltaCaption`). Guarded by `tests/clickability.test.js`.
- **Everything showing an aggregate or entity is clickable (BUILD-12).** Any card/row/stat that displays a total or names an entity routes to its source/detail via the ONE shared treatment — `interactive(onClick, {label, dark})` in shared.jsx (returns `role=button` + `tabIndex` + Enter/Space handler + `.click-card` = pointer, `green100` hover wash, gold focus ring; `dark:true` for dark panels keeps the pine gradient with a gold-edge hover instead). Conversely, non-interactive elements must NOT look clickable — where no sensible destination exists, leave the element visibly static rather than a dead click, and note the gap. Reference impl: **Fundraising** (fully wired — goal card→Campaigns, all four stat tiles, leading-campaign card, recent-gift rows→donor profile via `selectDonorId`, which needed `/fundraising/overview` to return `donorId`). App-wide pass: **Finance** (stat cards→Transactions by type via `gotoTxns`, fund rows→fund-filtered ledger, monthly rows→ledger, Funds-subtab "View txns →" link); **Grants** (pipeline stat cards toggle a `statusFilter` that filters the grant list — active card highlighted, "Clear ×" chip); **Communications** ("Campaigns Sent" + "Best Campaign" cards→Campaigns subtab; Total-Sent/Open-Rate left static — no filtered destination); **Donors** already navigates all its entity rows (directory/kanban/team/re-engage → donor profile). Guarded by `tests/clickability.test.js` (**43 assertions**). Known gaps (documented, not dead clicks): Finance has no month filter so Monthly-Breakdown rows land on the full ledger; Reports summary stat cards (Unique/New/Returning) and Comms Total-Sent/Open-Rate have no clean filtered destination and are left visibly static; Donors' pre-existing entity-row onClicks aren't yet upgraded to the keyboard-accessible `interactive()` (new BUILD-12 surfaces all are).
- **Finance header layout (BUILD-12):** the `PageTitle` and the fiscal/calendar **year-basis toggle** (+ period label) share ONE `space-between` row at the top — the toggle no longer sits in its own row below the title leaving a dead white band. The stat-card grid follows immediately.

## Product design patterns
- **Warmth primitives (BUILD-08 Phase D, shared.jsx)**: `GoldMoment` is the product's ONLY celebration pattern — one gold banner (soft rise + a single sheen across the accent bar via `.gold-moment`/`.gold-moment-bar` CSS in GlobalStyles; disabled under prefers-reduced-motion; no confetti, ever). It fires **once per org per `moment` key** — localStorage flag `steward_gold_{moment}_{orgId}` is set the first time it renders. Current moments: onboarding import success (inline copy of the pattern in WelcomePage — it renders outside GlobalStyles so the keyframes are declared locally there; the flow now deliberately STAYS on step 2 after import so the moment is actually seen, instead of auto-advancing), goal reaching 100% (keyed per goal id, so next quarter's goal gets its own single moment), and first recovered recurring gift (Dashboard, `recoveredThisMonth > 0`). `StartHere` is the gold first-run signpost (gold left bar, "START HERE" eyebrow, one warm sentence + optional action) — used on Communications' empty campaign list and Reports' first visit (`dismissKey="reports_intro"`, dismissed by "Got it" OR taking the action). Onboarding also gained per-step time estimates (`STEP_TIMES`) + a continuous green→gold progress bar. **Empty-state voice rule**: a "no data" view gets one warm, specific sentence that says what will appear there and the single best first move — never a bare "No X yet." `fmtFull` renders cents-carrying amounts as real money ($140.50, never $140.5) since the Phase B NUMERIC migration.
- **Name the vague anxiety as a number.** When a feature is answering a fuzzy staff worry ("are we neglecting our best donors?", "are new donors falling through the cracks?"), don't default to a generic stat card — compute it into one concrete, trackable, trending number instead. Two examples so far, sharing the same `metric_snapshots` table/trend mechanism (org_id, metric_key, value, snapshot_date; one row per org+metric+day, `snapshotMetricsForOrg()`/`snapshotAllOrgMetrics()` in server.js) rather than a bespoke history table per metric:
  - `stewardship_debt` — donors weighted by (days since last meaningful contact) × (giving significance), summed across the portfolio. Up = donors are going quiet relative to what they've given.
  - `first_touch_delay` — average days between a donor's first gift and their first personal (non-gift) touch. Up = new donors waiting longer for a human response.
  Both are computed live on every `GET /metrics/stewardship-summary` call (never served stale-only) and featured as a headline number on the home screen (Dashboard.jsx), not buried in a stat grid. When building the next feature that's really answering an anxiety rather than reporting a fact, reach for this pattern — a real formula + a trend — before reaching for a plain count or dollar total.

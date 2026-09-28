# Landing ownership

The landing czar owns Steward's public marketing site: the landing page,
the pricing section, and the look of the public Lost & Found page.
Nothing inside the logged-in app is mine.

## How landing changes ship

One worktree and one branch per change, named `landing-<topic>`. Run the
smoke walk (`scripts/landing1-walk.js`) and the landing checks, open a PR,
rebase on main right before merging, merge when CI is green, then confirm
the deploy. Small PRs, one idea each.

## Mine: the landing page (built by LANDING-1, PR #32)

`client/src/pages/Landing.jsx`: rebuilt by LANDING-1 from
`docs/landing/landing-mockup.html`. The markup and the CSS live in this
one file; it imports only React, react-router-dom, and `pricing.json`.

`client/public/landing/`: the 14 photographs, extracted from the mockup
so they are cached separately instead of riding in the JS bundle:

- a-nonprofit-team-gathering-around-a-table-to-r.jpg
- brad-atkinson.jpg
- four-volunteers-preparing-aid-boxes-and-helpin.jpg
- jonathan-atkinson.png
- ross-jenkins.png
- smiling-volunteers-sorting-clothes-and-supplie.jpg
- smiling-volunteers-sorting-clothes-and-toiletr.jpg
- three-smiling-volunteers-working-together-outd.jpg
- three-volunteers-packing-food-aid-boxes-beside.jpg
- two-young-volunteers-smiling-as-they-pack-food.jpg
- volunteers-and-community-members-gathered-arou.jpg
- volunteers-handing-supplies-to-people-at-a-com.jpg
- volunteers-unloading-aid-boxes-from-a-van-and-.jpg
- winfield-bevins.jpg

`docs/landing/landing-mockup.html`: the design source the React page
was built from.

`docs/landing-1/`: the 16 verification screenshots (1440 and 390 pairs):

- landing-top-1440.png / landing-top-390.png
- landing-relationships-1440.png / landing-relationships-390.png
- landing-connections-1440.png / landing-connections-390.png
- landing-growth-1440.png / landing-growth-390.png
- landing-volunteers-1440.png / landing-volunteers-390.png
- landing-lost-and-found-1440.png / landing-lost-and-found-390.png
- landing-pricing-1440.png / landing-pricing-390.png
- landing-full-1440.png / landing-full-390.png

`scripts/landing1-walk.js`: the smoke walk. It opens the public landing
page at 1440 and 390 and checks the six things the brief names, plus the
two rules this page has always had: no invented social proof, and no em
dashes in any copy.

## Mine: the pricing section

The pricing section inside `client/src/pages/Landing.jsx`, and the
standalone page `client/src/pages/Pricing.jsx` (built by FIX-4 from
`docs/landing/pricing-mockup.html`). Both read their numbers from
`pricing.json`, the same file the signup route prices against, so the
page and the card cannot disagree.

`pricing.json` is READ ONLY for me. Prices change only with Jonathan.

## Mine: the look of the public Lost & Found page (restyle only)

`client/src/pages/LostAndFound.jsx`: I may restyle and restructure the
page. I never change how the file is processed: the audit logic in
`shared/lostAndFound.js` and `client/src/lib/lostAndFoundWorker.js`
is off limits.

## Off limits

App screens, `routes/`, `server.js`, `db.js`, `seed-demo.js`,
`CLAUDE.md`, CI configuration, billing logic, and everything inside the
logged-in app.

## Locked facts (change only with Jonathan)

- Pricing: Seed $199/mo up to 1,000 active donors; Sapling $299/mo up to
  5,000; Orchard $499/mo up to 10,000; Forest over 10,000, talk to us.
  Yearly: two months free.
- "Start now" sits next to "Book a call".
- "Your donor file never leaves your computer."
- No invented testimonials, logos, or stats. The advisors are real people
  who approved their name, title, and photo; nothing about them changes
  without asking them.
- No em dashes in page copy.
- Colors: ink #0F1A12, cream #F0EDE6, brass #C9A84C, emerald #0D5C3A
  as the one action color.

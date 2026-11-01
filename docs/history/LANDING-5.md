## LANDING-5 · Fewer words, more people (2026-10-05)

Home and `/pricing` cut hard, on Jonathan's read that LANDING-4 was too wordy and too much software. Home:
the hero line from MESSAGING.md with three chips; "Steward is the institutional memory of generosity." on
its own (the rest of that paragraph opens About); the six pillar bands kept but cut to heading, one line
(`PILLARS[].line`) and link, each picture a real person at work (`PersonPair`) with a tight crop of the
Harborlight screen overlapping it (`product/inset-*.webp`); how it works cut to three steps of twelve words
or fewer beside the same pair; Lost & Found with a photo. Nav "Product" is "Solutions".

The tier table is gone from the marketing site. One `PriceBlock` (Home and `/pricing`) says "Starting at
$199 a month", the lowest `monthlyUsd` in `pricing.json`, so it can't drift from billing. Billing, Stripe
and the in-app plans are unchanged; a signed-in org on `/pricing` gets one button to Settings, Billing.

Two mockups were rejected on the way, and why is the lesson: a 1000px photo drawn 1200px wide, and
screen insets at a quarter of the photo's width, both read as low quality. Nothing on Home is now drawn
larger than its file. Review-note copy fixes rode along ("46%... built in", the Journeys line, "days,
not quarters", the signup "two clicks" now says the reminder email carries a cancel link).

landing2-marketing gained: tier names on no marketing page, the starting price only inside the price block,
no Home body block over 30 words, every pillar picture's alt describes the person. Each was planted red.

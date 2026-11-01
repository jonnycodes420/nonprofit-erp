## CONTENT-1 · Pages people search for (2026-10-03)

The marketing site was a single-page app that served an empty #root, so a crawler saw no h1 and no copy. Every
marketing route is now prerendered to static HTML at build time (see docs/decisions/architecture.md, "The marketing
site is prerendered"), with its own title, description, canonical, Open Graph tags and structured data, a sitemap with
lastmod, an RSS feed and a robots.txt that keeps the app out. Added: a page per glossary term (50 terms, one module),
three move pages (/move/spreadsheet with a starter CSV, /move/crm, /move/giving-platform), landing pages for the four
existing tools and two new ones (the LYBUNT and SYBUNT finder and the thank-you letter builder, both in the browser),
and articles as markdown files (the eight existing ones moved without changing a URL, and four new ones).
Found on the way: the site promised "undo the whole move for 30 days", which production does not do (only the
"We've moved" mark can be undone for 30 days); the hub, the FAQ and the import feature list now say what is true.
The guard is tests/landing2-marketing.test.js sections 16 to 19, each proven red by a planted defect.

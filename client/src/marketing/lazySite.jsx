// HARDEN-2 item 2 · THE MARKETING SITE, LOADED WHEN IT IS NEEDED. Its pages,
// articles, guides and glossary were in main.jsx's own chunk, so every person
// opening the app on a phone downloaded the whole public website before the
// app could even ask for its own code. main.jsx now carries only the list of
// marketing paths (virtual:marketing-paths, computed from routes.js at build
// time) and this file.
//
// No flash on a marketing page: a prerendered page's HTML is already on the
// screen, and main.jsx waits for loadMarketing() before React draws over it,
// so MarketingRoute finds the module loaded and renders straight away. Only a
// click from the app to a marketing page waits on the chunk, under Suspense.
import { lazy } from "react";

let site = null, pending = null;
export function loadMarketing() {
  if (!pending) pending = import("./siteBundle.js").then(m => (site = m));
  return pending;
}
const byPath = path => site.ROUTES.find(r => r.path === path);
const Waiting = lazy(() => loadMarketing().then(m => ({ default: ({ path }) => <m.default route={byPath(path)} /> })));

export function MarketingRoute({ path }) {
  if (site) { const Page = site.default; return <Page route={byPath(path)} />; }
  return <Waiting path={path} />;
}

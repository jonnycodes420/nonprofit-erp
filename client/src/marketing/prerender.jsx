// CONTENT-1 · the server entry for the prerender (scripts/prerender.mjs).
// vite.prerender.config.js builds this for Node, and the script renders every
// marketing route to static HTML so a crawler's first response already holds
// the page's h1, its body text and its head tags, with no JavaScript run.
// In the browser main.jsx renders the same routes as before.
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import MarketingPage from "./Site";
import { ROUTES } from "./routes";
import { ARTICLE } from "./articles/index.js";
import { TERM } from "./data/glossary";

export { ROUTES, ARTICLE, TERM };

export function render(path) {
  const route = ROUTES.find(r => r.path === path);
  if (!route) throw new Error("prerender: no marketing route " + path);
  return renderToString(<StaticRouter location={path}><MarketingPage route={route} /></StaticRouter>);
}

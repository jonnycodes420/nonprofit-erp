// CONTENT-1 · what a crawler reads, built from the route table. Pure, so the
// prerender (scripts/prerender.mjs) writes it and the guard
// (tests/landing2-marketing.test.js) checks the same output.
//
//   headTags(route, html)  the title, description, canonical, Open Graph and
//                          Twitter tags and the structured data for one page
//   sitemapXml(routes)     every marketing URL with its lastmod
//   rssXml(articles)       the articles feed
//   ROBOTS                 robots.txt: the sitemap, and the app kept out
export const SITE_ORIGIN = "https://www.stewardapp.dev";
// The day the marketing copy last changed, for pages without a date of their
// own. Articles carry their frontmatter date and glossary pages theirs.
export const SITE_UPDATED = "2026-10-03";
export const OG_IMAGE = SITE_ORIGIN + "/og-image.png";
const LOGO = SITE_ORIGIN + "/android-chrome-512x512.png";

export const urlOf = path => SITE_ORIGIN + (path === "/" ? "/" : path);

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
// Plain text from our own rendered HTML, for structured data and checks. Any
// angle bracket left after the tags are gone is dropped, never passed on.
const text = html => unesc(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "")).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

const ORG = { "@type": "Organization", "@id": SITE_ORIGIN + "/#org", name: "Steward", url: SITE_ORIGIN + "/", logo: LOGO, email: "jonathan@stewardapp.dev",
  description: "A retention and stewardship CRM for small nonprofits. It shows who is drifting while a phone call still fixes it." };

// The breadcrumb trail as the page draws it (lib.jsx Crumbs): Home, then each
// linked crumb, then this page.
export function breadcrumbs(route, html) {
  const nav = (html.match(/<nav class="crumbs[^"]*" aria-label="Breadcrumb">([\s\S]*?)<\/nav>/) || [])[1];
  if (!nav || route.path === "/") return null;
  const items = [];
  for (const m of nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<b>([\s\S]*?)<\/b>/g)) {
    if (m[1]) items.push([text(m[2]), urlOf(m[1])]);
  }
  const last = [...nav.matchAll(/<b>([\s\S]*?)<\/b>/g)].pop();
  items.push([last ? text(last[1]) : route.title.replace(/^Steward · /, ""), urlOf(route.path)]);
  return { "@type": "BreadcrumbList", itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) };
}

// Questions and answers as the FAQ list draws them (lib.jsx FaqList).
export function faqs(html) {
  const out = [];
  for (const m of html.matchAll(/<details><summary><span class="n">[\s\S]*?<\/span>([\s\S]*?)<span class="x"[\s\S]*?<\/summary><p>([\s\S]*?)<\/p><\/details>/g)) out.push([text(m[1]), text(m[2])]);
  return out;
}

export const h1s = html => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m => text(m[1]));

export function structuredData(route, html, { article, term, terms } = {}) {
  const graph = [];
  if (route.path === "/") {
    graph.push(ORG, { "@type": "WebSite", "@id": SITE_ORIGIN + "/#site", name: "Steward", url: SITE_ORIGIN + "/", publisher: { "@id": ORG["@id"] } });
  }
  const bc = breadcrumbs(route, html);
  if (bc) graph.push(bc);
  const qa = faqs(html);
  if (qa.length) graph.push({ "@type": "FAQPage", mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  const set = { "@type": "DefinedTermSet", "@id": SITE_ORIGIN + "/glossary#set", name: "Steward nonprofit fundraising glossary", url: SITE_ORIGIN + "/glossary" };
  if (term) graph.push({ "@type": "DefinedTerm", name: term.term, ...(term.aka ? { alternateName: term.aka } : {}), description: term.def, url: urlOf(route.path), inDefinedTermSet: set });
  if (terms) graph.push({ ...set, hasDefinedTerm: terms.map(t => ({ "@type": "DefinedTerm", name: t.term, description: t.def, url: SITE_ORIGIN + "/glossary/" + t.slug })) });
  if (article) graph.push({ "@type": "Article", headline: article.title.replace(/\.$/, "").slice(0, 110), description: article.description,
    datePublished: article.date, dateModified: article.date, author: { "@type": "Person", name: article.author },
    publisher: { "@type": "Organization", name: "Steward", logo: { "@type": "ImageObject", url: LOGO } },
    mainEntityOfPage: urlOf(route.path), image: OG_IMAGE, ...(article.terms.length ? { about: article.terms.map(s => ({ "@type": "DefinedTerm", url: SITE_ORIGIN + "/glossary/" + s })) } : {}) });
  return graph.length ? { "@context": "https://schema.org", "@graph": graph } : null;
}

export function headTags(route, html, extra) {
  const url = urlOf(route.path);
  const ld = structuredData(route, html, extra);
  return [
    `<title>${esc(route.title)}</title>`,
    `<meta name="description" content="${esc(route.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:title" content="${esc(route.title)}" />`,
    `<meta property="og:description" content="${esc(route.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:type" content="${extra && extra.article ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="Steward" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<link rel="alternate" type="application/rss+xml" title="Steward articles" href="${SITE_ORIGIN}/rss.xml" />`,
    ...(ld ? [`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`] : []),
  ].join("\n    ");
}

export function sitemapXml(routes) {
  const rows = routes.map(r => `  <url><loc>${urlOf(r.path)}</loc><lastmod>${r.lastmod || SITE_UPDATED}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

const rfc822 = iso => new Date(iso + "T12:00:00Z").toUTCString();
export function rssXml(articles) {
  const items = articles.map(a => `    <item>
      <title>${esc(a.title.replace(/\.$/, ""))}</title>
      <link>${SITE_ORIGIN}/articles/${a.slug}</link>
      <guid isPermaLink="true">${SITE_ORIGIN}/articles/${a.slug}</guid>
      <pubDate>${rfc822(a.date)}</pubDate>
      <author>jonathan@stewardapp.dev (${esc(a.author)})</author>
      <description>${esc(a.description)}</description>
    </item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Steward articles</title>
    <link>${SITE_ORIGIN}/articles</link>
    <atom:link href="${SITE_ORIGIN}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Short, practical reads on donor retention and stewardship for development teams of one to five.</description>
    <language>en-us</language>
    <lastBuildDate>${rfc822(articles[0] ? articles[0].date : SITE_UPDATED)}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>
`;
}

// The signed-in app, the sign-in pages and the same-origin API paths are not
// for search. Public pages an organisation publishes (giving forms, portals,
// event pages) stay open.
export const ROBOTS_DISALLOW = ["/dashboard", "/donors", "/app/", "/welcome", "/admin", "/login", "/signup", "/invite/", "/invitation",
  "/forgot-password", "/reset-password", "/portal-editor", "/oauth/", "/fundraiser/manage/", "/embed/",
  "/portal-api/", "/account-api/", "/network-api/", "/billing/", "/recurring/", "/unsubscribe"];
export const ROBOTS = `User-agent: *\nAllow: /\n${ROBOTS_DISALLOW.map(p => "Disallow: " + p).join("\n")}\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;

// The built index.html with its generic title and social tags taken out, so
// each page can put its own in. The untouched file is kept as app.html.
const FONTS = "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Serif+Display:ital@0;1&display=swap";
export function pageShell(shell) {
  const base = shell.replace(/\s*<title>[^<]*<\/title>/, "").replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/g, "");
  if (!base.includes('<div id="root"></div>')) throw new Error("prerender: the built index.html has no empty #root");
  return base;
}

// One finished page: its head, the fonts without blocking the first paint
// (Site.jsx sees data-mk-fonts and does not add them twice), the white
// marketing ground, and the rendered page inside #root.
export function assemblePage(base, route, html, extra) {
  return base
    .replace("</head>", `    ${headTags(route, html, extra)}\n    <link rel="stylesheet" href="${FONTS.replace(/&/g, "&amp;")}" data-mk-fonts media="print" onload="this.media='all'" />\n  </head>`)
    .replace(/<body style="background:#0f1a12">/, '<body style="background:#FFFFFF">')
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
}

// VOL-PAGE-1 · THE PUBLIC VOLUNTEER PAGE.
//
// /volunteer-page/:orgSlug/:pageSlug. A volunteer page is built in the same
// editor as a giving page, on the same brand, and drawn here by the same one
// renderer (PortalWidgets' PageRenderer). Its own blocks read the volunteer
// programme from the public read, so the roles, shifts, spots and numbers are
// the ones in Volunteers today. Mobile first: most people open it from a
// flyer, a bulletin or a text.
//
// `?embed=1` drops the header band, for the iframe an org pastes into its own
// website. Opening the page changes nothing; signing up is the form's POST.
//
// PAGES-1: the membership page (/membership-page/:orgSlug/:pageSlug) is drawn
// here too, from the same blocks: `kind="membership"` reads its own public
// read, whose data carries the levels its form sells. Each page draws in its
// own theme over the org's brand (shared/pageTheme.js): accent, fonts, button
// style, corners and light or dark sections. When the page carries its own
// Header or Footer block, the built-in band and footer line step aside.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { T } from "./publicTheme";
import { resolvePairing, resolveCardStyle, THEME_DEFAULTS } from "../lib/portalTheme";
import { portalScaleVars } from "../lib/portalScale";
import { resolveAssetUrl } from "../lib/assetUrl";
import { PageRenderer } from "../components/PortalWidgets";
import { VolunteerProvider } from "../components/VolunteerBlocks";
import Picture from "../components/Picture";
import { pageThemeVars, resolvePageTheme } from "../../../shared/pageTheme.js";
import { TYPE_PAIRINGS } from "../lib/portalTheme";

// The page's own theme over the brand: the CSS a page and the editor's
// preview of it both draw with.
export function pageVarsFor(theme, pageTheme) {
  const brand = { primary: (theme && theme.primary) || THEME_DEFAULTS.primary, button: theme && theme.buttonColor };
  const r = resolvePageTheme(brand, pageTheme);
  const dark = r.sections === "dark";
  return {
    ...pageThemeVars(brand, pageTheme, TYPE_PAIRINGS),
    ...(dark ? { "--pt-bg": "#0F1A12", "--pt-card-bg": "rgba(255,255,255,0.06)", "--pt-hair": "rgba(255,255,255,0.16)", "--pt-muted": "rgba(255,255,255,0.78)", "--pt-track": "rgba(255,255,255,0.16)",
      "--pt-card-border": "1px solid rgba(255,255,255,0.16)", "--pt-accent-text": r.accent } : { "--pt-accent-text": r.accent }),
  };
}
export const PAGE_BUTTON_CSS = `
.pg-themed button[type=submit], .pg-themed .pt-btn { border-radius: var(--pt-button-radius, 10px) !important; }
.pg-themed.pg-btn-outline button[type=submit], .pg-themed.pg-btn-outline .pt-btn { background: transparent !important; color: var(--pt-accent-text, var(--pt-button)) !important; border: 2px solid var(--pt-button) !important; }
.pg-themed.pg-dark { color: #FFFFFF; }
.pg-themed.pg-dark a { color: #FFFFFF; }
`;

const HAIR = "#e8e4db";

// The org's theme (the same object a giving page's public read carries) into
// the CSS variables every widget reads. Falls back to the designed neutral
// defaults, never a Steward colour, while the page loads or when it is gone.
function varsFor(theme) {
  const t = theme || {};
  const primary = t.primary || THEME_DEFAULTS.primary;
  const primaryFg = t.primaryFg || THEME_DEFAULTS.primaryFg;
  const pairing = resolvePairing(t.typePairing);
  const cs = resolveCardStyle(t.cardStyle);
  return {
    "--pt-primary": primary, "--pt-primary-fg": primaryFg,
    "--pt-accent": t.accent || THEME_DEFAULTS.accent, "--pt-accent-fg": t.accentFg || THEME_DEFAULTS.accentFg,
    "--pt-button": t.buttonColor || primary, "--pt-button-fg": t.buttonFg || primaryFg,
    "--pt-bg": t.backgroundTint || T.bg,
    "--pt-serif": pairing.serif, "--pt-sans": pairing.sans,
    "--pt-card-radius": cs.radius + "px",
    "--pt-card-border": cs.borderWidth ? `${cs.borderWidth}px solid ${HAIR}` : "none",
    "--pt-card-shadow": cs.shadow,
    ...portalScaleVars(),
  };
}

export default function VolunteerPage({ kind = "volunteer" }) {
  const { orgSlug, pageSlug } = useParams();
  const isMembership = kind === "membership";
  const isEmbed = new URLSearchParams(window.location.search).get("embed") === "1";
  const [page, setPage] = useState(null);     // null = loading
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${API}/org/${encodeURIComponent(orgSlug)}/${isMembership ? "membership-page" : "volunteer-page"}/${encodeURIComponent(pageSlug)}/public`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => {
        if (!live) return;
        setPage(d); if (d?.page?.title) document.title = d.page.title;
        // The view is counted by its own POST, once per load, the way a giving
        // page counts one: the read above writes nothing.
        if (d?.page?.id) fetch(`${API}/forms/${encodeURIComponent(d.page.id)}/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "view" }) }).catch(() => {});
      })
      .catch(() => { if (live) setGone(true); });
    return () => { live = false; };
  }, [orgSlug, pageSlug]);

  const theme = page?.theme || null;
  const pageTheme = page?.page?.pageTheme || null;
  const vars = { ...varsFor(theme), ...(page ? pageVarsFor(theme, pageTheme) : {}) };
  const dark = !!(pageTheme && pageTheme.sections === "dark");
  const shell = { minHeight: "100vh", background: "var(--pt-bg)", color: dark ? "#FFFFFF" : "#0f1a12", fontFamily: "var(--pt-sans, 'DM Sans',system-ui,sans-serif)", ...vars };

  if (gone) {
    return (
      <div style={{ ...shell, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: "28px 24px", maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 22, marginBottom: 8 }}>This page is not here.</div>
          <div style={{ fontSize: 14, color: "#6b6b64", lineHeight: 1.6 }}>It may have been unpublished. The organization can send you the current link.</div>
        </div>
      </div>
    );
  }
  if (!page) return <div style={{ ...shell, padding: 40, color: "#6b6b64" }}>Loading…</div>;

  const name = theme?.displayName || page.org?.name || "";
  const logo = theme?.logo ? resolveAssetUrl(theme.logo) : null;
  const widgets = Array.isArray(page.widgets) ? page.widgets : [];
  const hasGroup = widgets.some(w => w && w.type === "groupsignup");
  const ownHeader = widgets.some(w => w && w.type === "pageheader");
  const ownFooter = widgets.some(w => w && w.type === "pagefooter");
  const ctx = { me: null, theme, orgSlug, orgName: page.org?.name, volData: page.data, pageData: page.data, surface: kind };

  return (
    <div className={"vp-page pg-themed" + (pageTheme && pageTheme.button === "outline" ? " pg-btn-outline" : "") + (dark ? " pg-dark" : "")} style={shell} data-page-ready="1" data-page-kind={kind}>
      <style>{PAGE_BUTTON_CSS}</style>
      <style>{`
        .vp-wrap { max-width: 760px; margin: 0 auto; padding: ${isEmbed ? "16px 16px 32px" : "22px 16px 64px"}; }
        @media (min-width: 1100px) { .vp-wrap { max-width: 920px; padding-top: 32px; } }
      `}</style>
      {!isEmbed && !ownHeader && (
        <header style={{ background: "var(--pt-primary)", color: "var(--pt-primary-fg)" }}>
          <div style={{ maxWidth: 920, margin: "0 auto", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            {logo
              ? <img src={logo} alt="" style={{ height: 34, maxWidth: 120, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 3 }} />
              : <div aria-hidden style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 17 }}>{name.slice(0, 1)}</div>}
            <div style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 19, lineHeight: 1.2 }}>{name}</div>
          </div>
        </header>
      )}
      <main className="vp-wrap">
        {page.page && page.page.cover && <div style={{ marginBottom: 18 }}><Picture value={page.page.cover} alt={page.page.title} ratio="16 / 9" radius={14} testid="page-cover" /></div>}
        <VolunteerProvider data={isMembership ? {} : page.data} orgSlug={orgSlug} pageSlug={pageSlug} hasGroup={hasGroup}>
          <PageRenderer page={{ widgets }} ctx={ctx} />
        </VolunteerProvider>
        {theme?.footerText && !ownFooter && <div style={{ fontSize: 12, color: "#6b6b64", textAlign: "center", marginTop: 24, lineHeight: 1.6 }}>{theme.footerText}</div>}
      </main>
    </div>
  );
}

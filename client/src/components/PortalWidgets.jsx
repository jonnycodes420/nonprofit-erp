// BUILD-54 §4 — the ONE portal-page widget renderer, shared by the live donor
// page (Portal.jsx) and the in-place editor (PortalEditor, which feeds it
// SAMPLE donor data only). Every widget is typed data validated server-side;
// nothing here ever injects markup — strings render as React text nodes, and
// the only iframe sources are BUILT here from a stored {provider, videoId}
// (allowlisted, parsed server-side — never a caller-supplied URL).
import { fmtFull } from "../lib/money";
import { resolveAssetUrl } from "../lib/assetUrl";
import { bannerImgStyle, bannerSrcSet, PORTAL_CAMPAIGN_HERO_RATIO, PORTAL_IMPACT_PHOTO_RATIO } from "./PortalBanner";

const muted = { fontSize: 13, color: "#6b6b64", lineHeight: 1.6 };
const h2 = { fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontWeight: 400, fontSize: 22, margin: "0 0 12px" };
const cardStyle = { background: "#fff", border: "var(--pt-card-border, 1px solid #e7e4dc)", borderRadius: "var(--pt-card-radius, 14px)", boxShadow: "var(--pt-card-shadow, none)", padding: "20px 22px", marginBottom: 18 };

export function StoryBlocksView({ blocks }) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.7 }}>
      {blocks.map((b, i) => {
        if (b.type === "h2") return <div key={i} style={{ ...h2, fontSize: 18, margin: "14px 0 6px" }}>{b.text}</div>;
        if (b.type === "ul") return <ul key={i} style={{ margin: "8px 0", paddingLeft: 22 }}>{(b.items || []).map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{it}</li>)}</ul>;
        return <p key={i} style={{ margin: "8px 0" }}>{b.text}</p>;
      })}
    </div>
  );
}

function GoalBar({ goal }) {
  if (!goal || !(goal.amount > 0)) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ fontWeight: 700 }}>{fmtFull(goal.raised)} raised</span>
        <span style={muted}>of {fmtFull(goal.amount)}{goal.percent != null ? ` · ${goal.percent}%` : ""}</span>
      </div>
      <div style={{ height: 10, background: "#efece5", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(2, Math.min(100, goal.percent || 0))}%`, height: "100%", background: "var(--pt-primary)" }} />
      </div>
    </div>
  );
}

// ctx: { giveSlug, me | null, renderMyGiving() — supplied by the host page
//        (live donor data on the portal, SAMPLE data in the editor) }
export function WidgetView({ w, ctx }) {
  switch (w.type) {
    case "hero":
      return (
        <div style={{ marginBottom: 18 }}>
          {w.image && (
            <div style={{ maxHeight: w.size === "tall" ? 340 : 200, overflow: "hidden", borderRadius: "var(--pt-card-radius, 14px)" }}>
              <img src={resolveAssetUrl(w.image)} alt="" style={{ width: "100%", display: "block", objectFit: "cover" }} />
            </div>
          )}
          {(w.heading || w.sub) && (
            <div style={{ padding: w.image ? "14px 4px 0" : "8px 4px 0" }}>
              {w.heading && <div style={{ ...h2, fontSize: w.size === "tall" ? 30 : 24, marginBottom: 4 }}>{w.heading}</div>}
              {w.sub && <div style={{ fontSize: 15, lineHeight: 1.6, color: "#3a3a35" }}>{w.sub}</div>}
            </div>
          )}
        </div>
      );
    case "richtext":
      return <div style={cardStyle}><StoryBlocksView blocks={w.blocks} /></div>;
    case "image":
      return (
        <figure style={{ margin: "0 0 18px" }}>
          <img src={resolveAssetUrl(w.image)} alt={w.caption || ""} style={{ width: "100%", display: "block", borderRadius: "var(--pt-card-radius, 14px)" }} />
          {w.caption && <figcaption style={{ ...muted, marginTop: 6 }}>{w.caption}</figcaption>}
        </figure>
      );
    case "gallery":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginBottom: 18 }}>
          {(w.images || []).map((u, i) => (
            <img key={i} src={resolveAssetUrl(u)} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10, display: "block" }} />
          ))}
        </div>
      );
    case "stats":
      return (
        <div style={{ ...cardStyle, display: "flex", gap: 28, flexWrap: "wrap" }}>
          {(w.items || []).map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--pt-serif, Georgia,serif)" }}>{s.value}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b6b64", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      );
    case "funds":
      return (
        <div style={cardStyle}>
          {w.heading && <h2 style={h2}>{w.heading}</h2>}
          {(w.funds || []).map(f => (
            <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f0ede6" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</div>
                {f.description && <div style={{ ...muted, marginTop: 2 }}>{f.description}</div>}
              </div>
              {/* BUILD-55 — each card's Give carries ITS fund as the designation
                  (?fund= preselects on the giving page → gifts.fund_id → the
                  impact matcher), never the generic undesignated link. */}
              <a href={`/give/${ctx.giveSlug}?fund=${encodeURIComponent(f.id)}`} style={{ background: "var(--pt-button, var(--pt-primary))", color: "var(--pt-button-fg, #fff)", textDecoration: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>Give</a>
            </div>
          ))}
          {!(w.funds || []).length && <div style={muted}>No funds selected yet.</div>}
        </div>
      );
    case "campaign": {
      const c = w.campaign;
      if (!c) return null;    // never fabricate — no content, no widget
      return (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          {/* BUILD-65 Part 3 — non-destructive crop (or focal fallback) into a
              fixed ratio, so the editor crop preview shows exactly this. */}
          {c.heroImage && (
            <div style={{ position: "relative", width: "100%", aspectRatio: PORTAL_CAMPAIGN_HERO_RATIO, overflow: "hidden" }}>
              <img src={resolveAssetUrl(c.heroImage)} {...(bannerSrcSet(c.heroImage) ? { srcSet: bannerSrcSet(c.heroImage), sizes: "100vw" } : {})} alt="" loading="lazy" decoding="async" style={bannerImgStyle(c.heroFocal, c.heroCrop)} />
            </div>
          )}
          <div style={{ padding: "20px 22px" }}>
            <h2 style={{ ...h2, marginBottom: 6 }}>{c.name}</h2>
            {c.description && <p style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 8px", color: "#3a3a35" }}>{c.description}</p>}
            <StoryBlocksView blocks={c.story} />
            <GoalBar goal={c.goal} />
          </div>
        </div>
      );
    }
    case "impact": {
      // Donor-matched feed when the signed-in donor HAS matches; otherwise the
      // resolved org-wide published updates (BUILD-55 — a signed-in donor with
      // no matches, and the editor's sample donor, used to see nothing/sample
      // here even when the org had real published updates).
      const updates = (ctx.me?.impact?.length) ? ctx.me.impact : (w.updates || []);
      if (!updates.length) return null;
      return (
        <div style={cardStyle}>
          <h2 style={h2}>{w.heading || "What your giving made possible"}</h2>
          {updates.map(u => (
            <div key={u.id} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{u.title}</div>
              {(u.photos || []).length > 0 && (
                <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
                  {/* BUILD-65 Part 3 — per-photo crop (or center fallback) in the
                      fixed impact ratio; the editor preview shares it. */}
                  {u.photos.map((p, i) => (
                    <div key={i} style={{ position: "relative", width: 200, maxWidth: "100%", aspectRatio: PORTAL_IMPACT_PHOTO_RATIO, borderRadius: 8, overflow: "hidden" }}>
                      <img src={resolveAssetUrl(p)} alt="" loading="lazy" decoding="async" style={bannerImgStyle(undefined, (u.photoCrops || [])[i])} />
                    </div>
                  ))}
                </div>
              )}
              {u.body && <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{u.body}</div>}
              <div style={{ ...muted, marginTop: 4, fontSize: 12 }}>{String(u.date).slice(0, 10)}</div>
            </div>
          ))}
        </div>
      );
    }
    case "quote":
      return (
        <blockquote style={{ ...cardStyle, margin: "0 0 18px", borderLeft: "4px solid var(--pt-accent)" }}>
          <div style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 18, lineHeight: 1.6 }}>“{w.text}”</div>
          {w.attribution && <div style={{ ...muted, marginTop: 8 }}>— {w.attribution}</div>}
        </blockquote>
      );
    case "staff":
      return (
        <div style={cardStyle}>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {(w.members || []).map((m, i) => (
              <div key={i} style={{ width: 120, textAlign: "center" }}>
                {m.photo
                  ? <img src={resolveAssetUrl(m.photo)} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", margin: "0 auto 8px", display: "block" }} />
                  : <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--pt-primary)", color: "var(--pt-primary-fg,#fff)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 26, margin: "0 auto 8px" }}>{m.name.slice(0, 1)}</div>}
                <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div>
                {m.role && <div style={{ ...muted, fontSize: 12 }}>{m.role}</div>}
              </div>
            ))}
          </div>
          {w.contactEmail && <div style={{ ...muted, marginTop: 12 }}>Questions? <a href={`mailto:${w.contactEmail}`} style={{ color: "var(--pt-button, var(--pt-primary))" }}>{w.contactEmail}</a></div>}
        </div>
      );
    case "faq":
      return (
        <div style={cardStyle}>
          {(w.items || []).map((it, i) => (
            <details key={i} style={{ borderTop: i ? "1px solid #f0ede6" : "none", padding: "10px 0" }}>
              <summary style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{it.q}</summary>
              <div style={{ fontSize: 14, lineHeight: 1.7, marginTop: 6 }}>{it.a}</div>
            </details>
          ))}
        </div>
      );
    case "video": {
      // Allowlisted providers only; src is CONSTRUCTED from the stored id.
      const src = w.provider === "vimeo"
        ? `https://player.vimeo.com/video/${encodeURIComponent(w.videoId)}`
        : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(w.videoId)}`;
      return (
        <figure style={{ margin: "0 0 18px" }}>
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, borderRadius: "var(--pt-card-radius, 14px)", overflow: "hidden" }}>
            <iframe title={w.caption || "Video"} src={src} allow="encrypted-media; picture-in-picture; fullscreen"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
          </div>
          {w.caption && <figcaption style={{ ...muted, marginTop: 6 }}>{w.caption}</figcaption>}
        </figure>
      );
    }
    case "give":
      // §5 vertical rhythm — a solid band in the org's own color, not another
      // white card in a uniform stack.
      return (
        <div style={{ background: "var(--pt-primary)", color: "var(--pt-primary-fg, #fff)", borderRadius: "var(--pt-card-radius, 14px)", padding: "26px 24px", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 20 }}>{w.heading || "Make a new gift"}</div>
          <a href={`/give/${ctx.giveSlug}`} style={{ background: "var(--pt-primary-fg, #fff)", color: "var(--pt-primary)", textDecoration: "none", borderRadius: 10, padding: "12px 26px", fontSize: 15, fontWeight: 700 }}>{w.buttonLabel || "Give"}</a>
        </div>
      );
    case "mygiving":
      return ctx.renderMyGiving ? ctx.renderMyGiving() : null;
    default:
      return null;
  }
}

// 2026-08-15 wide-width pass — the kind→span map for the published-page grid.
// At >=1280px Portal.jsx's PortalStyles turns .pt-widgets into a two-track CSS
// grid; full-width kinds span both tracks via inline gridColumn, pairable
// kinds take one column each and FLOW IN SOURCE ORDER (grid auto-placement),
// which preserves the published widget-order contract. The editor deliberately
// does NOT load PortalStyles, so its previews stay a single column — below
// 1280px (and everywhere without the CSS) the wrappers are inert divs and the
// page renders exactly as before.
const FULL_WIDTH_WIDGETS = new Set(["hero", "mygiving", "give", "video", "richtext"]);

// `decorate(w, node)` (optional) lets a host wrap each widget's rendered node
// with chrome INSIDE its grid cell — the editor's selection/reorder controls
// ride this seam so the desktop preview keeps the REAL .pt-widgets grid
// instead of falling back to one PageRenderer per widget (BUILD-55 Part 2).
export function PageRenderer({ page, ctx, decorate }) {
  if (!page || !Array.isArray(page.widgets) || !page.widgets.length) return null;
  return (
    <div className="pt-widgets">
      {page.widgets.map(w => (
        <div key={w.id} style={FULL_WIDTH_WIDGETS.has(w.type) ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
          {decorate ? decorate(w, <WidgetView w={w} ctx={ctx} />) : <WidgetView w={w} ctx={ctx} />}
        </div>
      ))}
    </div>
  );
}

// PageBlocks.jsx · PAGES-1. THE PAGE SYSTEM'S OWN BLOCKS.
//
// Giving, volunteer and membership pages are built from one set of blocks in
// one editor (shared/pageWidgets.js). Most of them were the portal's already;
// these four are what a stand-alone page needs around its story:
//
//   pageheader    the org's logo and name, from its brand.
//   goalbar       progress read from records: spots filled on a volunteer
//                 page's upcoming shifts, members of a membership page's goal.
//   memberlevels  the membership page's form: each level, with Join.
//   pagefooter    the org's name, contact and EIN line, from Settings.
//
// NEVER A PLACEHOLDER (WALKB-1): every block here renders nothing when there
// is nothing true to show. The editor says so in its own words instead
// (`ctx.editing`), and those words never reach a public page.
import { LevelCard } from "../pages/MembershipsPage";
import { resolveAssetUrl } from "../lib/assetUrl";

const MUTED = "var(--pt-muted, #6b6b6b)";
const card = {
  background: "var(--pt-card-bg, #fff)", color: "var(--pt-text, #0F1A12)",
  border: "var(--pt-card-border, 1px solid #e8e2d9)", borderRadius: "var(--pt-card-radius, 14px)",
  boxShadow: "var(--pt-card-shadow, none)",
};
const h2 = { fontFamily: "var(--pt-serif, Georgia,serif)", fontWeight: 400, fontSize: 24, margin: "0 0 12px" };

// The editor's word for a block with nothing to show yet; never public.
function EditorNote({ ctx, children }) {
  if (!ctx || !ctx.editing) return null;
  return <div data-editor-only="" data-testid="block-editor-note" style={{ border: "1.5px dashed #6b6b6b", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#6b6b6b", marginBottom: 18 }}>{children}</div>;
}

function goalFor(w, ctx) {
  const surface = ctx.surface;
  if (surface === "volunteer") {
    const shifts = (ctx.volData && Array.isArray(ctx.volData.shifts)) ? ctx.volData.shifts : [];
    const counted = shifts.filter(s => s && s.needed != null && s.needed > 0);
    const needed = counted.reduce((a, s) => a + Number(s.needed || 0), 0);
    const filled = counted.reduce((a, s) => a + Math.min(Number(s.filled || 0), Number(s.needed || 0)), 0);
    if (!needed) return null;
    return { done: filled, of: needed, noun: needed === 1 ? "spot" : "spots", word: "filled",
      sentence: `Places taken on the upcoming shifts that say how many people they need, out of every place those shifts have.` };
  }
  if (surface === "membership") {
    const m = ctx.pageData && ctx.pageData.members;
    if (!m || !(Number(w.target) > 0)) return null;
    return { done: Number(m.count) || 0, of: Number(w.target), noun: Number(w.target) === 1 ? "member" : "members", word: "", sentence: m.sentence || "" };
  }
  return null;
}

export function PageBlock({ w, ctx = {} }) {
  const th = ctx.theme || {};
  switch (w.type) {
    case "pageheader": {
      const name = th.displayName || ctx.orgName || "";
      const logo = th.logo ? resolveAssetUrl(th.logo) : null;
      if (!name && !logo) return null;
      return (
        <header data-testid="block-pageheader" style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 18px", marginBottom: 6, borderBottom: "1px solid var(--pt-hair, #e8e2d9)" }}>
          {logo
            ? <img src={logo} alt={name} style={{ height: 40, maxWidth: 160, objectFit: "contain", display: "block" }} />
            : <span aria-hidden style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--pt-primary)", color: "var(--pt-primary-fg, #fff)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 18 }}>{name.slice(0, 1)}</span>}
          {(!logo || th.showNameWithLogo) && <span style={{ fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 20 }}>{name}</span>}
        </header>
      );
    }
    case "goalbar": {
      const g = goalFor(w, ctx);
      if (!g) return <EditorNote ctx={ctx}>{ctx.surface === "membership" ? "Goal bar: set how many members you are aiming for, and the bar fills from Memberships." : "Spots filled: shows once an upcoming shift says how many people it needs."}</EditorNote>;
      const pct = Math.max(0, Math.min(100, Math.round((g.done / g.of) * 100)));
      return (
        <section data-testid="block-goalbar" style={{ ...card, padding: "18px 20px", marginBottom: 18 }}>
          {w.heading && <div style={{ ...h2, fontSize: 19, marginBottom: 8 }}>{w.heading}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 26, fontFamily: "var(--pt-serif,Georgia,serif)", color: "var(--pt-accent-text, var(--pt-text, #0F1A12))" }}>{g.done.toLocaleString("en-US")}</span>
            <span style={{ fontSize: 14, color: MUTED }}>of {g.of.toLocaleString("en-US")} {g.noun}{g.word ? " " + g.word : ""}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={g.of} aria-valuenow={g.done} style={{ height: 10, borderRadius: 999, background: "var(--pt-track, #e8e4db)", overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: "var(--pt-accent, var(--pt-primary))" }} />
          </div>
          {g.sentence && <div style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>{g.sentence}</div>}
        </section>
      );
    }
    case "memberlevels": {
      const levels = (ctx.pageData && Array.isArray(ctx.pageData.levels)) ? ctx.pageData.levels : [];
      if (!levels.length) return <EditorNote ctx={ctx}>Membership levels: add a level in Memberships and it shows here with Join.</EditorNote>;
      const lth = { button: "var(--pt-button, var(--pt-primary))", buttonFg: "var(--pt-button-fg, #fff)", primary: "var(--pt-accent-text, var(--pt-primary))",
        serif: "var(--pt-serif, Georgia,serif)", sans: "var(--pt-sans, inherit)" };
      return (
        <section data-testid="block-memberlevels" style={{ marginBottom: 18 }}>
          {w.heading && <h2 style={h2}>{w.heading}</h2>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 14 }}>
            {levels.map(l => (
              <LevelCard key={l.id} l={l} th={lth} card={{ ...card }} orgSlug={ctx.orgSlug} prefill={null} mine={null} isMember={false} />
            ))}
          </div>
        </section>
      );
    }
    case "pagefooter": {
      const name = th.displayName || ctx.orgName || "";
      const bits = [th.footerText, th.contactEmail, th.einLine].filter(x => x && String(x).trim());
      if (!name && !bits.length) return null;
      return (
        <footer data-testid="block-pagefooter" style={{ borderTop: "1px solid var(--pt-hair, #e8e2d9)", marginTop: 12, paddingTop: 18, fontSize: 13, color: MUTED, lineHeight: 1.6, textAlign: "center" }}>
          {name && <div style={{ fontWeight: 700, color: "var(--pt-text, #0F1A12)" }}>{name}</div>}
          {th.footerText && <div>{th.footerText}</div>}
          {th.contactEmail && <div><a href={"mailto:" + th.contactEmail} style={{ color: "inherit" }}>{th.contactEmail}</a></div>}
          {th.einLine && <div>{th.einLine}</div>}
        </footer>
      );
    }
    default:
      return null;
  }
}

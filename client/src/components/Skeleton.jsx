// FIX-21 · NEVER A WHITE SCREEN. While a screen's data or code is on its way,
// the screen's own shape is drawn at once in quiet blocks: a heading, tiles,
// rows. Nothing here imports the rest of the app (no shared.jsx), so the
// entry chunk can use it as the Suspense fallback without pulling the app in.
// The colours are the palette's own: cream ground, white cards, cream's shade.
const CREAM = "#f0ede6", SHADE = "#e8e4db", WHITE = "#ffffff", INK = "#0f1a12";
const PULSE = "@keyframes stwSkel{0%,100%{opacity:1}50%{opacity:.55}}";

export function SkeletonBar({ width = "100%", height = 12, style }) {
  return <span aria-hidden="true" style={{ display: "block", width, height, borderRadius: 6, background: SHADE,
    animation: "stwSkel 1.4s ease-in-out infinite", ...style }} />;
}

const card = { background: WHITE, border: "1px solid " + SHADE, borderRadius: 12, padding: "16px 18px", boxSizing: "border-box" };

// A list of cards (the Groups list while it loads).
export function SkeletonCards({ count = 6, label = "Loading" }) {
  return (
    <div role="status" aria-label={label} data-testid="skeleton"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
      <style>{PULSE}</style>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBar width="55%" height={16} />
          <SkeletonBar width="90%" />
          <SkeletonBar width="30%" />
        </div>
      ))}
    </div>
  );
}

// A record page: heading, a row of figure tiles, a chart, then rows.
export function SkeletonPage({ tiles = 5, rows = 8, label = "Loading" }) {
  return (
    <div role="status" aria-label={label} data-testid="skeleton">
      <style>{PULSE}</style>
      <SkeletonBar width={260} height={26} style={{ marginBottom: 10 }} />
      <SkeletonBar width="min(520px, 90%)" style={{ marginBottom: 18 }} />
      {tiles > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <SkeletonBar width="60%" height={10} />
              <SkeletonBar width="45%" height={20} />
            </div>
          ))}
        </div>
      )}
      <div style={{ ...card, marginBottom: 16, height: 150 }}>
        <SkeletonBar width={140} height={10} style={{ marginBottom: 14 }} />
        <SkeletonBar height={90} style={{ borderRadius: 8 }} />
      </div>
      <div style={card}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: i ? "1px solid " + SHADE : "none" }}>
            <SkeletonBar width="35%" />
            <SkeletonBar width="12%" style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// The whole signed-in app while its code loads: the top bar, the ink rail
// and a page, so a click into the app never shows a blank screen.
export function SkeletonAppShell() {
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  return (
    <div style={{ minHeight: "100vh", background: CREAM }} role="status" aria-label="Loading Steward" data-testid="skeleton-shell">
      <style>{PULSE}</style>
      <div style={{ height: 52, background: INK }} />
      {!narrow && <div style={{ position: "fixed", left: 0, top: 52, bottom: 0, width: 240, background: INK }} />}
      <div style={{ marginLeft: narrow ? 0 : 240, padding: "20px 32px 28px" }}>
        <SkeletonPage />
      </div>
    </div>
  );
}

// A public page while its code loads: the cream ground and one card's shape.
export function SkeletonPublic() {
  return (
    <div style={{ minHeight: "100vh", background: CREAM, display: "flex", justifyContent: "center", padding: "64px 16px", boxSizing: "border-box" }}
      role="status" aria-label="Loading" data-testid="skeleton-public">
      <style>{PULSE}</style>
      <div style={{ ...card, width: "100%", maxWidth: 560, height: "fit-content", display: "flex", flexDirection: "column", gap: 12 }}>
        <SkeletonBar width="50%" height={22} />
        <SkeletonBar />
        <SkeletonBar width="80%" />
        <SkeletonBar width="65%" />
      </div>
    </div>
  );
}

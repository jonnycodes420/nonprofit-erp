// BUILD-48 — theme-depth resolution maps (JSX-free, Node-testable).
//
// The server stores + validates only ENUM KEYS ("dm", "rounded", …); this
// fixed client code resolves a key to real CSS values. The org never supplies
// a font string, font file, or URL — every stack below is either the app's
// own already-loaded DM pair or an OS-shipped (pre-licensed, self-hosted by
// definition, zero-network) system family. Key parity with the server's
// PORTAL_TYPE_PAIRINGS / PORTAL_CARD_STYLES is pinned by
// tests/theme-depth.test.js.

export const TYPE_PAIRINGS = {
  dm: {
    label: "DM Serif & DM Sans (default)",
    serif: "'DM Serif Display',Georgia,serif",
    sans: "'DM Sans',Helvetica,Arial,sans-serif",
  },
  classic: {
    label: "Georgia & Verdana",
    serif: "Georgia,'Times New Roman',serif",
    sans: "Verdana,Geneva,'DejaVu Sans',sans-serif",
  },
  editorial: {
    label: "Palatino & Gill Sans",
    serif: "'Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif",
    sans: "'Gill Sans','Gill Sans MT','Trebuchet MS',Calibri,sans-serif",
  },
  literary: {
    label: "Baskerville & Helvetica",
    serif: "Baskerville,'Baskerville Old Face','Hoefler Text','Times New Roman',serif",
    sans: "'Helvetica Neue',Helvetica,Arial,sans-serif",
  },
  modern: {
    label: "Modern system sans",
    serif: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
    sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
  },
};

export const CARD_STYLES = {
  rounded: { label: "Rounded", radius: 14, borderWidth: 1, shadow: "none" },
  square: { label: "Square", radius: 3, borderWidth: 1, shadow: "none" },
  "soft-shadow": { label: "Soft shadow", radius: 14, borderWidth: 0, shadow: "0 2px 14px rgba(15,26,18,0.09)" },
};

// The designed fallbacks (mirror the server's PORTAL_DEFAULT_THEME).
export const THEME_DEFAULTS = {
  primary: "#1a6b4a", primaryFg: "#ffffff",
  accent: "#c9a84c", accentFg: "#0f1a12",
  typePairing: "dm", cardStyle: "rounded",
};

export function resolvePairing(key) {
  return TYPE_PAIRINGS[key] || TYPE_PAIRINGS.dm;
}
export function resolveCardStyle(key) {
  return CARD_STYLES[key] || CARD_STYLES.rounded;
}

// Card chrome from a card-style key + a hairline color: one implementation
// for the portal, the dashboard takeover, the multi-org cards, and the
// Settings live preview.
export function cardChrome(key, hairColor) {
  const cs = resolveCardStyle(key);
  return {
    borderRadius: cs.radius,
    border: cs.borderWidth ? `${cs.borderWidth}px solid ${hairColor}` : "none",
    boxShadow: cs.shadow === "none" ? undefined : cs.shadow,
  };
}

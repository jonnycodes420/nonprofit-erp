// Shared design tokens + formatting for the app's fully public, unauthenticated
// pages (Donate.jsx, ManageFundraiser.jsx) — these render outside the
// authenticated app shell, so they don't use client/src/components/shared.jsx's
// `T` (a different, admin-app-specific palette). Factored out here once
// ManageFundraiser.jsx needed the exact same tokens Donate.jsx already had
// locally, rather than letting a second hand-copied `T` object drift from
// the first (see the ShareBlocks.jsx comment for how that already happened
// once with the admin app's tokens).
export const T = {
  bg: "#f0ede6", bg2: "#e8e4db", bg3: "#e8e2d9",
  white: "#faf8f4", ink: "#1a1a1a", ink2: "#2a2a2a", ink3: "#6b6b6b",
  green: "#10b981", greenDk: "#1a6b4a", gold: "#c9a84c",
};

export function fmtMoney(n) {
  return "$" + Math.round(n || 0).toLocaleString();
}

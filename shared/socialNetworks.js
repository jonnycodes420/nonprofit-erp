// shared/socialNetworks.js · BUILDER-2A, BUILDER-2B. THE SOCIAL NETWORKS AN EMAIL'S SOCIAL BLOCK DRAWS.
//
// Pure. One list, read by the Social block (shared/emailMoreBlocks.js) and by
// Brand's Social links (client BrandPanel.jsx). Its own small module so the
// Brand screen does not pull the email renderer into its bundle.
//
// The order icons are drawn in, and the name each one is read out as.
export const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "website", label: "our website" },
];

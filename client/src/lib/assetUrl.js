// BUILD-51 — theme images arrive from the API as content-addressed URL PATHS
// (/portal-assets/<id>) instead of inline base64 (see assetStore.js). In
// production those paths are same-origin: the vercel.json /portal-assets
// proxy forwards to the backend and the immutable cache headers make them
// CDN-cacheable. Locally (capture stack, vite dev) the path is resolved
// against the API origin. Legacy data: URIs (unmigrated orgs) and absolute
// URLs pass through untouched, so both generations render.
export function resolveAssetUrl(v) {
  if (!v || typeof v !== "string") return v || null;
  if (!v.startsWith("/portal-assets/")) return v;
  if (import.meta.env.PROD) return v;
  return (import.meta.env.VITE_API_URL || "http://localhost:5601") + v;
}

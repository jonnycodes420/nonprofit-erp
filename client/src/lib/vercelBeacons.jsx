// lib/vercelBeacons.jsx · PERF-3. Vercel's two beacons, page views and Speed
// Insights, in their own small chunk: main.jsx draws them once the page has
// settled (LaterBeacons), not while a phone is still downloading Home.
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

export default function VercelBeacons() {
  return <><Analytics /><SpeedInsights /></>;
}

// ONBOARD-1 · the two onboarding pages behind ONE lazy import, so the app's
// entry carries one loader for them, not two (perf-app's first-look budget).
import StartPage from "./StartPage";
import ImportVerify from "./ImportVerify";
import TotalsCheck from "./TotalsCheck";   // ONBOARD-3
import PrintNotes from "./PrintNotes";   // ONBOARD-3 Part B
import { lazy, Suspense } from "react";
// ONBOARD-5: the ten-step setup is its own chunk, fetched only when she opens it.
const SetupPage = lazy(() => import("./setup/SetupPage"));

export default function OnboardPages({ page }) {
  if (page === "setup") return <Suspense fallback={null}><SetupPage /></Suspense>;
  return page === "verify" ? <ImportVerify /> : page === "totals" ? <TotalsCheck /> : page === "notes" ? <PrintNotes /> : <StartPage />;
}

// ONBOARD-1 · the two onboarding pages behind ONE lazy import, so the app's
// entry carries one loader for them, not two (perf-app's first-look budget).
import StartPage from "./StartPage";
import ImportVerify from "./ImportVerify";

export default function OnboardPages({ page }) {
  return page === "verify" ? <ImportVerify /> : <StartPage />;
}

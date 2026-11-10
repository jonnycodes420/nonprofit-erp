// ONBOARD-2 · Home's "Getting set up", loaded only for an org in onboarding
// (GET /org/setup-status says so), so every other org's first look is unchanged.
import GettingSetUp from "./GettingSetUp";
import { useOnboarding } from "./useOnboarding";

export default function HomeOnboarding({ onNavigate }) {
  const [data, , reload] = useOnboarding(true);
  return <GettingSetUp data={data} onNavigate={onNavigate} onHome onReload={reload} />;
}

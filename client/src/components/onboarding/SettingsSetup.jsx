// ONBOARD-2 · Settings → Account keeps "Getting set up" after Home lets it go:
// the same card, drawn whether or not the first month is done.
import GettingSetUp from "./GettingSetUp";
import { useOnboarding } from "./useOnboarding";

export default function SettingsSetup({ onNavigate }) {
  const [data, , reload] = useOnboarding(true);
  if (!data || !data.tracked) return null;
  return <div style={{ marginBottom: 16 }}><GettingSetUp data={data} onNavigate={onNavigate} always onReload={reload} /></div>;
}

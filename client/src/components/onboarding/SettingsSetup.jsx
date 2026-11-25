// ONBOARD-2 · Settings → Account keeps "Getting set up" after Home lets it go:
// the same card, drawn whether or not the first month is done.
// ONBOARD-5: and the way back into the ten-step setup page, for every org, any time.
import GettingSetUp from "./GettingSetUp";
import { useOnboarding } from "./useOnboarding";
import { T } from "../shared";

export default function SettingsSetup({ onNavigate }) {
  const [data, , reload] = useOnboarding(true);
  const open = <p data-testid="settings-open-setup" style={{ margin: "0 0 12px", fontSize: 13.5, color: T.ink2 }}>
    Your logo, receipts, funds, words, connections and team, one page at a time:{" "}
    <a href="/onboard/setup" style={{ color: T.greenDk, fontWeight: 700 }}>Open the setup →</a></p>;
  if (!data || !data.tracked) return open;
  return <div style={{ marginBottom: 16 }}>{open}<GettingSetUp data={data} onNavigate={onNavigate} always onReload={reload} /></div>;
}

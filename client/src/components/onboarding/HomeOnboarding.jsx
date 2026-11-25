// ONBOARD-2 · Home's onboarding card, loaded only for an org in onboarding
// (GET /org/setup-status says so), so every other org's first look is unchanged.
// ONBOARD-4: the card is the guided setup (five steps, GuidedSetup.jsx), which
// holds ONBOARD-2's steps and ONBOARD-3's first 30 minutes; Settings still
// shows the five onboarding stages (SettingsSetup.jsx). Opening Home is still
// the kickoff gate's signal, recorded once.
import { useEffect, useRef } from "react";
import { apiFetch } from "../../api";
import GuidedSetup from "./GuidedSetup";
import { useOnboarding } from "./useOnboarding";

export default function HomeOnboarding({ onNavigate, prefer = null }) {
  const [data] = useOnboarding(true);
  const told = useRef(false);
  useEffect(() => {
    if (!data || !data.tracked || data.homeOpened || told.current) return;
    told.current = true;
    apiFetch("/onboarding/home-opened", { method: "POST", body: "{}" }).catch(() => {});
  }, [data]);
  return <GuidedSetup onNavigate={onNavigate} prefer={prefer} />;
}

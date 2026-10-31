// TellStewardOpen.jsx · SWEEP-6 (PERF-1): what opens Atlas, without Atlas.
// The app shell, Home and the profile import these; the window itself
// (TellSteward.jsx) loads the first time it opens.

// Open Atlas from anywhere. `text` arrives typed; `send` asks at once (Home's box).
export function openTellSteward(donor, { text = "", send = false } = {}) {
  window.dispatchEvent(new CustomEvent("steward:tell", { detail: { donor: donor ? { id: donor.id, name: donor.name } : null, text, send } }));
}
export const openAtlas = openTellSteward;

// The large button, for Home and the profile.
export function MicGlyph({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

// components/touchIcons.jsx · TOUCH-1. ONE ICON PER KIND OF TOUCH.
//
// The "Log a touch" chips and the timeline's tile both draw these, so a
// handwritten note looks the same where she logs it and where she reads it.
// Line icons in the timeline's stroke, coloured by the text around them.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };
const PATHS = {
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>,
  letter: <><path d="M4 20l1.5-5L16 4.5a2.1 2.1 0 0 1 3 3L8.5 18z"/><path d="M14 6.5l3 3"/></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  visit: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></>,
  meeting: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></>,
  gift_sent: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C10 4 6.5 5 8 8M12 8c2-4 5.5-3 4 0"/></>,
  event_invite: <><path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14 7v12" strokeDasharray="2 2"/></>,
  text: <><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></>,
  other: <><circle cx="12" cy="12" r="8"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></>,
};
export function TouchIcon({ kind, size = 20 }) {
  const k = PATHS[kind] ? kind : "other";
  return <svg width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden="true" data-touch-icon={k}>{PATHS[k]}</svg>;
}

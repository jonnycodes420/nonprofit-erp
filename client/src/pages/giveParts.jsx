// client/src/pages/giveParts.jsx · small pieces of the public giving page (Donate.jsx), kept here so
// that page stays under its size cap (docs/architecture: a big file does not grow).
import { T } from "./publicTheme";

// PARITY-2 Part 2: a thin progress bar in the org's own colour. Every bar on the giving pages is
// this one, so a fundraiser's, a team's and the campaign's look alike. (Moved from Donate.jsx.)
export function ProgressBar({ raised, goal, th }) {
  if (!(goal > 0)) return null;
  return (
    <div style={{ background: T.bg, borderRadius: 99, height: 10, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, Math.round((raised / goal) * 100))}%`, background: th.primary, borderRadius: 99 }} />
    </div>
  );
}

// HONEST-3 item 4: a demo org's page is drawn whole, and this line says it is an example that takes
// no gift (server/give/examplePage.js writes the sentence).
export function ExampleNote({ text }) {
  if (!text) return null;
  return <div data-testid="give-example" role="note" style={{ width: "100%", maxWidth: 480, order: 0, background: T.white,
    border: "1px solid " + T.gold, borderRadius: 10, padding: "10px 14px", fontSize: 14, color: T.ink, lineHeight: 1.5 }}>{text}</div>;
}

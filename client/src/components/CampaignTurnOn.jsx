// client/src/components/CampaignTurnOn.jsx · COMMS-1 item 1. Where the
// audience waits until Campaign emails are on, one sentence and, for an admin,
// the link to the switch (Settings → Automatic email); anyone else is told to
// ask an admin. The server decides who sees the link (server/outreach/campaignTurnOn.js).
import { T } from "./shared";

export default function CampaignTurnOn({ note, testid = "campaign-turn-on", style }) {
  if (!note) return null;
  return (
    <div data-testid={testid} style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, marginTop: 8, ...(style || {}) }}>
      {note.sentence}{" "}
      {note.link
        ? <a data-testid={testid + "-link"} href={note.link.href} style={{ color: T.greenDk, fontWeight: 700 }}>{note.link.label}</a>
        : <span data-testid={testid + "-ask"}>{note.ask}</span>}
      {note.link ? "." : ""}
    </div>
  );
}

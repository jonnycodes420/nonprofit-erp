// POLISH-9 (W-1108-Atlas-11X): a never-used draft copied from an older version
// of its template says so, with the template's own sentence, and takes the
// template's timing on one click (she still saves it). Both sentences are
// computed from steps (server/outreach/olderTemplate.js).
import React from "react";
import { T } from "./shared";

const shape = steps => JSON.stringify((steps || []).map(s => [s.type, Number(s.offsetDays) || 0]));
export function OlderTemplateNote({ note, draft, onUse, editable }) {
  if (!note || shape(draft) === shape(note.steps)) return null;   // once she takes its timing, the note goes
  return (
    <span data-testid="jb-older-template" style={{ display: "block", marginTop: 6, color: T.ink2 }}>
      Made from an older version of "{note.name}". The template is now {note.touches.replace(/ Nothing is sent without you\.$/, "").replace(/\.$/, "")}.
      {editable && onUse ? <> <button type="button" data-testid="jb-use-template-timing" onClick={() => onUse(note.steps)}
        style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", font: "inherit" }}>Use its timing</button></> : null}
    </span>
  );
}

// EMAIL-1 — "Start from a template", for a draft a person will send.
//
// One small control shared by the review queue (Communications → Drafts to
// review) and the Agent's waiting drafts. It lists the org's email templates
// and hands the chosen one back; the caller's route fills the draft's subject
// and words from the template's text with this person's name in it. Nothing
// here sends. When the org has no templates (or the route is not there yet)
// it renders nothing.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

let cache = null;   // one read per page load; templates change rarely

export function TemplateStart({ onPick, disabled }) {
  const [list, setList] = useState(cache);
  useEffect(() => {
    if (cache) return;
    let dead = false;
    apiFetch("/email-templates")
      .then(r => { cache = (Array.isArray(r) ? r : (Array.isArray(r?.templates) ? r.templates : [])).filter(x => !x.archived); if (!dead) setList(cache); })
      .catch(() => { if (!dead) setList([]); });
    return () => { dead = true; };
  }, []);
  if (!list || !list.length) return null;
  return (
    <select data-testid="draft-from-template" disabled={disabled} value=""
      onChange={e => { const t = list.find(x => x.id === e.target.value); if (t) onPick(t); }}
      style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
      <option value="">Start from a template</option>
      {list.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}
